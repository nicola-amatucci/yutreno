/**
 * Checks the multi-mass model.
 *   1. Two-mass toy train (Gîlcă and Borcoși 2019; CTMS Michigan): steady-state speed with a proportional
 *      regulator, steady-state coupler force, natural frequency.
 *   2. Static equilibrium: a braked train stays still on a gradient.
 *   3. Pneumatic and electro-pneumatic brake: the propagation along the brake pipe compresses the long freight train.
 *   4. Convergence: halving the step does not change the braking distance.
 *   5. Consistency with the point mass for a train with rigid couplers.
 *   6. Curve resistance (Röckl) and adhesion (Curtius and Kniffler).
 *   npx tsx scripts/verify-dynamics.ts
 */
import assert from 'node:assert/strict';
import {
  DEFAULT_SCENARIO, FIXED_DT, Simulation, TRAIN_PRESETS, adhesionSpeedFactor, clone, curtiusKniffler, rocklPermille, runLockstep,
  type LineDef, type Scenario, type TrainParams,
} from '../src/core';

const G = 9.81;
const straight = (len = 30000, grade = 0, plan?: [number, number][]): LineDef => ({
  name: 'test bench', plan: plan ?? [[0, 0], [len, 0]], profile: [[0, 100], [len, 100 + len * grade / 1000]],
  stations: [{ name: 'A', s: 600, arr: null, dep: 0 }, { name: 'B', s: len - 100, arr: null, dep: null }],
  limits: [[0, 1e9, 400]], tunnels: [], block: 1e6, freight: { on: false, s0: 0, vmax: 60, stopAt: 0, wait: 0, len: 0 },
});
const scen: Scenario = { ...DEFAULT_SCENARIO, sig: 'BACC' };

// 1. toy train: M1 = 1 kg, M2 = 0.5 kg, k = 1 N/m, viscous friction μ·g·m·v with μ = 0.02 s/m
{
  const mu = 0.02, M1 = 1, M2 = 0.5;
  const toy: TrainParams = {
    name: 'toy train', model: 'multimass', m: 1.5, rot: 1, L: 0.6, Pw: 1e9, Fmax: 1000, adh: 1, A: 0, B: mu * G * (M1 + M2), C: 0,
    bSvc: 1, bEm: 1, tauB: 0.1, tauR: 0.1, eta: 1, edMax: 0, etaR: 0, vmax: 100,
    consist: [{ name: 'Locomotive', m: M1, L: 0.3, motored: true }, { name: 'Wagon', m: M2, L: 0.3, motored: false }],
    coupler: { k: 1, c: 0, slack: 0 }, epBrake: true,
  };
  const sim = new Simulation(straight(), toy, scen);
  // proportional regulator P = 1 on the locomotive speed, reference 1 m/s after 10 s as in the cited paper
  let maxV = 0;
  await runLockstep(sim, o => {
    const r = o.t >= 10 ? 1 : 0, F = Math.max(0, 1 * (r - o.vel_ms));
    maxV = Math.max(maxV, o.vel_ms);
    return { traction: F / 1000, vigilance: true };
  }, { period: 0.01, maxTime: 150 });
  const vss = 1 / (1 + mu * G * (M1 + M2));
  const Tss = mu * G * M2 * vss;
  const T = sim.mm!.T[0];
  console.log(`toy train: steady-state speed ${sim.S.v.toFixed(4)} m/s (theoretical ${vss.toFixed(4)}; the cited paper, with g = 9.8, shows about 0.77), ` +
    `coupler ${T.toFixed(4)} N (theoretical ${Tss.toFixed(4)}), peak ${maxV.toFixed(3)} m/s`);
  assert.ok(Math.abs(sim.S.v - vss) < 0.002, 'steady-state speed differs from the theoretical value');
  assert.ok(Math.abs(T - Tss) < 0.002, 'steady-state coupler force differs from the theoretical value');
  assert.ok(maxV > vss * 1.01 && maxV < 0.85, 'the oscillating overshoot shown in figure 6 of the cited paper is missing');

  // natural frequency: constant force on a free chain, period of the relative oscillation 2π/√(k(1/M1+1/M2))
  const sim2 = new Simulation(straight(), { ...toy, B: 0 }, scen);
  const crossings: number[] = [];
  let prev = 0;
  for (let i = 0; i < 4000; i++) {
    sim2.applyCommand({ traction: 0.001, vigilance: true });
    sim2.step(FIXED_DT);
    const dv = sim2.mm!.v[0] - sim2.mm!.v[1];
    if (i > 0 && prev < 0 && dv >= 0) crossings.push(sim2.S.t);
    prev = dv;
  }
  const period = (crossings[crossings.length - 1] - crossings[0]) / (crossings.length - 1);
  const theory = 2 * Math.PI / Math.sqrt(1 * (1 / M1 + 1 / M2));
  console.log(`toy train: oscillation period ${period.toFixed(3)} s (theoretical ${theory.toFixed(3)} s)`);
  assert.ok(Math.abs(period - theory) / theory < 0.01);
}

