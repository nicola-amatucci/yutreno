/**
 * The exchanges of the engine with the interlocking trackside (phase 8, R1): the field of every line stepped with
 * the trains on it, the configuration sent on the first exchange (corridors of the trains off the main line, node
 * movements, timetables of the services for the automatic route setting), the request and the response of a cycle,
 * with the radio messages routed to the train they are addressed to (docs/TRACKSIDE.md, docs/design/protocols.md).
 * `Simulation` keeps `tracksideDue`, `tracksideRequest` and `tracksideResponse` as its methods.
 */
import { FIXED_DT } from './dynamics';
import type { NodeMove } from './field';
import { toEnglish } from './legacy';
import { onLine, type ItineraryLeg } from './network';
import type { OnboardState, Simulation, TracksideState, TrainRun } from './simulation';
import type { RadioMessage } from './types';
import type { CorridorConfig, TimetableEntry, TracksideConfig, TracksideRequest, TracksideResponse } from '../trackside';

/** Trains on the field: the controlled train and the services, the train ahead among them (on the line once they appeared) */
function fieldTrains(sim: Simulation) {
  return [
    // a train that has finished its run has left the line
    { head: sim.S ? sim.S.s : 0, len: sim.TR.L, on: !(sim.S && sim.S.finished && sim.multi) },
    ...sim.trains.slice(1).map(r => ({ head: sim.headLine(r), len: r.TR.L, on: r.active && !r.S.finished })),
  ];
}

/** Advances the field of every line */
export function fieldStep(sim: Simulation, t: number): void {
  const tr = sim.tr as TracksideState;
  tr.field.step(t, sim.networked ? fieldTrainsOn(sim, 0) : fieldTrains(sim));
  for (let j = 1; j < tr.fields.length; j++) tr.fields[j].step(t, fieldTrainsOn(sim, j));
}

/** Trains on the field of line j of a network: the part of each one on that line, in its chainages; on the main line also the controlled train */
function fieldTrainsOn(sim: Simulation, j: number) {
  const len = sim.net.lines[j].L.len, off = { head: 0, len: 0, on: false };
  const own = j === 0 ? fieldTrains(sim)[0] : off;
  return [own, ...sim.trains.slice(1).map(r => {
    const p = r.active && !r.S.finished ? onLine(r.legs, j, r.S.s, r.TR.L) : null;
    return p ? { head: p.dir > 0 ? p.head : len - p.head, len: p.len, on: p.len > 0 } : off;
  })];
}

/** A train off the main line for the trackside: its balise groups, limits, gradients and the legs of its corridor */
export function corridorConfig(sim: Simulation, r: TrainRun): CorridorConfig {
  const ob = r.ob as OnboardState, Lc = r.line;
  return {
    engine: ob.engine, length_m: Lc.len, balises: ob.bgs.map(b => ({ NID_BG: b.NID_BG, s_m: b.s })),
    limits: ob.baseLim.map(l => [l[0], Math.min(l[1], Lc.len + 1000), l[2]] as [number, number, number]), gradients: Lc.prof.map(g => [g.a, g.b, g.i] as [number, number, number]),
    legs: r.legs.map(g => ({ line: sim.net.lines[g.line].id, dir: g.dir, c0_m: g.c0, d0_m: g.d0, from_m: isFinite(g.lo) ? g.lo : null, to_m: isFinite(g.hi) ? g.hi : null })),
  };
}

/** The movements through the nodes of the network, from the itineraries of the trains (or of one itinerary) */
export function nodeMoves(sim: Simulation, only?: ItineraryLeg[]): NodeMove[] {
  const out: NodeMove[] = [];
  for (const it of only ? [only] : sim.trains.map(r => r.itin)) {
    if (!it) continue;
    for (let i = 0; i + 1 < it.length; i++) out.push({ node: it[i].to, from: sim.net.lines[it[i].line].id, fromDir: it[i].dir, to: sim.net.lines[it[i + 1].line].id, toDir: it[i + 1].dir });
  }
  return out;
}

