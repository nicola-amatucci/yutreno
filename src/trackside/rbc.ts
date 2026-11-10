/**
 * Trackside RBC: it knows the train only from the onboard position reports (message 136) and the way ahead only from
 * the routes of the interlocking. The movement authority reaches the end of the last intact, consecutive route ahead
 * of the train, with the supervised location at the end of its overlap.
 *
 * With every message 3 the RBC sends the authority (packet 15), the static speed profile (27) with the speeds of the
 * routes themselves (diverging speed), gradients (21), balise linking (5) and the temporary speed restrictions (65
 * and 66) received from the control centre, all referred to the last reported balise group. The emergency stop of
 * the control centre becomes message 16.
 *
 * The RBC keeps one session per train (NID_ENGINE of the position reports): each with its position, branch and
 * authority. Messages to trains other than the controlled one (engine 1) carry NID_ENGINE as the address of the
 * radio connection; messages to the controlled train are unchanged.
 *
 * A train running towards the origin of the line reports Q_DIRLRBG = 0: for it the RBC works in the chainages it sees
 * (the line mirrored), uses the routes and markers of the reverse direction and sends packets with Q_DIR = 0, with
 * distances counted from the LRBG in its direction of running, as the simple RBC does.
 *
 * Declared simplifications: session opened at the first position report (without the start of mission dialogue), a shorter authority replaces the previous one with a new message 3 (without the
 * co-operative shortening of Subset-026 §3.8.6).
 */
import type { EtcsPacket, RadioMessage } from '../core/types';
import type { Interlocking } from './interlocking';
import type { CorridorConfig, NrbcMessage, OperatorCommand, RbcAreasConfig, TracksideConfig, RouteConfig } from './types';

const NID_C = 1;

/** Authority of a session, in the chainages seen by the train (mirrored for a train running towards the origin) */
export interface TracksideMa {
  eoa: number; svl: number; endOfLine: boolean; routes: string[]; reason: string; speeds: [number, number, number][];
  /** Several RBCs: the part beyond the border, from the route related information of the Accepting RBC */
  beyond?: { from: number; ssp: [number, number, number][]; grad: [number, number, number][] };
}

/** State of the RBC for one train, identified by the NID_ENGINE of its position reports */
export class RbcSession {
  report: { lrbg: number; d: number; doubt: number; t: number; mode?: number } | null = null;
  /** Several RBCs: the confirmed min safe rear end of the train (line chainage), from the last report with integrity confirmed */
  rearConfirmed: number | null = null;
  /** Direction of running from Q_DIRLRBG: +1 nominal, −1 towards the origin */
  dir: 1 | -1 = 1;
  lastKey = '';
  lastSent = -1e9;
  tsrSent = new Map<string, number>();
  nextTsr = 1;
  nidEm = 1;
  stopSent = false;
  /** Branch of the train: the end branch of the last route that contained it */
  branch = 'I';
  ma: TracksideMa | null = null;
  /** Several RBCs: the handover of this train to the next RBC, while this RBC is the Handing Over one */
  hov: HovState | null = null;
  /** Several RBCs: the order to terminate the session has been sent */
  terminateSent = false;
  constructor(readonly engine: number) {}
}

type Border = RbcAreasConfig['borders'][number];
/** Route related information received from the Accepting RBC, in the chainages seen by the train */
interface Rri { eoa: number; svl: number; endOfLine: boolean; ssp: [number, number, number][]; grad: [number, number, number][]; from: number }
/** Handover of a train by this RBC (Subset-039 Table 4, state HOV) */
interface HovState { border: Border; acc: number; t201: number; acked: boolean; announced: boolean; rri: Rri | null; tor: boolean }
/** Handover of a train to this RBC (Subset-039 Table 8, state ACC): the virtual session that computes the RRI */
interface AccState { border: Border; hov: number; dir: 1 | -1; requested: boolean; lastKey: string; ses: RbcSession }

/** Area of an RBC when the trackside has several (`TracksideConfig.rbcs`) */
export interface RbcArea { nid: number; from: number; to: number; cfg: RbcAreasConfig }

export class TracksideRbc {
  /** One session per train, in the order the sessions were opened */
  readonly sessions = new Map<number, RbcSession>();
  /** Emergency stop of the control centre: for all the trains ('all') or for some of them */
  private stop: 'all' | Set<number> | null = null;
  readonly tsr = new Map<string, { from_m: number; to_m: number; v_kmh: number }>();

  /**
   * Network: the trains that run along a corridor of several lines (or along a line other than the main one), with
   * their balise groups. For them the RBC works in the chainages of the corridor, always run forwards
   */
  readonly corridors = new Map<number, CorridorConfig>();

  /** Several RBCs: handovers to this RBC, by engine; messages for the other RBCs; radio messages for the next cycle */
  readonly accT = new Map<number, AccState>();
  nrbcOut: NrbcMessage[] = [];
  private pendingRadio: RadioMessage[] = [];
  private lastSent = new Map<number, number>();
  private lastHeard = new Map<number, number>();

  constructor(readonly cfg: TracksideConfig, readonly area: RbcArea | null = null) {
    for (const c of cfg.network?.corridors ?? []) this.corridors.set(c.engine, c);
  }

