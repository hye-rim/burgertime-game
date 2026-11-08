'use strict';

// 버거타임 규칙 시험. 실행: node --test (디렉터리)
const test = require('node:test');
const assert = require('node:assert');
const L = require('../logic.js');

const run = (st, secs, input = {}) => { for (let i = 0; i < Math.round(secs / 0.01); i++) L.step(st, 0.01, input); };
const evs = (st, t) => st.events.filter((e) => e.t === t);
// 적이 안 나오고 후추도 넉넉한 조용한 판
function calm() {
  const st = L.newGame(L.rng(1));
  st.respawns = []; st.itemT = 1e9; st.chef.invuln = 0;
  return st;
}
const put = (st, floor, x) => { st.chef.floor = floor; st.chef.x = x; st.chef.y = L.FLOORS[floor]; st.chef.state = 'walk'; st.chef.ladder = null; };
const piece = (st, col, floor) => st.pieces.find((p) => p.col === col && p.floor === floor);
// 그 줄 재료 위를 왼쪽 끝에서 오른쪽 끝까지 걸어 모두 밟는다
function walkOver(st, col, floor) {
  const cx = L.COLS[col];
  put(st, floor, cx - L.HALF);
  run(st, 1.2, { dx: 1 });
}
const addEnemy = (st, floor, x, kind = 'dog') => { const e = L.spawnEnemy(st); e.floor = floor; e.y = L.FLOORS[floor]; e.x = x; e.kind = kind; e.state = 'walk'; return e; };

test('the layout: five floors, ladders between neighbors in the gaps, four non-overlapping burger columns', () => {
  assert.strictEqual(L.FLOORS.length, 5);
  for (let i = 1; i < 5; i++) assert.ok(L.FLOORS[i] > L.FLOORS[i - 1], 'floors go down');
  assert.ok(L.PLATE_Y > L.FLOORS[4] + L.KINDS.length * L.PIECE_H, 'the plate has room for a full stack under the bottom floor');
  for (let top = 0; top < 4; top++) assert.ok(L.laddersBetween(top).length >= 2, `two ways between floors ${top} and ${top + 1}`);
  for (const l of L.LADDERS) {
    assert.ok(l.top >= 0 && l.top <= 3 && l.x >= L.X0 && l.x <= L.X1);
    for (const cx of L.COLS) assert.ok(Math.abs(l.x - cx) > L.HALF + 2, `ladder ${l.x} does not stand on a burger`);
  }
  for (let i = 1; i < L.COLS.length; i++) assert.ok(L.COLS[i] - L.COLS[i - 1] >= 2 * L.HALF + 4, 'columns do not overlap');
  const st = L.newGame(L.rng(1));
  assert.strictEqual(st.pieces.length, 16);
  for (const p of st.pieces) { assert.strictEqual(p.state, 'rest'); assert.strictEqual(p.y, L.FLOORS[p.floor]); }
  for (let col = 0; col < 4; col++) assert.deepStrictEqual(st.pieces.filter((p) => p.col === col).map((p) => p.kind), L.KINDS, 'bun on top, bottom bun lowest');
});

test('the chef walks along a floor, stops at both ends and garbage input does nothing', () => {
  const st = calm(); put(st, 4, 100);
  run(st, 1, { dx: 1 });
  assert.ok(st.chef.x > 100);
  run(st, 10, { dx: 1 });
  assert.strictEqual(st.chef.x, L.X1);
  run(st, 10, { dx: -1 });
  assert.strictEqual(st.chef.x, L.X0);
  const before = st.chef.x;
  L.step(st, 0.1, { dx: 'x', dy: null });
  assert.strictEqual(st.chef.x, before);
});

test('the first step is announced once', () => {
  const st = calm();
  L.step(st, 0.1, { dx: 1 });
  assert.strictEqual(evs(st, 'move').length, 1);
  L.step(st, 0.1, { dx: 1 });
  assert.strictEqual(evs(st, 'move').length, 0);
});

