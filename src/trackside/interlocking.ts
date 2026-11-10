/**
 * Interlocking of the trackside, modelled on an Italian computer-based interlocking (ACC): it detects and commands the
 * field elements through SCI-P and SCI-TDS and manages the routes of the configuration (derived from the control
 * tables).
 *
 * Life cycle of a route:
 *  free → (request: no conflicting route active, sections vacant, points not locked by other routes and able to
 *  move) → setting (sections and points locked, points commanded) → set (all points detected in the required
 *  position) → occupied (the train enters) → free (sectional release: each section is released when the train has
 *  occupied and left it; for the destination section it is enough to be occupied).
 *  Cancelling a set route is immediate, but becomes delayed if the RBC has already granted an authority that
 *  covers it (approach locking).
 *
 * A set route that loses its integrity (point without detection, section disturbed or occupied by another train)
 * is no longer valid for authorities, until it is intact again or cancelled.
 *
 * Automatic route setting (ARS) routes every train that has a session with the RBC according to its timetable:
 * entry into the next station when the train is within the approach distance (the requested track, or I, or II if
 * I is occupied), departure at the timetabled time (at once where the train passes), line block always set when its
 * sections are vacant. Conflicting requests are served in the order of the conflict rule of the configuration.
 */
import { CPP, OCC, RAMP, RPP, type BoundaryConfig, type OperatorCommand, type TracksideConfig, type RouteConfig, type SciTelegram, type RouteState, type TimetableEntry } from './types';

/** Distance from the home signal within which automatic route setting requests the entry route (m) */
/** An end whose request for the block consent was refused asks again after this time (s) */
const CONSENT_RETRY_S = 2;

export const APPROACH_M = 3500;
/** Distance from the home signal within which, with the main track occupied, automatic route setting falls back on the other tracks (m) */
export const DECISION_M = 1500;

export interface PointSt { id: string; s: number; normal: 'right' | 'left'; pos: 'N' | 'R' | 'moving' | 'no_end_position'; able: boolean; lock: string | null; commanded: 'N' | 'R' | null }
export interface TvpsSt { id: string; state: 'vacant' | 'occupied' | 'disturbed'; lock: string | null }
export interface RouteSt {
  cfg: RouteConfig;
  state: RouteState;
  t0: number;
  /** Sections already occupied by the train while running through, and sections released */
  seen: Set<string>;
  released: Set<string>;
  cancelAt: number;
  /**
   * Route into this interlocking from a node: its overlap no longer reserved, once the train in it has stood still
   * for OVERLAP_RELEASE_S (timed overlap release), and where and since when the train has been standing
   */
  overlapFree?: boolean;
  still?: { x: number; since: number };
}

/** A train standing still this long in a route into the interlocking from a node frees the overlap of the route (s) */
export const OVERLAP_RELEASE_S = 30;

/** What the RBC tells the interlocking at every cycle (YuTreno interface) */
export interface RbcInfo {
  /** Position of the head of the controlled train in session (max safe front end) or null */
  train: number | null;
  /** Routes covered by the granted authorities */
  covered: Set<string>;
  /** All the trains in session with the max safe front end of their head (optional: without it, only `train`) */
  trains?: TrainPos[];
}

/**
 * A train in session: NID_ENGINE, max safe front end in line chainages and direction of running (default +1). On a
 * network `ahead` marks a train not yet on this line, placed where it would be if the line went on behind the node it
 * will enter by (so that automatic route setting sees it approach), and `behind` one that has left the line at a node
 */
export interface TrainPos { engine: number; x: number; dir?: 1 | -1; ahead?: boolean; behind?: boolean }

/** Message of the boundary consent between two interlockings at a node (YuTreno telegrams, carried as SCI-ILS would) */
export interface BoundaryMessage { boundary: string; from: string; to: string; kind: 'request' | 'grant' | 'refuse'; t: number }

export class Interlocking {
  readonly points = new Map<string, PointSt>();
  readonly tvps = new Map<string, TvpsSt>();
  readonly routes = new Map<string, RouteSt>();
  ars: boolean;
  /** Track each train is on, by NID_ENGINE and station (from the last entry route it ran through) */
  private trainTrack = new Map<number, Map<number, string>>();
  /** Time each pending automatic request started waiting, for the 'first_come' rule */
  private wantSince = new Map<string, number>();
  /** Timetables by NID_ENGINE */
  private timetables = new Map<number, TimetableEntry[]>();
  /** Priorities set by the control centre or a regulator, by engine (default 0) */
  private priorities = new Map<number, number>();
  private out: SciTelegram[] = [];
  readonly events: { type: 'INFO' | 'WARN'; text: string }[] = [];

