'use strict';
// 오락실 튜토리얼이 '진짜로 일어난 일'을 알아채는 신호 (튜토리얼이 아니면 아무도 안 듣는다)
const tutorialSignal = (type) => window.dispatchEvent(new CustomEvent('arcade:tutorial', { detail: { type } }));

// 버거타임: 화면·입력·소리. 규칙은 logic.js (LOGIC_BT). 여기서는 st.events 를 보고 소리·효과를 만든다.
const L = LOGIC_BT;
const { W, H } = L;
const HUD = 18, CH = HUD + H;                                  // 캔버스 논리 크기 224 x 266
const TUTORIAL = /[?&]tutorial=1/.test(location.search);

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const $ = (id) => document.getElementById(id);

function fit() {
  const controls = $('controls');
  const ctrlH = getComputedStyle(controls).display === 'none' ? 0 : controls.offsetHeight + 10;
  const scale = Math.min((innerWidth - 16) / W, (innerHeight - 16 - ctrlH) / CH);
  const cssW = Math.max(150, Math.floor(W * scale)), cssH = Math.floor(cssW * CH / W);
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.style.width = cssW + 'px'; canvas.style.height = cssH + 'px';
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  ctx.setTransform(canvas.width / W, 0, 0, canvas.height / CH, 0, 0);
}
addEventListener('resize', fit);

const store = {
  get(k) { try { return localStorage.getItem(k); } catch (_) { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

// ---------- 소리 ----------
let audio = null;
let muted = store.get('btMuted') === '1';
function tone(freq, dur, type = 'square', vol = 0.045, slide = 0) {
  if (muted) return;
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    const t = audio.currentTime;
    const o = audio.createOscillator(), g = audio.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(40, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(audio.destination);
    o.start(t); o.stop(t + dur);
  } catch (_) {}
}
const melody = (notes, step, type = 'square', vol = 0.05) => notes.forEach((f, i) => { if (f) setTimeout(() => tone(f, step * 0.9 / 1000, type, vol), i * step); });
const sfx = {
  press: () => tone(520, 0.04, 'triangle', 0.03),
  drop: () => tone(260, 0.12, 'sawtooth', 0.05, -120),
  land: () => tone(150, 0.07, 'triangle', 0.05),
  plate: () => melody([784, 1047], 70, 'sine', 0.07),
  burger: () => melody([523, 659, 784, 1047, 1319], 80, 'sine', 0.07),
  pepper: () => tone(1200, 0.14, 'sawtooth', 0.02, -700),
  stun: () => melody([660, 520, 660], 60, 'triangle', 0.05),
  crush: () => { tone(180, 0.18, 'sawtooth', 0.06, -90); setTimeout(() => tone(880, 0.08, 'sine', 0.05), 50); },
  climb: () => tone(300, 0.04, 'square', 0.03),
  item: () => melody([784, 988, 1319], 60, 'sine', 0.06),
  dead: () => melody([523, 466, 392, 330, 262, 196], 110, 'square', 0.05),
  clear: () => melody([523, 659, 784, 1047, 784, 1047, 1319, 1568], 90),
  extra: () => melody([659, 784, 1047, 1319], 90, 'sine', 0.07),
  over: () => melody([392, 330, 262, 196], 220, 'sawtooth', 0.06),
};

// ---------- 상태 ----------
let G = null;
let state = 'title';                           // title · play · paused · over
let best = Number(store.get('btBest')) || 0;
let fxs = [];
let banner = { text: '', sub: '', t: 0, color: '#ffd23a' };
let climbSnd = 0, clock = 0;
let pepperReq = 0;

/* @test-hooks:start */
window.__bt = { get G() { return G; }, get state() { return state; }, L, setG(g) { G = g; }, step: (dt) => update(dt), start: () => startGame() };
/* @test-hooks:end */

// ---------- 입력 ----------
const keys = new Set();
const pad = { left: false, right: false, up: false, down: false };
const K = { left: ['ArrowLeft', 'a', 'A'], right: ['ArrowRight', 'd', 'D'], up: ['ArrowUp', 'w', 'W'], down: ['ArrowDown', 's', 'S'] };
const PEPPER = [' ', 'z', 'Z', 'x', 'X'];
const heldAny = (list) => list.some((k) => keys.has(k));
addEventListener('keydown', (e) => {
  if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') { if (state === 'play') pause(); else if (state === 'paused') resume(); return; }
  if (e.key === 'm' || e.key === 'M') { toggleMute(); return; }
  const mine = Object.values(K).some((l) => l.includes(e.key)) || PEPPER.includes(e.key);
  if (mine) e.preventDefault();
  if ((e.key === ' ' || e.key === 'Enter') && (state === 'title' || state === 'over') && !e.repeat) { startGame(); return; }
  if (PEPPER.includes(e.key) && !e.repeat) pepperReq = 0.14;
  keys.add(e.key);
});
addEventListener('keyup', (e) => { keys.delete(e.key); });
addEventListener('blur', () => { keys.clear(); pad.left = pad.right = pad.up = pad.down = false; for (const b of document.querySelectorAll('#controls button')) b.classList.remove('on'); });

function bindHold(el, on, off) {
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); try { el.setPointerCapture(e.pointerId); } catch (_) {} el.classList.add('on'); on(); });
  const up = () => { el.classList.remove('on'); off(); };
  el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
}
for (const b of document.querySelectorAll('#dpad button')) { const k = b.dataset.k; bindHold(b, () => { pad[k] = true; }, () => { pad[k] = false; }); }
bindHold($('pepperBt'), () => { pepperReq = 0.14; }, () => {});
const readInput = () => {
  const dx = (heldAny(K.right) || pad.right ? 1 : 0) - (heldAny(K.left) || pad.left ? 1 : 0);
  const dy = (heldAny(K.down) || pad.down ? 1 : 0) - (heldAny(K.up) || pad.up ? 1 : 0);
  return { dx, dy, pepper: pepperReq > 0 };
};

