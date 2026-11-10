// Page of the dynamics model: charts and laboratory computed with the YuTreno core.
import {
  ADHESION, DEFAULT_SCENARIO, FIXED_DT, Simulation, TRAIN_PRESETS, clone, couplerForce, curtiusKniffler, rocklPermille,
  type LineDef, type Scenario, type TrainParams,
} from '../core';

const $ = (id: string) => document.getElementById(id) as any;
const num = (x: number, d = 1) => x.toFixed(d);
const css = (k: string) => getComputedStyle(document.documentElement).getPropertyValue('--' + k).trim() || '#888';
const MONO = "'IBM Plex Mono',ui-monospace,monospace";
const REDUCED = (() => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } })();

function fit(cv: HTMLCanvasElement) {
  const r = cv.getBoundingClientRect(), d = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(r.width * d)), h = Math.max(1, Math.round(r.height * d));
  if (cv.width !== w || cv.height !== h) { cv.width = w; cv.height = h; }
  const c = cv.getContext('2d') as CanvasRenderingContext2D;
  c.setTransform(d, 0, 0, d, 0, 0);
  c.clearRect(0, 0, r.width, r.height);
  return { c, W: r.width || 1, H: r.height || 1 };
}
const niceStep = (span: number, n = 5) => { const raw = span / n, m = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / m; return (f > 5 ? 10 : f > 2 ? 5 : f > 1 ? 2 : 1) * m; };

interface Axes { c: CanvasRenderingContext2D; X: (x: number) => number; Y: (y: number) => number; pl: number; pr: number; pt: number; pb: number; W: number; H: number }
function axes(cv: HTMLCanvasElement, x0: number, x1: number, y0: number, y1: number, xl: string, yl: string, fx = (v: number) => num(v, 0), fy = (v: number) => num(v, 0)): Axes {
  const { c, W, H } = fit(cv);
  const pl = 52, pr = 14, pt = 14, pb = 34;
  const X = (x: number) => pl + (x - x0) / (x1 - x0) * (W - pl - pr), Y = (y: number) => pt + (1 - (y - y0) / (y1 - y0)) * (H - pt - pb);
  c.font = '11px ' + MONO; c.fillStyle = css('muted'); c.strokeStyle = css('rule'); c.lineWidth = 1;
  const sy = niceStep(y1 - y0), sx = niceStep(x1 - x0, W < 500 ? 4 : 6);
  c.textAlign = 'right'; c.textBaseline = 'middle';
  for (let y = Math.ceil(y0 / sy) * sy; y <= y1 + 1e-9; y += sy) { c.beginPath(); c.moveTo(pl, Y(y)); c.lineTo(W - pr, Y(y)); c.stroke(); c.fillText(fy(y), pl - 8, Y(y)); }
  c.textAlign = 'center'; c.textBaseline = 'top';
  for (let x = Math.ceil(x0 / sx) * sx; x <= x1 + 1e-9; x += sx) c.fillText(fx(x), X(x), H - pb + 7);
  c.textAlign = 'right'; c.textBaseline = 'alphabetic'; c.fillText(xl, W - pr, H - 4);
  c.textAlign = 'left'; c.fillText(yl, pl + 6, pt + 11);
  return { c, X, Y, pl, pr, pt, pb, W, H };
}
function line(a: Axes, xs: ArrayLike<number>, ys: ArrayLike<number>, col: string, w = 2, dash: number[] = []) {
  const { c, X, Y } = a;
  c.strokeStyle = col; c.lineWidth = w; c.setLineDash(dash); c.beginPath();
  for (let i = 0; i < xs.length; i++) i ? c.lineTo(X(xs[i]), Y(ys[i])) : c.moveTo(X(xs[i]), Y(ys[i]));
  c.stroke(); c.setLineDash([]);
}

// ---------- test bench ----------
const straight = (len = 40000): LineDef => ({
  name: 'test bench', plan: [[0, 0], [len, 0]], profile: [[0, 100], [len, 100]],
  stations: [{ name: 'A', s: 700, arr: null, dep: 0 }, { name: 'B', s: len - 100, arr: null, dep: null }],
  limits: [[0, 1e9, 400]], tunnels: [], block: 1e6, freight: { on: false, s0: 0, vmax: 60, stopAt: 0, wait: 0, len: 0 },
});
const SCEN: Scenario = { ...DEFAULT_SCENARIO, sig: 'BACC' };

