/**
 * The state of a run (phase 8, R1): the state of a train (`SimState`, `TrainRun`) and of what is coupled to it (the
 * external dynamics, the multi-mass model, the message-based onboard), of the trackside and of the regulator, the
 * faults in force and the connections between trains. `Simulation` holds them; the modules of the engine read and
 * change them through it. They are re-exported by simulation.ts, where callers have always found them.
 */
import type { AutoDriverMemory } from './auto-driver';
import type { ReferenceEvc } from './evc';
import type { Field } from './field';
import type { Corridor, CorridorLeg, ItineraryLeg } from './network';
import type { BaliseGroup, Rbc } from './simple-rbc';
import type {
  BaliseTelegram, CompiledLine, CouplerDef, DynamicsResponse, MovementAuthority, OnboardResponse, RadioMessage, SimEvent, Station, StopRecord, Supervision, TrainParams, VehicleDef,
} from './types';
import type { ReferenceRegulator } from '../regulator';
import type { OperatorCommand, PanelState, Trackside, TracksideConfig } from '../trackside';

export interface SimState {
  t: number;
  s: number;
  v: number;
  a: number;
  /** Equivalent position of the master controller (−8…10) */
  lever: number;
  /** Continuous commands: traction and brake (0–1), emergency */
  uT: number;
  uB: number;
  uEM: boolean;
  Ft: number;
  Fb: number;
  Fed: number;
  R: number;
  Fg: number;
  grade: number;
  eT: number;
  eR: number;
  eb: boolean;
  ebStopT: number;
  sbi: boolean;
  warnOn: boolean;
  doors: boolean;
  doorT: number;
  /** Service trains: time at which the doors close (minimum dwell and timetabled departure) */
  doorDue?: number;
  /** With passengers: time at which those boarding and alighting have finished (docs/PASSENGERS.md) */
  paxDue?: number;
  /** With passengers: the controlled train has taken the passengers waiting at its origin */
  paxOrigin?: boolean;
  nextSt: number;
  stops: StopRecord[];
  vigT: number;
  vigAlarm: boolean;
  vigStart: number;
  finished: boolean;
  rows: (string | number)[][];
  events: SimEvent[];
  trace: [number, number][];
  nextLog: number;
  warns: number;
  /** Time in which the signalling, not the line or the stop, held the permitted speed down (s, outputs.ts) */
  sigT: number;
  sbiCount: number;
  interventions: number;
  spad: number;
  reactions: number[];
  vigMissed: number;
  maxOverLine: number;
  slip: boolean;
  wsp: boolean;
  slipT: number;
  ma: MovementAuthority | null;
  sup: Supervision;
  evCursor: number;
  ctlTicks: number;
  /** Who is driving the train, written in the CSV */
  commandSource: string;
  /** Brake applications commanded by ETCS because of missing RBC messages */
  radioBrakes: number;
  /** Speed of the last vehicle (m/s) */
  vTail: number;
  /** Maximum coupler tension and compression at this instant and over the run (N, positive) */
  Tnow: number;
  Cnow: number;
  maxTension: number;
  maxCompression: number;
  /** Jerk at the head of the train, filtered (m/s³), and maximum absolute value */
  jerk: number;
  maxJerk: number;
  aPrev: number;
}

/** State of the co-simulation with an external dynamics model */
export interface ExternalState {
  /** Coupling interval (s) and metres of line sent ahead of the head */
  period: number;
  horizon: number;
  /** Interval covered by the last response [t0, t1] and state at its ends */
  t0: number;
  t1: number;
  s0: number;
  s1: number;
  v0: number;
  v1: number;
  /** Last response received */
  resp: DynamicsResponse | null;
  /** Number of exchanges made */
  exchanges: number;
}

/** State of the multi-mass model: one element per vehicle, from head to tail */
export interface MultiState {
  veh: VehicleDef[];
  n: number;
  M: number;
  mMot: number;
  /** Mass of the passengers on each vehicle (kg), from the first boarding on */
  pay?: Float64Array;
  cp: CouplerDef;
  kGal: number;
  /** Position of the front of each vehicle (m), speed, acceleration */
  x: Float64Array;
  v: Float64Array;
  a: Float64Array;
  /** Forces per vehicle (N) */
  Ft: Float64Array;
  Fb: Float64Array;
  Fg: Float64Array;
  R: Float64Array;
  /** Coupler forces, positive in tension (N); T[j] is between vehicles j and j+1 */
  T: Float64Array;
  /** Davis resistance shares per vehicle */
  cA: Float64Array;
  cB: Float64Array;
  cC: Float64Array;
  /** Delay of the brake command per vehicle (s) and history of the command */
  delay: Float64Array;
  hist: Float64Array;
  histPos: number;
  /** Commanded tractive effort, before distribution */
  FtCmd: number;
}

