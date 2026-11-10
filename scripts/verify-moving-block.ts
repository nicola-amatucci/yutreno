/**
 * Checks of the moving block (phase 11, docs/MOVING_BLOCK.md): ETCS Level 2 with moving block in the path of the
 * simple RBC, with the reference onboard on every train.
 *
 *  1. Safety, at every step of every moving block run: the front end of a train following another one in its
 *     direction stays behind the true rear end of that train by at least the margin, less a tolerance for the stop
 *     of the follower; its end of authority is never beyond the true rear end.
 *  2. A wide headway: the follower runs as with the fixed block, never held by the signalling.
 *  3. Behind the freight train: closer than with the fixed block, earlier at the terminus.
 *  4. Integrity lost, radio of the train ahead lost: the rear end stays frozen and the follower stops behind it.
 *  5. Parameters: a shorter period of the position reports brings the follower closer; a delay of the reports keeps
 *     it further; packet 58 asks the onboard for the period; two equal runs give the same data.
 *  6. Outside its conditions (another signalling, onboard or trackside, a network) the run keeps the fixed block.
 *   npx tsx scripts/verify-moving-block.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Simulation, resolveScenario, runLockstep, type ScenarioDef, type ServiceDef } from '../src/core';
import { loadJsController, loadScenarios } from '../src/server/headless';

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const ato = () => loadJsController('examples/ato.js');
const sc = (f: string) => loadScenarios(`scenarios/${f}`)[0].def;
/** The same scenario at fixed block */
const fixed = (d: ScenarioDef): ScenarioDef => { const { spacing: _, moving_block: __, ...rest } = d; void _; void __; return rest; };
/** Tolerance of the stop of the follower before its end of authority (m) */
const STOP_TOL = 5;

interface Watch { minGap: number; at: number; maxEoaBeyond: number }
async function run(def: ScenarioDef, during?: (sim: Simulation) => void) {
  const r = resolveScenario(def), sim = new Simulation(r.line, r.train, r.scen, def);
  const w: Watch = { minGap: Infinity, at: 0, maxEoaBeyond: -Infinity };
  const step = sim.step.bind(sim);
  sim.step = (dt?: number) => {
    step(dt);
    // every pair of trains in the same direction on the line: the follower and the nearest train ahead of it
    for (const f of sim.trains) {
      if (!f.active || f.S.finished) continue;
      let ahead: typeof f | null = null;
      for (const a of sim.trains) if (a !== f && a.active && !a.S.finished && a.dir === f.dir && a.S.s > f.S.s && (!ahead || a.S.s < ahead.S.s)) ahead = a;
      if (!ahead) continue;
      const gap = (ahead.S.s - ahead.TR.L) - f.S.s;
      if (gap < w.minGap) { w.minGap = gap; w.at = sim.time; }
      if (f.S.ma?.why === 'moving block: train ahead') w.maxEoaBeyond = Math.max(w.maxEoaBeyond, f.S.ma.eoa - (ahead.S.s - ahead.TR.L));
    }
    during?.(sim);
  };
  await runLockstep(sim, ato(), { period: 0.2 });
  return { sim, w };
}
const safe = (name: string, w: Watch, margin = 50) => {
  assert.ok(w.minGap >= margin - STOP_TOL, `${name}: the follower came ${w.minGap.toFixed(1)} m from the rear end of the train ahead (margin ${margin} m) at ${w.at.toFixed(1)} s`);
  assert.ok(w.maxEoaBeyond <= -margin + 1e-6, `${name}: an end of authority ${(w.maxEoaBeyond + margin).toFixed(1)} m too far`);
};

// @test MB1: behind the freight train the authority ends the margin behind its confirmed rear end: the follower comes closer than at fixed block, never closer than the margin, and arrives earlier [X2R5-MB-CRE, X2R5-MB-MARGIN, S026-3.6.5.2.4-c]
const mb = await run(sc('moving-block.json')), fb = await run(fixed(sc('moving-block.json')));
safe('moving block', mb.w);
assert.equal(mb.sim.S.spad + mb.sim.S.interventions, 0, 'moving block: overruns or interventions');
assert.ok(mb.sim.S.t < fb.sim.S.t - 30, `moving block: arrival ${mb.sim.S.t.toFixed(1)} s, fixed block ${fb.sim.S.t.toFixed(1)} s`);
assert.ok(mb.w.minGap < fb.w.minGap - 200, `moving block: minimum distance ${mb.w.minGap.toFixed(1)} m, fixed block ${fb.w.minGap.toFixed(1)} m`);
console.log(`behind the freight train: minimum distance ${mb.w.minGap.toFixed(1)} m (fixed block ${fb.w.minGap.toFixed(1)} m), arrival ${mb.sim.S.t.toFixed(1)} s (fixed block ${fb.sim.S.t.toFixed(1)} s), end of authority always the margin behind the true rear end: ok`);

