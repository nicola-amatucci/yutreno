/**
 * Control room snapshot (docs/CONTROL_ROOM.md): the state of the traffic as an operator of a control centre sees it,
 * in one public, versioned object with English names. It is the only source of the control room of the page and of
 * the endpoint `/control-room` of the open data server; it only grows with optional fields, like the protocols.
 *
 * Chainages are those of each line (metres from its origin); a direction +1 runs towards the end of the line.
 */
import { directed } from './network';
import { capacityOf, occupancyLevel, type OccupancyLevel } from './passengers';
import { blockOccupiedBy } from './signalling';
import * as tfc from './traffic';
import type { Simulation } from './simulation';
import type { EventKind } from './types';
import type { PanelState } from '../trackside/types';

export const CONTROL_ROOM_VERSION = 1;

/** A signal of a line in a direction (on ETCS level 2 a marker board: its aspect is that of the block behind it) */
export interface CrSignal { id: string; s_m: number; dir: 1 | -1; kind: 'H' | 'P' | 'B' | string; aspect: 'G' | 'Y' | 'R' | null }

/** A block section of a direction, between two signals, occupied as the signals of that direction see it */
export interface CrBlock { from_m: number; to_m: number; dir: 1 | -1; occupied: boolean }

/** A single-track stretch between two stations and the direction it is open to (+1, −1, 0 free, null not oriented) */
export interface CrSingleTrack { from_m: number; to_m: number; orientation: 1 | -1 | 0 | null }

/** A track circuit of the interlocking trackside, with its state */
export interface CrSection { id: string; from_m: number; to_m: number; track: string; state: 'vacant' | 'occupied' | 'disturbed'; locked: boolean }

/** A point of the interlocking trackside, with its position */
export interface CrPoint { id: string; s_m: number; track: string; junction?: string; position: 'N' | 'R' | 'moving' | 'no_end_position'; locked: boolean; fault: boolean }

/** A route of the interlocking trackside that is not free, on the stretch it covers */
export interface CrRoute { id: string; name: string; from_m: number; to_m: number; dir: 1 | -1; state: string; track_from: string; track_to: string }

export interface CrLine {
  id: string;
  name: string;
  length_m: number;
  /**
   * Stations with the number of their tracks (1 at the ends of a line, 2 in the intermediate ones) and, with
   * passengers, the people waiting on the platforms (docs/PASSENGERS.md)
   */
  stations: { name: string; s_m: number; tracks: 1 | 2; waiting?: number }[];
  /** Directions some train runs along this line */
  directions: (1 | -1)[];
  signals: CrSignal[];
  blocks: CrBlock[];
  single_track: CrSingleTrack[];
  /** Stretches blocked by a disruption (main line) */
  blocked: { from_m: number; to_m: number }[];
  /** Trackside of the engine on a network: the node routes of this line and who holds them */
  node_routes?: { node: string; dir: 1 | -1; owner: string | null }[];
  /** Interlocking trackside: sections, points and the routes not free */
  sections?: CrSection[];
  points?: CrPoint[];
  routes?: CrRoute[];
}

export type CrTrainStatus = 'not_started' | 'running' | 'stopped' | 'dwelling' | 'broken_down' | 'cancelled' | 'finished';

export interface CrTrain {
  id: string;
  /** Name of the rolling stock */
  train: string;
  driver: 'controlled' | 'ato' | 'agent';
  status: CrTrainStatus;
  /** Lines of its itinerary, in running order */
  route: string[];
  /** Line and direction of the head, and its chainage on that line; null before the train appears and after it has left */
  line: string | null;
  dir: 1 | -1 | null;
  s_m: number | null;
  /** The stretch of every line the train is on, from its tail to its head (chainages of each line) */
  occupies: { line: string; from_m: number; to_m: number }[];
  v_kmh: number;
  /** Delay at the last stop served (arrival or departure), against the planned timetable */
  delay_s: number | null;
  next_stop: { station: string; planned_arrival_s: number | null; arrival_s: number | null } | null;
  /** Track at a station, when known (interlocking trackside) */
  track?: 'I' | 'II' | null;
  /** Service of the same block that this train becomes, and connections it waits for (optional) */
  next_service?: string;
  connections?: { from: string; station: string; outcome: string; wait_s: number }[];
  /** With passengers: people on board, capacity and occupancy level (docs/PASSENGERS.md) */
  passengers?: { onboard: number; seats: number; standing: number; occupancy: OccupancyLevel };
}

export interface CrEvent { t_s: number; train: string; kind: EventKind; text: string }

