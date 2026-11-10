/**
 * Trackside types: protocol between the engine and the trackside component (interlocking and RBC), telegrams to
 * the field elements according to EULYNX, engineering data and operator commands.
 *
 * Towards the field the published interfaces of EULYNX Baseline Set 4 Release 4 are used: SCI-P (points,
 * Eu.Doc.38) and SCI-TDS (train detection, Eu.Doc.44), with the names of telegrams and parameters and the value
 * codes of the specification. Telegrams travel as JSON objects already decoded: the byte encoding of the PDI and
 * its connection phase (Eu.Doc.93) are missing.
 *
 * The interfaces between interlocking and RBC (SCI-RBC) and towards the control centre (SCI-CC) are not
 * published in Release 4: those used here belong to YuTreno and must not be presented as EULYNX.
 */
import type { EtcsPacket, RadioMessage } from '../core/types';

// ---------------------------------------------------------------------------------------------
// EULYNX SCI-P (Eu.Doc.38 v4.2): points

/** Commanded Point Position: 0x01 move to the right, 0x02 move to the left */
export const CPP = { right: 0x01, left: 0x02 } as const;
/** Reported Point Position: 0x01 right end position, 0x02 left end position, 0x03 no end position, 0x04 unintended position */
export const RPP = { right: 0x01, left: 0x02, none: 0x03, unintended: 0x04 } as const;
/** Reported Degraded Point Position: 0x03 not degraded, 0xFF not applicable */
export const RDPP = { right: 0x01, left: 0x02, not_degraded: 0x03, not_applicable: 0xff } as const;
/** Reported Ability To Move Point Status: 0x01 able to move, 0x02 unable to move */
export const RAMP = { able_to_move: 0x01, unable_to_move: 0x02 } as const;

// EULYNX SCI-TDS (Eu.Doc.44 v4.0): train vacancy proving sections (TVPS)

/** Occupancy Status: 0x01 vacant, 0x02 occupied, 0x03 disturbed (the other values concern forcing to clear) */
export const OCC = { vacant: 0x01, occupied: 0x02, disturbed: 0x03 } as const;
/** Change Trigger: 0x01 passing detected, 0x04 technical failure, 0x05 initial state, 0x06 internal trigger */
export const TRG = { passage: 0x01, failure: 0x04, initial: 0x05, internal: 0x06 } as const;

interface TelegramHeader { sender: string; receiver: string }
export type SciTelegram =
  | (TelegramHeader & { interface: 'SCI-P'; message: 'Cd_Move_Point'; Commanded_Point_Position: number })
  | (TelegramHeader & { interface: 'SCI-P'; message: 'Msg_Point_Position'; Reported_Point_Position: number; Reported_Degraded_Point_Position: number })
  | (TelegramHeader & { interface: 'SCI-P'; message: 'Msg_Movement_Failed' })
  | (TelegramHeader & { interface: 'SCI-P'; message: 'Msg_Ability_To_Move_Point'; Reported_Ability_To_Move_Point_Status: number })
  | (TelegramHeader & {
      interface: 'SCI-TDS'; message: 'Msg_TVPS_Occupancy_Status'; Occupancy_Status: number; Ability_To_Be_Forced_To_Clear: number;
      Filling_Level: number | null; POM_Status: number; Disturbance_Status: number; Change_Trigger: number;
    });

// ---------------------------------------------------------------------------------------------
// Engineering data (generated from the line, handed to the trackside at the start)

/** Train vacancy proving section (TVPS); `branch` is 'I' for the main track or 'II:<station>' for a passing track */
export interface TvpsConfig { id: string; from_m: number; to_m: number; branch: string }

/** Point: `normal` says to which side the point lies in normal position, `reverse_branch` is the branch reached in reverse */
export interface PointConfig {
  id: string; s_m: number; normal: 'right' | 'left'; reverse_branch: string; type: 'diverging' | 'converging' | 'junction'; move_time_s: number;
  /**
   * Junction of a node (network, optional): in reverse the point joins the track `reverse_branch` of this line to the
   * line with this id; in normal it leaves the track straight through
   */
  junction?: string;
}