// @test MB2: with a wide headway the follower runs as with the fixed block, never held by the signalling [X2R5-MB-CRE]
{
  const stops = (t: number): ServiceDef['stops'] => [
    { station: 'Valle Lauro', departure_s: t }, { station: 'Ponte Sabato', arrival_s: t + 260, departure_s: t + 290 },
    { station: 'San Felice Scalo', arrival_s: t + 620, departure_s: t + 650 }, { station: 'Monte Clanio', arrival_s: t + 880 }];
  const def: ScenarioDef = { name: 'wide', line: 'valle-lauro', train: 'regional', signalling: 'ETCS', onboard: 'reference', leader: { on: false }, spacing: 'moving_block', events: [],
    services: [{ id: 'A', train: 'regional', stops: stops(1000) }, { id: 'B', train: 'regional', stops: stops(1600) }] };
  const a = await run(def), b = await run(fixed(def));
  safe('wide headway', a.w);
  const B = (s: Simulation) => s.trains.find(r => r.id === 'B')!;
  const arr = (s: Simulation) => JSON.stringify(B(s).realised);
  assert.equal(arr(a.sim), arr(b.sim), 'wide headway: the follower keeps the timetable of the fixed block');
  const hb = (s: Simulation) => (s.summary(B(s)) as unknown as { signalling_constrained_s: number }).signalling_constrained_s;
  assert.equal(hb(a.sim), 0, 'wide headway: the follower is held by the signalling');
  assert.equal(hb(b.sim), 0, 'wide headway, fixed block: the follower is held by the signalling');
  console.log(`600 s headway: the second service keeps the same realised timetable as at fixed block, held 0 s: ok`);
}

// @test MB3: with integrity lost, or with the radio of the train ahead lost, its confirmed rear end stays frozen and the follower stops behind it, then goes on [X2R5-MB-NOINT, X2R5-MB-SILENT, S026-3.6.5.2.9-c]
for (const [f, from, to] of [['moving-block-integrity-loss.json', 150, 450], ['moving-block-radio-loss.json', 150, 250]] as const) {
  let frozen: number | null = null, stopped = -1;
  const { sim, w } = await run(sc(f), s => {
    const [t, l] = [s.train, s.trains.find(r => r.id === 'leader')!];
    if (s.time > from + 5 && s.time < to) {
      const c = l.ob!.rbc.confirmedRear(l.ob!.engine, s.time);
      if (frozen == null) frozen = c; else assert.equal(c, frozen, `${f}: the confirmed rear end moved at ${s.time.toFixed(1)} s`);
      if (t.S.v < 0.01 && stopped < 0) stopped = s.time;
      if (t.S.ma?.why === 'moving block: train ahead') assert.ok(t.S.ma.eoa <= (frozen as number) - 50 + 1e-6, `${f}: authority beyond the frozen rear end`);
    }
  });
  safe(f, w);
  assert.equal(sim.verdict().outcome, 'passed', `${f}: ${sim.verdict().outcome}`);
  assert.ok(stopped > 0, `${f}: the follower did not stop behind the frozen rear end`);
  assert.ok(sim.S.t > mb.sim.S.t + 10, `${f}: arrival ${sim.S.t.toFixed(1)} s, not later than without the fault (${mb.sim.S.t.toFixed(1)} s)`);
  console.log(`${f}: rear end frozen at ${(frozen as unknown as number).toFixed(0)} m from ${from} to ${to} s, the follower at a stand from ${stopped.toFixed(1)} s, arrival ${sim.S.t.toFixed(1)} s: ok`);
}

