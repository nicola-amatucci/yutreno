/**
 * A run (`Simulation`): the conductor of the engine. It holds the state of the run (run-state.ts) and the order of
 * the operations of a fixed step, step(FIXED_DT), which is part of the behaviour and makes the run deterministic,
 * and it gives every part of the work to its module: the trains (trains.ts), their dynamics (dynamics.ts), the
 * exchanges with the onboard, the trackside and the regulator (onboard-, trackside-, regulator-bridge.ts), the events
 * of the scenario and the commands (commands.ts), the traffic of several trains (traffic.ts), the train ahead
 * (leader.ts), the passengers (boarding.ts) and the outputs (outputs.ts, control-room.ts). Its public methods are
 * those callers have always used.
 */
import { clamp, compileLine } from './line';
import { ADHESION, LINE_PRESETS, NETWORK_PRESETS } from './presets';
import { compileNetwork, copyAspects, directed, onLine, type CompiledNetwork, type ItineraryLeg } from './network';
import { autoDriver } from './auto-driver';
import type { RunResult, ScenarioDef, ScenarioEventDef, ScenarioEventState, ServiceDef, Verdict } from './scenario';
import { toEnglish, toLegacy } from './legacy';
import { BALISE_SPACING, Rbc, baliseTelegram, buildBaliseGroups } from './simple-rbc';
import { controlRoomSnapshot, type ControlRoomSnapshot } from './control-room';
import * as dyn from './dynamics';
import * as obx from './onboard-bridge';
import * as tsx from './trackside-bridge';
import * as rgx from './regulator-bridge';
import * as cmd from './commands';
import * as trn from './trains';
import { DWELL } from './trains';
import * as ldr from './leader';
import * as brd from './boarding';
import * as tfc from './traffic';
import { moveKey, type NodeGate } from './traffic';
import * as out from './outputs';
import { aspectName, fmtErr } from './outputs';
import { Field, addNodeRoutes, tracksideConfig, generateLayout, type LineLayout, type NodeMove } from './field';
import { PassengerModel, type PassengerResults } from './passengers';
import { ReferenceRegulator } from '../regulator';
import { Trackside, translateControlTables, type CorridorConfig, type InterlockingConfig, type OperatorCommand, type TracksideConfig, type TracksideRequest, type TracksideResponse } from '../trackside';
import { ETCS, G, lineLimitTrain, supervise, updateInterlocking, updateSignals, type Occupant } from './signalling';
import type {
  BaliseTelegram, Command, CompiledLine, RegulatorCommand, DispatchCommand, RegulatorRequest, RegulatorResponse, DynamicsRequest, DynamicsResponse, EtcsAtoData, EventKind, OnboardRequest, OnboardResponse, LineDef, MovementAuthority, Observation, Scenario, SimEvent, Supervision, TrainParams,
} from './types';

export { LOG_DT, CSV_HEADER, aspectName, leverLabel, fmtErr } from './outputs';
export { FIXED_DT } from './dynamics';
export { DWELL } from './trains';
export { NODE_WINDOW, SERVICE_LEAD, STATION_EXIT } from './traffic';
import { FIXED_DT } from './dynamics';

/** Maximum distance (m) from the stop marker for a stop to be valid */
export const STOP_TOL = 20;


/** Period (s) of the built-in driver of the service trains */
export const SERVICE_DRIVER_PERIOD = 0.2;
/** Vigilance cycle (s of running between two requests) */
export const VIG_CYCLE = 55;
/** Time (s) to acknowledge vigilance before the emergency brake */
export const VIG_GRACE = 5;


const moves = (k: string): NodeMove => { const [node, from, fd, to, td] = k.split('|'); return { node, from, fromDir: Number(fd) as 1 | -1, to, toDir: Number(td) as 1 | -1 }; };

export type { SimState, ExternalState, MultiState, OnboardState, TracksideState, RegulatorState, FaultState, TrainRun, ConnectionState } from './run-state';
import type { SimState, ExternalState, MultiState, OnboardState, TracksideState, RegulatorState, FaultState, TrainRun, ConnectionState } from './run-state';

/** Reason of the authority of a train held at a marker it has passed at danger */
const PASSED = 'signal passed at danger';

/** A run: compiled line, train, conditions, scenario and all the state that evolves over time.
 *
 * Typical use: `new Simulation(line, train, conditions, scenario)`, then `step(FIXED_DT)` in a loop,
 * `applyCommand()` or `setLever()` to drive and `observe()` to read what the driver would see.
 * It touches neither the DOM nor files: the same class runs in the browser, in the Web Worker and in Node.
 */
export class Simulation {
  readonly L: CompiledLine;
  readonly scen: Scenario;
  readonly scenario: ScenarioDef | null;
  /** Passengers of the run (docs/PASSENGERS.md); null without `passengers` in the scenario */
  readonly pax: PassengerModel | null;
  /** Progress of the scenario events */
  readonly scenarioEvents: ScenarioEventState[];
  /**
   * The run goes through the several-trains path (services, or line blocks that the signals must protect); a single
   * train without them keeps the original path, whose results the reference campaign fixes
   */
  /** Several trains on the line, or a blocked stretch (internal, also read by trackside-bridge.ts) */
  multi = false;
  /** Moving block (`spacing: 'moving_block'`): margin (m), period of the position reports (s) and their delay (s); null with the fixed block (internal, read by traffic.ts) */
  mb: { margin: number; period: number; delay: number } | null = null;
  /** Stretches of line blocked by scenario events, in the chainages of the line (internal, also read by control-room.ts) */
  blocks: [number, number][] = [];
  /** Pairs of trains on the same stretch of line at the last step (internal, see `traffic.sameStretch`) */
  private together = new Set<string>();
  readonly faults: FaultState = { radioOk: true, radioLostAt: 0, radioTimeout: 20, radioBrake: false, brake: 1, traction: 1, adh: [], tsr: [] };
  /** Speed limits of the line without temporary restrictions (internal, also read by commands.ts) */
  readonly baseLim: [number, number, number][];
  /** Trains of the run, in the order in which they advance: the controlled train first, then the services */
  readonly trains: TrainRun[];
  /** Simulated time of the run (s); the time of a train stops when it finishes */
  time = 0;
  /** The line seen in the opposite direction, only when some service runs that way */
  get Lr(): CompiledLine | null { return this.net.lines[0].Lr; }
  set Lr(v: CompiledLine | null) { this.net.lines[0].Lr = v; }
  /**
   * The network of the run: the main line alone (line 0, `L`) without a network in the scenario. Per line, the
   * directions trains run in (the main line always forwards) and the orientation of its single-track sections
   */
  readonly net: CompiledNetwork;
  /** Directions in which trains run on every line (internal, also read by control-room.ts) */
  readonly dirsOf: Set<1 | -1>[];
  /** Orientation of the single-track sections of every line (internal, also read by control-room.ts) */
  readonly orients: number[][];
  /** The run has a network with more than one line */
  readonly networked: boolean;
  /** Connections between trains (scenario `connections`) */
  readonly connections: ConnectionState[] = [];
  /** Node routes of the network (none on a single line) (internal, also read by control-room.ts) */
  gates: NodeGate[] = [];
  /** Interlocking trackside on a network: the movements through the nodes that have node routes (internal, also read by commands.ts) */
  ixlMoves = new Set<string>();
  /** Lines whose interlocking has routes against the direction of the line (internal, also read by trackside-bridge.ts) */
  ixlReverse: boolean[] = [];
  /** Speed limits of the mirrored line without temporary restrictions (internal, also read by commands.ts) */
  baseLimR: [number, number, number][] = [];
  /** Orientation of each single-track section with trains in both directions: 1, −1 or 0 (free) */
  /** Interlocking trackside, null with the simple trackside */
  readonly tr: TracksideState | null;
  /** Traffic regulator, null without one */
  readonly reg: RegulatorState | null;
  /**
   * The train ahead of the line (`freight` of the line, `leader` of the scenario), a freight service train among
   * `trains`, right after the controlled one (leader.ts); null without one
   */
  readonly leader: TrainRun | null = null;
  /** The interlocking has received the departure of the train ahead from its stop, and its End of Mission (internal, also written by leader.ts) */
  leaderSent = false;
  leaderEnded = false;
  /** Called at every event, for the interface */
  onEvent: ((e: SimEvent) => void) | null = null;
  /** Called once at the end of the run */
  onFinish: (() => void) | null = null;

