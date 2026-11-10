/**
 * Checks of the service trains (several trains with a timetable, phase 2 of the multi-train plan):
 * validation, departures at the timetabled time, protection between trains, propagation of a delay, both
 * signalling systems, outputs and determinism. Runs without services are covered by the reference values of the
 * other checks and by the determinism fingerprint of the campaign, which must not change.
 *   npx tsx scripts/verify-services.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { FIXED_DT, LINE_PRESETS, Simulation, altOf, autoDriver, compileLine, gradeOf, limitOf, mirrorLine, resolveScenario, runLockstep, validateScenario, type AutoDriverMemory, type Observation, type ScenarioDef, type ServiceDef } from '../src/core';
import { AgentEnv } from '../src/server/agent-env';
import { loadScenarios } from '../src/server/headless';
import { builtInDriver } from './lib/drive';

const stops = (t0: number) => [
  { station: 'Valle Lauro', departure_s: t0 },
  { station: 'Ponte Sabato', arrival_s: t0 + 260, departure_s: t0 + 290 },
  { station: 'San Felice Scalo', arrival_s: t0 + 620, departure_s: t0 + 650 },
  { station: 'Monte Clanio', arrival_s: t0 + 880 },
];
const scenario = (sig: 'ETCS' | 'BACC', services: ServiceDef[], slow = false): ScenarioDef => ({
  name: 'services', line: 'valle-lauro', train: 'regional', signalling: sig, leader: { on: false },
  events: slow ? [{ type: 'traction_reduced', factor: 0.35, announced: false }] : [], services,
});

/** Runs with the built-in ATO on every train and returns the simulation and the minimum gap between consecutive trains */
function run(def: ScenarioDef): { sim: Simulation; gap: number } {
  const { line, train, scen } = resolveScenario(def);
  const sim = new Simulation(line, train, scen, def);
  const drive = builtInDriver();
  let gap = Infinity;
  while (!sim.done && sim.time < 4000) {
    drive(sim);
    sim.step(FIXED_DT);
    sim.sample();
    const on = sim.trains.filter(r => r.active && !r.S.finished).sort((a, b) => b.S.s - a.S.s);
    for (let i = 0; i + 1 < on.length; i++) gap = Math.min(gap, on[i].S.s - on[i].TR.L - on[i + 1].S.s);
  }
  return { sim, gap };
}

// validation
{
  const bad = validateScenario({ name: 'x', services: [
    { id: 'A', stops: [{ station: 'Valle Lauro' }, { station: 'Monte Clanio' }] },
    { id: 'A', stops: [{ station: 'Valle Lauro', departure_s: 100 }, { station: 'Monte Clanio', arrival_s: 50 }] },
    { id: 'B', stops: [{ station: 'Valle Lauro', departure_s: 0 }] },
  ] });
  assert.ok(bad.some(e => /first stop needs departure_s/.test(e)), 'origin without departure');
  assert.ok(bad.some(e => /already used/.test(e)), 'duplicate id');
  assert.ok(bad.some(e => /must not decrease/.test(e)), 'decreasing times');
  assert.ok(bad.some(e => /at least two stops/.test(e)), 'too few stops');
  const wrong = scenario('ETCS', [{ id: 'X', stops: [{ station: 'Nowhere', departure_s: 0 }, { station: 'Monte Clanio' }] }]);
  const r = resolveScenario(wrong);
  assert.throws(() => new Simulation(r.line, r.train, r.scen, wrong), /not on the line/);
  // the train ahead is a train like the others (decision 12): a service towards the origin crosses it at a station
  const back = { ...scenario('ETCS', [{ id: 'X', stops: [{ station: 'Monte Clanio', departure_s: 0 }, { station: 'Valle Lauro' }] }]), leader: { on: true } };
  const r3 = resolveScenario(back), sb = new Simulation(r3.line, r3.train, r3.scen, back), drive = builtInDriver();
  while (!sb.done && sb.time < 4000) { drive(sb); sb.step(FIXED_DT); }
  assert.ok(sb.done && sb.trains.every(r => r.S.spad === 0), 'the train ahead and a service towards the origin should both end their run without overruns');
  const mixed = scenario('ETCS', [{ id: 'X', stops: [{ station: 'Ponte Sabato', departure_s: 0 }, { station: 'Monte Clanio' }, { station: 'Valle Lauro' }] }]);
  const r4 = resolveScenario(mixed);
  assert.throws(() => new Simulation(r4.line, r4.train, r4.scen, mixed), /same running direction/);
  const bad2 = validateScenario({ name: 'x', conflict_rule: 'random', services: [{ id: 'A', stops: [{ station: 'Valle Lauro', departure_s: 0, track: 'III' }, { station: 'Monte Clanio' }] }], events: [{ type: 'train_stopped', train: 'Z' }, { type: 'line_blocked', from_m: 5, to_m: 1 }, { type: 'message', text: 'x', train: 'A' }] } as never);
  for (const re of [/conflict_rule/, /track must be/, /«Z» is not a service/, /to_m > from_m/, /applies only to/]) assert.ok(bad2.some(e => re.test(e)), String(re));
  console.log('validation of services: ok');
}

