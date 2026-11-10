/**
 * The exchanges of the engine with a message-based ETCS onboard (phase 8, R1): the request of a cycle (odometry,
 * balises read, RBC messages, and train data, national values and stored position on the first), the response
 * (commands to the train, messages for the RBC, DMI) and the exchange with the in-process reference onboard
 * (docs/ONBOARD_ETCS.md, docs/design/protocols.md). `Simulation` keeps `onboardDue`, `onboardRequest` and
 * `onboardResponse` as its methods.
 */
import { FIXED_DT } from './dynamics';
import { DEFAULT_NATIONAL as DEFAULT_NATIONAL_FOR_REQUEST } from './evc';
import { toEnglish } from './legacy';
import { nidLrbg, type BaliseGroup } from './simple-rbc';
import type { OnboardState, Simulation, TrainRun } from './simulation';
import type { OnboardRequest, OnboardResponse, Supervision } from './types';

/** True when an external ETCS onboard must receive the request of the next cycle before `step()` */
export function onboardDue(sim: Simulation, run: TrainRun = sim.train): boolean {
  const ob = run.ob;
  return !!ob && ob.kind === 'external' && run.active && !run.S.finished && run.S.t + FIXED_DT > ob.t1 + 1e-9;
}

/** Position of the reference balise (N_PIG = 0) of a group in the chainages of a train's direction of running */
function bgRef(sim: Simulation, run: TrainRun, b: BaliseGroup): number { return run.ob?.own || run.dir > 0 ? b.s : sim.L.len - b.s; }

/** Temporary speed restrictions of the main line in the chainages of the corridor of a train */
export function corridorTsr(sim: Simulation, run: TrainRun): [number, number, number][] {
  const out: [number, number, number][] = [], len = sim.L.len;
  for (const [a, b, v] of sim.faults.tsr) for (const g of run.legs) {
    if (g.line !== 0) continue;
    const [x, y] = g.dir > 0 ? [a, b] : [len - b, len - a];
    const p = Math.max(g.c0 + (x - g.d0), g.lo), q = Math.min(g.c0 + (y - g.d0), g.hi);
    if (q > p) out.push([p, q, v]);
  }
  return out;
}

/** Request for the onboard: odometry, balises read and RBC messages since the last cycle; train data on the first */
/**
 * The odometer reading of the onboard at the true position s (on or after the last update of the error): the distance
 * run since the odometer zero, plus the error accumulated by an `odometry_drift` (internal, also called by simulation.ts)
 */
export function odometerReading(ob: OnboardState, s: number): number { return s - ob.s0 + ob.odo.err + ob.odo.slope * (s - ob.odo.s); }

/** Starts, changes or ends the drift of the odometer of a train: the error so far is kept, the slope changes */
export function setOdometerDrift(ob: OnboardState, s: number, slope: number): void {
  ob.odo.err += ob.odo.slope * (s - ob.odo.s); ob.odo.s = s; ob.odo.slope = slope;
}

export function onboardRequest(sim: Simulation, run: TrainRun = sim.train): OnboardRequest {
  const S = run.S, ob = run.ob as OnboardState, TR = run.TR;
  const req: OnboardRequest = {
    type: 'onboard', version: 2, start: ob.exchanges === 0, t: +S.t.toFixed(6), dt: ob.period,
    odometry: ob.odo.slope || ob.odo.err
      ? { distance_m: odometerReading(ob, S.s), speed_ms: S.v * (1 + ob.odo.slope), acceleration_ms2: S.a * (1 + ob.odo.slope) }
      : { distance_m: S.s - ob.s0, speed_ms: S.v, acceleration_ms2: S.a },
    balises: ob.pendingBg.splice(0), radio: ob.pendingRadio.splice(0),
    train: { doors_open: S.doors, emergency_applied: S.eb, traction: S.uT, brake: S.uB, ...(run.integrityLost == null ? {} : { integrity: run.integrityLost ? 'lost' : 'confirmed' }) },
  };
  if (req.start) {
    // the group behind the train, where it is standing in its direction of running
    const ref = (b: BaliseGroup) => bgRef(sim, run, b);
    const bg0 = ob.bgs.filter(b => ref(b) <= S.s).sort((a, b) => ref(a) - ref(b)).pop() || ob.bgs[0];
    req.train_data = {
      NID_ENGINE: ob.engine, L_TRAIN: TR.L, V_MAXTRAIN: Math.round(TR.vmax * 3.6),
      A_brake_emergency: TR.bEm, A_brake_service: TR.bSvc,
      T_brake_emergency: Math.max(1, 2 * TR.tauB), T_brake_service: Math.max(1, 1.5 * TR.tauB), T_traction_cut_off: 0.5,
      M_rotating: Math.max(0, (TR.rot - 1) * 100),
    };
    const radioEv = (sim.scenario?.events || []).find(e => e.type === 'radio_loss');
    req.national_values = { ...DEFAULT_NATIONAL_FOR_REQUEST, ...(sim.scen.national_values || {}) };
    if (radioEv) req.national_values.T_NVCONTACT = radioEv.timeout_s ?? 20;
    req.stored_position = { NID_LRBG: nidLrbg(bg0.NID_BG), D_LRBG: S.s - ref(bg0), ...(run.dir < 0 && !ob.own ? { Q_DIRLRBG: 0 } : {}) };
  }
  return req;
}

