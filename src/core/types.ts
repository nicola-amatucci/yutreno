/**
 * Types of the simulation core. All quantities are in SI units (m, s, m/s, kg, N, W) unless stated
 * otherwise; positions are chainages from the origin of the line and refer to the head of the train.
 */

export type Signalling = 'ETCS' | 'BACC';
export type TimeOfDay = 'day' | 'dusk' | 'night';
export type Weather = 'clear' | 'rain' | 'fog';
export type AdhesionSetting = 'auto' | 'dry' | 'wet' | 'leaves';

export interface Scenario {
  /** Signalling: ERTMS/ETCS level 2 or automatic block (BACC) with SCMT */
  sig: Signalling;
  tod: TimeOfDay;
  met: Weather;
  /** Rail adhesion; 'auto' derives it from the weather */
  adh: AdhesionSetting;
  /** ETCS only: who supervises on board (default 'internal', the simplified supervision) */
  onboard?: OnboardKind;
  /** Onboard cycle (s), a multiple of 5 ms; default 0.1 */
  onboard_period_s?: number;
  /** Message-based onboard only: national values replacing the defaults (`DEFAULT_NATIONAL`) */
  national_values?: Partial<OnboardNationalValues>;
  /** ETCS with a message-based onboard only: simple trackside (default) or interlocking and RBC of the trackside component */
  trackside?: TracksideKind;
  /** Trackside cycle (s), a multiple of 5 ms; default 0.1 */
  trackside_period_s?: number;
  /** Regulator of the traffic: none (default), the reference one in process, or an external program */
  regulator?: RegulatorKind;
  /** Regulator cycle (s), a multiple of 5 ms; default 5 */
  regulator_period_s?: number;
}

/** Regulator: 'none', 'reference' (src/regulator in process) or 'external' (a program speaking the regulator protocol) */
export type RegulatorKind = 'none' | 'reference' | 'external';

/** Trackside: 'simple' (block and RBC of the engine), 'interlocking' (trackside component in process), 'external' (external trackside component) */
export type TracksideKind = 'simple' | 'interlocking' | 'external';

export interface StationDef {
  name: string;
  /** Position of the stop marker (m) */
  s: number;
  /** Timetabled arrival and departure, in seconds from the start of the run */
  arr: number | null;
  dep: number | null;
}

export interface LeaderDef {
  on: boolean;
  /** Initial position of the head (m) */
  s0: number;
  /** Maximum speed (km/h) */
  vmax: number;
  /** Stopping point (m), 0 = no stop */
  stopAt: number;
  /** Duration of the stop (s) */
  wait: number;
  /** Length (m) */
  len: number;
  /**
   * Id of a built-in train or its complete parameters; default: the heavy freight train with as many wagons as fit
   * in `len`, at most at `vmax`
   */
  train?: string | TrainParams;
}

/** Line as written by the user or saved by the editor (JSON exchange format) */
export interface LineDef {
  name: string;
  /** Vertices of the horizontal alignment (x, y in m), joined by a spline */
  plan: [number, number][];
  /** Vertices of the vertical profile: [chainage m, altitude m a.s.l.] */
  profile: [number, number][];
  stations: StationDef[];
  /** Speed limits: [from m, to m, km/h] */
  limits: [number, number, number][];
  /** Tunnels: [from m, to m] */
  tunnels: [number, number][];
  /** Length of the block sections (m) */
  block: number;
  /** Train ahead (leader) */
  freight: LeaderDef;
  /** Built-in lines only: desired length the alignment is scaled to */
  fitLen?: number;
  /**
   * Georeferencing of the plan, for the open data feeds (GTFS, NeTEx, SIRI): WGS84 position of the plan origin and
   * rotation (degrees, counterclockwise) of the plan x axis from east. Without it the feeds use a default position.
   */
  geo?: { lat: number; lon: number; rotation_deg?: number };
  /** Imported lines only: attribution required by the sources of the data (for example the ODbL of OpenStreetMap) */
  attribution?: string;
}