  /** Chainages of the area seen by a train of direction d, start and end in its direction of running */
  private areaU(d: 1 | -1): [number, number] {
    const a = this.area as RbcArea;
    return d > 0 ? [a.from, a.to] : [this.u(a.to, d), this.u(a.from, d)];
  }

  /** Border ahead of a train of direction d, at the end of this area, with the RBC beyond it */
  borderAhead(d: 1 | -1): { border: Border; next: number } | null {
    if (!this.area) return null;
    const x = d > 0 ? this.area.to : this.area.from;
    const b = this.area.cfg.borders.find(z => Math.abs(z.s_m - x) < 1);
    return b ? { border: b, next: d > 0 ? b.b : b.a } : null;
  }

  /** Confirmed min safe rear end of a train in session, in line chainages; null if unknown */
  rear(engine: number): number | null { return this.sessions.get(engine)?.rearConfirmed ?? null; }

  /** Has a chainage x (line) been passed by a train of direction d going past the border b? */
  private past(x: number | null, b: Border, d: 1 | -1): boolean { return x != null && (d > 0 ? x > b.s_m : x < b.s_m); }

  private nrbc(to: number, t: number, m: Omit<NrbcMessage, 'NID_C' | 'NID_RBC' | 'to' | 'T_RBC'>): NrbcMessage {
    const msg = { NID_C, NID_RBC: (this.area as RbcArea).nid, to, T_RBC: Math.round(t * 100) + this.nrbcOut.length, ...m } as NrbcMessage;
    this.nrbcOut.push(msg);
    this.lastSent.set(to, t);
    return msg;
  }

  /** Authority of the controlled train (engine 1), for the panel */
  get ma(): TracksideMa | null { return this.sessions.get(1)?.ma ?? null; }

  private bgPos(nid: number, engine = 1): number | null {
    const b = (this.corridors.get(engine)?.balises ?? this.cfg.balises).find(x => x.NID_BG === nid % 16384);
    return b ? b.s_m : null;
  }

  /** Max safe front end of a train in session (default the controlled train) in line chainages, or in the chainages of its corridor; null if unknown */
  position(engine = 1): number | null {
    const ses = this.sessions.get(engine), r = ses?.report;
    if (!ses || !r) return null;
    const p = this.bgPos(r.lrbg, engine);
    return p == null ? null : p + ses.dir * (r.d + r.doubt);
  }

  /** Chainage seen by a train of direction d */
  private u(x: number, d: 1 | -1): number { return d > 0 ? x : this.cfg.line.length_m - x; }
  /** Back to line chainages from the frame of a train */
  line(x: number, d: 1 | -1): number { return d > 0 ? x : this.cfg.line.length_m - x; }

  receive(m: RadioMessage, t: number): void {
    // End of Mission or termination of the session: the train is no longer followed
    if (m.NID_MESSAGE === 150 || m.NID_MESSAGE === 156) {
      const engine = typeof m.NID_ENGINE === 'number' ? m.NID_ENGINE : 1, ses = this.sessions.get(engine);
      if (this.area && ses) {
        // several RBCs: termination acknowledged (message 39); an End of Mission cancels a handover (§3.15.1.2.9)
        if (m.NID_MESSAGE === 156) this.pendingRadio.push({ NID_MESSAGE: 39, T_TRAIN: Math.round(t * 100), M_ACK: 0, NID_LRBG: ses.report?.lrbg ?? 0, ...(engine === 1 ? {} : { NID_ENGINE: engine }), NID_RBC: this.area.nid });
        else if (ses.hov) this.nrbc(ses.hov.acc, t, { NID_NRBCMESSAGE: 204, NID_ENGINE: engine, NID_BG: ses.hov.border.NID_BG, M_ACK: 0 });
      }
      this.sessions.delete(engine);
      return;
    }
    if (m.NID_MESSAGE !== 136 && m.NID_MESSAGE !== 132 && m.NID_MESSAGE !== 157) return;
    const p0 = (m.packets || []).find(p => p.NID_PACKET === 0 || p.NID_PACKET === 1);
    const engine = typeof m.NID_ENGINE === 'number' ? m.NID_ENGINE : 1;
    if (!p0 || typeof p0.NID_LRBG !== 'number' || this.bgPos(p0.NID_LRBG, engine) == null) return;
    let ses = this.sessions.get(engine);
    if (!ses) { ses = new RbcSession(engine); this.sessions.set(engine, ses); }
    ses.report = { lrbg: p0.NID_LRBG, d: Number(p0.D_LRBG) || 0, doubt: Number(p0.L_DOUBTOVER) || 0, t, ...(this.area ? { mode: Number(p0.M_MODE) || 0 } : {}) };
    ses.dir = Number(p0.Q_DIRLRBG ?? 1) === 0 ? -1 : 1;
    // the confirmed rear end: the estimated front end minus the confirmed train length (§3.6.5.2.4), only from a report
    // with integrity confirmed (Q_INTEGRITY of Baseline 4, or Q_LENGTH of Baseline 3, 1 or 2); otherwise it stays
    const q = Number(p0.Q_INTEGRITY ?? p0.Q_LENGTH ?? 0), p = this.bgPos(p0.NID_LRBG, engine);
    if (this.area && (q === 1 || q === 2) && typeof p0.L_TRAININT === 'number' && p != null) ses.rearConfirmed = p + ses.dir * (ses.report.d - p0.L_TRAININT);
  }