// the example scenario: services leave on time, nobody is protected against anybody
{
  const [{ def }] = loadScenarios('scenarios/services/following.json');
  const { sim, gap } = run(def);
  assert.equal(sim.trains.length, 3);
  const tt = sim.timetable();
  for (const t of tt) {
    assert.ok(t.finished, `${t.id}: not finished`);
    const s = sim.summary(sim.trains.find(r => r.id === t.id));
    assert.equal(s.outcome, 'passed', `${t.id}: ${JSON.stringify(s.checks.filter(c => !c.ok))}`);
    assert.equal(s.interventions + s.overruns + s.warnings, 0, `${t.id}: protection involved`);
    if (t.id === 'train') continue;
    for (const st of t.stops.slice(0, -1)) assert.ok(st.departure_delay_s != null && st.departure_delay_s >= 0 && st.departure_delay_s < 3, `${t.id} ${st.station}: departure ${st.departure_delay_s} s after the timetable`);
  }
  assert.ok(gap > 300, `trains closer than expected: ${gap.toFixed(0)} m`);
  const obs = sim.observe(0.2, 3, sim.trains[1]);
  assert.equal(obs.train_id, 'R 2102');
  assert.equal(sim.observe(0.2).train_id, 'train');
  console.log(`following services: on time, minimum gap ${gap.toFixed(0)} m, observation with train_id: ok`);
}

// a slow controlled train delays the service behind it; the block keeps them apart, with both signalling systems
for (const sig of ['ETCS', 'BACC'] as const) {
  // the fault concerns only the controlled train: the service keeps full traction and is delayed only by the block
  const svc: ServiceDef[] = [{ id: 'R 1', stops: stops(60) }];
  const free = run(scenario(sig, svc)), slow = run(scenario(sig, svc, true));
  const arr = (sim: Simulation) => sim.timetable()[1].stops[1].arrival_s as number;
  const a0 = arr(free.sim), a1 = arr(slow.sim);
  assert.ok(a1 > a0 + 10, `${sig}: the delay does not propagate (${a0} → ${a1} s)`);
  assert.equal(slow.sim.trains[1].tractionFactor, 1, `${sig}: the fault of the controlled train reached the service`);
  assert.ok(slow.gap > 0, `${sig}: trains overlap (${slow.gap.toFixed(1)} m)`);
  for (const r of slow.sim.trains) assert.equal(slow.sim.summary(r).overruns, 0, `${sig} ${r.id}: signal or EOA passed`);
  console.log(`${sig}: delay propagated to the following service ${a0.toFixed(0)} → ${a1.toFixed(0)} s, minimum gap ${slow.gap.toFixed(0)} m, no overrun: ok`);
}

// disruptions: a stretch of line blocked for a while, with both signalling systems and with the interlocking trackside
// @test SVC-D1: line blocked: the trains stop before it and go on when it is open again [YT-DISRUPT]
for (const variant of ['ETCS', 'BACC', 'interlocking'] as const) {
  const def: ScenarioDef = {
    ...scenario(variant === 'BACC' ? 'BACC' : 'ETCS', []),
    ...(variant === 'interlocking' ? { onboard: 'reference' as const, trackside: 'interlocking' as const } : {}),
    events: [{ type: 'line_blocked', from_m: 7000, to_m: 7400, when: { t: 0 }, duration_s: 420 }],
  };
  const { line, train, scen } = resolveScenario(def);
  const sim = new Simulation(line, train, scen, def);
  const drive = builtInDriver();
  let maxHead = 0;
  while (!sim.done && sim.time < 3000) {
    drive(sim);
    sim.step(FIXED_DT);
    if (sim.time < 420) maxHead = Math.max(maxHead, sim.S.s);
  }
  const sum = sim.summary(sim.train);
  assert.ok(maxHead < 7000, `${variant}: the train entered the blocked stretch (${maxHead.toFixed(0)} m)`);
  assert.ok(maxHead > 5500, `${variant}: the train did not approach the blocked stretch (${maxHead.toFixed(0)} m)`);
  assert.ok(sim.S.finished, `${variant}: the train did not go on after the line was opened again`);
  assert.equal(sum.overruns, 0, `${variant}: signal or EOA passed`);
  console.log(`${variant}: line blocked 7.000–7.400 km for 420 s, the train waits at ${(maxHead / 1000).toFixed(3)} km and arrives at ${sim.S.t.toFixed(0)} s: ok`);
}

