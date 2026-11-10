/**
 * The traffic of several trains on the lines of a run (phase 8, R1): node routes and their claims, and the constants
 * that time the appearance of the services and the claims of the node routes (docs/design/network.md).
 */
import type { NodeMove } from './field';
import { toEnglish } from './legacy';
import { copyAspects, directed, onLine } from './network';
import type { ScenarioDef, ServiceDef } from './scenario';
import { ETCS, authorityFromSignals, blockOccupiedBy, type Occupant } from './signalling';
import * as brd from './boarding';
import type { Simulation, TrainRun } from './simulation';
import type { MovementAuthority, Station } from './types';

/** A service train appears at its origin this many seconds before its departure, if the station is free */
export const SERVICE_LEAD = 60;
/** Distance before the signal in front of a node within which a train asks for the node route (m) */
export const NODE_WINDOW = 3000;
/** Distance (m) of the starting signal after a station: the single-track sections begin and end there */
export const STATION_EXIT = 250;
/** A train closer than this to the signal in front of a node is committed and gets the node route first (m) */
export const NODE_COMMIT = 1500;

/**
 * Node route (network, trackside of the engine): where trains from another line join line `line` in direction `dir`
 * at node `node`, the station of the node on that line is given to one train at a time, from the signal in front of
 * the node until its tail passes the starting signal after it. The trains that join from another line see that
 * signal red on their corridor while another train holds the route; those that come along the line itself see it
 * held on the line.
 */
export interface NodeGate {
  node: string;
  line: number;
  dir: 1 | -1;
  /** Index of the last signal of the line before the node and chainage of the first one after it, in the directed line */
  approach: number | null;
  exit: number | null;
  claims: NodeClaim[];
  owner: NodeClaim | null;
}
export interface NodeClaim {
  run: TrainRun;
  /** Joins from another line, runs along the line through the node, or starts at the node */
  kind: 'join' | 'through' | 'origin';
  /** Corridor chainage of the signal in front of the node (−∞ for a train starting there) and index of that signal in the corridor */
  signal: number;
  sigIndex: number;
  /** Corridor chainage of the starting signal after the node, null if the train ends there */
  exit: number | null;
  /** Timetabled time at the node, +∞ if it does not stop there */
  t: number;
  done: boolean;
}

export const moveKey = (m: NodeMove): string => [m.node, m.from, m.fromDir, m.to, m.toDir].join('|');

/**
 * Authority of a train from the aspects of the signals of its corridor: up to the first red signal ahead. For a
 * corridor of several lines the reason comes from the line the signal belongs to
 */
export function authority(sim: Simulation, run: TrainRun, occ: Map<string, Occupant[]>): MovementAuthority {
  const lg = run.legs[0];
  if (!run.cor.sigRef) return authorityFromSignals(run.line, occ.get(lg.line + ':' + lg.dir) ?? occupantsFor(sim, lg.line, lg.dir), run.S.s);
  const sg = run.line.sig, ref = run.cor.sigRef;
  for (let i = 0; i < sg.length; i++) {
    if (sg[i].s <= run.S.s || sg[i].asp !== 'R') continue;
    const r = ref[i], D = directed(sim.net.lines[r.line], r.dir);
    const why = gateHeld(sim, run, i) ? 'node route given to another train' : blockOccupiedBy(D, occ.get(r.line + ':' + r.dir) ?? occupantsFor(sim, r.line, r.dir), r.i) ? 'section occupied' : 'departure not yet authorised';
    return { eoa: sg[i].s, svl: sg[i].s + ETCS.overlap, why };
  }
  return { eoa: run.line.len - 15, svl: run.line.len, why: 'end of line' };
}

/**
 * True if signal i of the line of a train (single line, in its direction) is at danger for that train: held for its own
 * departure or for the single-track orientation, or protecting a section occupied by another train or a blocked stretch;
 * with `spacedByRear` (the moving block, where the trains ahead are spaced by their rear ends) only by a train in the
 * other direction or a blocked stretch. The departure
 * hold is the one of this train even once its head is past the signal, when `heldSignals` already looks at the train
 * behind
 */
