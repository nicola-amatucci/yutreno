/**
 * Scenarios of events and faults, and the verdict of a run.
 *
 * A scenario is a JSON file that chooses line, train and conditions and schedules events triggered at a given time
 * or when the head of the train reaches a position: loss of the radio link with the RBC, temporary speed
 * restrictions, low-adhesion zones, degraded brake or traction, the train ahead stopping, emergency stop from the
 * RBC, messages, and with the interlocking trackside point and track circuit failures and control centre commands.
 * The criteria of the scenario produce an objective verdict (passed or failed) at the end of the run. Scenarios in
 * the Italian format of YuTreno 0.x are accepted and translated (see `legacy.ts`).
 */
import { fitPlan } from './line';
import { validatePassengers, type PassengerDef } from './passengers';
import { toEnglish } from './legacy';
import { DEFAULT_SCENARIO, LINE_PRESETS, NETWORK_PRESETS, TRAIN_PRESETS, clone } from './presets';
import type { NetworkDef } from './network';
import type { AdhesionSetting, DispatchCommand, LeaderDef, LineDef, OnboardKind, RegulatorKind, Scenario, Signalling, StopRecord, TracksideKind, TrainParams, Weather } from './types';

export type FaultType =
  | 'radio_loss' | 'integrity_loss' | 'odometry_drift' | 'speed_restriction' | 'low_adhesion' | 'brake_degraded' | 'traction_reduced'
  | 'leader_stopped' | 'rbc_emergency_stop' | 'message'
  | 'point_failure' | 'tvps_failure' | 'operator_command' | 'train_stopped' | 'line_blocked' | 'dispatch';

/** Event types allowed in scenarios, in the order of the documentation */
export const FAULT_TYPES: FaultType[] = ['radio_loss', 'integrity_loss', 'odometry_drift', 'speed_restriction', 'low_adhesion', 'brake_degraded', 'traction_reduced', 'leader_stopped', 'rbc_emergency_stop', 'message', 'point_failure', 'tvps_failure', 'operator_command', 'train_stopped', 'line_blocked', 'dispatch'];

export interface ScenarioEventDef {
  type: FaultType;
  /** When it fires: at time t (s), when the head reaches pos (m), or both. Without indications it fires at departure */
  when?: { t?: number; pos?: number };
  /** Duration (s); without a duration the effect lasts until the end of the run */
  duration_s?: number;
  /** Affected stretch (m), for speed restrictions and low adhesion */
  from_m?: number;
  to_m?: number;
  /** Maximum speed of the restriction (km/h) */
  v_kmh?: number;
  /** Adhesion coefficient in the zone */
  mu?: number;
  /** Efficiency factor (0–1) for degraded brake and traction */
  factor?: number;
  /** `odometry_drift`: error of the odometer per metre run, positive when it reads more than the train has run (0.05 = 50 m per km) */
  slope?: number;
  /** Time without RBC messages after which ETCS commands braking (s, default 20) */
  timeout_s?: number;
  /** `radio_loss` with several RBCs (`rbc_borders_m`): only the radio link with this RBC (NID_RBC) is lost */
  rbc?: number;
  /** Text of the message */
  text?: string;
  /** Shows the event to the driver and to controllers; the default depends on the type */
  announced?: boolean;
  /** Interlocking trackside only: failed element (point or section, «Station/1», «Line/B3») and failure mode of the point */
  element?: string;
  mode?: 'blocked' | 'no_detection';
  /** Interlocking trackside only: control centre command to execute (see OperatorCommand in src/trackside/types.ts) */
  command?: { type: string; [k: string]: unknown };
  /**
   * Train the event concerns, by service id (default: the controlled train): for degraded brake, reduced traction,
   * stopped train, integrity loss, odometry drift and the radio of one train (`radio_loss` with a message-based onboard); `when.pos` is then the position of that train
   */
  train?: string;
  /**
   * `dispatch` only: a command of the dispatcher (`Simulation.dispatch`), given at `when.t` as if from the control
   * room; `dispatchedEvents` writes the commands of a run in this form (docs/CONTROL_ROOM.md)
   */
  dispatch?: DispatchCommand;
}

