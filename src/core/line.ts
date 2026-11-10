/**
 * Line model: horizontal alignment joined by a Catmull-Rom spline and sampled every STEP metres;
 * vertical profile made of constant gradients; contiguous speed limits; stations, tunnels, and signals
 * generated automatically from the stations and the length of the block sections.
 */
import type { CompiledLine, LineDef, ProfileSegment, Signal, Station } from './types';

/** Sampling step (m) of the compiled line: alignment, curvature, altitude */
export const STEP = 10;
/** Clamps x to the interval [a, b] */
export const clamp = (x: number, a: number, b: number): number => Math.max(a, Math.min(b, x));

type P2 = [number, number];

function catmull(pts: P2[], sub: number): P2[] {
  const out: P2[] = [];
  const P = (i: number): P2 => pts[clamp(i, 0, pts.length - 1)];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    for (let k = 0; k < sub; k++) {
      const t = k / sub, t2 = t * t, t3 = t2 * t;
      const c = (j: 0 | 1) => 0.5 * (2 * p1[j] + (-p0[j] + p2[j]) * t + (2 * p0[j] - 5 * p1[j] + 4 * p2[j] - p3[j]) * t2 + (-p0[j] + 3 * p1[j] - 3 * p2[j] + p3[j]) * t3);
      out.push([c(0), c(1)]);
    }
  }
  const last = pts[pts.length - 1];
  out.push([last[0], last[1]]);
  return out;
}

/** Compiles a line definition: joins the alignment with a spline, samples curvature and heading, sorts
 * profile, limits, stations and tunnels, generates the signals and collects consistency warnings.
 * It is the only entry point between the JSON line format and the simulation.
 */
export function compileLine(def: LineDef): CompiledLine {
  const dense = catmull(def.plan, 48);
  const cum = [0];
  for (let i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i][0] - dense[i - 1][0], dense[i][1] - dense[i - 1][1]));
  const len = Math.max(50, cum[cum.length - 1]);
  const N = Math.floor(len / STEP) + 2;
  const X = new Float64Array(N), Y = new Float64Array(N);
  let j = 0;
  for (let k = 0; k < N; k++) {
    const s = Math.min(len, k * STEP);
    while (j < dense.length - 2 && cum[j + 1] < s) j++;
    const fr = cum[j + 1] > cum[j] ? (s - cum[j]) / (cum[j + 1] - cum[j]) : 0;
    X[k] = dense[j][0] + (dense[j + 1][0] - dense[j][0]) * fr;
    Y[k] = dense[j][1] + (dense[j + 1][1] - dense[j][1]) * fr;
  }
  const HD = new Float64Array(N);
  let prev = 0;
  for (let k = 0; k < N; k++) {
    const a = k < N - 1 ? k : k - 1;
    let h = Math.atan2(Y[a + 1] - Y[a], X[a + 1] - X[a]);
    if (k > 0) {
      while (h - prev > Math.PI) h -= 2 * Math.PI;
      while (h - prev < -Math.PI) h += 2 * Math.PI;
    }
    HD[k] = h;
    prev = h;
  }
  const K0 = new Float64Array(N), K = new Float64Array(N);
  for (let k = 0; k < N - 1; k++) K0[k] = -(HD[k + 1] - HD[k]) / STEP;
  for (let k = 0; k < N; k++) {
    let s = 0, n = 0;
    for (let q = -3; q <= 3; q++) { const i = k + q; if (i >= 0 && i < N) { s += K0[i]; n++; } }
    K[k] = s / n;
  }
  const HEAD = new Float64Array(N);
  for (let k = 1; k < N; k++) HEAD[k] = HEAD[k - 1] + K[k - 1] * STEP;

  // vertical profile
  const sorted = (def.profile || []).map(p => [p[0], p[1]] as P2).sort((a, b) => a[0] - b[0]);
  const alt0 = sorted.length ? sorted[0][1] : 100, altEnd = sorted.length ? sorted[sorted.length - 1][1] : alt0;
  const pv: P2[] = [[0, alt0], ...sorted.filter(p => p[0] > 0 && p[0] < len - 1), [len, altEnd]];
  const prof: ProfileSegment[] = [];
  for (let i = 0; i < pv.length - 1; i++) {
    const a = pv[i][0], b = pv[i + 1][0];
    prof.push({ a, b, alt0: pv[i][1], i: (pv[i + 1][1] - pv[i][1]) / Math.max(1, b - a) * 1000 });
  }

  // speed limits made contiguous
  const lr = (def.limits || []).map(l => [l[0], l[1], l[2]] as [number, number, number]).sort((a, b) => a[0] - b[0]);
  const lim: [number, number, number][] = [];
  let cur = 0, lastV = lr.length ? lr[0][2] : 80;
  for (const [a, b, v] of lr) {
    if (b <= cur) continue;
    if (a > cur) lim.push([cur, a, lastV]);
    lim.push([Math.max(a, cur), b, v]);
    cur = b;
    lastV = v;
  }
  if (!lim.length) lim.push([0, 1e9, 80]);
  lim[lim.length - 1][1] = 1e9;

  const st: Station[] = (def.stations || []).map(s => ({ ...s, done: false })).filter(s => s.s >= 20 && s.s <= len - 20).sort((a, b) => a.s - b.s);
  if (st.length && st[0].dep == null) st[0].dep = 0;
  const tun = (def.tunnels || [])
    .map(t => [Math.max(0, Math.min(t[0], t[1])), Math.min(len, Math.max(t[0], t[1]))] as [number, number])
    .filter(t => t[1] - t[0] > 20)
    .sort((a, b) => a[0] - b[0]);

  let rmin = Infinity;
  for (let k = 0; k < N; k++) { const r = 1 / Math.max(1e-9, Math.abs(K[k])); if (r < rmin) rmin = r; }
  const L: CompiledLine = {
    def, len, N, X, Y, K, HEAD, prof, lim, st, tun, sig: [], rmin,
    imax: Math.max(...prof.map(p => Math.abs(p.i))),
    iup: Math.max(0, ...prof.map(p => p.i)),
    amin: Math.min(...pv.map(p => p[1])),
    amax: Math.max(...pv.map(p => p[1])),
    warnings: [],
  };
  L.sig = genSignals(L, Math.max(400, def.block || 1300));
  if (st.length < 2) L.warnings.push('the line needs at least two stations');
  return L;
}