// 2. static equilibrium: braked regional train standing on 25 ‰
{
  const sim = new Simulation(straight(30000, 25), clone(TRAIN_PRESETS.regional), scen);
  sim.setLever(-4);
  for (let i = 0; i < 2000; i++) { sim.step(); if (sim.S.vigAlarm) sim.vigilance(); }
  assert.equal(sim.S.v, 0);
  assert.ok(Math.abs(sim.S.s - 600) < 1e-9, 'the braked train must not move');
  console.log('static equilibrium on 25 ‰: standing');
}

// 3. pneumatic and electro-pneumatic brake on the long freight train
async function emergencyFromSpeed(tr: TrainParams, v0: number, dt = FIXED_DT) {
  const sim = new Simulation(straight(), tr, scen);
  sim.place(600, v0);
  sim.setLever(-8);
  const s0 = sim.S.s;
  let t = 0;
  while (sim.S.v > 0 || sim.S.vTail > 0) { sim.step(dt); t += dt; if (t > 300) break; }
  return { d: sim.S.s - s0, comp: sim.S.maxCompression / 1000, tens: sim.S.maxTension / 1000, sim };
}
{
  const pneu = await emergencyFromSpeed(clone(TRAIN_PRESETS.freight), 80 / 3.6);
  const ep = await emergencyFromSpeed({ ...clone(TRAIN_PRESETS.freight), epBrake: true }, 80 / 3.6);
  console.log(`freight, emergency from 80 km/h: pneumatic ${pneu.d.toFixed(0)} m and maximum compression ${pneu.comp.toFixed(0)} kN; ` +
    `electro-pneumatic ${ep.d.toFixed(0)} m and ${ep.comp.toFixed(0)} kN`);
  assert.ok(pneu.comp > 3 * ep.comp, 'the pneumatic brake propagation must compress the train much more than the electro-pneumatic brake');
  assert.ok(pneu.d > ep.d, 'with propagation the train stops further away');

  // 4. convergence: halved step, same braking distance within 0.5%
  const half = await emergencyFromSpeed(clone(TRAIN_PRESETS.freight), 80 / 3.6, FIXED_DT / 2);
  console.log(`convergence: ${pneu.d.toFixed(1)} m with 5 ms, ${half.d.toFixed(1)} m with 2.5 ms`);
  assert.ok(Math.abs(half.d - pneu.d) / pneu.d < 0.005);
}

// 5. the regional train with rigid couplers behaves like the point mass
{
  const multi = await emergencyFromSpeed(clone(TRAIN_PRESETS.regional), 100 / 3.6);
  const p = new Simulation(straight(), { ...clone(TRAIN_PRESETS.regional), model: 'point' }, scen);
  p.place(600, 100 / 3.6); p.setLever(-8);
  const s0 = p.S.s;
  while (p.S.v > 0) p.step();
  const dp = p.S.s - s0;
  console.log(`regional, emergency from 100 km/h: multi-mass ${multi.d.toFixed(1)} m, point mass ${dp.toFixed(1)} m`);
  assert.ok(Math.abs(multi.d - dp) / dp < 0.03);
}

// 6. empirical laws
assert.ok(Math.abs(rocklPermille(500) - 650 / 445) < 1e-12);
assert.ok(Math.abs(rocklPermille(250) - 500 / 220) < 1e-12);
assert.equal(rocklPermille(Infinity), 0);
assert.ok(Math.abs(curtiusKniffler(0) - (0.161 + 7.5 / 44)) < 1e-12);
assert.ok(Math.abs(adhesionSpeedFactor(100 / 3.6) - curtiusKniffler(100) / curtiusKniffler(0)) < 1e-12);
{
  // in a 500 m curve the coasting train slows down more than on straight track
  const plan: [number, number][] = [];
  for (let k = 0; k <= 60; k++) { const th = k / 60 * Math.PI; plan.push([500 * Math.sin(th), 500 - 500 * Math.cos(th)]); }
  const coast = (line: LineDef) => {
    const sim = new Simulation(line, clone(TRAIN_PRESETS.regional), scen);
    sim.place(600, 15);
    for (let i = 0; i < 2000; i++) sim.step();
    return sim.S.v;
  };
  const vs = coast(straight(3000)), vc = coast(straight(0, 0, plan));
  console.log(`coasting for 10 s from 54 km/h: straight ${(vs * 3.6).toFixed(2)} km/h, 500 m curve ${(vc * 3.6).toFixed(2)} km/h`);
  assert.ok(vc < vs - 0.01);
}
console.log('multi-mass dynamics: ok');