/** State of the link with a message-based ETCS onboard (reference or external) */
export interface OnboardState {
  kind: 'reference' | 'external';
  /** Onboard cycle (s) and end of the cycle covered by the last response */
  period: number;
  t1: number;
  exchanges: number;
  /** Balise groups of the line and message-based RBC, shared by all the trains of the run */
  bgs: BaliseGroup[];
  rbc: Rbc;
  /** Train identifier in the RBC (NID_ENGINE): 1 for the controlled train, then the services in order */
  engine: number;
  /**
   * On a network, a train that is not on the main line alone has its own balise groups and RBC laid along its
   * corridor: positions are then in the chainages of the corridor, which it always runs forwards. `baseLim` are
   * the limits of the corridor without temporary restrictions
   */
  own: boolean;
  baseLim: [number, number, number][];
  /** Reference onboard, only with kind 'reference' */
  ref: ReferenceEvc | null;
  /** Balises read and RBC messages waiting for the next cycle */
  pendingBg: { odometer_m: number; telegram: BaliseTelegram }[];
  pendingRadio: RadioMessage[];
  /** Last response, position at the response and supervision to show */
  resp: OnboardResponse | null;
  sAtResp: number;
  sup: Supervision;
  /** Chainage corresponding to the odometer zero */
  s0: number;
  /**
   * Error of the odometry sent to the onboard (`odometry_drift`): the error `err` (m) accumulated up to the true
   * position `s`, growing by `slope` metres for every metre run; zero without the event (internal, read by onboard-bridge.ts)
   */
  odo: { err: number; slope: number; s: number };
  /** End of authority already counted as passed */
  eoaPassed: number;
  /** Log of the radio messages in both directions */
  log: { t: number; direction: 'RBC→onboard' | 'onboard→RBC'; msg: RadioMessage }[];
}

/** State of the interlocking trackside (trackside component in process or external) */
export interface TracksideState {
  kind: 'interlocking' | 'external';
  period: number;
  t1: number;
  exchanges: number;
  cfg: TracksideConfig;
  field: Field;
  /** The field of every line of the network, the main line first (on a single line: `field` alone) */
  fields: Field[];
  /** In-process component, only with kind 'interlocking' */
  ref: Trackside | null;
  /** Onboard messages for the RBC and control centre commands waiting for the next cycle */
  pendingRadio: RadioMessage[];
  pendingCmd: OperatorCommand[];
  /** Commands to send at the cycle after the pending ones (the revocation after a scenario emergency stop) */
  nextCmd: OperatorCommand[];
  panel: PanelState | null;
  /** Warnings from the translation of the control tables */
  warnings: string[];
}

/** State of the exchange with the traffic regulator */
export interface RegulatorState {
  kind: 'reference' | 'external';
  period: number;
  t1: number;
  exchanges: number;
  /** In-process reference regulator, only with kind 'reference' */
  ref: ReferenceRegulator | null;
}

/** State of the faults and conditions imposed by the scenario */
export interface FaultState {
  radioOk: boolean;
  radioLostAt: number;
  radioTimeout: number;
  radioBrake: boolean;
  /** Several RBCs: the RBC whose radio link is lost (radio_loss with `rbc`), the others keep working */
  radioRbc?: number;
  /** Efficiency factors of brake and traction */
  brake: number;
  traction: number;
  /** Low-adhesion zones [from, to, μ] */
  adh: [number, number, number][];
  /** Temporary speed restrictions [from, to, km/h] */
  tsr: [number, number, number][];
}

/**
 * One train of the run with everything that belongs to it: parameters, state, dynamics model and ETCS onboard.
 * Today a run has a single train, `trains[0]`; the per-train methods of `Simulation` take a `TrainRun`, so that
 * more trains can be added without touching the dynamics or the onboard link (docs/design/core.md).
 */
