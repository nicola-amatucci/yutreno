/**
 * Lets the example controller drive on all combinations of line and signalling.
 * Checks that the run completes without protection interventions, that the stops are accurate, that two equal runs
 * give identical data and that the results match the reference values. If a physics change alters the references on
 * purpose, update REFERENCE in the same commit and explain why in the message.
 * Then the model of a human driver of examples/driver_model.js (docs/DRIVER_MODEL.md): the same seed gives the same
 * run and another seed a different one; an ideal driver stays below the warning curve, a slow one gets warnings and
 * service brakings from the protection.
 *   npx tsx scripts/verify-ato.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DEFAULT_SCENARIO, LINE_PRESETS, Simulation, TRAIN_PRESETS, clone, runLockstep, type DynamicsModel, type Signalling } from '../src/core';
import { loadJsController } from '../src/server/headless';

/**
 * Reference values: arrival time (s) and net energy (kWh).
 * The point mass kept the values of the first version of the core, showing that introducing the multi-mass model
 * did not change it, until the train ahead of valle-lauro and appennino became a freight service train (7 November
 * 2026, decision 12): the controlled train now follows a slower train, and the lines without a train ahead keep them. The multi-mass model consumes a little more because of curve and tunnel resistance and of the
 * adhesion that decreases with speed.
 */
const REFERENCE: Record<string, { t: number; e: number }> = {
  'point/valle-lauro/ETCS': { t: 999.8, e: 111.97 },
  'point/valle-lauro/BACC': { t: 996.95, e: 105.56 },
  'point/appennino/ETCS': { t: 1355.7, e: 191.49 },
  'point/appennino/BACC': { t: 1352.92, e: 187.73 },
  'point/rocca-sabato/ETCS': { t: 509.56, e: 49.18 },
  'point/rocca-sabato/BACC': { t: 507.75, e: 49.26 },
  'point/ponte-pietrarsa/ETCS': { t: 509.14, e: 59.00 },
  'point/ponte-pietrarsa/BACC': { t: 507.41, e: 58.23 },
  'multimass/valle-lauro/ETCS': { t: 999.81, e: 112.51 },
  'multimass/valle-lauro/BACC': { t: 996.95, e: 106.13 },
  'multimass/appennino/ETCS': { t: 1355.75, e: 194.07 },
  'multimass/appennino/BACC': { t: 1352.98, e: 190.37 },
  'multimass/rocca-sabato/ETCS': { t: 509.59, e: 50.38 },
  'multimass/rocca-sabato/BACC': { t: 507.78, e: 50.46 },
  'multimass/ponte-pietrarsa/ETCS': { t: 509.13, e: 58.99 },
  'multimass/ponte-pietrarsa/BACC': { t: 507.4, e: 58.22 },
};

async function run(model: DynamicsModel, line: string, sig: Signalling) {
  const sim = new Simulation(clone(LINE_PRESETS[line]), { ...clone(TRAIN_PRESETS.regional), model: model }, { ...DEFAULT_SCENARIO, sig });
  await runLockstep(sim, loadJsController('examples/ato.js'), { period: 0.2, source: 'ato' });
  return sim;
}

for (const model of ['point', 'multimass'] as DynamicsModel[]) for (const line of Object.keys(LINE_PRESETS)) {
  for (const sig of ['ETCS', 'BACC'] as Signalling[]) {
    const key = `${model}/${line}/${sig}`;
    const a = await run(model, line, sig), b = await run(model, line, sig);
    const s = a.summary();
    assert.ok(s.finished, `${key}: run not completed`);
    assert.equal(s.interventions, 0, `${key}: protection interventions`);
    assert.equal(s.overruns, 0, `${key}: red signal or end of authority passed`);
    for (const f of s.stops) assert.ok(f.err != null && Math.abs(f.err) < 3, `${key}: inaccurate stop at ${f.name} (${f.err})`);
    const ha = createHash('sha256').update(a.csv()).digest('hex'), hb = createHash('sha256').update(b.csv()).digest('hex');
    assert.equal(ha, hb, `${key}: two identical runs gave different data`);
    const e = s.traction_energy_kWh - s.regenerated_energy_kWh, ref = REFERENCE[key];
    if (process.env.PRINT_REF || process.env.STAMPA_RIF) console.log(`  REF ${key}: { t: ${s.t_s}, e: ${e.toFixed(2)} }`);
    else assert.ok(Math.abs(s.t_s - ref.t) < 0.05 && Math.abs(e - ref.e) < 0.05, `${key}: result ${s.t_s} s / ${e.toFixed(2)} kWh differs from the reference ${ref.t} s / ${ref.e} kWh`);
    console.log(`${key}: arrival ${s.t_s} s, stops ${s.stops.map(f => f.err).join(' / ')} m, net energy ${e.toFixed(2)} kWh, deterministic`);
  }
}
console.log('example controller: ok');

