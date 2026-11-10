/**
 * The outputs of a run (phase 8, R1): what the engine gives to the outside, computed from the state of the run
 * and never changing it, except the samples of the CSV and the cursor of the events of the observation, which the
 * caller asks for: the samples of the CSV (`recordSample`, `csvOf`), the observation for controllers and agents
 * (`observe`, with the Subset-130 ATO data of `etcsAto`), the results and the verdict, the realised timetable and
 * the summary. `Simulation` keeps the same public methods, which call these functions.
 */
import { altOf } from './line';
import { evaluate, type RunResult, type Verdict } from './scenario';
import { toLegacy } from './legacy';
import { ETCS, atoData, supervise } from './signalling';
import type { Simulation, TrainRun } from './simulation';
import type { EtcsAtoData, Observation } from './types';

/** Interval (s) between two rows of the run CSV */
export const LOG_DT = 0.5;

/** Header of the CSV produced by `Simulation.csv()`, one column per quantity */
export const CSV_HEADER = [
  't_s', 'pos_m', 'v_kmh', 'v_permitted_kmh', 'v_warning_kmh', 'v_intervention_kmh', 'mrsp_kmh', 'supervision_status', 'eoa_m', 'next_aspect',
  'lever', 'traction', 'brake', 'Ft_kN', 'Fb_kN', 'Fed_kN', 'R_kN', 'Fg_kN', 'a_ms2', 'mu', 'altitude_m', 'gradient_permille',
  'traction_energy_kWh', 'regenerated_energy_kWh', 'vigilance_alarm', 'emergency', 'command_source', 'radio',
  'tail_speed_kmh', 'max_coupler_tension_kN', 'max_coupler_compression_kN', 'jerk_ms3',
  'onboard_mode', 'lrbg',
].join(',');

/** Name of a signal aspect */
export const aspectName = (a: string | undefined | null): string => a === 'G' ? 'clear' : a === 'Y' ? 'caution' : a === 'R' ? 'danger' : '—';
/** Short label of the master controller position (EM, B1…B7, 0, T1…T10) */
export const leverLabel = (l: number): string => l <= -8 ? 'EM' : l < 0 ? 'B' + (-l) : l === 0 ? '0' : 'T' + l;
/** Signed stopping error, in metres */
export const fmtErr = (e: number): string => (e >= 0 ? '+' : '−') + Math.abs(e).toFixed(1) + ' m';

/**
 * Signalling-constrained time (docs/CAPACITY.md, "Time held by the signalling"): adds `dt` to the run when the
 * signalling, not the line or the stop, holds the permitted speed down. That is when the target that sets the
 * permitted speed is one of the signalling (an end of authority or a signal at danger: speed 0, not the end of the
 * line) and the permitted speed is lower by at least 1 km/h than what the line and the next stop would allow: the
 * permitted speed of the same supervision without authority and signals, and the speed from which the train stops at
 * the stop marker with its service deceleration (0 while it stands there with the doors open, or at its origin before
 * the departure time; 20 m is STOP_TOL). The same rule holds for every onboard, because it reads only the
 * supervision the train is given.
 */
export function signallingConstrained(sim: Simulation, run: TrainRun, dt: number): void {
  const S = run.S, sp = S.sup, tg = sp?.tgt;
  if (S.finished || !tg || tg.v > 0 || tg.kind === 'end of the line' || sp.vP >= sp.vMRSP - 1 / 3.6) return;
  const free = supervise({ L: run.line, TR: run.TR, mode: sim.scen.sig, mu: sim.mu, ma: null }, S.s, S.v, true).vP;
  const st = run.stations[S.nextSt];
  const o = run.stations[0];
  const vStop = S.doors || (S.nextSt === 1 && o && S.v === 0 && Math.abs(S.s - o.s) <= 20 && S.t + 1e-9 < (o.dep ?? -Infinity)) ? 0
    : !st || st.done ? Infinity : Math.sqrt(2 * run.TR.bSvc * Math.max(0, st.s - S.s));
  if (sp.vP < Math.min(free, vStop) - 1 / 3.6) S.sigT += dt;
}

