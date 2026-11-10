/**
 * Checks the train dynamics on elementary tests with results known in closed form, both with the point mass and
 * with the multi-mass model.
 *   npx tsx scripts/verify-physics.ts
 */
import assert from 'node:assert/strict';
import { DEFAULT_SCENARIO, FIXED_DT, Simulation, TRAIN_PRESETS, clone, type DynamicsModel, type LineDef, type Scenario, type TrainParams } from '../src/core';

const flat = (grade = 0, len = 30000): LineDef => ({
  name: 'test bench', plan: [[0, 0], [len, 0]], profile: [[0, 100], [len, 100 + len * grade / 1000]],
  stations: [{ name: 'A', s: 100, arr: null, dep: 0 }, { name: 'B', s: len - 100, arr: null, dep: null }],
  limits: [[0, 1e9, 400]], tunnels: [], block: 100000, freight: { on: false, s0: 0, vmax: 60, stopAt: 0, wait: 0, len: 0 },
});
// Automatic block without intermediate signals: no supervision interfering with the tests
const scen: Scenario = { ...DEFAULT_SCENARIO, sig: 'BACC' };
const runFor = (sim: Simulation, seconds: number) => { const n = Math.round(seconds / FIXED_DT); for (let i = 0; i < n && !sim.S.finished; i++) { sim.step(); if (sim.S.vigAlarm) sim.vigilance(); } };

for (const model of ['point', 'multimass'] as DynamicsModel[]) {
const T = (id: string): TrainParams => ({ ...clone(TRAIN_PRESETS[id]), model: model });
// 1. stop from 100 km/h with full service brake: v²/2a plus the application time
{
  const tr = T('regional');
  const sim = new Simulation(flat(), tr, scen);
  sim.place(1000, 100 / 3.6);
  sim.setLever(-7);
  const s0 = sim.S.s;
  while (sim.S.v > 0) { sim.step(); }
  const d = sim.S.s - s0, ideal = (100 / 3.6) ** 2 / (2 * tr.bSvc);
  console.log(`[${model}] stop from 100 km/h: ${d.toFixed(0)} m (ideal without delay ${ideal.toFixed(0)} m)`);
  assert.ok(d > ideal && d < ideal + 100 / 3.6 * 2.5, 'braking distance outside the expected interval');
}

// 2. balancing speed on level track at full traction: where effort and resistance are equal
{
  const tr = T('regional');
  tr.vmax = 400 / 3.6;
  const sim = new Simulation(flat(0, 80000), tr, scen);
  sim.setLever(10);
  runFor(sim, 1500);
  let vb = 0;
  for (let v = 1; v < 120; v += 0.01) if (Math.min(tr.Fmax, tr.Pw / v) < tr.A + tr.B * v + tr.C * v * v) { vb = v; break; }
  console.log(`[${model}] balancing speed on level track: ${(sim.S.v * 3.6).toFixed(1)} km/h simulated, ${(vb * 3.6).toFixed(1)} km/h theoretical`);
  assert.ok(Math.abs(sim.S.v - vb) < 0.5, 'balancing speed differs from the theoretical value');
}

// 3. the heavy freight train cannot start on 25 ‰ (adhesion of the locomotive alone is insufficient)
{
  const sim = new Simulation(flat(25), T('freight'), scen);
  sim.setLever(10);
  runFor(sim, 120);
  console.log(`[${model}] freight on 25 ‰: ${(sim.S.s - 100).toFixed(1)} m travelled in 120 s, wheel slip ${sim.S.slipT.toFixed(0)} s`);
  assert.ok(sim.S.s - 100 < 1 && sim.S.slip, 'the heavy freight train should not be able to start on 25 ‰');
}

// 4. the regional train climbs the 25 ‰ and the average gradient under the train is 25 ‰
{
  const sim = new Simulation(flat(25), T('regional'), scen);
  sim.setLever(10);
  runFor(sim, 120);
  assert.ok(sim.S.v > 15, 'the regional train should climb the 25 ‰');
  assert.ok(Math.abs(sim.S.grade - 25) < 1e-6);
  console.log(`[${model}] regional on 25 ‰: ${(sim.S.v * 3.6).toFixed(0)} km/h after 120 s`);
}

// 5. on rails with leaves braking is limited by adhesion and WSP acts
{
  const sim = new Simulation(flat(), T('regional'), { ...scen, adh: 'leaves' });
  sim.place(1000, 80 / 3.6);
  sim.setLever(-7);
  let wsp = false;
  const s0 = sim.S.s;
  while (sim.S.v > 0) { sim.step(); wsp = wsp || sim.S.wsp; }
  const d = sim.S.s - s0, minD = (80 / 3.6) ** 2 / (2 * 0.09 * 9.81 * 0.95 / 1.08);
  console.log(`[${model}] stop from 80 km/h with leaves: ${d.toFixed(0)} m (adhesion minimum ${minD.toFixed(0)} m)`);
  assert.ok(wsp && d >= minD * 0.99, 'with leaves braking must be limited by adhesion');
}
}
console.log('physics: ok');