// @test DRV1: model of a human driver, the same seed gives the same run and another seed a different one [YT-DRIVER]
async function drive(line: string, params: Record<string, unknown>) {
  const L = clone(LINE_PRESETS[line]);
  if (L.freight) L.freight.on = false;
  const sim = new Simulation(L, clone(TRAIN_PRESETS.regional), { ...DEFAULT_SCENARIO, sig: 'ETCS' });
  const ctl = loadJsController('examples/driver_model.js', { PARAMS: params });
  let overWarning = -Infinity;
  await runLockstep(sim, o => {
    if (o.supervision.v_warning_ms != null) overWarning = Math.max(overWarning, o.vel_ms - o.supervision.v_warning_ms);
    return ctl(o);
  }, { period: 0.2, source: 'driver' });
  return { sim, s: sim.summary(), hash: createHash('sha256').update(sim.csv() + JSON.stringify(sim.S.events)).digest('hex'), overWarning_kmh: overWarning * 3.6 };
}
{
  const hashes: string[] = [];
  for (const profile of ['cautious', 'medium', 'aggressive']) {
    const a = await drive('valle-lauro', { profile, seed: 1 }), b = await drive('valle-lauro', { profile, seed: 1 }), c = await drive('valle-lauro', { profile, seed: 2 });
    assert.ok(a.s.finished && a.s.overruns === 0, `driver ${profile}: run not completed or end of authority passed`);
    assert.equal(a.hash, b.hash, `driver ${profile}: the same seed gave two different runs`);
    assert.notEqual(a.hash, c.hash, `driver ${profile}: two seeds gave the same run`);
    hashes.push(a.hash);
    console.log(`driver ${profile}: arrival ${a.s.t_s} s, net energy ${(a.s.traction_energy_kWh - a.s.regenerated_energy_kWh).toFixed(2)} kWh, warnings ${a.s.warnings}; seed 1 twice the same, seed 2 different`);
  }
  assert.equal(new Set(hashes).size, 3, 'two driving profiles gave the same run');
}

// @test DRV2: model of a human driver, an ideal one stays between its curves, a slow one is caught by the protection [YT-DRIVER]
for (const line of ['appennino', 'valle-lauro']) {
  const ideal = await drive(line, { profile: 'medium', margin_sd_kmh: 0, response_base_per_s: 1000, response_growth_per_s2: 0 });
  assert.ok(ideal.overWarning_kmh < 0 && ideal.s.warnings === 0 && ideal.s.service_brakings === 0 && ideal.s.interventions === 0,
    `${line}: an ideal driver went ${ideal.overWarning_kmh.toFixed(2)} km/h over the warning curve, warnings ${ideal.s.warnings}, service brakings ${ideal.s.service_brakings}`);
  const slow = await drive(line, { profile: 'medium', response_base_per_s: 0.02, response_growth_per_s2: 0.005 });
  assert.ok(slow.s.warnings > 0 && slow.s.service_brakings + slow.s.interventions > 0, `${line}: a slow driver got no warning or no braking from the protection`);
  console.log(`driver on ${line}: ideal never closer than ${(-ideal.overWarning_kmh).toFixed(1)} km/h to the warning curve, no warning; slow ${slow.s.warnings} warnings, ${slow.s.service_brakings} service brakings, ${slow.s.interventions} interventions`);
}
console.log('model of a human driver: ok');