/** Records a sample every LOG_DT seconds of simulated time; to be called after every step */
export function recordSample(sim: Simulation, run?: TrainRun): void {
  if (!run) { for (const r of sim.trains) if (r.active) sim.sample(r); return; }
  const S = run.S;
  if (S.t + 1e-9 < S.nextLog) return;
  S.nextLog += LOG_DT;
  const ns = sim.nextSignal(S.s, run.line), sp = S.sup;
  S.rows.push([
    S.t.toFixed(1), S.s.toFixed(1), (S.v * 3.6).toFixed(2), (sp.vP * 3.6).toFixed(1),
    isFinite(sp.vW) ? (sp.vW * 3.6).toFixed(1) : '', isFinite(sp.vEBI) ? (sp.vEBI * 3.6).toFixed(1) : '',
    (sp.vMRSP * 3.6).toFixed(0), sp.status, S.ma ? S.ma.eoa.toFixed(0) : '', ns && sim.scen.sig === 'BACC' ? ns.asp : '',
    leverLabel(S.lever), S.uT.toFixed(2), S.uB.toFixed(2), (S.Ft / 1000).toFixed(2), (S.Fb / 1000).toFixed(2), (S.Fed / 1000).toFixed(2),
    (S.R / 1000).toFixed(2), (S.Fg / 1000).toFixed(2), S.a.toFixed(3), sim.muAt(S.s, run).toFixed(2), altOf(run.line, S.s).toFixed(1), (S.grade || 0).toFixed(1),
    S.eT.toFixed(3), S.eR.toFixed(3), S.vigAlarm ? 1 : 0, S.eb ? 1 : 0, S.commandSource, sim.faults.radioOk ? 1 : 0,
    (S.vTail * 3.6).toFixed(2), (S.Tnow / 1000).toFixed(1), (S.Cnow / 1000).toFixed(1), S.jerk.toFixed(3),
    run.ob?.resp?.dmi.mode ?? '', run.ob?.resp?.position?.NID_LRBG ?? '',
  ]);
  const tl = S.trace[S.trace.length - 1];
  if (S.s - tl[0] >= 4) S.trace.push([S.s, S.v * 3.6]);
}

export function csvOf(sim: Simulation, run: TrainRun = sim.train): string { return CSV_HEADER + '\n' + run.S.rows.map(r => r.join(',')).join('\n'); }

/**
 * Onboard data for ATO (Subset-130) in line chainages, or null outside FS and with the automatic block.
 * With a message-based onboard they come from the onboard response; if the onboard does not provide them only the speeds remain.
 */
export function etcsAto(sim: Simulation, run: TrainRun = sim.train): EtcsAtoData | null {
  const S = run.S, ob = run.ob;
  if (sim.scen.sig !== 'ETCS') return null;
  if (!ob) return atoData({ L: run.line, TR: run.TR, mode: sim.scen.sig, mu: sim.mu, ma: S.ma }, S.s, S.v, S.a, S.sup);
  const d = ob.resp?.dmi;
  if (!d || d.mode !== 'FS') return null;
  const k = ob.s0, x = (n: number | null | undefined) => (typeof n === 'number' && isFinite(n) ? n + k : null);
  const a = d.ato;
  if (!a) {
    return {
      M_MODE: d.mode, V_EST: S.v, A_EST: S.a, V_PERMITTED: d.v_permitted_ms, V_MRSP: d.v_mrsp_ms, MRSP: [], N_LOC_EBI: null,
      N_LOC_EOALOA: null, V_EOALOA: null, N_LOC_SVL: null, V_RELEASE_ATO: d.v_release_ms ?? null, A_BRAKE_SAFE: null, GRADIENT: [],
      T_TRACTION: 0, T_BE_REACT: 0, L_UNCERTAINTY_OVERREADING: 0, L_UNCERTAINTY_UNDERREADING: 0,
    };
  }
  return {
    ...a, N_LOC_EBI: x(a.N_LOC_EBI), N_LOC_EOALOA: x(a.N_LOC_EOALOA), N_LOC_SVL: x(a.N_LOC_SVL),
    MRSP: (a.MRSP || []).map(([p, v]) => [p + k, v] as [number, number]),
    GRADIENT: (a.GRADIENT || []).map(([p, g]) => [p + k, g] as [number, number]),
  };
}

/**
 * API observation; consumes the events accumulated since the last call.
 * Version 3 (default) is the English format; versions 1 and 2 are the Italian formats of YuTreno 0.x, built from
 * version 3 by `toLegacy()` with the same keys in the same order (2 adds `etcs_ato` to 1).
 */