export function atDangerFor(sim: Simulation, run: TrainRun, i: number, spacedByRear = false): boolean {
  const lg = run.legs[0], L = directed(sim.net.lines[lg.line], lg.dir), sg = L.sig[i], orient = sim.orients[lg.line];
  if (sg.st != null) {
    const k = sg.st as number, st = run.stations.find(x => x.name === L.st[k].name);
    if (st && st.dep != null && sim.time < st.dep) return true;
    if (orient.length && sg.kind === 'P') {
      const m = lg.dir > 0 ? k : L.st.length - 2 - k;
      if (m >= 0 && m < orient.length && orient[m] !== lg.dir) return true;
    }
  }
  const others = sim.trains.filter(r => r !== run);
  const occ = occupantsFor({ ...sim, trains: others } as Simulation, lg.line, lg.dir, !spacedByRear);
  return blockOccupiedBy(run.line, occ, i);
}

/**
 * Moving block (single line): the authority of a train from the signals that protect stations, single track, blocked
 * stretches and departures, without the block sections occupied by the trains running in its direction; it ends
 * `sim.mb.margin` behind the confirmed rear end the RBC has for the nearest of them ahead (X2Rail-5 "L3 margin"),
 * whose danger point is that rear end. A train ahead whose rear end the RBC does not know yet is spaced by the fixed
 * block. The rear end is never moved forwards: it is the one of the last report with integrity confirmed that has
 * reached the RBC, so with integrity lost or the radio silent it stays where it was
 */
export function movingAuthority(sim: Simulation, run: TrainRun): MovementAuthority {
  const mb = sim.mb!, L = run.line, len = sim.L.len, dir = run.dir, pos = run.S.s;
  const occ = occupantsFor(sim, 0, dir, false), held = heldSignals(sim, 0, dir);
  let rear: number | null = null;
  for (const r of sim.trains) {
    if (r === run || !r.active || r.S.finished || !r.ob) continue;
    const p = presence(sim, r, 0);
    if (!p || p.dir !== dir || p.head <= pos) continue;
    const c = r.ob.rbc.confirmedRear(r.ob.engine, sim.time, mb.delay);
    if (c == null) { occ.push({ head: p.head, len: p.len }); continue; }
    const s = dir > 0 ? c : len - c;
    if (rear == null || s < rear) rear = s;
  }
  let ma: MovementAuthority = { eoa: L.len - 15, svl: L.len, why: 'end of line' };
  for (let i = 0; i < L.sig.length; i++) {
    if (L.sig[i].s <= pos) continue;
    if (held.has(i)) { ma = { eoa: L.sig[i].s, svl: L.sig[i].s + ETCS.overlap, why: 'departure not yet authorised' }; break; }
    if (blockOccupiedBy(L, occ, i)) { ma = { eoa: L.sig[i].s, svl: L.sig[i].s + ETCS.overlap, why: 'section occupied' }; break; }
  }
  if (rear != null && rear - mb.margin < ma.eoa) ma = { eoa: rear - mb.margin, svl: rear, why: 'moving block: train ahead' };
  return ma;
}

/**
 * Chainage on the main line of the point s of the corridor of a train, null where the corridor is on another line
 * of the network. For a train on the main line it is s, or len − s against the nominal direction
 */
export function mainChainage(sim: Simulation, r: TrainRun, s: number = r.S.s): number | null {
  if (!r.cor.sigRef) return r.legs[0].line !== 0 ? null : r.dir > 0 ? s : sim.L.len - s;
  const p = onLine(r.legs, 0, s, 0);
  return p ? (p.dir > 0 ? p.head : sim.L.len - p.head) : null;
}

/** Where a train is on line j: head and length in the chainages of the directed line, and the direction; null if it is not on it (internal, also read by control-room.ts) */
export function presence(sim: Simulation, r: TrainRun, j: number): { head: number; len: number; dir: 1 | -1 } | null { return onLine(r.legs, j, r.S.s, r.TR.L); }