/**
 * Every movement through the nodes that the control tables allow: at a node that is a two-track station of line A
 * and the end of line B, into B and out of B, in the directions that have routes on both lines (the reverse ones
 * only where some train runs against the direction of the line)
 */
export function allNodeMoves(sim: Simulation): NodeMove[] {
  const out: NodeMove[] = [], lines = sim.net.lines;
  for (const nd of sim.net.nodes) for (const a of nd.lines) for (const b of nd.lines) {
    if (a === b) continue;
    const ka = lines[a].L.st.findIndex(x => x.name === nd.name), kb = lines[b].L.st.findIndex(x => x.name === nd.name), nb = lines[b].L.st.length;
    if (ka <= 0 || ka >= lines[a].L.st.length - 1 || (kb !== 0 && kb !== nb - 1)) continue;
    for (const dA of [1, -1] as const) {
      if (dA < 0 && !sim.ixlReverse[a]) continue;
      for (const toB of [true, false]) {
        const dB: 1 | -1 = kb === 0 ? (toB ? 1 : -1) : (toB ? -1 : 1);
        if (dB < 0 && !sim.ixlReverse[b]) continue;
        out.push(toB ? { node: nd.name, from: lines[a].id, fromDir: dA, to: lines[b].id, toDir: dB } : { node: nd.name, from: lines[b].id, fromDir: dB, to: lines[a].id, toDir: dA });
      }
    }
  }
  return out;
}

/**
 * Timetable of a service for the interlocking of line j of a network: the stations of that line from where the
 * train enters it to where it leaves it, in running order, with the line it comes from or goes on to at a node
 */
function lineTimetable(sim: Simulation, r: TrainRun, j: number): TimetableEntry[] {
  const it = r.itin as ItineraryLeg[], i = it.findIndex(g => g.line === j);
  if (i < 0) return [];
  const g = it[i], st = sim.net.lines[j].L.st;
  const a = st.findIndex(x => x.name === (i === 0 ? r.stations[0].name : g.from)), b = st.findIndex(x => x.name === (i === it.length - 1 ? r.stations[r.stations.length - 1].name : g.to));
  const ks = a <= b ? st.slice(a, b + 1).map((_, q) => a + q) : st.slice(b, a + 1).map((_, q) => a - q);
  return ks.map((k, q) => {
    const x = st[k], own = r.stations.find(y => y.name === x.name), tk = r.tracks.get(x.name);
    return {
      station: k, name: x.name, arrival_s: own ? own.arr : null, departure_s: own ? own.dep : null, s_m: x.s, ...(tk ? { track: tk } : {}),
      ...(q === 0 && i > 0 ? { from_line: sim.net.lines[it[i - 1].line].id } : {}),
      ...(q === ks.length - 1 && i < it.length - 1 ? { to_line: sim.net.lines[it[i + 1].line].id } : {}),
    };
  });
}

/** Timetable of a service for the trackside: every station from its origin to its destination, null times where it passes; on a network, that of line j */
export function serviceTimetable(sim: Simulation, r: TrainRun, j?: number) {
  if (j != null && r.itin) return lineTimetable(sim, r, j);
  const st = sim.L.st, a = st.findIndex(x => x.name === r.stations[0].name), b = st.findIndex(x => x.name === r.stations[r.stations.length - 1].name);
  // in running order: towards the origin the stations are listed backwards
  const ks = a <= b ? st.slice(a, b + 1).map((_, j) => a + j) : st.slice(b, a + 1).map((_, j) => a - j);
  return ks.map(k => {
    const x = st[k], own = r.stations.find(y => y.name === x.name), tk = r.tracks.get(x.name);
    return { station: k, name: x.name, arrival_s: own ? own.arr : null, departure_s: own ? own.dep : null, s_m: x.s, ...(tk ? { track: tk } : {}) };
  });
}

/** True when an external trackside must receive the request of the next cycle before `step()` */
export function tracksideDue(sim: Simulation): boolean {
  const tr = sim.tr;
  return !!tr && tr.kind === 'external' && !sim.done && sim.time + FIXED_DT > tr.t1 + 1e-9;
}