/** A vehicle of the consist, from head to tail */
export interface VehicleDef {
  name?: string;
  /** Mass (kg) */
  m: number;
  /** Length between coupling points (m) */
  L: number;
  /** Vehicle with motored axles */
  motored: boolean;
}

/** Draw and buffer gear between two vehicles: spring and damper with slack */
export interface CouplerDef {
  /** Stiffness (N/m) */
  k: number;
  /** Damping (N·s/m) */
  c: number;
  /** Total slack (m): no force while the extension stays within ±slack/2 */
  slack: number;
}

export type DynamicsModel = 'multimass' | 'point' | 'external';

/** Parameters of the co-simulation with an external dynamics model */
export interface ExternalDynamicsDef {
  /** Coupling interval (s): how often the engine queries the model. A multiple of FIXED_DT, default 0.05 */
  period_s?: number;
  /** Metres of line sent ahead of the head with every request (default 500) */
  horizon_m?: number;
  /** WebSocket address of the model, used by the page (ws://localhost:8766); headless runs use --dynamics */
  address?: string;
}

/** Request from the engine to the external dynamics model: advance `dt` seconds with these inputs */
export interface DynamicsRequest {
  type: 'dynamics';
  version: 2;
  /** True only on the first request of the run: the model resets and reads `train` */
  start: boolean;
  /** Simulated time at the start of the interval and its duration (s) */
  t: number;
  dt: number;
  /** State known to the engine at the start of the interval (the one returned by the previous response) */
  state: { pos_m: number; vel_ms: number };
  /** Commands already filtered by the protection: traction and brake 0–1, emergency, doors (traction inhibited) */
  commands: { traction: number; brake: number; emergency: boolean; doors_open: boolean };
  /** Line around the train, from `from_m` (behind the tail) to `to_m` (ahead of the head) */
  track: {
    from_m: number;
    to_m: number;
    /** Actual adhesion under the train, including the low-adhesion zones of the scenarios */
    adhesion_mu: number;
    /** [from_m, to_m, gradient ‰] positive uphill */
    gradients: [number, number, number][];
    /** [from_m, to_m, radius m] of curved stretches; straight track is omitted */
    curves: [number, number, number][];
    /** [from_m, to_m] of the tunnels */
    tunnels: [number, number][];
  };
  /** Scenario fault factors to apply to the forces (1 = no fault) */
  faults: { brake_factor: number; traction_factor: number };
  /** Train parameters, only with `start`; `m` is the mass without passengers */
  train?: TrainParams;
  /** With passengers (docs/PASSENGERS.md): mass of the people on board (kg), to add to `train.m` and to the equivalent mass */
  payload_kg?: number;
}

/** Response of the external model: state of the head at the end of the interval. Only pos_m and vel_ms are required */
export interface DynamicsResponse {
  pos_m: number;
  vel_ms: number;
  acc_ms2?: number;
  /** Forces at the last instant of the interval (kN, positive) */
  forces_kN?: { traction?: number; brake?: number; electric_brake?: number; resistance?: number; gradient?: number };
  slip?: boolean;
  wsp?: boolean;
  tail_speed_ms?: number;
  /** Coupler forces from head to tail, positive in tension (kN) */
  coupler_forces_kN?: number[];
  /** Cumulative energies since the start of the run (kWh); if missing the engine estimates them from the forces */
  traction_energy_kWh?: number;
  regenerated_energy_kWh?: number;
  /** Free text, written to the run log */
  note?: string;
}

