/**
 * Network model (docs/design/network.md): lines that meet in nodes, and the corridor a train runs along them.
 *
 * A network is a set of lines, each with its own chainage, like the net elements of the macroscopic level of the
 * UIC RailTopoModel (IRS 30100) and of railML 3. Two lines meet where they have a station with the same name: that
 * station is a node (an operational point shared by the two lines). A train has an itinerary on the network, the
 * sequence of lines it runs along; the itinerary is compiled into a corridor, a compiled line like the ones of a
 * single-line run, so that dynamics, supervision and the built-in driver stay one-dimensional and unchanged. The legs
 * of the corridor say which line, direction and chainage every point of the corridor comes from: the engine uses them
 * to place the train on the signalling of each line.
 *
 * A corridor that runs along a single line is the line itself, or the mirrored line for the opposite direction: a
 * run without a network, or with services on one line only, uses exactly the same objects as before.
 */
import { STEP, clamp, compileLine, fitPlan, mirrorLine } from './line';
import type { CompiledLine, LineDef, ProfileSegment, Signal, Station } from './types';

/** A line of a network: the id of a built-in line or a complete line with its id */
export type NetworkLineDef = string | (LineDef & { id: string });

/**
 * Network as written in a scenario (JSON exchange format). Nodes are not declared: a station with the same name on two
 * lines is the same operational point. The first line is the main line, the one of the controlled train.
 */
export interface NetworkDef {
  name: string;
  lines: NetworkLineDef[];
}

/** A line of a compiled network, placed in the common plan of the network */
export interface NetworkLine {
  id: string;
  /** The line in its own direction of chainage */
  L: CompiledLine;
  /** The line seen in the opposite direction, built when a train runs that way */
  Lr: CompiledLine | null;
  /** Translation of the plan of the line into the common plan of the network (m) */
  dx: number;
  dy: number;
}

export interface CompiledNetwork {
  name: string;
  lines: NetworkLine[];
  /** Nodes: name of the station and indexes of the lines that share it */
  nodes: { name: string; lines: number[] }[];
  warnings: string[];
}

/**
 * Compiles a network. `main` is the main line, already compiled by the engine: it keeps its plan and becomes line 0.
 * Every other line is translated so that its node with an already placed line falls on the same point of the plan;
 * its orientation is the one of its own plan. `presets` resolves the ids of the built-in lines.
 */
export function compileNetwork(def: NetworkDef, main: CompiledLine, presets: Record<string, LineDef>): CompiledNetwork {
  if (!def.lines?.length) throw new Error(`network «${def.name}»: no lines`);
  const ids = def.lines.map(l => typeof l === 'string' ? l : l.id);
  if (new Set(ids).size !== ids.length) throw new Error(`network «${def.name}»: line ids must be unique`);
  const lines: NetworkLine[] = ids.map((id, i) => {
    if (i === 0) return { id, L: main, Lr: null, dx: 0, dy: 0 };
    const src = def.lines[i];
    const d = typeof src === 'string' ? presets[src] : src;
    if (!d) throw new Error(`network «${def.name}»: unknown line «${id}»`);
    return { id, L: compileLine(fitPlan(JSON.parse(JSON.stringify(d)))), Lr: null, dx: 0, dy: 0 };
  });
  const warnings: string[] = [];
  const names = new Map<string, number[]>();
  lines.forEach((n, i) => { for (const s of n.L.st) names.set(s.name, [...(names.get(s.name) ?? []), i]); });
  const nodes = [...names].filter(([, v]) => v.length > 1).map(([name, v]) => ({ name, lines: v }));
  // placement: breadth-first from the main line along the nodes
  const placed = new Set([0]);
  for (let pass = 0; pass < lines.length; pass++) {
    for (const nd of nodes) {
      const from = nd.lines.find(i => placed.has(i));
      if (from == null) continue;
      for (const i of nd.lines) {
        if (placed.has(i)) continue;
        const a = xyAt(lines[from], stationAt(lines[from].L, nd.name)), b = xyAt({ ...lines[i], dx: 0, dy: 0 }, stationAt(lines[i].L, nd.name));
        lines[i].dx = a[0] - b[0]; lines[i].dy = a[1] - b[1];
        placed.add(i);
        const za = altAt(lines[from].L, stationAt(lines[from].L, nd.name)), zb = altAt(lines[i].L, stationAt(lines[i].L, nd.name));
        if (Math.abs(za - zb) > 1) warnings.push(`node ${nd.name}: altitude ${za.toFixed(1)} m on ${lines[from].id}, ${zb.toFixed(1)} m on ${lines[i].id}`);
      }
    }
  }
  lines.forEach((n, i) => { if (!placed.has(i)) warnings.push(`line ${n.id} has no node with the rest of the network`); });
  return { name: def.name, lines, nodes, warnings };
}