  constructor(line: LineDef, train: TrainParams, scen: Scenario, scenario: ScenarioDef | null = null) {
    this.L = compileLine(line);
    const nd = typeof scenario?.network === 'string' ? NETWORK_PRESETS[scenario.network] : scenario?.network;
    if (scenario?.network != null && !nd) throw new Error(`unknown network «${String(scenario.network)}»`);
    this.net = nd ? compileNetwork(nd, this.L, LINE_PRESETS) : { name: this.L.def.name, lines: [{ id: 'main', L: this.L, Lr: null, dx: 0, dy: 0 }], nodes: [], warnings: [] };
    this.networked = this.net.lines.length > 1;
    this.dirsOf = this.net.lines.map((_, j) => new Set<1 | -1>(j === 0 ? [1] : []));
    this.orients = this.net.lines.map(() => []);
    this.scen = { ...scen };
    this.scenario = scenario;
    this.pax = scenario?.passengers ? new PassengerModel(scenario.passengers) : null;
    this.scenarioEvents = (scenario?.events || []).map((def, i) => ({ def, i, phase: 'pending' as const, tFired: null }));
    this.baseLim = this.L.lim.map(l => [l[0], l[1], l[2]] as [number, number, number]);
    const s0 = this.L.st.length ? this.L.st[0].s : 50;
    this.trains = [trn.createTrain(this, 'train', train, s0)];
    // the train ahead: a freight service already running on the line
    const fr = this.L.def.freight, ls = ldr.hasLeader(fr) ? ldr.leaderStops(this, fr) : null;
    if (ls) {
      const run = trn.createTrain(this, ldr.LEADER_ID, ldr.leaderTrain(fr), fr.s0, { stations: ls.stations, dwells: ls.dwells, appear: 0, driver: 'ato', dir: 1 });
      run.freight = true;
      this.trains.push(run);
      this.leader = run;
      ldr.startLeader(this, run);
    }
    // a service of a block without a train of its own takes that of the previous service of the same block
    const blockTrain = new Map<string, string | TrainParams>();
    const sorted = (scenario?.services ?? []).map(sv => toEnglish<ServiceDef>(sv)).map((sv, i) => ({ sv, i })).sort((a, b) => ((a.sv.stops[0].departure_s ?? 0) - (b.sv.stops[0].departure_s ?? 0)) || a.i - b.i);
    const own = new Map<string, string | TrainParams | undefined>();
    for (const { sv } of sorted) {
      if (sv.block && sv.train) blockTrain.set(sv.block, sv.train);
      own.set(sv.id, sv.train ?? (sv.block ? blockTrain.get(sv.block) : undefined));
    }
    for (const sv of scenario?.services ?? []) { const e = toEnglish<ServiceDef>(sv); this.trains.push(trn.createService(this, { ...e, train: own.get(e.id) }, train)); }
    this.multi = this.trains.length > 1 || (scenario?.events ?? []).some(e => e.type === 'line_blocked');
    tfc.linkBlocks(this, scenario);
    this.connections = (scenario?.connections ?? []).map(c => {
      const find = (id: string) => this.trains.find(r => r.id === id);
      const from = find(c.from_service), to = find(c.to_service);
      if (!from || !to) throw new Error(`connection at ${c.station}: no train «${!from ? c.from_service : c.to_service}» in the run`);
      for (const [r, what] of [[from, 'arrive'], [to, 'leave']] as const) {
        const k = r.stations.findIndex(x => x.name === c.station);
        if (k < 0 || (what === 'leave' && k === r.stations.length - 1) || (what === 'arrive' && k === 0)) throw new Error(`connection at ${c.station}: ${r.id} does not ${what} there`);
      }
      return { station: c.station, from, to, transfer: c.transfer_s ?? 120, maxWait: c.max_wait_s ?? 300, outcome: 'pending' as const, wait_s: 0 };
    });
    if (this.networked) this.gates = tfc.buildGates(this);
    for (const e of scenario?.events ?? []) if (e.train && e.train !== 'train' && !this.trains.some(r => r.id === e.train)) throw new Error(`event ${e.type}: no train «${e.train}» in the run`);
    const tk = this.scen.sig === 'ETCS' ? (this.scen.trackside ?? 'simple') : 'simple';
    if (this.trains.some(r => r.ob)) {
      // one set of balise groups and one RBC for all the trains; trains starting against the nominal direction need
      // a group behind them at their origin, added after the others so that the identifiers of the line do not change
      const rev = [...new Set(this.trains.filter(r => r.ob && r.dir < 0).map(r => this.L.len - r.stations[0].s))];
      const bgs = buildBaliseGroups(this.L, rev), rbc = new Rbc(this.L, bgs);
      this.trains.forEach((r, i) => {
        if (!r.ob) return;
        r.ob.engine = i + 1;
        // on a network, a train not on the main line alone gets balise groups and an RBC along its corridor
        if (this.networked && (r.cor.sigRef || r.legs[0].line !== 0)) {
          r.ob.own = true; r.ob.bgs = buildBaliseGroups(r.line); r.ob.rbc = new Rbc(r.line, r.ob.bgs);
          r.ob.baseLim = r.line.lim.map(l => [l[0], l[1], l[2]] as [number, number, number]);
        } else { r.ob.bgs = bgs; r.ob.rbc = rbc; }
      });
    }
    // the moving block needs position reports from every train to the simple RBC, on one line; otherwise (another
    // signalling, onboard or trackside chosen for the same scenario) the run keeps the fixed block, with a warning
    const mbOk = this.scen.sig === 'ETCS' && tk === 'simple' && this.trains.every(r => r.ob) && !this.networked;
    if (scenario?.spacing === 'moving_block' && !mbOk) this.event('WARN', 'Moving block ignored: it needs ETCS with a message-based onboard on every train and the simple trackside, on a single line; the run uses the fixed block');
    if (scenario?.spacing === 'moving_block' && mbOk) {
      const p = scenario.moving_block ?? {};
      this.mb = { margin: p.margin_m ?? 50, period: Math.round(p.report_period_s ?? 6), delay: p.radio_delay_s ?? 0 };
      if (!(this.mb.margin >= 0) || !(this.mb.period >= 1 && this.mb.period <= 254) || !(this.mb.delay >= 0)) throw new Error('moving_block: margin_m ≥ 0, report_period_s from 1 to 254 s, radio_delay_s ≥ 0');
    }
    if (tk !== 'simple') {
      if (!this.ob) throw new Error('the interlocking trackside needs ETCS with a message-based onboard (reference or external onboard)');
      // with trains towards the origin the tables also have the reverse routes and the block consent of the segments
      const layouts: LineLayout[] = this.net.lines.map((n, j) => ({ id: n.id, L: n.L, tables: j === 0
        ? generateLayout(this.L, { reverse: this.networked ? this.dirsOf[0].has(-1) : this.trains.some(r => r.dir < 0) })
        : generateLayout(n.L, { reverse: this.dirsOf[j].has(-1), prefix: n.id + ':' }) }));
      // on a network: the node routes and the boundaries between the interlockings of the lines
      // with a regulator every movement through the nodes the tables allow, so that a reroute finds its node routes
      if (this.networked) {
        this.ixlReverse = this.net.lines.map((_, j) => this.dirsOf[j].has(-1));
        const moves = [...this.nodeMoves(), ...((this.scen.regulator ?? 'none') !== 'none' ? this.allNodeMoves() : [])];
        this.ixlMoves = new Set(moves.map(moveKey));
      }
      const boundaries = this.networked ? addNodeRoutes(layouts, [...this.ixlMoves].map(k => moves(k))) : [];
      const trad = translateControlTables(layouts[0].tables);
      const cfg = tracksideConfig(this.L, trad, this.ob.bgs, this.baseLim);
      if (this.trains.length > 1) {
        // the timetables of the services for automatic route setting: every station from origin to destination
        cfg.trains = this.trains.slice(1).filter(r => !this.networked || r.legs.some(g => g.line === 0)).map(r => {
          const tt = this.networked ? this.serviceTimetable(r, 0) : this.serviceTimetable(r);
          return { engine: (r.ob as OnboardState).engine, id: r.id, timetable: r === this.leader ? ldr.leaderTimetable(this, r, tt) : tt };
        });
        if (scenario?.conflict_rule) cfg.parameters.conflict_rule = scenario.conflict_rule;
      }
      if (scenario?.rbc_borders_m?.length) cfg.rbcs = this.rbcAreas(scenario.rbc_borders_m);
      const lineCfgs: TracksideConfig[] = [cfg];
      if (this.networked) {
        const interlockings: InterlockingConfig[] = layouts.slice(1).map((ly, i) => {
          const j = i + 1, t = translateControlTables(ly.tables), L = ly.L;
          trad.warnings.push(...t.warnings);
          const trains = this.trains.slice(1).filter(r => r.legs.some(g => g.line === j)).map(r => ({ engine: (r.ob as OnboardState).engine, id: r.id, timetable: this.serviceTimetable(r, j) }));
          const ic: InterlockingConfig = { id: ly.id, line: { name: L.def.name, length_m: L.len }, tvps: t.tvps, points: t.points, markers: t.markers, routes: t.routes,
            timetable: L.st.map((x, k) => ({ station: k, name: x.name, arrival_s: null, departure_s: null, s_m: x.s })), trains };
          lineCfgs.push({ ...tracksideConfig(L, t, [], L.lim), timetable: ic.timetable, trains });
          return ic;
        });
        // the trains off the main line: balise groups and legs of their corridors
        const corridors: CorridorConfig[] = this.trains.filter(r => r.ob?.own).map(r => this.corridorConfig(r));
        cfg.network = { main: this.net.lines[0].id, interlockings, boundaries, corridors };
      }
      // the train ahead, without a timetable, gives way to the timetabled trains in conflicts
      const leaderCmd: OperatorCommand | null = this.leader?.ob ? { type: 'priority', engine: this.leader.ob.engine, value: -1 } : null;
      const field = new Field(cfg), fields = [field, ...lineCfgs.slice(1).map(c => new Field(c))];
      field.addTrain(s0, this.TR.L);
      for (const r of this.trains.slice(1)) r.fieldIndex = field.addTrain(this.headLine(r), r.TR.L, r.dir);
      // the other lines have the same trains in the same order, each in its direction on that line
      fields.slice(1).forEach((f, i) => {
        f.addTrain(0, this.TR.L);
        for (const r of this.trains.slice(1)) f.addTrain(0, r.TR.L, r.legs.find(g => g.line === i + 1)?.dir ?? 1);
      });
      const per = Math.max(1, Math.round((this.scen.trackside_period_s ?? 0.1) / FIXED_DT)) * FIXED_DT;
      this.tr = { kind: tk, period: per, t1: 0, exchanges: 0, cfg, field: field, fields, ref: tk === 'interlocking' ? new Trackside() : null, pendingRadio: [], pendingCmd: leaderCmd ? [leaderCmd] : [], nextCmd: [], panel: null, warnings: trad.warnings };
      this.fieldStep(0);
      // the interlockings take the place of the node routes of the engine
      this.gates = [];
    } else this.tr = null;
    const rk = this.scen.regulator ?? 'none';
    const rper = Math.max(1, Math.round((this.scen.regulator_period_s ?? 5) / FIXED_DT)) * FIXED_DT;
    this.reg = rk === 'none' ? null : { kind: rk, period: rper, t1: 0, exchanges: 0, ref: rk === 'reference' ? new ReferenceRegulator() : null };
    this.scenarioTick();
    this.S.ma = updateInterlocking(this.L, 0, this.S.s, this.scen.sig);
    this.S.sup = this.ob ? this.ob.sup : this.supervise(this.S.s, 0);
    const first = this.nextSignal(this.S.s);
    this.event('INFO', 'Train ready at ' + (this.L.st[0] ? this.L.st[0].name : 'the start of the line') +
      (this.scen.sig === 'ETCS' ? ', ETCS level 2 in full supervision' : ', starting signal ' + (first ? first.id : '') + ' at ' + aspectName(first && first.asp)));
    this.dispatchTick();
  }