/** Receives the onboard response: commands to the train, messages for the RBC and DMI indications */
export function onboardResponse(sim: Simulation, r: OnboardResponse, run: TrainRun = sim.train): void {
  r = toEnglish<OnboardResponse>(r);
  const S = run.S, ob = run.ob;
  if (!ob) throw new Error('the run does not use a message-based ETCS onboard');
  if (!r || !r.outputs || !r.dmi) throw new Error('invalid ETCS onboard response at t = ' + S.t.toFixed(3) + ' s: outputs and dmi are required');
  const prev = ob.resp?.outputs, out = r.outputs;
  ob.resp = r; ob.t1 = S.t + ob.period; ob.exchanges++; ob.sAtResp = S.s;
  for (const m of r.radio || []) {
    ob.log.push({ t: S.t, direction: 'onboard→RBC', msg: m });
    if (!sim.faults.radioOk || run.radioLost || (sim.faults.radioRbc != null && m.NID_RBC === sim.faults.radioRbc)) continue;
    if (sim.tr) sim.tr.pendingRadio.push(m); else ob.rbc.receive(m, S.t);
  }
  if (out.emergency && !prev?.emergency) {
    const why = r.emergency_reason || '';
    if (why === 'intervention') { S.interventions++; sim.emergency('ETCS onboard intervention, intervention curve exceeded', run); }
    else if (why === 'trip') sim.emergency('the ETCS onboard tripped: end of authority passed', run);
    else if (why === 'emergency_stop') sim.emergency('RBC emergency stop order (message 16)', run);
    else if (why === 'radio_contact' || why === 'contatto') sim.emergency('no message from the RBC: onboard trip', run);
    else sim.emergency('commanded by the ETCS onboard' + (why ? ' (' + why + ')' : ''), run);
  }
  if (out.service_brake && !prev?.service_brake) {
    if (!sim.faults.radioOk || run.radioLost) { S.radioBrakes++; sim.event('WARN', 'No message from the RBC: the ETCS onboard commands the service brake', false, run); }
    else { S.sbiCount++; sim.event('WARN', 'The ETCS onboard commands the service brake', false, run); }
  }
  if (!out.service_brake && prev?.service_brake) sim.event('INFO', 'ETCS service brake released', false, run);
  S.sbi = out.service_brake;
  const d = r.dmi, was = ob.sup.status;
  if (d.state === 'WAR' && was !== 'WAR') { S.warns++; sim.event('WARN', 'Warning: reduce speed (' + (d.target ? d.target.type : 'line limit') + ')', false, run); }
  const fin = (x: number | undefined, dflt: number) => (typeof x === 'number' && isFinite(x) ? x : dflt);
  ob.sup = {
    mode: 'ETCS', vMRSP: fin(d.v_mrsp_ms, 0), vP: fin(d.v_permitted_ms, 0), vW: fin(d.v_warning_ms, fin(d.v_permitted_ms, 0)),
    vSBI: fin(d.v_sbi_ms, fin(d.v_warning_ms, 0)), vEBI: fin(d.v_intervention_ms, fin(d.v_sbi_ms, 0)),
    tgt: d.target ? { d: d.target.distance_m, v: d.target.speed_ms, kind: d.target.type } : null,
    ind: !!d.indication || d.state === 'IND', status: d.state,
  };
  if (r.note) sim.event('INFO', 'ETCS onboard: ' + String(r.note).slice(0, 200), false, run);
}

/** Supervision to show with a message-based onboard: the last one from the onboard, with the distance to the target updated */
export function onboardSupervision(run: TrainRun): Supervision {
  const ob = run.ob as OnboardState, sp = ob.sup;
  return sp.tgt ? { ...sp, tgt: { ...sp.tgt, d: sp.tgt.d - (run.S.s - ob.sAtResp) } } : sp;
}

/** Exchange with the in-process reference onboard, when it is its turn */
export function onboardInProcess(sim: Simulation, run: TrainRun): void {
  const ob = run.ob;
  if (ob && ob.ref && run.active && !run.S.finished && run.S.t + FIXED_DT > ob.t1 + 1e-9) onboardResponse(sim, ob.ref.step(onboardRequest(sim, run)), run);
}