/** The line of a network as a train running in direction dir sees it */
export function directed(n: NetworkLine, dir: 1 | -1): CompiledLine {
  if (dir > 0) return n.L;
  return n.Lr ??= mirrorLine(n.L);
}

/** Position of a station on a line (m) */
function stationAt(L: CompiledLine, name: string): number {
  const s = L.st.find(x => x.name === name);
  if (!s) throw new Error(`station «${name}» is not on line «${L.def.name}»`);
  return s.s;
}

const lerp = (A: Float64Array, L: CompiledLine, s: number): number => {
  const f = clamp(s, 0, L.len) / STEP, i = Math.min(L.N - 2, Math.floor(f)), r = f - i;
  return A[i] + (A[i + 1] - A[i]) * r;
};
function xyAt(n: NetworkLine, s: number): [number, number] { return [lerp(n.L.X, n.L, s) + n.dx, lerp(n.L.Y, n.L, s) + n.dy]; }
function altAt(L: CompiledLine, s: number): number {
  for (const p of L.prof) if (s <= p.b) return p.alt0 + (s - p.a) * p.i / 1000;
  const p = L.prof[L.prof.length - 1];
  return p.alt0 + (p.b - p.a) * p.i / 1000;
}

/**
 * A leg of a corridor: the stretch [c0, c1] of the corridor comes from line `line` run in direction `dir`, starting at
 * `d0` in the chainages of the directed line. The first leg starts at −∞ and the last ends at +∞ for clipping, so
 * that a train standing beyond the ends of the corridor stays on the line it is on.
 */
export interface CorridorLeg {
  line: number;
  dir: 1 | -1;
  /** Origin of the leg in the corridor (m) and the chainage it corresponds to on the directed line */
  c0: number;
  d0: number;
  /** Bounds of the leg in the corridor (m) */
  lo: number;
  hi: number;
}

/** A corridor: the compiled line a train runs along, its legs and, for corridors made of several lines, where each of its signals comes from */
export interface Corridor {
  line: CompiledLine;
  legs: CorridorLeg[];
  /** Origin of every signal of the corridor: line, direction and index in the signals of the directed line; null when the corridor is a line itself */
  sigRef: { line: number; dir: 1 | -1; i: number }[] | null;
}

/** A stretch of an itinerary: the line, the direction and the stations where the train enters and leaves it */
export interface ItineraryLeg { line: number; dir: 1 | -1; from: string; to: string }

/**
 * Itinerary of a train through its stops: the lines of `route` (ids, in running order) or, without a route, the
 * main line if it has all the stops, otherwise the first line that has them all. Consecutive lines must share a
 * station (the node where the train changes line); every stop must be on the line of its leg, in running order.
 */
export function planItinerary(net: CompiledNetwork, stops: string[], route?: string[], who = 'train'): ItineraryLeg[] {
  const idx = (id: string) => {
    const i = net.lines.findIndex(n => n.id === id);
    if (i < 0) throw new Error(`${who}: line «${id}» is not in the network (lines: ${net.lines.map(n => n.id).join(', ')})`);
    return i;
  };
  const has = (i: number, name: string) => net.lines[i].L.st.some(x => x.name === name);
  let seq: number[];
  if (route?.length) seq = route.map(idx);
  else {
    const all = net.lines.map((_, i) => i).filter(i => stops.every(s => has(i, s)));
    if (!all.length) throw new Error(`${who}: no line has all the stops (${stops.join(', ')}); give the route through the network`);
    seq = [all[0]];
  }
  const legs: ItineraryLeg[] = [];
  let k = 0;
  for (let j = 0; j < seq.length; j++) {
    const i = seq[j], L = net.lines[i].L;
    const from = j === 0 ? stops[0] : legs[j - 1].to;
    let to: string;
    if (j === seq.length - 1) to = stops[stops.length - 1];
    else {
      const common = L.st.filter(x => has(seq[j + 1], x.name)).map(x => x.name);
      if (!common.length) throw new Error(`${who}: lines «${net.lines[i].id}» and «${net.lines[seq[j + 1]].id}» have no station in common`);
      if (common.length > 1) throw new Error(`${who}: lines «${net.lines[i].id}» and «${net.lines[seq[j + 1]].id}» share more than one station (${common.join(', ')})`);
      to = common[0];
    }
    if (!has(i, from)) throw new Error(`${who}: station «${from}» is not on line «${net.lines[i].id}»`);
    if (!has(i, to)) throw new Error(`${who}: station «${to}» is not on line «${net.lines[i].id}»`);
    const a = stationAt(L, from), b = stationAt(L, to);
    if (a === b) throw new Error(`${who}: the leg on line «${net.lines[i].id}» starts and ends at ${from}`);
    const dir: 1 | -1 = b > a ? 1 : -1;
    // the stops of this leg, in running order up to the node (the node, when it is a stop, belongs to this leg)
    if (j === 0) k = 1;
    let last = a;
    while (k < stops.length && has(i, stops[k])) {
      const s = stationAt(L, stops[k]);
      if ((s - b) * dir > 0) break;
      if ((s - last) * dir <= 0) throw new Error(`${who}: the stops on line «${net.lines[i].id}» must be in running order (${stops[k]})`);
      last = s;
      k++;
      if (s === b) break;
    }
    legs.push({ line: i, dir, from, to });
  }
  if (k < stops.length) throw new Error(`${who}: stop «${stops[k]}» is not on the route`);
  return legs;
}