  /** Trains driven by an external agent that must receive an observation before the next step */
  agentsDue(): TrainRun[] { return this.trains.filter(r => r.driver === 'agent' && r.active && !r.S.finished && r.S.t + 1e-9 >= r.nextCtl); }

  /** True when every train of the run has finished */
  get done(): boolean { return this.trains.every(r => r.S.finished); }

  /** The controlled train: the one driven from the cab or by the controller, observed and judged */
  get train(): TrainRun { return this.trains[0]; }
  /** Shortcuts to the controlled train, kept for the interface, the scripts and the existing callers */
  get TR(): TrainParams { return this.trains[0].TR; }
  get ME(): number { return this.trains[0].ME; }
  get S(): SimState { return this.trains[0].S; }
  set S(x: SimState) { this.trains[0].S = x; }
  get mm(): MultiState | null { return this.trains[0].mm; }
  get ext(): ExternalState | null { return this.trains[0].ext; }
  get ob(): OnboardState | null { return this.trains[0].ob; }

  /** Current adhesion coefficient */
  get mu(): number {
    const a = this.scen.adh === 'auto' ? (this.scen.met === 'rain' ? 'wet' : 'dry') : this.scen.adh;
    return ADHESION[a] ?? 0.3;
  }

  /** Effective adhesion under the train: the nominal one, reduced by the scenario zones */
  muAt(pos: number, run: TrainRun = this.train): number {
    let m = this.mu;
    // the zones are on the main line
    const p = onLine(run.legs, 0, pos, run.TR.L);
    if (!p) return m;
    const lo = p.dir > 0 ? p.head - p.len : this.L.len - p.head, hi = p.dir > 0 ? p.head : this.L.len - p.head + p.len;
    for (const [a, b, z] of this.faults.adh) if (b > lo && a < hi) m = Math.min(m, z);
    return m;
  }