/** The commands a dispatcher gave in a run (`Simulation.dispatched`), as scenario events that give them again */
export function dispatchedEvents(d: readonly { t_s: number; command: DispatchCommand }[]): ScenarioEventDef[] {
  return d.map(x => ({ type: 'dispatch', when: { t: x.t_s }, dispatch: JSON.parse(JSON.stringify(x.command)) }));
}

/**
 * A scenario with the commands of the dispatcher as its `dispatch` events (the run repeated with them). The record of
 * a run also holds the commands its scenario gave, so they replace the `dispatch` events the scenario had
 */
export function withDispatched(def: ScenarioDef, d: readonly { t_s: number; command: DispatchCommand }[]): ScenarioDef {
  const out: ScenarioDef = JSON.parse(JSON.stringify(def));
  out.events = [...(out.events ?? []).filter(e => e.type !== 'dispatch'), ...dispatchedEvents(d)];
  return out;
}

export interface Criteria {
  /** The run must reach the terminus (default true) */
  complete?: boolean;
  /** Maximum arrival time (s) */
  arrival_max_s?: number;
  /** Maximum arrival delay against the timetable (s) */
  delay_max_s?: number;
  /** Maximum stopping error, absolute value (m, default 5) */
  stop_error_max_m?: number;
  /** Missed stops allowed (default 0) */
  missed_stops_max?: number;
  /** Protection interventions allowed (default 0) */
  interventions_max?: number;
  /** Red signals or ends of authority passed allowed (default 0) */
  overruns_max?: number;
  /** Missed vigilance acknowledgements allowed (default 0) */
  missed_vigilance_max?: number;
  /** Maximum excess over the line limit (km/h) */
  over_limit_max_kmh?: number;
  /** Maximum net energy (kWh) */
  energy_max_kWh?: number;
  /** Maximum coupler tension (kN) */
  tension_force_max_kN?: number;
  /** Maximum coupler compression (kN) */
  compression_force_max_kN?: number;
  /** Maximum jerk at the head of the train (m/s³), a comfort index */
  jerk_max_ms3?: number;
}

export interface ScenarioDef {
  name: string;
  description?: string;
  /** Id of a built-in line or the complete line; with a network, the main line (default: the first line of the network) */
  line?: string | LineDef;
  /**
   * Id of a built-in network or the complete network (docs/design/network.md): lines that meet in the stations they
   * share. Services can then run along several lines (`route`); the controlled train runs on the main line
   */
  network?: string | NetworkDef;
  /** Id of a built-in train or its complete parameters */
  train?: string | TrainParams;
  signalling?: Signalling;
  weather?: Weather;
  adhesion?: AdhesionSetting;
  /** ETCS only: onboard and trackside (default: those of the conditions) */
  onboard?: OnboardKind;
  trackside?: TracksideKind;
  /** Changes to the train ahead of the line */
  leader?: Partial<LeaderDef>;
  events?: ScenarioEventDef[];
  criteria?: Criteria;
  /** Other trains of the timetable, driven by the built-in ATO (the controlled train keeps the line timetable) */
  services?: ServiceDef[];
  /**
   * Interlocking trackside with several trains: order of conflicting requests of automatic route setting, by
   * timetabled time (default) or by the time each train started waiting ('first_come')
   */
  conflict_rule?: 'timetable' | 'first_come';
  /**
   * Interlocking trackside only: borders between RBC areas on the main line (m, from the origin), each moved to the
   * nearest main signal. Every area has its RBC, and a train crossing a border is handed over from one RBC to the
   * next (Subset-026 §3.15.1, Subset-039; docs/TRACKSIDE.md). Without it the trackside has one RBC
   */
  rbc_borders_m?: number[];
  /**
   * Train spacing (ETCS with a message-based onboard and the simple RBC, single line): `fixed_block` (default) or
   * `moving_block`, ETCS Level 2 with moving block: the authority of a train following another one in the same
   * direction ends `moving_block.margin_m` behind the confirmed rear end that train last reported (docs/MOVING_BLOCK.md)
   */
  spacing?: 'fixed_block' | 'moving_block';
  /** Moving block parameters: margin behind the confirmed rear end (m, default 50), period of the position reports asked by the RBC (packet 58, s, default 6) and delay of the reports on their way to the RBC (s, default 0) */
  moving_block?: { margin_m?: number; report_period_s?: number; radio_delay_s?: number };
  /**
   * Rolling stock circulations: minimum time between the arrival of a service and the departure of the next service
   * of the same block (s, default 300)
   */
  min_turnaround_s?: number;
  /** Connections between trains at a station: the departing train waits for the feeder within a maximum wait */
  connections?: ConnectionDef[];
  /** Traffic regulator: none (default), the reference one, or an external program (docs/REGULATOR.md) */
  regulator?: RegulatorKind;
  /** Regulator cycle (s), default 5 */
  regulator_period_s?: number;
  /**
   * Passengers (docs/PASSENGERS.md): origin–destination demand, boarding and alighting, dwell from the flows through
   * the doors, capacity, mass on board and measures. Without it there are no passengers and nothing changes
   */
  passengers?: PassengerDef;
}