export interface TrainParams {
  name: string;
  /** Computation model: 'multimass' (default), 'point' (point mass, for teaching) or 'external' (co-simulation) */
  model?: DynamicsModel;
  /** Only with the 'external' model */
  external?: ExternalDynamicsDef;
  /** Consist from head to tail; if missing it is derived from mass and length */
  consist?: VehicleDef[];
  coupler?: CouplerDef;
  /** Electro-pneumatic brake: the command reaches all vehicles at once */
  epBrake?: boolean;
  /** Propagation speed of the brake-pipe command for the pneumatic brake (m/s) */
  vProp?: number;
  /** Factor on aerodynamic resistance in tunnels */
  kTunnel?: number;
  /** Mass (kg) */
  m: number;
  /** Rotating mass factor */
  rot: number;
  /** Length (m) */
  L: number;
  /** Power at the wheel (W) */
  Pw: number;
  /** Maximum starting tractive effort (N) */
  Fmax: number;
  /** Passenger capacity (docs/PASSENGERS.md): seats, standing places and doorways per side; defaults from the length */
  seats?: number;
  standing?: number;
  doors?: number;
  /** Share of the mass on motored axles (0–1) */
  adh: number;
  /** Davis resistance R = A + B·v + C·v² (N, N/(m/s), N/(m/s)²) */
  A: number;
  B: number;
  C: number;
  /** Nominal service and emergency decelerations (m/s²) */
  bSvc: number;
  bEm: number;
  /** Brake application and release time constants (s) */
  tauB: number;
  tauR: number;
  /** Traction efficiency */
  eta: number;
  /** Maximum electric brake force (N) */
  edMax: number;
  /** Regenerative braking efficiency */
  etaR: number;
  /** Maximum train speed (m/s) */
  vmax: number;
}

export type Aspect = 'G' | 'Y' | 'R';

export interface Signal {
  s: number;
  id: string;
  /** Index of the station it is the starting signal of, otherwise null */
  st: number | null;
  /** P starting signal, B intermediate block signal, H home signal */
  kind: 'P' | 'B' | 'H';
  asp: Aspect;
}

export interface ProfileSegment {
  a: number;
  b: number;
  alt0: number;
  /** Gradient (‰), positive uphill */
  i: number;
}

export interface Station extends StationDef {
  done: boolean;
  /** A stop in open line, not a station of the line: the stop of the train ahead away from the stations */
  halt?: boolean;
}

export interface CompiledLine {
  def: LineDef;
  len: number;
  /** Samples every STEP metres */
  N: number;
  X: Float64Array;
  Y: Float64Array;
  /** Curvature (1/m), positive to the right in the running direction */
  K: Float64Array;
  /** Integral of the curvature (rad) */
  HEAD: Float64Array;
  prof: ProfileSegment[];
  /** Contiguous limits [from, to, km/h], the last one up to 1e9 */
  lim: [number, number, number][];
  st: Station[];
  tun: [number, number][];
  sig: Signal[];
  rmin: number;
  imax: number;
  iup: number;
  amin: number;
  amax: number;
  warnings: string[];
}

export type SupervisionStatus = 'NOR' | 'IND' | 'OVS' | 'WAR' | 'SBI' | 'INT';

export interface Target {
  /** Distance from the head of the train (m) */
  d: number;
  /** Target speed (m/s) */
  v: number;
  kind: string;
}

export interface Supervision {
  mode: Signalling;
  vMRSP: number;
  vP: number;
  vW: number;
  vSBI: number;
  vEBI: number;
  tgt: Target | null;
  ind: boolean;
  status: SupervisionStatus;
}

export interface MovementAuthority {
  eoa: number;
  svl: number;
  why: string;
}

export type EventKind = 'INFO' | 'WARN' | 'EMG' | 'VIG' | 'STOP' | 'SIG' | 'CTL' | 'FAULT';

export interface SimEvent {
  t: number;
  s: number;
  kind: EventKind;
  text: string;
  /** Scenario event the driver cannot perceive: logged but neither shown nor sent to controllers */
  hidden?: boolean;
}

export interface StopRecord {
  name: string;
  /** Stopping error (m), null if the stop was missed */
  err: number | null;
  /** Delay against the timetable (s) */
  late: number | null;
}

/** Command sent by a controller: omitted fields leave the previous command unchanged */
export interface Command {
  traction?: number;
  brake?: number;
  lever?: number;
  vigilance?: boolean;
  emergency?: boolean;
  note?: string;
}

/**
 * Data the ETCS onboard makes available to ATO, modelled on packets 6 (ETCS_ATO_Dynamic) and 11
 * (ETCS_ATO_BRAKE_DECELERATIONS) of Subset-130. Names are those of the specification, units are SI
 * (m, m/s, m/s², s) instead of cm, cm/s and mm/s². Present only in Full Supervision (FS), as in the specification.
 *
 * N_LOC_* positions are line chainages in the controller observation and odometer readings of the onboard
 * in the external onboard protocol (`OnboardDmi.ato`): in both cases they are estimated positions of the head.
 */