  /** Places a train (the controlled one by default) with its head at s, all vehicles at speed v (m/s) and couplers at rest */
  place(s: number, v: number, run: TrainRun = this.train): void {
    const S = run.S, M = run.mm;
    S.s = s; S.v = v; S.vTail = v;
    if (M) { let off = 0; for (let i = 0; i < M.n; i++) { M.x[i] = s - off; M.v[i] = v; off += M.veh[i].L; } }
  }

  /** Nominal adhesion at a point, reduced by the scenario zones */
  muAtPoint(x: number, run?: TrainRun): number {
    if (run && (run.cor.sigRef || run.legs[0].line !== 0)) {
      // a corridor of several lines: the zones are on the main line
      const p = onLine(run.legs, 0, x, 0);
      if (!p) return this.mu;
      x = p.dir > 0 ? p.head : this.L.len - p.head;
    } else if (run && run.dir < 0) x = this.L.len - x;
    let m = this.mu;
    for (const [a, b, z] of this.faults.adh) if (x >= a && x < b) m = Math.min(m, z);
    return m;
  }





  /** Fires and closes the scenario events; called at every step */
  private scenarioTick(): void { cmd.scenarioTick(this); }

  /**
   * Commands of the dispatcher written in the scenario (`dispatch` events): given at the end of the step that reaches
   * their time, where a command given from the page or a program at that time falls, before the controllers see the
   * new state. So a run repeated from `dispatchedEvents(sim.dispatched)` is the run in which they were given live
   */
  private dispatchTick(): void { cmd.dispatchTick(this); }

  /** Train an event concerns: the service named in `train`, or the controlled train (internal, also called by regulator-bridge.ts) */
  target(d: ScenarioEventDef): TrainRun { return cmd.target(this, d); }


  /**
   * RBC areas of the main line from the borders of the scenario: every border moved to the nearest main signal, with
   * the balise group just before it (the marker group) as border balise group; RBC 1 from the origin
   */
  private rbcAreas(at: number[]): NonNullable<TracksideConfig['rbcs']> {
    if (this.networked) throw new Error('rbc_borders_m: several RBCs are supported on a single line, not yet on a network');
    const bgs = (this.ob as OnboardState).bgs, xs: number[] = [];
    for (const x of [...at].sort((p, q) => p - q)) {
      const sg = [...this.L.sig].sort((p, q) => Math.abs(p.s - x) - Math.abs(q.s - x))[0];
      if (!sg || xs.includes(sg.s)) throw new Error(`rbc_borders_m: no main signal for a border at ${x} m`);
      xs.push(sg.s);
    }
    const borders = xs.map((s, k) => {
      const bg = bgs.filter(b => b.s < s && b.s > s - 100).sort((p, q) => q.s - p.s)[0];
      if (!bg) throw new Error(`rbc_borders_m: no balise group before the signal at ${s} m`);
      return { s_m: s, NID_BG: bg.NID_BG, bg_s_m: bg.s, a: k + 1, b: k + 2 };
    });
    const ends = [0, ...xs, this.L.len];
    return { areas: ends.slice(1).map((to, k) => ({ NID_RBC: k + 1, from_m: ends[k], to_m: to })), borders };
  }

  supervise(pos: number, v: number, run: TrainRun = this.train): Supervision {
    return supervise({ L: run.line, TR: run.TR, mode: this.scen.sig, mu: this.mu, ma: run.S.ma }, pos, v);
  }
  lineLimit(pos: number, run: TrainRun = this.train): number {
    const v = lineLimitTrain(run.line, run.TR, pos);
    if (!this.tr) return v;
    if (!this.networked) return Math.min(v, this.tr.field.branchLimit(run.fieldIndex, run.dir > 0 ? pos : this.L.len - pos));
    // on a network: the branches the train is on, on every line it is on
    let w = v;
    for (let j = 0; j < this.tr.fields.length; j++) {
      const p = onLine(run.legs, j, pos, run.TR.L);
      if (p) w = Math.min(w, this.tr.fields[j].branchLimit(run.fieldIndex, p.dir > 0 ? p.head : this.net.lines[j].L.len - p.head));
    }
    return w;
  }