export interface TrainRun {
  /** Identifier, unique in the run; the order of `trains` is the order in which trains advance */
  readonly id: string;
  /** Train parameters (mass and length completed from the consist with the multi-mass model) */
  readonly TR: TrainParams;
  /** Equivalent mass with rotating masses (kg), passengers on board included */
  ME: number;
  /** Mass of the passengers on board (kg), already in `TR.m` and `ME`; 0 without passengers */
  payload: number;
  /** Index of the marker this train passed at danger, held as its end of authority while it stays at danger (internal) */
  passedAtDanger?: number;
  /** State that evolves over time */
  S: SimState;
  /** State of the multi-mass model, null with the point-mass model */
  readonly mm: MultiState | null;
  /** State of the co-simulation, null with the internal models */
  readonly ext: ExternalState | null;
  /** Message-based ETCS onboard, null with the internal supervision or the automatic block */
  readonly ob: OnboardState | null;
  /** Stations where this train stops, with its timetable; `done` marks those already served */
  readonly stations: Station[];
  /** Running direction: 1 towards increasing chainages, −1 the opposite one on the mirrored line */
  dir: 1 | -1;
  /**
   * The line as this train sees it, its corridor: the line itself or, for dir −1, the mirrored line; with a network
   * and a route along several lines, the compiled itinerary (src/core/network.ts). `S.s` is in its chainages
   */
  line: CompiledLine;
  /** The legs of the corridor: which line of the network, in which direction, every stretch comes from (a reroute changes them) */
  legs: CorridorLeg[];
  /** The corridor, with the origin of its signals when it is made of several lines */
  cor: Corridor;
  /** The itinerary on the network (lines, directions, stations where the train changes line); null off a network */
  itin: ItineraryLeg[] | null;
  /** Who drives: the cab or the controller of the run, the built-in ATO or an external agent (service trains) */
  readonly driver: 'controlled' | 'ato' | 'agent';
  /** False until a service train has appeared at its origin */
  active: boolean;
  /** Time from which a service train may appear at its origin */
  appear: number;
  /** Minimum dwell per station (s) */
  readonly dwells: number[];
  /** Memory and next decision time of the built-in driver */
  readonly mem: AutoDriverMemory;
  nextCtl: number;
  /** Realised timetable: actual arrival and departure at every station served */
  readonly realised: { station: string; arrival_s: number | null; departure_s: number | null }[];
  /** Index in `realised` of the stop the train has not yet left, or −1 */
  pendingDep: number;
  /** Requested track at each station (interlocking trackside), by station name */
  readonly tracks: Map<string, 'I' | 'II'>;
  /** Index of the train on the field of the interlocking trackside */
  fieldIndex: number;
  /** Authority received from the trackside RBC, in the chainages of the line */
  tma: MovementAuthority | null;
  /** Efficiency of brake and traction of this train (scenario faults: brake_degraded, traction_reduced) */
  brakeFactor: number;
  tractionFactor: number;
  /** Broken down until this time (train_stopped): no traction and full service brake */
  heldUntil: number;
  /**
   * Train integrity as the train interface reports it to a message-based onboard (`integrity_loss`): undefined until
   * the first such event, so that the requests of the runs without it do not change
   */
  integrityLost?: boolean;
  /** `radio_loss` with `train`: the radio of this train only is lost, in both directions (message-based onboard) */
  radioLost?: boolean;
  /** A freight train, the train ahead of the line: it carries no passengers and is not in the open data feeds */
  freight: boolean;
  /** Priority in conflicts set by the regulator (default 0) */
  priority: number;
  /** The timetable before the regulator: the reference for delays, with the stops it removed */
  readonly plan: { name: string; s: number; arr: number | null; dep: number | null }[];
  /** Cancelled by the regulator: the whole train, or from a station on (it ends there) */
  cancelled: null | 'all' | 'partial';
  /** Rolling stock circulation: its block, the service run before this one by the same train, and the minimum turnaround (s) */
  block: string | null;
  after: TrainRun | null;
  turnaround: number;
}

/** State of a connection between two trains at a station */
export interface ConnectionState {
  station: string;
  from: TrainRun;
  to: TrainRun;
  transfer: number;
  maxWait: number;
  /** pending until the departing train leaves; kept or lost then */
  outcome: 'pending' | 'kept' | 'lost';
  /** How long the departing train waited beyond its departure (s) */
  wait_s: number;
}