/** Extent [rear, front] of a presence on line j, in the chainages of the line (internal, also read by control-room.ts) */
export function span(sim: Simulation, p: { head: number; len: number; dir: 1 | -1 }, j: number): [number, number] {
  const len = sim.net.lines[j].L.len;
  return p.dir > 0 ? [p.head - p.len, p.head] : [len - p.head, len - p.head + p.len];
}

/** Head of a train in the chainages of line j run in direction dir, also before it reaches that line; null if its itinerary does not run that way (internal, also called by regulator-bridge.ts) */
export function headOn(sim: Simulation, r: TrainRun, j: number, dir: 1 | -1): number | null {
  for (const lg of r.legs) if (lg.line === j && lg.dir === dir) return lg.d0 + (r.S.s - lg.c0);
  return null;
}

/**
 * Single-track sections between stations of line j, in the chainages of the line: from the starting signal of a
 * station to the starting signal of the next one in the opposite direction. Stations have a track for each direction.
 * Internal, also read by control-room.ts.
 */
export function singleTrack(sim: Simulation, j = 0): [number, number][] {
  const st = sim.net.lines[j].L.st, out: [number, number][] = [];
  for (let k = 0; k + 1 < st.length; k++) out.push([st[k].s + STATION_EXIT, st[k + 1].s - STATION_EXIT]);
  return out;
}

/**
 * Two trains on the same stretch of line between two stations, where the line has one track (from the starting signal
 * of a station to that of the next): pairs of trains whose extents overlap there, with the stretch, as keys
 * `<id>|<id>|<line>:<station>` (internal, called by Simulation once per step with several trains). Nothing in the
 * engine stops trains from running into each other: this only detects it. In stations each direction has its own
 * track and trains may stand side by side, so stations are left out.
 */
export function sameStretch(sim: Simulation): Map<string, { a: TrainRun; b: TrainRun; from: string; to: string }> | null {
  let out: Map<string, { a: TrainRun; b: TrainRun; from: string; to: string }> | null = null;
  const ts = sim.trains;
  for (let j = 0; j < sim.net.lines.length; j++) {
    for (let x = 0; x < ts.length; x++) {
      const rx = ts[x];
      if (!rx.active || rx.S.finished) continue;
      const px = presence(sim, rx, j);
      if (!px) continue;
      for (let y = x + 1; y < ts.length; y++) {
        const ry = ts[y];
        if (!ry.active || ry.S.finished) continue;
        const py = presence(sim, ry, j);
        if (!py) continue;
        const [ax, bx] = span(sim, px, j), [ay, by] = span(sim, py, j);
        const a = Math.max(ax, ay), b = Math.min(bx, by);
        if (b <= a) continue;
        const st = sim.net.lines[j].L.st;
        for (let k = 0; k + 1 < st.length; k++) if (Math.min(b, st[k + 1].s - STATION_EXIT) > Math.max(a, st[k].s + STATION_EXIT)) {
          (out ??= new Map()).set(rx.id + '|' + ry.id + '|' + j + ':' + k, { a: rx, b: ry, from: st[k].name, to: st[k + 1].name });
        }
      }
    }
  }
  return out;
}

/**
 * Trains as seen by the signals of line j in a direction, in the chainages of that direction: the trains running
 * in that direction on the line (and, on the main line, the train ahead) wherever they are, the trains of the
 * opposite direction only for the part of them that is on single track.
 * Internal, also read by control-room.ts.
 */
export function occupantsFor(sim: Simulation, j: number, dir: 1 | -1, sameDir = true): Occupant[] {
  const occ: Occupant[] = [], len = sim.net.lines[j].L.len, seg = singleTrack(sim, j);
  for (const r of sim.trains) {
    if (!r.active || r.S.finished) continue;
    const p = presence(sim, r, j);
    if (!p) continue;
    if (p.dir === dir) { if (sameDir) occ.push({ head: p.head, len: p.len }); continue; }
    // only the part on single track: in a station each direction has its own track
    const [a0, b0] = span(sim, p, j);
    for (const [x, y] of seg) {
      const a = Math.max(a0, x), b = Math.min(b0, y);
      if (b > a) occ.push(dir > 0 ? { head: b, len: b - a } : { head: len - a, len: b - a });
    }
  }
  if (j === 0) {
    // a blocked stretch is protected by the signals of both directions as if a train stood on it
    for (const [a, b] of sim.blocks) occ.push(dir > 0 ? { head: b, len: b - a } : { head: len - a, len: b - a });
  }
  return occ;
}

