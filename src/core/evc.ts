/**
 * Reference ETCS onboard: an onboard computer (EVC) that knows the world only through the external onboard
 * protocol, as a real EVC connected to YuTreno would. It reads balises, locates itself on the last relevant
 * balise group (LRBG), receives from the RBC the movement authority, static speed profile, gradients and
 * temporary speed restrictions referred to the LRBG, and derives the supervision curves following the approach
 * of Subset-026 §3.13: emergency (EBD) and service (SBD) braking curves integrated over the gradient, and from
 * them the emergency brake intervention (EBI), service brake intervention (SBI), warning (W), permitted (P) and
 * indication (I) curves, plus ceiling speed supervision with the national speed margins.
 *
 * It is deliberately partial: decelerations constant with speed, no correction for the estimated acceleration,
 * odometry error modelled only as a confidence interval, modes FS, SB, TR and PT. Missing among others are
 * on sight, staff responsible, level transitions, conditional messages and driver acknowledgements. It does not
 * depend on the engine: it can run inside YuTreno, in an external process or as a comparison.
 */
import { toEnglish } from './legacy';
import type {
  EtcsPacket, OnboardDmi, OnboardNationalValues, OnboardRequest, OnboardResponse, OnboardTrainData, RadioMessage, SupervisionStatus,
} from './types';

const G = 9.81;
const KMH = 1 / 3.6;

/** Default national values (the speed margins are the fixed values of Subset-026 §A.3.1) */
export const DEFAULT_NATIONAL: OnboardNationalValues = {
  T_NVCONTACT: 20, M_NVCONTACT: 1,
  dV_ebi_min: 7.5, dV_ebi_max: 15, V_ebi_min: 110, V_ebi_max: 210,
  dV_sbi_min: 5.5, dV_sbi_max: 10, V_sbi_min: 110, V_sbi_max: 210,
  dV_warning_min: 4, dV_warning_max: 5, V_warning_min: 110, V_warning_max: 140,
  T_driver: 4, T_warning: 2,
  odo_error_fixed_m: 2, odo_error_relative: 0.01,
};

/** Subset-026 M_MODE codes of the modes used here */
const M_MODE: Record<string, number> = { FS: 0, SR: 2, SB: 6, TR: 7, PT: 8 };

type Seg = [number, number, number];

/** Ceiling supervision speed margin (m/s) from values in km/h, interpolated between the two ends */
function margin(vKmh: number, dMin: number, dMax: number, vMin: number, vMax: number): number {
  if (vKmh <= vMin) return dMin * KMH;
  if (vKmh >= vMax) return dMax * KMH;
  return (dMin + (dMax - dMin) * (vKmh - vMin) / (vMax - vMin)) * KMH;
}

/**
 * MRSP changes ahead of the head, as ATO sees them (Subset-130, N_LOC_MRSP and V_MRSP).
 * `segs` are stretches [from, to, km/h]; a stretch constrains the head at x if to > x − behind and from ≤ x + ahead
 * (behind = train length plus uncertainty, ahead = the uncertainty). Returns [position, m/s].
 */
export function mrspChanges(segs: [number, number, number][], from: number, to: number, behind: number, ahead: number): [number, number][] {
  const at = (x: number): number | null => {
    let v = Infinity, known = false;
    for (const s of segs) if (s[1] > x - behind && s[0] <= x + ahead) { v = Math.min(v, s[2]); known = true; }
    return known ? v : null;
  };
  const cand = new Set<number>();
  for (const s of segs) { cand.add(s[0] - ahead); cand.add(s[1] + behind); }
  const xs = [...cand].filter(x => x > from && x <= to).sort((p, q) => p - q);
  const out: [number, number][] = [];
  let prev = at(from);
  for (const x of xs) {
    const v = at(x + 1e-6);
    if (v == null) break;
    if (v !== prev) { out.push([x, v * KMH]); prev = v; }
  }
  return out;
}

/** Elements in order (first set of the packet + iterations) */
const elements = (p: EtcsPacket): Record<string, number>[] => [p as unknown as Record<string, number>, ...((p.elements as Record<string, number>[]) || [])];

