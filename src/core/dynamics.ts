/**
 * The dynamics of a train (phase 8, R1): the point-mass and multi-mass models, the co-simulation with an external
 * model, and the commands that actually reach traction and brakes after emergency, protection, doors and faults
 * (docs/design/dynamics.md, docs/MODEL.md, docs/EXTERNAL_DYNAMICS.md). `Simulation` advances every train with
 * `advanceDynamics` at each step and keeps `dynamicsDue`, `dynamicsRequest` and `dynamicsResponse` as its methods.
 */
import { G0, adhesionSpeedFactor, couplerForce, rocklPermille } from './consist';
import { toEnglish } from './legacy';
import { STEP, altOf, clamp, gradeOf, idxOf, tunnelOf } from './line';
import { G } from './signalling';
import type { ExternalState, MultiState, Simulation, TrainRun } from './simulation';
import type { DynamicsRequest, DynamicsResponse, TrainParams } from './types';

/** Fixed integration step (s). Every run advances only by multiples of this step: it is the basis of determinism */
export const FIXED_DT = 1 / 200;

/** Advances the dynamics of a train by dt with the commands that actually reach it */
export function advanceDynamics(sim: Simulation, run: TrainRun, dt: number): void {
  if (run.ext) { dynamicsExternal(sim, run, dt); return; }
  const { uT, uB, em } = effectiveCommands(sim, run);
  if (run.mm) dynamicsMulti(sim, run, dt, uT, uB, em);
  else dynamicsPoint(sim, run, dt, uT, uB, em);
}

/** Point-mass model: the whole train is a single mass */
function dynamicsPoint(sim: Simulation, run: TrainRun, dt: number, uT: number, uB: number, em: boolean): void {
  const S = run.S, TR = run.TR, L = run.line, ME = run.ME;
  const v = S.v, mu = sim.muAt(S.s, run);
  const fcap = Math.min(TR.Fmax, TR.Pw / Math.max(v, 1)) * run.tractionFactor;
  const muT = mu * TR.adh * TR.m * G;
  let trac = uT * fcap;
  S.slip = trac > muT && uT > 0;
  if (S.slip) { trac = muT; S.slipT += dt; }
  const rate = TR.Fmax * 0.45 * dt;
  S.Ft += Math.max(-2 * rate, Math.min(rate, trac - S.Ft));
  S.Ft = clamp(S.Ft, 0, Math.min(fcap, muT));
  let brk = (em ? ME * TR.bEm : ME * TR.bSvc * clamp(uB, 0, 1)) * run.brakeFactor;
  const muB = mu * TR.m * G * 0.95;
  S.wsp = brk > muB && v > 0.5;
  if (brk > muB) brk = muB;
  const tau = brk > S.Fb ? TR.tauB : TR.tauR;
  S.Fb += (brk - S.Fb) * (1 - Math.exp(-dt / Math.max(0.05, tau)));
  S.Fed = v > 1.5 && !em ? Math.min(S.Fb, TR.edMax, TR.Pw / Math.max(v, 1)) : 0;
  const back = Math.max(0, S.s - TR.L);
  const i = S.s - back > 1 ? (altOf(L, S.s) - altOf(L, back)) / (S.s - back) * 1000 : gradeOf(L, S.s);
  S.grade = i;
  S.Fg = TR.m * G * i / 1000;
  S.R = v > 0.01 ? TR.A + TR.B * v + TR.C * v * v : 0;
  const drive = S.Ft - S.Fg;
  let a: number;
  if (v < 0.01) { const opp = S.Fb + TR.A; if (drive > opp) a = (drive - opp) / ME; else { a = 0; S.v = 0; } }
  else a = (drive - S.Fb - S.R) / ME;
  S.a = a;
  S.v = Math.max(0, S.v + a * dt);
  S.s += S.v * dt;
  S.eT += S.Ft * S.v * dt / TR.eta / 3.6e6;
  S.eR += S.Fed * S.v * dt * TR.etaR / 3.6e6;
  S.vTail = S.v;
}