  command(c: OperatorCommand): void {
    if (c.type === 'speed_restriction') this.tsr.set(c.id, { from_m: c.from_m, to_m: c.to_m, v_kmh: c.v_kmh });
    else if (c.type === 'revoke_speed_restriction') this.tsr.delete(c.id);
    else if (c.type === 'emergency_stop') {
      if (c.engine == null) this.stop = 'all';
      else if (this.stop !== 'all') { const set = this.stop ?? new Set<number>(); set.add(c.engine); this.stop = set; }
    } else if (c.type === 'revoke_emergency_stop') {
      if (c.engine == null || this.stop === 'all') this.stop = null;
      else if (this.stop) { this.stop.delete(c.engine); if (!this.stop.size) this.stop = null; }
      for (const s of this.sessions.values()) if (c.engine == null || s.engine === c.engine) s.stopSent = false;
    }
  }

  private stopped(engine: number): boolean { return this.stop === 'all' || (!!this.stop && this.stop.has(engine)); }

  /**
   * Authority from the interlocking routes for a train with its head at x, in line chainages (default: the controlled
   * train's session). The result is in the chainages seen by the train.
   */
  computeMa(xLine: number, ixl: Interlocking, ses: RbcSession = this.sessions.get(1) ?? new RbcSession(1)): TracksideMa {
    const d = ses.dir, U = (v: number) => this.u(v, d), x = U(xLine);
    // the routes of the train's direction, with start and end as the train sees them
    // node routes and node markers of a network belong to the trains that change line (computeMaCorridor)
    const area = this.area ? this.areaU(d) : null;
    const routes = [...ixl.routes.values()].filter(r => (r.cfg.dir ?? 1) === d && !r.cfg.link).map(r => ({ r, a: U(r.cfg.start_m), b: U(r.cfg.end_m) }))
      // several RBCs: only the routes of this RBC's area
      .filter(z => !area || (z.a >= area[0] - 1 && z.b <= area[1] + 1));
    const vel: [number, number, number][] = [];
    const used: string[] = [];
    const speeds = (c: RouteConfig) => c.speeds.map(([p, q, v]) => (d > 0 ? [p, q, v] : [U(q), U(p), v]) as [number, number, number]);
    // route that contains the head or that the head is entering (it may be occupied by the train itself). With
    // several trains it must be one of the routes of the authority granted to this train: tracks I and II of a
    // station share their chainages, and a train standing on I is not inside the entry route to II set for another
    const granted0 = new Set(ses.ma?.routes ?? []), several = this.sessions.size > 1;
    const cur = routes.find(({ r, a, b }) => a <= x + 1 && x < b - 0.5 && ixl.intact(r) && r.cfg.branch_start === ses.branch && (!several || granted0.has(r.cfg.id)));
    let e: number, branch = ses.branch, last: RouteConfig | null = null;
    if (cur) { e = cur.b; branch = cur.r.cfg.branch_end; last = cur.r.cfg; used.push(cur.r.cfg.id); vel.push(...speeds(cur.r.cfg)); ses.branch = cur.r.cfg.branch_end; }
    else {
      // outside a route: up to the next stop marker on the branch of the train, in its direction
      const mk = this.cfg.markers.filter(m => (m.dir ?? 1) === d && !m.node && m.branch === branch && U(m.s_m) > x - 1 && (!area || (U(m.s_m) >= area[0] - 1 && U(m.s_m) <= area[1] + 1))).sort((p, q) => U(p.s_m) - U(q.s_m))[0];
      e = mk ? U(mk.s_m) : x;
    }
    // a route already covered by the granted authority and then occupied is occupied by this train, which the RBC
    // knows only from the last position report: it stays valid; the others must be set and vacant
    const granted = new Set(ses.ma?.routes ?? []);
    for (let guard = 0; guard < 200; guard++) {
      const next = routes.find(({ r, a }) => Math.abs(a - e) < 1 && r.cfg.branch_start === branch && ixl.intact(r) &&
        ((r.state === 'set' && r.cfg.tvps.every(id => ixl.tvps.get(id)?.state === 'vacant')) || (r.state === 'occupied' && granted.has(r.cfg.id))));
      if (!next) break;
      e = next.b; branch = next.r.cfg.branch_end; last = next.r.cfg; used.push(next.r.cfg.id); vel.push(...speeds(next.r.cfg));
    }
    const endOfLine = !!last && last.type === 'arrival';
    const overlapOk = !!last && last.tvps_overlap.every(id => ixl.tvps.get(id)?.state === 'vacant');
    const svl = endOfLine ? this.cfg.line.length_m : e + (last && overlapOk ? last.overlap_m : 0);
    const reason = endOfLine ? 'end of line' : used.length ? 'end of route ' + (last as RouteConfig).name : 'no route set';
    return { eoa: e, svl, endOfLine, routes: used, reason, speeds: vel };
  }