/**
 * A stop of a service, by station name, with times in seconds from the start of the run. It corresponds to an
 * `baseItineraryPoint` with its `times` and `stop` in railML 3 (an `ocpTT` in railML 2), to a `TimetabledPassingTime` in
 * NeTEx and to a row of `stop_times.txt` in GTFS.
 */
export interface ServiceStopDef {
  station: string;
  arrival_s?: number | null;
  departure_s?: number | null;
  /** Minimum dwell (s); default 20 s */
  min_dwell_s?: number;
  /**
   * Track of the station for the interlocking trackside: 'I' main track, 'II' passing track (default: I if free).
   * It corresponds to the platform of the stop (railML `platformEdgeRef`, NeTEx `Quay`).
   */
  track?: 'I' | 'II';
}

/**
 * A train of the timetable other than the controlled one: an `operationalTrain` with its `OperationalTrainNumber` in
 * railML 3 (a `trainPart` in railML 2),
 * a `ServiceJourney` in NeTEx, a trip in GTFS. It appears at the first stop shortly before the departure, if the
 * station is free, runs with its own dynamics and supervision and leaves the line after the last stop.
 */
export interface ServiceDef {
  /** Identifier, unique in the run: the train number */
  id: string;
  /** Id of a built-in train or its complete parameters (default: the train of the run) */
  train?: string | TrainParams;
  /** Stops served, in running order; the first is the origin, the last the destination */
  stops: ServiceStopDef[];
  /**
   * Who drives: the built-in ATO (default) or an external agent, for example a learning one, connected with
   * `runLockstep(..., { agents })`, `--agents` or the agent environment (`src/server/agent-env.ts`)
   */
  driver?: 'ato' | 'agent';
  /**
   * With a network: the lines the train runs along, by id and in running order; consecutive lines meet in a station
   * they share. Without it the train runs on the main line if it has all the stops, otherwise on the first line that
   * has them all. It corresponds to the `Route` that a `JourneyPattern` refers to in NeTEx and to the sequence of
   * lines crossed by the `baseItineraryPoint`s of railML 3
   */
  route?: string[];
  /**
   * Block of the rolling stock circulation: the services with the same block are run by the same train, in the order
   * of their departures. The next service starts where the previous one ended and leaves not before its arrival plus
   * the minimum turnaround (`min_turnaround_s`), so a delay passes from one to the next. It is the `block_id` of GTFS
   * and a `block` of the vehicle rostering of railML 3; without a train of its own the service takes that of the block
   */
  block?: string;
}

/**
 * A connection: at `station` the service `to_service` waits for the arrival of `from_service` ('train' is the
 * controlled train) and leaves not before that arrival plus `transfer_s`, but never later than its departure plus
 * `max_wait_s`; beyond that it leaves and the connection is lost. It is a `ServiceJourneyInterchange` of NeTEx
 * (`FromJourneyRef`, `ToJourneyRef`, `StandardTransferTime`, `MaximumWaitTime`) and a row of `transfers.txt` in GTFS
 */
