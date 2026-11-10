/**
 * Checks the data for ATO (Subset-130) and the ATO that uses them.
 *  1. API versions: version 1 stays as before (no etcs_ato), version 2 adds etcs_ato in FS and null with automatic
 *     block, version 3 is version 2 with English names.
 *  2. N_LOC_EBI is the point where the protection really intervenes: a driver who keeps a constant speed and never
 *     brakes is stopped where the onboard announced it, with the internal supervision and with the reference onboard.
 *  3. The reference onboard as an external process provides the same ATO data as the one in the core.
 *  4. The Subset-130 ATO drives without interventions on all lines with both onboards; its consumption depends on the
 *     onboard much less than that of the simple ATO; with the degraded brake it avoids the interventions of the
 *     reference onboard.
 * Requirements: see the @test tags and docs/traceability/tests.csv.
 *   npx tsx scripts/verify-ato-s130.ts
 */
import assert from 'node:assert/strict';
import {
  DEFAULT_SCENARIO, LINE_PRESETS, Simulation, TRAIN_PRESETS, clone, resolveScenario, runLockstep, toEnglish, toLegacy,
  type Observation, type OnboardKind, type OnboardRequest, type OnboardResponse,
} from '../src/core';
import { loadJsController, loadScenarios, openChannel } from '../src/server/headless';

// @test A1: observation versions, etcs_ato only from version 2, legacy names kept [S130-Transport-cycles-and-timeouts]
// 1: API versions
{
  const sim = new Simulation(clone(LINE_PRESETS['valle-lauro']), clone(TRAIN_PRESETS.regional), { ...DEFAULT_SCENARIO });
  for (let k = 0; k < 2000; k++) sim.step();
  // versions 1 and 2 have the Italian names of version 0.x
  const o1 = sim.observe(0.2, 1) as unknown as Record<string, unknown>, o2 = sim.observe(0.2, 2) as unknown as Record<string, unknown>;
  assert.equal(o1.versione, 1);
  assert.ok(!('etcs_ato' in o1), 'version 1 has no etcs_ato');
  assert.equal(o2.versione, 2);
  // the first observation consumes the events: the other fields are compared
  const { versione: _a, etcs_ato: e0, eventi: _c, ...rest2 } = o2, { versione: _b, eventi: _d, ...rest1 } = o1;
  assert.deepEqual(rest2, rest1, 'version 2 contains all the fields of version 1, equal');
  const e = e0 as Observation['etcs_ato'];
  assert.ok(e && e.M_MODE === 'FS' && e.N_LOC_EOALOA != null && e.A_BRAKE_SAFE! > 0 && e.MRSP.length > 0, 'in FS etcs_ato is complete');
  const bacc = new Simulation(clone(LINE_PRESETS['valle-lauro']), clone(TRAIN_PRESETS.regional), { ...DEFAULT_SCENARIO, sig: 'BACC' });
  assert.equal(bacc.observe(0.2).etcs_ato, null, 'with automatic block etcs_ato is null');
  const o3 = sim.observe(0.2), o2b = sim.observe(0.2, 2);
  assert.equal(o3.version, 3);
  assert.deepEqual(toLegacy({ ...o3, version: 2 }, 'observation'), o2b, 'version 2 is version 3 with the legacy names');
  assert.deepEqual(toEnglish({ ...o2b, version: 3 }), o3, 'version 3 is version 2 with the English names');
  console.log('API versions: ok');
}

// @test A2: the protection intervenes where N_LOC_EBI announced it [S130-Packet-6-N_LOC_EBI, S026-3.13.9.3.2.12-c]
// 2: a driver at constant speed who never brakes is stopped where N_LOC_EBI announced it.
// The brake is almost ineffective (factor 0.02): the service braking commanded at the SBI does not slow the train
// down, which thus reaches the EBI at the speed for which the onboard announced it.
for (const onboard of ['internal', 'reference'] as OnboardKind[]) {
  const def = { name: 'ineffective brake', line: 'valle-lauro', train: 'regional', events: [{ type: 'brake_degraded' as const, factor: 0.02 }] };
  const r = resolveScenario(def);
  const sim = new Simulation(r.line, r.train, { ...r.scen, onboard: onboard }, def);
  const VC = 22;  // m/s, below all line limits after the first 800 m
  let predicted: number | null = null;
  await runLockstep(sim, (o: Observation) => {
    if (o.emergency) return { traction: 0, brake: 0 };
    if (Math.abs(o.vel_ms - VC) < 0.3 && o.etcs_ato?.N_LOC_EBI != null) predicted = o.etcs_ato.N_LOC_EBI;
    return { traction: Math.max(0, Math.min(1, (VC - o.vel_ms) * 0.8)), brake: 0, vigilance: o.vigilance_alarm };
  }, { period: 0.1, maxTime: 400 });
  const ev = sim.S.events.find(x => x.kind === 'EMG');
  assert.ok(ev && /intervention/.test(ev.text) && predicted != null, `${onboard}: the protection intervenes for the EBI curve and the EBI had been announced`);
  const err = ev!.s - (predicted as number);
  // tolerance: one onboard cycle and one controller cycle at constant speed, plus the location uncertainty
  assert.ok(Math.abs(err) < VC * 0.3 + 5, `${onboard}: intervention at ${ev!.s.toFixed(1)} m, announced at ${(predicted as number).toFixed(1)} m`);
  console.log(`${onboard}: intervention at ${ev!.s.toFixed(1)} m, N_LOC_EBI announced at ${(predicted as number).toFixed(1)} m (deviation ${err.toFixed(1)} m)`);
}