/** Starting signals 250 m after each station, home signals 400 m before, intermediate signals at block spacing */
export function genSignals(L: Pick<CompiledLine, 'st' | 'len'>, blk: number): Signal[] {
  const sig: Omit<Signal, 'id' | 'asp'>[] = [];
  const st = L.st;
  for (let i = 0; i < st.length; i++) {
    const a = st[i].s + 250;
    const b = i + 1 < st.length ? st[i + 1].s - 400 : L.len - 150;
    if (a >= L.len - 60) break;
    sig.push({ s: a, st: i < st.length - 1 ? i : null, kind: 'P' });
    if (b - a > blk * 0.6) {
      const n = Math.max(0, Math.round((b - a) / blk) - 1);
      for (let k = 1; k <= n; k++) sig.push({ s: a + (b - a) * k / (n + 1), st: null, kind: 'B' });
      if (i + 1 < st.length) sig.push({ s: b, st: null, kind: 'H' });
    }
  }
  sig.sort((x, y) => x.s - y.s);
  return sig.map((s, i) => ({ ...s, id: String(i + 1), asp: 'G' as const }));
}

/** Scales the alignment of a built-in line to the desired length */
export function fitPlan(def: LineDef): LineDef {
  if (!def.fitLen) return def;
  for (let it = 0; it < 3; it++) {
    const L = compileLine(def);
    const k = def.fitLen / L.len;
    def.plan = def.plan.map(p => [p[0] * k, p[1] * k] as P2);
  }
  delete def.fitLen;
  return def;
}

/** Index of the sample containing chainage s */
export const idxOf = (L: CompiledLine, s: number): number => clamp(Math.floor(s / STEP), 0, L.N - 1);