  /**
   * Authority of a train along its corridor (network): the routes of every interlocking moved to the chainages of the
   * corridor, where the corridor runs along their line in their direction. A node route is used only where the corridor
   * really changes line there: a route out of an interlocking is followed by the route into the next one, across the
   * boundary. Branches are those of each interlocking, prefixed with its line.
   */
  computeMaCorridor(c: number, ixls: Interlocking[], ses: RbcSession, cor: CorridorConfig): TracksideMa {
    const lo = (g: CorridorConfig['legs'][number]) => g.from_m ?? -Infinity, hi = (g: CorridorConfig['legs'][number]) => g.to_m ?? Infinity;
    const legOf = (x: number) => Math.max(0, cor.legs.findIndex(g => x >= lo(g) - 1e-6 && x <= hi(g) + 1e-6));
    type Mapped = { r: Interlocking['routes'] extends Map<string, infer R> ? R : never; ixl: Interlocking; a: number; b: number; k0: string; k1: string; speeds: [number, number, number][] };
    const routes: Mapped[] = [];
    const markers: { a: number; key: string; node?: string; ixl: Interlocking }[] = [];
    for (const ixl of ixls) {
      const len = ixl.cfg.line.length_m;
      cor.legs.forEach((g, i) => {
        if (g.line !== ixl.id) return;
        const toC = (x: number) => g.c0_m + ((g.dir > 0 ? x : len - x) - g.d0_m);
        const inside = (x: number) => x >= lo(g) - 1 && x <= hi(g) + 1;
        for (const r of ixl.routes.values()) {
          if ((r.cfg.dir ?? 1) !== g.dir) continue;
          const lk = r.cfg.link;
          if (lk && (lk.side === 'out' ? cor.legs[i + 1]?.line !== lk.line : cor.legs[i - 1]?.line !== lk.line)) continue;
          const a = toC(r.cfg.start_m), b = toC(r.cfg.end_m);
          if (!inside(a) || !inside(b)) continue;
          const speeds = r.cfg.speeds.map(([p, q, v]) => { const x = toC(p), y = toC(q); return [Math.min(x, y), Math.max(x, y), v] as [number, number, number]; });
          routes.push({ r, ixl, a, b, k0: ixl.id + '|' + r.cfg.branch_start, k1: ixl.id + '|' + r.cfg.branch_end, speeds });
        }
        for (const m of ixl.cfg.markers) {
          if ((m.dir ?? 1) !== g.dir) continue;
          const a = toC(m.s_m);
          // a node marker counts only where the corridor changes line there
          if (inside(a) && (!m.node || Math.abs(a - (i + 1 < cor.legs.length ? hi(g) : Infinity)) < 1)) markers.push({ a, key: ixl.id + '|' + m.branch, ...(m.node ? { node: m.node } : {}), ixl });
        }
      });
    }
    if (!ses.branch.includes('|')) ses.branch = cor.legs[legOf(c)].line + '|' + ses.branch;
    const vel: [number, number, number][] = [], used: string[] = [];
    const granted = new Set(ses.ma?.routes ?? []), several = this.sessions.size > 1;
    // a train that has just crossed a node is in the route into the next interlocking, granted to it
    const crossed = (r: Mapped['r'], ixl: Interlocking) => r.cfg.link?.side === 'in' && !ses.branch.startsWith(ixl.id + '|') && granted.has(r.cfg.id);
    const cur = routes.find(({ r, ixl, a, b, k0 }) => a <= c + 1 && c < b - 0.5 && ixl.intact(r) && (k0 === ses.branch || crossed(r, ixl)) && (!several || granted.has(r.cfg.id)));
    let e: number, branch = ses.branch, last: Mapped | null = null;
    // at a node, where the authority may go on into the interlocking of the next line: boundary and interlocking left
    let node: { boundary: string; ixl: Interlocking } | null = null;
    if (cur) { e = cur.b; branch = cur.k1; last = cur; used.push(cur.r.cfg.id); vel.push(...cur.speeds); ses.branch = cur.k1; }
    else {
      const mk = markers.filter(m => m.key === branch && m.a > c - 1).sort((p, q) => p.a - q.a)[0];
      e = mk ? mk.a : c;
      if (mk?.node) node = { boundary: mk.node, ixl: mk.ixl };
    }
    if (last?.r.cfg.link?.side === 'out') node = { boundary: last.r.cfg.link.boundary, ixl: last.ixl };
    for (let guard = 0; guard < 200; guard++) {
      const at = node;
      const next = routes.find(m => Math.abs(m.a - e) < 1 && m.ixl.intact(m.r) &&
        (m.k0 === branch || (!!at && m.ixl !== at.ixl && m.r.cfg.link?.side === 'in' && m.r.cfg.link.boundary === at.boundary)) &&
        ((m.r.state === 'set' && m.r.cfg.tvps.every(id => m.ixl.tvps.get(id)?.state === 'vacant')) || (m.r.state === 'occupied' && granted.has(m.r.cfg.id))));
      if (!next) break;
      e = next.b; branch = next.k1; last = next; used.push(next.r.cfg.id); vel.push(...next.speeds);
      node = next.r.cfg.link?.side === 'out' ? { boundary: next.r.cfg.link.boundary, ixl: next.ixl } : null;
    }
    const endOfLine = !!last && last.r.cfg.type === 'arrival';
    const overlapOk = !!last && last.r.cfg.tvps_overlap.every(id => last!.ixl.tvps.get(id)?.state === 'vacant');
    const svl = endOfLine ? cor.length_m : e + (last && overlapOk ? last.r.cfg.overlap_m : 0);
    const reason = endOfLine ? 'end of line' : used.length ? 'end of route ' + (last as Mapped).r.cfg.name : 'no route set';
    return { eoa: e, svl, endOfLine, routes: used, reason, speeds: vel };
  }