  /** Id of the line this interlocking controls on a network ('' on a single line) */
  readonly id: string;
  /** Boundaries at the nodes with the other interlockings: whether this one holds the consent */
  private readonly bounds = new Map<string, { cfg: BoundaryConfig; peer: string; holds: boolean }>();
  private bPending = new Map<string, number>();
  /**
   * On the line that ends at a node: the single-track segment next to the node and the end of it at the node. Its
   * block consent is given towards the node only by the interlocking that holds the consent of the node, and the
   * consent of the node is given away only with the segment empty and held at the node: a train in the segment towards
   * the node and a train in the node towards the segment cannot wait for each other
   */
  private readonly nodeSegs = new Map<string, { seg: number; end: 1 | -1 }>();
  private bRefused = new Map<string, number>();
  /** Boundary messages to send to the other interlockings, and those received from them, for the next cycle */
  readonly bOut: BoundaryMessage[] = [];
  private bIn: BoundaryMessage[] = [];

  constructor(readonly cfg: TracksideConfig, opt: { id?: string; boundaries?: BoundaryConfig[]; controlled?: boolean } = {}) {
    this.id = opt.id ?? '';
    for (const b of opt.boundaries ?? []) {
      if (b.a !== this.id && b.b !== this.id) continue;
      this.bounds.set(b.id, { cfg: b, peer: b.a === this.id ? b.b : b.a, holds: b.holder === this.id });
    }
    for (const d of cfg.points) this.points.set(d.id, { id: d.id, s: d.s_m, normal: d.normal, pos: 'no_end_position', able: true, lock: null, commanded: null });
    for (const t of cfg.tvps) this.tvps.set(t.id, { id: t.id, state: 'occupied', lock: null });
    for (const rc of cfg.routes) this.routes.set(rc.id, { cfg: rc, state: 'free', t0: 0, seen: new Set(), released: new Set(), cancelAt: 0 });
    this.ars = cfg.parameters.ars;
    this.twoWay = cfg.routes.some(r => r.dir === -1);
    // at the start every consent is held by the station on the side of the origin
    if (this.twoWay) for (const r of cfg.routes) if (r.segment != null) this.segDir.set(r.segment, 1);
    if (opt.controlled ?? true) this.timetables.set(1, cfg.timetable);
    // the line that ends at a node: its single-track segment next to the node goes with the consent of the node
    if (this.twoWay) for (const b of this.bounds.values()) {
      if (b.cfg.b !== this.id) continue;
      const k = cfg.timetable.findIndex(o => o.name === b.cfg.node), n = cfg.timetable.length;
      if (k === 0) this.nodeSegs.set(b.cfg.id, { seg: 0, end: 1 });
      else if (k === n - 1) this.nodeSegs.set(b.cfg.id, { seg: k - 1, end: -1 });
    }
    for (const tr of cfg.trains ?? []) this.timetables.set(tr.engine, tr.timetable);
  }

  /** Boundary messages from the other interlockings, delivered by the trackside */
  deliver(ms: BoundaryMessage[]): void { this.bIn.push(...ms); }

  /** The interlocking routes this train (it has its timetable) */
  knows(engine: number): boolean { return this.timetables.has(engine); }

  /** Holder of the consent of a boundary as this interlocking sees it */
  holdsBoundary(id: string): boolean { return !!this.bounds.get(id)?.holds; }

  /** Track the train is on at a station, if known */
  private track(engine: number, station: number): string | undefined { return this.trainTrack.get(engine)?.get(station); }
  private setTrack(engine: number, station: number, branch: string | null): void {
    let m = this.trainTrack.get(engine);
    if (!m) { m = new Map(); this.trainTrack.set(engine, m); }
    if (branch == null) m.delete(station); else m.set(station, branch);
  }
  /** Track of the entry route granted to a train that passes a station, until the train has entered (engine:station) */
  private passTrack = new Map<string, string>();
  /** Which train ran through an entry route: the nearest train in session behind its end */
  private lastTrains: TrainPos[] = [];
  /**
   * Block consent of each single-track segment, held by one end at a time: +1 the station on the side of the origin
   * (trains run towards the end of the line), −1 the station on the other side, 0 while it travels between them.
   * Only with routes in both directions. The two ends exchange their messages with one cycle of delay, as two
   * adjacent interlockings would (EULYNX SCI-ILS carries the line block between them; the telegrams are YuTreno's)
   */
  readonly segDir = new Map<number, number>();
  private consentPending = new Map<string, number>();
  private consentRefused = new Map<string, number>();
  private ils: { seg: number; from: 1 | -1; kind: 'request' | 'grant' | 'refuse'; t: number }[] = [];
  /** Messages between the ends of the segments, for the log of the run and the external tools */
  readonly ilsLog: { t: number; segment: number; from: string; to: string; kind: string }[] = [];
  private readonly twoWay: boolean;