/** ETCS stop marker (marker board), that is a point where an authority may end */
export interface MarkerConfig {
  id: string; s_m: number; branch: string;
  /** −1: the marker is valid for trains running towards the origin of the line (optional, default 1) */
  dir?: 1 | -1;
  /** Network (optional): marker at a node, where routes cross to the interlocking of another line; id of the boundary */
  node?: string;
}

/** Route in the form used by the interlocking, derived from the control table */
export interface RouteConfig {
  id: string;
  name: string;
  type: 'departure' | 'entry' | 'arrival' | 'block';
  /** Station index (null for the line block) */
  station: number | null;
  /** Start and end on the branch; the end is the stop marker where an authority may end */
  start_m: number;
  end_m: number;
  branch_start: string;
  branch_end: string;
  points: { id: string; position: 'N' | 'R' }[];
  /** Sections to prove vacant and to lock, in running order */
  tvps: string[];
  /** Stretch beyond the end (overlap): length and sections to prove vacant */
  overlap_m: number;
  tvps_overlap: string[];
  /** Speed restrictions of the route itself, for example the diverging speed: [from_m, to_m, km/h] */
  speeds: [number, number, number][];
  incompatible: string[];
  /** Automatic block route: set by itself when its sections are vacant */
  automatic: boolean;
  /**
   * −1: route for trains running towards the origin, with start_m > end_m (optional, default 1). Lines with routes in
   * both directions number their single-track segments: a departure or block route enters segment `segment`, and a
   * segment is given to one direction at a time (block consent)
   */
  dir?: 1 | -1;
  segment?: number;
  /**
   * Node route (network, optional): the route ends at the node towards the line with this id ('out') or starts at the
   * node from it ('in'). A route out needs the boundary consent of the node, held by one interlocking at a time
   */
  link?: { line: string; side: 'out' | 'in'; boundary: string };
}

/** A station of a timetable for automatic route setting; `track` asks for a track there ('I', 'II'), otherwise I if free */
export interface TimetableEntry {
  station: number; name: string; arrival_s: number | null; departure_s: number | null; s_m: number; track?: string;
  /** Network (optional): the train comes to this station from the line with this id, or leaves it for that line */
  from_line?: string;
  to_line?: string;
}

/** The part of a network a separate interlocking controls: one line, with its own engineering data (network, optional) */
export interface InterlockingConfig {
  /** Id of the line in the network */
  id: string;
  line: { name: string; length_m: number };
  tvps: TvpsConfig[];
  points: PointConfig[];
  markers: MarkerConfig[];
  routes: RouteConfig[];
  /** Stations of the line */
  timetable: TimetableEntry[];
  /** Timetables of the trains that run along this line, in its stations and chainages */
  trains: { engine: number; id: string; timetable: TimetableEntry[] }[];
}

/**
 * Boundary between two interlockings at a node: the station of the node on line `a` (where it has two tracks and the
 * junction points) and the end of line `b` that starts or ends there. A train crosses it with a route out of one
 * interlocking and a route into the other; the routes out need the consent, which `holder` has at the start
 */
export interface BoundaryConfig { id: string; node: string; a: string; b: string; holder: string }

/**
 * A train that runs along a corridor of several lines, or along a line other than the main one: its balise groups,
 * laid along the corridor, and where every stretch of the corridor comes from (null bounds: unbounded)
 */
export interface CorridorConfig {
  engine: number;
  length_m: number;
  balises: { NID_BG: number; s_m: number }[];
  limits: [number, number, number][];
  gradients: [number, number, number][];
  legs: { line: string; dir: 1 | -1; c0_m: number; d0_m: number; from_m: number | null; to_m: number | null }[];
}

/** Network of the trackside: the main line is the configuration itself, with id `main` */
export interface TracksideNetwork {
  main: string;
  interlockings: InterlockingConfig[];
  boundaries: BoundaryConfig[];
  corridors: CorridorConfig[];
}