test('ladders: up and down near a ladder, nothing far from one, and the right floors', () => {
  const st = calm(); put(st, 4, 100);
  L.step(st, 0.05, { dy: -1 });
  assert.strictEqual(st.chef.state, 'walk', 'no ladder at x=100 between floors 3 and 4');
  const l = L.LADDERS.find((q) => q.top === 3 && q.x === 112);
  put(st, 4, l.x + 2);
  L.step(st, 0.01, { dy: -1 });
  assert.strictEqual(st.chef.state, 'climb');
  assert.strictEqual(st.chef.x, l.x);
  assert.strictEqual(evs(st, 'climb').length, 1);
  run(st, 2, { dy: -1 });
  assert.deepStrictEqual([st.chef.floor, st.chef.state], [3, 'walk']);
  assert.strictEqual(st.chef.y, L.FLOORS[3]);
  L.step(st, 0.01, { dy: 1 });
  assert.strictEqual(st.chef.state, 'climb', 'back down from the top end');
  run(st, 2, { dy: 1 });
  assert.strictEqual(st.chef.floor, 4);
  put(st, 3, 112); L.step(st, 0.01, { dy: -1 });
  assert.strictEqual(st.chef.state, 'walk', 'the ladder above floor 3 is elsewhere');
});

test('walking over a burger piece presses it segment by segment and the fourth drops it one floor', () => {
  const st = calm();
  const p = piece(st, 0, 0);
  put(st, 0, L.COLS[0] - L.HALF + 1);
  run(st, 0.1, { dx: 1 });
  assert.ok(p.pressed[0] && !p.pressed[3], 'only the first segments so far');
  put(st, 0, L.COLS[0] - L.HALF);
  const drops = [];
  for (let i = 0; i < 150; i++) { L.step(st, 0.01, { dx: 1 }); drops.push(...evs(st, 'drop')); }
  assert.ok(drops.length >= 1, 'dropped');
  assert.ok(st.stats.drops >= 1);
  assert.ok(st.score >= L.POINTS.drop);
});

test('a dropped piece lands on the next floor, the piece resting there is knocked down in turn', () => {
  const st = calm();
  walkOver(st, 0, 0);
  run(st, 1);
  // 맨 위 빵은 1층으로, 그 자리의 양상추는 밀려서 2층으로, 패티는 3층으로, 아래 빵은 4층으로
  assert.deepStrictEqual(['bun', 'lettuce', 'patty', 'bottom'].map((k) => st.pieces.find((p) => p.col === 0 && p.kind === k).floor), [1, 2, 3, 4]);
  assert.ok(st.pieces.filter((p) => p.col === 0).every((p) => p.state === 'rest'));
  for (const p of st.pieces.filter((q) => q.col === 0)) assert.strictEqual(p.y, L.FLOORS[p.floor]);
  assert.ok(st.pieces.filter((p) => p.col === 0).every((p) => p.pressed.every((v) => !v)), 'pressed marks are cleared after landing');
});

test('a piece on the bottom floor falls on the plate, stacks up, and four make a burger', () => {
  const st = calm();
  // 줄 0 을 맨 아래 층까지 이미 내려 놓은 상태로 만든다
  walkOver(st, 0, 0); run(st, 1);
  const platedBefore = st.plate[0];
  assert.strictEqual(platedBefore, 0);
  // 맨 아래 층(4층)의 아래 빵을 밟아 접시로
  const bottom = piece(st, 0, 4);
  assert.strictEqual(bottom.kind, 'bottom');
  walkOver(st, 0, 4); run(st, 1);
  assert.strictEqual(st.plate[0], 1);
  assert.strictEqual(bottom.state, 'plated');
  assert.strictEqual(bottom.y, L.PLATE_Y - 0 * L.PIECE_H);
  for (const kind of ['patty', 'lettuce', 'bun']) {
    const q = st.pieces.find((p) => p.col === 0 && p.kind === kind);
    walkOver(st, 0, q.floor); run(st, 1);
    while (q.floor !== 4 && q.state === 'rest') { walkOver(st, 0, q.floor); run(st, 1); }
    if (q.floor === 4) { walkOver(st, 0, 4); run(st, 1); }
  }
  assert.strictEqual(st.plate[0], 4, 'complete burger');
  assert.strictEqual(st.stats.burgers, 1);
  const ys = st.pieces.filter((p) => p.col === 0).map((p) => p.y).sort((a, b) => b - a);
  assert.deepStrictEqual(ys, [0, 1, 2, 3].map((i) => L.PLATE_Y - i * L.PIECE_H), 'stacked one above the other');
  assert.deepStrictEqual(st.pieces.filter((p) => p.col === 0).sort((a, b) => b.y - a.y).map((p) => p.kind), ['bottom', 'patty', 'lettuce', 'bun'], 'in the right order');
});

