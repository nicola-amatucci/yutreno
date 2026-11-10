/**
 * Simple message-based ETCS level 2 trackside: balise groups generated from the line and an RBC that talks to the
 * onboard with the messages and packets of Subset-026 (decoded values, units with Q_SCALE = 1 m).
 *
 * The RBC opens the session at the first position report of the onboard and from then on sends, referred to the
 * last reported balise group (LRBG): movement authority (packet 15), static speed profile (27), gradients (21),
 * balise linking (5) and temporary speed restrictions (65, revoked with 66), in message 3. It repeats it every
 * few seconds, so the onboard can supervise radio contact; the stop order is message 16. All packet positions are
 * distances from the LRBG in the nominal direction (Q_DIR = 1). The movement authority comes from the automatic
 * block of `signalling.ts`; `src/trackside/` replaces this RBC with an interlocking and an RBC built on routes.
 */
import { mirrorLine } from './line';
import type { BaliseTelegram, CompiledLine, EtcsPacket, MovementAuthority, RadioMessage } from './types';

/** Country or region identifier of all balises (NID_C) */
export const NID_C = 1;
/** Distance (m) between the two balises of a group */
export const BALISE_SPACING = 3;

export interface BaliseGroup {
  NID_BG: number;
  /** Chainage of the first balise of the group (group reference, m) */
  s: number;
  role: 'departure' | 'station' | 'marker' | 'line';
}

/** Combined group identifier (NID_LRBG = NID_C · 2^14 + NID_BG) */
export const nidLrbg = (nidBg: number, nidC = NID_C): number => nidC * 16384 + nidBg;

/**
 * Balise groups of the line: one under the train at departure (stored position), one before each stop, one before
 * each stop marker (the signals in ETCS level 2) and others along the line, no more than 1200 m apart. With
 * `reverseStarts` (chainages of the stations where trains start against the nominal direction) a group is added
 * just beyond each of them, so that those trains too have a stored position behind them.
 */
export function buildBaliseGroups(L: CompiledLine, reverseStarts: number[] = []): BaliseGroup[] {
  const raw: { s: number; role: BaliseGroup['role'] }[] = [];
  const s0 = L.st.length ? L.st[0].s : 50;
  raw.push({ s: Math.max(0, s0 - 15), role: 'departure' });
  for (const st of L.st.slice(1)) raw.push({ s: st.s - 40, role: 'station' });
  for (const sg of L.sig) raw.push({ s: sg.s - 20, role: 'marker' });
  raw.sort((a, b) => a.s - b.s);
  const kept: { s: number; role: BaliseGroup['role'] }[] = [];
  for (const r of raw) {
    if (r.s < 0 || r.s > L.len - BALISE_SPACING - 1) continue;
    const last = kept[kept.length - 1];
    if (last && r.s - last.s < 60) continue;
    kept.push(r);
  }
  const out: { s: number; role: BaliseGroup['role'] }[] = [];
  for (let i = 0; i < kept.length; i++) {
    out.push(kept[i]);
    const next = i + 1 < kept.length ? kept[i + 1].s : L.len - 50;
    const gap = next - kept[i].s, n = Math.floor(gap / 1200);
    for (let k = 1; k <= n; k++) out.push({ s: kept[i].s + gap * k / (n + 1), role: 'line' });
  }
  const groups = out.map((b, i) => ({ NID_BG: i + 1, s: Math.round(b.s * 10) / 10, role: b.role }));
  // a group behind each origin of the trains running against the nominal direction, numbered after the others
  for (const s of [...reverseStarts].sort((a, b) => a - b)) {
    const x = Math.round((s + 15) * 10) / 10;
    if (x + BALISE_SPACING < L.len) groups.push({ NID_BG: groups.length + 1, s: x, role: 'departure' });
  }
  return groups;
}