export class ReferenceEvc {
  private T!: OnboardTrainData;
  private N: OnboardNationalValues = DEFAULT_NATIONAL;
  private t = 0;
  private odo = 0;
  private v = 0;
  private a = 0;
  /** Odometer reading at the passage of each balise group, by NID_LRBG */
  private bgOdo = new Map<number, number>();
  /** Orientation of the train with respect to each group read (1 nominal, 0 reverse) */
  private bgDir = new Map<number, 0 | 1>();
  /** Last relevant balise group, with the orientation of the train with respect to it (1 nominal, 0 reverse) */
  private lrbg: { nid: number; odo: number; dir: 0 | 1 } | null = null;
  /** Last balise with N_PIG = 1 read, to recognise a group passed against its nominal direction */
  private lastPig1: { nid: number; odo: number } | null = null;
  private ma: { eoa: number; svl: number; vRel: number; endOfLine: boolean } | null = null;
  private ssp: Seg[] = [];
  private grad: Seg[] = [];
  private tsr = new Map<number, Seg>();
  mode: 'SB' | 'FS' | 'TR' | 'PT' = 'SB';
  private eb = false;
  private ebWhy = '';
  private sb = false;
  private lastRbc = 0;
  private lastReport = -1e9;
  private reportPending = true;
  private contactLost = false;
  private readonly outbox: RadioMessage[] = [];
  /**
   * RBC/RBC handover (Subset-026 §3.15.1.3), with two radio terminals: the supervising RBC (null while no message has
   * carried NID_RBC: a trackside with a single RBC, as before), the Accepting RBC of an ongoing handover with the
   * border as odometer reading and its messages stored until the switch, and after the switch the session with the
   * Handing Over RBC that is still open
   */
  private sup: number | null = null;
  private hand: { acc: number; border: number; open: boolean; frontSent: boolean; stored: RadioMessage[] } | null = null;
  private old: { nid: number; border: number; rearT: number | null; reps: number } | null = null;
  /** Train integrity from the external source (§3.6.5.2): reported as confirmed (Q_INTEGRITY 1) unless lost */
  private integrityLost = false;
  /** Period of the position reports (s): 6 unless the RBC asks otherwise with packet 58 (T_CYCLOC) */
  private cycloc = 6;

  /** One onboard cycle: reads inputs, updates location and trackside data, supervises, responds */
  step(req: OnboardRequest): OnboardResponse {
    req = toEnglish<OnboardRequest>(req);
    if (req.start) this.reset(req);
    this.t = req.t; this.odo = req.odometry.distance_m; this.v = Math.max(0, req.odometry.speed_ms); this.a = req.odometry.acceleration_ms2 || 0;
    const prevMode = this.mode;
    for (const b of req.balises) this.readBalise(b.odometer_m, b.telegram.NID_C, b.telegram.NID_BG, b.telegram.N_PIG);
    for (const m of req.radio) this.readRadio(m);
    // a loss of train integrity detected triggers a position report (§3.6.5.1.4 d)
    const lost = req.train.integrity === 'lost';
    if (lost && !this.integrityLost) this.reportPending = true;
    this.integrityLost = lost;
    const sup = this.supervise();
    if (this.mode !== prevMode) this.reportPending = true;
    this.handoverStep();
    if (this.reportPending || this.t - this.lastReport >= this.cycloc) this.positionReport();
    const r: OnboardResponse = {
      outputs: { service_brake: this.sb, emergency: this.eb, traction_cut_off: this.eb || this.sb || this.mode === 'SB' || this.mode === 'PT' },
      radio: this.outbox.splice(0),
      dmi: sup,
    };
    if (this.eb) r.emergency_reason = this.ebWhy;
    if (this.lrbg) {
      const d = this.odo - this.lrbg.odo;
      r.position = { NID_LRBG: this.lrbg.nid, D_LRBG: d, L_DOUBTOVER: this.doubt(), L_DOUBTUNDER: this.doubt() };
    }
    return r;
  }

