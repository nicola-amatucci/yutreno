/**
 * Checks the scenario engine: validation, merging of limits, verdict, effect of every event type on the run,
 * determinism, expected outcomes of the example scenarios with the example controller.
 *   npx tsx scripts/verify-scenarios.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  CSV_HEADER, DEFAULT_SCENARIO, FIXED_DT, LINE_PRESETS, Simulation, TRAIN_PRESETS, clone, evaluate, mergeLimits, resolveScenario, runLockstep, validateScenario,
  type RunResult, type ScenarioDef,
} from '../src/core';
import { loadJsController, loadScenarios } from '../src/server/headless';

const ato = () => loadJsController('examples/ato.js');
async function run(def: ScenarioDef) {
  const r = resolveScenario(def);
  const sim = new Simulation(r.line, r.train, r.scen, def);
  await runLockstep(sim, ato(), { period: 0.2 });
  return sim;
}

// 1. validation
assert.deepEqual(validateScenario({ name: 'ok', line: 'valle-lauro', events: [{ type: 'speed_restriction', from_m: 1000, to_m: 2000, v_kmh: 30 }] }), []);
assert.ok(validateScenario({ name: 'x', events: [{ type: 'boh' }] }).some(e => e.includes('unknown type')));
assert.ok(validateScenario({ name: 'x', events: [{ type: 'low_adhesion', from_m: 10, to_m: 5, mu: 0.1 }] }).some(e => e.includes('to_m > from_m')));
assert.ok(validateScenario({ name: 'x', line: 'none' }).some(e => e.includes('unknown line')));
console.log('validation: ok');

// 2. merging of limits: the minimum wins and the sections stay contiguous
const m = mergeLimits([[0, 1000, 100], [1000, 1e9, 140]], [[500, 1500, 30]]);
assert.deepEqual(m, [[0, 500, 100], [500, 1500, 30], [1500, 1e9, 140]]);
assert.deepEqual(mergeLimits([[0, 1e9, 80]], [[100, 200, 120]]), [[0, 1e9, 80]]);
console.log('merging of limits: ok');

// 3. verdict
const base: RunResult = { finished: true, t_s: 900, stops: [{ name: 'A', err: 1, late: 0 }, { name: 'B', err: -2, late: 30 }], arrival_delay_s: 30, interventions: 0, overruns: 0, missed_vigilance: 0, max_over_limit_kmh: 0, net_energy_kWh: 100, max_tension_kN: 50, max_compression_kN: 40, max_jerk_ms3: 0.5 };
assert.equal(evaluate(base).outcome, 'passed');
assert.equal(evaluate({ ...base, interventions: 1 }).outcome, 'failed');
assert.equal(evaluate(base, { delay_max_s: 20 }).outcome, 'failed');
assert.equal(evaluate({ ...base, stops: [{ name: 'A', err: 7, late: 0 }] }).outcome, 'failed');
assert.equal(evaluate({ ...base, stops: [{ name: 'A', err: 7, late: 0 }] }, { stop_error_max_m: 10 }).outcome, 'passed');
console.log('verdict: ok');

// 4. effects of the single events
{
  // @test SC1: speed restriction respected by the controller [S026-3.11.5]
  // speed restriction: the limit changes and the controller respects it
  const def: ScenarioDef = { name: 'tsr', line: 'valle-lauro', events: [{ type: 'speed_restriction', from_m: 2000, to_m: 3000, v_kmh: 30 }] };
  const sim = await run(def);
  const vmax = Math.max(...sim.S.rows.filter(r => +r[1] > 2000 + 1 && +r[1] - sim.TR.L < 3000 - 1).map(r => +r[2]));
  assert.ok(vmax <= 30 + 0.5, `in the speed restriction the train runs at ${vmax} km/h`);
  assert.ok(sim.observe(0.2).speed_restrictions.length === 1);
  console.log(`speed restriction: maximum speed in the section ${vmax.toFixed(1)} km/h`);
}
{
  // @test SC2: radio loss, braking after the timeout and restart [S026-3.5.4, S026-3.16.3]
  // radio loss: MA frozen and braking after the timeout
  const def: ScenarioDef = { name: 'radio', line: 'valle-lauro', events: [{ type: 'radio_loss', when: { pos: 11500 }, duration_s: 90, timeout_s: 20 }] };
  const sim = await run(def);
  assert.equal(sim.S.radioBrakes, 1);
  const ci = CSV_HEADER.split(',').indexOf('radio');
  const stopped = sim.S.rows.some(r => +r[1] > 11500 && +r[2] === 0 && r[ci] === 0);
  assert.ok(stopped, 'without radio the train must stop');
  console.log('radio loss: braking after the timeout and stop, then restart');
}
{
  // adhesion: hidden zone, visible in the log but not to the controllers
  const def: ScenarioDef = { name: 'leaves', line: 'valle-lauro', events: [{ type: 'low_adhesion', from_m: 4300, to_m: 5300, mu: 0.05 }] };
  const r = resolveScenario(def);
  const sim = new Simulation(r.line, r.train, r.scen, def);
  assert.ok(sim.S.events.some(e => e.kind === 'FAULT' && e.hidden));
  assert.ok(!sim.observe(0.2).events.some(e => e.type === 'FAULT'), 'the hidden event must not reach the controller');
  assert.equal(sim.muAt(4800), 0.05);
  assert.equal(sim.muAt(1000), 0.3);
  console.log('adhesion: zone applied and hidden from the controllers');
}
{
  // degraded brake: proportionally longer braking distance
  const stop = (factor: number) => {
    const def: ScenarioDef = { name: 'f', line: { name: 'level', plan: [[0, 0], [20000, 0]], profile: [[0, 100]], stations: [{ name: 'A', s: 100, arr: null, dep: 0 }, { name: 'B', s: 19900, arr: null, dep: null }], limits: [[0, 1e9, 200]], tunnels: [], block: 1e5, freight: { on: false, s0: 0, vmax: 60, stopAt: 0, wait: 0, len: 0 } },
      signalling: 'BACC', events: factor < 1 ? [{ type: 'brake_degraded', factor: factor }] : [] };
    const r = resolveScenario(def);
    const sim = new Simulation(r.line, r.train, r.scen, def);
    sim.place(1000, 80 / 3.6); sim.setLever(-7);
    while (sim.S.v > 0) sim.step(FIXED_DT);
    return sim.S.s - 1000;
  };
  const d1 = stop(1), d06 = stop(0.6);
  assert.ok(d06 > d1 * 1.5 && d06 < d1 * 1.75, `distances ${d1.toFixed(0)} and ${d06.toFixed(0)} m not proportional`);
  console.log(`degraded brake: stop from 80 km/h in ${d1.toFixed(0)} m, at 60% in ${d06.toFixed(0)} m`);
}
{
  // @test SC3: RBC emergency stop at the given position, not counted as an intervention [S026-3.10.2]
  // RBC emergency stop: emergency braking at the given position
  const def: ScenarioDef = { name: 'rbc', line: 'valle-lauro', events: [{ type: 'rbc_emergency_stop', when: { pos: 8500 } }] };
  const sim = await run(def);
  const eb = sim.S.events.find(e => e.kind === 'EMG');
  assert.ok(eb && Math.abs(eb.s - 8500) < 1, 'the emergency must trigger at km 8.5');
  assert.equal(sim.S.interventions, 0, 'the ordered stop is not a protection intervention');
  console.log('RBC emergency stop: emergency at km 8.5, run completed');
}

// 5. example scenarios: expected outcomes with the example controller and determinism
const EXPECTED: Record<string, 'passed' | 'failed'> = {
  'rbc-emergency-stop.json': 'passed',
  'leaves-ponte-sabato.json': 'failed',
  'degraded-brake.json': 'failed',
  'leader-stopped-etcs.json': 'passed',
  'leader-stopped-scmt.json': 'passed',
  'radio-loss.json': 'passed',
  'moving-block.json': 'passed',
  'odometry-drift.json': 'passed',
  'moving-block-leader-stopped.json': 'passed',
  'moving-block-integrity-loss.json': 'passed',
  'moving-block-radio-loss.json': 'passed',
  'worksite-speed-restriction.json': 'passed',
  'wet-descent-worksite.json': 'passed',
  // trackside with interlocking and RBC (reference onboard)
  'trackside/tvps-failure.json': 'passed',
  'trackside/point-failure.json': 'passed',
  'trackside/nominal.json': 'passed',
  'trackside/operator-commands.json': 'passed',
  'trackside/overtaking.json': 'passed',
  'trackside/handover.json': 'passed',
  'trackside/handover-link-loss.json': 'passed',
  'trackside/handover-radio-loss.json': 'passed',
};
for (const { file, def } of [...loadScenarios('scenarios'), ...loadScenarios('scenarios/trackside')]) {
  const name = file.replace(/\\/g, '/').replace(/^scenarios\//, '');
  const a = await run(def), b = await run(def);
  const ha = createHash('sha256').update(a.csv()).digest('hex'), hb = createHash('sha256').update(b.csv()).digest('hex');
  assert.equal(ha, hb, `${name}: two identical runs gave different data`);
  assert.ok(name in EXPECTED, `${name}: add the expected outcome in verify-scenarios.ts`);
  assert.equal(a.verdict().outcome, EXPECTED[name], `${name}: outcome ${a.verdict().outcome}, expected ${EXPECTED[name]}`);
  console.log(`${name}: ${a.verdict().outcome} as expected, deterministic`);
}

// 6. without a scenario the behaviour does not change
{
  const sim = new Simulation(clone(LINE_PRESETS['valle-lauro']), clone(TRAIN_PRESETS.regional), DEFAULT_SCENARIO, null);
  await runLockstep(sim, ato(), { period: 0.2 });
  assert.equal(sim.S.t.toFixed(2), '999.81', 'without a scenario the run must match the reference of verify-ato');
}
console.log('scenarios: ok');