export interface ConnectionDef {
  station: string;
  from_service: string;
  to_service: string;
  /** Time to change train (s, default 120) */
  transfer_s?: number;
  /** Maximum wait of the departing train beyond its departure (s, default 300) */
  max_wait_s?: number;
}

export type EventPhase = 'pending' | 'active' | 'done';
export interface ScenarioEventState { def: ScenarioEventDef; i: number; phase: EventPhase; tFired: number | null }

/** Events announced by default: those that can be seen or heard on board */
export const ANNOUNCED_BY_DEFAULT: Record<FaultType, boolean> = {
  radio_loss: true, integrity_loss: false, odometry_drift: false, speed_restriction: true, low_adhesion: false, brake_degraded: false, traction_reduced: false,
  leader_stopped: false, rbc_emergency_stop: true, message: true, point_failure: false, tvps_failure: false, operator_command: true,
  train_stopped: true, line_blocked: true, dispatch: true,
};
/** True if the event is shown to the driver and sent to controllers */
export const isAnnounced = (e: ScenarioEventDef): boolean => e.announced ?? ANNOUNCED_BY_DEFAULT[e.type];

/** Description of a control centre command */
function describeCommand(c: ScenarioEventDef['command']): string {
  if (!c) return '';
  switch (c.type) {
    case 'set_route': return 'set route ' + c.id;
    case 'cancel_route': return 'cancel route ' + c.id;
    case 'ars': return 'automatic route setting ' + (c.active ? 'on' : 'off');
    case 'emergency_stop': return 'emergency stop';
    case 'revoke_emergency_stop': return 'emergency stop revoked';
    case 'speed_restriction': return 'temporary speed restriction ' + c.id;
    case 'revoke_speed_restriction': return 'temporary speed restriction ' + c.id + ' revoked';
    default: return String(c.type);
  }
}

/** Description of a command of the dispatcher */
function describeDispatch(c: DispatchCommand | undefined): string {
  if (!c) return '';
  const o = c as { type: string; train?: string; station?: string; from_station?: string };
  if (c.type === 'speed_restriction') return `${c.revoke ? 'revoke the' : ''} temporary speed restriction ${c.v_kmh} km/h from ${km(c.from_m)} to ${km(c.to_m)}`.trim();
  return [o.type, o.train, o.station ?? o.from_station].filter(Boolean).join(' ');
}

/** Railway chainage notation: 5200 m → km 5+200 */
const km = (m: number | undefined): string => { const v = Math.round(m ?? 0); return 'km ' + Math.floor(v / 1000) + '+' + String(v % 1000).padStart(3, '0'); };
const n2 = (x: number, d = 2): string => x.toFixed(d);

/** Description of the effect of an event, for the briefing and the log */
export function describeEvent(e: ScenarioEventDef): string {
  switch (e.type) {
    case 'radio_loss': return 'Radio link with the RBC lost' + (e.timeout_s != null ? ` (braking after ${e.timeout_s} s)` : '');
    case 'integrity_loss': return (e.train ? `Train ${e.train}` : 'The train') + ': train integrity lost' + (e.duration_s != null ? ` for ${e.duration_s} s` : '');
    case 'odometry_drift': return (e.train ? `Train ${e.train}` : 'The train') + `: the odometer drifts by ${n2((e.slope ?? 0) * 100, 1)} % of the distance run` + (e.duration_s != null ? ` for ${e.duration_s} s` : '');
    case 'speed_restriction': return `Temporary speed restriction to ${e.v_kmh} km/h from ${km(e.from_m)} to ${km(e.to_m)}`;
    case 'low_adhesion': return `Low adhesion (μ ${n2(e.mu ?? 0)}) from ${km(e.from_m)} to ${km(e.to_m)}`;
    case 'brake_degraded': return `Brake degraded to ${Math.round((e.factor ?? 1) * 100)}%`;
    case 'traction_reduced': return `Traction reduced to ${Math.round((e.factor ?? 1) * 100)}%`;
    case 'leader_stopped': return 'The train ahead stops' + (e.duration_s != null ? ` for ${e.duration_s} s` : '');
    case 'rbc_emergency_stop': return 'Emergency stop order';
    case 'message': return 'Message: ' + (e.text || '');
    case 'point_failure': return `Point ${e.element} ${e.mode === 'no_detection' ? 'without detection of its position' : 'unable to move'}`;
    case 'tvps_failure': return `Section ${e.element} failed (disturbed)`;
    case 'operator_command': return 'Control centre: ' + describeCommand(e.command);
    case 'train_stopped': return (e.train ? `Train ${e.train}` : 'The train') + ' breaks down and cannot move' + (e.duration_s != null ? ` for ${e.duration_s} s` : '');
    case 'line_blocked': return `Line blocked from ${km(e.from_m)} to ${km(e.to_m)}`;
    case 'dispatch': return 'Dispatcher: ' + describeDispatch(e.dispatch);
  }
}

