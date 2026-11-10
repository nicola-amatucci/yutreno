/**
 * Signalling and supervision.
 *
 * Three-aspect automatic block: a section occupied by the train ahead turns its entry signal red
 * and the one before yellow; starting signals stay red until the timetabled departure.
 *
 * ERTMS/ETCS level 2 (simplified): the RBC grants a movement authority (MA) up to the start of the
 * first section the block would turn red, with the supervised location (SvL) 50 m beyond. The onboard
 * computes the indication, permitted (P), warning (W), service brake intervention (SBI) and emergency
 * brake intervention (EBI) curves, correcting the deceleration for the steepest descent and for
 * adhesion. These are not the models of SUBSET-026.
 *
 * SCMT (simplified): a single curve towards the red signal with a deceleration of 0.55 m/s² and
 * release at 30 km/h, warning at +3 km/h, intervention at +7 km/h.
 */
import { mrspChanges } from './evc';
import { minGrade } from './line';
import type { CompiledLine, EtcsAtoData, MovementAuthority, Signalling, Supervision, TrainParams } from './types';

/** Gravitational acceleration (m/s²) */
export const G = 9.81;

/** Times and margins of the simplified ETCS supervision (s, m, m/s) */
export const ETCS = {
  /** Emergency brake build-up time (s) */
  Tbe: 2.0,
  /** Service brake build-up time (s) */
  Tbs: 1.5,
  /** Driver reaction time (s) */
  Tdrv: 4,
  /** Indication lead time (s) */
  Tind: 5,
  /** Release speed (m/s) */
  vRel: 15 / 3.6,
  /** Distance between EoA and SvL (m) */
  overlap: 50,
};

/**
 * Signal aspects and, with ETCS, the movement authority of a train alone on the line: red for the starting signals
 * of the stations it may not yet leave, yellow before a red. With other trains the aspects come from `updateSignals`
 */
export function updateInterlocking(L: CompiledLine, t: number, pos: number, mode: Signalling): MovementAuthority | null {
  const sg = L.sig;
  for (let i = sg.length - 1; i >= 0; i--) {
    let asp: 'G' | 'Y' | 'R' = 'G';
    const hold = sg[i].st;
    if (hold != null && L.st[hold] && L.st[hold].dep != null && t < (L.st[hold].dep as number)) asp = 'R';
    else if (i + 1 < sg.length && sg[i + 1].asp === 'R') asp = 'Y';
    sg[i].asp = asp;
  }
  if (mode !== 'ETCS') return null;
  let eoa = L.len - 15, why = 'end of line';
  for (let i = 0; i < sg.length; i++) {
    if (sg[i].s <= pos) continue;
    if (sg[i].asp === 'R') { eoa = sg[i].s; why = 'departure not yet authorised'; break; }
  }
  return { eoa, svl: why === 'end of line' ? L.len : eoa + ETCS.overlap, why };
}

/** A train occupying the line: head position and length (m) */
export interface Occupant { head: number; len: number }

/** True if block section i is occupied by one of the occupants */
export function blockOccupiedBy(L: CompiledLine, occ: Occupant[], i: number): boolean {
  const a = L.sig[i].s, b = i + 1 < L.sig.length ? L.sig[i + 1].s : L.len + 2000;
  for (const o of occ) if (o.head > a && o.head - o.len < b) return true;
  return false;
}

/**
 * Signal aspects with several trains: red behind every occupied section, red for the starting signals held by
 * `held` (signal indices whose train must wait for its departure time), yellow before a red.
 */
export function updateSignals(L: CompiledLine, occ: Occupant[], held: Set<number>): void {
  const sg = L.sig;
  for (let i = sg.length - 1; i >= 0; i--) {
    let asp: 'G' | 'Y' | 'R' = 'G';
    if (blockOccupiedBy(L, occ, i) || held.has(i)) asp = 'R';
    else if (i + 1 < sg.length && sg[i + 1].asp === 'R') asp = 'Y';
    sg[i].asp = asp;
  }
}

/** Movement authority of a train at pos from the current aspects: up to the first red signal ahead */
export function authorityFromSignals(L: CompiledLine, occ: Occupant[], pos: number): MovementAuthority {
  const sg = L.sig;
  for (let i = 0; i < sg.length; i++) {
    if (sg[i].s <= pos || sg[i].asp !== 'R') continue;
    const why = blockOccupiedBy(L, occ, i) ? 'section occupied' : 'departure not yet authorised';
    return { eoa: sg[i].s, svl: sg[i].s + ETCS.overlap, why };
  }
  return { eoa: L.len - 15, svl: L.len, why: 'end of line' };
}