export interface EtcsAtoData {
  /** ETCS mode (FS) */
  M_MODE: string;
  /** Speed and acceleration estimated by odometry */
  V_EST: number;
  A_EST: number;
  /** Permitted speed at the current point and MRSP from the rearmost possible position of the head */
  V_PERMITTED: number;
  V_MRSP: number;
  /** MRSP changes ahead of the train: [N_LOC_MRSP, V_MRSP]; an increase applies once the tail has cleared the stretch */
  MRSP: [number, number][];
  /** Estimated position of the nearest emergency brake intervention (EBI) limit for the current speed; null if none is supervised */
  N_LOC_EBI: number | null;
  /** Supervised end or limit of authority and the permitted speed there; supervised location */
  N_LOC_EOALOA: number | null;
  V_EOALOA: number | null;
  N_LOC_SVL: number | null;
  /** Release speed, if supervised */
  V_RELEASE_ATO: number | null;
  /** Safe emergency brake deceleration (packet 11), without the gradient contribution; null if unknown */
  A_BRAKE_SAFE: number | null;
  /** Deceleration due to the gradient, positive uphill: [N_LOC_GRADCHANGE, A_GRADIENT] */
  GRADIENT: [number, number][];
  /** Time traction remains after the emergency command and emergency brake reaction time (s) */
  T_TRACTION: number;
  T_BE_REACT: number;
  /** Over-reading and under-reading location uncertainty (m) */
  L_UNCERTAINTY_OVERREADING: number;
  L_UNCERTAINTY_UNDERREADING: number;
}

export interface Observation {
  /**
   * API version. 3 is the English format; 1 and 2 are the Italian formats of YuTreno 0.x (see `legacy.ts`),
   * 2 adding `etcs_ato` to 1
   */
  version: 1 | 2 | 3;
  /** Identifier of the observed train, only when the run has more than one train */
  train_id?: string;
  t: number;
  dt: number;
  pos_m: number;
  vel_ms: number;
  acc_ms2: number;
  lever: number;
  traction: number;
  brake: number;
  forces_kN: { traction: number; brake: number; electric_brake: number; resistance: number; gradient: number };
  doors_open: boolean;
  emergency: boolean;
  vigilance_alarm: boolean;
  /** Nominal adhesion of the scenario: low-adhesion zones are not known on board */
  adhesion_mu: number;
  slip: boolean;
  wsp: boolean;
  /** Radio link with the RBC (always true with the automatic block) */
  radio_ok: boolean;
  /** Active temporary speed restrictions: [from_m, to_m, v_ms] */
  speed_restrictions: [number, number, number][];
  /** Dynamics model in use */
  model: DynamicsModel;
  /** Speed of the last vehicle (m/s) */
  tail_speed_ms: number;
  /** Jerk at the head of the train, filtered (m/s³) */
  jerk_ms3: number;
  /** Coupler forces from head to tail, positive in tension (kN); empty with the point mass */
  coupler_forces_kN: number[];
  /** Onboard supervision in use; with a message-based onboard also the ETCS mode and the last relevant balise group */
  onboard: { type: OnboardKind; mode: string | null; lrbg: number | null };
  signalling: Signalling;
  supervision: {
    state: SupervisionStatus;
    v_permitted_ms: number;
    v_warning_ms: number | null;
    v_intervention_ms: number | null;
    v_mrsp_ms: number;
    target: { distance_m: number; speed_ms: number; type: string } | null;
  };
  ma: { eoa_m: number; svl_m: number; v_release_ms: number; reason: string } | null;
  signal: { id: string; pos_m: number; aspect: 'green' | 'yellow' | 'red' } | null;
  speed_profile: [number, number, number][];
  gradient_profile: [number, number, number][];
  current_gradient_permille: number;
  next_stop: { name: string; pos_m: number; arrival_s: number | null; departure_s: number | null } | null;
  line: { name: string; length_m: number };
  train: {
    name: string;
    mass_kg: number;
    equivalent_mass_kg: number;
    length_m: number;
    power_W: number;
    max_force_N: number;
    decel_service_ms2: number;
    decel_emergency_ms2: number;
    vmax_ms: number;
    davis: { A: number; B: number; C: number };
  };
  events: { t: number; type: EventKind; text: string }[];
  /** Versions 2 and 3: ETCS onboard data for ATO (Subset-130); null with the automatic block or outside FS */
  etcs_ato?: EtcsAtoData | null;
}