// @test MB4: the train ahead stopped on the line: the follower stops behind it, the margin away, closer than at fixed block [X2R5-MB-CRE, X2R5-MB-MARGIN]
{
  // the distance at which the follower waits while the train ahead stands on the line (150–450 s)
  const waitGap = (g: { v: number }) => (s: Simulation) => {
    const t = s.train, l = s.trains.find(r => r.id === 'leader')!;
    if (s.time > 150 && s.time < 450 && t.S.v < 0.01 && l.S.v < 0.01) g.v = Math.min(g.v, l.S.s - l.TR.L - t.S.s);
  };
  const ga = { v: Infinity }, gb = { v: Infinity };
  const a = await run(sc('moving-block-leader-stopped.json'), waitGap(ga)), b = await run(fixed(sc('moving-block-leader-stopped.json')), waitGap(gb));
  safe('train ahead stopped', a.w);
  assert.ok(ga.v < gb.v - 50 && a.sim.S.t < b.sim.S.t, `train ahead stopped: ${ga.v.toFixed(1)} m and ${a.sim.S.t.toFixed(1)} s against ${gb.v.toFixed(1)} m and ${b.sim.S.t.toFixed(1)} s at fixed block`);
  console.log(`train ahead stopped on the line for 300 s: the follower waits ${ga.v.toFixed(1)} m behind it (fixed block ${gb.v.toFixed(1)} m), arrival ${a.sim.S.t.toFixed(1)} s (fixed block ${b.sim.S.t.toFixed(1)} s): ok`);
}

// @test MB5: the period of the position reports is asked with packet 58 and a shorter one brings the follower closer; a delay of the reports keeps it further; equal runs give equal data [S026-3.6.5.1.5-c, S026-7.4.2.15-c]
{
  const base = sc('moving-block.json');
  const p2 = await run({ ...base, moving_block: { report_period_s: 2 } });
  const d5 = await run({ ...base, moving_block: { radio_delay_s: 5 } });
  safe('period 2 s', p2.w); safe('delay 5 s', d5.w);
  assert.ok(p2.sim.S.t < mb.sim.S.t, `period 2 s: arrival ${p2.sim.S.t.toFixed(1)} s, with 6 s ${mb.sim.S.t.toFixed(1)} s`);
  assert.ok(d5.sim.S.t > mb.sim.S.t, `delay 5 s: arrival ${d5.sim.S.t.toFixed(1)} s, without ${mb.sim.S.t.toFixed(1)} s`);
  const p58 = p2.sim.train.ob!.log.filter(x => x.direction === 'RBC→onboard' && x.msg.NID_MESSAGE === 3).map(x => x.msg.packets!.find(p => p.NID_PACKET === 58));
  assert.ok(p58.length && p58.every(p => p?.T_CYCLOC === 2), 'packet 58 with T_CYCLOC = 2 in every authority');
  const rep = p2.sim.trains[1].ob!.log.filter(x => x.direction === 'onboard→RBC' && x.msg.NID_MESSAGE === 136).map(x => x.t);
  const gaps = rep.slice(1).map((t, i) => t - rep[i]).filter((_, i) => rep[i] > 20);
  assert.ok(Math.max(...gaps) <= 2 + 0.11, `reports of the train ahead every ${Math.max(...gaps).toFixed(2)} s at most`);
  const again = await run(sc('moving-block.json'));
  assert.equal(hash(again.sim.trains.map(r => again.sim.csv(r)).join('\n')), hash(mb.sim.trains.map(r => mb.sim.csv(r)).join('\n')), 'two equal runs gave different data');
  console.log(`arrival ${mb.sim.S.t.toFixed(1)} s with reports every 6 s, ${p2.sim.S.t.toFixed(1)} s every 2 s (packet 58), ${d5.sim.S.t.toFixed(1)} s with reports 5 s late; deterministic: ok`);
}

// @test MB6: outside its conditions the moving block is ignored with a warning, and the run is the fixed block one [X2R5-MB-CRE]
{
  for (const v of [{ onboard: 'internal' }, { signalling: 'BACC' }] as Partial<ScenarioDef>[]) {
    const a = await run({ ...sc('moving-block.json'), ...v }), b = await run({ ...fixed(sc('moving-block.json')), ...v });
    assert.ok(a.sim.S.events.some(e => /Moving block ignored/.test(e.text)), `${JSON.stringify(v)}: no warning`);
    assert.equal(hash(a.sim.csv()), hash(b.sim.csv()), `${JSON.stringify(v)}: the run is not the fixed block one`);
  }
  console.log('with the internal supervision or the automatic block: moving block ignored with a warning, the fixed block run: ok');
}
console.log('verify-moving-block: all ok');