  /** Chainage seen by a train of direction d: the line itself, or mirrored for trains running towards the origin */
  private u(x: number, d: 1 | -1 | undefined): number { return (d ?? 1) > 0 ? x : this.cfg.line.length_m - x; }
  private dirOf(r: RouteSt): 1 | -1 { return r.cfg.dir ?? 1; }

  /** States from the field elements (SCI-P, SCI-TDS) */
  receive(tgs: SciTelegram[]): void {
    for (const g of tgs) {
      if (g.interface === 'SCI-TDS' && g.message === 'Msg_TVPS_Occupancy_Status') {
        const s = this.tvps.get(g.sender);
        if (s) s.state = g.Occupancy_Status === OCC.vacant ? 'vacant' : g.Occupancy_Status === OCC.occupied ? 'occupied' : 'disturbed';
      } else if (g.interface === 'SCI-P') {
        const p = this.points.get(g.sender);
        if (!p) continue;
        if (g.message === 'Msg_Point_Position') {
          const r = g.Reported_Point_Position;
          p.pos = r === RPP.right ? (p.normal === 'right' ? 'N' : 'R') : r === RPP.left ? (p.normal === 'left' ? 'N' : 'R') : r === RPP.none && p.commanded ? 'moving' : 'no_end_position';
          if (p.pos === p.commanded) p.commanded = null;
          if (r === RPP.unintended) { p.able = false; this.events.push({ type: 'WARN', text: `Interlocking: point ${p.id} in unintended position (trailed)` }); }
        } else if (g.message === 'Msg_Ability_To_Move_Point') {
          p.able = g.Reported_Ability_To_Move_Point_Status === RAMP.able_to_move;
        } else if (g.message === 'Msg_Movement_Failed') {
          p.commanded = null;
          for (const r of this.routes.values()) if (r.state === 'setting' && r.cfg.points.some(d => d.id === p.id)) this.fail(r, `point ${p.id} did not move`);
        }
      }
    }
  }

  /** Control centre commands */
  command(c: OperatorCommand, t: number, info: RbcInfo): void {
    if (c.type === 'timetable') { this.timetables.set(c.engine, c.timetable); return; }
    if (c.type === 'corridor') return;
    if (c.type === 'priority') { this.priorities.set(c.engine, c.value); return; }
    if (c.type === 'ars') { this.ars = c.active; this.events.push({ type: 'INFO', text: 'Automatic route setting ' + (c.active ? 'enabled' : 'disabled') }); return; }
    if (c.type === 'set_route') { const r = this.routes.get(c.id); if (r) { const why = this.request(r, t); if (why) this.events.push({ type: 'WARN', text: `Route ${r.cfg.name} cannot be set: ${why}` }); } return; }
    if (c.type === 'cancel_route') {
      const r = this.routes.get(c.id);
      if (!r || r.state === 'free') return;
      if (r.state === 'occupied') { this.events.push({ type: 'WARN', text: `Route ${r.cfg.name} is occupied: it is not cancelled, it is released as the train passes` }); return; }
      if (info.covered.has(r.cfg.id)) {
        r.state = 'cancelling'; r.cancelAt = t + this.cfg.parameters.cancel_delay_s;
        this.events.push({ type: 'INFO', text: `Delayed cancellation of ${r.cfg.name}: it is covered by a granted authority` });
      } else this.release(r, 'cancelled');
    }
  }