/**
 * Compiles an itinerary into a corridor. One leg gives the directed line itself. Several legs give a new compiled line:
 * the first leg from the start of its directed line to the node, the middle ones from node to node, the last one
 * from the node to the end of its directed line; plan in the common frame of the network, curvature, profile, limits,
 * stations, tunnels and signals taken from the directed lines and moved to the chainages of the corridor.
 */
export function compileCorridor(net: CompiledNetwork, it: ItineraryLeg[]): Corridor {
  if (it.length === 1) {
    const { line, dir } = it[0];
    return { line: directed(net.lines[line], dir), legs: [{ line, dir, c0: 0, d0: 0, lo: -Infinity, hi: Infinity }], sigRef: null };
  }
  const parts = it.map((g, j) => {
    const D = directed(net.lines[g.line], g.dir);
    const a = j === 0 ? 0 : stationAt(D, g.from), b = j === it.length - 1 ? D.len : stationAt(D, g.to);
    return { g, D, a, b };
  });
  const legs: CorridorLeg[] = [];
  let c = 0;
  parts.forEach((p, j) => {
    legs.push({ line: p.g.line, dir: p.g.dir, c0: c, d0: p.a, lo: j === 0 ? -Infinity : c, hi: j === parts.length - 1 ? Infinity : c + (p.b - p.a) });
    c += p.b - p.a;
  });
  const len = c, N = Math.floor(len / STEP) + 2;
  const X = new Float64Array(N), Y = new Float64Array(N), K = new Float64Array(N), HEAD = new Float64Array(N);
  // the heading of each leg continues that of the previous one
  const headOff = parts.map(() => 0);
  for (let j = 1; j < parts.length; j++) {
    const q = parts[j - 1], p = parts[j];
    headOff[j] = lerp(q.D.HEAD, q.D, q.b) + headOff[j - 1] - lerp(p.D.HEAD, p.D, p.a);
  }
  for (let k = 0; k < N; k++) {
    const s = Math.min(len, k * STEP);
    let j = 0;
    while (j < parts.length - 1 && s > legs[j].hi) j++;
    const p = parts[j], n = net.lines[p.g.line], d = p.a + (s - legs[j].c0);
    // the mirrored line keeps the plan of the line, so the translation of the line applies to it as well
    X[k] = lerp(p.D.X, p.D, d) + n.dx; Y[k] = lerp(p.D.Y, p.D, d) + n.dy;
    K[k] = lerp(p.D.K, p.D, d); HEAD[k] = lerp(p.D.HEAD, p.D, d) + headOff[j];
  }
  const prof: ProfileSegment[] = [], lim: [number, number, number][] = [], st: Station[] = [], tun: [number, number][] = [], sig: Signal[] = [];
  const sigRef: { line: number; dir: 1 | -1; i: number }[] = [];
  parts.forEach((p, j) => {
    const lg = legs[j], to = (d: number) => lg.c0 + (d - p.a);
    for (const g of p.D.prof) {
      const a = Math.max(g.a, p.a), b = Math.min(g.b, p.b);
      if (b <= a) continue;
      prof.push({ a: to(a), b: to(b), alt0: g.alt0 + (a - g.a) * g.i / 1000, i: g.i });
    }
    for (const l of p.D.lim) {
      const a = Math.max(l[0], p.a), b = Math.min(l[1], p.b);
      if (b > a) lim.push([to(a), to(b), l[2]]);
    }
    for (const x of p.D.st) {
      if (x.s < p.a - 1e-9 || x.s > p.b + 1e-9) continue;
      if (j > 0 && x.name === p.g.from) continue;   // the node is already the last station of the previous leg
      st.push({ name: x.name, s: to(x.s), arr: null, dep: null, done: false });
    }
    for (const t of p.D.tun) {
      const a = Math.max(t[0], p.a), b = Math.min(t[1], p.b);
      if (b - a > 1) tun.push([to(a), to(b)]);
    }
    p.D.sig.forEach((g, i) => {
      if (g.s <= p.a || g.s > p.b) return;
      sig.push({ s: to(g.s), id: p.g.line === 0 ? g.id : `${net.lines[p.g.line].id}:${g.id}`, st: null, kind: g.kind, asp: g.asp });
      sigRef.push({ line: p.g.line, dir: p.g.dir, i });
    });
  });
  // the starting signals point to the stations of the corridor
  sig.forEach((g, i) => {
    const r = sigRef[i], src = directed(net.lines[r.line], r.dir).sig[r.i];
    if (src.st == null) return;
    const name = directed(net.lines[r.line], r.dir).st[src.st].name;
    const k = st.findIndex(x => x.name === name);
    g.st = k >= 0 ? k : null;
  });
  lim[lim.length - 1][1] = 1e9;
  const def: LineDef = { ...parts[0].D.def, name: it.map(g => net.lines[g.line].id + (g.dir < 0 ? ' (reverse)' : '')).join(' + ') };
  let rmin = Infinity;
  for (let k = 0; k < N; k++) { const r = 1 / Math.max(1e-9, Math.abs(K[k])); if (r < rmin) rmin = r; }
  const alts = prof.flatMap(g => [g.alt0, g.alt0 + (g.b - g.a) * g.i / 1000]);
  const line: CompiledLine = {
    def, len, N, X, Y, K, HEAD, prof, lim, st, tun, sig, rmin,
    imax: Math.max(...prof.map(g => Math.abs(g.i))), iup: Math.max(0, ...prof.map(g => g.i)),
    amin: Math.min(...alts), amax: Math.max(...alts), warnings: [],
  };
  return { line, legs, sigRef };
}

