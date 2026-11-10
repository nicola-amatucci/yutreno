/**
 * The train ahead of YuTreno 0.x as a service train (decision 12): the `freight` of the line (or the `leader` of the
 * scenario) becomes a freight train among the trains of the run, with its own dynamics, the built-in driver, the
 * signals and the supervision of every train and, with ETCS, its own onboard. It stands at `s0` and leaves when the
 * run starts, passes the stations, makes its stop (in the station within 400 m of `stopAt`, or in open line) and ends
 * its run at the last station of the line. It carries no passengers and is not in the open data feeds.
 */
import { CONSISTS } from './consist';
import { TRAIN_PRESETS, clone } from './presets';
import type { Simulation, TrainRun } from './simulation';
import type { TimetableEntry } from '../trackside';
import type { LeaderDef, Station, TrainParams } from './types';

/** Identifier of the train ahead among the trains of the run */
export const LEADER_ID = 'leader';

/** A stop of the train ahead is in a station when the station is within this distance of `stopAt` (m) */
const STOP_NEAR = 400;

/**
 * Deceleration the built-in driver of the train ahead plans its stops with (m/s²): the pneumatic brake of a freight
 * train builds up in seconds along the train, so it brakes earlier than a passenger train
 */
export const LEADER_DRIVER_DECEL = 0.25;

/** Departure of the stop of the train ahead for the interlocking until it is ready to leave (s) */
export const LEADER_NOT_READY = 1e9;

/** True when the line has a train ahead that starts on the line */
export function hasLeader(def: Partial<LeaderDef> | undefined): boolean {
  return !!def && !!def.on && (def.s0 ?? 0) > 0;
}

/**
 * The train of the train ahead: a double-headed freight train, two locomotives and as many loaded wagons as fit in
 * its length (at least one), at most at its maximum speed, so that it keeps its speed on the gradients of a line
 * with a single locomotive's load; or the train given in `train`
 */
export function leaderTrain(def: Partial<LeaderDef>): TrainParams {
  if (def.train) {
    const t = typeof def.train === 'string' ? TRAIN_PRESETS[def.train] : def.train;
    if (!t) throw new Error(`train ahead: unknown train «${String(def.train)}»`);
    return clone(t);
  }
  const tr = clone(TRAIN_PRESETS.freight), [loco, wagon] = [CONSISTS.freight[0], CONSISTS.freight[1]];
  const len = def.len || 400, n = Math.max(1, Math.floor((len - 2 * loco.L) / wagon.L));
  tr.consist = [{ ...clone(loco), name: 'Locomotive 1' }, { ...clone(loco), name: 'Locomotive 2' }, ...Array.from({ length: n }, (_, i) => ({ ...clone(wagon), name: 'Wagon ' + (i + 1) }))];
  const m = 2 * loco.m + n * wagon.m;
  Object.assign(tr, {
    name: `Freight train (2 locomotives + ${n} wagons)`, m, L: 2 * loco.L + n * wagon.L, adh: (2 * loco.m) / m,
    Pw: 2 * tr.Pw, Fmax: 2 * tr.Fmax, edMax: 2 * tr.edMax, vmax: Math.min(tr.vmax, (def.vmax || 60) / 3.6),
  });
  return tr;
}

/**
 * Stops of the train ahead on the main line: the last station behind it (already passed), its stop if it has one
 * and the last station of the line, where its run ends. Null when no station is ahead of it
 */
export function leaderStops(sim: Simulation, def: Partial<LeaderDef>): { stations: Station[]; dwells: number[]; stop: number } | null {
  const st = sim.L.st, s0 = def.s0 ?? 0, last = st.length - 1;
  if (last < 1 || st[last].s <= s0) return null;
  const k0 = Math.max(0, st.findIndex(x => x.s > s0) - 1);
  const stations: Station[] = [{ ...st[k0], arr: null, dep: null, done: true }], dwells = [0];
  let stop = -1;
  const at = def.stopAt ?? 0;
  if (at > s0) {
    const k = st.findIndex((x, i) => i > k0 && Math.abs(x.s - at) < STOP_NEAR);
    if (k >= 0) stations.push({ ...st[k], arr: null, dep: null, done: false });
    // a stop in open line: a halt at stopAt, which is not a station
    else stations.push({ name: 'km ' + (at / 1000).toFixed(3), s: at, arr: null, dep: null, done: false, halt: true });
    dwells.push(def.wait ?? 0);
    stop = 1;
  }
  if (stations[stations.length - 1].name !== st[last].name) { stations.push({ ...st[last], arr: null, dep: null, done: false }); dwells.push(0); }
  return { stations, dwells, stop };
}

/**
 * The train ahead on the line at the start of the run: standing at `s0` and leaving at once, its origin passed and
 * its next stop the one after it; it gives way to the timetabled trains in conflicts. It stands rather than runs
 * because a train with a message-based onboard cannot run without an authority, which the trackside gives only
 * once the run has started: standing, it starts in the same way with every signalling, onboard and trackside
 */
export function startLeader(sim: Simulation, run: TrainRun): void {
  run.active = true;
  run.appear = 0;
  run.priority = -1;
  run.S.nextSt = 1;
  run.S.doors = false;
  run.pendingDep = -1;
  // the authority comes with the signals of the first step
  run.S.sup = sim.supervise(run.S.s, 0, run);
}

/**
 * The timetable of the train ahead for the automatic route setting of the interlocking: every station from the one
 * behind it to the end of the line, passing everywhere; where it stops in a station its departure is not known in
 * advance, and the train tells the interlocking when it is ready (`leaderReady`)
 */
export function leaderTimetable(sim: Simulation, run: TrainRun, tt: TimetableEntry[]): TimetableEntry[] {
  const k = leaderStation(run);
  return tt.map(e => (k && e.name === k.name ? { ...e, arrival_s: 0, departure_s: LEADER_NOT_READY } : { ...e, arrival_s: null, departure_s: null }));
}

/** The stop of the train ahead in a station, if it has one */
function leaderStation(run: TrainRun): Station | null {
  const k = run.stations.length > 2 ? run.stations[1] : null;
  return k && !k.halt ? k : null;
}

/**
 * With the interlocking trackside, after every step: when the train ahead is ready to leave its stop in a station,
 * its departure is now and the interlocking receives the new timetable; when it ends its run, the End of Mission
 * (message 150) closes its session with the RBC, as the train ahead of 0.x did when it left the line
 */
export function leaderTick(sim: Simulation): void {
  const run = sim.leader, tr = sim.tr;
  if (!run || !tr || !run.ob) return;
  const engine = run.ob.engine;
  if (run.S.finished && !sim.leaderEnded) {
    sim.leaderEnded = true;
    tr.pendingRadio.push({ NID_MESSAGE: 150, NID_ENGINE: engine, T_TRAIN: Math.round(sim.time * 100), packets: [] });
  }
  if (run.S.nextSt < 2 || sim.leaderSent) return;
  const k = leaderStation(run);
  sim.leaderSent = true;
  const own = k ? tr.cfg.trains?.find(x => x.engine === engine) : null;
  if (!k || !own) return;
  own.timetable = own.timetable.map(o => (o.name === k.name ? { ...o, departure_s: +sim.time.toFixed(3) } : o));
  tr.pendingCmd.push({ type: 'timetable', engine, timetable: own.timetable });
}