// ---------- 흐름 ----------
function startGame() {
  G = L.newGame(Math.random, 1, TUTORIAL ? { tutorial: true, lives: 9 } : {});
  fxs = []; banner.t = 0; pepperReq = 0;
  state = 'play';
  $('overlay').classList.add('hidden');
  showBanner(TUTORIAL ? '연습' : `STAGE ${G.level}`, TUTORIAL ? '재료를 밟고, 사다리를 타고, 후추를 뿌려 보세요' : '', 1.6);
  sfx.land();
}
function pause() {
  if (state !== 'play') return;
  state = 'paused';
  showOverlay('<h2>일시정지</h2><button data-act="resume">계속하기</button>');
}
function resume() { if (state === 'paused') { state = 'play'; hideOverlay(); } }
function showOverlay(html) { $('overlay').innerHTML = html; $('overlay').classList.remove('hidden'); }
function hideOverlay() { $('overlay').classList.add('hidden'); }
function showBanner(text, sub = '', t = 1.3, color = '#ffd23a') { banner = { text, sub, t, color }; }
function gameOver() {
  state = 'over';
  const record = !TUTORIAL && G.score > best;
  if (record) { best = G.score; store.set('btBest', String(best)); }
  showOverlay(`
    <h2>게임 끝!</h2>
    <div class="big">${G.score.toLocaleString('ko-KR')}</div>
    ${record ? '<p><b>🎉 최고 기록!</b></p>' : ''}
    <p>${G.level}판까지 갔어요 · 햄버거 ${G.stats.burgers}개 완성 · 적을 ${G.stats.crushed}번 깔았어요<br>최고 점수 ${best.toLocaleString('ko-KR')}점</p>
    <button data-act="again">다시 하기</button>`);
}
$('overlay').addEventListener('click', (e) => {
  const b = e.target.closest('button');
  if (!b) return;
  b.blur();
  if (b.id === 'startBtn' || b.dataset.act === 'again') startGame();
  else if (b.dataset.act === 'resume') resume();
});