  /** Reason why the route cannot be set now, or null; if it can, starts setting it */
  request(r: RouteSt, t: number): string | null {
    if (r.state !== 'free') return 'already active';
    const seg = r.cfg.segment;
    if (this.twoWay && seg != null) {
      const mine = this.dirOf(r);
      // block consent: only the end that holds it may send trains into the segment; the other asks for it
      if ((this.segDir.get(seg) ?? 0) !== mine) {
        const key = `${seg}:${mine}`;
        if (r.cfg.type !== 'block' && !this.consentPending.has(key) && t >= (this.consentRefused.get(key) ?? -Infinity) + CONSENT_RETRY_S) {
          this.consentPending.set(key, t);
          this.send(seg, mine, 'request', t);
        }
        return `waiting for the block consent from ${this.endName(seg, -mine as 1 | -1)}`;
      }
    }
    const lk = r.cfg.link;
    if (lk) {
      const b = this.bounds.get(lk.boundary);
      if (!b) return 'unknown boundary ' + lk.boundary;
      // a route out of this interlocking needs the consent of the boundary; a route in needs the other one to hold it
      if (lk.side === 'out' && !b.holds) {
        if (!this.bPending.has(lk.boundary) && t >= (this.bRefused.get(lk.boundary) ?? -Infinity) + CONSENT_RETRY_S) {
          this.bPending.set(lk.boundary, t);
          this.sendBoundary(b, 'request', t);
        }
        return `waiting for the consent of the node ${b.cfg.node} from the interlocking of ${b.peer}`;
      }
      if (lk.side === 'in' && b.holds) return `the consent of the node ${b.cfg.node} is held here: no train may come in from ${b.peer}`;
    }
    for (const id of r.cfg.incompatible) { const o = this.routes.get(id); if (o && o.state !== 'free' && !this.releasedFor(o, r)) return 'conflicting with ' + o.cfg.name; }
    for (const id of [...r.cfg.tvps, ...r.cfg.tvps_overlap]) {
      const s = this.tvps.get(id);
      if (!s) return 'unknown section ' + id;
      if (s.state !== 'vacant') return `section ${id} ${s.state}`;
      if (s.lock && s.lock !== r.cfg.id && r.cfg.tvps.includes(id)) return `section ${id} locked`;
    }
    for (const d of r.cfg.points) {
      const p = this.points.get(d.id);
      if (!p) return 'unknown point ' + d.id;
      if (p.lock && p.lock !== r.cfg.id) return `point ${d.id} locked by another route`;
      if (p.pos !== d.position && !p.able) return `point ${d.id} unable to move`;
    }
    for (const id of r.cfg.tvps) (this.tvps.get(id) as TvpsSt).lock = r.cfg.id;
    for (const d of r.cfg.points) {
      const p = this.points.get(d.id) as PointSt;
      p.lock = r.cfg.id;
      if (p.pos !== d.position) this.move(p, d.position);
    }
    r.state = 'setting'; r.t0 = t; r.seen.clear(); r.released.clear(); r.overlapFree = false; r.still = undefined;
    return null;
  }

  /**
   * A route out to another interlocking stays active until the train has left its last section beyond the node; the
   * elements it shares with another route stop counting as soon as it has released them (sectional release). For
   * the other routes the whole route counts until it is released, as before
   */
  private releasedFor(o: RouteSt, r: RouteSt): boolean {
    if (o.cfg.link?.side === 'in' && o.state === 'occupied' && o.overlapFree) {
      // the train stands in the route: only its path and its points still count
      const mine = new Set([...r.cfg.tvps, ...r.cfg.tvps_overlap]);
      return !o.cfg.tvps.some(id => mine.has(id)) && !r.cfg.points.some(d => this.points.get(d.id)?.lock === o.cfg.id);
    }
    if (!o.cfg.link || o.cfg.link.side !== 'out' || o.state !== 'occupied') return false;
    const mine = new Set([...r.cfg.tvps, ...r.cfg.tvps_overlap]);
    if (o.cfg.tvps.some(id => mine.has(id) && !o.released.has(id))) return false;
    if (o.cfg.tvps_overlap.some(id => r.cfg.tvps.includes(id))) return false;
    return !r.cfg.points.some(d => this.points.get(d.id)?.lock === o.cfg.id);
  }

  /** Name of the station at one end of a segment: +1 the one on the side of the origin */
  private endName(seg: number, end: 1 | -1): string {
    const k = end > 0 ? seg : seg + 1;
    return this.cfg.timetable.find(o => o.station === k)?.name ?? [...(this.cfg.trains ?? [])].flatMap(x => x.timetable).find(o => o.station === k)?.name ?? `station ${k}`;
  }

  private send(seg: number, from: 1 | -1, kind: 'request' | 'grant' | 'refuse', t: number): void {
    this.ils.push({ seg, from, kind, t });
    this.ilsLog.push({ t, segment: seg, from: this.endName(seg, from), to: this.endName(seg, -from as 1 | -1), kind });
  }

  private sendBoundary(b: { cfg: BoundaryConfig; peer: string }, kind: 'request' | 'grant' | 'refuse', t: number): void {
    this.bOut.push({ boundary: b.cfg.id, from: this.id, to: b.peer, kind, t });
    this.ilsLog.push({ t, segment: -1, from: this.id, to: b.peer, kind: 'node ' + b.cfg.node + ': ' + kind });
  }