// ---------- toy train ----------
function toyRun() {
  const mu = 0.02, M1 = 1, M2 = 0.5, G = 9.81;
  const toy: TrainParams = {
    name: 'toy train', model: 'multimass', m: 1.5, rot: 1, L: 0.6, Pw: 1e9, Fmax: 1000, adh: 1, A: 0, B: mu * G * (M1 + M2), C: 0,
    bSvc: 1, bEm: 1, tauB: 0.1, tauR: 0.1, eta: 1, edMax: 0, etaR: 0, vmax: 100,
    consist: [{ name: 'Locomotive', m: M1, L: 0.3, motored: true }, { name: 'Wagon', m: M2, L: 0.3, motored: false }],
    coupler: { k: 1, c: 0, slack: 0 }, epBrake: true,
  };
  const sim = new Simulation(straight(), toy, SCEN);
  const t: number[] = [], v1: number[] = [], v2: number[] = [];
  let peak = 0;
  const n = Math.round(150 / FIXED_DT), every = Math.round(0.01 / FIXED_DT);
  for (let i = 0; i < n; i++) {
    if (i % every === 0) {
      const r = sim.S.t >= 10 ? 1 : 0;
      sim.applyCommand({ traction: Math.max(0, r - sim.S.v) / 1000, vigilance: true });
    }
    sim.step(FIXED_DT);
    if (i % 20 === 0) { t.push(sim.S.t); v1.push(sim.mm!.v[0]); v2.push(sim.mm!.v[1]); }
    peak = Math.max(peak, sim.S.v);
  }
  return { t, v1, v2, peak, vss: 1 / (1 + mu * G * (M1 + M2)), vEnd: sim.S.v, T: sim.mm!.T[0], Tss: mu * G * M2 / (1 + mu * G * (M1 + M2)) };
}
let TOY: ReturnType<typeof toyRun>;
function drawToy() {
  const a = axes($('cvToy'), 0, 150, 0, 1, 's', 'm/s', v => num(v, 0), v => num(v, 1));
  line(a, [0, 150], [TOY.vss, TOY.vss], css('muted'), 1.2, [5, 4]);
  line(a, [10, 10, 150], [0, 1, 1], css('rule'), 1.2, [2, 3]);
  line(a, TOY.t, TOY.v2, css('warm'), 1.6);
  line(a, TOY.t, TOY.v1, css('accent'), 2.2);
}

// ---------- coupler law, adhesion, curve ----------
function drawCoupler() {
  const cp = TRAIN_PRESETS.freight.coupler!;
  const a = axes($('cvCoupler'), -40, 40, -200, 200, 'extension (mm)', 'kN');
  const { c, X, Y, pt, H, pb } = a;
  c.fillStyle = css('tint'); c.fillRect(X(-cp.slack * 500), pt, X(cp.slack * 500) - X(-cp.slack * 500), H - pt - pb);
  const xs: number[] = [], ys: number[] = [];
  for (let e = -40; e <= 40; e += 0.25) { xs.push(e); ys.push(couplerForce(e / 1000, 0, cp) / 1000); }
  line(a, xs, ys, css('accent'), 2.4);
  c.fillStyle = css('muted'); c.textAlign = 'center'; c.font = '11px ' + MONO; c.fillText('slack', X(0), Y(150));
}
function drawAdh() {
  const a = axes($('cvAdh'), 0, 300, 0, 0.35, 'km/h', 'μ', v => num(v, 0), v => num(v, 2));
  const xs: number[] = []; for (let v = 0; v <= 300; v += 2) xs.push(v);
  const curve = (mu0: number) => xs.map(v => mu0 * curtiusKniffler(v) / curtiusKniffler(0));
  line(a, xs, curve(ADHESION.leaves), css('warm'), 2);
  line(a, xs, curve(ADHESION.wet), css('muted'), 2);
  line(a, xs, curve(ADHESION.dry), css('accent'), 2.4);
}
function drawCurve() {
  const a = axes($('cvCurve'), 150, 2000, 0, 4.5, 'radius (m)', '‰', v => num(v, 0), v => num(v, 0));
  const xs: number[] = []; for (let r = 150; r <= 2000; r += 5) xs.push(r);
  line(a, xs, xs.map(rocklPermille), css('accent'), 2.4);
  line(a, [300, 300], [0, 4.5], css('rule'), 1.2, [3, 3]);
}