  /** Advances the field of every line (trackside-bridge.ts) */
  private fieldStep(t: number): void { tsx.fieldStep(this, t); }

  /** A train off the main line for the trackside: its balise groups, limits, gradients and the legs of its corridor */
  private corridorConfig(r: TrainRun): CorridorConfig { return tsx.corridorConfig(this, r); }

  /** The movements through the nodes of the network, from the itineraries of the trains (or of one itinerary) */
  private nodeMoves(only?: ItineraryLeg[]): NodeMove[] { return tsx.nodeMoves(this, only); }

  /** Every movement through the nodes that the control tables allow (trackside-bridge.ts) */
  private allNodeMoves(): NodeMove[] { return tsx.allNodeMoves(this); }

  /** Timetable of a service for the trackside: every station from its origin to its destination; on a network, that of line j */
  private serviceTimetable(r: TrainRun, j?: number) { return tsx.serviceTimetable(this, r, j); }

  /** True when an external trackside must receive the request of the next cycle before `step()` */
  tracksideDue(): boolean { return tsx.tracksideDue(this); }

  /** Request for the trackside: field telegrams, onboard messages, control centre commands */
  tracksideRequest(): TracksideRequest { return tsx.tracksideRequest(this); }

  /** Receives the trackside response: commands to the elements, messages for the onboard, panel, events */
  tracksideResponse(r: TracksideResponse): void { tsx.tracksideResponse(this, r); }

  /** True when an external regulator must receive the request of the next cycle before `step()` (regulator-bridge.ts) */
  regulatorDue(): boolean { return rgx.regulatorDue(this); }

  /** Head of a train in the chainages of the main line (internal, also called by trackside-bridge.ts) */
  headLine(r: TrainRun): number { return r.dir > 0 ? r.S.s : this.L.len - r.S.s; }

  /** Request for the regulator: the trains with their plan, current timetable and realised one, the disruptions in force */
  regulatorRequest(): RegulatorRequest { return rgx.regulatorRequest(this); }


  /** Receives the decisions of the regulator and applies them; a command that cannot be applied is logged and skipped */
  regulatorResponse(r: RegulatorResponse): void { rgx.regulatorResponse(this, r); }

  /** Applies one decision of the regulator; returns why it cannot, or null (internal, also called by regulator-bridge.ts) */
  regulatorCommand(c: RegulatorCommand): string | null { return cmd.regulatorCommand(this, c); }

  /**
   * Command of the dispatcher, from the control room of the page or from a program: the decisions a regulator can
   * take (retime, skip_stop, cancel, priority, track, reroute, connection, operator) and temporary speed restrictions,
   * given now (docs/CONTROL_ROOM.md). Returns why it cannot be applied, or null. Every command applied is recorded in
   * `dispatched` with its time, so the run can be repeated with the same commands at the same times
   */
  dispatch(c: DispatchCommand): string | null { return cmd.dispatch(this, c); }

  /** Commands of the dispatcher applied so far, with their time (see `dispatch`) */
  readonly dispatched: { t_s: number; command: DispatchCommand }[] = [];

  /** Control centre command (from the page or from an operator controller) */
  operatorCommand(c: OperatorCommand): void {
    if (!this.tr) throw new Error('the run does not use the interlocking trackside');
    this.tr.pendingCmd.push(c);
  }
  nextSignal(pos: number, line: CompiledLine = this.L) { return line.sig.find(sg => sg.s > pos); }

  event(kind: EventKind, text: string, hidden = false, run: TrainRun = this.train): void {
    const S = run.S;
    const e = hidden ? { t: S.t, s: S.s, kind, text, hidden: hidden } : { t: S.t, s: S.s, kind, text };
    S.events.push(e);
    if (this.onEvent && run === this.train) this.onEvent(e);
  }

  emergency(reason: string, run: TrainRun = this.train): void {
    const S = run.S;
    if (S.eb) return;
    S.eb = true; S.ebStopT = 0; S.uT = 0; S.uEM = true; S.lever = -8;
    this.event('EMG', 'Emergency brake: ' + reason, false, run);
  }

  vigilance(run: TrainRun = this.train): void {
    const S = run.S;
    if (S.vigAlarm) { const r = S.t - S.vigStart; S.reactions.push(r); this.event('INFO', 'Vigilance acknowledged in ' + r.toFixed(2) + ' s', false, run); }
    S.vigAlarm = false; S.vigT = 0;
  }

  /** Master controller position: −8 emergency, −7…−1 braking, 0 neutral, 1…10 traction */
  setLever(l: number, run: TrainRun = this.train): void {
    const S = run.S;
    S.lever = clamp(Math.round(l), -8, 10);
    S.uEM = S.lever <= -8 || S.eb;
    S.uB = S.lever < 0 && S.lever > -8 ? -S.lever / 7 : 0;
    S.uT = S.lever > 0 ? S.lever / 10 : 0;
  }

  /** Applies an API command; commands in the Italian format of 0.x are accepted */
  applyCommand(c: Command | null | undefined, run: TrainRun = this.train): void {
    const S = run.S;
    if (!c || typeof c !== 'object') return;
    c = toEnglish<Command>(c);
    if (typeof c.lever === 'number' && isFinite(c.lever)) this.setLever(c.lever, run);
    else {
      if (typeof c.traction === 'number' && isFinite(c.traction)) S.uT = clamp(c.traction, 0, 1);
      if (typeof c.brake === 'number' && isFinite(c.brake)) S.uB = clamp(c.brake, 0, 1);
      S.uEM = S.eb;
      S.lever = S.uB > 0.01 ? -Math.max(1, Math.min(7, Math.round(S.uB * 7))) : S.uT > 0.001 ? Math.max(1, Math.round(S.uT * 10)) : 0;
    }
    if (c.vigilance) this.vigilance(run);
    if (c.emergency) this.emergency('commanded by the controller', run);
    if (typeof c.note === 'string' && c.note) this.event('CTL', c.note.slice(0, 140), false, run);
  }