  private reset(req: OnboardRequest): void {
    if (!req.train_data) throw new Error('the first request to the onboard must contain train_data');
    this.T = req.train_data;
    this.N = { ...DEFAULT_NATIONAL, ...(req.national_values || {}) };
    this.bgOdo.clear(); this.bgDir.clear(); this.tsr.clear(); this.ssp = []; this.grad = []; this.ma = null;
    this.lrbg = null; this.mode = 'SB'; this.eb = false; this.sb = false; this.ebWhy = '';
    this.lastRbc = req.t; this.lastReport = -1e9; this.reportPending = true; this.contactLost = false;
    this.outbox.length = 0;
    this.sup = null; this.hand = null; this.old = null; this.cycloc = 6;
    const p = req.stored_position;
    if (p) { const o = req.odometry.distance_m - p.D_LRBG; this.bgOdo.set(p.NID_LRBG, o); this.lrbg = { nid: p.NID_LRBG, odo: o, dir: p.Q_DIRLRBG === 0 ? 0 : 1 }; this.bgDir.set(p.NID_LRBG, this.lrbg.dir); }
    this.lastPig1 = null;
  }

  /** Location uncertainty (m): fixed part plus a share of the distance from the LRBG */
  private doubt(): number {
    return this.lrbg ? this.N.odo_error_fixed_m + this.N.odo_error_relative * Math.max(0, this.odo - this.lrbg.odo) : 0;
  }

  private readBalise(odo: number, nidC: number, nidBg: number, nPig: number): void {
    const nid = nidC * 16384 + nidBg;
    if (nPig !== 0) { if (nPig === 1) this.lastPig1 = { nid, odo }; return; }  // the group is referred to its balise N_PIG = 0
    // a group whose balise N_PIG = 1 came first has been passed against its nominal direction (Subset-026 §3.4.2)
    const dir: 0 | 1 = this.lastPig1 && this.lastPig1.nid === nid && odo > this.lastPig1.odo && odo - this.lastPig1.odo < 20 ? 0 : 1;
    this.lastPig1 = null;
    this.bgOdo.set(nid, odo);
    this.bgDir.set(nid, dir);
    this.lrbg = { nid, odo, dir };
    this.reportPending = true;
  }

  /** Order to terminate a session (packet 42 with Q_RBC = 0) in a message */
  private static terminates(m: RadioMessage): boolean {
    return (m.packets || []).some(p => p.NID_PACKET === 42 && Number(p.Q_RBC) === 0);
  }

  /** Termination of the session with an RBC (message 156, §3.5.5.2) */
  private terminate(nid: number): void {
    this.outbox.push({ NID_MESSAGE: 156, T_TRAIN: Math.round(this.t * 100), NID_ENGINE: this.T.NID_ENGINE, NID_RBC: nid });
  }

  /**
   * Handover, at every cycle: once the max safe front end has passed the border a position report goes to both RBCs,
   * and the switch to the Accepting RBC follows that report (§3.15.1.3.1 b, 3.15.1.3.5); once the min safe rear end has
   * passed it a report goes to the Handing Over RBC, repeated without an order to terminate (§3.15.1.3.1 c, 3.15.1.3.9)
   */
  private handoverStep(): void {
    const d = this.doubt();
    if (this.hand && !this.hand.frontSent && this.odo + d >= this.hand.border) { this.hand.frontSent = true; this.reportPending = true; }
    const o = this.old;
    if (o) {
      const rear = this.odo - d - this.T.L_TRAIN;
      if (o.rearT == null && rear >= o.border) { o.rearT = this.t; this.reportPending = true; }
      else if (o.rearT != null && this.t - o.rearT >= 15) {
        // fixed waiting time 15 s and three repetitions (Appendix A.3.1), then the onboard terminates the session itself
        if (o.reps < 3) { o.reps++; o.rearT = this.t; this.reportPending = true; } else { this.terminate(o.nid); this.old = null; }
      }
    }
  }