/** Train of direction dir waiting for or approaching the starting signal into single-track section k of line j, if it wants to enter */
function wanting(sim: Simulation, j: number, k0: number, dir: 1 | -1, heads: readonly HeadOn[] = headsOn(sim, j, dir)): TrainRun | null {
  const L = directed(sim.net.lines[j], dir);
  const k = dir > 0 ? k0 : L.st.length - 2 - k0;   // station index on the line of that direction
  const sg = L.sig.find(x => x.kind === 'P' && x.st === k);
  if (!sg) return null;
  let near: TrainRun | null = null, hn = -Infinity;
  const lo = L.st[k].s - 800;
  for (const { r, h } of heads) if (h < sg.s && h > lo && (!near || h > hn)) { near = r; hn = h; }
  if (!near || near.S.doors) return null;
  const st = near.stations.find(x => x.name === L.st[k].name);
  if (st && st.dep != null && sim.time < st.dep) return null;
  return near;
}

/** A running train and its head on a line in a direction */
interface HeadOn { r: TrainRun; h: number }

/**
 * The heads of the running trains on line j in direction dir, in the order of the trains: computed once for all the
 * signals or sections a function looks at in a step, where the trains do not move
 */
function headsOn(sim: Simulation, j: number, dir: 1 | -1): HeadOn[] {
  const out: HeadOn[] = [];
  for (const r of sim.trains) {
    if (!r.active || r.S.finished) continue;
    const h = headOn(sim, r, j, dir);
    if (h != null) out.push({ r, h });
  }
  return out;
}

/**
 * Orientation of each single-track section of line j (the consent of a single-line block): a direction gets the
 * section when a train of that direction wants to enter it and no train of the other direction is on it; it keeps
 * it while its trains are on it or want to enter, and releases it otherwise. With two requests the earlier
 * timetabled departure wins, the forward direction on a tie.
 */
export function updateOrientation(sim: Simulation, j: number): void {
  const seg = singleTrack(sim, j), orient = sim.orients[j];
  // where the running trains are on the line, and their heads in each direction: once for all the sections
  const spans: { dir: 1 | -1; a: number; b: number }[] = [];
  for (const r of sim.trains) {
    if (!r.active || r.S.finished) continue;
    const x = presence(sim, r, j);
    if (!x) continue;
    const [a, b] = span(sim, x, j);
    spans.push({ dir: x.dir, a, b });
  }
  const headsF = headsOn(sim, j, 1), headsR = headsOn(sim, j, -1);
  for (let k = 0; k < seg.length; k++) {
    const [p, q] = seg[k];
    let onF = false, onR = false;
    for (const x of spans) if (x.b > p && x.a < q) { if (x.dir === 1) onF = true; else if (x.dir === -1) onR = true; }
    const wF = wanting(sim, j, k, 1, headsF), wR = wanting(sim, j, k, -1, headsR);
    const cur = orient[k] ?? 0;
    if (cur === 1 && !onF && !wF) orient[k] = 0;
    if (cur === -1 && !onR && !wR) orient[k] = 0;
    if (orient[k] === 0) {
      if (onF && !onR) orient[k] = 1;
      else if (onR && !onF) orient[k] = -1;
      else if (!onF && !onR && (wF || wR)) {
        // the regulator's priority first, then the earlier timetabled departure
        const pF = wF ? wF.priority : -Infinity, pR = wR ? wR.priority : -Infinity;
        orient[k] = pF !== pR ? (pF > pR ? 1 : -1) : departureAt(sim, j, k, wF, 1) <= departureAt(sim, j, k, wR, -1) ? 1 : -1;
      }
    }
  }
}