  /**
   * Boundary messages received: the holder gives the consent only when no route of its own out towards the other
   * interlocking is active (a route out is released when the train has left its last section, beyond the node)
   */
  private boundaryCycle(t: number): void {
    for (const m of this.bIn.splice(0)) {
      const b = this.bounds.get(m.boundary);
      if (!b) continue;
      if (m.kind === 'request') {
        const ns = this.nodeSegs.get(m.boundary);
        const busy = [...this.routes.values()].some(r => r.cfg.link?.boundary === m.boundary && r.cfg.link.side === 'out' && r.state !== 'free')
          || (!!ns && (this.segDir.get(ns.seg) !== ns.end || !this.segmentEmpty(ns.seg)));
        if (b.holds && !busy) {
          b.holds = false;
          this.sendBoundary(b, 'grant', t);
        } else {
          this.sendBoundary(b, 'refuse', t);
          // the segment next to the node held by its far end: asked back, so that the next request finds it here
          if (b.holds && ns && this.segDir.get(ns.seg) === -ns.end && this.segmentEmpty(ns.seg)) {
            const key = `${ns.seg}:${ns.end}`;
            if (!this.consentPending.has(key)) { this.consentPending.set(key, t); this.send(ns.seg, ns.end, 'request', t); }
          }
        }
      } else if (m.kind === 'grant') {
        b.holds = true;
        this.bPending.delete(m.boundary);
        this.events.push({ type: 'INFO', text: `Consent of the node ${b.cfg.node} (${b.cfg.a}–${b.cfg.b}) given to the interlocking of ${this.id}, t = ${t.toFixed(1)} s` });
      } else {
        this.bPending.delete(m.boundary);
        this.bRefused.set(m.boundary, t);
      }
    }
  }

  /** Messages of the block consent sent in an earlier cycle reach the other end now */
  private consentCycle(t: number): void {
    const now = this.ils.filter(m => m.t < t - 1e-9);
    this.ils = this.ils.filter(m => m.t >= t - 1e-9);
    for (const m of now) {
      const to = -m.from as 1 | -1, holder = this.segDir.get(m.seg) ?? 0;
      if (m.kind === 'request') {
        // the end that holds the consent gives it only with the segment empty; an end without it can only refuse
        // the segment next to a node is given towards the node only while this interlocking holds the consent of the node
        const nodeSide = [...this.nodeSegs].find(([, z]) => z.seg === m.seg && z.end === to);
        const nodeHeld = !nodeSide || this.holdsBoundary(nodeSide[0]);
        if (nodeSide && !nodeHeld) {
          const b = this.bounds.get(nodeSide[0]) as { cfg: BoundaryConfig; peer: string; holds: boolean };
          if (!this.bPending.has(b.cfg.id) && t >= (this.bRefused.get(b.cfg.id) ?? -Infinity) + CONSENT_RETRY_S) { this.bPending.set(b.cfg.id, t); this.sendBoundary(b, 'request', t); }
        }
        if (holder === to && nodeHeld && this.segmentEmpty(m.seg)) {
          for (const o of this.routes.values()) if (o.cfg.segment === m.seg && o.cfg.automatic && o.state !== 'free') this.release(o, null);
          this.segDir.set(m.seg, 0);
          this.send(m.seg, to, 'grant', t);
        } else this.send(m.seg, to, 'refuse', t);
      } else if (m.kind === 'grant') {
        this.segDir.set(m.seg, to);
        this.consentPending.delete(`${m.seg}:${to}`);
        this.events.push({ type: 'INFO', text: `Block consent ${this.endName(m.seg, 1)}–${this.endName(m.seg, -1)} given to ${this.endName(m.seg, to)}, t = ${t.toFixed(1)} s` });
      } else {
        this.consentPending.delete(`${m.seg}:${to}`);
        this.consentRefused.set(`${m.seg}:${to}`, t);
      }
    }
  }

  /**
   * No train is in the segment nor about to enter it: no departure route into it is active and every section is
   * vacant. Block routes set by themselves on vacant sections do not hold the segment: nobody can have an authority
   * over them without a departure route before them
   */
  private segmentEmpty(seg: number): boolean {
    for (const r of this.routes.values()) {
      if (r.cfg.segment !== seg) continue;
      if (r.cfg.tvps.some(id => this.tvps.get(id)?.state !== 'vacant')) return false;
      if (r.state !== 'free' && !(r.cfg.automatic && r.state === 'set')) return false;
    }
    return true;
  }

  private move(p: PointSt, pos: 'N' | 'R'): void {
    p.commanded = pos;
    const hand = (pos === 'N') === (p.normal === 'right') ? CPP.right : CPP.left;
    this.out.push({ interface: 'SCI-P', message: 'Cd_Move_Point', sender: 'IXL', receiver: p.id, Commanded_Point_Position: hand });
  }

  private fail(r: RouteSt, why: string): void {
    this.events.push({ type: 'WARN', text: `Route ${r.cfg.name} not set: ${why}` });
    this.release(r, null);
  }