  /** Messages to send in this cycle to every train in session, each addressed with its NID_ENGINE */
  cycle(t: number, ixl: Interlocking, ixls: Interlocking[] = [ixl]): RadioMessage[] {
    const out: RadioMessage[] = this.pendingRadio.splice(0);
    if (this.area) for (const nb of this.neighbours()) if (!this.lastHeard.has(nb)) this.lastHeard.set(nb, t);
    for (const ses of this.sessions.values()) out.push(...this.cycleSession(ses, t, ixl, ixls));
    if (!this.area) return out;
    this.accCycle(t, ixl);
    const life = this.area.cfg.life_sign_s ?? 10;
    for (const nb of this.neighbours()) if (t - (this.lastSent.get(nb) ?? -Infinity) >= life) this.nrbc(nb, t, { NID_NRBCMESSAGE: 223, M_ACK: 0 });
    const nid = this.area.nid;
    return out.map(m => ({ ...m, NID_RBC: nid }));
  }

  /** The RBCs across the borders of this area */
  neighbours(): number[] {
    if (!this.area) return [];
    const a = this.area, out: number[] = [];
    for (const b of a.cfg.borders) { if (b.a === a.nid) out.push(b.b); if (b.b === a.nid) out.push(b.a); }
    return out;
  }

  /** The RBC–RBC communication with nb is supervised: lost when nothing has been heard for the supervision time */
  private linkUp(nb: number, t: number): boolean {
    return t - (this.lastHeard.get(nb) ?? t) <= ((this.area as RbcArea).cfg.link_timeout_s ?? 30);
  }

  /** Order to terminate the session (packet 42, Q_RBC = 0, in message 24) */
  private terminateOrder(ses: RbcSession, t: number): RadioMessage {
    return {
      NID_MESSAGE: 24, T_TRAIN: Math.round(t * 100), M_ACK: 0, NID_LRBG: ses.report?.lrbg ?? 0,
      packets: [{ NID_PACKET: 42, Q_DIR: 2, Q_RBC: 0, NID_C, NID_RBC: (this.area as RbcArea).nid, NID_RADIO: 0, Q_SLEEPSESSION: 0 }],
      ...(ses.engine === 1 ? {} : { NID_ENGINE: ses.engine }),
    };
  }

  /** A message from another RBC (Subset-039 Tables 4 and 8) */
  receiveNrbc(m: NrbcMessage, t: number): void {
    if (!this.area) return;
    this.lastHeard.set(m.NID_RBC, t);
    const engine = m.NID_ENGINE ?? 1, ses = this.sessions.get(engine);
    const ack = () => this.nrbc(m.NID_RBC, t, { NID_NRBCMESSAGE: 205, NID_ENGINE: m.NID_ENGINE, NID_BG: m.NID_BG, M_ACK: 0, T_RBC_ACK: m.T_RBC });
    const border = this.area.cfg.borders.find(b => b.NID_BG === m.NID_BG);
    switch (m.NID_NRBCMESSAGE) {
      case 201:
        ack();
        if (border) this.accT.set(engine, { border, hov: m.NID_RBC, dir: m.Q_DIR === 0 ? -1 : 1, requested: false, lastKey: '', ses: new RbcSession(engine) });
        break;
      case 202: {
        if (m.M_ACK) ack();
        const a = this.accT.get(engine);
        if (a) { a.requested = true; a.lastKey = ''; }
        break;
      }
      case 203: if (m.M_ACK) ack(); break;
      case 204:
        if (m.M_ACK) ack();
        // the Accepting RBC orders a train already in session with it to terminate the session (§3.15.1.4.4)
        if (this.accT.delete(engine) && ses) this.pendingRadio.push(this.terminateOrder(ses, t));
        if (ses?.hov && ses.hov.acc === m.NID_RBC) ses.hov = null;
        break;
      case 205:
        if (ses?.hov && !ses.hov.acked && ses.hov.t201 === m.T_RBC_ACK) {
          ses.hov.acked = true;
          this.nrbc(ses.hov.acc, t, { NID_NRBCMESSAGE: 202, NID_ENGINE: m.NID_ENGINE, NID_BG: ses.hov.border.NID_BG, M_ACK: 0 });
        }
        break;
      case 221:
        ack();
        if (ses?.hov && !ses.hov.tor) ses.hov.rri = this.decodeRri(m.packets ?? [], ses.hov.border, ses.dir);
        break;
      case 222: if (ses?.hov) ses.hov.tor = true; break;
    }
  }