  private readRadio(m: RadioMessage): void {
    const from = typeof m.NID_RBC === 'number' ? m.NID_RBC : null;
    if (from != null) {
      if (this.sup == null && !this.hand) this.sup = from;
      // the Accepting RBC before the switch: the session is open, its information stored (§3.15.1.3.6)
      if (this.hand && from === this.hand.acc && from !== this.sup) {
        // opened with the front end already past the border: the report that makes the switch goes out at once
        if (!this.hand.open && this.hand.frontSent) this.reportPending = true;
        this.hand.open = true;
        if (ReferenceEvc.terminates(m)) { this.terminate(from); this.hand = null; }
        else this.hand.stored.push(m);
        return;
      }
      // the Handing Over RBC after the switch: only the order to terminate the session (§3.15.1.3.5)
      if (this.old && from === this.old.nid) {
        if (ReferenceEvc.terminates(m)) { this.terminate(from); this.old = null; }
        return;
      }
      if (this.sup != null && from !== this.sup) return;
      if (m.NID_MESSAGE === 39) return;
    }
    this.lastRbc = this.t;
    if (this.contactLost) this.contactLost = false;
    if (m.NID_MESSAGE === 16) {
      this.trip('emergency_stop');
      return;
    }
    if (m.NID_MESSAGE !== 3 && m.NID_MESSAGE !== 33) return;
    const base = this.bgOdo.get(Number(m.NID_LRBG));
    if (base == null) return;  // referred to an unknown balise group: discarded
    // only the packets for the direction the train runs with respect to the LRBG (Q_DIR = 2: both)
    const dir = this.bgDir.get(Number(m.NID_LRBG)) ?? 1;
    const pk = (m.packets || []).filter(p => p.Q_DIR == null || Number(p.Q_DIR) === 2 || Number(p.Q_DIR) === dir);
    const p15 = pk.find(p => p.NID_PACKET === 15);
    if (p15) {
      let x = base;
      for (const s of (p15.sections as Record<string, number>[]) || []) x += s.L_SECTION;
      const eoa = x + Number(p15.L_ENDSECTION);
      const dp = Number(p15.Q_DANGERPOINT) === 1;
      const vr = Number(p15.V_RELEASEDP);
      this.ma = { eoa, svl: dp ? eoa + Number(p15.D_DP) : eoa, vRel: !dp ? 0 : (vr === 127 ? 15 : vr * 5) * KMH, endOfLine: !dp };
      if (this.mode === 'SB' || (this.mode === 'PT' && this.v < 0.01)) this.mode = 'FS';
    }
    const p27 = pk.find(p => p.NID_PACKET === 27);
    if (p27) {
      const out: Seg[] = [];
      let x = base;
      const el = elements(p27);
      for (let i = 0; i < el.length; i++) {
        x += el[i].D_STATIC;
        if (el[i].V_STATIC === 127) break;
        const next = i + 1 < el.length ? x + el[i + 1].D_STATIC : x;
        out.push([x, next, el[i].V_STATIC * 5]);
      }
      this.ssp = out;
    }
    const p21 = pk.find(p => p.NID_PACKET === 21);
    if (p21) {
      const out: Seg[] = [];
      let x = base;
      const el = elements(p21);
      for (let i = 0; i < el.length; i++) {
        x += el[i].D_GRADIENT;
        if (el[i].G_A === 255) break;
        const next = i + 1 < el.length ? x + el[i + 1].D_GRADIENT : x;
        out.push([x, next, el[i].Q_GDIR === 1 ? el[i].G_A : -el[i].G_A]);
      }
      this.grad = out;
    }
    for (const p of pk) {
      if (p.NID_PACKET === 66) this.tsr.delete(Number(p.NID_TSR));
      if (p.NID_PACKET === 65) { const a = base + Number(p.D_TSR); this.tsr.set(Number(p.NID_TSR), [a, a + Number(p.L_TSR), Number(p.V_TSR) * 5]); }
    }
    // RBC transition order (packet 131): open the session with the Accepting RBC at once; a new order replaces the
    // previous one (§3.15.1.3.1 a, 3.15.1.3.2.2)
    const p58 = pk.find(p => p.NID_PACKET === 58);
    if (p58 && typeof p58.T_CYCLOC === 'number' && p58.T_CYCLOC > 0 && p58.T_CYCLOC < 255) this.cycloc = p58.T_CYCLOC;
    const p131 = pk.find(p => p.NID_PACKET === 131);
    if (p131 && this.sup != null && Number(p131.NID_RBC) !== this.sup && (!this.hand || this.hand.acc !== Number(p131.NID_RBC))) {
      this.hand = { acc: Number(p131.NID_RBC), border: base + Number(p131.D_RBCTR), open: false, frontSent: false, stored: [] };
      this.reportPending = true;
    }
  }