// ---------------------------------------------------------------------------------------------
// External ETCS onboard: protocol between the engine (trackside, odometry, train) and an onboard computer (EVC).
// Packets and messages use the variable names of Subset-026, with values already decoded.

/** Who performs ETCS supervision: the simplified internal one, the reference onboard of the core or an external EVC */
export type OnboardKind = 'internal' | 'reference' | 'external';

/** Decoded ETCS packet: NID_PACKET plus the Subset-026 variables; iterations are arrays of objects in `elements` */
export type EtcsPacket = { NID_PACKET: number } & Record<string, unknown>;

/** Telegram of a balise (Subset-026 §8.3 header and packets) */
export interface BaliseTelegram {
  Q_UPDOWN: number;
  M_VERSION: number;
  Q_MEDIA: number;
  /** Position of the balise in the group (0 = first in the nominal direction) and number of balises in the group, minus one */
  N_PIG: number;
  N_TOTAL: number;
  M_DUP: number;
  M_MCOUNT: number;
  NID_C: number;
  NID_BG: number;
  Q_LINK: number;
  packets: EtcsPacket[];
}

/** Radio message between RBC and onboard (Subset-026 §8.4–8.8): NID_MESSAGE, header and packets */
export type RadioMessage = { NID_MESSAGE: number; T_TRAIN: number; packets?: EtcsPacket[] } & Record<string, unknown>;

/** Train data for the onboard (Subset-026 §3.18, with constant decelerations) */
export interface OnboardTrainData {
  NID_ENGINE: number;
  /** Train length (m) and maximum speed (km/h) */
  L_TRAIN: number;
  V_MAXTRAIN: number;
  /** Emergency and service brake decelerations (m/s²), constant with speed */
  A_brake_emergency: number;
  A_brake_service: number;
  /** Equivalent emergency and service brake build-up times and traction cut-off time (s) */
  T_brake_emergency: number;
  T_brake_service: number;
  T_traction_cut_off: number;
  /** Rotating mass (% of the mass) for the gradient correction */
  M_rotating: number;
}

/** National and design values used by the onboard; names follow Subset-026 where they exist */
export interface OnboardNationalValues {
  /** Maximum time without messages from the RBC (s) and reaction: 0 trip, 1 service brake, 2 none */
  T_NVCONTACT: number;
  M_NVCONTACT: number;
  /** Speed margins for ceiling speed supervision (km/h) */
  dV_ebi_min: number; dV_ebi_max: number; V_ebi_min: number; V_ebi_max: number;
  dV_sbi_min: number; dV_sbi_max: number; V_sbi_min: number; V_sbi_max: number;
  dV_warning_min: number; dV_warning_max: number; V_warning_min: number; V_warning_max: number;
  /** Driver and warning times (s) */
  T_driver: number;
  T_warning: number;
  /** Odometry error: fixed part (m) and part proportional to the distance from the balise */
  odo_error_fixed_m: number;
  odo_error_relative: number;
}