/** Description of when an event fires */
export function describeTrigger(e: ScenarioEventDef): string {
  const q = e.when || {};
  const parts: string[] = [];
  if (q.t != null) parts.push(`at t = ${q.t} s`);
  if (q.pos != null) parts.push(`at ${km(q.pos)}`);
  return parts.length ? parts.join(' and ') : 'at departure';
}

/** Checks the definition; returns the list of errors (empty if valid) */
export function validateScenario(d: unknown): string[] {
  const err: string[] = [];
  const def = toEnglish<ScenarioDef>(d);
  if (!def || typeof def !== 'object') return ['the scenario must be a JSON object'];
  if (!def.name || typeof def.name !== 'string') err.push('the name is missing');
  if (typeof def.line === 'string' && !LINE_PRESETS[def.line]) err.push(`unknown line «${def.line}» (available: ${Object.keys(LINE_PRESETS).join(', ')})`);
  if (typeof def.train === 'string' && !TRAIN_PRESETS[def.train]) err.push(`unknown train «${def.train}» (available: ${Object.keys(TRAIN_PRESETS).join(', ')})`);
  if (def.signalling && def.signalling !== 'ETCS' && def.signalling !== 'BACC') err.push('signalling must be ETCS or BACC');
  if (def.events != null && !Array.isArray(def.events)) err.push('events must be a list');
  (def.events || []).forEach((e, i) => {
    const w = `event ${i + 1}`;
    if (!FAULT_TYPES.includes(e.type)) { err.push(`${w}: unknown type «${e.type}» (available: ${FAULT_TYPES.join(', ')})`); return; }
    const num = (k: keyof ScenarioEventDef) => typeof e[k] === 'number' && isFinite(e[k] as number);
    if ((e.type === 'speed_restriction' || e.type === 'low_adhesion' || e.type === 'line_blocked') && !(num('from_m') && num('to_m') && (e.to_m as number) > (e.from_m as number))) err.push(`${w}: from_m and to_m are needed, with to_m > from_m`);
    if (e.type === 'speed_restriction' && !(num('v_kmh') && (e.v_kmh as number) > 0)) err.push(`${w}: v_kmh greater than zero is needed`);
    if (e.type === 'low_adhesion' && !(num('mu') && (e.mu as number) > 0 && (e.mu as number) <= 0.4)) err.push(`${w}: mu between 0 and 0.4 is needed`);
    if ((e.type === 'brake_degraded' || e.type === 'traction_reduced') && !(num('factor') && (e.factor as number) > 0 && (e.factor as number) <= 1)) err.push(`${w}: factor between 0 and 1 is needed`);
    if (e.type === 'message' && !e.text) err.push(`${w}: the text is needed`);
    if ((e.type === 'point_failure' || e.type === 'tvps_failure') && !(typeof e.element === 'string' && e.element.includes('/'))) err.push(`${w}: the element is needed in the form «Site/name»`);
    if (e.type === 'operator_command' && !(e.command && typeof e.command.type === 'string')) err.push(`${w}: the control centre command is needed`);
    if (e.type === 'dispatch' && !(e.dispatch && typeof e.dispatch === 'object' && typeof (e.dispatch as { type?: unknown }).type === 'string')) err.push(`${w}: the command of the dispatcher is needed`);
    if (e.type === 'dispatch' && (e.when?.pos != null || !(typeof e.when?.t === 'number' && e.when.t >= 0))) err.push(`${w}: a command of the dispatcher is given at a time when.t ≥ 0, not at a position`);
    // `leader` is the freight train ahead (phase 9), when the scenario keeps it
    if (e.train != null && !(def.services || []).some(s => s && s.id === e.train) && e.train !== 'train' && !(e.train === 'leader' && def.leader?.on !== false)) err.push(`${w}: train «${e.train}» is not a service of the scenario`);
    if (e.train != null && !['brake_degraded', 'traction_reduced', 'train_stopped', 'integrity_loss', 'radio_loss', 'odometry_drift'].includes(e.type)) err.push(`${w}: «train» applies only to brake_degraded, traction_reduced, train_stopped, integrity_loss, radio_loss and odometry_drift`);
    if (e.type === 'odometry_drift' && !(typeof e.slope === 'number' && Math.abs(e.slope) > 0 && Math.abs(e.slope) < 0.5)) err.push(`${w}: slope between −0.5 and 0.5, not zero, is needed`);
    if (e.duration_s != null && !(num('duration_s') && (e.duration_s as number) > 0)) err.push(`${w}: duration_s must be positive`);
  });
  if (def.services != null && !Array.isArray(def.services)) err.push('services must be a list');
  if (def.conflict_rule != null && def.conflict_rule !== 'timetable' && def.conflict_rule !== 'first_come') err.push('conflict_rule must be «timetable» or «first_come»');
  if (def.regulator != null && !['none', 'reference', 'external'].includes(def.regulator)) err.push('regulator must be «none», «reference» or «external»');
  if (def.regulator_period_s != null && !(typeof def.regulator_period_s === 'number' && def.regulator_period_s >= 0.1 && def.regulator_period_s <= 600)) err.push('regulator_period_s must be between 0.1 and 600 s');
  if (def.min_turnaround_s != null && !(typeof def.min_turnaround_s === 'number' && def.min_turnaround_s >= 0)) err.push('min_turnaround_s must be a number ≥ 0');
  (def.connections ?? []).forEach((c, i) => {
    const w = `connection ${i + 1}`;
    if (!c || typeof c.station !== 'string' || typeof c.from_service !== 'string' || typeof c.to_service !== 'string') { err.push(`${w}: station, from_service and to_service are needed`); return; }
    for (const id of [c.from_service, c.to_service]) if (id !== 'train' && !(def.services ?? []).some(sv => sv?.id === id)) err.push(`${w}: no service «${id}»`);
    if (c.from_service === c.to_service) err.push(`${w}: a train cannot connect with itself`);
    for (const k of ['transfer_s', 'max_wait_s'] as const) if (c[k] != null && !(typeof c[k] === 'number' && (c[k] as number) >= 0)) err.push(`${w}: ${k} must be a number ≥ 0`);
  });
  if (def.network != null) {
    const n = typeof def.network === 'string' ? NETWORK_PRESETS[def.network] : def.network;
    if (!n) err.push(`unknown network «${String(def.network)}»`);
    else if (!Array.isArray(n.lines) || !n.lines.length) err.push('the network needs at least one line');
  }
  const ids = new Set<string>();
  (def.services || []).forEach((sv, i) => {
    const w = `service ${i + 1}`;
    if (!sv || typeof sv.id !== 'string' || !sv.id) { err.push(`${w}: the id is needed`); return; }
    if (ids.has(sv.id) || sv.id === 'train') err.push(`${w}: id «${sv.id}» already used`);
    ids.add(sv.id);
    if (typeof sv.train === 'string' && !TRAIN_PRESETS[sv.train]) err.push(`${w}: unknown train «${sv.train}»`);
    if (!Array.isArray(sv.stops) || sv.stops.length < 2) { err.push(`${w}: at least two stops are needed`); return; }
    if (typeof sv.stops[0].departure_s !== 'number') err.push(`${w}: the first stop needs departure_s`);
    let last = -Infinity;
    sv.stops.forEach((st, k) => {
      if (!st || typeof st.station !== 'string') { err.push(`${w}, stop ${k + 1}: the station is needed`); return; }
      for (const x of [st.arrival_s, st.departure_s]) {
        if (x == null) continue;
        if (typeof x !== 'number' || !isFinite(x)) err.push(`${w}, stop ${k + 1}: times must be numbers`);
        else if (x < last) err.push(`${w}, stop ${k + 1}: times must not decrease`);
        else last = x;
      }
      if (st.track != null && st.track !== 'I' && st.track !== 'II') err.push(`${w}, stop ${k + 1}: track must be «I» or «II»`);
    });
    if (sv.driver != null && sv.driver !== 'ato' && sv.driver !== 'agent') err.push(`${w}: driver must be «ato» or «agent»`);
    if (sv.block != null && (typeof sv.block !== 'string' || !sv.block)) err.push(`${w}: the block is a non-empty string`);
    if (sv.route != null) {
      if (!def.network) err.push(`${w}: a route needs a network`);
      else if (!Array.isArray(sv.route) || !sv.route.length || sv.route.some(x => typeof x !== 'string')) err.push(`${w}: the route is a list of line ids`);
    }
  });
  err.push(...validatePassengers(def.passengers));
  return err;
}