/** Multi-mass model: N vehicles connected by couplers with spring, damper and slack */
function dynamicsMulti(sim: Simulation, run: TrainRun, dt: number, uT: number, uB: number, em: boolean): void {
  const S = run.S, TR = run.TR, L = run.line, M = run.mm as MultiState, n = M.n;
  const vH = M.v[0];
  // commanded traction, limited by maximum force and power, with a ramp
  const fcap = Math.min(TR.Fmax, TR.Pw / Math.max(vH, 1)) * run.tractionFactor;
  const rate = TR.Fmax * 0.45 * dt;
  M.FtCmd += Math.max(-2 * rate, Math.min(rate, uT * fcap - M.FtCmd));
  M.FtCmd = clamp(M.FtCmd, 0, fcap);
  // total brake command, propagated along the brake pipe
  const brkCmd = (em ? run.ME * TR.bEm : run.ME * TR.bSvc * clamp(uB, 0, 1)) * run.brakeFactor;
  const H = M.hist.length;
  M.hist[M.histPos] = brkCmd;
  let ftSum = 0, fbSum = 0, fgSum = 0, rSum = 0, slip = false, wsp = false, eT = 0;
  for (let i = 0; i < n; i++) {
    const veh = M.veh[i], vi = M.v[i], c = M.x[i] - veh.L / 2, W = veh.m * G0;
    const mu = sim.muAtPoint(c, run) * adhesionSpeedFactor(vi);
    let ft = 0;
    if (veh.motored && M.mMot > 0) {
      ft = M.FtCmd * veh.m / M.mMot;
      if (ft > mu * W && uT > 0) { ft = mu * W; slip = true; }
    }
    M.Ft[i] = ft; ftSum += ft; eT += ft * vi;
    const k = Math.min(H - 1, Math.round(M.delay[i] / dt));
    let b = M.hist[(M.histPos - k + H) % H] * veh.m / M.M;
    const limB = mu * W * 0.95;
    if (b > limB) { if (vi > 0.5) wsp = true; b = limB; }
    const tau = b > M.Fb[i] ? TR.tauB : TR.tauR;
    M.Fb[i] += (b - M.Fb[i]) * (1 - Math.exp(-dt / Math.max(0.05, tau)));
    fbSum += M.Fb[i];
    const fg = W * gradeOf(L, c) / 1000;
    M.Fg[i] = fg; fgSum += fg;
    const radius = 1 / Math.max(1e-9, Math.abs(L.K[idxOf(L, c)]));
    const kt = tunnelOf(L, c) ? M.kGal : 1;
    const r = vi > 0.01 ? M.cA[i] + M.cB[i] * vi + M.cC[i] * kt * vi * vi + rocklPermille(radius) / 1000 * W : 0;
    M.R[i] = r; rSum += r;
  }
  M.histPos = (M.histPos + 1) % H;
  let tmax = 0, cmax = 0;
  for (let j = 0; j < n - 1; j++) {
    const t = couplerForce((M.x[j] - M.veh[j].L) - M.x[j + 1], M.v[j] - M.v[j + 1], M.cp);
    M.T[j] = t;
    if (t > tmax) tmax = t;
    if (-t > cmax) cmax = -t;
  }
  for (let i = 0; i < n; i++) {
    const net = M.Ft[i] - M.Fg[i] - (i < n - 1 ? M.T[i] : 0) + (i > 0 ? M.T[i - 1] : 0);
    const me = M.pay ? (M.veh[i].m - M.pay[i]) * TR.rot + M.pay[i] : M.veh[i].m * TR.rot;
    let a: number;
    if (M.v[i] < 0.01) { const st = M.Fb[i] + M.cA[i]; if (net > st) a = (net - st) / me; else { a = 0; M.v[i] = 0; } }
    else a = (net - M.Fb[i] - M.R[i]) / me;
    M.a[i] = a;
    M.v[i] = Math.max(0, M.v[i] + a * dt);
    M.x[i] += M.v[i] * dt;
  }
  S.Ft = ftSum; S.Fb = fbSum; S.Fg = fgSum; S.R = rSum;
  S.grade = fgSum / (M.M * G0) * 1000;
  S.slip = slip; if (slip) S.slipT += dt;
  S.wsp = wsp;
  S.Fed = vH > 1.5 && !em ? Math.min(fbSum, TR.edMax, TR.Pw / Math.max(vH, 1)) : 0;
  S.s = M.x[0]; S.v = M.v[0]; S.a = M.a[0]; S.vTail = M.v[n - 1];
  S.Tnow = tmax; S.Cnow = cmax;
  if (tmax > S.maxTension) S.maxTension = tmax;
  if (cmax > S.maxCompression) S.maxCompression = cmax;
  S.eT += eT * dt / TR.eta / 3.6e6;
  S.eR += S.Fed * vH * dt * TR.etaR / 3.6e6;
}