/** Request from the engine to the onboard: everything the onboard receives in the last cycle */
export interface OnboardRequest {
  type: 'onboard';
  version: 2;
  /** True only on the first request: the onboard resets and reads train data, national values and stored position */
  start: boolean;
  t: number;
  dt: number;
  /** Odometry: distance travelled since departure, speed and acceleration of the head (without errors) */
  odometry: { distance_m: number; speed_ms: number; acceleration_ms2: number };
  /** Balises read in the cycle, in order, with the odometer reading at passage */
  balises: { odometer_m: number; telegram: BaliseTelegram }[];
  /** RBC messages received in the cycle (none if the radio has failed) */
  radio: RadioMessage[];
  /**
   * Train state read through the train interface; `integrity` (optional) is the train integrity from an external source
   * (Subset-026 §3.6.5.2): absent, the onboard takes it as confirmed
   */
  train: { doors_open: boolean; emergency_applied: boolean; traction: number; brake: number; integrity?: 'confirmed' | 'lost' };
  train_data?: OnboardTrainData;
  national_values?: OnboardNationalValues;
  /** Valid position stored at start-up: last relevant balise group and distance of the head (m) */
  /**
   * Stored position: group and distance from it; Q_DIRLRBG = 0 when the train stands oriented against the nominal
   * direction of that group (optional, nominal when missing)
   */
  stored_position?: { NID_LRBG: number; D_LRBG: number; Q_DIRLRBG?: 0 | 1 };
}

/** Onboard indications for the DMI (speeds in m/s, distances in m) */
export interface OnboardDmi {
  mode: string;
  state: SupervisionStatus;
  v_mrsp_ms: number;
  v_permitted_ms: number;
  v_warning_ms: number;
  v_sbi_ms: number;
  v_intervention_ms: number;
  v_release_ms?: number | null;
  target?: { distance_m: number; speed_ms: number; type: string } | null;
  indication?: boolean;
  text?: string;
  /** Optional: data for ATO modelled on Subset-130, with positions as odometer readings */
  ato?: EtcsAtoData | null;
}

/** Onboard response: commands to the train (TIU), messages for the RBC and DMI */
export interface OnboardResponse {
  outputs: { service_brake: boolean; emergency: boolean; traction_cut_off: boolean };
  /** Why the onboard commands the emergency brake: 'intervention' (curve exceeded), 'trip' (end of authority), 'emergency_stop' (RBC order), other */
  emergency_reason?: string;
  radio?: RadioMessage[];
  dmi: OnboardDmi;
  /** Optional, for the log: location reference and uncertainty */
  position?: { NID_LRBG: number; D_LRBG: number; L_DOUBTOVER: number; L_DOUBTUNDER: number };
  note?: string;
}

// ---------------------------------------------------------------------------------------------
// Regulator protocol (docs/REGULATOR.md): the state of the traffic goes out, decisions on the timetable come back

/** A stop of a train as the regulator sees it: the original plan, the current timetable and what happened */
export interface RegulatorStop {
  station: string;
  /** Chainage of the stop marker in the line (m) */
  s_m: number;
  planned_arrival_s: number | null;
  planned_departure_s: number | null;
  /** Current timetable, after the decisions of the regulator */
  arrival_s: number | null;
  departure_s: number | null;
  min_dwell_s: number;
  track: 'I' | 'II' | null;
  /** The regulator removed the stop: the train passes */
  skipped: boolean;
  /** On a network: the line of the stop, whose chainage `s_m` is (the main line when the train runs on it there) */
  line?: string;
  realised_arrival_s: number | null;
  realised_departure_s: number | null;
}

/** A train in the regulator request */
export interface RegulatorTrain {
  id: string;
  /** NID_ENGINE, with a message-based onboard */
  engine: number | null;
  /** Name of the train type (preset) */
  category: string;
  /** +1 towards the end of the line, −1 back towards the origin */
  dir: 1 | -1;
  /** On the line now; a service not yet appeared is not active */
  active: boolean;
  finished: boolean;
  /** Head position in the chainages of the line (m) and speed */
  s_m: number;
  v_kmh: number;
  /** Station where the train stands with the doors open, or null */
  at_station: string | null;
  /** Next station to serve, or null after the last */
  next_station: string | null;
  /** Delay against the plan at the last event (arrival or departure), s; null before the first */
  delay_s: number | null;
  /** Track the train is on, inside a station (interlocking trackside), or null */
  track_now: 'I' | 'II' | null;
  /** Faults of the train: broken down, until a time if known (null with broken true: until further notice) */
  broken: boolean;
  broken_until_s: number | null;
  traction_factor: number;
  brake_factor: number;
  priority: number;
  stops: RegulatorStop[];
  /** Cancelled by the regulator: entirely or from a station on (stops removed are `skipped`) */
  cancelled?: 'all' | 'partial';
  /**
   * On a network: the lines the train runs along, and the line its head is on with the chainage there. `s_m` and
   * `dir` refer to the main line when the route uses it (the head projected on it while the train is elsewhere)
   */
  route?: string[];
  position?: { line: string; s_m: number } | null;
}