// a service that breaks down: only it stops, the train behind waits for it, the fault of one train does not reach the others
// @test SVC-D2: train stopped and traction reduced on a chosen service [YT-DISRUPT]
{
  const svc: ServiceDef[] = [{ id: 'R 1', stops: stops(60) }, { id: 'R 2', stops: stops(200) }];
  const base = scenario('ETCS', svc);
  const free = run(base);
  const hit = run({ ...base, events: [{ type: 'train_stopped', train: 'R 1', when: { pos: 7000 }, duration_s: 240 }, { type: 'traction_reduced', train: 'R 2', factor: 0.5 }] });
  const arr = (sim: Simulation, k: number, i: number) => sim.timetable()[k].stops[i].arrival_s as number;
  assert.equal(arr(hit.sim, 0, 3), arr(free.sim, 0, 3), 'the controlled train was affected');
  assert.ok(arr(hit.sim, 1, 2) > arr(free.sim, 1, 2) + 100, `R 1 not held (${arr(free.sim, 1, 2)} → ${arr(hit.sim, 1, 2)} s)`);
  assert.ok(arr(hit.sim, 2, 2) > arr(free.sim, 2, 2) + 60, `R 2 not delayed (${arr(free.sim, 2, 2)} → ${arr(hit.sim, 2, 2)} s)`);
  assert.deepEqual(hit.sim.trains.map(r => r.tractionFactor), [1, 1, 0.5]);
  assert.ok(hit.gap > 0, 'trains overlap');
  for (const r of hit.sim.trains) assert.equal(hit.sim.summary(r).overruns, 0, `${r.id}: signal or EOA passed`);
  console.log(`train stopped: R 1 at San Felice Scalo ${arr(free.sim, 1, 2).toFixed(0)} → ${arr(hit.sim, 1, 2).toFixed(0)} s, R 2 behind it ${arr(free.sim, 2, 2).toFixed(0)} → ${arr(hit.sim, 2, 2).toFixed(0)} s, controlled train unchanged: ok`);
}

// precedence with the interlocking trackside: overtaking on the passing track, and the conflict rule between two
// trains that want the same exit of a station
// @test SVC-P1: overtaking on the passing track with the interlocking trackside [YT-ARS, EU-SCI-RBC, S026-3.5.3]
// @test SVC-P2: conflict rule timetable and first_come at the exit of a station [YT-ARS, EU-SCI-CC]
{
  const runIlk = (def: ScenarioDef) => {
    const { line, train, scen } = resolveScenario(def);
    const sim = new Simulation(line, train, scen, def);
    const drive = builtInDriver();
    while (!sim.done && sim.time < 3000) {
      drive(sim);
      sim.step(FIXED_DT);
    }
    for (const r of sim.trains) {
      assert.ok(r.S.finished, `${r.id}: not finished`);
      assert.equal(sim.summary(r).overruns, 0, `${r.id}: EOA passed`);
    }
    const at = (id: string, st: string) => sim.trains.find(r => r.id === id)!.realised.find(x => x.station === st)!;
    return { sim, at };
  };
  const over: ScenarioDef = {
    ...scenario('ETCS', [{ id: 'R 5101', stops: [{ station: 'Ponte Sabato', departure_s: 100 }, { station: 'San Felice Scalo', arrival_s: 520, departure_s: 700, track: 'II' }, { station: 'Monte Clanio', arrival_s: 1080 }] }]),
    onboard: 'reference', trackside: 'interlocking', events: [{ type: 'traction_reduced', factor: 0.3, train: 'R 5101' }],
  };
  const o = runIlk(over);
  const slowIn = o.at('R 5101', 'San Felice Scalo'), fastIn = o.at('train', 'San Felice Scalo');
  assert.ok((slowIn.arrival_s as number) < (fastIn.arrival_s as number) && (slowIn.departure_s as number) > (fastIn.departure_s as number), 'no overtaking at San Felice Scalo');
  assert.ok((o.at('train', 'Monte Clanio').arrival_s as number) < (o.at('R 5101', 'Monte Clanio').arrival_s as number), 'the controlled train is not first at Monte Clanio');
  console.log(`interlocking: R 5101 waits on track II of San Felice Scalo and the controlled train overtakes it (arrival at Monte Clanio ${(o.at('train', 'Monte Clanio').arrival_s as number).toFixed(0)} s): ok`);

  const scen = JSON.parse(readFileSync('scenarios/services/precedence.json', 'utf8')) as ScenarioDef;
  const res = (['timetable', 'first_come'] as const).map(rule => runIlk({ ...scen, conflict_rule: rule }));
  const mc = (r: typeof res[0], id: string) => r.at(id, 'Monte Clanio').arrival_s as number;
  assert.ok(mc(res[0], 'train') < mc(res[0], 'R 5101'), 'rule timetable: the train timetabled earlier does not leave first');
  assert.ok(mc(res[1], 'R 5101') < mc(res[1], 'train'), 'rule first_come: the train that arrived first does not leave first');
  assert.ok(res[0].sim.S.events.some(e => /held for a train timetabled earlier/.test(e.text ?? '')), 'rule timetable: no hold reported');
  assert.ok(!res[1].sim.S.events.some(e => /held for a train timetabled earlier/.test(e.text ?? '')), 'rule first_come: a hold reported');
  console.log(`conflict rule at San Felice Scalo: timetable → controlled train ${mc(res[0], 'train').toFixed(0)} s, R 5101 ${mc(res[0], 'R 5101').toFixed(0)} s; first_come → controlled train ${mc(res[1], 'train').toFixed(0)} s, R 5101 ${mc(res[1], 'R 5101').toFixed(0)} s: ok`);
}

