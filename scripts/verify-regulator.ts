/**
 * Checks of the traffic regulator (phase 3c, docs/REGULATOR.md): protocol, decisions and their effects, the reference
 * regulator on a breakdown and on a blocked line, the external regulator via exec. Runs without a regulator are covered
 * by the other checks and by the campaign, whose fingerprint must not change.
 *   npx tsx scripts/verify-regulator.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FIXED_DT, ReferenceRegulator, Simulation, autoDriver, resolveScenario, runLockstep, validateScenario, type RegulatorRequest, type RegulatorResponse, type ScenarioDef } from '../src/core';
import { loadScenarios, openChannel } from '../src/server/headless';
import { builtInDriver } from './lib/drive';

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const all = (sim: Simulation) => hash(sim.trains.map(r => sim.csv(r)).join('\n'));

/** Runs with the built-in ATO on the controlled train; `regulator` answers in place of the in-process one */
async function run(def: ScenarioDef, regulator?: (q: RegulatorRequest) => RegulatorResponse | Promise<RegulatorResponse>, maxTime = 4000): Promise<Simulation> {
  const { line, train, scen } = resolveScenario(def);
  const sim = new Simulation(line, train, scen, def);
  const mem = {};
  await runLockstep(sim, o => autoDriver(o, mem), { period: 0.2, maxTime, ...(regulator ? { regulator } : {}) });
  return sim;
}

const services = (extra: object = {}): ScenarioDef => ({
  name: 'regulator', line: 'valle-lauro', train: 'regional', signalling: 'ETCS', leader: { on: false },
  services: [{ id: 'R 1', stops: [
    { station: 'Valle Lauro', departure_s: 60 }, { station: 'Ponte Sabato', arrival_s: 320, departure_s: 350 },
    { station: 'San Felice Scalo', arrival_s: 680, departure_s: 710 }, { station: 'Monte Clanio', arrival_s: 940 }] }],
  ...extra,
});

// @test RG1: regulator protocol: request, decisions applied, invalid decisions logged [YT-REG]
{
  assert.deepEqual(validateScenario({ name: 'x', regulator: 'reference', regulator_period_s: 10 }), []);
  const bad = validateScenario({ name: 'x', regulator: 'smart', regulator_period_s: 0 });
  assert.ok(bad.some(e => /regulator must be/.test(e)) && bad.some(e => /regulator_period_s/.test(e)), bad.join('; '));

  const reqs: RegulatorRequest[] = [];
  const scripted = (q: RegulatorRequest): RegulatorResponse => {
    reqs.push(q);
    if (!q.start) return { commands: [] };
    return {
      log: ['first decisions'],
      commands: [
        { type: 'skip_stop', train: 'R 1', station: 'Ponte Sabato' },
        { type: 'retime', train: 'R 1', station: 'San Felice Scalo', departure_s: 800 },
        { type: 'retime', train: 'train', station: 'Ponte Sabato', departure_s: 330 },
        { type: 'priority', train: 'R 1', value: 3 },
        { type: 'skip_stop', train: 'R 1', station: 'Monte Clanio' },
        { type: 'cancel', train: 'train' },
        { type: 'retime', train: 'R 9', station: 'Ponte Sabato', departure_s: 1 },
        { type: 'operator', command: { type: 'ars', active: false } },
      ],
    };
  };
  const sim = await run({ ...services(), regulator: 'external', regulator_period_s: 10 }, scripted);
  const q0 = reqs[0];
  assert.equal(q0.type, 'regulator'); assert.ok(q0.start && q0.configuration);
  assert.deepEqual(q0.configuration?.stations.map(s => s.name), ['Valle Lauro', 'Ponte Sabato', 'San Felice Scalo', 'Monte Clanio']);
  assert.deepEqual(q0.trains.map(t => t.id), ['train', 'R 1']);
  assert.equal(q0.trains[1].active, false); assert.equal(q0.trains[1].stops[1].planned_departure_s, 350);
  assert.ok(Math.abs(reqs[1].t - 10) < 1e-6 && !reqs[1].start, 'the regulator cycle is not 10 s');
  const later = reqs[reqs.length - 1].trains[1];
  assert.equal(later.priority, 3);
  assert.equal(later.stops[1].skipped, true);
  assert.equal(later.stops[2].departure_s, 800);
  const tt = sim.timetable(), r1 = tt[1], tc = tt[0];
  assert.equal(r1.stops[1].skipped, true, 'Ponte Sabato not skipped');
  assert.equal(r1.stops[1].arrival_s, null, 'R 1 stopped at Ponte Sabato');
  assert.equal(r1.stops[2].rescheduled_departure_s, 800);
  assert.ok((r1.stops[2].departure_s as number) >= 800, `R 1 left San Felice Scalo at ${r1.stops[2].departure_s}`);
  assert.equal(r1.stops[2].planned_departure_s, 710, 'the plan must stay the reference for delays');
  assert.equal(tc.stops[1].rescheduled_departure_s, 330);
  const warns = sim.S.events.filter(e => /^Regulator: .* ignored/.test(e.text)).map(e => e.text);
  assert.equal(warns.length, 4, warns.join(' | '));
  assert.ok(warns.some(w => /controlled train cannot be cancelled/.test(w)));
  assert.ok(warns.some(w => /origin and the destination/.test(w)) && warns.some(w => /no train «R 9»/.test(w)) && warns.some(w => /interlocking trackside/.test(w)));
  assert.ok(sim.S.events.some(e => e.text === 'Regulator: first decisions'));
  for (const r of sim.trains) assert.ok(r.S.finished && sim.summary(r).overruns === 0, `${r.id}: not finished or overrun`);
  console.log(`protocol: request every 10 s, skip_stop, retime, priority applied, 4 invalid decisions logged, plan kept as reference: ok`);
}