// ---------- 갱신 ----------
function update(dt) {
  clock += dt;
  if (banner.t > 0) banner.t -= dt;
  for (const f of fxs) f.t += dt;
  fxs = fxs.filter((f) => f.t < f.life);
  if (state !== 'play' || !G) return;
  const inp = readInput();
  L.step(G, dt, inp);
  if (pepperReq > 0) pepperReq = Math.max(0, pepperReq - dt);
  for (const e of G.events) handle(e);
  if (G.chef.state === 'climb' && inp.dy !== 0) { climbSnd -= dt; if (climbSnd <= 0) { sfx.climb(); climbSnd = 0.16; } }
}
function handle(e) {
  if (e.t === 'move') tutorialSignal('move');
  else if (e.t === 'press') { sfx.press(); tutorialSignal('press'); }
  else if (e.t === 'drop') { sfx.drop(); tutorialSignal('drop'); }
  else if (e.t === 'land') sfx.land();
  else if (e.t === 'plate') { sfx.plate(); fxs.push({ kind: 'text', x: L.COLS[e.col], y: L.PLATE_Y - 10, t: 0, life: 0.9, text: `+${L.POINTS.plate}`, color: '#ffd23a' }); tutorialSignal('plate'); }
  else if (e.t === 'burger') { sfx.burger(); showBanner('햄버거 완성!', '', 1.2, '#7dff7d'); }
  else if (e.t === 'climb') tutorialSignal('climb');
  else if (e.t === 'pepper') { sfx.pepper(); tutorialSignal('pepper'); for (let i = 0; i < 8; i++) fxs.push({ kind: 'puff', x: e.x + e.face * (6 + i * 3), y: G.chef.y - 8, t: 0, life: 0.45, vx: e.face * 20, vy: (Math.random() - 0.5) * 20 }); }
  else if (e.t === 'stun') { sfx.stun(); tutorialSignal('stun'); }
  else if (e.t === 'crush' || e.t === 'ride') { sfx.crush(); fxs.push({ kind: 'text', x: e.x, y: e.y - 10, t: 0, life: 1, text: String(e.pts), color: '#ff7a45' }); tutorialSignal('crush'); }
  else if (e.t === 'item') { sfx.item(); showBanner('후추 +1', '', 1, '#ffd23a'); }
  else if (e.t === 'dead') { sfx.dead(); showBanner('앗!', '', 1.3, '#ff6a6a'); }
  else if (e.t === 'respawn') showBanner(TUTORIAL ? '연습' : `STAGE ${G.level}`, '다시 도전!', 1.2);
  else if (e.t === 'level' && G.time > 0.5) { showBanner(`STAGE ${e.level}`, '적이 더 빨라져요', 1.5); sfx.land(); }
  else if (e.t === 'clear') { sfx.clear(); tutorialSignal('clear'); showBanner('클리어!', `+${L.POINTS.clear}`, 2, '#7dff7d'); }
  else if (e.t === 'extra') { sfx.extra(); showBanner('목숨 +1', '', 1.2, '#ff9bd0'); }
  else if (e.t === 'over') { sfx.over(); setTimeout(gameOver, 500); }
}