/** Commands that actually reach traction and brakes, after emergency, protection and doors */
export function effectiveCommands(sim: Simulation, run: TrainRun = sim.train): { uT: number; uB: number; em: boolean } {
  const S = run.S;
  let uT = S.uT, uB = S.uB, em = S.uEM;
  if (S.eb) { uT = 0; em = true; }
  if (S.sbi || sim.faults.radioBrake) { uT = 0; uB = 1; }
  const o = run.ob?.resp?.outputs;
  if (o) { if (o.emergency) { uT = 0; em = true; } if (o.service_brake) { uT = 0; uB = 1; } if (o.traction_cut_off) uT = 0; }
  // a broken-down train cannot take traction and is held by its brakes
  if (sim.time < run.heldUntil) { uT = 0; uB = Math.max(uB, 1); }
  if (uB > 0.01 || em || S.doors) uT = 0;
  return { uT, uB, em };
}

/**
 * Co-simulation: true when the next step leaves the interval already computed by the external model.
 * Whoever drives the loop must then call `dynamicsRequest()`, send it to the model and pass the response
 * to `dynamicsResponse()` before `step()`. With the internal models it is always false.
 */
export function dynamicsDue(sim: Simulation, run: TrainRun = sim.train): boolean {
  return !!run.ext && !run.S.finished && run.S.t + FIXED_DT > run.ext.t1 + 1e-9;
}

/** Request for the external model: effective commands, line around the train, faults; train parameters on the first */
export function dynamicsRequest(sim: Simulation, run: TrainRun = sim.train): DynamicsRequest {
  const S = run.S, L = sim.L, X = run.ext as ExternalState;
  const { uT, uB, em } = effectiveCommands(sim, run);
  const a = Math.max(0, S.s - run.TR.L - 50), b = Math.min(L.len, S.s + X.horizon);
  const gradients: [number, number, number][] = [];
  for (const p of L.prof) if (p.b > a && p.a < b) gradients.push([Math.max(p.a, a), Math.min(p.b, b), p.i]);
  // curves: samples of the compiled line grouped by radius rounded to 10 m; below 1/20000 m⁻¹ the track is straight
  const curve: [number, number, number][] = [];
  for (let k = Math.floor(a / STEP); k * STEP < b && k < L.N; k++) {
    const kk = Math.abs(L.K[k]);
    if (kk < 5e-5) continue;
    const r = Math.round(1 / kk / 10) * 10, s0 = Math.max(a, k * STEP), s1 = Math.min(b, (k + 1) * STEP);
    const last = curve[curve.length - 1];
    if (last && last[2] === r && Math.abs(last[1] - s0) < 1e-6) last[1] = s1; else curve.push([s0, s1, r]);
  }
  const tunnels = L.tun.filter(t => t[1] > a && t[0] < b).map(t => [Math.max(t[0], a), Math.min(t[1], b)] as [number, number]);
  const req: DynamicsRequest = {
    type: 'dynamics', version: 2, start: X.exchanges === 0, t: +S.t.toFixed(6), dt: X.period,
    state: { pos_m: S.s, vel_ms: S.v },
    commands: { traction: uT, brake: em ? 1 : uB, emergency: em, doors_open: S.doors },
    track: { from_m: a, to_m: b, adhesion_mu: sim.muAt(S.s, run), gradients, curves: curve, tunnels },
    faults: { brake_factor: run.brakeFactor, traction_factor: run.tractionFactor },
  };
  if (req.start) { req.train = JSON.parse(JSON.stringify(run.TR)) as TrainParams; req.train.m -= run.payload; }
  if (sim.pax) req.payload_kg = run.payload;
  return req;
}

