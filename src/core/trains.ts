/**
 * The trains of a run (phase 8, R1): the controlled train and the service trains with their state, their stations
 * and dwells, their corridor on a network and their direction, and the state of the multi-mass model. The
 * constructor of `Simulation` creates them with these functions.
 */
import { DEFAULT_COUPLER, buildConsist, consistSummary } from './consist';
import { FIXED_DT } from './dynamics';
import { ReferenceEvc } from './evc';
import { mirrorLine } from './line';
import { compileCorridor, directed, planItinerary, type Corridor } from './network';
import { TRAIN_PRESETS, clone } from './presets';
import type { ServiceDef } from './scenario';
import { Rbc } from './simple-rbc';
import type { ExternalState, MultiState, OnboardState, SimState, Simulation, TrainRun } from './simulation';
import { SERVICE_LEAD } from './traffic';
import type { CompiledLine, Station, Supervision, TrainParams, VehicleDef } from './types';

/** Minimum dwell in a station with doors open (s) */
export const DWELL = 20;


/** Builds a train at standstill with its head at s0: consist, dynamics model, state and, with ETCS, its onboard */
export function createTrain(sim: Simulation, id: string, train: TrainParams, s0: number, svc?: { stations: Station[]; dwells: number[]; appear: number; driver: 'ato' | 'agent'; dir: 1 | -1; cor?: Corridor }): TrainRun {
  const TR: TrainParams = { ...train };
  let mm: MultiState | null = null;
  if ((TR.model ?? 'multimass') === 'multimass') {
    const veh = buildConsist(TR), sum = consistSummary(veh);
    TR.m = sum.m;
    TR.L = sum.L;
    mm = createMulti(sim, TR, veh, sum.m, sum.mMot);
  }
  let ext: ExternalState | null = null;
  if (TR.model === 'external') {
    const per = Math.max(1, Math.round((TR.external?.period_s ?? 0.05) / FIXED_DT)) * FIXED_DT;
    ext = { period: per, horizon: TR.external?.horizon_m ?? 500, t0: 0, t1: 0, s0: 0, s1: 0, v0: 0, v1: 0, resp: null, exchanges: 0 };
  }
  const S: SimState = {
    t: 0, s: s0, v: 0, a: 0, lever: 0, uT: 0, uB: 0, uEM: false, Ft: 0, Fb: 0, Fed: 0, R: 0, Fg: 0, grade: 0, eT: 0, eR: 0,
    eb: false, ebStopT: 0, sbi: false, warnOn: false, doors: false, doorT: 0, nextSt: 1, stops: [], vigT: 0, vigAlarm: false, vigStart: 0,
    finished: false, rows: [], events: [], trace: [[s0, 0]], nextLog: 0, warns: 0, sigT: 0, sbiCount: 0, interventions: 0, spad: 0,
    reactions: [], vigMissed: 0, maxOverLine: 0, slip: false, wsp: false, slipT: 0, ma: null,
    sup: null as unknown as Supervision, evCursor: 0, ctlTicks: 0, commandSource: 'manual', radioBrakes: 0,
    vTail: 0, Tnow: 0, Cnow: 0, maxTension: 0, maxCompression: 0, jerk: 0, maxJerk: 0, aPrev: 0,
  };
  if (mm) { let off = 0; for (let i = 0; i < mm.n; i++) { mm.x[i] = s0 - off; off += mm.veh[i].L; } }
  let ob: OnboardState | null = null;
  let kind = sim.scen.sig === 'ETCS' ? (sim.scen.onboard ?? 'internal') : 'internal';
  // an external onboard is connected to the controlled train; the services carry the reference onboard
  if (svc && kind === 'external') kind = 'reference';
  if (kind !== 'internal') {
    const per = Math.max(1, Math.round((sim.scen.onboard_period_s ?? 0.1) / FIXED_DT)) * FIXED_DT;
    const idle: Supervision = { mode: 'ETCS', vMRSP: 0, vP: 0, vW: 0, vSBI: 0, vEBI: 0, tgt: null, ind: false, status: 'NOR' };
    ob = {
      kind, period: per, t1: 0, exchanges: 0, bgs: [], rbc: null as unknown as Rbc, engine: 1, own: false, baseLim: [], ref: kind === 'reference' ? new ReferenceEvc() : null,
      pendingBg: [], pendingRadio: [], resp: null, sAtResp: s0, sup: idle, s0, eoaPassed: -1, log: [], odo: { err: 0, slope: 0, s: s0 },
    };
  }
  const stations = svc ? svc.stations : sim.L.st.map((st, i) => ({ ...st, done: i === 0 }));
  return {
    id, TR, ME: TR.m * TR.rot, S, mm, ext, ob, stations, dir: svc ? svc.dir : 1, line: svc?.cor ? svc.cor.line : svc && svc.dir < 0 ? sim.Lr as CompiledLine : sim.L,
    legs: svc?.cor ? svc.cor.legs : [{ line: 0, dir: svc ? svc.dir : 1, c0: 0, d0: 0, lo: -Infinity, hi: Infinity }],
    itin: null,
    cor: svc?.cor ?? { line: svc && svc.dir < 0 ? sim.Lr as CompiledLine : sim.L, legs: [{ line: 0, dir: svc ? svc.dir : 1, c0: 0, d0: 0, lo: -Infinity, hi: Infinity }], sigRef: null }, driver: svc ? svc.driver : 'controlled', active: !svc, appear: svc ? svc.appear : 0,
    dwells: svc ? svc.dwells : stations.map(() => DWELL), mem: {}, nextCtl: 0,
    realised: stations.length ? [{ station: stations[0].name, arrival_s: null, departure_s: null }] : [], pendingDep: stations.length ? 0 : -1,
    tracks: new Map(), fieldIndex: 0, tma: null, brakeFactor: 1, tractionFactor: 1, heldUntil: -Infinity, freight: false,
    priority: 0, plan: stations.map(st => ({ name: st.name, s: st.s, arr: st.arr, dep: st.dep })), cancelled: null,
    block: null, after: null, turnaround: 0, payload: 0,
  };
}