/** Telegram of a balise of the group: in level 2 it serves location only, so it carries just the header */
export function baliseTelegram(bg: BaliseGroup, nPig: number): BaliseTelegram {
  return {
    Q_UPDOWN: 1, M_VERSION: 33, Q_MEDIA: 0, N_PIG: nPig, N_TOTAL: 1, M_DUP: 0, M_MCOUNT: 255,
    NID_C, NID_BG: bg.NID_BG, Q_LINK: 1, packets: [{ NID_PACKET: 255 }],
  };
}

/** Position report received from the onboard (message 136, packet 0) */
interface Report {
  lrbg: number;
  d: number;
  t: number;
  mode: number;
  /** Orientation of the train with respect to the LRBG (Q_DIRLRBG): 1 nominal, 0 reverse */
  dir: 0 | 1;
  /** Train integrity in the report (Q_INTEGRITY, or Q_LENGTH of Baseline 3; 0 when missing) */
  integrity: number;
}

export interface RbcInputs {
  t: number;
  /** Movement authority, in the chainages of the train's direction of running */
  ma: MovementAuthority | null;
  /** Line limits without the temporary speed restrictions: [from, to, km/h], in the chainages of the train's direction */
  baseLim: [number, number, number][];
  /** Temporary speed restrictions in force: [from, to, km/h], in the chainages of the train's direction */
  tsr: [number, number, number][];
  /** Train the messages are for (NID_ENGINE); default 1, the controlled train */
  engine?: number;
  /** Moving block: the period of the position reports asked of the train (packet 58, T_CYCLOC, s) */
  tCycloc?: number;
}

/** State of the RBC for one train: the session is opened by its first position report */
export class RbcSession {
  report: Report | null = null;
  /**
   * Moving block: the confirmed min safe rear ends of the train (nominal chainages) with the time of the report that gave
   * each one, oldest first; a report without integrity confirmed adds none (Subset-026 §3.6.5.2.4)
   */
  rears: { t: number; s: number }[] = [];
  /** Unconditional emergency stop to send (message 16) */
  stopOrder = false;
  stopSent = false;
  lastKey = '';
  lastSent = -1e9;
  tsrSent = new Map<string, number>();
  nextTsr = 1;
  nidEm = 1;
  constructor(readonly engine: number) {}
}

/**
 * Message-based RBC with one session per train, identified by NID_ENGINE. Every session has its own LRBG, its own
 * orientation with respect to it and its own authority. A train running against the nominal direction of the balise
 * groups reports Q_DIRLRBG = 0: its packets carry Q_DIR = 0 and their distances are counted from the LRBG in the
 * direction of running, on the line seen from that direction.
 */
export class Rbc {
  readonly sessions = new Map<number, RbcSession>();
  /** Messages received from the onboards, for the log */
  readonly received: RadioMessage[] = [];
  private Lr: CompiledLine | null = null;

  constructor(readonly L: CompiledLine, readonly bgs: BaliseGroup[], readonly refresh = 5) {}

  /** Session of a train, created if missing */
  session(engine = 1): RbcSession {
    let s = this.sessions.get(engine);
    if (!s) { s = new RbcSession(engine); this.sessions.set(engine, s); }
    return s;
  }

  /** True when the session of the controlled train is open */
  get open(): boolean { return !!this.sessions.get(1)?.report; }
  /** Emergency stop order for the controlled train (message 16) */
  get stopOrder(): boolean { return this.session(1).stopOrder; }
  set stopOrder(v: boolean) { this.session(1).stopOrder = v; }

  private bgByNid(nid: number): BaliseGroup | undefined {
    const bg = nid % 16384;
    return this.bgs.find(b => b.NID_BG === bg);
  }