/** Timetabled departure of a train from the station that opens single-track section k of line j in a direction */
function departureAt(sim: Simulation, j: number, k: number, r: TrainRun | null, dir: 1 | -1): number {
  if (!r) return Infinity;
  const L = directed(sim.net.lines[j], dir), i = dir > 0 ? k : L.st.length - 2 - k;
  return r.stations.find(x => x.name === L.st[i].name)?.dep ?? sim.time;
}

/** Indices of the signals of a line that belong to a station, in order: the signals do not change during a run */
const STATION_SIGNALS = new WeakMap<readonly { st?: number | null }[], number[]>();
function stationSignals(sg: readonly { st?: number | null }[]): number[] {
  let out = STATION_SIGNALS.get(sg);
  if (!out) {
    out = [];
    for (let i = 0; i < sg.length; i++) if (sg[i].st != null) out.push(i);
    STATION_SIGNALS.set(sg, out);
  }
  return out;
}

/**
 * Signals of line j held for a direction: starting signals whose nearest train has not reached its departure time
 * there and, with trains in both directions, the starting signals into a single-track section not oriented for it.
 */
export function heldSignals(sim: Simulation, j: number, dir: 1 | -1): Set<number> {
  const L = directed(sim.net.lines[j], dir), orient = sim.orients[j];
  const held = new Set<number>(), sg = L.sig, heads = headsOn(sim, j, dir);
  for (const i of stationSignals(sg)) {
    const k = sg[i].st as number;
    let near: TrainRun | null = null, hn = -Infinity;
    for (const { r, h } of heads) if (h < sg[i].s && (!near || h > hn)) { near = r; hn = h; }
    if (near) {
      const st = near.stations.find(x => x.name === L.st[k].name);
      if (st && st.dep != null && sim.time < st.dep) held.add(i);
    }
    if (orient.length && sg[i].kind === 'P') {
      const m = dir > 0 ? k : L.st.length - 2 - k;
      if (m >= 0 && m < orient.length && orient[m] !== dir) held.add(i);
    }
  }
  // the signal in front of a node whose route is held by a train joining from another line or starting there
  for (const g of sim.gates) if (g.line === j && g.dir === dir && g.approach != null && g.owner && g.owner.kind !== 'through') held.add(g.approach);
  return held;
}

/**
 * The node routes of the network: one for every line and direction that some train joins at a node from another
 * line, with the claims of the trains that join it there, run along it through the node or start at the node.
 * Internal, also called by commands.ts.
 */
export function buildGates(sim: Simulation): NodeGate[] {
  const gates: NodeGate[] = [];
  const gate = (node: string, line: number, dir: 1 | -1): NodeGate => {
    let g = gates.find(x => x.node === node && x.line === line && x.dir === dir);
    if (!g) {
      const D = directed(sim.net.lines[line], dir), dN = (D.st.find(x => x.name === node) as Station).s;
      let approach: number | null = null, exit: number | null = null;
      D.sig.forEach((x, i) => { if (x.s < dN) approach = i; else if (exit == null && x.s > dN) exit = x.s; });
      g = { node, line, dir, approach, exit, claims: [], owner: null };
      gates.push(g);
    }
    return g;
  };
  // where some train joins a line from another one
  for (const r of sim.trains) for (let k = 1; k < r.legs.length; k++) {
    const name = r.line.st.find(x => Math.abs(x.s - r.legs[k].c0) < 1e-6)?.name;
    if (name) gate(name, r.legs[k].line, r.legs[k].dir);
  }
  const tAt = (r: TrainRun, name: string) => { const st = r.stations.find(x => x.name === name); return st ? st.arr ?? st.dep ?? Infinity : Infinity; };
  for (const g of gates) {
    const D = directed(sim.net.lines[g.line], g.dir), dN = (D.st.find(x => x.name === g.node) as Station).s;
    for (const r of sim.trains) {
      const lg = r.legs.find(x => x.line === g.line && x.dir === g.dir);
      if (!lg) continue;
      const cN = lg.c0 + (dN - lg.d0);
      if (cN < lg.lo - 1e-6 || cN > lg.hi + 1e-6) continue;
      const exit = g.exit == null ? null : lg.c0 + (g.exit - lg.d0);
      const before = r.line.sig.filter(x => x.s < cN - 1e-6);
      const kind: NodeClaim['kind'] = Math.abs(cN - lg.lo) < 1e-6 ? 'join' : Math.abs(r.stations[0].s - cN) < 1 ? 'origin' : 'through';
      if (kind === 'origin') { g.claims.push({ run: r, kind, signal: -Infinity, sigIndex: -1, exit, t: tAt(r, g.node), done: false }); continue; }
      if (!before.length) continue;
      g.claims.push({ run: r, kind, signal: before[before.length - 1].s, sigIndex: before.length - 1, exit, t: tAt(r, g.node), done: false });
    }
  }
  return gates;
}