/** A service train: its stations and times from the timetable, parameters from a preset or given, not yet on the line */
export function createService(sim: Simulation, sv: ServiceDef, defaultTrain: TrainParams): TrainRun {
  const TR = typeof sv.train === 'string' ? clone(TRAIN_PRESETS[sv.train]) : sv.train ? clone(sv.train) : clone(defaultTrain);
  if (!TR) throw new Error(`service ${sv.id}: unknown train «${String(sv.train)}»`);
  if (TR.model === 'external') throw new Error(`service ${sv.id}: service trains use the internal dynamics models`);
  if (sim.networked) return createNetworkService(sim, sv, TR);
  const real = sv.stops.map(x => {
    const st = sim.L.st.find(s => s.name === x.station);
    if (!st) throw new Error(`service ${sv.id}: station «${x.station}» is not on the line (stations: ${sim.L.st.map(s => s.name).join(', ')})`);
    return st;
  });
  const dir: 1 | -1 = real[1].s > real[0].s ? 1 : -1;
  for (let i = 1; i < real.length; i++) if ((real[i].s - real[i - 1].s) * dir <= 0) throw new Error(`service ${sv.id}: the stops must all be in the same running direction`);
  if (dir < 0 && !sim.Lr) {
    sim.Lr = mirrorLine(sim.L);
    sim.baseLimR = sim.Lr.lim.map(l => [l[0], l[1], l[2]] as [number, number, number]);
    sim.orients[0] = sim.L.st.slice(1).map(() => 0);
  }
  sim.dirsOf[0].add(dir);
  const Ld = dir > 0 ? sim.L : sim.Lr as CompiledLine;
  const stations: Station[] = sv.stops.map((x, i) => {
    const st = Ld.st.find(s => s.name === x.station) as Station;
    return { name: st.name, s: st.s, arr: x.arrival_s ?? null, dep: x.departure_s ?? null, done: i === 0 };
  });
  const dwells = sv.stops.map(x => x.min_dwell_s ?? DWELL);
  const run = createTrain(sim, sv.id, TR, stations[0].s, { stations, dwells, appear: (stations[0].dep as number) - SERVICE_LEAD, driver: sv.driver ?? 'ato', dir });
  for (const x of sv.stops) if (x.track) run.tracks.set(x.station, x.track);
  return run;
}

/**
 * A service on a network: its itinerary through the lines of its route, compiled into a corridor; the stations of
 * the service are those of the corridor. A route along one line runs on that line as on a single-line run.
 */
function createNetworkService(sim: Simulation, sv: ServiceDef, TR: TrainParams): TrainRun {
  const it = planItinerary(sim.net, sv.stops.map(x => x.station), sv.route, `service ${sv.id}`);
  for (const g of it) {
    if (g.line === 0 && g.dir < 0 && !sim.Lr) sim.baseLimR = directed(sim.net.lines[0], -1).lim.map(l => [l[0], l[1], l[2]] as [number, number, number]);
    sim.dirsOf[g.line].add(g.dir);
    if (sim.dirsOf[g.line].size > 1 && !sim.orients[g.line].length) sim.orients[g.line] = sim.net.lines[g.line].L.st.slice(1).map(() => 0);
  }
  const cor = compileCorridor(sim.net, it);
  const stations: Station[] = sv.stops.map((x, i) => {
    const st = cor.line.st.find(s => s.name === x.station) as Station;
    return { name: st.name, s: st.s, arr: x.arrival_s ?? null, dep: x.departure_s ?? null, done: i === 0 };
  });
  const dwells = sv.stops.map(x => x.min_dwell_s ?? DWELL);
  const run = createTrain(sim, sv.id, TR, stations[0].s, { stations, dwells, appear: (stations[0].dep as number) - SERVICE_LEAD, driver: sv.driver ?? 'ato', dir: it[0].dir, cor });
  run.itin = it;
  for (const x of sv.stops) if (x.track) run.tracks.set(x.station, x.track);
  return run;
}

function createMulti(sim: Simulation, TR: TrainParams, veh: VehicleDef[], M: number, mMot: number): MultiState {
  const n = veh.length, f = () => new Float64Array(n);
  const cA = f(), cB = f(), cC = f(), delay = f();
  // Davis distributed: A and B in proportion to the mass, 35% of C on the leading vehicle (nose) and the rest uniform
  const nose = n > 1 ? 0.35 : 1;
  let off = 0;
  for (let i = 0; i < n; i++) {
    cA[i] = TR.A * veh[i].m / M;
    cB[i] = TR.B * veh[i].m / M;
    cC[i] = TR.C * ((1 - nose) / n + (i === 0 ? nose : 0));
    delay[i] = TR.epBrake === false ? off / (TR.vProp ?? 280) : 0;
    off += veh[i].L;
  }
  const histLen = Math.ceil(Math.max(...delay) / 0.001) + 4;
  return {
    veh, n, M, mMot, cp: TR.coupler ?? DEFAULT_COUPLER, kGal: TR.kTunnel ?? 1.6,
    x: f(), v: f(), a: f(), Ft: f(), Fb: f(), Fg: f(), R: f(), T: new Float64Array(Math.max(0, n - 1)),
    cA, cB, cC, delay, hist: new Float64Array(histLen), histPos: 0, FtCmd: 0,
  };
}