  /** Messages from an onboard: position reports (136, 132, 157) open its session and update its LRBG */
  receive(m: RadioMessage, t: number): void {
    this.received.push(m);
    if (m.NID_MESSAGE !== 136 && m.NID_MESSAGE !== 132 && m.NID_MESSAGE !== 157) return;
    const p0 = (m.packets || []).find(p => p.NID_PACKET === 0 || p.NID_PACKET === 1);
    if (!p0 || typeof p0.NID_LRBG !== 'number' || !this.bgByNid(p0.NID_LRBG)) return;
    const engine = typeof m.NID_ENGINE === 'number' ? m.NID_ENGINE : 1;
    const ses = this.session(engine), q = Number(p0.Q_INTEGRITY ?? p0.Q_LENGTH ?? 0);
    ses.report = { lrbg: p0.NID_LRBG, d: Number(p0.D_LRBG) || 0, t, mode: Number(p0.M_MODE), dir: Number(p0.Q_DIRLRBG ?? 1) === 0 ? 0 : 1, integrity: q };
    // the confirmed rear end: the estimated front end minus the confirmed train length, only with integrity confirmed
    if ((q === 1 || q === 2) && typeof p0.L_TRAININT === 'number') {
      const b = this.bgByNid(p0.NID_LRBG) as BaliseGroup, front = ses.report.dir ? b.s + ses.report.d : b.s - ses.report.d;
      ses.rears.push({ t, s: ses.report.dir ? front - p0.L_TRAININT : front + p0.L_TRAININT });
      if (ses.rears.length > 64) ses.rears.splice(0, ses.rears.length - 64);
    }
  }

  /**
   * Moving block: the confirmed min safe rear end of a train known to the RBC at time t when the reports reach it
   * `delay` seconds after they are sent, in nominal chainages; null if none is known yet
   */
  confirmedRear(engine: number, t: number, delay = 0): number | null {
    const r = this.sessions.get(engine)?.rears;
    if (!r) return null;
    for (let i = r.length - 1; i >= 0; i--) if (r[i].t <= t - delay + 1e-9) return r[i].s;
    return null;
  }