  /** Route related information, packets referred to the border balise group, in the chainages seen by the train */
  private decodeRri(pk: EtcsPacket[], b: Border, d: 1 | -1): Rri {
    const from = this.u(b.bg_s_m, d);
    const p15 = pk.find(p => p.NID_PACKET === 15) as Record<string, number> | undefined;
    let eoa = from, svl = from, endOfLine = false;
    if (p15) {
      eoa = from + Number(p15.L_ENDSECTION);
      endOfLine = Number(p15.Q_DANGERPOINT) !== 1;
      svl = endOfLine ? this.cfg.line.length_m : eoa + Number(p15.D_DP);
    }
    const profile = (n: number, dist: string, val: (e: Record<string, number>) => number | null): [number, number, number][] => {
      const p = pk.find(q => q.NID_PACKET === n);
      if (!p) return [];
      const el = [p as unknown as Record<string, number>, ...((p.elements as Record<string, number>[]) || [])], out: [number, number, number][] = [];
      let x = from;
      for (let i = 0; i < el.length; i++) {
        x += el[i][dist];
        const v = val(el[i]);
        if (v == null) break;
        out.push([x, i + 1 < el.length ? x + el[i + 1][dist] : x, v]);
      }
      return out;
    };
    const ssp = profile(27, 'D_STATIC', e => (e.V_STATIC === 127 ? null : e.V_STATIC * 5));
    const grad = profile(21, 'D_GRADIENT', e => (e.G_A === 255 ? null : e.Q_GDIR === 1 ? e.G_A : -e.G_A));
    return { eoa, svl, endOfLine, ssp, grad, from };
  }

  /** As Accepting RBC: the route related information of every pre-announced train, sent again whenever it changes */
  private accCycle(t: number, ixl: Interlocking): void {
    for (const [engine, a] of this.accT) {
      if (!this.linkUp(a.hov, t)) { this.accT.delete(engine); continue; }
      // the route related information only once the train is in session with this RBC as well (an implementation
      // choice, docs/TRACKSIDE.md): a train that cannot reach this RBC stops at the border (§5.15.4.2)
      const own = this.sessions.get(engine);
      if (!a.requested || !own?.report) continue;
      const s = a.ses;
      s.dir = a.dir; s.report = { lrbg: a.border.NID_BG, d: 0, doubt: 0, t };
      // the authority this RBC gives the train, which knows where the train is, as seen from the border group
      const ma = own.ma ?? this.computeMa(a.border.s_m, ixl, s);
      s.ma = ma;
      const packets = (this.message3(0, ma, s).packets ?? []).filter(p => [15, 21, 27].includes(p.NID_PACKET as number));
      const key = JSON.stringify(packets);
      if (key === a.lastKey) continue;
      a.lastKey = key;
      this.nrbc(a.hov, t, { NID_NRBCMESSAGE: 221, NID_ENGINE: engine === 1 ? undefined : engine, NID_BG: a.border.NID_BG, M_ACK: 1, packets });
    }
  }

  /**
   * Several RBCs, for a train in session: as Accepting RBC the taking over of responsibility once its max safe front
   * end has passed the border; as Handing Over RBC the pre-announcement when its authority reaches the border, the
   * authority extended with the route related information, the announcement, and after the taking over only the
   * order to terminate the session once its min safe rear end has passed the border. `silent`: no message 3
   */
  private handover(ses: RbcSession, t: number, x: number, ma: TracksideMa): { msgs: RadioMessage[]; silent: boolean } {
    const msgs: RadioMessage[] = [], e = ses.engine, d = ses.dir, eng = e === 1 ? undefined : e;
    const acc = this.accT.get(e);
    if (acc && this.past(x, acc.border, acc.dir)) {
      this.nrbc(acc.hov, t, { NID_NRBCMESSAGE: 222, NID_ENGINE: eng, NID_BG: acc.border.NID_BG, M_ACK: 0 });
      this.accT.delete(e);
    }
    const ah = this.borderAhead(d);
    if (ses.hov && !this.linkUp(ses.hov.acc, t)) ses.hov = null;
    if (ah && !ses.hov && !ma.endOfLine && this.linkUp(ah.next, t) && Math.abs(ma.eoa - this.u(ah.border.s_m, d)) < 1.5) {
      const m = this.nrbc(ah.next, t, { NID_NRBCMESSAGE: 201, NID_ENGINE: eng, NID_BG: ah.border.NID_BG, M_ACK: 1, M_MODE: ses.report?.mode ?? 0, Q_DIR: d > 0 ? 1 : 0 });
      ses.hov = { border: ah.border, acc: ah.next, t201: m.T_RBC, acked: false, announced: false, rri: null, tor: false };
    }
    const h = ses.hov;
    if (!h) return { msgs, silent: false };
    if (h.tor) {
      if (!ses.terminateSent && this.past(this.rear(e), h.border, d)) { msgs.push(this.terminateOrder(ses, t)); ses.terminateSent = true; }
      return { msgs, silent: true };
    }
    if (!h.announced && this.past(x, h.border, d)) {
      this.nrbc(h.acc, t, { NID_NRBCMESSAGE: 203, NID_ENGINE: eng, NID_BG: h.border.NID_BG, M_ACK: 0 });
      h.announced = true;
    }
    const bu = this.u(h.border.s_m, d);
    // past the border with the front end the train is no longer on this RBC's routes: the authority is that of the RRI
    // (an RRI that does not go beyond the border adds nothing: the authority of this RBC keeps its own danger point)
    if (h.rri && ((Math.abs(ma.eoa - bu) < 1.5 && h.rri.eoa > bu + 1) || h.announced)) Object.assign(ma, { eoa: h.rri.eoa, svl: h.rri.svl, endOfLine: h.rri.endOfLine, reason: 'route related information of RBC ' + h.acc, beyond: h.rri });
    return { msgs, silent: false };
  }