test('finishing all four burgers clears the level and starts the next one', () => {
  const st = calm();
  st.plate = [4, 4, 4, 3];
  const last = piece(st, 3, 0); last.floor = 4; last.y = L.FLOORS[4];
  for (const p of st.pieces.filter((q) => q.col === 3 && q !== last)) { p.state = 'plated'; p.floor = -1; }
  walkOver(st, 3, 4);
  run(st, 1);
  assert.strictEqual(st.phase, 'clear');
  assert.ok(st.score >= L.POINTS.clear);
  run(st, L.CLEAR_TIME + 0.2);
  assert.strictEqual(st.level, 2);
  assert.strictEqual(st.phase, 'play');
  assert.strictEqual(st.pieces.length, 16);
  assert.ok(st.pieces.every((p) => p.state === 'rest'), 'a fresh set of burgers');
});

test('pepper stuns enemies in front on the same floor, costs one, and stunned enemies are harmless', () => {
  const st = calm(); put(st, 2, 100); st.chef.face = 1;
  const near = addEnemy(st, 2, 120), behind = addEnemy(st, 2, 80), far = addEnemy(st, 2, 200), other = addEnemy(st, 1, 110);
  const p0 = st.pepper;
  assert.ok(L.throwPepper(st));
  assert.strictEqual(st.pepper, p0 - 1);
  assert.ok(near.stun > 0, 'in front and close');
  assert.strictEqual(behind.stun, 0, 'behind');
  assert.strictEqual(far.stun, 0, 'too far');
  assert.strictEqual(other.stun, 0, 'another floor');
  assert.strictEqual(evs(st, 'stun').length, 1);
  near.x = st.chef.x; st.chef.invuln = 0;
  L.step(st, 0.01, {});
  assert.strictEqual(st.phase, 'play', 'a stunned enemy does not hurt');
});

test('pepper also stuns an enemy hanging on a ladder at the chef height, not one far above or below', () => {
  const st = calm(); put(st, 2, 100); st.chef.face = 1;
  const l = L.LADDERS.find((q) => q.top === 2);
  const climber = addEnemy(st, 2, 110); climber.state = 'climb'; climber.ladder = l; climber.climbDir = 1; climber.y = L.FLOORS[2] + 2;
  const far = addEnemy(st, 2, 112); far.state = 'climb'; far.ladder = l; far.climbDir = 1; far.y = L.FLOORS[2] + 25;
  L.throwPepper(st);
  assert.ok(climber.stun > 0);
  assert.strictEqual(far.stun, 0);
});

test('pepper: not without any left, not while cooling down, and the stun wears off', () => {
  const st = calm(); put(st, 2, 100); st.pepper = 0;
  assert.ok(!L.throwPepper(st));
  st.pepper = 3;
  assert.ok(L.throwPepper(st));
  assert.ok(!L.throwPepper(st), 'cooling down');
  run(st, 0.5);
  assert.ok(L.throwPepper(st));
  const e = addEnemy(st, 2, 110); st.chef.pepperCool = 0; L.throwPepper(st);
  assert.ok(e.stun > 0);
  run(st, L.STUN_TIME + 0.2);
  assert.strictEqual(e.stun, 0);
});

test('an enemy on another floor walks to a ladder, climbs it and ends up on the chef floor', () => {
  let reached = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const st = L.newGame(L.rng(seed)); st.respawns = []; st.itemT = 1e9; st.chef.invuln = 1e9;
    put(st, 4, 112);
    const e = addEnemy(st, 0, 20, 'dog');
    for (let i = 0; i < 60 * 40 && e.floor !== 4; i++) L.step(st, 1 / 60, {});
    if (e.floor === 4) reached++;
  }
  assert.ok(reached >= 11, `reached the chef's floor ${reached}/12`);
});