/** Receives the external model response: the state at the end of the interval, which `step()` reaches by interpolation */
export function dynamicsResponse(sim: Simulation, r: DynamicsResponse, run: TrainRun = sim.train): void {
  r = toEnglish<DynamicsResponse>(r);
  const S = run.S, X = run.ext;
  if (!X) throw new Error('the train does not use an external dynamics model');
  if (!r || !isFinite(r.pos_m) || !isFinite(r.vel_ms)) throw new Error('invalid external dynamics response at t = ' + S.t.toFixed(3) + ' s: numeric pos_m and vel_ms are required');
  X.t0 = S.t; X.t1 = S.t + X.period;
  X.s0 = S.s; X.v0 = S.v;
  X.s1 = r.pos_m; X.v1 = Math.max(0, r.vel_ms);
  X.resp = r; X.exchanges++;
  if (r.note) sim.event('INFO', 'External dynamics: ' + String(r.note).slice(0, 200));
}

/** External model: the engine reaches the returned state by interpolating within the coupling interval */
function dynamicsExternal(sim: Simulation, run: TrainRun, dt: number): void {
  const S = run.S, TR = run.TR, L = sim.L, X = run.ext as ExternalState, r = X.resp;
  if (!r || S.t > X.t1 + 1e-9) throw new Error('external dynamics: response missing for t = ' + S.t.toFixed(3) + ' s (call dynamicsRequest/dynamicsResponse when dynamicsDue is true)');
  const tau = clamp((S.t - X.t0) / Math.max(1e-9, X.t1 - X.t0), 0, 1);
  S.s = X.s0 + (X.s1 - X.s0) * tau;
  S.v = X.v0 + (X.v1 - X.v0) * tau;
  S.a = r.acc_ms2 ?? (X.v1 - X.v0) / X.period;
  const f = r.forces_kN || {};
  S.Ft = (f.traction ?? 0) * 1000; S.Fb = (f.brake ?? 0) * 1000; S.Fed = (f.electric_brake ?? 0) * 1000;
  const back = Math.max(0, S.s - TR.L);
  const i = S.s - back > 1 ? (altOf(L, S.s) - altOf(L, back)) / (S.s - back) * 1000 : gradeOf(L, S.s);
  S.grade = i;
  S.Fg = f.gradient != null ? f.gradient * 1000 : TR.m * G * i / 1000;
  S.R = (f.resistance ?? 0) * 1000;
  S.slip = !!r.slip; S.wsp = !!r.wsp;
  if (S.slip) S.slipT += dt;
  S.vTail = r.tail_speed_ms ?? S.v;
  const T = r.coupler_forces_kN || [];
  let tmax = 0, cmax = 0;
  for (const x of T) { if (x > tmax) tmax = x; if (-x > cmax) cmax = -x; }
  S.Tnow = tmax * 1000; S.Cnow = cmax * 1000;
  if (S.Tnow > S.maxTension) S.maxTension = S.Tnow;
  if (S.Cnow > S.maxCompression) S.maxCompression = S.Cnow;
  if (r.traction_energy_kWh != null && tau >= 1 - 1e-9) S.eT = r.traction_energy_kWh;
  else if (r.traction_energy_kWh == null) S.eT += S.Ft * S.v * dt / TR.eta / 3.6e6;
  if (r.regenerated_energy_kWh != null && tau >= 1 - 1e-9) S.eR = r.regenerated_energy_kWh;
  else if (r.regenerated_energy_kWh == null) S.eR += S.Fed * S.v * dt * TR.etaR / 3.6e6;
}