/** Line limit under the whole length of the train, already capped by the train vmax (km/h) */
export function lineLimitTrain(L: CompiledLine, TR: TrainParams, pos: number): number {
  let v = Infinity;
  for (const [a, b, l] of L.lim) if (a <= pos && b > pos - TR.L) v = Math.min(v, l);
  return Math.min(v, TR.vmax * 3.6);
}

/** Speed at distance d from a target vt, with deceleration a and dead time T */
export function vForDist(d: number, vt: number, a: number, T: number): number {
  if (d <= 0) return vt;
  return Math.max(vt, -a * T + Math.sqrt(a * a * T * T + 2 * a * d + vt * vt));
}
/** Speed margin (m/s) between permitted and intervention curves, growing with speed */
export const dEbi = (v: number): number => { const k = v * 3.6; return (k <= 110 ? 7.5 : Math.min(15, 7.5 + (k - 110) * 0.0375)) / 3.6; };
/** Speed margin (m/s) between permitted and warning curves */
export const dWar = (v: number): number => { const k = v * 3.6; return (k <= 110 ? 4 : Math.min(10, 4 + (k - 110) * 0.03)) / 3.6; };

export interface SupervisionContext {
  L: CompiledLine;
  TR: TrainParams;
  mode: Signalling;
  mu: number;
  ma: MovementAuthority | null;
}

function decels(cx: SupervisionContext, a: number, b: number): { e: number; s: number } {
  const ad = cx.mu * G * 0.9, gc = G * Math.min(0, minGrade(cx.L, a, b)) / 1000;
  return { e: Math.max(0.08, Math.min(cx.TR.bEm, ad) * 0.9 + gc), s: Math.max(0.06, Math.min(cx.TR.bSvc, ad) * 0.8 + gc) };
}

/** Onboard supervision: from the targets of the context (end of authority, profile reductions)
 * computes the P, W, SBI, EBI curves at the given position and speed and the status to show on the DMI
 */
/**
 * Speed supervision at `pos` and `v`. With `lineOnly` the authority and the signals are left out: the permitted speed
 * the line alone would give, with the same curves (the signalling-constrained time of outputs.ts compares with it)
 */
export function supervise(cx: SupervisionContext, pos: number, v: number, lineOnly = false): Supervision {
  const { L, TR } = cx;
  const etcs = cx.mode === 'ETCS';
  const vM = lineLimitTrain(L, TR, pos) / 3.6;
  const sup: Supervision = {
    mode: cx.mode, vMRSP: vM, vP: vM,
    vW: vM + (etcs ? dWar(vM) : 3 / 3.6),
    vSBI: etcs ? vM + (dWar(vM) + dEbi(vM)) / 2 : Infinity,
    vEBI: vM + (etcs ? dEbi(vM) : 7 / 3.6),
    tgt: null, ind: false, status: 'NOR',
  };
  const consider = (d: number, vt: number, kind: string, isEoa: boolean, dS = 0) => {
    if (d < -1) return;
    let P: number, W: number, SB: number, EB: number, dP: number;
    if (etcs) {
      const dc = decels(cx, pos, pos + Math.max(d, dS) + 1);
      if (isEoa) {
        P = Math.max(ETCS.vRel, vForDist(d, 0, dc.s, ETCS.Tbs + ETCS.Tdrv));
        W = Math.max(ETCS.vRel + dWar(ETCS.vRel), vForDist(d, 0, dc.s, ETCS.Tbs + 2));
        SB = Math.max(ETCS.vRel + dWar(ETCS.vRel) * 1.5, vForDist(d, 0, dc.s, ETCS.Tbs));
        EB = Math.max(ETCS.vRel + dEbi(ETCS.vRel), vForDist(dS, 0, dc.e, ETCS.Tbe));
      } else {
        P = vForDist(d, vt, dc.s, ETCS.Tbs + ETCS.Tdrv);
        W = vForDist(d, vt + dWar(vt), dc.s, ETCS.Tbs + 2);
        SB = vForDist(d, vt + (dWar(vt) + dEbi(vt)) / 2, dc.s, ETCS.Tbs);
        EB = vForDist(d, vt + dEbi(vt), dc.e, ETCS.Tbe);
      }
      dP = v * (ETCS.Tbs + ETCS.Tdrv) + Math.max(0, v * v - vt * vt) / (2 * dc.s);
    } else {
      const a = 0.55;
      P = isEoa ? Math.max(30 / 3.6, Math.sqrt(2 * a * Math.max(0, d))) : Math.sqrt(vt * vt + 2 * a * Math.max(0, d));
      W = P + 3 / 3.6; SB = Infinity; EB = P + 7 / 3.6;
      dP = Math.max(0, v * v - vt * vt) / (2 * a);
    }
    if (P < sup.vP) { sup.vP = P; sup.tgt = { d, v: vt, kind }; }
    sup.vW = Math.min(sup.vW, W);
    sup.vSBI = Math.min(sup.vSBI, SB);
    sup.vEBI = Math.min(sup.vEBI, EB);
    if (v > vt && d <= dP + v * ETCS.Tind) sup.ind = true;
  };
  const horizon = lineOnly ? pos + 8000 : etcs && cx.ma ? Math.min(cx.ma.eoa, pos + 8000) : pos + 5000;
  for (const [a, , l] of L.lim) {
    const vt = Math.min(l, TR.vmax * 3.6) / 3.6;
    if (a > pos && a < horizon && vt < vM - 1e-6) consider(a - pos, vt, 'limit ' + Math.round(vt * 3.6) + ' km/h', false);
  }
  if (lineOnly) { /* the line only */ } else if (etcs && cx.ma) {
    consider(cx.ma.eoa - pos, 0, cx.ma.why === 'end of line' ? 'end of the line' : 'end of authority (' + cx.ma.why + ')', true, cx.ma.svl - pos);
  } else if (!etcs) {
    for (const sg of L.sig) {
      if (sg.s <= pos) continue;
      if (sg.s > pos + 5000) break;
      if (sg.asp === 'R') { consider(sg.s - pos, 0, 'signal ' + sg.id + ' at red', true); break; }
    }
  }
  sup.vW = Math.max(sup.vW, sup.vP);
  sup.vSBI = Math.max(sup.vSBI, sup.vW);
  sup.vEBI = Math.max(sup.vEBI, isFinite(sup.vSBI) ? sup.vSBI : sup.vW);
  if (v > sup.vEBI) sup.status = 'INT';
  else if (v > sup.vSBI) sup.status = 'SBI';
  else if (v > sup.vW) sup.status = 'WAR';
  else if (v > sup.vP) sup.status = 'OVS';
  else if (sup.ind) sup.status = 'IND';
  return sup;
}