// @test RG2: reference regulator on a breakdown in a station with the interlocking trackside [YT-REG, YT-ARS]
{
  const [{ def }] = loadScenarios('scenarios/services/breakdown.json');
  const without = await run({ ...def, regulator: 'none' }), withReg = await run(def);
  const mc = (sim: Simulation, id: string) => sim.trains.find(r => r.id === id)!.realised.find(x => x.station === 'Monte Clanio')!.arrival_s as number;
  for (const sim of [without, withReg]) for (const r of sim.trains) {
    assert.ok(r.S.finished, `${r.id}: not finished`);
    assert.equal(sim.summary(r).overruns, 0, `${r.id}: overrun`);
  }
  assert.ok(mc(without, 'train') > 1100, `without regulator the controlled train is not held (${mc(without, 'train')} s)`);
  assert.ok(mc(withReg, 'train') < 900, `with the regulator the controlled train is still held (${mc(withReg, 'train')} s)`);
  assert.ok(mc(withReg, 'R 5101') <= mc(without, 'R 5101') + 1, 'the regulator delayed the broken-down train');
  const log = withReg.S.events.map(e => e.text);
  assert.ok(log.some(t => /R 5101: priority -2 \(broken down\)/.test(t)) && log.some(t => /departure from San Felice Scalo moved to/.test(t)), 'decisions not logged');
  const r5101 = withReg.timetable().find(x => x.id === 'R 5101')!;
  assert.ok(r5101.stops[1].rescheduled_departure_s != null, 'the new departure is not in the timetable');
  console.log(`breakdown at San Felice Scalo: controlled train at Monte Clanio ${mc(without, 'train').toFixed(0)} s without regulator, ${mc(withReg, 'train').toFixed(0)} s with the reference one; R 5101 unchanged (${mc(withReg, 'R 5101').toFixed(0)} s): ok`);

  // the same breakdown one second after the departure: the exit route is already set for R 5101 and is cancelled
  const late: ScenarioDef = { ...def, events: [{ type: 'train_stopped', train: 'R 5101', when: { t: 561 }, duration_s: 600 }] };
  const w0 = await run({ ...late, regulator: 'none' }), w1 = await run(late);
  for (const sim of [w0, w1]) for (const r of sim.trains) assert.ok(r.S.finished && sim.summary(r).overruns === 0, `${r.id}: not finished or overrun`);
  const cancels = w1.S.events.filter(e => /route Departure from San Felice Scalo track I cancelled/.test(e.text)).length;
  assert.equal(cancels, 1, `the set route should be cancelled once (${cancels})`);
  assert.ok(mc(w0, 'train') > 1300 && mc(w1, 'train') < 950, `route cancellation: ${mc(w0, 'train')} → ${mc(w1, 'train')} s`);
  assert.ok(mc(w1, 'R 5101') <= mc(w0, 'R 5101') + 1, 'the cancellation delayed the broken-down train');
  console.log(`breakdown at the departure: the exit route set for R 5101 is cancelled, controlled train ${mc(w0, 'train').toFixed(0)} → ${mc(w1, 'train').toFixed(0)} s, R 5101 ${mc(w0, 'R 5101').toFixed(0)} → ${mc(w1, 'R 5101').toFixed(0)} s: ok`);
}