  private release(r: RouteSt, why: string | null): void {
    for (const id of r.cfg.tvps) { const s = this.tvps.get(id); if (s && s.lock === r.cfg.id) s.lock = null; }
    for (const d of r.cfg.points) {
      const p = this.points.get(d.id);
      if (!p || p.lock !== r.cfg.id) continue;
      p.lock = null;
      if (this.cfg.parameters.return_to_normal && p.pos === 'R' && p.able) this.move(p, 'N');
    }
    r.state = 'free';
    if (why) this.events.push({ type: 'INFO', text: `Route ${r.cfg.name} ${why}` });
  }

  /** The route is valid for an authority: set, intact and with the sections ahead of the train not disturbed */
  intact(r: RouteSt): boolean {
    if (r.state !== 'set' && r.state !== 'occupied') return false;
    if (r.cfg.points.some(d => this.points.get(d.id)?.pos !== d.position)) return false;
    if (r.cfg.tvps.some(id => this.tvps.get(id)?.state === 'disturbed')) return false;
    return true;
  }

  /** One interlocking cycle: route progress, releases, automatic route setting */
  cycle(t: number, info: RbcInfo): SciTelegram[] {
    this.lastTrains = info.trains ?? (info.train != null ? [{ engine: 1, x: info.train }] : []);
    for (const r of this.routes.values()) {
      if (r.state === 'setting') {
        if (r.cfg.points.every(d => this.points.get(d.id)?.pos === d.position)) { r.state = 'set'; r.t0 = t; }
        else if (t - r.t0 > 20) this.fail(r, 'points not detected within 20 s');
      }
      if (r.state === 'set' || r.state === 'cancelling') {
        if (r.cfg.tvps.some(id => this.tvps.get(id)?.state === 'occupied')) r.state = 'occupied';
      }
      if (r.state === 'cancelling' && t + 1e-9 >= r.cancelAt) this.release(r, 'cancelled at the end of the delay');
      if (r.state === 'occupied') this.sectionalRelease(r);
      if (r.state === 'occupied' && r.cfg.link?.side === 'in' && !r.overlapFree) this.overlapTimer(r, t);
    }
    if (this.twoWay) this.consentCycle(t);
    if (this.bounds.size) this.boundaryCycle(t);
    // the automatic block always works; automatic setting of station routes (ARS) can be switched off
    for (const r of this.routes.values()) {
      if (!r.cfg.automatic || r.state !== 'free') continue;
      // with both directions the block of a segment works only in the direction it was given to
      if (this.twoWay && r.cfg.segment != null && (this.segDir.get(r.cfg.segment) ?? 0) !== this.dirOf(r)) continue;
      this.request(r, t);
    }
    if (this.ars) this.automaticRouteSetting(t, info);
    return this.out.splice(0);
  }

  /** Timed overlap release of a route in from a node: the train in it has not moved for OVERLAP_RELEASE_S */
  private overlapTimer(r: RouteSt, t: number): void {
    const d = this.dirOf(r), a = this.u(r.cfg.start_m, d), b = this.u(r.cfg.end_m, d);
    const z = this.lastTrains.filter(q => (q.dir ?? 1) === d && !q.ahead && !q.behind && this.u(q.x, d) > a - 1 && this.u(q.x, d) < b + 1).sort((p, q) => this.u(q.x, d) - this.u(p.x, d))[0];
    if (!z) { r.still = undefined; return; }
    if (!r.still || Math.abs(r.still.x - z.x) > 0.5) { r.still = { x: z.x, since: t }; return; }
    if (t - r.still.since + 1e-9 >= OVERLAP_RELEASE_S) {
      r.overlapFree = true;
      this.events.push({ type: 'INFO', text: `Overlap of ${r.cfg.name} released: the train has stood still for ${OVERLAP_RELEASE_S} s, t = ${t.toFixed(1)} s` });
    }
  }