  private cycleSession(ses: RbcSession, t: number, ixl: Interlocking, ixls: Interlocking[]): RadioMessage[] {
    const out: RadioMessage[] = [];
    if (!ses.report) { ses.ma = null; return out; }
    const x = this.position(ses.engine) as number;
    const T_TRAIN = Math.round(t * 100), to = ses.engine === 1 ? {} : { NID_ENGINE: ses.engine };
    const stop = this.stopped(ses.engine);
    if (stop && !ses.stopSent) { out.push({ NID_MESSAGE: 16, T_TRAIN, M_ACK: 1, NID_LRBG: ses.report.lrbg, NID_EM: ses.nidEm++, ...to }); ses.stopSent = true; }
    const cor = this.corridors.get(ses.engine);
    const ma = cor ? this.computeMaCorridor(x, ixls, ses, cor) : this.computeMa(x, ixl, ses);
    ses.ma = ma;
    // while the stop is in force no new authority: the onboard stays in trip until the control centre revokes it
    if (stop) { ses.ma = { ...ma, reason: 'emergency stop from the control centre' }; ses.lastKey = ''; return out; }
    if (this.area) {
      const h = this.handover(ses, t, x, ma);
      out.push(...h.msgs);
      if (h.silent) return out;
    }
    const tsrKeys = [...this.tsr.entries()].map(([k, z]) => k + ':' + z.from_m + ':' + z.to_m + ':' + z.v_kmh);
    const key = [Math.round(ma.eoa), Math.round(ma.svl), ses.report.lrbg, ma.speeds.join(';'), tsrKeys.join('|')].join('/') + (ses.hov ? '/H' + ses.hov.acc : '');
    if (key === ses.lastKey && t - ses.lastSent < this.cfg.parameters.ma_renewal_s) return out;
    ses.lastKey = key; ses.lastSent = t;
    out.push({ ...this.message3(T_TRAIN, ma, ses), ...to });
    return out;
  }