/** Gradient (‰, positive uphill) at chainage s */
export function gradeOf(L: CompiledLine, s: number): number {
  for (const p of L.prof) if (s < p.b) return s >= p.a ? p.i : L.prof[0].i;
  return L.prof[L.prof.length - 1].i;
}

/** Altitude (m a.s.l.) at chainage s, interpolated on the profile */
export function altOf(L: CompiledLine, s: number): number {
  s = clamp(s, 0, L.len);
  for (const p of L.prof) if (s <= p.b) return p.alt0 + (s - p.a) * p.i / 1000;
  const p = L.prof[L.prof.length - 1];
  return p.alt0 + (p.b - p.a) * p.i / 1000;
}

/** Line speed limit (km/h) at chainage s */
export function limitOf(L: CompiledLine, s: number): number {
  for (const l of L.lim) if (s >= l[0] && s < l[1]) return l[2];
  return L.lim[L.lim.length - 1][2];
}

/** Tunnel [start, end] containing s, or null */
export function tunnelOf(L: CompiledLine, s: number): [number, number] | null {
  for (const t of L.tun) if (s >= t[0] && s < t[1]) return t;
  return null;
}

/** Plan coordinates (m) of the track at chainage s */
export function xyOf(L: CompiledLine, s: number): [number, number] {
  const f = clamp(s, 0, L.len) / STEP, i = Math.min(L.N - 2, Math.floor(f)), r = f - i;
  return [L.X[i] + (L.X[i + 1] - L.X[i]) * r, L.Y[i] + (L.Y[i + 1] - L.Y[i]) * r];
}

/** Minimum gradient (the steepest descent, ‰) between a and b */
export function minGrade(L: CompiledLine, a: number, b: number): number {
  let g = gradeOf(L, a);
  for (const p of L.prof) if (p.b > a && p.a < b) g = Math.min(g, p.i);
  return g;
}

/**
 * The same line seen by a train running in the opposite direction: chainage s' = len − s, profile, limits,
 * stations and tunnels mirrored, gradients and curvature with the opposite sign, and its own signals generated for
 * that direction. A train on the mirrored line runs exactly as a train on a line drawn the other way round.
 */
export function mirrorLine(L: CompiledLine): CompiledLine {
  const len = L.len, N = Math.floor(len / STEP) + 2;
  const at = (A: Float64Array, s: number) => {
    const f = clamp(s, 0, len) / STEP, i = Math.min(L.N - 2, Math.floor(f)), r = f - i;
    return A[i] + (A[i + 1] - A[i]) * r;
  };
  const X = new Float64Array(N), Y = new Float64Array(N), K = new Float64Array(N), HEAD = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    const s = len - Math.min(len, k * STEP);
    X[k] = at(L.X, s); Y[k] = at(L.Y, s); K[k] = -at(L.K, s); HEAD[k] = at(L.HEAD, s) + Math.PI;
  }
  const prof: ProfileSegment[] = L.prof.slice().reverse().map(p => ({ a: len - p.b, b: len - p.a, alt0: p.alt0 + (p.b - p.a) * p.i / 1000, i: -p.i }));
  const lim = L.lim.map(l => [len - Math.min(l[1], len), len - l[0], l[2]] as [number, number, number]).reverse().filter(l => l[1] > l[0]);
  lim[0][0] = 0; lim[lim.length - 1][1] = 1e9;
  const st: Station[] = L.st.slice().reverse().map(s => ({ name: s.name, s: len - s.s, arr: null, dep: null, done: false }));
  const tun = L.tun.slice().reverse().map(t => [len - t[1], len - t[0]] as [number, number]);
  const M: CompiledLine = {
    def: { ...L.def, name: L.def.name + ' (reverse direction)' }, len, N, X, Y, K, HEAD, prof, lim, st, tun, sig: [], rmin: L.rmin,
    imax: L.imax, iup: Math.max(0, ...prof.map(p => p.i)), amin: L.amin, amax: L.amax, warnings: [],
  };
  M.sig = genSignals(M, Math.max(400, L.def.block || 1300));
  return M;
}