/** Derives line, train and conditions of a run from the scenario, starting from a base */
export function resolveScenario(def: ScenarioDef | null, base?: { line?: LineDef; train?: TrainParams; scen?: Scenario }): { line: LineDef; train: TrainParams; scen: Scenario } {
  const b = { line: base?.line ?? clone(LINE_PRESETS['valle-lauro']), train: base?.train ?? clone(TRAIN_PRESETS.regional), scen: base?.scen ?? { ...DEFAULT_SCENARIO } };
  if (!def) return b;
  def = toEnglish<ScenarioDef>(def);
  const net = typeof def.network === 'string' ? NETWORK_PRESETS[def.network] : def.network;
  const lineRef = def.line ?? (net ? net.lines[0] : undefined);
  const line = typeof lineRef === 'string' ? clone(LINE_PRESETS[lineRef]) : lineRef ? fitPlan(clone(lineRef)) : b.line;
  const train = typeof def.train === 'string' ? clone(TRAIN_PRESETS[def.train]) : def.train ? clone(def.train) : b.train;
  if (def.leader) line.freight = { ...line.freight, ...def.leader };
  const scen: Scenario = { ...b.scen, sig: def.signalling ?? b.scen.sig, met: def.weather ?? b.scen.met, adh: def.adhesion ?? b.scen.adh, ...(def.onboard ? { onboard: def.onboard } : {}), ...(def.trackside ? { trackside: def.trackside } : {}),
    ...(def.regulator ? { regulator: def.regulator } : {}), ...(def.regulator_period_s != null ? { regulator_period_s: def.regulator_period_s } : {}) };
  return { line, train, scen };
}

