/**
 * Checks the message-based trackside and the reference ETCS onboard.
 *  1. Balise groups: ordered, not too sparse, one before every stop and every stop marker board.
 *  2. RBC: no message before the position report; then message 3 with authority, static speed profile, gradients
 *     and linking referred to the LRBG; temporary speed restrictions (65) and emergency stop (16).
 *  3. The example controller drives with the reference onboard on all lines without interventions, with accurate
 *     stops and identical data in two runs.
 *  4. Scenarios: same verdicts as the internal supervision.
 *  5. A driver who ignores everything is stopped by the onboard before the end of authority.
 *  6. The same onboard as an external process on stdin/stdout gives the same data as the one in the core.
 * Requirements: see the @test tags and docs/traceability/tests.csv.
 *   npx tsx scripts/verify-onboard.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  DEFAULT_SCENARIO, FIXED_DT, LINE_PRESETS, Simulation, TRAIN_PRESETS, buildBaliseGroups, clone, compileLine, nidLrbg, resolveScenario,
  runLockstep, type OnboardKind, type OnboardProvider, type RadioMessage, type ScenarioDef,
} from '../src/core';
import { loadJsController, loadScenarios, openChannel } from '../src/server/headless';
import { atDangerFor } from '../src/core/traffic';
import type { OnboardRequest, OnboardResponse } from '../src/core';
import { builtInDriver } from './lib/drive';

const hash = (sim: Simulation) => createHash('sha256').update(sim.csv()).digest('hex');

// @test O1: balise groups of the lines, one before every stop and marker board [S026-3.4.1, S026-3.4]
// 1: balise groups
for (const id of Object.keys(LINE_PRESETS)) {
  const L = compileLine(clone(LINE_PRESETS[id])), bgs = buildBaliseGroups(L);
  for (let i = 1; i < bgs.length; i++) {
    assert.ok(bgs[i].s > bgs[i - 1].s, `${id}: balises in order`);
    assert.ok(bgs[i].s - bgs[i - 1].s <= 1300, `${id}: balises more than 1300 m apart between ${bgs[i - 1].s} and ${bgs[i].s}`);
  }
  for (const st of L.st.slice(1)) assert.ok(bgs.some(b => b.s < st.s && st.s - b.s < 100), `${id}: balise group missing before ${st.name}`);
  for (const sg of L.sig) assert.ok(bgs.some(b => b.s < sg.s && sg.s - b.s < 120), `${id}: balise group missing before marker board ${sg.id}`);
  assert.ok(bgs[0].s < L.st[0].s, `${id}: the first group is under the train at departure`);
  console.log(`${id}: ${bgs.length} balise groups`);
}

// 2: RBC
{
  const sim = new Simulation(clone(LINE_PRESETS['valle-lauro']), clone(TRAIN_PRESETS.regional), { ...DEFAULT_SCENARIO, onboard: 'reference' });
  // @test O2: RBC session, message 136 then message 3 with packets 15, 21, 27, 5 referred to the LRBG [S026-3.5.2, S026-3.6.2, S026-3.6.5, S026-8.6.4, S026-8.7.2, S026-3.8.3, S026-3.11.3, S026-3.11.12, S026-7.4, S026-7.4.2, S026-3.4.4]
  const rbc = sim.ob!.rbc;
  assert.equal(rbc.tick({ t: 0, ma: sim.S.ma, baseLim: [[0, 1e9, 100]], tsr: [] }).length, 0, 'without a position report the RBC is silent');
  for (let k = 0; k < 400; k++) sim.step(FIXED_DT);
  const fromTrain = sim.ob!.log.filter(x => x.direction === 'onboard→RBC').map(x => x.msg);
  const toTrain = sim.ob!.log.filter(x => x.direction === 'RBC→onboard').map(x => x.msg);
  assert.ok(fromTrain[0]?.NID_MESSAGE === 136, 'the onboard opens with a position report');
  const m3 = toTrain.find(m => m.NID_MESSAGE === 3) as RadioMessage;
  assert.ok(m3, 'after the report message 3 arrives');
  const bg0 = sim.ob!.bgs[0];
  assert.equal(m3.NID_LRBG, nidLrbg(bg0.NID_BG), 'referred to the group of the stored position');
  const p = (n: number) => (m3.packets || []).find(x => x.NID_PACKET === n);
  assert.ok(p(15) && p(21) && p(27) && p(5), 'authority, gradients, static speed profile and linking');
  assert.equal(Number(p(15)!.L_ENDSECTION), Math.round(sim.S.ma!.eoa - bg0.s), 'L_ENDSECTION is the distance from the LRBG to the end of authority');
  assert.equal(sim.S.sup.vP > 0, true, 'with the authority the onboard grants speed');
  console.log('RBC and session: ok');
}
{
  // @test O3: temporary speed restriction as packet 65 and emergency stop as message 16 [S026-3.11.5, S026-3.10.2, S026-8.7.7]
  const def: ScenarioDef = { name: 'test', line: 'valle-lauro', events: [{ type: 'speed_restriction', from_m: 2000, to_m: 2600, v_kmh: 50 }, { type: 'rbc_emergency_stop', when: { t: 30 } }] };
  const r = resolveScenario(def);
  const sim = new Simulation(r.line, r.train, { ...r.scen, onboard: 'reference' }, def);
  await runLockstep(sim, loadJsController('examples/ato.js'), { period: 0.2, maxTime: 40 });
  const msgs = sim.ob!.log.filter(x => x.direction === 'RBC→onboard').map(x => x.msg);
  const tsr = msgs.flatMap(m => m.packets || []).find(q => q.NID_PACKET === 65);
  assert.ok(tsr && tsr.V_TSR === 10 && tsr.L_TSR === 600, 'the temporary speed restriction arrives as packet 65 of 50 km/h over 600 m');
  assert.ok(msgs.some(m => m.NID_MESSAGE === 16), 'the stop order arrives as message 16');
  assert.ok(sim.S.events.some(e => /message 16/.test(e.text)), 'the onboard brakes for the stop order');
  assert.equal(sim.S.interventions, 0, 'the ordered stop does not count as an intervention');
  console.log('temporary speed restrictions and emergency stop: ok');
}

// @test O4: complete runs with the reference onboard, no intervention, deterministic [S026-3.13, S026-3.8.4, S026-4.4.9, S026-3.14.1]
// 3: complete runs with the reference onboard
async function run(line: string, kind: OnboardKind, onboard?: OnboardProvider) {
  const sim = new Simulation(clone(LINE_PRESETS[line]), clone(TRAIN_PRESETS.regional), { ...DEFAULT_SCENARIO, onboard: kind });
  await runLockstep(sim, loadJsController('examples/ato.js'), { period: 0.2, source: 'ato', onboard });
  return sim;
}
for (const line of Object.keys(LINE_PRESETS)) {
  const a = await run(line, 'reference'), b = await run(line, 'reference');
  const r = a.result(), v = a.verdict();
  assert.equal(v.outcome, 'passed', `${line}: ${v.checks.filter(c => !c.ok).map(c => c.name).join(', ')}`);
  assert.equal(r.interventions, 0, `${line}: no intervention`);
  for (const s of a.S.stops) assert.ok(s.err != null && Math.abs(s.err) <= 3, `${line}: stop at ${s.name} with error ${s.err}`);
  assert.equal(hash(a), hash(b), `${line}: two runs with the reference onboard must give identical data`);
  console.log(`${line.padEnd(12)} reference onboard: arrival ${r.t_s.toFixed(1)} s, energy ${r.net_energy_kWh.toFixed(1)} kWh, ${a.ob!.exchanges} cycles, ${a.ob!.log.length} radio messages`);
}

// @test O5: fault scenarios give the same verdicts with the reference onboard [S026-3.5.4, S026-3.16.3, S026-3.11.5]
// 4: scenarios, same verdicts as the internal supervision
for (const { file, def } of loadScenarios('scenarios')) {
  const r = resolveScenario(def);
  if (r.scen.sig !== 'ETCS') continue;
  // faults that only a message-based onboard can see (its odometry, the train integrity it reports): nothing to compare
  if ((def.events ?? []).some(e => e.type === 'odometry_drift' || e.type === 'integrity_loss')) continue;
  const verdicts: string[] = [];
  for (const onboard of ['internal', 'reference'] as OnboardKind[]) {
    const sim = new Simulation(clone(r.line), r.train, { ...r.scen, onboard: onboard }, def);
    await runLockstep(sim, loadJsController('examples/ato.js'), { period: 0.2 });
    verdicts.push(sim.verdict().outcome);
  }
  assert.equal(verdicts[1], verdicts[0], `${file}: with the reference onboard the verdict must be ${verdicts[0]}`);
  console.log(`${file.replace(/^.*[\\/]/, '').padEnd(32)} ${verdicts[1]} with both onboards`);
}

// @test O6: a driver who never brakes is stopped by the onboard before the end of authority [S026-3.13.10, S026-3.13.10.2.6-c, S026-3.14.1]
// 5: a driver who never brakes
{
  // the train is held at a marker it passes at danger; without the hold (`hold` false) it would run into the freight
  // train stopped ahead, and the engine must detect it
  const drive = async (hold: boolean) => {
    const sim = new Simulation(clone(LINE_PRESETS['valle-lauro']), clone(TRAIN_PRESETS.regional), { ...DEFAULT_SCENARIO, onboard: 'reference' });
    // the furthest the head goes beyond the end of authority the train had at the start of the step, other than a
    // marker it has already passed at danger, and the smallest gap to the rear of the freight train
    let over = -Infinity, gap = Infinity;
    const step = sim.step.bind(sim), fr = sim.trains[1];
    sim.step = (dt?: number) => {
      const ma = sim.S.ma;
      step(dt);
      if (!hold) sim.train.passedAtDanger = undefined;
      if (ma && ma.why !== 'end of line' && ma.why !== 'signal passed at danger') over = Math.max(over, sim.S.s - ma.eoa);
      if (fr.active && !fr.S.finished) gap = Math.min(gap, fr.S.s - fr.TR.L - sim.S.s);
    };
    await runLockstep(sim, () => ({ traction: 1, brake: 0, vigilance: true }), { period: 0.2, maxTime: 1500 });
    return { sim, over, gap, together: sim.trains.flatMap(r => r.S.events.filter(e => e.kind === 'EMG' && /same stretch of line/.test(e.text))) };
  };
  const { sim, over, gap, together } = await drive(true);
  assert.ok(over <= 0.5, `the onboard must stop the train before the end of authority: ${over.toFixed(2)} m beyond it`);
  // stopped a few centimetres beyond a marker at danger, within 0.5 m of it, the engine would give an authority beyond
  // it, and the driver keeps traction on: the head passes the marker, the engine counts it, holds the marker as the
  // end of authority and the onboard trips; the train goes on only when the marker clears
  const atDanger = sim.S.events.filter(e => e.kind === 'EMG' && /passed signal .* at danger/.test(e.text)).length;
  assert.ok(atDanger >= 1, 'no marker at danger passed');
  assert.equal(sim.S.spad, atDanger, `${sim.S.spad} overruns counted, ${atDanger} markers at danger passed`);
  assert.ok(gap > 100, `the train got within ${gap.toFixed(1)} m of the rear of the freight train`);
  assert.equal(together.length, 0, 'two trains on the same stretch: ' + together.map(e => e.text).join('; '));
  assert.ok(sim.S.sbiCount + sim.S.interventions > 0, 'the onboard must have intervened');
  assert.ok(sim.S.maxOverLine < 20, `overspeed too high: ${sim.S.maxOverLine.toFixed(1)} km/h`);
  const free = await drive(false);
  assert.ok(free.gap < 0, `without the hold the train should run into the freight train: gap ${free.gap.toFixed(1)} m`);
  assert.equal(free.together.length, 2, 'without the hold the engine must report the two trains on the same stretch, once for each');
  console.log(`distracted driver: stopped by the onboard (${sim.S.sbiCount} service brakings, ${sim.S.interventions} interventions), at most ${over.toFixed(2)} m beyond the end of authority and ${sim.S.maxOverLine.toFixed(1)} km/h over the limit; markers at danger passed afterwards ${atDanger}, held there, at least ${gap.toFixed(0)} m from the freight train; without the hold ${free.gap.toFixed(0)} m and «${free.together[0].text}»`);
}

// @test O7: the onboard as an external process on stdin/stdout gives the same data [S026-7.3, S026-8.4]
// 6: reference onboard as an external process
{
  const ch = await openChannel<OnboardRequest, OnboardResponse>(`exec:"${process.execPath}" --import tsx examples/onboard/onboard_stdio.ts`, 'the ETCS onboard');
  const ext = await run('valle-lauro', 'external', ch.call);
  ch.close();
  const ref = await run('valle-lauro', 'reference');
  const strip = (sim: Simulation) => sim.csv().split('\n').map(l => l.split(',').filter((_, i) => i !== 26).join(',')).join('\n');
  assert.equal(strip(ext), strip(ref), 'the onboard as an external process must give the same data as the one in the core');
  console.log('reference onboard on stdin/stdout: same data');
}
// @test O8: one RBC session per train, trains in both directions, each with its own LRBG and orientation [S026-3.4.2, S026-3.6.3, S026-3.5.3, S026-8.6.4]
{
  for (const f of ['crossing', 'following']) {
    const def: ScenarioDef = { ...loadScenarios(`scenarios/services/${f}.json`)[0].def, onboard: 'reference' };
    const { line, train, scen } = resolveScenario(def);
    const sim = new Simulation(line, train, scen, def);
    const drive = builtInDriver();
    while (!sim.done && sim.time < 3000) {
      drive(sim);
      sim.step(FIXED_DT); sim.sample();
    }
    assert.ok(sim.done, `${f}: every train arrives`);
    const rbc = sim.ob!.rbc;
    assert.equal(rbc.sessions.size, sim.trains.length, `${f}: one session per train`);
    for (const [i, r] of sim.trains.entries()) {
      assert.equal(r.ob!.engine, i + 1, 'NID_ENGINE in order');
      assert.ok(r.ob!.rbc === rbc, 'one RBC for all the trains');
      assert.equal(r.S.spad + r.S.interventions + r.S.sbiCount, 0, `${f}, ${r.id}: no overrun, intervention or service brake`);
      const ses = rbc.sessions.get(r.ob!.engine)!;
      assert.equal(ses.report!.dir, r.dir > 0 ? 1 : 0, `${f}, ${r.id}: orientation with respect to the LRBG`);
      const m3s = r.ob!.log.filter(x => x.direction === 'RBC→onboard' && x.msg.NID_MESSAGE === 3).map(x => x.msg);
      assert.ok(m3s.length > 3, `${f}, ${r.id}: authorities received`);
      assert.ok(m3s.every(m => m.packets!.every(p => p.Q_DIR == null || p.Q_DIR === (r.dir > 0 ? 1 : 0))), `${f}, ${r.id}: packets for its direction`);
      const reports = r.ob!.log.filter(x => x.direction === 'onboard→RBC' && x.msg.NID_MESSAGE === 136).map(x => x.msg);
      assert.ok(reports.every(m => m.NID_ENGINE === r.ob!.engine), 'position reports carry the NID_ENGINE of the train');
    }
    // the sessions are independent: each refers to the groups that its own train has passed
    const lrbgs = [...rbc.sessions.values()].map(x => x.report!.lrbg);
    if (f === 'crossing') assert.notEqual(lrbgs[0], lrbgs[1], 'different LRBG for the two trains');
    console.log(`${f}: ${rbc.sessions.size} RBC sessions, orientations ${[...rbc.sessions.values()].map(x => x.report!.dir).join('/')}, no intervention`);
  }
}

// @test O9: the train integrity from the train interface is reported to the RBC: confirmed with its length, lost in every report from its loss, confirmed again [S026-3.6.5.1.4-c, S026-3.6.5.2.3-c, S026-3.6.5.2.4-c, S026-3.6.5.2.5-c, S026-3.6.5.2.9-c, S026-7.4.3.1-c]
{
  const base: ScenarioDef = { name: 'integrity', line: 'valle-lauro', signalling: 'ETCS', onboard: 'reference', leader: { on: false }, events: [] };
  const run = (def: ScenarioDef) => {
    const { line, train, scen } = resolveScenario(def);
    const sim = new Simulation(line, train, scen, def), drive = builtInDriver();
    const reqs: OnboardRequest[] = [];
    const ref = sim.train.ob!.ref!, step = ref.step.bind(ref);
    ref.step = (q: OnboardRequest) => { reqs.push(q); return step(q); };
    while (!sim.done && sim.time < 2000) { drive(sim); sim.step(FIXED_DT); sim.sample(); }
    return { sim, reqs };
  };
  const a = run(base), b = run({ ...base, events: [{ type: 'integrity_loss', when: { t: 120 }, duration_s: 60 }] });
  assert.ok(a.reqs.every(q => q.train.integrity === undefined), 'without the event the requests carry no integrity');
  assert.equal(createHash('sha256').update(b.sim.csv()).digest('hex'), createHash('sha256').update(a.sim.csv()).digest('hex'), 'with the fixed block the loss of integrity does not change the run');
  const rep = b.sim.train.ob!.log.filter(x => x.direction === 'onboard→RBC' && x.msg.NID_MESSAGE === 136).map(x => ({ t: x.t, p: x.msg.packets![0] }));
  const L = b.sim.train.TR.L;
  for (const r of rep) {
    const lost = r.t > 119.99 && r.t < 179.99;
    assert.equal(r.p.Q_INTEGRITY, lost ? 3 : 1, `report at ${r.t.toFixed(2)} s: Q_INTEGRITY ${r.p.Q_INTEGRITY}`);
    if (lost) assert.equal(r.p.L_TRAININT, undefined, 'no confirmed length with integrity lost');
    else assert.equal(r.p.L_TRAININT, Math.round(L + Number(r.p.L_DOUBTUNDER)), 'confirmed length = train length + doubt under');
  }
  const first = rep.find(r => r.t > 119.99)!;
  assert.ok(first.t < 120.5 && first.p.Q_INTEGRITY === 3, `the loss is reported at once (first report at ${first.t.toFixed(2)} s)`);
  assert.ok(b.sim.S.events.some(e => /integrity lost/.test(e.text)) && b.sim.S.events.some(e => /integrity confirmed again/.test(e.text)), 'events of the loss and of the confirmation');
  console.log(`train integrity: lost at 120 s and reported at once (${first.t.toFixed(2)} s), ${rep.filter(r => r.p.Q_INTEGRITY === 3).length} reports with Q_INTEGRITY 3, confirmed again at 180 s; run identical to the one without the event: ok`);
}

// @test O10: odometry drift: the onboard locates the train from the last balise group, so the error starts again at every group and grows with the distance from it; within the confidence interval up to 1 %, beyond it the train stops closer to the end of authority, and reading 10 % less it passes a marker at danger [S026-3.6.4]
{
  const drift = async (slope: number | null, extra: Partial<ScenarioDef> = {}) => {
    const def: ScenarioDef = { name: 'drift', line: 'valle-lauro', train: 'regional', signalling: 'ETCS', onboard: 'reference', events: slope == null ? [] : [{ type: 'odometry_drift', slope }], ...extra };
    const { line, train, scen } = resolveScenario(def);
    const sim = new Simulation(line, train, scen, def), run = sim.train, ob = run.ob!;
    const w = { maxErr: 0, outside: 0, atGroup: 0, ratio: 0, closest: Infinity, passed: [] as string[] };
    let lrbg = -1, sAt = 0, prev = run.S.s;
    const step = sim.step.bind(sim);
    sim.step = (dt?: number) => {
      step(dt);
      // the true head passing a marker at danger for it (held, or protecting a section occupied by the freight train)
      for (let i = 0; i < run.line.sig.length; i++) if (prev < run.line.sig[i].s + 0.5 && run.S.s >= run.line.sig[i].s + 0.5 && atDangerFor(sim, run, i)) w.passed.push(run.line.sig[i].id);
      prev = run.S.s;
      const p = ob.resp?.position, bg = p && ob.bgs.find(b => nidLrbg(b.NID_BG) === p.NID_LRBG);
      if (!p || !bg) return;
      // the position the onboard believes, against the true one at the time of its response
      const err = bg.s + p.D_LRBG - ob.sAtResp;
      if (p.NID_LRBG !== lrbg) { lrbg = p.NID_LRBG; sAt = bg.s; w.atGroup = Math.max(w.atGroup, Math.abs(err)); }
      w.maxErr = Math.max(w.maxErr, Math.abs(err));
      w.outside = Math.max(w.outside, Math.abs(err) - p.L_DOUBTOVER);
      if (slope) w.ratio = Math.max(w.ratio, Math.abs(err) / Math.max(1, ob.sAtResp - sAt));
      if (run.S.ma && run.S.ma.why !== 'end of line' && run.S.v < 0.01) w.closest = Math.min(w.closest, run.S.ma.eoa - run.S.s);
    };
    await runLockstep(sim, loadJsController('examples/ato.js'), { period: 0.2 });
    return { sim, w };
  };
  const exact = await drift(null), d1 = await drift(-0.01), d5 = await drift(-0.05), p5 = await drift(0.05), d10 = await drift(-0.1);
  assert.ok(exact.w.maxErr < 0.01 && !exact.w.passed.length, `exact odometer: position error ${exact.w.maxErr} m`);
  for (const [name, x, slope] of [['−1 %', d1, 0.01], ['−5 %', d5, 0.05], ['+5 %', p5, 0.05], ['−10 %', d10, 0.1]] as const) {
    assert.ok(x.w.atGroup < 1, `${name}: error ${x.w.atGroup.toFixed(2)} m at a balise group, not relocated`);
    assert.ok(x.w.ratio <= slope + 0.002, `${name}: error ${(x.w.ratio * 100).toFixed(2)} % of the distance from the group, more than the drift`);
  }
  assert.ok(d1.w.outside <= 0, `−1 %: error outside the confidence interval by ${d1.w.outside.toFixed(1)} m`);
  assert.ok(d5.w.outside > 20 && p5.w.outside > 20, 'a 5 % drift stays within the confidence interval');
  // behind the freight train: reading less, the train stops closer to the end of authority; reading more, further
  assert.ok(d5.w.closest < exact.w.closest - 20 && p5.w.closest > exact.w.closest + 20, `stops before the end of authority: ${d5.w.closest.toFixed(1)}, ${exact.w.closest.toFixed(1)}, ${p5.w.closest.toFixed(1)} m`);
  assert.ok(!d1.w.passed.length && !d5.w.passed.length && !p5.w.passed.length, 'a marker at danger passed with a drift of 5 % or less');
  assert.ok(d10.w.passed.length >= 1, '−10 %: no marker at danger passed');
  // the engine counts every marker at danger passed, though the authority it recomputes from the position goes beyond it
  assert.equal(d10.sim.S.spad, d10.w.passed.length, `−10 %: ${d10.w.passed.length} markers at danger passed, ${d10.sim.S.spad} overruns counted`);
  assert.ok(d10.sim.S.events.some(e => e.kind === 'EMG' && /passed signal .* at danger/.test(e.text)), '−10 %: no event for the marker passed');
  assert.equal(exact.sim.S.spad + d1.sim.S.spad + d5.sim.S.spad + p5.sim.S.spad, 0, 'an overrun counted with a drift of 5 % or less');
  // with a duration the error accumulated so far stays, and is gone at the next balise group
  const short = await drift(null, { events: [{ type: 'odometry_drift', slope: -0.05, when: { t: 100 }, duration_s: 60 }] });
  assert.ok(short.w.atGroup < 1 && short.w.maxErr > 5 && !short.w.passed.length, `drift for 60 s: error ${short.w.maxErr.toFixed(1)} m, at a group ${short.w.atGroup.toFixed(2)} m`);
  console.log(`odometry drift: error at the balise groups below 1 m; largest error −1 % ${d1.w.maxErr.toFixed(1)} m (within the interval), −5 % ${d5.w.maxErr.toFixed(1)} m (${d5.w.outside.toFixed(1)} m outside), −10 % ${d10.w.maxErr.toFixed(1)} m; stop before the end of authority ${exact.w.closest.toFixed(1)} m exact, ${d1.w.closest.toFixed(1)} m at −1 %, ${d5.w.closest.toFixed(1)} m at −5 %, ${p5.w.closest.toFixed(1)} m at +5 %; at −10 % marker ${d10.w.passed[0]} passed at danger, overruns counted ${d10.sim.S.spad}: ok`);
}
console.log('ETCS onboard: ok');