/**
 * Node routes: the owner releases its route when its tail has passed the starting signal after the node; a free
 * route goes to the committed train nearest to its signal, otherwise to the earliest one in the timetable
 */
export function updateGates(sim: Simulation): void {
  for (const g of sim.gates) {
    const o = g.owner;
    if (o && (o.run.S.finished || (o.exit != null && o.run.S.s - o.run.TR.L > o.exit))) { o.done = true; g.owner = null; }
    if (g.owner) continue;
    let best: NodeClaim | null = null, bestKey: [number, number, number] | null = null;
    g.claims.forEach((c, i) => {
      if (c.done || c.kind === 'origin' || !c.run.active || c.run.S.finished) return;
      const d = c.signal - c.run.S.s;
      if (d < 0 || d > NODE_WINDOW) return;
      const key: [number, number, number] = d < NODE_COMMIT ? [0, d, i] : [1, c.t, i];
      const k0 = bestKey as [number, number, number] | null;
      if (!k0 || key[0] < k0[0] || (key[0] === k0[0] && (key[1] < k0[1] || (key[1] === k0[1] && key[2] < k0[2])))) { best = c; bestKey = key; }
    });
    g.owner = best;
  }
}

/** A train that starts at a node appears only when the node route is free, and takes it */
export function gateFree(sim: Simulation, run: TrainRun): boolean {
  for (const g of sim.gates) {
    const c = g.claims.find(x => x.run === run && x.kind === 'origin' && !x.done);
    if (c && g.owner && g.owner !== c) return false;
  }
  for (const g of sim.gates) {
    const c = g.claims.find(x => x.run === run && x.kind === 'origin' && !x.done);
    if (c) g.owner = c;
  }
  return true;
}

/** True if signal i of the corridor of a train is held for it because another train has the node route */
export function gateHeld(sim: Simulation, run: TrainRun, i: number): boolean {
  return sim.gates.some(g => g.owner && g.owner.run !== run && g.claims.some(c => c.run === run && !c.done && c.kind === 'join' && c.sigIndex === i && run.S.s < c.signal));
}

/** On the corridors of the trains that join a line at a node, the signal in front of the node is red while another train has the node route */
export function gateAspects(sim: Simulation): void {
  for (const g of sim.gates) {
    if (!g.owner) continue;
    for (const c of g.claims) {
      if (c === g.owner || c.done || c.kind !== 'join' || c.run.S.s >= c.signal) continue;
      const sg = c.run.line.sig;
      sg[c.sigIndex].asp = 'R';
      if (c.sigIndex > 0 && sg[c.sigIndex - 1].asp === 'G') sg[c.sigIndex - 1].asp = 'Y';
    }
  }
}

/** True if the platform of the origin of a service is free */
export function originFree(sim: Simulation, run: TrainRun): boolean {
  const lg = run.legs[0], s0 = lg.d0 + (run.stations[0].s - lg.c0);
  return occupantsFor(sim, lg.line, lg.dir).every(o => o.head < s0 - run.TR.L - 100 || o.head - o.len > s0 + 300);
}