// ---------- laboratory ----------
interface LabResult { t: number[]; vH: number[]; vT: number[]; F: Float64Array[]; n: number; L: number[]; motor: boolean[]; kpi: { label: string; value: string }[]; peak: number }
function labRun(): LabResult {
  const id = $('labTrain').value as 'freight' | 'regional' | 'high_speed', man = $('labMan').value, br = $('labBrake').value;
  const tr = clone(TRAIN_PRESETS[id]);
  tr.coupler = { ...tr.coupler!, slack: +$('labGap').value / 1000, k: +$('labK').value * 1e6 };
  if (br === 'pn') tr.epBrake = false; else if (br === 'ep') tr.epBrake = true;
  const sim = new Simulation(straight(), tr, SCEN);
  const M = sim.mm!;
  if (man === 'start') { sim.place(700, 0); sim.setLever(10); } else { sim.place(700, 80 / 3.6); sim.setLever(man === 'emergency' ? -8 : -7); }
  const s0 = sim.S.s, out: LabResult = { t: [], vH: [], vT: [], F: [], n: M.n, L: M.veh.map(v => v.L), motor: M.veh.map(v => v.motored), kpi: [], peak: 0 };
  const dur = man === 'start' ? 60 : 200, every = Math.round(0.1 / FIXED_DT);
  let stopT = 0, done = false;
  for (let i = 0; i < Math.round(dur / FIXED_DT); i++) {
    sim.step(FIXED_DT);
    if (sim.S.vigAlarm) sim.vigilance();
    if (i % every === 0) { out.t.push(sim.S.t); out.vH.push(sim.S.v * 3.6); out.vT.push(sim.S.vTail * 3.6); out.F.push(Float64Array.from(M.T)); }
    if (man !== 'start' && !done && sim.S.v === 0 && sim.S.vTail === 0) { done = true; stopT = sim.S.t; }
    if (done && sim.S.t > stopT + 4) break;
  }
  out.peak = Math.max(1, sim.S.maxTension, sim.S.maxCompression);
  out.kpi = man === 'avvio'
    ? [{ label: 'speed after 60 s', value: num(sim.S.v * 3.6, 1) + ' km/h' }, { label: 'maximum coupler tension', value: num(sim.S.maxTension / 1000, 0) + ' kN' },
       { label: 'maximum compression', value: num(sim.S.maxCompression / 1000, 0) + ' kN' }, { label: 'maximum jerk at the head', value: num(sim.S.maxJerk, 2) + ' m/s³' }]
    : [{ label: 'stopping distance of the head', value: num(sim.S.s - s0, 0) + ' m' }, { label: 'stopping time', value: num(stopT, 1) + ' s' },
       { label: 'maximum coupler compression', value: num(sim.S.maxCompression / 1000, 0) + ' kN' }, { label: 'maximum tension', value: num(sim.S.maxTension / 1000, 0) + ' kN' }];
  return out;
}
let LAB: LabResult, labIdx = 0, playing = false, lastT = 0;
function drawLab() {
  $('labFacts').innerHTML = LAB.kpi.map(k => `<div><b>${k.value}</b><span>${k.label}</span></div>`).join('');
  const tmax = LAB.t[LAB.t.length - 1] || 1;
  const vmax = Math.max(10, ...LAB.vH, ...LAB.vT) * 1.1;
  const a = axes($('cvLabV'), 0, tmax, 0, vmax, 's', 'km/h');
  line(a, LAB.t, LAB.vT, css('warm'), 2);
  line(a, LAB.t, LAB.vH, css('accent'), 2.2);
  const cur = LAB.t[labIdx] ?? 0;
  line(a, [cur, cur], [0, vmax], css('muted'), 1, [3, 3]);
  drawHeat();
  drawStrip($('cvLabStrip'), LAB, labIdx);
  $('labTOut').textContent = num(cur, 1) + ' s';
}
function mixCol(hex: string, t: number) {
  const bg = css('surface');
  const p = (h: string) => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(x => x + x).join(''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
  const A = p(bg), B = p(hex);
  return 'rgb(' + A.map((v, i) => Math.round(v + (B[i] - v) * t)).join(',') + ')';
}
function drawHeat() {
  const { c, W, H } = fit($('cvLabHeat'));
  const pl = 52, pr = 14, pt = 14, pb = 34, nc = Math.max(1, LAB.n - 1), rows = LAB.F.length;
  const cw = (W - pl - pr) / nc, rh = (H - pt - pb) / Math.max(1, rows);
  const acc = css('accent'), warm = css('warm');
  const steps = 12;
  const pal = (f: number) => { const t = Math.min(1, Math.abs(f) / LAB.peak); const q = Math.round(t * steps) / steps; return f >= 0 ? mixCol(acc, q) : mixCol(warm, q); };
  if (LAB.n < 2) { c.fillStyle = css('muted'); c.textAlign = 'center'; c.fillText('A single vehicle: no coupler.', W / 2, H / 2); return; }
  for (let r = 0; r < rows; r++) for (let j = 0; j < nc; j++) { c.fillStyle = pal(LAB.F[r][j]); c.fillRect(pl + j * cw, pt + r * rh, Math.ceil(cw) + 0.5, Math.ceil(rh) + 0.5); }
  c.strokeStyle = css('ink'); c.lineWidth = 1.2; const y = pt + labIdx * rh; c.beginPath(); c.moveTo(pl, y); c.lineTo(W - pr, y); c.stroke();
  c.fillStyle = css('muted'); c.font = '11px ' + MONO; c.textAlign = 'right'; c.textBaseline = 'middle';
  const tmax = LAB.t[rows - 1] || 1, st = niceStep(tmax, 5);
  for (let t = 0; t <= tmax; t += st) c.fillText(num(t, 0), pl - 8, pt + t / tmax * (H - pt - pb));
  c.textAlign = 'left'; c.textBaseline = 'alphabetic'; c.fillText('head', pl, H - 8); c.textAlign = 'right'; c.fillText('tail · s ↓', W - pr, H - 8);
  c.textAlign = 'center'; c.fillText('peak ' + num(LAB.peak / 1000, 0) + ' kN', (W + pl - pr) / 2, H - 8);
}
function drawStrip(cv: HTMLCanvasElement, R: LabResult, k: number) {
  const { c, W, H } = fit(cv);
  const pl = 20, pr = 20, mid = H * 0.5, tot = R.L.reduce((a, b) => a + b, 0), X = (d: number) => pl + d / tot * (W - pl - pr);
  const F = R.F[Math.min(k, R.F.length - 1)] || new Float64Array(0), amp = H * 0.36;
  c.strokeStyle = css('rule'); c.lineWidth = 1; c.beginPath(); c.moveTo(pl, mid); c.lineTo(W - pr, mid); c.stroke();
  let off = 0;
  for (let i = 0; i < R.n; i++) {
    const x0 = X(off) + 1.5, x1 = X(off + R.L[i]) - 1.5;
    c.fillStyle = R.motor[i] ? mixCol(css('accent'), 0.35) : mixCol(css('muted'), 0.22);
    c.fillRect(x0, mid - 7, Math.max(1, x1 - x0), 14);
    off += R.L[i];
    if (i < R.n - 1) {
      const f = F[i], h = Math.min(1, Math.abs(f) / R.peak) * amp, x = X(off), bw = Math.max(3, Math.min(14, (W - pl - pr) / R.n * 0.45));
      c.fillStyle = f >= 0 ? css('accent') : css('warm');
      if (f >= 0) c.fillRect(x - bw / 2, mid - 9 - h, bw, h); else c.fillRect(x - bw / 2, mid + 9, bw, h);
    }
  }
  c.fillStyle = css('muted'); c.font = '11px ' + MONO; c.textAlign = 'left'; c.fillText('head', pl, H - 6); c.textAlign = 'right'; c.fillText('tail', W - pr, H - 6);
}

// ---------- opening figure: emergency braking of the freight train, in a loop ----------
let HERO: LabResult | null = null, heroK = 0;
function heroRun() {
  const sel = { labTrain: 'freight', labMan: 'emergency', labBrake: 'train' } as Record<string, string>;
  const saved = Object.keys(sel).map(k => [k, $(k).value]);
  Object.entries(sel).forEach(([k, v]) => { $(k).value = v; });
  const gap = $('labGap').value, kk = $('labK').value;
  $('labGap').value = 20; $('labK').value = 6;
  HERO = labRun();
  saved.forEach(([k, v]) => { $(k).value = v; });
  $('labGap').value = gap; $('labK').value = kk;
  HERO.t = HERO.t.slice(0, 160); HERO.F = HERO.F.slice(0, 160);
  heroK = REDUCED ? 30 : 0;
}

// ---------- start ----------
function syncOut() {
  $('labGapOut').textContent = $('labGap').value + ' mm';
  $('labKOut').textContent = num(+$('labK').value, 1) + ' MN/m';
}
function presetControls() {
  const tr = TRAIN_PRESETS[$('labTrain').value];
  $('labGap').value = Math.round(tr.coupler!.slack * 1000);
  $('labK').value = tr.coupler!.k / 1e6;
  syncOut();
}
function runLab() {
  LAB = labRun(); labIdx = 0;
  $('labT').max = String(LAB.t.length - 1); $('labT').value = '0';
  // show the instant with the strongest compression or tension right away
  let best = 0, bi = 0;
  LAB.F.forEach((f, i) => { const m = f.reduce((a, x) => Math.max(a, Math.abs(x)), 0); if (m > best) { best = m; bi = i; } });
  labIdx = bi; $('labT').value = String(bi);
  drawLab();
}
function drawAll() {
  drawToy(); drawCoupler(); drawAdh(); drawCurve();
  if (LAB) drawLab();
  if (HERO) drawStrip($('cvHero'), HERO, heroK);
}

TOY = toyRun();
$('toyFacts').innerHTML = [
  ['simulated steady-state speed', num(TOY.vEnd, 4) + ' m/s'], ['theoretical value', num(TOY.vss, 4) + ' m/s'],
  ['response peak', num(TOY.peak, 3) + ' m/s'], ['steady-state coupler force', num(TOY.T, 4) + ' N'],
].map(([l, v]) => `<div><b>${v}</b><span>${l}</span></div>`).join('');
presetControls();
heroRun();
runLab();
drawAll();

$('labTrain').addEventListener('change', () => { presetControls(); runLab(); });
['labMan', 'labBrake'].forEach(id => $(id).addEventListener('change', runLab));
['labGap', 'labK'].forEach(id => $(id).addEventListener('input', syncOut));
['labGap', 'labK'].forEach(id => $(id).addEventListener('change', runLab));
$('labRun').addEventListener('click', runLab);
$('labT').addEventListener('input', () => { labIdx = +$('labT').value; playing = false; $('labPlay').textContent = 'Play'; drawLab(); });
$('labPlay').addEventListener('click', () => {
  playing = !playing;
  if (playing && labIdx >= LAB.t.length - 1) labIdx = 0;
  $('labPlay').textContent = playing ? 'Pause' : 'Play';
});
window.addEventListener('resize', drawAll);
try {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', drawAll);
  new MutationObserver(drawAll).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
} catch { /* environment without matchMedia */ }

function tick(now: number) {
  if (now - lastT > 50) {
    lastT = now;
    if (playing) {
      labIdx++;
      if (labIdx >= LAB.t.length) { labIdx = LAB.t.length - 1; playing = false; $('labPlay').textContent = 'Play'; }
      $('labT').value = String(labIdx); drawLab();
    }
    if (HERO && !REDUCED) { heroK = (heroK + 1) % HERO.F.length; drawStrip($('cvHero'), HERO, heroK); }
  }
  requestAnimationFrame(tick);
}
requestAnimationFrame(tick);