test('an enemy on the chef floor walks straight toward the chef', () => {
  const st = calm(); st.chef.invuln = 1e9; put(st, 3, 40);
  const e = addEnemy(st, 3, 180, 'dog');
  const d0 = Math.abs(e.x - st.chef.x);
  run(st, 2);
  assert.ok(Math.abs(e.x - st.chef.x) < d0 - 30, 'it comes closer');
});

test('touching an enemy costs a life and puts the chef and the enemies back, keeping the burgers', () => {
  const st = calm(); st.score = 300;
  walkOver(st, 0, 0); run(st, 1);
  const floors = st.pieces.map((p) => p.floor + ':' + p.state);
  put(st, 2, 100); const e = addEnemy(st, 2, 103);
  L.step(st, 0.01, {});
  assert.strictEqual(st.phase, 'dying');
  assert.strictEqual(st.lives, L.START_LIVES - 1);
  assert.ok(evs(st, 'dead').length === 1 && e);
  run(st, L.DYING + 0.1);
  assert.strictEqual(st.phase, 'play');
  assert.deepStrictEqual([st.chef.floor, st.chef.x], [L.CHEF.start.floor, L.CHEF.start.x]);
  assert.strictEqual(st.enemies.length, 0, 'enemies start over');
  assert.deepStrictEqual(st.pieces.map((p) => p.floor + ':' + p.state), floors, 'the burgers stay as they were');
  assert.ok(st.score >= 300);
  assert.ok(st.chef.invuln > 0);
});

test('a piece landing on a floor squashes an enemy standing there, a rider gets more points', () => {
  const st = calm();
  const bun = piece(st, 1, 0);
  const victim = addEnemy(st, 1, L.COLS[1] + 5);                       // 1층에 서 있는 적
  const s0 = st.score;
  L.startFall(st, bun);
  run(st, 1);
  assert.ok(!st.enemies.includes(victim), 'squashed');
  assert.ok(st.score >= s0 + L.POINTS.drop + L.POINTS.crush);
  assert.strictEqual(st.stats.crushed, 1);
  assert.strictEqual(st.respawns.length, 1, 'a new enemy will come');
  const st2 = calm();
  const rider = addEnemy(st2, 0, L.COLS[2]);                           // 재료가 놓인 층에 서 있다가 같이 떨어진다
  const top = piece(st2, 2, 0);
  L.startFall(st2, top);
  assert.strictEqual(rider.fall, top);
  run(st2, 1);
  assert.ok(!st2.enemies.includes(rider));
  assert.ok(st2.score >= L.POINTS.drop + L.POINTS.ride, 'a rider is worth more than a plain squash');
});

test('squashing several enemies at once doubles the points each time', () => {
  const st = calm();
  const p = piece(st, 0, 0);
  addEnemy(st, 1, L.COLS[0] - 8); addEnemy(st, 1, L.COLS[0]); addEnemy(st, 1, L.COLS[0] + 8);
  const pts = [];
  L.startFall(st, p);
  for (let i = 0; i < 100; i++) { L.step(st, 0.01, {}); for (const e of evs(st, 'crush')) pts.push(e.pts); }
  assert.strictEqual(st.stats.crushed, 3);
  assert.deepStrictEqual(pts, [L.POINTS.crush, L.POINTS.crush * 2, L.POINTS.crush * 4], 'each one is worth double the one before');
});

test('enemies come back after a while but never more than the level allows', () => {
  const st = L.newGame(L.rng(5)); st.itemT = 1e9; st.chef.invuln = 1e9;
  run(st, 12);
  assert.strictEqual(st.enemies.length, L.enemyCount(1));
  assert.ok(L.enemyCount(2) >= L.enemyCount(1));
  assert.strictEqual(L.enemyCount(99), 5);
  for (const e of st.enemies.slice()) { e.alive = false; st.respawns.push(L.RESPAWN); }
  st.enemies = st.enemies.filter((e) => e.alive);
  run(st, L.RESPAWN + 1);
  assert.ok(st.enemies.length >= 1, 'they came back');
  run(st, 20);
  assert.ok(st.enemies.length <= L.enemyCount(1));
});