  /** Each section is released when it has been occupied and then left; the destination only needs to be occupied */
  private sectionalRelease(r: RouteSt): void {
    const list = r.cfg.tvps, last = list[list.length - 1];
    for (const id of list) {
      const s = this.tvps.get(id) as TvpsSt;
      if (s.state === 'occupied') r.seen.add(id);
      if (r.seen.has(id) && s.state === 'vacant' && !r.released.has(id)) {
        r.released.add(id);
        if (s.lock === r.cfg.id) s.lock = null;
        // the points in the released section are unlocked
        const cfg = this.cfg.tvps.find(x => x.id === id);
        for (const d of r.cfg.points) {
          const p = this.points.get(d.id);
          if (p && cfg && p.s >= cfg.from_m && p.s <= cfg.to_m && p.lock === r.cfg.id) {
            p.lock = null;
            if (this.cfg.parameters.return_to_normal && p.pos === 'R' && p.able) this.move(p, 'N');
          }
        }
      }
    }
    const before = list.slice(0, -1);
    // an occupied destination is enough only if the train has already left the sections before it (not for a one-section arrival)
    // a route out to another interlocking holds its last section until the train has left it beyond the node
    const destinationOccupied = r.seen.has(last) && before.length > 0 && (r.cfg.type === 'entry' || r.cfg.type === 'arrival') && r.cfg.link?.side !== 'out';
    if (before.every(id => r.released.has(id)) && (r.released.has(last) || destinationOccupied)) {
      // a route out to another line: its train has left this line, the track it stood on is no one's
      if (r.cfg.type === 'entry' && r.cfg.station != null && r.cfg.link?.side !== 'out') {
        // the train that ran through it is the one in session whose head is now beyond the start of the route
        const d = this.dirOf(r), k = r.cfg.station, s0 = this.u(r.cfg.start_m, d);
        const by = this.lastTrains.filter(z => (z.dir ?? 1) === d && !z.ahead && !z.behind && this.u(z.x, d) > s0).sort((a, b) => this.u(a.x, d) - this.u(b.x, d))[0];
        this.setTrack(by ? by.engine : 1, k, r.cfg.branch_end);
      }
      this.release(r, null);
    }
  }

  /**
   * Automatic route setting (ARS): entries and departures for every train in session according to its timetable.
   * Requests of the same cycle are made in the order of the conflict rule, so that when two trains want conflicting
   * routes the first in that order gets them: the earlier timetabled movement ('timetable', default) or the train
   * that has been waiting longer ('first_come').
   */
  private automaticRouteSetting(t: number, info: RbcInfo): void {
    const trains = this.lastTrains;
    const wants: { key: string; prio: number; order: number; routes: RouteSt[]; onGranted: (r: RouteSt) => void }[] = [];
    for (const z of trains) {
      const { engine } = z, d = z.dir ?? 1, U = (v: number) => this.u(v, d), x = U(z.x);
      const tt = this.timetables.get(engine);
      if (!tt) continue;
      tt.forEach((o, i) => {
        const k = o.station, prev = tt[i - 1];
        const rs = [...this.routes.values()].filter(r => r.cfg.station === k && this.dirOf(r) === d);
        // on a network a train that comes from another line or goes on to another one uses the node routes of that line
        const via = o.from_line ?? o.to_line, side = o.from_line ? 'in' : 'out';
        const entries = rs.filter(r => (r.cfg.type === 'entry' || r.cfg.type === 'arrival') && (via ? r.cfg.link?.line === via && r.cfg.link.side === side : !r.cfg.link));
        const departures = rs.filter(r => r.cfg.type === 'departure');
        // entry: the train has left the previous station of its timetable and is within the approach distance
        const h = entries.length ? U(entries[0].cfg.start_m) : 0;
        if (entries.length && (prev ? x > U(prev.s_m) + 100 : !!o.from_line) && x > h - APPROACH_M && x < h + 5 && entries.every(r => r.state === 'free')) {
          // the requested track; otherwise the main track, another one only when the train is near and I is occupied
          const wanted = o.track ? entries.filter(r => r.cfg.branch_end === (o.track === 'I' ? 'I' : o.track + ':' + o.name)) : entries;
          const near = x > h - DECISION_M;
          const list = o.track ? wanted : wanted.filter((r, j) => j === 0 || near);
          if (list.length) wants.push({
            key: `${engine}:${k}:entry`, prio: this.prio(engine), order: o.arrival_s ?? o.departure_s ?? prev?.departure_s ?? t, routes: list,
            onGranted: r => { this.setTrack(engine, k, null); this.passTrack.set(`${engine}:${k}`, r.cfg.branch_end); },
          });
        }
        // departure: at the timetabled time, from the track the train entered. A train that passes asks for it
        // together with the entry, through the track of the entry granted, so that it finds the exit set in time
        const pass = i > 0 && o.arrival_s == null && o.departure_s == null;
        const due = pass || (o.departure_s != null && t + 1e-9 >= o.departure_s);
        if (departures.length && i < tt.length - 1 && due && departures.every(r => r.state === 'free')) {
          // the track is known once the entry route was released with the train on the destination; at the origin it is I
          // a train that came from another line stands on the track of the node route it was given
          const track = this.track(engine, k) ?? (pass || o.from_line ? this.passTrack.get(`${engine}:${k}`) : undefined) ?? (i === 0 ? 'I' : null);
          const r = track ? departures.find(p => p.cfg.branch_start === track) : undefined;
          // the same key other trains see for this one in heldByTimetable: a train that passes is timetabled by its
          // departure from the previous station (two different keys could make two trains wait for each other)
          const order = o.departure_s ?? o.arrival_s ?? prev?.departure_s ?? t;
          const from = pass && entries.length ? h - APPROACH_M : U(o.s_m) - 400;
          if (r && x > from && x < U(r.cfg.start_m) + 5 && !this.heldByTimetable(engine, k, track as string, order, trains, t, d)) {
            wants.push({ key: `${engine}:${k}:departure`, prio: this.prio(engine), order, routes: [r], onGranted: () => {} });
          }
        }
      });
    }
    const rule = this.cfg.parameters.conflict_rule ?? 'timetable';
    for (const w of wants) if (!this.wantSince.has(w.key)) this.wantSince.set(w.key, t);
    const live = new Set(wants.map(w => w.key));
    for (const k of [...this.wantSince.keys()]) if (!live.has(k)) this.wantSince.delete(k);
    const since = (w: { key: string }) => this.wantSince.get(w.key) as number;
    wants.sort((a, b) => b.prio - a.prio || (rule === 'first_come' ? since(a) - since(b) || a.order - b.order : a.order - b.order || since(a) - since(b)));
    for (const w of wants) for (const r of w.routes) {
      if (r.state !== 'free') continue;
      if (!this.request(r, t)) { w.onGranted(r); this.wantSince.delete(w.key); break; }
    }
  }