// @test A3: same Subset-130 data from the onboard as an external process [S130-Transport-cycles-and-timeouts, S026-3.15.11]
// 3: same ATO data from the external onboard
{
  const mk = () => new Simulation(clone(LINE_PRESETS['appennino']), clone(TRAIN_PRESETS.regional), { ...DEFAULT_SCENARIO, onboard: 'reference' });
  const a = mk(), seenA: string[] = [];
  await runLockstep(a, o => { seenA.push(JSON.stringify(o.etcs_ato)); return { traction: o.vel_ms < 15 ? 1 : 0 }; }, { period: 0.2, maxTime: 120 });
  const b = new Simulation(clone(LINE_PRESETS['appennino']), clone(TRAIN_PRESETS.regional), { ...DEFAULT_SCENARIO, onboard: 'external' }), seenB: string[] = [];
  const ch = await openChannel<OnboardRequest, OnboardResponse>('exec:npx --no-install tsx examples/onboard/onboard_stdio.ts', 'the ETCS onboard');
  try { await runLockstep(b, o => { seenB.push(JSON.stringify(o.etcs_ato)); return { traction: o.vel_ms < 15 ? 1 : 0 }; }, { period: 0.2, maxTime: 120, onboard: ch.call }); } finally { ch.close(); }
  assert.deepEqual(seenB, seenA, 'etcs_ato identical with the internal and the external onboard');
  console.log(`External onboard: etcs_ato identical in ${seenA.length} observations`);
}

// @test A4: the Subset-130 ATO drives without interventions using the onboard data [S026-3.15.11, S130-Packet-6-V_PERMITTED, S130-Packet-6-V_MRSP-and-iterations-N_LOC_MRSP, S130-Packet-11-A_BRAKE_SAFE, S130-Packet-6-A_GRADIENT-and-iterations]
// 4: the Subset-130 ATO
async function run(line: string, onboard: OnboardKind, ato: string, scenario?: string) {
  if (scenario) {
    const def = loadScenarios(scenario)[0].def, r = resolveScenario(def);
    const sim = new Simulation(r.line, r.train, { ...r.scen, onboard: onboard }, def);
    await runLockstep(sim, loadJsController(ato), { period: 0.2 });
    return sim;
  }
  const sim = new Simulation(clone(LINE_PRESETS[line]), clone(TRAIN_PRESETS.regional), { ...DEFAULT_SCENARIO, onboard: onboard });
  await runLockstep(sim, loadJsController(ato), { period: 0.2 });
  return sim;
}
for (const line of Object.keys(LINE_PRESETS)) {
  const e: Record<string, number> = {};
  for (const onboard of ['internal', 'reference'] as OnboardKind[]) for (const ato of ['examples/ato.js', 'examples/ato_s130.js']) {
    const sim = await run(line, onboard, ato), s = sim.summary();
    e[onboard + ' ' + ato] = sim.result().net_energy_kWh;
    if (ato.includes('s130')) {
      assert.equal(s.outcome, 'passed', `${line} ${onboard}: the Subset-130 ATO completes the run (${s.checks.filter(c => !c.ok).map(c => c.name).join(', ')})`);
      assert.equal(s.interventions + s.service_brakings, 0, `${line} ${onboard}: no intervention with the Subset-130 ATO`);
    }
  }
  const dS = Math.abs(e['reference examples/ato.js'] / e['internal examples/ato.js'] - 1);
  const d130 = Math.abs(e['reference examples/ato_s130.js'] / e['internal examples/ato_s130.js'] - 1);
  assert.ok(d130 < dS / 3, `${line}: with the Subset-130 ATO the consumption depends much less on the onboard (${(d130 * 100).toFixed(1)}% against ${(dS * 100).toFixed(1)}%)`);
  console.log(`${line}: energy difference between onboards ${(dS * 100).toFixed(1)}% with the simple ATO, ${(d130 * 100).toFixed(1)}% with the Subset-130 ATO`);
}
{
  const a = await run('', 'reference', 'examples/ato.js', 'scenarios/degraded-brake.json');
  const b = await run('', 'reference', 'examples/ato_s130.js', 'scenarios/degraded-brake.json');
  assert.ok(a.S.interventions > 0, 'with the degraded brake the simple ATO causes interventions of the reference onboard');
  assert.equal(b.S.interventions, 0, 'the Subset-130 ATO avoids them');
  console.log(`Degraded brake, reference onboard: ${a.S.interventions} interventions with the simple ATO, ${b.S.interventions} with the Subset-130 ATO`);
}