  private trip(why: string): void {
    if (this.mode === 'TR' && this.eb) return;
    this.mode = 'TR'; this.eb = true; this.ebWhy = why;
  }

  private positionReport(): void {
    if (!this.lrbg) return;
    const d = this.doubt();
    const n0 = this.outbox.length;
    this.outbox.push({
      NID_MESSAGE: 136, T_TRAIN: Math.round(this.t * 100), NID_ENGINE: this.T.NID_ENGINE,
      packets: [{
        NID_PACKET: 0, Q_SCALE: 1, NID_LRBG: this.lrbg.nid, D_LRBG: Math.round(this.odo - this.lrbg.odo), Q_DIRLRBG: this.lrbg.dir, Q_DLRBG: this.lrbg.dir,
        // the integrity is confirmed by an external source before every report, so the train was last known to be
        // integer now and the confirmed length runs from the min safe rear end to the estimated front end (§3.6.5.2.4);
        // with integrity lost it is reported in every report, without a length (§3.6.5.2.9, §7.4.3.1)
        L_DOUBTOVER: Math.round(d), L_DOUBTUNDER: Math.round(d),
        ...(this.integrityLost ? { Q_INTEGRITY: 3 } : { Q_INTEGRITY: 1, L_TRAININT: Math.round(this.T.L_TRAIN + d) }),
        V_TRAIN: Math.floor(this.v * 3.6 / 5), Q_DIRTRAIN: this.lrbg.dir, M_MODE: M_MODE[this.mode], M_LEVEL: 3,
      }],
    });
    this.lastReport = this.t; this.reportPending = false;
    if (this.sup == null) return;
    // several RBCs: the report goes to the supervising RBC and, while two sessions are open, to the other one too
    // (§3.15.1.3.4); the switch follows the report that tells the Accepting RBC the front end has passed the border
    const rep = this.outbox.splice(n0, 1)[0];
    this.outbox.push({ ...rep, NID_RBC: this.sup });
    const h = this.hand;
    if (h) {
      this.outbox.push({ ...rep, NID_RBC: h.acc });
      if (h.open && this.odo + d >= h.border) {
        this.old = { nid: this.sup, border: h.border, rearT: null, reps: 0 };
        this.sup = h.acc; this.hand = null;
        for (const m of h.stored) this.readRadio(m);
      }
    } else if (this.old) this.outbox.push({ ...rep, NID_RBC: this.old.nid });
  }

  /** Gradient (‰) at position x from the received profile; outside the profile the known worst case, 0, is assumed */
  private gradeAt(x: number): number {
    for (const g of this.grad) if (x >= g[0] && x < g[1]) return g[2];
    return 0;
  }

  /**
   * Position where the braking curve towards (xt, vt) with deceleration a equals v: the curve is followed back
   * from the target stretch by stretch, with constant deceleration on each gradient stretch.
   * Every supervision limit is computed from it (see `solve`).
   */
  private ebdBack(xt: number, vt: number, v: number, a: number): number {
    if (v <= vt) return xt;
    const k = G / (1000 + 10 * this.T.M_rotating);
    let need = (v * v - vt * vt) / 2, x = xt;
    const down = this.breaksBefore(xt);
    for (const b of [...down, -Infinity]) {
      if (b >= x) continue;
      const A = Math.max(0.05, a + k * this.gradeAt(isFinite(b) ? (b + x) / 2 : x - 0.5));
      const cap = A * (x - b);
      if (cap >= need) return x - need / A;
      need -= cap; x = b;
    }
    return x;
  }