  /** Ends the run of a train (internal, also called by commands.ts) */
  finish(run: TrainRun = this.train): void {
    if (run.S.finished) return;
    run.S.finished = true;
    if (run === this.train && this.onFinish) this.onFinish();
  }




  /** Advances the dynamics of a train by dt with the commands that actually reach it (dynamics.ts) */
  private dynamics(run: TrainRun, dt: number): void { dyn.advanceDynamics(this, run, dt); }

  /**
   * Co-simulation: true when the next step leaves the interval already computed by the external model.
   * Whoever drives the loop must then call `dynamicsRequest()`, send it to the model and pass the response
   * to `dynamicsResponse()` before `step()`. With the internal models it is always false.
   */
  dynamicsDue(run: TrainRun = this.train): boolean { return dyn.dynamicsDue(this, run); }

  /** Request for the external model: effective commands, line around the train, faults; train parameters on the first */
  dynamicsRequest(run: TrainRun = this.train): DynamicsRequest { return dyn.dynamicsRequest(this, run); }

  /** Receives the external model response: the state at the end of the interval, which `step()` reaches by interpolation */
  dynamicsResponse(r: DynamicsResponse, run: TrainRun = this.train): void { dyn.dynamicsResponse(this, r, run); }

  /** True when an external ETCS onboard must receive the request of the next cycle before `step()` (onboard-bridge.ts) */
  onboardDue(run: TrainRun = this.train): boolean { return obx.onboardDue(this, run); }

  /** Temporary speed restrictions of the main line in the chainages of the corridor of a train */
  private corridorTsr(run: TrainRun): [number, number, number][] { return obx.corridorTsr(this, run); }

  /** Request for the onboard: odometry, balises read and RBC messages since the last cycle; train data on the first */
  onboardRequest(run: TrainRun = this.train): OnboardRequest { return obx.onboardRequest(this, run); }

  /** Receives the onboard response: commands to the train, messages for the RBC and DMI indications */
  onboardResponse(r: OnboardResponse, run: TrainRun = this.train): void { obx.onboardResponse(this, r, run); }

  /** Supervision to show with a message-based onboard: the last one from the onboard, with the distance to the target updated */
  private onboardSupervision(run: TrainRun): Supervision { return obx.onboardSupervision(run); }

  /** Exchange with the in-process reference onboard, when it is its turn (internal, also called by trackside-bridge.ts) */
  onboardInProcess(run: TrainRun): void { obx.onboardInProcess(this, run); }

  /** One integration step (use FIXED_DT for deterministic runs) */
  step(dt: number = FIXED_DT): void {
    if (this.done) return;
    this.advance(dt);
    this.dispatchTick();
  }

  private advance(dt: number): void {
    for (const run of this.trains) {
      this.onboardInProcess(run);
      if (run.ob && run.active && !run.S.finished && run.S.t + FIXED_DT > run.ob.t1 + 1e-9) {
        throw new Error('external ETCS onboard: response missing for t = ' + run.S.t.toFixed(3) + ' s (call onboardRequest/onboardResponse when onboardDue is true)');
      }
    }
    const reg = this.reg;
    // the regulator decides before the trackside cycle, so that its commands reach the interlocking at once
    if (reg && this.time + FIXED_DT > reg.t1 + 1e-9) {
      if (reg.ref) this.regulatorResponse(reg.ref.step(this.regulatorRequest()));
      else throw new Error('external regulator: response missing for t = ' + this.time.toFixed(3) + ' s (call regulatorRequest/regulatorResponse when regulatorDue is true)');
    }
    const tr = this.tr;
    // the trackside follows the time of the run, which goes on while services run after the controlled train arrived
    if (tr && this.time + FIXED_DT > tr.t1 + 1e-9) {
      if (tr.ref) this.tracksideResponse(tr.ref.step(this.tracksideRequest()));
      else throw new Error('external trackside: response missing for t = ' + this.S.t.toFixed(3) + ' s (call tracksideRequest/tracksideResponse when tracksideDue is true)');
    }
    // the built-in drivers of the services decide before the step, as an external controller or agent does
    for (const run of this.trains) {
      if (run.driver !== 'ato' || !run.active || run.S.finished || run.S.t + 1e-9 < run.nextCtl) continue;
      run.S.ctlTicks++;
      this.applyCommand(autoDriver(this.observe(SERVICE_DRIVER_PERIOD, 3, run), run.mem, run.freight ? ldr.LEADER_DRIVER_DECEL : undefined), run);
      run.nextCtl = run.S.t + SERVICE_DRIVER_PERIOD - 1e-9;
    }
    this.time += dt;
    for (const run of this.trains) if (!run.S.finished) run.S.t += dt;
    this.scenarioTick();
    if (!this.multi) { this.stepTrain(this.train, dt); return; }
    // several trains: services appear, single-track orientation, signals of each direction, then every train
    if (this.gates.length) tfc.updateGates(this);
    for (const run of this.trains) if (!run.S.finished && !run.active && this.time + 1e-9 >= run.appear && tfc.originFree(this, run) && (!run.after || run.after.S.finished) && tfc.gateFree(this, run)) tfc.activate(this, run);
    for (let j = 0; j < this.net.lines.length; j++) if (this.orients[j].length) tfc.updateOrientation(this, j);
    // the signals of every line and direction in use, then the corridors of several lines copy their aspects
    const occ = new Map<string, Occupant[]>();
    for (let j = 0; j < this.net.lines.length; j++) for (const dir of [1, -1] as const) {
      if (!this.dirsOf[j].has(dir)) continue;
      const o = tfc.occupantsFor(this, j, dir);
      updateSignals(directed(this.net.lines[j], dir), o, tfc.heldSignals(this, j, dir));
      occ.set(j + ':' + dir, o);
    }
    for (const run of this.trains) copyAspects(this.net, run.cor);
    if (this.gates.length) tfc.gateAspects(this);
    for (const run of this.trains) {
      if (run.S.finished || !run.active) continue;
      const ma = this.scen.sig !== 'ETCS' ? null : this.mb ? tfc.movingAuthority(this, run) : tfc.authority(this, run, occ);
      this.stepTrain(run, dt, { ma });
    }
    // two trains on the same stretch of line: an event for each train when it happens, nothing else changes
    const now = tfc.sameStretch(this);
    if (now) for (const [k, c] of now) if (!this.together.has(k)) {
      const txt = (o: TrainRun) => 'On the same stretch of line as train ' + o.id + ', between ' + c.from + ' and ' + c.to;
      this.event('EMG', txt(c.b), false, c.a); this.event('EMG', txt(c.a), false, c.b);
    }
    if (now || this.together.size) this.together = new Set(now?.keys());
    // with several trains the field moves once per step, after all of them
    if (this.tr) {
      this.fieldStep(this.time);
      for (const f of this.tr.fields) for (const e of f.events.splice(0)) this.event('FAULT', e);
      ldr.leaderTick(this);
    }
  }