/** A service train appears at its origin, at standstill with doors closed, waiting for its departure time */
export function activate(sim: Simulation, run: TrainRun): void {
  run.active = true;
  run.S.t = sim.time;
  run.realised[0].arrival_s = sim.time;
  // doors open until the timetabled departure; closing them moves the train on to its first stop
  run.S.doors = true; run.S.doorT = 0; run.S.nextSt = 0;
  run.S.doorDue = Math.max(sim.time + run.dwells[0], run.stations[0].dep ?? -Infinity);
  brd.paxOpen(sim, run, 0);
  // the next service of a block leaves not before the arrival of the previous one plus the turnaround
  if (run.after) {
    const arr = run.after.realised[run.after.realised.length - 1]?.arrival_s ?? sim.time;
    run.S.doorDue = Math.max(run.S.doorDue, arr + run.turnaround);
  }
  copyAspects(sim.net, run.cor);
  run.S.ma = authority(sim, run, new Map());
  run.S.sup = sim.supervise(run.S.s, 0, run);
  sim.event('INFO', 'Service ' + run.id + ' ready at ' + run.stations[0].name, false, run);
}

/**
 * Rolling stock circulations: the services with the same block are chained in the order of their departures; each
 * one starts where the previous one ended, with its train when it has none of its own
 */
export function linkBlocks(sim: Simulation, scenario: ScenarioDef | null): void {
  const turn = scenario?.min_turnaround_s ?? 300;
  const svc = new Map((scenario?.services ?? []).map(sv => [sv.id, toEnglish<ServiceDef>(sv)]));
  const blocks = new Map<string, TrainRun[]>();
  for (const r of sim.trains) { const b = svc.get(r.id)?.block; if (b) blocks.set(b, [...(blocks.get(b) ?? []), r]); }
  for (const [b, rs] of blocks) {
    for (const r of rs) r.block = b;
    rs.sort((x, y) => (x.stations[0].dep as number) - (y.stations[0].dep as number) || sim.trains.indexOf(x) - sim.trains.indexOf(y));
    for (let i = 1; i < rs.length; i++) {
      const a = rs[i - 1], n = rs[i], end = a.stations[a.stations.length - 1].name;
      if (n.stations[0].name !== end) throw new Error(`block ${b}: ${n.id} starts at ${n.stations[0].name}, but ${a.id} ends at ${end}`);
      n.after = a; n.turnaround = turn;
    }
  }
}

/**
 * True while a departing train keeps its doors open for a connection at sim station: until the feeder has arrived
 * and the transfer time has passed, but not beyond the departure plus the maximum wait; the outcome is recorded
 * when the doors close
 */
export function waitConnection(sim: Simulation, run: TrainRun, station: string | undefined, t: number): boolean {
  if (!sim.connections.length || !station) return false;
  let wait = false;
  for (const c of sim.connections) {
    if (c.to !== run || c.station !== station || c.outcome !== 'pending') continue;
    const dep = run.stations.find(x => x.name === station)?.dep ?? t;
    const arr = c.from.realised.find(x => x.station === station)?.arrival_s ?? null;
    if (arr != null && t + 1e-9 >= arr + c.transfer) continue;
    if (c.from.cancelled === 'all' || (c.from.S.finished && arr == null)) continue;
    if (t + 1e-9 < dep + c.maxWait) { wait = true; continue; }
  }
  if (wait) return true;
  // the doors close: outcome of the connections of sim train here
  for (const c of sim.connections) {
    if (c.to !== run || c.station !== station || c.outcome !== 'pending') continue;
    const dep = run.stations.find(x => x.name === station)?.dep ?? t;
    const arr = c.from.realised.find(x => x.station === station)?.arrival_s ?? null;
    c.outcome = arr != null && t + 1e-9 >= arr + c.transfer ? 'kept' : 'lost';
    c.wait_s = +Math.max(0, t - dep).toFixed(1);
    sim.event(c.outcome === 'kept' ? 'INFO' : 'WARN', `Connection at ${station} from ${c.from.id}: ${c.outcome}` + (c.wait_s > 0 ? `, ${c.wait_s} s of wait` : ''), false, run);
  }
  return false;
}