// ---------- 그리기 ----------
const R = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(Math.round(x), Math.round(y + HUD), w, h); };
function drawFloor(y) {
  R(L.X0 - 2, y, L.X1 - L.X0 + 4, 4, '#4a63d6'); R(L.X0 - 2, y, L.X1 - L.X0 + 4, 1, '#8aa0ff'); R(L.X0 - 2, y + 3, L.X1 - L.X0 + 4, 1, '#2a3a96');
}
function drawLadder(l) {
  const top = L.FLOORS[l.top] + 4, bot = L.FLOORS[l.top + 1];
  ctx.strokeStyle = '#c8c8d8'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(l.x - 4, HUD + top); ctx.lineTo(l.x - 4, HUD + bot); ctx.moveTo(l.x + 4, HUD + top); ctx.lineTo(l.x + 4, HUD + bot); ctx.stroke();
  ctx.lineWidth = 1;
  for (let y = top + 3; y < bot; y += 5) { ctx.beginPath(); ctx.moveTo(l.x - 4, HUD + y); ctx.lineTo(l.x + 4, HUD + y); ctx.stroke(); }
}
const PIECE_COLOR = { bun: '#e2a24a', lettuce: '#4ad04a', patty: '#7a3a14', bottom: '#d89a42' };
function drawPiece(p) {
  const x0 = p.cx - L.HALF, y = p.y;
  for (let s = 0; s < L.SEG; s++) {
    const sx = x0 + s * (2 * L.HALF / L.SEG), dy = p.pressed[s] && p.state === 'rest' ? 1.5 : 0, w = 2 * L.HALF / L.SEG;
    if (p.kind === 'bun') { R(sx, y - 3 + dy, w, 4, '#e8b058'); R(sx, y + 1 + dy, w, 5, PIECE_COLOR.bun); if (s % 2 === 0) R(sx + 3, y - 2 + dy, 2, 1, '#fff2c8'); }
    else if (p.kind === 'lettuce') { R(sx, y + dy, w, 5, PIECE_COLOR.lettuce); R(sx, y + 4 + dy, w, 2, (s % 2) ? '#2a9a2a' : '#6ae06a'); }
    else if (p.kind === 'patty') { R(sx, y + dy, w, 6, PIECE_COLOR.patty); R(sx, y + dy, w, 1, '#a86a34'); }
    else { R(sx, y + dy, w, 6, PIECE_COLOR.bottom); R(sx, y + 5 + dy, w, 1, '#a8742a'); }
  }
}
function drawPlate(cx) { R(cx - 25, L.PLATE_Y + L.PIECE_H, 50, 3, '#d8d8e8'); R(cx - 21, L.PLATE_Y + L.PIECE_H + 3, 42, 2, '#9a9ab0'); }
function drawChef() {
  const c = G.chef;
  if (c.invuln > 0 && c.alive && Math.floor(c.invuln * 12) % 2) return;
  const x = c.x, y = c.y, step = Math.floor(clock * 10) % 2;
  if (c.state === 'dead') { R(x - 5, y - 4, 10, 4, '#fff'); R(x - 3, y - 8, 6, 4, '#ffd7a8'); return; }
  const f = c.face;
  if (c.state === 'climb') {
    const sw = Math.floor(c.y / 4) % 2;
    R(x - 4, y - 16, 8, 5, '#fff'); R(x - 3, y - 11, 6, 4, '#ffd7a8'); R(x - 4, y - 7, 8, 6, '#fff');
    R(x - 4 + sw * 4, y - 1, 3, 2, '#555'); R(x + 1 - sw * 4, y - 1, 3, 2, '#555'); R(x - 6, y - 10 + sw * 3, 2, 4, '#fff'); R(x + 4, y - 7 - sw * 3, 2, 4, '#fff');
    return;
  }
  R(x - 4, y - 17, 8, 4, '#fff'); R(x - 3, y - 19, 6, 3, '#fff');                   // 모자
  R(x - 3, y - 13, 6, 4, '#ffd7a8'); R(x + (f > 0 ? 1 : -3), y - 12, 2, 1, '#222');   // 얼굴
  R(x - 4, y - 9, 8, 6, '#fff'); R(x - 1, y - 9, 2, 6, '#e8e8e8');                   // 옷
  R(x - 4, y - 3 + 0, 3, 3 - (step && keys.size ? 1 : 0), '#444'); R(x + 1, y - 3, 3, 3, '#444');
}
function drawEnemy(e) {
  const x = e.x, y = e.y, st = e.stun > 0, wob = Math.floor(clock * 8 + e.id) % 2;
  if (e.kind === 'dog') { R(x - 3, y - 14, 6, 12, st ? '#a85a5a' : '#d83030'); R(x - 3, y - 14, 6, 2, '#ff8a6a'); R(x - 1, y - 12, 2, 8, '#ffd23a'); R(x - 3 + wob * 2, y - 2, 2, 2, '#333'); R(x + 1 - wob * 2, y - 2, 2, 2, '#333'); }
  else if (e.kind === 'egg') { R(x - 4, y - 14, 8, 11, st ? '#c8c8c8' : '#fff'); R(x - 3, y - 15, 6, 2, st ? '#c8c8c8' : '#fff'); R(x - 2, y - 11, 1, 2, '#222'); R(x + 1, y - 11, 1, 2, '#222'); R(x - 1, y - 7, 2, 1, '#c33'); R(x - 3 + wob * 2, y - 3, 2, 3, '#333'); R(x + 1 - wob * 2, y - 3, 2, 3, '#333'); }
  else { R(x - 4, y - 13, 8, 10, st ? '#5a8a5a' : '#3aa83a'); R(x - 3, y - 14, 6, 2, st ? '#5a8a5a' : '#3aa83a'); R(x - 3, y - 10, 1, 1, '#1a5a1a'); R(x + 2, y - 8, 1, 1, '#1a5a1a'); R(x - 2, y - 11, 1, 2, '#fff'); R(x + 1, y - 11, 1, 2, '#fff'); R(x - 3 + wob * 2, y - 3, 2, 3, '#333'); R(x + 1 - wob * 2, y - 3, 2, 3, '#333'); }
  if (st) { ctx.fillStyle = '#ffd23a'; ctx.font = 'bold 7px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('★', x - 2 + Math.sin(clock * 8) * 3, HUD + y - 17); ctx.fillText('★', x + 2 - Math.sin(clock * 8) * 3, HUD + y - 18); }
}
function drawItem(it) {
  const y = L.FLOORS[it.floor] - 1, bob = Math.sin(clock * 5) * 1;
  if (it.t > 7 && Math.floor(it.t * 8) % 2) return;
  R(it.x - 3, y - 10 + bob, 6, 8, '#d8d8e8'); R(it.x - 2, y - 12 + bob, 4, 3, '#888'); R(it.x - 1, y - 7 + bob, 2, 2, '#333');
}
function drawFx() {
  for (const f of fxs) {
    const k = f.t / f.life;
    if (f.kind === 'puff') { ctx.globalAlpha = 0.8 * (1 - k); ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(f.x + f.vx * f.t, HUD + f.y + f.vy * f.t, 2 + k * 2, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
    else if (f.kind === 'text') { ctx.globalAlpha = 1 - k * k; ctx.fillStyle = f.color; ctx.font = 'bold 9px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.strokeStyle = 'rgba(0,0,0,.7)'; ctx.lineWidth = 2.5; ctx.strokeText(f.text, f.x, HUD + f.y - k * 14); ctx.fillText(f.text, f.x, HUD + f.y - k * 14); ctx.globalAlpha = 1; }
  }
}
function drawHud() {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, HUD);
  ctx.font = 'bold 10px sans-serif'; ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffd23a'; ctx.textAlign = 'left'; ctx.fillText(`${G ? G.score.toLocaleString('ko-KR') : 0}`, 4, HUD / 2);
  if (G) {
    ctx.fillStyle = '#fff'; ctx.fillText(`S${G.level}`, 56, HUD / 2);
    ctx.fillStyle = '#e8e8f0'; ctx.fillText(`🧂${G.pepper}`, 84, HUD / 2);
    ctx.fillStyle = '#ff6a8a'; ctx.fillText('♥'.repeat(Math.min(G.lives, 5)) + (G.lives > 5 ? `+${G.lives - 5}` : ''), 122, HUD / 2);
  }
}
function draw() {
  ctx.fillStyle = '#0a0a1a'; ctx.fillRect(0, 0, W, CH);
  for (const y of L.FLOORS) drawFloor(y);
  for (const l of L.LADDERS) drawLadder(l);
  for (const cx of L.COLS) drawPlate(cx);
  if (G) {
    for (const p of G.pieces) drawPiece(p);
    if (G.item) drawItem(G.item);
    for (const e of G.enemies) drawEnemy(e);
    drawChef(); drawFx();
  }
  drawHud();
  if (banner.t > 0) {
    ctx.fillStyle = 'rgba(0,0,0,.65)'; ctx.fillRect(0, HUD + 108, W, banner.sub ? 40 : 26);
    ctx.fillStyle = banner.color; ctx.font = 'bold 16px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(banner.text, W / 2, HUD + 121);
    if (banner.sub) { ctx.font = 'bold 9px sans-serif'; ctx.fillStyle = '#fff'; ctx.fillText(banner.sub, W / 2, HUD + 138); }
  }
}

let last = 0;
function frame(ts) {
  const dt = Math.min(0.05, (ts - (last || ts)) / 1000);
  last = ts;
  update(dt);
  draw();
  requestAnimationFrame(frame);
}
addEventListener('blur', pause);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

function toggleMute() { muted = !muted; store.set('btMuted', muted ? '1' : '0'); $('muteBtn').textContent = muted ? '🔇' : '🔊'; }
$('muteBtn').onclick = (e) => { e.currentTarget.blur(); toggleMute(); };
$('pauseBtn').onclick = (e) => { e.currentTarget.blur(); state === 'paused' ? resume() : pause(); };
$('muteBtn').textContent = muted ? '🔇' : '🔊';

fit();
requestAnimationFrame(frame);