/**
 * Several RBCs on the main line (phase 10, docs/TRACKSIDE.md): each RBC supervises the trains in its stretch of the
 * line, and at every border between two stretches a train is handed over from one RBC to the next with the
 * dialogue of Subset-039. Without it the trackside has one RBC, as before
 */
export interface RbcAreasConfig {
  /** The RBCs in the order of the line: NID_RBC and stretch [from_m, to_m] in line chainages */
  areas: { NID_RBC: number; from_m: number; to_m: number }[];
  /**
   * The borders, from the origin: chainage (at a main signal), the border balise group (NID_BG and its chainage)
   * and the RBCs before and after it in the nominal direction
   */
  borders: { s_m: number; NID_BG: number; bg_s_m: number; a: number; b: number }[];
  /** Life sign period and supervision time of the RBC–RBC communication (s, defaults 10 and 30; Subset-039 Table 13) */
  life_sign_s?: number;
  link_timeout_s?: number;
}

/**
 * Message between two RBCs (Subset-039 v4.0.0 chapter 5), as JSON: the header of every NRBC message (sender, engine,
 * border balise group, timestamp, acknowledgement request) and the fields of its type. Route related information
 * carries packets 15, 21 and 27 referred to the border balise group, as message 3 would
 */
export interface NrbcMessage {
  /** 201 Pre-Announcement, 202 RRI Request, 203 Announcement, 204 Cancellation, 205 Acknowledgement, 207 Train Data, 221 Route Related Information, 222 Taking Over Responsibility, 223 Life Sign */
  NID_NRBCMESSAGE: 201 | 202 | 203 | 204 | 205 | 207 | 221 | 222 | 223;
  NID_C: number;
  /** Sender */
  NID_RBC: number;
  /** Receiver (YuTreno: the address of the RBC–RBC connection) */
  to: number;
  NID_ENGINE?: number;
  /** Border balise group of the transaction, NID_C · 16384 + NID_BG */
  NID_BG?: number;
  T_RBC: number;
  M_ACK: 0 | 1;
  /** Acknowledgement: timestamp of the message acknowledged */
  T_RBC_ACK?: number;
  /** Pre-Announcement: mode of the onboard (M_MODE) and direction of running towards the border (YuTreno: 1 nominal, 0 reverse) */
  M_MODE?: number;
  Q_DIR?: 0 | 1;
  packets?: EtcsPacket[];
}

export interface TracksideConfig {
  line: { name: string; length_m: number; limits: [number, number, number][]; gradients: [number, number, number][] };
  balises: { NID_BG: number; s_m: number }[];
  tvps: TvpsConfig[];
  points: PointConfig[];
  markers: MarkerConfig[];
  routes: RouteConfig[];
  /** Timetable for automatic route setting: departures from the stations (the controlled train, NID_ENGINE 1) */
  timetable: TimetableEntry[];
  /**
   * Timetables of the other trains, by NID_ENGINE (optional): every station from the origin to the destination,
   * with null times where the train passes without stopping
   */
  trains?: { engine: number; id: string; timetable: TimetableEntry[] }[];
  parameters: {
    /** Automatic route setting active at start-up */
    ars: boolean;
    /** Delay of the cancellation of a route covered by an authority (s) */
    cancel_delay_s: number;
    /** Periodic renewal of the authority (s) and release speed (km/h) */
    ma_renewal_s: number;
    release_kmh: number;
    /** Automatic return of the points to normal on release */
    return_to_normal: boolean;
    /**
     * Order of conflicting requests of automatic route setting in the same cycle (optional, default 'timetable'):
     * by the timetabled time of the movement, or by the time each train started waiting for it ('first_come')
     */
    conflict_rule?: 'timetable' | 'first_come';
  };
  /**
   * Network (optional): one interlocking per line, the boundaries between them at the nodes and the corridors of the
   * trains that run off the main line. Without it the trackside controls one line, as before
   */
  network?: TracksideNetwork;
  /** Several RBCs with borders on the main line (optional) */
  rbcs?: RbcAreasConfig;
}