export function observe(sim: Simulation, period: number, version: 1 | 2 | 3 = 3, run: TrainRun = sim.train): Observation {
  const S = run.S, L = run.line, TR = run.TR, sp = S.sup, ahead = 8000, pos = S.s;
  const prSpeed: [number, number, number][] = [], prGrad: [number, number, number][] = [];
  for (const [a, b, v] of L.lim) if (b > pos && a < pos + ahead) prSpeed.push([Math.max(a, pos), Math.min(b, pos + ahead), Math.min(v, TR.vmax * 3.6) / 3.6]);
  for (const p of L.prof) if (p.b > pos && p.a < pos + ahead) prGrad.push([Math.max(p.a, pos), Math.min(p.b, pos + ahead), +p.i.toFixed(2)]);
  const st = run.stations[S.nextSt], ns = sim.nextSignal(pos, L);
  const ev = S.events.slice(S.evCursor).filter(e => !e.hidden).map(e => ({ t: e.t, type: e.kind, text: e.text }));
  S.evCursor = S.events.length;
  const o: Observation = {
    version: 3, t: +S.t.toFixed(3), dt: period, pos_m: pos, vel_ms: S.v, acc_ms2: S.a, lever: S.lever, traction: S.uT, brake: S.uB,
    forces_kN: { traction: S.Ft / 1000, brake: S.Fb / 1000, electric_brake: S.Fed / 1000, resistance: S.R / 1000, gradient: S.Fg / 1000 },
    doors_open: S.doors, emergency: S.eb, vigilance_alarm: S.vigAlarm, adhesion_mu: sim.mu,
    slip: S.slip, wsp: S.wsp, radio_ok: sim.faults.radioOk,
    model: run.ext ? 'external' : run.mm ? 'multimass' : 'point', tail_speed_ms: S.vTail, jerk_ms3: S.jerk,
    coupler_forces_kN: run.mm ? Array.from(run.mm.T, t => t / 1000) : run.ext ? (run.ext.resp?.coupler_forces_kN ?? []) : [],
    onboard: { type: run.ob ? run.ob.kind : 'internal', mode: run.ob?.resp?.dmi.mode ?? null, lrbg: run.ob?.resp?.position?.NID_LRBG ?? null },
    speed_restrictions: sim.faults.tsr.map(z => [z[0], z[1], z[2] / 3.6] as [number, number, number]),
    signalling: sim.scen.sig,
    supervision: {
      state: sp.status, v_permitted_ms: sp.vP, v_warning_ms: isFinite(sp.vW) ? sp.vW : null, v_intervention_ms: isFinite(sp.vEBI) ? sp.vEBI : null,
      v_mrsp_ms: sp.vMRSP, target: sp.tgt ? { distance_m: sp.tgt.d, speed_ms: sp.tgt.v, type: sp.tgt.kind } : null,
    },
    ma: S.ma ? { eoa_m: S.ma.eoa, svl_m: S.ma.svl, v_release_ms: ETCS.vRel, reason: S.ma.why } : null,
    signal: sim.scen.sig === 'BACC' && ns ? { id: ns.id, pos_m: ns.s, aspect: ({ G: 'green', Y: 'yellow', R: 'red' } as const)[ns.asp] } : null,
    speed_profile: prSpeed, gradient_profile: prGrad, current_gradient_permille: S.grade || 0,
    next_stop: st ? { name: st.name, pos_m: st.s, arrival_s: st.arr, departure_s: st.dep } : null,
    line: { name: L.def.name, length_m: L.len },
    train: {
      name: TR.name, mass_kg: TR.m, equivalent_mass_kg: run.ME, length_m: TR.L, power_W: TR.Pw, max_force_N: TR.Fmax,
      decel_service_ms2: TR.bSvc, decel_emergency_ms2: TR.bEm, vmax_ms: TR.vmax, davis: { A: TR.A, B: TR.B, C: TR.C },
    },
    events: ev,
    etcs_ato: version === 1 ? null : sim.etcsAto(run),
  };
  // with service trains the observation says which train it is for (the train ahead alone does not count: 0.x had none)
  if (sim.trains.length - (sim.leader ? 1 : 0) > 1) o.train_id = run.id;
  if (version === 3) return o;
  // versions 1 and 2: the Italian format of YuTreno 0.x, with the same keys in the same order
  const legacy = toLegacy<Record<string, unknown>>({ ...o, version }, 'observation');
  if (version === 1) delete legacy.etcs_ato;
  return legacy as unknown as Observation;
}

/** Results of the run used by the verdict */
export function result(sim: Simulation, run: TrainRun = sim.train): RunResult {
  const S = run.S, last = run.stations[run.stations.length - 1];
  const fin = S.stops.find(x => last && x.name === last.name && x.err != null);
  return {
    finished: S.finished && !!fin, t_s: S.t, stops: S.stops, arrival_delay_s: fin ? fin.late : null,
    interventions: S.interventions, overruns: S.spad, missed_vigilance: S.vigMissed, max_over_limit_kmh: S.maxOverLine,
    net_energy_kWh: S.eT - S.eR,
    max_tension_kN: S.maxTension / 1000, max_compression_kN: S.maxCompression / 1000, max_jerk_ms3: S.maxJerk,
  };
}