/**
 * Data for ATO (Subset-130) from the simplified ETCS supervision, with the same targets and decelerations
 * as `supervise`. The position of the nearest EBI is obtained in closed form by inverting `vForDist`:
 * with dead time T and deceleration a, from v one reaches vt in v·T + (v² − vt²)/(2a).
 */
export function atoData(cx: SupervisionContext, pos: number, v: number, a: number, sup: Supervision): EtcsAtoData | null {
  const { L, TR, ma } = cx;
  if (cx.mode !== 'ETCS' || !ma) return null;
  const vM = sup.vMRSP, far = Math.min(ma.svl, pos + 8000);
  const dist = (vv: number, vt: number, dec: number, T: number) => vv * T + Math.max(0, vv * vv - vt * vt) / (2 * dec);
  let ebi = v > vM + dEbi(vM) ? pos : Infinity;
  const horizon = Math.min(ma.eoa, pos + 8000);
  for (const [s0, , l] of L.lim) {
    const vt = Math.min(l, TR.vmax * 3.6) / 3.6, vt2 = vt + dEbi(vt);
    if (s0 > pos && s0 < horizon && vt < vM - 1e-6 && v > vt2) ebi = Math.min(ebi, s0 - dist(v, vt2, decels(cx, pos, s0 + 1).e, ETCS.Tbe));
  }
  if (v > ETCS.vRel + dEbi(ETCS.vRel)) ebi = Math.min(ebi, ma.svl - dist(v, 0, decels(cx, pos, Math.max(ma.eoa, ma.svl) + 1).e, ETCS.Tbe));
  const segs = L.lim.map(([p, q, l]) => [p, q, Math.min(l, TR.vmax * 3.6)] as [number, number, number]);
  const GRADIENT: [number, number][] = [];
  for (const p of L.prof) if (p.b > pos && p.a < far) GRADIENT.push([Math.max(p.a, pos), G * p.i / (1000 * TR.rot)]);
  const endOfLine = ma.why === 'end of line';
  return {
    M_MODE: 'FS', V_EST: v, A_EST: a, V_PERMITTED: sup.vP, V_MRSP: vM,
    MRSP: mrspChanges(segs, pos, far, TR.L, 0),
    N_LOC_EBI: isFinite(ebi) ? ebi : null,
    N_LOC_EOALOA: ma.eoa, V_EOALOA: 0, N_LOC_SVL: ma.svl, V_RELEASE_ATO: endOfLine ? null : ETCS.vRel,
    A_BRAKE_SAFE: Math.min(TR.bEm, cx.mu * G * 0.9) * 0.9, GRADIENT,
    T_TRACTION: 0, T_BE_REACT: ETCS.Tbe, L_UNCERTAINTY_OVERREADING: 0, L_UNCERTAINTY_UNDERREADING: 0,
  };
}