export interface ControlRoomSnapshot {
  type: 'control_room';
  version: number;
  t_s: number;
  signalling: 'ETCS' | 'BACC';
  trackside: 'simple' | 'interlocking' | 'external';
  network: { name: string; lines: CrLine[]; nodes: { name: string; lines: string[] }[] };
  trains: CrTrain[];
  /** The last events of all the trains, oldest first */
  log: CrEvent[];
  /** Interlocking trackside: the panel of the control centre as the trackside returned it */
  panel?: PanelState | null;
}

/**
 * The snapshot of a run (`Simulation.controlRoom`): it only reads the state of the run, and it is a function of it.
 */
/**
 * Snapshot of the traffic for the control room (docs/CONTROL_ROOM.md): network, signalling, trains and the last
 * `logLimit` events. It only reads the state of the run, and it is a function of it: two equal runs give equal snapshots.
 */
export function controlRoomSnapshot(sim: Simulation, logLimit = 200): ControlRoomSnapshot {
  const r1 = (x: number) => +x.toFixed(1), lines = sim.net.lines, tr = sim.tr;
  const ixlCfgs = tr ? [tr.cfg, ...(tr.cfg.network?.interlockings ?? [])] : [];
  const panel = tr?.panel ?? null;
  const tvpsState = new Map((panel?.tvps ?? []).map(t => [t.id, t]));
  const pointState = new Map((panel?.points ?? []).map(d => [d.id, d]));
  const routeState = new Map((panel?.routes ?? []).map(r => [r.id, r]));
  // with the interlocking trackside the orientation of a single-track segment is its block consent
  const consentOf = (a: string, b: string): 1 | -1 | 0 | null => {
    const c = panel?.consents?.find(x => x.segment === `${a}–${b}`);
    return !c ? null : c.holder == null ? 0 : c.holder === a ? 1 : -1;
  };
  const out: CrLine[] = lines.map((n, j) => {
    const L = n.L, len = L.len, dirs = [...sim.dirsOf[j]].sort((a, b) => b - a) as (1 | -1)[];
    const toLine = (x: number, d: 1 | -1) => r1(d > 0 ? x : len - x);
    const signals: CrLine['signals'] = [], blocks: CrLine['blocks'] = [];
    for (const d of dirs) {
      const D = directed(n, d), occ = tfc.occupantsFor(sim, j, d);
      D.sig.forEach((g, i) => {
        signals.push({ id: g.id, s_m: toLine(g.s, d), dir: d, kind: g.kind, aspect: (g.asp as 'G' | 'Y' | 'R' | undefined) ?? null });
        const b = i + 1 < D.sig.length ? D.sig[i + 1].s : D.len;
        const [x, y] = d > 0 ? [g.s, b] : [len - b, len - g.s];
        blocks.push({ from_m: r1(x), to_m: r1(y), dir: d, occupied: blockOccupiedBy(D, occ, i) });
      });
    }
    const o = sim.orients[j];
    const line: CrLine = {
      id: n.id, name: L.def.name, length_m: r1(len),
      stations: L.st.map((x, k) => ({
        name: x.name, s_m: r1(x.s), tracks: (k === 0 || k === L.st.length - 1 ? 1 : 2) as 1 | 2,
        ...(sim.pax ? { waiting: r1(sim.pax.waitingAt(x.name, sim.time)) } : {}),
      })),
      directions: dirs, signals, blocks,
      single_track: tfc.singleTrack(sim, j).map(([a, b], k) => ({ from_m: r1(a), to_m: r1(b), orientation: tr ? consentOf(L.st[k].name, L.st[k + 1].name) : o.length ? (o[k] as 1 | -1 | 0) : null })),
      blocked: j === 0 ? sim.blocks.map(([a, b]) => ({ from_m: a, to_m: b })) : [],
    };
    const gates = sim.gates.filter(g => g.line === j);
    if (gates.length) line.node_routes = gates.map(g => ({ node: g.node, dir: g.dir, owner: g.owner ? g.owner.run.id : null }));
    const c = ixlCfgs[j];
    if (c) {
      line.sections = c.tvps.map(t => ({ id: t.id, from_m: t.from_m, to_m: t.to_m, track: t.branch, state: tvpsState.get(t.id)?.state ?? 'vacant', locked: !!tvpsState.get(t.id)?.locked }));
      line.points = c.points.map(d => {
        const q = pointState.get(d.id);
        return { id: d.id, s_m: d.s_m, track: d.reverse_branch, ...(d.junction ? { junction: d.junction } : {}), position: q?.position ?? 'N', locked: !!q?.locked, fault: !!q?.fault };
      });
      line.routes = c.routes.filter(r => !r.automatic && routeState.get(r.id) && routeState.get(r.id)?.state !== 'free').map(r => ({
        id: r.id, name: r.name, from_m: Math.min(r.start_m, r.end_m), to_m: Math.max(r.start_m, r.end_m), dir: (r.dir ?? 1) as 1 | -1,
        state: routeState.get(r.id)?.state as string, track_from: r.branch_start, track_to: r.branch_end,
      }));
    }
    return line;
  });
  const trains: CrTrain[] = sim.trains.map(r => {
    const S = r.S, on = r.active && !S.finished;
    const occupies: CrTrain['occupies'] = [];
    let head: { line: string; dir: 1 | -1; s: number } | null = null;
    if (on) for (let j = 0; j < lines.length; j++) {
      const p = tfc.presence(sim, r, j);
      if (!p) continue;
      const [a, b] = tfc.span(sim, p, j);
      if (b - a > 0.01 || (!head && p.len === 0)) occupies.push({ line: lines[j].id, from_m: r1(a), to_m: r1(b) });
      // the head is on the line whose leg contains it
      const lg = r.legs.find(g => g.line === j && S.s >= g.lo - 1e-6 && S.s <= g.hi + 1e-6);
      if (lg && !head) head = { line: lines[j].id, dir: p.dir, s: r1(p.dir > 0 ? p.head : lines[j].L.len - p.head) };
    }
    let delay: number | null = null;
    for (let k = r.realised.length - 1; k >= 0 && delay == null; k--) {
      const re = r.realised[k], pl = r.plan.find(x => x.name === re.station);
      if (!pl) continue;
      if (re.departure_s != null && pl.dep != null) delay = re.departure_s - pl.dep;
      else if (re.arrival_s != null && pl.arr != null && k > 0) delay = re.arrival_s - pl.arr;
    }
    const next = on ? r.stations[S.nextSt] : !r.active && !S.finished ? r.stations[0] : undefined;
    const status: CrTrain['status'] = r.cancelled === 'all' ? 'cancelled' : S.finished ? 'finished' : !r.active ? 'not_started'
      : sim.time < r.heldUntil ? 'broken_down' : S.doors ? 'dwelling' : S.v < 0.1 ? 'stopped' : 'running';
    let track: 'I' | 'II' | null | undefined;
    if (tr && on) {
      const br = tr.fields.flatMap(f => [...f.branchesOf(r === sim.train ? 0 : r.fieldIndex)]);
      track = br.some(b => b.startsWith('II:') || b.includes(':II:')) ? 'II' : null;
    }
    const conns = sim.connections.filter(c => c.to === r);
    const nextSv = sim.trains.find(x => x.after === r);
    return {
      id: r.id, train: r.TR.name, driver: r.driver, status, route: (r.itin ?? [{ line: r.legs[0].line }]).map(g => lines[g.line].id),
      line: head?.line ?? null, dir: head?.dir ?? null, s_m: head?.s ?? null, occupies, v_kmh: r1(S.v * 3.6),
      delay_s: delay == null ? null : r1(delay),
      next_stop: next ? { station: next.name, planned_arrival_s: r.plan.find(x => x.name === next.name)?.arr ?? null, arrival_s: next.arr } : null,
      ...(track !== undefined ? { track } : {}),
      ...(nextSv ? { next_service: nextSv.id } : {}),
      ...(conns.length ? { connections: conns.map(c => ({ from: c.from.id, station: c.station, outcome: c.outcome, wait_s: r1(c.wait_s) })) } : {}),
      ...(sim.pax ? (() => { const cap = capacityOf(r.TR), n = sim.pax.onboard(r.id); return { passengers: { onboard: r1(n), seats: cap.seats, standing: cap.standing, occupancy: occupancyLevel(n, cap) } }; })() : {}),
    };
  });
  // the events of all the trains, in the order they happened (ties: order of the trains, then of the events)
  const log = sim.trains.flatMap((r, i) => r.S.events.map((e, k) => ({ e, i, k, id: r.id })))
    .sort((a, b) => a.e.t - b.e.t || a.i - b.i || a.k - b.k).slice(-logLimit)
    .map(x => ({ t_s: r1(x.e.t), train: x.id, kind: x.e.kind, text: x.e.text }));
  return {
    type: 'control_room', version: CONTROL_ROOM_VERSION, t_s: r1(sim.time), signalling: sim.scen.sig,
    trackside: sim.scen.sig === 'ETCS' ? (sim.scen.trackside ?? 'simple') : 'simple',
    network: { name: sim.net.name, lines: out, nodes: sim.net.nodes.map(nd => ({ name: nd.name, lines: nd.lines.map(j => lines[j].id) })) },
    trains, log, ...(tr ? { panel: panel ? JSON.parse(JSON.stringify(panel)) as PanelState : null } : {}),
  };
}