/** Merges the line limits with additional restrictions, taking the minimum; returns contiguous stretches */
export function mergeLimits(base: [number, number, number][], extra: [number, number, number][]): [number, number, number][] {
  if (!extra.length) return base.map(l => [l[0], l[1], l[2]] as [number, number, number]);
  const pts = new Set<number>();
  for (const [a, b] of base) { pts.add(a); pts.add(b); }
  for (const [a, b] of extra) { pts.add(a); pts.add(b); }
  const xs = [...pts].sort((a, b) => a - b);
  const out: [number, number, number][] = [];
  for (let i = 0; i < xs.length - 1; i++) {
    const p = xs[i], q = xs[i + 1], mid = (p + q) / 2;
    let v = Infinity;
    for (const [a, b, l] of base) if (mid >= a && mid < b) v = Math.min(v, l);
    for (const [a, b, l] of extra) if (mid >= a && mid < b) v = Math.min(v, l);
    if (!isFinite(v)) continue;
    const last = out[out.length - 1];
    if (last && last[2] === v && last[1] === p) last[1] = q;
    else out.push([p, q, v]);
  }
  out[out.length - 1][1] = 1e9;
  return out;
}

// ---------- verdict ----------

export interface RunResult {
  finished: boolean;
  t_s: number;
  stops: StopRecord[];
  arrival_delay_s: number | null;
  interventions: number;
  overruns: number;
  missed_vigilance: number;
  max_over_limit_kmh: number;
  net_energy_kWh: number;
  max_tension_kN: number;
  max_compression_kN: number;
  max_jerk_ms3: number;
}