// determinism of every train
{
  const def = scenario('ETCS', [{ id: 'R 1', stops: stops(150) }, { id: 'R 2', train: 'freight', stops: stops(500) }], true);
  const h = () => { const { sim } = run(def); return createHash('sha256').update(sim.trains.map(r => sim.csv(r)).join('\n')).digest('hex').slice(0, 16); };
  const a = h(), b = h();
  assert.equal(a, b, 'two identical runs differ');
  console.log(`determinism with three trains (${a}): ok`);
}

// the line seen in the opposite direction
{
  const L = compileLine(LINE_PRESETS['appennino']), M = mirrorLine(L), MM = mirrorLine(M);
  for (let s = 0; s <= L.len; s += 250) {
    const r = L.len - s;
    assert.ok(Math.abs(altOf(M, r) - altOf(L, s)) < 1e-6, `altitude at ${s}`);
    if (s > 1 && s < L.len - 1) assert.equal(gradeOf(M, r - 0.5), -gradeOf(L, s + 0.5), `gradient at ${s}`);
    assert.equal(limitOf(M, r - 0.5), limitOf(L, s + 0.5), `limit at ${s}`);
  }
  assert.deepEqual(M.st.map(x => x.name), L.st.map(x => x.name).reverse());
  assert.deepEqual(MM.st.map(x => +x.s.toFixed(6)), L.st.map(x => +x.s.toFixed(6)), 'mirroring twice gives the line back');
  assert.deepEqual(MM.sig.map(x => [+x.s.toFixed(6), x.kind]), L.sig.map(x => [+x.s.toFixed(6), x.kind]), 'same signals after mirroring twice');
  assert.ok(M.sig.filter(x => x.kind === 'P').length === L.sig.filter(x => x.kind === 'P').length, 'a starting signal per station in both directions');
  console.log('mirrored line: altitudes, gradients, limits, stations and signals: ok');
}