  /** Priority of a train in conflicts */
  private prio(engine: number): number { return this.priorities.get(engine) ?? 0; }

  /**
   * A departure waits for another train that should leave (or pass) the same station first: one with a higher
   * priority or, with the 'timetable' rule and the same priority, one timetabled earlier. The other train must be
   * between its previous station and the end of this one and not on the same track (a train behind on the same track
   * could not leave first anyway). With 'first_come' and equal priorities nobody waits.
   */
  private heldByTimetable(engine: number, k: number, track: string, order: number, trains: TrainPos[], t: number, d: 1 | -1 = 1): boolean {
    const byTimetable = (this.cfg.parameters.conflict_rule ?? 'timetable') === 'timetable', mine = this.prio(engine);
    const U = (v: number) => this.u(v, d);
    for (const z of trains) {
      // only trains of the same direction compete for the exit of a station; the other direction meets the block consent
      if (z.engine === engine || (z.dir ?? 1) !== d) continue;
      const tt = this.timetables.get(z.engine), i = tt ? tt.findIndex(o => o.station === k) : -1;
      if (!tt || i < 0 || i === tt.length - 1) continue;
      const o = tt[i], prev = tt[i - 1], other = this.prio(z.engine);
      const when = o.departure_s ?? o.arrival_s ?? (prev ? prev.departure_s : null);
      const first = other > mine || (other === mine && byTimetable && when != null && when < order);
      if (!first) continue;
      const dep = [...this.routes.values()].find(r => r.cfg.station === k && r.cfg.type === 'departure' && this.dirOf(r) === d);
      const zx = U(z.x);
      const leftStation = dep ? zx > U(dep.cfg.end_m) : zx > U(o.s_m) + 400;
      const approaching = prev ? zx > U(prev.s_m) + 100 : zx > U(o.s_m) - 400;
      if (!approaching || leftStation) continue;
      if (this.track(z.engine, k) === track) continue;
      if (!this.holding.has(`${engine}:${k}`)) {
        this.holding.add(`${engine}:${k}`);
        const why = other > mine ? 'a train with higher priority' : 'a train timetabled earlier (rule «timetable»)';
        this.events.push({ type: 'INFO', text: `ARS: departure from ${o.name} held for ${why}, t = ${t.toFixed(0)} s` });
      }
      return true;
    }
    this.holding.delete(`${engine}:${k}`);
    return false;
  }
  private holding = new Set<string>();

  panel() {
    return {
      routes: [...this.routes.values()].filter(r => !r.cfg.automatic).map(r => ({ id: r.cfg.id, name: r.cfg.name, state: r.state, ...(r.state === 'cancelling' ? { cancel_at_s: r.cancelAt } : {}) })),
      points: [...this.points.values()].map(p => ({ id: p.id, position: p.pos, locked: p.lock != null, fault: !p.able })),
      tvps: [...this.tvps.values()].map(s => ({ id: s.id, state: s.state, locked: s.lock != null })),
      ...(this.twoWay ? { consents: [...this.segDir].map(([seg, h]) => ({ segment: `${this.endName(seg, 1)}–${this.endName(seg, -1)}`, holder: h === 0 ? null : this.endName(seg, h as 1 | -1) })) } : {}),
    };
  }
}