/** Verdict with the criteria of the scenario, or with the default ones if the run has no scenario */
export function verdict(sim: Simulation, run: TrainRun = sim.train): Verdict {
  const c = sim.scenario?.criteria;
  // the train ahead has no timetable and no passengers to stop for: punctuality, stopping accuracy, energy and comfort
  // are criteria of the trains of the timetable, so only the safety of its run is judged
  if (run.freight) return evaluate(sim.result(run), { ...c, arrival_max_s: undefined, delay_max_s: undefined, stop_error_max_m: undefined, energy_max_kWh: undefined, jerk_max_ms3: undefined });
  return evaluate(sim.result(run), c);
}

/**
 * Planned and realised timetable of every train: for every stop the timetabled and actual arrival and departure
 * (s from the start of the run) and the delays. Arrival is the stop at the marker, departure the first movement after it.
 */
export function timetable(sim: Simulation) {
  const r1 = (x: number | null) => (x == null ? null : +x.toFixed(1));
  const d = (a: number | null, p: number | null) => (a == null || p == null ? null : +(a - p).toFixed(1));
  return sim.trains.map(r => ({
    id: r.id, train: r.TR.name, driver: r.driver, finished: r.S.finished, ...(r.cancelled ? { cancelled: r.cancelled } : {}),
    stops: r.plan.map((st, i) => {
      const re = r.realised.find(x => x.station === st.name), cur = r.stations.find(x => x.name === st.name);
      const arr = i === 0 ? null : re?.arrival_s ?? null, dep = re?.departure_s ?? null;
      return {
        station: st.name, planned_arrival_s: st.arr, planned_departure_s: st.dep, arrival_s: r1(arr), departure_s: r1(dep),
        arrival_delay_s: d(arr, st.arr), departure_delay_s: d(dep, st.dep),
        // decisions of the regulator, only when there are any: the plan stays the reference for the delays
        ...(!cur ? { skipped: true } : {}),
        ...(cur && cur.arr !== st.arr ? { rescheduled_arrival_s: cur.arr } : {}),
        ...(cur && cur.dep !== st.dep ? { rescheduled_departure_s: cur.dep } : {}),
        // connections sim train waits for here, with their outcome
        ...(sim.connections.some(c => c.to === r && c.station === st.name) ? { connections: sim.connections.filter(c => c.to === r && c.station === st.name).map(c => ({ from: c.from.id, outcome: c.outcome, wait_s: c.wait_s })) } : {}),
      };
    }),
    ...(r.after ? { after: r.after.id } : {}),
  }));
}

/** Summary of the run for reports and checks */
export function summary(sim: Simulation, run: TrainRun = sim.train) {
  const S = run.S;
  const good = S.stops.filter(s => s.err != null);
  const v = sim.verdict(run);
  return {
    scenario: sim.scenario ? sim.scenario.name : null, outcome: v.outcome, onboard: sim.scen.sig === 'ETCS' ? (run.ob ? run.ob.kind : 'internal') : null,
    line: sim.L.def.name, train: run.TR.name, signalling: sim.scen.sig, finished: S.finished, t_s: +S.t.toFixed(2), pos_m: +S.s.toFixed(2),
    stops: S.stops.map(s => ({ ...s, err: s.err == null ? null : +s.err.toFixed(2), late: s.late == null ? null : +s.late.toFixed(1) })),
    mean_stop_error_m: good.length ? +(good.reduce((a, s) => a + Math.abs(s.err as number), 0) / good.length).toFixed(2) : null,
    traction_energy_kWh: +S.eT.toFixed(2), regenerated_energy_kWh: +S.eR.toFixed(2),
    warnings: S.warns, signalling_constrained_s: +S.sigT.toFixed(1), service_brakings: S.sbiCount, interventions: S.interventions, overruns: S.spad,
    missed_vigilance: S.vigMissed, slip_time_s: +S.slipT.toFixed(1), controller_steps: S.ctlTicks,
    model: run.ext ? 'external' : run.mm ? 'multimass' : 'point', max_coupler_tension_kN: +(S.maxTension / 1000).toFixed(1),
    max_coupler_compression_kN: +(S.maxCompression / 1000).toFixed(1), max_jerk_ms3: +S.maxJerk.toFixed(2),
    radio_brakings: S.radioBrakes, max_over_limit_kmh: +Math.max(0, S.maxOverLine).toFixed(1), checks: v.checks,
  };
}