  private message3(T_TRAIN: number, ma: TracksideMa, ses: RbcSession): RadioMessage {
    const rep = ses.report as NonNullable<RbcSession['report']>;
    const cfg = this.cfg, d = ses.dir, U = (v: number) => this.u(v, d), Q_DIR = d > 0 ? 1 : 0;
    const cor = this.corridors.get(ses.engine);
    let len = cfg.line.length_m, p0: number, limits: [number, number, number][], gradients: [number, number, number][], balises: { NID_BG: number; s_m: number }[];
    let tsr: Map<string, { from_m: number; to_m: number; v_kmh: number }>;
    if (cor) {
      // a corridor: its own limits, gradients and balise groups; the restrictions of the main line moved onto it
      len = cor.length_m; p0 = this.bgPos(rep.lrbg, ses.engine) as number;
      limits = cor.limits; gradients = cor.gradients; balises = cor.balises;
      tsr = new Map();
      const main = cfg.network?.main ?? 'main';
      for (const [k, z] of this.tsr) for (const g of cor.legs) {
        if (g.line !== main) continue;
        const [x, y] = g.dir > 0 ? [z.from_m, z.to_m] : [cfg.line.length_m - z.to_m, cfg.line.length_m - z.from_m];
        const a = Math.max(g.c0_m + (x - g.d0_m), g.from_m ?? -Infinity), b = Math.min(g.c0_m + (y - g.d0_m), g.to_m ?? Infinity);
        if (b > a) tsr.set(k, { from_m: a, to_m: b, v_kmh: z.v_kmh });
      }
    } else {
      p0 = U(this.bgPos(rep.lrbg) as number);
      // the line as the train sees it: limits, gradients (with the opposite sign), balise groups, restrictions
      const flip = <T extends [number, number, number]>(l: T[], sign = 1) => (d > 0 ? l : l.map(([a, b, v]) => [len - b, len - a, sign * v] as T).reverse());
      limits = flip(cfg.line.limits); gradients = flip(cfg.line.gradients, -1);
      balises = d > 0 ? cfg.balises : cfg.balises.map(b => ({ NID_BG: b.NID_BG, s_m: U(b.s_m) })).sort((a, b) => a.s_m - b.s_m);
      tsr = new Map([...this.tsr].map(([k, z]) => [k, d > 0 ? z : { ...z, from_m: len - z.to_m, to_m: len - z.from_m }]));
    }
    // beyond the border only what the Accepting RBC sent (§3.15.1.2.4)
    const beyond = ma.beyond;
    if (beyond) {
      const clip = (l: [number, number, number][]) => l.filter(([a]) => a < beyond.from).map(([a, b, v]) => [a, Math.min(b, beyond.from), v] as [number, number, number]);
      limits = [...clip(limits), ...beyond.ssp];
      gradients = [...clip(gradients), ...beyond.grad];
    }
    const end = Math.min(len, Math.max(ma.svl, ma.eoa) + 300);
    const pk: EtcsPacket[] = [];
    // distances rounded down: the transmitted end of authority must never lie beyond the interlocking one
    pk.push({
      NID_PACKET: 15, Q_DIR, Q_SCALE: 1, V_LOA: 0, T_LOA: 1023, N_ITER: 0,
      L_ENDSECTION: Math.max(0, Math.floor(ma.eoa - p0 + 1e-6)), Q_SECTIONTIMER: 0, Q_ENDTIMER: 0,
      Q_DANGERPOINT: ma.endOfLine ? 0 : 1, D_DP: ma.endOfLine ? 0 : Math.floor(ma.svl - ma.eoa + 1e-6), V_RELEASEDP: ma.endOfLine ? 0 : Math.floor(cfg.parameters.release_kmh / 5), Q_OVERLAP: 0,
    });
    // static profile: line limits with the speeds of the routes (diverging speed) laid over them
    const lim = mergeLim(limits, ma.speeds);
    const ssp: Record<string, number>[] = [];
    let prev = p0;
    for (const [a, b, v] of lim) {
      if (b <= p0 || a >= end) continue;
      const from = Math.max(a, p0);
      ssp.push({ D_STATIC: Math.round(from - prev), V_STATIC: Math.floor(v / 5), Q_FRONT: 0 });
      prev = Math.round(from - prev) + prev;
    }
    ssp.push({ D_STATIC: Math.round(end - prev), V_STATIC: 127, Q_FRONT: 0 });
    pk.push({ NID_PACKET: 27, Q_DIR, Q_SCALE: 1, ...ssp[0], N_ITER: ssp.length - 1, elements: ssp.slice(1) });
    const gr: Record<string, number>[] = [];
    prev = p0;
    for (const [a, b, i] of gradients) {
      if (b <= p0 || a >= end) continue;
      const from = Math.max(a, p0), up = i >= 0;
      gr.push({ D_GRADIENT: Math.round(from - prev), Q_GDIR: up ? 1 : 0, G_A: up ? Math.floor(i) : Math.ceil(-i) });
      prev = Math.round(from - prev) + prev;
    }
    gr.push({ D_GRADIENT: Math.round(end - prev), Q_GDIR: 0, G_A: 255 });
    pk.push({ NID_PACKET: 21, Q_DIR, Q_SCALE: 1, ...gr[0], N_ITER: gr.length - 1, elements: gr.slice(1) });
    const links: Record<string, number>[] = [];
    prev = p0;
    for (const b of balises) {
      if (b.s_m <= p0 || b.s_m > end) continue;
      links.push({ D_LINK: Math.round(b.s_m - prev), Q_NEWCOUNTRY: 0, NID_BG: b.NID_BG, Q_LINKORIENTATION: Q_DIR, Q_LINKREACTION: 2, Q_LOCACC: 1 });
      prev = Math.round(b.s_m - prev) + prev;
    }
    if (links.length) pk.push({ NID_PACKET: 5, Q_DIR, Q_SCALE: 1, ...links[0], N_ITER: links.length - 1, elements: links.slice(1) });
    // several RBCs: the RBC transition order while the train is being handed over (packet 131)
    if (ses.hov && !ses.hov.tor && this.area) pk.push({ NID_PACKET: 131, Q_DIR, Q_SCALE: 1, D_RBCTR: Math.max(0, Math.round(U(ses.hov.border.s_m) - p0)), NID_C, NID_RBC: ses.hov.acc, NID_RADIO: 0, Q_SLEEPSESSION: 0 });
    const keys = new Set(tsr.keys());
    for (const [k, id] of [...ses.tsrSent]) if (!keys.has(k)) { pk.push({ NID_PACKET: 66, Q_DIR, NID_TSR: id }); ses.tsrSent.delete(k); }
    for (const [k, z] of tsr) {
      let id = ses.tsrSent.get(k);
      if (id == null) { id = ses.nextTsr++; ses.tsrSent.set(k, id); }
      if (z.to_m <= p0) continue;
      const from = Math.max(z.from_m, p0);
      pk.push({ NID_PACKET: 65, Q_DIR, Q_SCALE: 1, NID_TSR: id, D_TSR: Math.round(from - p0), L_TSR: Math.round(z.to_m - from), Q_FRONT: 0, V_TSR: Math.floor(z.v_kmh / 5) });
    }
    return { NID_MESSAGE: 3, T_TRAIN, M_ACK: 0, NID_LRBG: rep.lrbg, packets: pk };
  }
}

/** Lays restrictions [from, to, km/h] over contiguous limits, keeping the lowest */
export function mergeLim(base: [number, number, number][], extra: [number, number, number][]): [number, number, number][] {
  if (!extra.length) return base;
  const pts = new Set<number>();
  for (const [a, b] of [...base, ...extra]) { pts.add(a); pts.add(b); }
  const xs = [...pts].sort((p, q) => p - q), out: [number, number, number][] = [];
  for (let i = 0; i + 1 < xs.length; i++) {
    const m = (xs[i] + xs[i + 1]) / 2;
    let v = Infinity;
    for (const [a, b, l] of [...base, ...extra]) if (m >= a && m < b) v = Math.min(v, l);
    if (!isFinite(v)) continue;
    const last = out[out.length - 1];
    if (last && last[2] === v && Math.abs(last[1] - xs[i]) < 1e-6) last[1] = xs[i + 1]; else out.push([xs[i], xs[i + 1], v]);
  }
  return out;
}

export { NID_C };