// @test RG5: a train broken down for good is taken out of service at its station [YT-REG, YT-DISRUPT]
{
  const [{ def }] = loadScenarios('scenarios/services/cancellation.json');
  const without = await run({ ...def, regulator: 'none' }), withReg = await run(def);
  assert.ok(!without.S.finished, 'without regulator the controlled train should still be held behind the broken train');
  for (const r of withReg.trains) assert.ok(r.S.finished && withReg.summary(r).overruns === 0, `${r.id}: not finished or overrun`);
  const tt = withReg.timetable(), r5101 = tt.find(x => x.id === 'R 5101') as ReturnType<Simulation['timetable']>[number] & { cancelled?: string };
  assert.equal(r5101.cancelled, 'partial');
  assert.equal((r5101.stops[2] as { skipped?: boolean }).skipped, true, 'Monte Clanio should be cancelled');
  const tc = withReg.trains[0].realised.find(x => x.station === 'Monte Clanio')!.arrival_s as number;
  assert.ok(tc < 900, `the controlled train should pass the broken one (${tc} s)`);
  assert.ok(withReg.S.events.some(e => /taken out of service there/.test(e.text)), 'decision not logged');
  console.log(`train broken down for good: without regulator the controlled train is held, with it it arrives at ${tc.toFixed(0)} s and R 5101 ends at San Felice Scalo: ok`);
}

// @test RG3: reference regulator holds the trains in the station before a blocked stretch [YT-REG, YT-DISRUPT]
for (const v of ['BACC', 'ETCS', 'interlocking'] as const) {
  const def: ScenarioDef = {
    name: 'blocked', line: 'valle-lauro', train: 'regional', signalling: v === 'BACC' ? 'BACC' : 'ETCS', leader: { on: false },
    ...(v === 'interlocking' ? { onboard: 'reference' as const, trackside: 'interlocking' as const } : {}),
    events: [{ type: 'line_blocked', from_m: 7000, to_m: 7400, when: { t: 200 }, duration_s: 300 }],
  };
  const head = async (regulator: 'none' | 'reference') => {
    const { line, train, scen } = resolveScenario({ ...def, regulator });
    const sim = new Simulation(line, train, scen, { ...def, regulator });
    const drive = builtInDriver();
    let max = 0;
    while (!sim.done && sim.time < 3000) {
      drive(sim);
      sim.step(FIXED_DT);
      if (sim.time < 500) max = Math.max(max, sim.S.s);
    }
    assert.ok(sim.S.finished && sim.S.spad === 0, `${v} ${regulator}: not finished or overrun`);
    return max;
  };
  const a = await head('none'), b = await head('reference');
  assert.ok(a > 6000, `${v}: without regulator the train should wait at the signal in open line (${a.toFixed(0)} m)`);
  assert.ok(b < 5600, `${v}: with the regulator the train should wait at Ponte Sabato (${b.toFixed(0)} m)`);
  console.log(`${v}: line blocked, the train waits at ${(a / 1000).toFixed(3)} km without regulator, at ${(b / 1000).toFixed(3)} km (Ponte Sabato) with it: ok`);
}