export interface Check { name: string; value: string; threshold: string; ok: boolean }
export interface Verdict { outcome: 'passed' | 'failed'; checks: Check[] }

/** Criteria applied to every run, even without a scenario */
export const DEFAULT_CRITERIA: Criteria = {
  complete: true, stop_error_max_m: 5, missed_stops_max: 0, interventions_max: 0, overruns_max: 0, missed_vigilance_max: 0,
};

/** Compares the result of a run with the criteria and returns the verdict with the list of checks */
export function evaluate(r: RunResult, criteria?: Criteria): Verdict {
  const c = { ...DEFAULT_CRITERIA, ...(criteria || {}) };
  const ck: Check[] = [];
  const add = (name: string, value: string, threshold: string, ok: boolean) => ck.push({ name, value, threshold, ok });
  if (c.complete) add('Arrival at the terminus', r.finished ? 'yes' : 'no', 'yes', r.finished);
  if (c.arrival_max_s != null) add('Arrival time', `${n2(r.t_s, 0)} s`, `≤ ${c.arrival_max_s} s`, r.finished && r.t_s <= c.arrival_max_s);
  if (c.delay_max_s != null) add('Arrival delay', r.arrival_delay_s == null ? '—' : `${n2(r.arrival_delay_s, 0)} s`, `≤ ${c.delay_max_s} s`, r.arrival_delay_s != null && r.arrival_delay_s <= c.delay_max_s);
  const done = r.stops.filter(f => f.err != null), missed = r.stops.length - done.length;
  if (c.stop_error_max_m != null) {
    const worst = done.reduce((m, f) => Math.max(m, Math.abs(f.err as number)), 0);
    add('Maximum stopping error', done.length ? `${n2(worst, 1)} m` : '—', `≤ ${c.stop_error_max_m} m`, worst <= c.stop_error_max_m);
  }
  if (c.missed_stops_max != null) add('Missed stops', String(missed), `≤ ${c.missed_stops_max}`, missed <= c.missed_stops_max);
  if (c.interventions_max != null) add('Protection interventions', String(r.interventions), `≤ ${c.interventions_max}`, r.interventions <= c.interventions_max);
  if (c.overruns_max != null) add('Red signals or ends of authority passed', String(r.overruns), `≤ ${c.overruns_max}`, r.overruns <= c.overruns_max);
  if (c.missed_vigilance_max != null) add('Missed vigilance', String(r.missed_vigilance), `≤ ${c.missed_vigilance_max}`, r.missed_vigilance <= c.missed_vigilance_max);
  if (c.over_limit_max_kmh != null) add('Maximum excess over the limit', `${n2(Math.max(0, r.max_over_limit_kmh), 1)} km/h`, `≤ ${c.over_limit_max_kmh} km/h`, r.max_over_limit_kmh <= c.over_limit_max_kmh);
  if (c.energy_max_kWh != null) add('Net energy', `${n2(r.net_energy_kWh, 1)} kWh`, `≤ ${c.energy_max_kWh} kWh`, r.net_energy_kWh <= c.energy_max_kWh);
  if (c.tension_force_max_kN != null) add('Maximum coupler tension', `${n2(r.max_tension_kN, 0)} kN`, `≤ ${c.tension_force_max_kN} kN`, r.max_tension_kN <= c.tension_force_max_kN);
  if (c.compression_force_max_kN != null) add('Maximum coupler compression', `${n2(r.max_compression_kN, 0)} kN`, `≤ ${c.compression_force_max_kN} kN`, r.max_compression_kN <= c.compression_force_max_kN);
  if (c.jerk_max_ms3 != null) add('Maximum jerk', `${n2(r.max_jerk_ms3, 2)} m/s³`, `≤ ${c.jerk_max_ms3} m/s³`, r.max_jerk_ms3 <= c.jerk_max_ms3);
  return { outcome: ck.every(x => x.ok) ? 'passed' : 'failed', checks: ck };
}