/** Request for the trackside: field telegrams, onboard messages, control centre commands */
export function tracksideRequest(sim: Simulation): TracksideRequest {
  // the in-process onboard exchanges before the trackside, as in step(): the trackside receives the radio messages of the same cycle
  for (const run of sim.trains) sim.onboardInProcess(run);
  const tr = sim.tr as TracksideState;
  const req: TracksideRequest = {
    type: 'trackside', version: 2, start: tr.exchanges === 0, t: +sim.time.toFixed(6), dt: tr.period,
    field: tr.fields.flatMap(f => f.telegrams()), radio: tr.pendingRadio.splice(0), commands: tr.pendingCmd.splice(0),
  };
  tr.pendingCmd.push(...tr.nextCmd.splice(0));
  if (req.start) req.configuration = JSON.parse(JSON.stringify(tr.cfg)) as TracksideConfig;
  return req;
}

/** Receives the trackside response: commands to the elements, messages for the onboard, panel, events */
export function tracksideResponse(sim: Simulation, r: TracksideResponse): void {
  r = toEnglish<TracksideResponse>(r);
  const tr = sim.tr, ob = sim.ob;
  if (!tr || !ob) throw new Error('the run does not use the interlocking trackside');
  if (!r || !Array.isArray(r.field) || !Array.isArray(r.radio)) throw new Error('invalid trackside response at t = ' + sim.S.t.toFixed(3) + ' s: field and radio are required');
  tr.t1 = sim.time + tr.period; tr.exchanges++;
  for (const f of tr.fields) f.receive(r.field, sim.time);
  // every message goes to the train it is addressed to (NID_ENGINE of the radio connection; none: the controlled train)
  if (sim.faults.radioOk) for (const m of r.radio) {
    const to = sim.trains.find(x => x.ob && x.ob.engine === (typeof m.NID_ENGINE === 'number' ? m.NID_ENGINE : 1));
    if (!to || !to.ob || to.radioLost || (sim.faults.radioRbc != null && m.NID_RBC === sim.faults.radioRbc)) continue;
    // several RBCs: the authority counted for overruns is that of the RBC supervising the train
    const sup = to === sim.train ? r.panel?.ma?.NID_RBC : r.panel?.sessions?.find(x => x.engine === to.ob?.engine)?.NID_RBC;
    const counted = typeof m.NID_RBC !== 'number' || sup == null || m.NID_RBC === sup;
    const { NID_ENGINE: _, ...msg } = m;
    void _;
    const out = to === sim.train ? m : msg;
    to.ob.pendingRadio.push(out); to.ob.log.push({ t: sim.S.t, direction: 'RBC→onboard', msg: out });
    if (counted) decodeMa(sim, out, to);
  }
  tr.panel = r.panel ?? null;
  for (const e of r.events || []) sim.event(e.type === 'WARN' ? 'WARN' : 'INFO', e.text);
}

/** Authority sent by the trackside RBC to a train, in line chainages, for the log and for counting overruns */
function decodeMa(sim: Simulation, m: RadioMessage, run: TrainRun): void {
  if (m.NID_MESSAGE !== 3 || !run.ob) return;
  const bg = run.ob.bgs.find(b => b.NID_BG === Number(m.NID_LRBG) % 16384);
  const p15 = (m.packets || []).find(p => p.NID_PACKET === 15);
  if (!bg || !p15) return;
  // in the chainages seen by the train: the line mirrored for a train running towards the origin (Q_DIR = 0)
  // a train with its own balise groups along a corridor: the chainages of the corridor, run forwards
  const eoa = (run.ob.own || run.dir > 0 ? bg.s : sim.L.len - bg.s) + Number(p15.L_ENDSECTION), dp = Number(p15.Q_DANGERPOINT) === 1;
  const reason = run === sim.train ? sim.tr?.panel?.ma?.reason : sim.tr?.panel?.sessions?.find(x => x.engine === run.ob?.engine)?.reason;
  run.tma = { eoa, svl: dp ? eoa + Number(p15.D_DP) : run.ob.own ? run.line.len : sim.L.len, why: dp ? (reason ?? 'RBC authority') : 'end of line' };
}