// @test RG4: the reference regulator as an external program gives an identical run [YT-REG]
{
  const [{ def }] = loadScenarios('scenarios/services/breakdown.json');
  const ch = await openChannel<RegulatorRequest, RegulatorResponse>('exec:npx --no-install tsx examples/regulator/regulator_stdio.ts', 'the regulator');
  const e = await run({ ...def, regulator: 'external' }, ch.call);
  await ch.close();
  const i = await run(def), j = await run(def);
  assert.equal(all(i), all(j), 'two equal runs with the regulator differ');
  assert.equal(all(e), all(i), 'the external regulator produced a run different from the in-process one');
  // the reference regulator is a plain object: the same requests give the same answers
  const q = { type: 'regulator', version: 1, start: true, t: 0, trains: [], disruptions: [] } as RegulatorRequest;
  assert.deepEqual(new ReferenceRegulator().step(q), { commands: [], log: [] });
  console.log(`external regulator via exec: run identical to the in-process one (${all(i)}), deterministic: ok`);
}

// @test RG6: on a network the reference regulator reroutes a train around a blocked stretch of the main line [YT-REG, YT-NET, YT-REROUTE]
const [{ def: loop }] = loadScenarios('scenarios/services/loop-reroute.json');
{
  const at = (sim: Simulation, st: string) => (sim.trains.find(r => r.id === 'R 3101') as Simulation['trains'][0]).realised.find(x => x.station === st)?.arrival_s ?? null;
  const w = await run(loop), n = await run({ ...loop, regulator: 'none' }, undefined, 5000);
  const r = w.trains.find(x => x.id === 'R 3101') as Simulation['trains'][0];
  assert.deepEqual([...new Set(r.legs.map(g => w.net.lines[g.line].id))], ['valle-lauro', 'ponte-pietrarsa', 'rocca-sabato'], 'rerouted along the link');
  assert.equal(at(w, 'San Felice Scalo'), null, 'San Felice Scalo passed');
  assert.ok((w.timetable().find(x => x.id === 'R 3101')?.stops.find(x => x.station === 'San Felice Scalo') as { skipped?: boolean }).skipped, 'San Felice Scalo skipped in the realised timetable');
  const a = at(w, 'Rocca Sabato') as number, b = at(n, 'Rocca Sabato') as number;
  assert.ok(a < 1820 + 60 && b > 420 + 3000, `with the regulator at Rocca Sabato ${a} s, without it ${b} s, after the reopening`);
  for (const t of w.trains) assert.ok(t.S.finished && w.summary(t).interventions === 0, `${t.id}: protection involved`);
  // a reroute that cannot be applied is refused with its reason
  const sim = new Simulation(...(Object.values(resolveScenario(loop)) as [never, never, never]), loop);
  sim.regulatorResponse({ commands: [{ type: 'reroute', train: 'R 3101', route: ['valle-lauro'] }] });
  assert.ok(sim.S.events.some(e => /reroute ignored.*Rocca Sabato/.test(e.text)), 'a route without the destination is refused');
  console.log(`network: line blocked from 420 s, R 3101 rerouted along the link, passes San Felice Scalo, at Rocca Sabato ${a.toFixed(0)} s (${b.toFixed(0)} s without regulator): ok`);
}

// @test RG7: a connection the feeder can no longer make is released, the departing train leaves on time [YT-REG, YT-CONN]
{
  const [{ def: sh }] = loadScenarios('scenarios/services/branch-shuttle.json');
  const late = { ...sh, events: [{ type: 'train_stopped' as const, train: 'train', when: { t: 300 }, duration_s: 600 }] };
  const w = await run({ ...late, regulator: 'reference' }), n = await run(late);
  assert.deepEqual([w.connections[0].outcome, w.connections[0].wait_s], ['lost', 0], 'released: no wait');
  assert.deepEqual([n.connections[0].outcome, n.connections[0].wait_s], ['lost', 300], 'without regulator: 300 s of wait in vain');
  console.log('connection: feeder 600 s late, released by the regulator, the shuttle leaves on time (300 s of useless wait without it): ok');
}

// @test RG8: on a network the external regulator gives the same run as the in-process one [YT-REG, YT-NET]
{
  const ch = await openChannel<RegulatorRequest, RegulatorResponse>('exec:npx --no-install tsx examples/regulator/regulator_stdio.ts', 'the regulator');
  const e = await run({ ...loop, regulator: 'external' }, ch.call);
  await ch.close();
  const i = await run(loop);
  assert.equal(all(e), all(i), 'the external regulator produced a different run on the network');
  console.log(`network: external regulator via exec, run identical to the in-process one (${all(i)}): ok`);
}

console.log('verify-regulator: all ok');