test('later levels make enemies faster, within a cap', () => {
  assert.ok(L.speedMul(2) > L.speedMul(1));
  assert.ok(L.speedMul(99) <= 1.5);
  for (let l = 2; l < 20; l++) assert.ok(L.speedMul(l) >= L.speedMul(l - 1));
});

test('a pepper pickup appears now and then on a floor and gives one more shake and points', () => {
  const st = L.newGame(L.rng(2)); st.respawns = []; st.chef.invuln = 1e9;
  st.itemT = 0.01; run(st, 0.1);
  assert.ok(st.item, 'an item appeared');
  put(st, st.item.floor, st.item.x);
  const p0 = st.pepper, s0 = st.score;
  L.step(st, 0.01, {});
  assert.strictEqual(st.pepper, p0 + 1);
  assert.strictEqual(st.score, s0 + L.POINTS.item);
  assert.strictEqual(st.item, null);
  const st2 = L.newGame(L.rng(3)); st2.respawns = []; st2.chef.invuln = 1e9; st2.itemT = 0.01; run(st2, 0.1);
  run(st2, 12);
  assert.strictEqual(st2.item, null, 'it disappears if left alone');
});

test('no lives left ends the game and nothing changes afterwards', () => {
  const st = calm(); st.lives = 1;
  L.die(st, 'dog');
  run(st, L.DYING + 0.2);
  assert.strictEqual(st.phase, 'over');
  const score = st.score;
  run(st, 1, { dx: 1 });
  assert.strictEqual(st.score, score);
});

test('an extra life comes at the first score and then every so often', () => {
  const st = calm();
  L.addScore(st, L.EXTRA_LIFE_AT - 1);
  assert.strictEqual(st.lives, L.START_LIVES);
  L.addScore(st, 1);
  assert.strictEqual(st.lives, L.START_LIVES + 1);
  L.addScore(st, L.EXTRA_LIFE_EVERY - 1);
  assert.strictEqual(st.lives, L.START_LIVES + 1);
  L.addScore(st, 1);
  assert.strictEqual(st.lives, L.START_LIVES + 2);
});

test('the practice mode has one slow enemy, plenty of pepper and lives', () => {
  const st = L.newGame(L.rng(1), 1, { tutorial: true, lives: 9 });
  assert.strictEqual(st.lives, 9);
  assert.ok(st.pepper >= 9);
  assert.deepStrictEqual([st.chef.floor, st.chef.x], [0, 12], 'starts on the top floor next to the first bun');
  st.chef.invuln = 1e9;
  run(st, 6);
  assert.strictEqual(st.enemies.length, 1);
});

test('random play never breaks the rules (fuzz)', () => {
  for (let seed = 1; seed <= 25; seed++) {
    const r = L.rng(seed), st = L.newGame(L.rng(seed * 13), 1 + (seed % 5));
    let dx = 0, dy = 0;
    for (let i = 0; i < 5000 && st.phase !== 'over'; i++) {
      if (i % 12 === 0) { dx = Math.floor(r() * 3) - 1; dy = r() < 0.3 ? Math.floor(r() * 3) - 1 : 0; }
      L.step(st, 0.02, { dx, dy, pepper: r() < 0.03 });
      assert.ok(st.lives >= 0 && st.score >= 0 && st.pepper >= 0);
      assert.ok(Number.isFinite(st.chef.x) && Number.isFinite(st.chef.y));
      assert.ok(st.chef.x >= L.X0 && st.chef.x <= L.X1 && st.chef.y >= L.FLOORS[0] && st.chef.y <= L.FLOORS[4]);
      assert.ok(st.enemies.length <= 5);
      for (const e of st.enemies) assert.ok(Number.isFinite(e.x) && e.x >= L.X0 - 1 && e.x <= L.X1 + 1 && e.y >= L.FLOORS[0] - 1 && e.y <= L.PLATE_Y, `enemy in range ${e.x},${e.y}`);
      for (const p of st.pieces) assert.ok(Number.isFinite(p.y) && p.y <= L.PLATE_Y + 1);
      for (let col = 0; col < 4; col++) assert.ok(st.plate[col] <= 4);
    }
  }
});