  /** Messages to send now to one train: the authority when something changes or when the renewal period expires */
  tick(x: RbcInputs): RadioMessage[] {
    const ses = this.sessions.get(x.engine ?? 1);
    if (!ses || !ses.report) return [];
    const out: RadioMessage[] = [];
    const lrbg = this.bgByNid(ses.report.lrbg) as BaliseGroup;
    const T_TRAIN = Math.round(x.t * 100);
    if (ses.stopOrder && !ses.stopSent) {
      out.push({ NID_MESSAGE: 16, T_TRAIN, M_ACK: 1, NID_LRBG: ses.report.lrbg, NID_EM: ses.nidEm++ });
      ses.stopSent = true;
    }
    if (!ses.stopOrder) ses.stopSent = false;
    if (!x.ma) return out;
    const tsrKeys = x.tsr.map(z => z.join(':'));
    const key = [Math.round(x.ma.eoa), Math.round(x.ma.svl), ses.report.lrbg, ses.report.dir, tsrKeys.join('|')].join('/');
    if (key === ses.lastKey && x.t - ses.lastSent < this.refresh) return out;
    ses.lastKey = key; ses.lastSent = x.t;
    // the line and the group positions as the train sees them: mirrored when it runs against the nominal direction
    const rev = ses.report.dir === 0, Q_DIR = rev ? 0 : 1;
    const L = rev ? (this.Lr ??= mirrorLine(this.L)) : this.L;
    const at = (b: BaliseGroup) => rev ? this.L.len - b.s : b.s;
    const p0 = at(lrbg);
    const end = Math.min(L.len, Math.max(x.ma.svl, x.ma.eoa) + 300);
    const pk: EtcsPacket[] = [];
    // 15: movement authority, a single section up to the end of authority
    const endOfLine = x.ma.why === 'end of line';
    pk.push({
      NID_PACKET: 15, Q_DIR, Q_SCALE: 1, V_LOA: 0, T_LOA: 1023, N_ITER: 0,
      L_ENDSECTION: Math.max(0, Math.round(x.ma.eoa - p0)), Q_SECTIONTIMER: 0, Q_ENDTIMER: 0,
      Q_DANGERPOINT: endOfLine ? 0 : 1, D_DP: endOfLine ? 0 : Math.round(x.ma.svl - x.ma.eoa), V_RELEASEDP: endOfLine ? 0 : 3,
      Q_OVERLAP: 0,
    });
    // 27: static speed profile (without temporary restrictions), V_STATIC in steps of 5 km/h; 127 closes the profile
    const ssp: Record<string, number>[] = [];
    let prev = p0;
    for (const [a, b, v] of x.baseLim) {
      if (b <= p0 || a >= end) continue;
      const from = Math.max(a, p0);
      ssp.push({ D_STATIC: Math.round(from - prev), V_STATIC: Math.floor(v / 5), Q_FRONT: 0 });
      prev = Math.round(from - prev) + prev;
    }
    ssp.push({ D_STATIC: Math.round(end - prev), V_STATIC: 127, Q_FRONT: 0 });
    pk.push({ NID_PACKET: 27, Q_DIR, Q_SCALE: 1, ...ssp[0], N_ITER: ssp.length - 1, elements: ssp.slice(1) });
    // 21: gradients in whole ‰, rounded towards safety; G_A = 255 closes the profile
    const gr: Record<string, number>[] = [];
    prev = p0;
    for (const p of L.prof) {
      if (p.b <= p0 || p.a >= end) continue;
      const from = Math.max(p.a, p0), up = p.i >= 0;
      gr.push({ D_GRADIENT: Math.round(from - prev), Q_GDIR: up ? 1 : 0, G_A: up ? Math.floor(p.i) : Math.ceil(-p.i) });
      prev = Math.round(from - prev) + prev;
    }
    gr.push({ D_GRADIENT: Math.round(end - prev), Q_GDIR: 0, G_A: 255 });
    pk.push({ NID_PACKET: 21, Q_DIR, Q_SCALE: 1, ...gr[0], N_ITER: gr.length - 1, elements: gr.slice(1) });
    // 5: linking of the balise groups ahead of the LRBG, in the order the train meets them
    const links: Record<string, number>[] = [];
    prev = p0;
    const ahead = this.bgs.map(b => ({ b, s: at(b) })).filter(z => z.s > p0 && z.s <= end).sort((a, b) => a.s - b.s);
    for (const { b, s } of ahead) {
      links.push({ D_LINK: Math.round(s - prev), Q_NEWCOUNTRY: 0, NID_BG: b.NID_BG, Q_LINKORIENTATION: Q_DIR, Q_LINKREACTION: 2, Q_LOCACC: 1 });
      prev = Math.round(s - prev) + prev;
    }
    if (links.length) pk.push({ NID_PACKET: 5, Q_DIR, Q_SCALE: 1, ...links[0], N_ITER: links.length - 1, elements: links.slice(1) });
    // 65 and 66: new and revoked temporary speed restrictions
    for (const [k, id] of [...ses.tsrSent]) if (!tsrKeys.includes(k)) { pk.push({ NID_PACKET: 66, Q_DIR, NID_TSR: id }); ses.tsrSent.delete(k); }
    x.tsr.forEach((z, i) => {
      const k = tsrKeys[i];
      let id = ses.tsrSent.get(k);
      if (id == null) { id = ses.nextTsr++; ses.tsrSent.set(k, id); }
      if (z[1] <= p0) return;
      const from = Math.max(z[0], p0);
      pk.push({ NID_PACKET: 65, Q_DIR, Q_SCALE: 1, NID_TSR: id, D_TSR: Math.round(from - p0), L_TSR: Math.round(z[1] - from), Q_FRONT: 0, V_TSR: Math.floor(z[2] / 5) });
    });
    // 58: position report parameters: periodically in time (§3.6.5.1.5 a) and at every LRBG compliant group (M_LOC 1)
    if (x.tCycloc != null) pk.push({ NID_PACKET: 58, Q_DIR, Q_SCALE: 1, T_CYCLOC: x.tCycloc, D_CYCLOC: 32767, M_LOC: 1, N_ITER: 0 });
    out.push({ NID_MESSAGE: 3, T_TRAIN, M_ACK: 0, NID_LRBG: ses.report.lrbg, packets: pk });
    return out;
  }
}