  /**
   * Ends of the gradient stretches before xt, from the nearest backwards. `solve` asks for the same target forty
   * times in a row, so the last list is kept while the profile (replaced, never changed in place) and xt are the same.
   */
  private breaksBefore(xt: number): number[] {
    const c = this.breaks;
    if (c.grad === this.grad && c.xt === xt) return c.down;
    const pts = new Set<number>();
    for (const g of this.grad) { if (g[0] < xt) pts.add(g[0]); if (g[1] < xt) pts.add(g[1]); }
    const down = [...pts].sort((p, q) => q - p);
    this.breaks = { grad: this.grad, xt, down };
    return down;
  }
  private breaks: { grad: Seg[] | null; xt: number; down: number[] } = { grad: null, xt: NaN, down: [] };

  /**
   * For curve validation: position (odometer reading) where the emergency (EBD) or service (SBD) braking curve towards
   * the target (xt, vt) equals v, with the received gradient profile and the train data of the mission.
   */
  brakingCurvePoint(type: 'EBD' | 'SBD', xt: number, vt: number, v: number): number {
    return this.ebdBack(xt, vt, v, type === 'EBD' ? this.T.A_brake_emergency : this.T.A_brake_service);
  }

  /**
   * Speed of the limit that leaves the braking curve towards (xt, vt) T seconds earlier: the largest v whose limit
   * location d(v) = d_curve(v) − v·T is not behind x. Below vt the curve location is the target itself, so close to
   * the target the limit falls along xt − v·T instead of staying at vt (§3.13.9.3).
   */
  private solve(x: number, T: number, xt: number, vt: number, a: number): number {
    let lo = 0, hi = 200;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      if (this.ebdBack(xt, vt, mid, a) - mid * T >= x) lo = mid; else hi = mid;
    }
    return lo;
  }

  /** Most restrictive speed profile (static, temporary, train) as segments [from, to, km/h] */
  private mrspSegments(): Seg[] {
    const pts = new Set<number>();
    const all = [...this.ssp, ...this.tsr.values()];
    for (const s of all) { pts.add(s[0]); pts.add(s[1]); }
    const xs = [...pts].sort((p, q) => p - q), out: Seg[] = [];
    for (let i = 0; i + 1 < xs.length; i++) {
      const mid = (xs[i] + xs[i + 1]) / 2;
      let v = this.T.V_MAXTRAIN;
      let known = false;
      for (const s of this.ssp) if (mid >= s[0] && mid < s[1]) { v = Math.min(v, s[2]); known = true; }
      if (!known) continue;
      for (const s of this.tsr.values()) if (mid >= s[0] && mid < s[1]) v = Math.min(v, s[2]);
      out.push([xs[i], xs[i + 1], v]);
    }
    return out;
  }

  private supervise(): OnboardDmi {
    const N = this.N, T = this.T, v = this.v;
    const kV = (x: number) => x * 3.6;
    const dEbi = (vm: number) => margin(kV(vm), N.dV_ebi_min, N.dV_ebi_max, N.V_ebi_min, N.V_ebi_max);
    const dSbi = (vm: number) => margin(kV(vm), N.dV_sbi_min, N.dV_sbi_max, N.V_sbi_min, N.V_sbi_max);
    const dW = (vm: number) => margin(kV(vm), N.dV_warning_min, N.dV_warning_max, N.V_warning_min, N.V_warning_max);
    const doubt = this.doubt(), front = this.odo + doubt, minFront = this.odo - doubt;
    // T_indication = max(0.8·T_bs, 5 s) + T_driver (§3.13.9.3.6.2)
    const Tb = T.T_traction_cut_off + T.T_brake_emergency, Ts = T.T_brake_service, Tind = Math.max(0.8 * Ts, 5) + N.T_driver;

    // no authority: standstill, traction cut off
    if (!this.ma || this.mode === 'SB' || this.mode === 'PT' || this.mode === 'TR') {
      if (this.eb && v < 0.01) { this.eb = false; if (this.mode === 'TR') this.mode = 'PT'; }
      this.sb = false;
      const st: SupervisionStatus = this.eb ? 'INT' : 'NOR';
      return { mode: this.mode, state: st, v_mrsp_ms: 0, v_permitted_ms: 0, v_warning_ms: 0, v_sbi_ms: 0, v_intervention_ms: 0, v_release_ms: null, target: null };
    }

    // trip if the head, even at its rearmost possible position, has passed the end of authority
    if (!this.ma.endOfLine && minFront > this.ma.eoa) {
      this.trip('trip');
      return { mode: 'TR', state: 'INT', v_mrsp_ms: 0, v_permitted_ms: 0, v_warning_ms: 0, v_sbi_ms: 0, v_intervention_ms: 0, target: null, text: 'End of authority passed' };
    }

    // ceiling supervision on the profile under the whole train
    const segs = this.mrspSegments();
    let mrspK = T.V_MAXTRAIN;
    for (const s of segs) if (s[1] > minFront - T.L_TRAIN && s[0] <= front) mrspK = Math.min(mrspK, s[2]);
    const mrsp = mrspK * KMH;
    let vP = mrsp, vW = mrsp + dW(mrsp), vS = mrsp + dSbi(mrsp), vE = mrsp + dEbi(mrsp), vI = Infinity;
    let tgt: { distance_m: number; speed_ms: number; type: string } | null = null;
    const Ae = T.A_brake_emergency, As = T.A_brake_service;
    // position of the head (worst case, forward) at which the current speed would reach the EBI curve
    let ebiFront = v > mrsp + dEbi(mrsp) ? front : Infinity;

    // speed reduction targets ahead of the head
    for (const s of segs) {
      const vt = s[2] * KMH;
      if (s[0] <= front || vt >= mrsp - 1e-9 || s[0] > this.ma.svl) continue;
      if (v > vt + dEbi(vt)) ebiFront = Math.min(ebiFront, this.ebdBack(s[0], vt + dEbi(vt), v, Ae) - v * Tb);
      // every limit of an MRSP target comes from its EBD towards V_target + dV_ebi (§3.13.8.3): EBI after T_be,
      // SBI2 = EBI − V·T_bs, W = SBI − V·T_warning, P = SBI − V·T_driver, I = P − V·T_indication (§3.13.9.3);
      // none goes below the ceiling limits of the target, which take over once the target speed is reached
      const vtE = vt + dEbi(vt);
      const e = Math.max(vtE, this.solve(front, Tb, s[0], vtE, Ae));
      const sb = Math.max(vt + dSbi(vt), this.solve(front, Tb + Ts, s[0], vtE, Ae));
      const w = Math.max(vt + dW(vt), this.solve(front, Tb + Ts + N.T_warning, s[0], vtE, Ae));
      const p = Math.max(vt, this.solve(front, Tb + Ts + N.T_driver, s[0], vtE, Ae));
      const i = Math.max(vt, this.solve(front, Tb + Ts + N.T_driver + Tind, s[0], vtE, Ae));
      if (p < vP) { vP = p; tgt = { distance_m: s[0] - front, speed_ms: vt, type: 'limit ' + s[2] + ' km/h' }; }
      vW = Math.min(vW, w); vS = Math.min(vS, sb); vE = Math.min(vE, e); vI = Math.min(vI, i);
    }

    // end of authority (service brake) and supervised location (emergency brake)
    const { eoa, svl, vRel } = this.ma;
    if (!this.ma.endOfLine || eoa - front < 8000) {
      if (v > vRel) ebiFront = Math.min(ebiFront, this.ebdBack(svl, 0, v, Ae) - v * Tb);
      const e = Math.max(vRel, this.solve(front, Tb, svl, 0, Ae));
      const sb = Math.max(vRel, Math.min(this.solve(front, Ts, eoa, 0, As), this.solve(front, Tb + Ts, svl, 0, Ae)));
      const w = Math.max(vRel, Math.min(this.solve(front, Ts + N.T_warning, eoa, 0, As), this.solve(front, Tb + Ts + N.T_warning, svl, 0, Ae)));
      const p = Math.max(vRel, Math.min(this.solve(front, Ts + N.T_driver, eoa, 0, As), this.solve(front, Tb + Ts + N.T_driver, svl, 0, Ae)));
      const i = Math.max(vRel, Math.min(this.solve(front, Ts + N.T_driver + Tind, eoa, 0, As), this.solve(front, Tb + Ts + N.T_driver + Tind, svl, 0, Ae)));
      if (p < vP) { vP = p; tgt = { distance_m: eoa - front, speed_ms: 0, type: this.ma.endOfLine ? 'end of the line' : 'end of authority' }; }
      vW = Math.min(vW, w); vS = Math.min(vS, sb); vE = Math.min(vE, e); vI = Math.min(vI, i);
    }
    vW = Math.max(vW, vP); vS = Math.max(vS, vW); vE = Math.max(vE, vS);

    // commands: emergency beyond intervention, service beyond SBI until back below the permitted speed
    if (!this.eb && v > vE) { this.eb = true; this.ebWhy = 'intervention'; }
    if (this.eb && v < 0.01 && this.ebWhy === 'intervention') { this.eb = false; this.ebWhy = ''; }
    if (!this.sb && v > vS) this.sb = true;
    if (this.sb && v <= vP) this.sb = false;
    // radio contact lost beyond T_NVCONTACT
    if (this.t - this.lastRbc > N.T_NVCONTACT && !this.contactLost) this.contactLost = true;
    if (this.contactLost) {
      if (N.M_NVCONTACT === 0) this.trip('radio_contact');
      else if (N.M_NVCONTACT === 1) this.sb = true;
    }
    const st: SupervisionStatus = this.eb ? 'INT' : this.sb ? 'SBI' : v > vW ? 'WAR' : v > vP ? 'OVS' : v > vI ? 'IND' : 'NOR';
    return {
      mode: this.mode, state: st, v_mrsp_ms: mrsp, v_permitted_ms: vP, v_warning_ms: vW, v_sbi_ms: vS, v_intervention_ms: vE,
      v_release_ms: this.ma.endOfLine ? null : vRel, target: tgt, indication: v > vI,
      text: this.contactLost ? 'No message from the RBC: service brake' : undefined,
      ato: this.atoData(segs, vP, mrsp, ebiFront, doubt),
    };
  }

  /** Data for ATO (Subset-130, packets 6 and 11) as odometer readings; only in FS */
  private atoData(segs: Seg[], vP: number, mrsp: number, ebiFront: number, doubt: number): OnboardDmi['ato'] {
    if (this.mode !== 'FS' || !this.ma) return null;
    const T = this.T, odo = this.odo, k = G / (1000 + 10 * T.M_rotating), far = Math.min(this.ma.svl, odo + 8000);
    const GRADIENT: [number, number][] = [];
    for (const g of this.grad) if (g[1] > odo && g[0] < far) GRADIENT.push([Math.max(g[0], odo), k * g[2]]);
    return {
      M_MODE: this.mode, V_EST: this.v, A_EST: this.a, V_PERMITTED: vP, V_MRSP: mrsp,
      MRSP: mrspChanges(segs, odo, far, T.L_TRAIN + doubt, doubt),
      N_LOC_EBI: isFinite(ebiFront) ? ebiFront - doubt : null,
      N_LOC_EOALOA: this.ma.eoa, V_EOALOA: 0, N_LOC_SVL: this.ma.svl, V_RELEASE_ATO: this.ma.endOfLine ? null : this.ma.vRel,
      A_BRAKE_SAFE: T.A_brake_emergency, GRADIENT,
      T_TRACTION: T.T_traction_cut_off, T_BE_REACT: T.T_brake_emergency,
      L_UNCERTAINTY_OVERREADING: doubt, L_UNCERTAINTY_UNDERREADING: doubt,
    };
  }
}
