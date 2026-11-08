'use strict';
// 버거타임 규칙 (오락실 고전 스타일). 화면 없이 Node 에서 시험한다 (DOM 을 쓰지 않는다).
// 요리사가 철골 위를 걸으며 햄버거 재료를 밟아 한 층씩 떨어뜨려 접시에 쌓는다. 소시지·달걀·피클이 쫓아오고 후추로 잠깐 멈춘다.
// 좌표는 픽셀(논리 크기 W x H), 위쪽이 y=0. 캐릭터·재료의 y 는 '발이 닿은 철골 선' 기준이다.
const LOGIC_BT = (() => {
  const W = 224, H = 248;
  const FLOORS = [40, 78, 116, 154, 192];          // 철골 다섯 층의 높이 (위에서 아래로). 모든 층이 x 8~216
  const X0 = 8, X1 = 216;
  const PLATE_Y = 232;                              // 접시 윗면 (맨 아래 층 밑)
  const COLS = [40, 88, 136, 184];                  // 햄버거 네 줄의 가운데 x
  const HALF = 20, SEG = 4, PIECE_H = 6;            // 재료 폭 40(네 칸), 두께 6
  const KINDS = ['bun', 'lettuce', 'patty', 'bottom'];   // 위에서 아래 순서 (맨 위 빵 ~ 아래 빵)
  // 사다리: x 위치와 이어 주는 두 층(top 이 위쪽 층 번호). 모두 재료 칸 사이 틈이나 가장자리에 있다
  const LADDERS = [
    { x: 64, top: 0 }, { x: 160, top: 0 },
    { x: 14, top: 1 }, { x: 112, top: 1 }, { x: 210, top: 1 },
    { x: 64, top: 2 }, { x: 160, top: 2 },
    { x: 14, top: 3 }, { x: 112, top: 3 }, { x: 210, top: 3 },
  ];
  const CHEF = { w: 8, h: 14, speed: 50, climb: 42, start: { floor: 4, x: 112 } };
  const START_LIVES = 3, DYING = 1.5, CLEAR_TIME = 2.4;
  const FALL_SPEED = 140;
  const PEPPER_START = 5, PEPPER_RANGE = 30, STUN_TIME = 3.5, PEPPER_COOL = 0.35;
  const POINTS = { drop: 100, plate: 500, crush: 500, ride: 1000, item: 500, clear: 1000 };
  const EXTRA_LIFE_AT = 10000, EXTRA_LIFE_EVERY = 30000;
  const ENEMY_KINDS = ['dog', 'egg', 'pickle'];
  const ENEMY = { dog: { speed: 30, wander: 0.1 }, egg: { speed: 34, wander: 0.25 }, pickle: { speed: 27, wander: 0.4 } };
  const RESPAWN = 6, ITEM_EVERY = 26, ITEM_LIFE = 10;

  const rng = (seed) => {                            // mulberry32 (시험용 고정 난수)
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  const emit = (st, e) => { st.events.push(e); };
  const enemyCount = (level) => Math.min(5, 2 + Math.floor((level - 1) / 2));
  const speedMul = (level) => Math.min(1.5, 1 + 0.08 * (level - 1));
  const laddersBetween = (top) => LADDERS.filter((l) => l.top === top);

  function newGame(rand = Math.random, level = 1, opts = {}) {
    const st = { rand, score: 0, lives: opts.lives || START_LIVES, extra: 0, level, time: 0, events: [], seq: 0, phase: 'play', tutorial: !!opts.tutorial, stats: { drops: 0, crushed: 0, burgers: 0, peppers: 0 } };
    startLevel(st, level);
    return st;
  }
  function startLevel(st, level) {
    st.level = level;
    st.pieces = [];
    COLS.forEach((cx, col) => KINDS.forEach((kind, i) => st.pieces.push({ id: ++st.seq, col, cx, kind, floor: i, y: FLOORS[i], state: 'rest', pressed: new Array(SEG).fill(false), vy: 0, riders: [], crushed: 0 })));
    st.plate = COLS.map(() => 0);                    // 줄마다 접시에 쌓인 재료 수
    st.pepper = st.tutorial ? 9 : PEPPER_START;
    st.item = null; st.itemT = ITEM_EVERY;
    resetRound(st);
    emit(st, { t: 'level', level });
  }
  // 목숨을 잃고 다시 시작할 때도 쓴다: 재료 상태는 그대로, 요리사와 적만 처음으로
  function resetRound(st) {
    st.phase = 'play';
    const start = st.tutorial ? { floor: 0, x: 12 } : CHEF.start;            // 연습은 맨 위 층 왼쪽에서 시작해 재료를 바로 밟아 볼 수 있다
    st.chef = { x: start.x, floor: start.floor, y: FLOORS[start.floor], state: 'walk', ladder: null, face: 1, alive: true, moved: false, invuln: 1.5, pepperCool: 0, ly: 0 };
    st.enemies = []; st.respawns = [];
    const n = st.tutorial ? 1 : enemyCount(st.level);
    for (let i = 0; i < n; i++) st.respawns.push(2 + i * 2.5);      // 처음 몇 초 뒤에 하나씩 나온다
    st.enemyIdx = 0;
  }

  function addScore(st, n) {
    st.score += n;
    const need = () => EXTRA_LIFE_AT + st.extra * EXTRA_LIFE_EVERY;
    while (st.score >= need()) { st.extra++; st.lives++; emit(st, { t: 'extra' }); }
  }
  function die(st, why) {
    if (st.phase !== 'play') return;
    st.chef.alive = false; st.chef.state = 'dead';
    st.lives--;
    st.phase = 'dying'; st.dyingT = DYING;
    emit(st, { t: 'dead', why });
  }

  // ---------- 적 ----------
  function spawnEnemy(st) {
    const kind = ENEMY_KINDS[st.enemyIdx++ % ENEMY_KINDS.length];
    const left = st.rand() < 0.5;
    const e = { id: ++st.seq, kind, x: left ? X0 + 4 : X1 - 4, floor: 0, y: FLOORS[0], state: 'walk', dir: left ? 1 : -1, ladder: null, stun: 0, alive: true, fall: null };
    st.enemies.push(e);
    emit(st, { t: 'enemy', kind });
    return e;
  }
  const chefFloorTarget = (st) => {
    const c = st.chef;
    if (c.state === 'climb') return c.ladder.top + (c.climbDir > 0 ? 1 : 0);        // 가는 방향의 층
    return c.floor;
  };
  function stepEnemy(st, e, h) {
    if (e.fall) return;                                  // 재료에 얹혀 떨어지는 중
    if (e.stun > 0) { e.stun = Math.max(0, e.stun - h); return; }
    const sp = ENEMY[e.kind].speed * speedMul(st.level) * (st.tutorial ? 0.6 : 1);
    const target = chefFloorTarget(st);
    if (e.state === 'climb') {
      const l = e.ladder, dirv = e.climbDir;
      e.y += dirv * sp * 0.85 * h;
      const topY = FLOORS[l.top], botY = FLOORS[l.top + 1];
      if (e.y <= topY) { e.y = topY; e.floor = l.top; e.state = 'walk'; e.ladder = null; }
      else if (e.y >= botY) { e.y = botY; e.floor = l.top + 1; e.state = 'walk'; e.ladder = null; }
      return;
    }
    // 걷는 중: 같은 층이면 요리사 쪽으로, 다른 층이면 알맞은 사다리 쪽으로
    let goalX;
    if (e.floor === target) goalX = st.chef.x;
    else {
      const next = e.floor + (target > e.floor ? 1 : -1);
      const lads = laddersBetween(Math.min(e.floor, next));
      let best = lads[0];
      for (const l of lads) if (Math.abs(l.x - e.x) < Math.abs(best.x - e.x)) best = l;
      goalX = best.x; e.goalLadder = best; e.goalDir = next > e.floor ? 1 : -1;
    }
    if (st.rand() < ENEMY[e.kind].wander * h * 3) e.dir = st.rand() < 0.5 ? -1 : 1;     // 가끔 엉뚱한 쪽으로
    else if (Math.abs(goalX - e.x) > 1) e.dir = goalX > e.x ? 1 : -1;
    e.x = Math.max(X0, Math.min(X1, e.x + e.dir * sp * h));
    if (e.floor !== target && e.goalLadder && Math.abs(e.x - e.goalLadder.x) < sp * h + 0.6) {
      e.x = e.goalLadder.x; e.state = 'climb'; e.ladder = e.goalLadder; e.climbDir = e.goalDir; e.goalLadder = null;
    }
  }

  // ---------- 재료 ----------
  function pieceSpan(p) { return [p.cx - HALF, p.cx + HALF]; }
  function startFall(st, p) {
    p.state = 'fall'; p.vy = 0;
    // 이 재료 위에 서 있던 적은 같이 떨어진다
    p.riders = st.enemies.filter((e) => e.alive && !e.fall && e.state === 'walk' && e.floor === p.floor && Math.abs(e.x - p.cx) <= HALF + 2);
    for (const e of p.riders) e.fall = p;
    st.stats.drops++; addScore(st, POINTS.drop);
    emit(st, { t: 'drop', col: p.col, kind: p.kind });
  }
  function pieceAt(st, col, floor) { return st.pieces.find((q) => q.col === col && q.state === 'rest' && q.floor === floor); }
  function landOnFloor(st, p, floor) {
    // 아래 층에 얹혀 있는 재료가 있으면 그것이 밀려 떨어진다
    const below = pieceAt(st, p.col, floor);
    p.state = 'rest'; p.floor = floor; p.y = FLOORS[floor]; p.pressed = new Array(SEG).fill(false); p.vy = 0;
    emit(st, { t: 'land', col: p.col, floor });
    crush(st, p, floor);
    if (below && below !== p) startFall(st, below);
  }
  function landOnPlate(st, p) {
    p.state = 'plated'; p.floor = -1; p.y = PLATE_Y - st.plate[p.col] * PIECE_H; st.plate[p.col]++;
    addScore(st, POINTS.plate);
    emit(st, { t: 'plate', col: p.col, count: st.plate[p.col] });
    crush(st, p, FLOORS.length - 1);
    if (st.plate[p.col] >= KINDS.length) { st.stats.burgers++; emit(st, { t: 'burger', col: p.col }); }
  }
  // 재료가 내려앉을 때 그 층에서 아래에 있는 적을 깔아뭉갠다. 같이 타고 내려온 적은 더 큰 점수
  function crush(st, p, floor) {
    let k = 0;
    for (const e of st.enemies) {
      if (!e.alive) continue;
      const rider = e.fall === p;
      const under = !rider && !e.fall && e.state === 'walk' && e.floor === floor && Math.abs(e.x - p.cx) <= HALF;
      if (!rider && !under) continue;
      e.alive = false; e.fall = null; k++; st.stats.crushed++;
      const pts = rider ? POINTS.ride : POINTS.crush * Math.pow(2, k - 1);
      addScore(st, pts);
      emit(st, { t: rider ? 'ride' : 'crush', x: e.x, y: e.y, pts, kind: e.kind });
      st.respawns.push(RESPAWN);
    }
    p.riders = [];
    st.enemies = st.enemies.filter((e) => e.alive);
  }
  function stepPiece(st, p, h) {
    if (p.state !== 'fall') return;
    p.y += FALL_SPEED * h;
    for (const e of p.riders) if (e.alive) e.y = p.y;
    // 다음 층(또는 접시)에 닿았나
    const nextFloor = p.floor + 1;
    if (nextFloor < FLOORS.length) {
      if (p.y >= FLOORS[nextFloor]) landOnFloor(st, p, nextFloor);
    } else {
      const stop = PLATE_Y - st.plate[p.col] * PIECE_H;
      if (p.y >= stop) landOnPlate(st, p);
    }
  }

  // ---------- 요리사 ----------
  function nearLadder(c, dir) {
    for (const l of LADDERS) {
      if (Math.abs(c.x - l.x) > 5) continue;
      if (dir < 0 && l.top + 1 === c.floor) return l;          // 위로: 이 층에서 위층으로 가는 사다리
      if (dir > 0 && l.top === c.floor) return l;              // 아래로: 이 층에서 아래층으로 가는 사다리
    }
    return null;
  }
  function pressPieces(st, c) {
    for (const p of st.pieces) {
      if (p.state !== 'rest' || p.floor !== c.floor || c.x < p.cx - HALF || c.x > p.cx + HALF) continue;
      const seg = Math.max(0, Math.min(SEG - 1, Math.floor((c.x - (p.cx - HALF)) / (2 * HALF / SEG))));
      if (!p.pressed[seg]) { p.pressed[seg] = true; emit(st, { t: 'press', col: p.col, seg }); }
      if (p.pressed.every(Boolean)) startFall(st, p);
    }
  }
  function throwPepper(st) {
    const c = st.chef;
    if (st.pepper <= 0 || c.pepperCool > 0 || !c.alive || c.state !== 'walk') return false;
    st.pepper--; c.pepperCool = PEPPER_COOL; st.stats.peppers++;
    emit(st, { t: 'pepper', x: c.x, face: c.face });
    const x0 = c.face > 0 ? c.x : c.x - PEPPER_RANGE, x1 = c.face > 0 ? c.x + PEPPER_RANGE : c.x;
    for (const e of st.enemies) {
      // 같은 높이 앞쪽 (사다리에 매달린 적도 맞는다)
      if (e.alive && !e.fall && Math.abs(e.y - c.y) < 10 && e.x >= x0 && e.x <= x1) { e.stun = STUN_TIME; emit(st, { t: 'stun', x: e.x, y: e.y, kind: e.kind }); }
    }
    return true;
  }

  function step(st, dt, input = {}) {
    const h = Math.min(dt, 0.05);
    st.events = [];
    if (st.phase === 'over') return;
    st.time += h;
    if (st.phase === 'dying') {
      st.dyingT -= h;
      if (st.dyingT <= 0) { if (st.lives <= 0) { st.phase = 'over'; emit(st, { t: 'over' }); } else { resetRound(st); emit(st, { t: 'respawn' }); } }
      return;
    }
    if (st.phase === 'clear') {
      st.clearT -= h;
      if (st.clearT <= 0) startLevel(st, st.level + 1);
      return;
    }
    const c = st.chef;
    if (c.invuln > 0) c.invuln = Math.max(0, c.invuln - h);
    if (c.pepperCool > 0) c.pepperCool = Math.max(0, c.pepperCool - h);
    const dx = Math.max(-1, Math.min(1, Number(input.dx) || 0)), dy = Math.max(-1, Math.min(1, Number(input.dy) || 0));
    // ---- 요리사 움직임 ----
    if (c.state === 'walk') {
      if (dy !== 0) {
        const l = nearLadder(c, dy);
        if (l) {
          c.state = 'climb'; c.ladder = l; c.x = l.x; c.climbDir = dy; emit(st, { t: 'climb' });
        }
      }
      if (c.state === 'walk') {
        if (dx) { c.face = dx; c.x = Math.max(X0, Math.min(X1, c.x + dx * CHEF.speed * h)); if (!c.moved) { c.moved = true; emit(st, { t: 'move' }); } }
        pressPieces(st, c);
        if (input.pepper) throwPepper(st);
      }
    } else if (c.state === 'climb') {
      const l = c.ladder, topY = FLOORS[l.top], botY = FLOORS[l.top + 1];
      if (dy !== 0) c.climbDir = dy;
      c.y = Math.max(topY, Math.min(botY, c.y + dy * CHEF.climb * h));
      if (c.y <= topY && dy < 0) { c.floor = l.top; c.y = topY; c.state = 'walk'; c.ladder = null; }
      else if (c.y >= botY && dy > 0) { c.floor = l.top + 1; c.y = botY; c.state = 'walk'; c.ladder = null; }
    }
    // ---- 재료 ----
    for (const p of st.pieces) stepPiece(st, p, h);
    // ---- 적 ----
    st.respawns = st.respawns.map((t) => t - h);
    while (st.respawns.length && st.respawns[0] <= 0 && st.enemies.length < (st.tutorial ? 1 : enemyCount(st.level))) { st.respawns.shift(); spawnEnemy(st); }
    for (let i = st.respawns.length - 1; i >= 0; i--) if (st.respawns[i] <= 0 && st.enemies.length >= (st.tutorial ? 1 : enemyCount(st.level))) st.respawns[i] = 0.5;
    for (const e of st.enemies) stepEnemy(st, e, h);
    // ---- 아이템 (후추) ----
    if (!st.tutorial) {
      if (st.item) { st.item.t += h; if (st.item.t >= ITEM_LIFE) st.item = null; }
      else { st.itemT -= h; if (st.itemT <= 0) { const f = Math.floor(st.rand() * FLOORS.length), lad = LADDERS[Math.floor(st.rand() * LADDERS.length)]; st.item = { floor: f, x: lad.x, t: 0 }; st.itemT = ITEM_EVERY; } }
      if (st.item && c.state === 'walk' && c.floor === st.item.floor && Math.abs(c.x - st.item.x) < 8) { st.item = null; st.pepper++; addScore(st, POINTS.item); emit(st, { t: 'item' }); }
    }
    // ---- 적과 요리사 ----
    if (c.alive && c.invuln <= 0) {
      for (const e of st.enemies) {
        if (e.stun > 0 || !e.alive) continue;
        if (Math.abs(e.x - c.x) < 7 && Math.abs(e.y - c.y) < 9) return die(st, e.kind);
      }
    }
    // ---- 한 판 클리어 ----
    if (st.phase === 'play' && st.plate.every((n) => n >= KINDS.length)) {
      st.phase = 'clear'; st.clearT = CLEAR_TIME;
      addScore(st, POINTS.clear);
      emit(st, { t: 'clear', level: st.level });
    }
  }

  return {
    W, H, FLOORS, X0, X1, PLATE_Y, COLS, HALF, SEG, PIECE_H, KINDS, LADDERS, CHEF, START_LIVES, DYING, CLEAR_TIME, FALL_SPEED, PEPPER_START, PEPPER_RANGE, STUN_TIME, POINTS, EXTRA_LIFE_AT, EXTRA_LIFE_EVERY, ENEMY_KINDS, ENEMY, RESPAWN,
    rng, enemyCount, speedMul, laddersBetween, newGame, startLevel, resetRound, step, spawnEnemy, throwPepper, nearLadder, die, addScore, startFall, pieceAt, pieceSpan,
  };
})();
if (typeof module !== 'undefined') module.exports = LOGIC_BT;