  /**
   * Chainage on the main line of the point s of the corridor of a train, null where the corridor is on another line
   * of the network. For a train on the main line it is s, or len − s against the nominal direction
   */
  mainChainage(r: TrainRun, s: number = r.S.s): number | null { return tfc.mainChainage(this, r, s); }


















  /** Passengers of the run up to now, with the energy per passenger-km; null without passengers */
  passengers(): (PassengerResults & { energy_kwh: number; energy_wh_per_pkm: number | null }) | null { return brd.passengers(this); }



  /** The part of a step that belongs to one train: authority, supervision, dynamics, balises, checks, stops */
  private stepTrain(run: TrainRun, dt: number, given?: { ma: MovementAuthority | null }): void {
    const S = run.S, L = run.line, ob = run.ob, tr = this.tr;
    const ev = (kind: EventKind, text: string) => this.event(kind, text, false, run);
    let ma = given ? given.ma : updateInterlocking(L, S.t, S.s, this.scen.sig);
    // a marker the train has passed at danger stays its end of authority while it is at danger for it
    if (run.passedAtDanger != null && ma) {
      const i = run.passedAtDanger;
      if (tfc.atDangerFor(this, run, i, !!this.mb)) ma = { eoa: run.line.sig[i].s, svl: run.line.sig[i].s + ETCS.overlap, why: PASSED };
      else run.passedAtDanger = undefined;
    }
    if (tr) S.ma = run.tma;
    else if (this.faults.radioOk || ob) S.ma = ma;
    if (ob && !tr) {
      // the RBC talks to the onboard only if the radio works; lost messages are not repeated
      const len = this.L.len, rev = run.dir < 0;
      const msgs = ob.own ? ob.rbc.tick({ t: S.t, ma, engine: ob.engine, baseLim: ob.baseLim, tsr: this.corridorTsr(run) }) : ob.rbc.tick({
        t: S.t, ma, engine: ob.engine, baseLim: rev ? this.baseLimR : this.baseLim, ...(this.mb ? { tCycloc: this.mb.period } : {}),
        tsr: rev ? this.faults.tsr.map(z => [len - z[1], len - z[0], z[2]] as [number, number, number]) : this.faults.tsr,
      });
      if (this.faults.radioOk && !run.radioLost) for (const m of msgs) { ob.pendingRadio.push(m); ob.log.push({ t: S.t, direction: 'RBC→onboard', msg: m }); }
    }
    const sup = ob ? this.onboardSupervision(run) : this.supervise(S.s, S.v, run);
    S.sup = sup;
    out.signallingConstrained(this, run, dt);

    const prev = S.s;
    this.dynamics(run, dt);
    const jr = (S.a - S.aPrev) / dt;
    S.aPrev = S.a;
    S.jerk += (jr - S.jerk) * (1 - Math.exp(-dt / 0.25));
    if (S.t > 1) S.maxJerk = Math.max(S.maxJerk, Math.abs(S.jerk));
    if (run.pendingDep >= 0 && S.v > 0.1 && !S.doors) { run.realised[run.pendingDep].departure_s = S.t; run.pendingDep = -1; }
    if (tr && !this.multi) {
      this.fieldStep(S.t);
      for (const f of tr.fields) for (const e of f.events.splice(0)) ev('FAULT', e);
    }
    if (ob) {
      // the two balises of every group passed in this step, in the order the train meets them: a train running
      // against the nominal direction reads N_PIG 1 before N_PIG 0
      const read: { odometer_m: number; telegram: BaliseTelegram }[] = [];
      for (const bg of ob.bgs) for (let k = 0; k < 2; k++) {
        const x = ob.own || run.dir > 0 ? bg.s + k * BALISE_SPACING : this.L.len - bg.s - k * BALISE_SPACING;
        if (prev < x && S.s >= x) read.push({ odometer_m: ob.odo.slope || ob.odo.err ? obx.odometerReading(ob, x) : x - ob.s0, telegram: baliseTelegram(bg, k) });
      }
      ob.pendingBg.push(...read.sort((a, b) => a.odometer_m - b.odometer_m));
    }

    const spad0 = S.spad;
    if (this.scen.sig === 'BACC') {
      for (const sg of L.sig) if (prev < sg.s && S.s >= sg.s) {
        if (sg.asp === 'R') { S.spad++; this.emergency('signal ' + sg.id + ' passed at danger', run); }
        else ev('SIG', 'Signal ' + sg.id + ' passed at ' + (sg.asp === 'G' ? 'green' : 'yellow') + ', ' + Math.round(S.v * 3.6) + ' km/h');
      }
    } else if (ob) {
      // with a message-based onboard the engine counts the overrun but does not brake: braking is the onboard's job
      if (S.ma && S.s > S.ma.eoa + 0.5 && S.ma.why !== 'end of line' && S.ma.why !== PASSED && ob.eoaPassed !== S.ma.eoa) {
        ob.eoaPassed = S.ma.eoa; S.spad++;
        ev('EMG', 'The head of the train has passed the end of the movement authority');
      }
    } else if (S.ma && S.s > S.ma.eoa + 0.5 && !S.eb && S.ma.why !== 'end of line') {
      // a train held at a marker it passed at danger is braked again if it moves, without counting the overrun twice
      if (S.ma.why !== PASSED) S.spad++;
      this.emergency('end of movement authority passed (trip)', run);
    }
    // the authority is recomputed from the position at every step, so once the head is past a marker at danger the
    // next authority would go beyond it and the check above sees the overrun only if it happens within one step: the
    // passage of a marker still at danger is counted here, once, and with ETCS the marker stays the end of authority
    // of the train while it is at danger for it (stepTrain); with the moving block a marker is at danger only when it
    // is held or protects a train of the other direction or a blocked stretch, the trains ahead being spaced by their
    // rear ends
    if (this.scen.sig !== 'BACC' && !tr && !this.networked) {
      const sg = run.line.sig;
      for (let i = 0; i < sg.length; i++) if (prev < sg[i].s + 0.5 && S.s >= sg[i].s + 0.5 && tfc.atDangerFor(this, run, i, !!this.mb)) {
        if (S.spad === spad0) { S.spad++; ev('EMG', 'The head of the train has passed signal ' + sg[i].id + ' at danger'); }
        if (this.scen.sig === 'ETCS') run.passedAtDanger = i;
        break;
      }
    }
    S.maxOverLine = Math.max(S.maxOverLine, S.v * 3.6 - this.lineLimit(S.s, run));
    if (!S.eb && !ob) {
      if (sup.status === 'INT') { S.interventions++; S.sbi = false; this.emergency(this.scen.sig === 'ETCS' ? 'ETCS intervention, intervention curve exceeded' : 'protection intervention, speed above the permitted one', run); }
      else if (sup.status === 'SBI' && !S.sbi) { S.sbi = true; S.sbiCount++; ev('WARN', 'ETCS commands the service brake'); }
      else if (sup.status === 'WAR' && !S.warnOn) { S.warnOn = true; S.warns++; ev('WARN', 'Warning: reduce speed (' + (sup.tgt ? sup.tgt.kind : 'line limit') + ')'); }
      if (sup.status !== 'WAR' && sup.status !== 'SBI') S.warnOn = false;
      if (S.sbi && S.v <= sup.vP) { S.sbi = false; ev('INFO', 'ETCS service brake released'); }
    }
    if (S.eb && S.v === 0) {
      S.ebStopT += dt;
      if (S.ebStopT > 3) { S.eb = false; S.uEM = false; if (S.lever <= -8) S.lever = 0; ev('INFO', 'Emergency brake released. The train may start again.'); }
    }
    if (S.v > 0.5 || S.vigAlarm) S.vigT += dt;
    if (!S.vigAlarm && S.vigT >= VIG_CYCLE) { S.vigAlarm = true; S.vigStart = S.t; ev('VIG', 'Vigilance: acknowledge within 5 s'); }
    if (S.vigAlarm && S.t - S.vigStart > VIG_GRACE) { S.vigAlarm = false; S.vigT = 0; S.vigMissed++; this.emergency('vigilance not acknowledged', run); }

    const stations = run.stations, st = stations[S.nextSt];
    if (st && !st.done) {
      const err = S.s - st.s;
      if (S.v === 0 && Math.abs(err) <= STOP_TOL) {
        st.done = true;
        const late = st.arr != null ? S.t - st.arr : null;
        S.stops.push({ name: st.name, err, late });
        run.realised.push({ station: st.name, arrival_s: S.t, departure_s: null });
        if (S.nextSt === stations.length - 1) { ev('STOP', 'Arrival at ' + st.name + ', stopping error ' + fmtErr(err)); brd.paxOpen(this, run, S.nextSt); this.finish(run); }
        else {
          S.doors = true; S.doorT = 0; run.pendingDep = run.realised.length - 1;
          if (run.driver !== 'controlled') S.doorDue = Math.max(S.t + run.dwells[S.nextSt], st.dep ?? -Infinity);
          brd.paxOpen(this, run, S.nextSt);
          ev('STOP', st.name + ': stopped at ' + fmtErr(err) + (run.freight ? '' : ', doors open'));
        }
      } else if (err > 60 || (S.v === 0 && err > STOP_TOL)) {
        st.done = true;
        S.stops.push({ name: st.name, err: null, late: null });
        run.realised.push({ station: st.name, arrival_s: null, departure_s: null });
        ev('WARN', 'Stop at ' + st.name + ' missed: head ' + Math.round(err) + ' m beyond the stop marker');
        S.nextSt++;
        if (S.nextSt >= stations.length) this.finish(run);
      }
    }
    if (S.doors) {
      S.doorT += dt;
      // the controlled train too keeps its doors open until the timetabled departure (and at least the minimum dwell)
      const dep = run.driver === 'controlled' ? stations[S.nextSt]?.dep ?? null : null;
      if ((run.driver === 'controlled' ? S.doorT >= DWELL && (dep == null || S.t + 1e-9 >= dep) : S.t + 1e-9 >= (S.doorDue ?? 0)) && S.t + 1e-9 >= (S.paxDue ?? 0) && !tfc.waitConnection(this, run, stations[S.nextSt]?.name, S.t)) { brd.paxClose(this, run, S.nextSt); S.doors = false; S.nextSt++; ev('INFO', run.freight ? 'Ready to leave' : 'Doors closed'); }
    }
    // the controlled train takes the passengers waiting at its origin when it leaves
    if (this.pax && run.driver === 'controlled' && !S.paxOrigin && S.v > 0 && stations.length) { S.paxOrigin = true; brd.paxClose(this, run, 0); }
    if (S.s > L.len - 5 && !S.finished) { ev('WARN', 'End of the line reached'); this.finish(run); }
  }