// ---------------------------------------------------------------------------------------------
// Control centre (YuTreno interface, not EULYNX)

export type OperatorCommand =
  | { type: 'set_route'; id: string }
  | { type: 'cancel_route'; id: string }
  | { type: 'ars'; active: boolean }
  | { type: 'speed_restriction'; id: string; from_m: number; to_m: number; v_kmh: number }
  | { type: 'revoke_speed_restriction'; id: string }
  /** Emergency stop of the control centre: for one train (its NID_ENGINE) or, without engine, for all */
  | { type: 'emergency_stop'; engine?: number }
  | { type: 'revoke_emergency_stop'; engine?: number }
  /** New timetable of a train for automatic route setting (from a regulator): replaces the one of the configuration */
  | { type: 'timetable'; engine: number; timetable: TimetableEntry[]; /** On a network: the line whose interlocking gets it (default the main line) */ line?: string }
  /** Network: new corridor of a train not yet in session, after a reroute (its balise groups and legs) */
  | { type: 'corridor'; engine: number; corridor: CorridorConfig }
  /** Priority of a train in conflicts (default 0): the higher goes first, whatever the conflict rule */
  | { type: 'priority'; engine: number; value: number }
  /** Several RBCs: the RBC–RBC communication goes down (a fault) or comes back */
  | { type: 'rbc_link'; up: boolean };

export type RouteState = 'free' | 'setting' | 'set' | 'occupied' | 'cancelling';

export interface PanelState {
  ars: boolean;
  routes: { id: string; name: string; state: RouteState; cancel_at_s?: number }[];
  points: { id: string; position: 'N' | 'R' | 'moving' | 'no_end_position'; locked: boolean; fault: boolean }[];
  tvps: { id: string; state: 'vacant' | 'occupied' | 'disturbed'; locked: boolean }[];
  /** Authority sent to the controlled train (line chainages), if there is a session */
  ma: { eoa_m: number; svl_m: number; reason: string; /** Several RBCs: the RBC that supervises the train */ NID_RBC?: number } | null;
  /** Authorities of all the trains in session, by NID_ENGINE (optional) */
  sessions?: { engine: number; eoa_m: number; svl_m: number; reason: string; head_m: number | null; dir?: 1 | -1; frame?: 'corridor'; /** Routes the authority runs over (optional) */ routes?: string[]; /** Several RBCs: the RBC that supervises the train */ NID_RBC?: number }[];
  /** With routes in both directions: who holds the block consent of each single-track segment (null: in transit) */
  consents?: { segment: string; holder: string | null }[];
  speed_restrictions: { id: string; from_m: number; to_m: number; v_kmh: number }[];
  /** Several RBCs (optional): for each, the trains in session and the ongoing handovers, and the state of the RBC–RBC link */
  rbcs?: { NID_RBC: number; sessions: number[]; handovers: { engine: number; role: 'HOV' | 'ACC'; border_m: number; step: string }[] }[];
  rbc_link?: 'up' | 'lost';
}

// ---------------------------------------------------------------------------------------------
// Engine ↔ trackside protocol

/** Request from the engine to the trackside, at every trackside cycle */
export interface TracksideRequest {
  type: 'trackside';
  version: 2;
  /** True only on the first request: the trackside resets and reads the configuration */
  start: boolean;
  t: number;
  dt: number;
  configuration?: TracksideConfig;
  /** Telegrams from the field elements (SCI-P, SCI-TDS) received in the cycle */
  field: SciTelegram[];
  /** Radio messages from the onboard to the RBC received in the cycle */
  radio: RadioMessage[];
  /** Control centre commands (operator or scenario) */
  commands: OperatorCommand[];
}

/** Trackside response: commands to the elements, messages for the onboard and state for the control centre */
export interface TracksideResponse {
  field: SciTelegram[];
  radio: RadioMessage[];
  panel: PanelState;
  /** Events to write in the run log */
  events?: { type: 'INFO' | 'WARN'; text: string }[];
}