/** A disruption in force */
export interface RegulatorDisruption {
  /** Index of the scenario event */
  id: number;
  type: string;
  train?: string;
  from_m?: number;
  to_m?: number;
  element?: string;
  since_s: number;
  /** Expected end, if the event has a duration */
  until_s: number | null;
  text: string;
}

/** Request to the regulator, every `regulator_period_s` */
export interface RegulatorRequest {
  type: 'regulator';
  version: 1;
  start: boolean;
  t: number;
  /** First request only: the line, the signalling and, with the interlocking trackside, its routes */
  configuration?: {
    line: string;
    length_m: number;
    stations: { name: string; s_m: number }[];
    signalling: Signalling;
    trackside: TracksideKind;
    conflict_rule: 'timetable' | 'first_come';
    routes?: { id: string; name: string; station: number | null; station_name: string | null; type: string; branch_start: string; branch_end: string }[];
    /** On a network: its lines, the first being the main one, with their stations; the nodes are the shared stations */
    network?: { name: string; lines: { id: string; name: string; length_m: number; stations: { name: string; s_m: number }[] }[] };
  };
  /** Connections between trains, with their maximum wait (possibly changed by the regulator) and outcome */
  connections?: { station: string; from: string; to: string; transfer_s: number; max_wait_s: number; outcome: 'pending' | 'kept' | 'lost' }[];
  trains: RegulatorTrain[];
  disruptions: RegulatorDisruption[];
  /** With the interlocking trackside: the state of the routes from the last panel */
  routes?: { id: string; name: string; state: string }[];
}

/** Decision of the regulator */
export type RegulatorCommand =
  /** New arrival and/or departure at a stop not yet left (rescheduling); the plan stays the reference for delays */
  | { type: 'retime'; train: string; station: string; arrival_s?: number | null; departure_s?: number | null }
  /** The train passes a station where it was timetabled to stop (not the origin nor the destination) */
  | { type: 'skip_stop'; train: string; station: string }
  /**
   * Cancellation: without `from_station`, a train not yet appeared is cancelled entirely and a train on the line ends
   * at its next station; with it, the train ends at that station. It then leaves the line. Not for the controlled train
   */
  | { type: 'cancel'; train: string; from_station?: string }
  /** Track to use in a station (interlocking trackside) */
  | { type: 'track'; train: string; station: string; track: 'I' | 'II' }
  /** Priority in conflicts, default 0: the higher goes first (interlocking routes, consent of single-track sections) */
  | { type: 'priority'; train: string; value: number }
  /** A control centre command for the interlocking trackside (set_route, cancel_route, ars, …) */
  | { type: 'operator'; command: Record<string, unknown> }
  /**
   * On a network, a train not yet appeared runs along other lines (ids in running order); its stops not on them
   * are removed, origin and destination must stay
   */
  | { type: 'reroute'; train: string; route: string[] }
  /** New maximum wait of a connection still pending (0: the departing train no longer waits) */
  | { type: 'connection'; from: string; to: string; station: string; max_wait_s: number };

/**
 * Command of the dispatcher (`Simulation.dispatch`): a decision of the regulator, or a temporary speed restriction
 * from `from_m` to `to_m` of the main line, put in force now or revoked
 */
export type DispatchCommand = RegulatorCommand | { type: 'speed_restriction'; from_m: number; to_m: number; v_kmh: number; revoke?: boolean };

/** Response of the regulator */
export interface RegulatorResponse {
  commands: RegulatorCommand[];
  /** Notes written in the run log */
  log?: string[];
}