/** Rebuilds the limits of a corridor made of several lines from the current limits of its lines (temporary speed restrictions) */
export function refreshCorridorLimits(net: CompiledNetwork, cor: Corridor): void {
  if (!cor.sigRef) return;
  const lim: [number, number, number][] = [];
  for (const lg of cor.legs) {
    const D = directed(net.lines[lg.line], lg.dir);
    const pa = lg.lo === -Infinity ? 0 : lg.d0, pb = lg.hi === Infinity ? D.len : lg.d0 + (lg.hi - lg.c0);
    for (const l of D.lim) {
      const a = Math.max(l[0], pa), b = Math.min(l[1], pb);
      if (b > a) lim.push([lg.c0 + (a - lg.d0), lg.c0 + (b - lg.d0), l[2]]);
    }
  }
  lim[lim.length - 1][1] = 1e9;
  cor.line.lim = lim;
}

/** Copies on the signals of a corridor made of several lines the aspects of the signals of the lines they come from */
export function copyAspects(net: CompiledNetwork, cor: Corridor): void {
  if (!cor.sigRef) return;
  cor.sigRef.forEach((r, i) => { cor.line.sig[i].asp = directed(net.lines[r.line], r.dir).sig[r.i].asp; });
}

/**
 * Where a train with head at corridor chainage s and length len is on line `line`: head, length and direction in the
 * chainages of the directed line, clipped to the legs on that line; null if no part of the train is on it.
 * For a corridor that is a line itself the head is s and the length len, exactly.
 */
export function onLine(legs: CorridorLeg[], line: number, s: number, len: number): { head: number; len: number; dir: 1 | -1 } | null {
  for (const lg of legs) {
    if (lg.line !== line) continue;
    if (lg.lo === -Infinity && lg.hi === Infinity) return { head: lg.d0 + (s - lg.c0), len, dir: lg.dir };
    const front = Math.min(s, lg.hi), rear = Math.max(s - len, lg.lo);
    if (front < rear || (front === rear && len > 0)) continue;
    const head = lg.d0 + (front - lg.c0);
    return { head, len: front === s && rear === s - len ? len : front - rear, dir: lg.dir };
  }
  return null;
}

/** Corridor chainage of a chainage d of the directed line `line`/`dir`, if the corridor runs that way there */
export function toCorridor(legs: CorridorLeg[], line: number, dir: 1 | -1, d: number): number | null {
  for (const lg of legs) {
    if (lg.line !== line || lg.dir !== dir) continue;
    const c = lg.c0 + (d - lg.d0);
    if (c >= lg.lo - 1e-9 && c <= lg.hi + 1e-9) return c;
  }
  return null;
}