  /** Records a sample every LOG_DT seconds of simulated time; to be called after every step */
  sample(run?: TrainRun): void { out.recordSample(this, run); }

  csv(run: TrainRun = this.train): string { return out.csvOf(this, run); }

  /**
   * Onboard data for ATO (Subset-130) in line chainages, or null outside FS and with the automatic block.
   * With a message-based onboard they come from the onboard response; if the onboard does not provide them only the speeds remain.
   */
  etcsAto(run: TrainRun = this.train): EtcsAtoData | null { return out.etcsAto(this, run); }

  /**
   * API observation; consumes the events accumulated since the last call.
   * Version 3 (default) is the English format; versions 1 and 2 are the Italian formats of YuTreno 0.x, built from
   * version 3 by `toLegacy()` with the same keys in the same order (2 adds `etcs_ato` to 1).
   */
  observe(period: number, version: 1 | 2 | 3 = 3, run: TrainRun = this.train): Observation { return out.observe(this, period, version, run); }

  /** Results of the run used by the verdict */
  result(run: TrainRun = this.train): RunResult { return out.result(this, run); }

  /** Verdict with the criteria of the scenario, or with the default ones if the run has no scenario */
  verdict(run: TrainRun = this.train): Verdict { return out.verdict(this, run); }

  /**
   * Planned and realised timetable of every train: for every stop the timetabled and actual arrival and departure
   * (s from the start of the run) and the delays. Arrival is the stop at the marker, departure the first movement after it.
   */
  timetable() { return out.timetable(this); }

  /**
   * Snapshot of the traffic for the control room (docs/CONTROL_ROOM.md): network, signalling, trains and the last
   * `logLimit` events. It only reads the state of the run, and it is a function of it: two equal runs give equal snapshots.
   */
  controlRoom(logLimit = 200): ControlRoomSnapshot { return controlRoomSnapshot(this, logLimit); }

  /** Summary of the run for reports and checks */
  summary(run: TrainRun = this.train) { return out.summary(this, run); }
}