// crossing on single track: each section is given to one direction at a time, a late train delays the opposite one
// @test SVC-X1: crossing with the interlocking trackside: reverse routes and block consent [YT-CT, YT-ARS, YT-CONSENT, EU-SCI-RBC, S026-3.6.3]
for (const [sig, onboard, trackside] of [['ETCS', 'internal', 'simple'], ['BACC', 'internal', 'simple'], ['ETCS', 'reference', 'simple'], ['ETCS', 'reference', 'interlocking']] as const) {
  const [{ def: base }] = loadScenarios(trackside === 'interlocking' ? 'scenarios/services/crossing-interlocking.json' : 'scenarios/services/crossing.json');
  const def: ScenarioDef = { ...base, onboard, trackside };
  const name = onboard === 'internal' ? sig : `${sig} with the reference onboard` + (trackside === 'interlocking' ? ' and the interlocking trackside' : '');
  const late = (d: ScenarioDef, dep: number): ScenarioDef => ({ ...d, signalling: sig, services: (d.services ?? []).map(sv => ({ ...sv, stops: sv.stops.map((x, i) => i === 0 ? { ...x, departure_s: dep } : x) })) });
  const go = (d: ScenarioDef) => {
    const { line, train, scen } = resolveScenario(d);
    const sim = new Simulation(line, train, scen, d), drive = builtInDriver();
    const seg = sim.L.st.slice(1).map((x, j) => [sim.L.st[j].s + 250, x.s - 250]);
    let together = 0, crossedAt = '';
    while (!sim.done && sim.time < 4000) {
      drive(sim);
      sim.step(FIXED_DT);
      const [f, r] = sim.trains;
      if (!r.active || r.S.finished || f.S.finished) continue;
      const ef = [f.S.s - f.TR.L, f.S.s], er = [sim.L.len - r.S.s, sim.L.len - r.S.s + r.TR.L];
      for (const [p, q] of seg) if (ef[1] > p && ef[0] < q && er[1] > p && er[0] < q) together++;
      if (!crossedAt && er[0] < ef[1]) crossedAt = sim.L.st.find(x => Math.abs(x.s - f.S.s) < 450)?.name ?? `km ${(f.S.s / 1000).toFixed(3)}`;
    }
    return { sim, together, crossedAt };
  };
  const a = go({ ...def, signalling: sig }), b = go(late(def, 520));
  for (const { sim, together } of [a, b]) {
    assert.equal(together, 0, `${name}: opposing trains on the same single-track section`);
    for (const r of sim.trains) {
      const s = sim.summary(r);
      assert.ok(r.S.finished && s.overruns === 0 && s.interventions === 0, `${name} ${r.id}: ${JSON.stringify(s.checks.filter(c => !c.ok))}`);
    }
  }
  assert.equal(a.crossedAt, 'San Felice Scalo', `${name}: crossing expected at San Felice Scalo, got ${a.crossedAt}`);
  const dep = (x: typeof a) => x.sim.timetable()[0].stops[3].arrival_s as number;
  assert.ok(dep(b) > dep(a) + 30, `${name}: the late opposite train does not hold the controlled one (${dep(a)} → ${dep(b)} s)`);
  console.log(`${name}: crossing at ${a.crossedAt}, never two opposing trains on one section; opposite train 220 s late → arrival at Monte Clanio ${dep(a).toFixed(0)} → ${dep(b).toFixed(0)} s: ok`);
}

// agents: the built-in ATO given from outside, through runLockstep or the agent environment, gives the same run
{
  const [{ def }] = loadScenarios('scenarios/services/following.json');
  const agentDef: ScenarioDef = { ...def, services: (def.services ?? []).map(sv => ({ ...sv, driver: 'agent' as const })) };
  const lock = async (d: ScenarioDef, agents: boolean) => {
    const { line, train, scen } = resolveScenario(d);
    const sim = new Simulation(line, train, scen, d);
    const mem: AutoDriverMemory = {}, mems: Record<string, AutoDriverMemory> = {};
    await runLockstep(sim, o => autoDriver(o, mem), agents ? { agents: (o: Observation) => autoDriver(o, mems[o.train_id as string] ??= {}) } : {});
    return { tt: JSON.stringify(sim.timetable().map(t => ({ ...t, driver: undefined }))), csv: sim.trains.map(r => sim.csv(r)).join('\n') };
  };
  const ato = await lock(def, false), ag = await lock(agentDef, true);
  assert.equal(ag.tt, ato.tt, 'agent and built-in ATO give different timetables');
  assert.equal(ag.csv, ato.csv, 'agent and built-in ATO give different runs');
  const { line, train, scen } = resolveScenario(agentDef);
  await assert.rejects(runLockstep(new Simulation(line, train, scen, agentDef), o => autoDriver(o, {})), /no agent is connected/);
  const env = new AgentEnv(), mems: Record<string, AutoDriverMemory> = {};
  let st = env.reset({ scenario: 'scenarios/services/following.json', agents: ['R 2102', 'R 2104'] });
  let decisions = 0;
  while (!st.done) {
    const actions: Record<string, ReturnType<typeof autoDriver>> = {};
    for (const [id, o] of Object.entries(st.observations)) { actions[id] = autoDriver(o, mems[id] ??= {}); decisions++; }
    st = env.step(actions);
  }
  assert.equal(JSON.stringify(st.info?.timetable.map(t => ({ ...t, driver: undefined }))), ato.tt, 'the agent environment gives a different run');
  console.log(`agents: runLockstep agents and agent environment (${decisions} decisions) identical to the built-in ATO: ok`);
}

console.log('services: all ok');
