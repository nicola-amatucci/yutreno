/**
 * Checks the trackside with interlocking and RBC:
 *  1. translation of the control tables generated for the two lines: no warning, continuous chains of routes;
 *  2. interlocking alone against the field: setting, conflicting routes, point unable to move, immediate and delayed
 *     cancellation, sectional release section by section, trailed point;
 *  3. nominal runs with the interlocking trackside: complete, without interventions or overruns, deterministic;
 *  4. example scenarios with the reference onboard: with the interlocking trackside they have the same outcome as
 *     with the simple trackside;
 *  5. the same trackside as an external program (exec:) produces a run identical to the in-process one;
 *  6. the overtaking at Ponte Sabato routes the train on track II.
 * Requirements: see the @test tags and docs/traceability/tests.csv.
 *   npx tsx scripts/verify-trackside.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FIXED_DT, LINE_PRESETS, Simulation, clone, compileLine, resolveScenario, runLockstep, type ScenarioDef, type TracksideProvider } from '../src/core';
import { Field, generateLayout } from '../src/core/field';
import { Interlocking, Trackside, TracksideRbc, translateControlTables, type RouteConfig, type TracksideConfig, type TracksideRequest, type TracksideResponse } from '../src/trackside';
import { loadJsController, loadScenarios, openChannel } from '../src/server/headless';
import { builtInDriver } from './lib/drive';

const ato = () => loadJsController('examples/ato.js');
const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

// ---------------------------------------------------------------------------------------------
// @test T1: translation of the control tables, continuous route chains, conflicting routes [YT-CT]
// 1. translation of the control tables
for (const id of ['valle-lauro', 'appennino']) {
  const L = compileLine(clone(LINE_PRESETS[id]));
  const tr = translateControlTables(generateLayout(L));
  assert.deepEqual(tr.warnings, [], `${id}: warnings in the translation`);
  const starts = new Set(tr.routes.map(r => r.start_m.toFixed(1) + '@' + r.branch_start));
  for (const r of tr.routes) {
    if (r.type === 'arrival') continue;
    assert.ok(starts.has(r.end_m.toFixed(1) + '@' + r.branch_end), `${id}: no route starts on the same branch after ${r.id} (${r.name})`);
    for (const t of [...r.tvps, ...r.tvps_overlap]) assert.ok(tr.tvps.some(x => x.id === t), `${id}: ${r.id} uses the unknown section ${t}`);
  }
  // the entry on track I and the one on track II share the entry point in different positions: conflicting
  for (const r of tr.routes.filter(x => x.type === 'entry' && x.branch_end === 'I')) {
    const other = tr.routes.find(x => x.station === r.station && x.type === 'entry' && x.branch_end !== 'I');
    if (other) assert.ok(r.incompatible.includes(other.id), `${id}: ${r.id} and ${other.id} should be conflicting`);
  }
  console.log(`translation ${id}: ${tr.routes.length} routes, ${tr.points.length} points, ${tr.tvps.length} sections, no warning`);

  // both directions: the same nominal routes, and in the reverse direction too every route is followed by another
  const two = translateControlTables(generateLayout(L, { reverse: true }));
  assert.deepEqual(two.warnings, [], `${id}: warnings in the translation with both directions`);
  const strip = (r: RouteConfig) => ({ id: r.id, start: r.start_m, end: r.end_m, tvps: r.tvps, points: r.points, speeds: r.speeds, ov: r.tvps_overlap });
  assert.deepEqual(two.routes.filter(r => r.dir !== -1).map(strip), tr.routes.map(strip), `${id}: the nominal routes changed`);
  const rev = two.routes.filter(r => r.dir === -1);
  const rstarts = new Set(rev.map(r => r.start_m.toFixed(1) + '@' + r.branch_start));
  for (const r of rev) {
    assert.ok(r.start_m > r.end_m, `${id}: ${r.id} does not run towards the origin`);
    if (r.type !== 'arrival') assert.ok(rstarts.has(r.end_m.toFixed(1) + '@' + r.branch_end), `${id}: no reverse route after ${r.id} (${r.name})`);
  }
  assert.ok(two.markers.filter(m => m.dir === -1).length > 0 && rev.some(r => r.type === 'arrival'), `${id}: reverse markers or arrival at the origin missing`);
  // opposing movements: a reverse entry and a nominal entry of the same station are conflicting (overlap against path)
  for (const r of rev.filter(x => x.type === 'entry')) {
    const fwd = two.routes.find(x => x.dir !== -1 && x.station === r.station && x.type === 'entry');
    if (fwd) assert.ok(r.incompatible.includes(fwd.id), `${id}: ${r.id} and ${fwd.id} should be conflicting`);
  }
  const segs = new Set(two.routes.filter(r => r.segment != null).map(r => r.segment));
  console.log(`translation ${id} with both directions: ${rev.length} reverse routes, ${segs.size} single-track segments, nominal routes unchanged: ok`);
}

// ---------------------------------------------------------------------------------------------
// 2. interlocking and field without the engine
function configValleLauro(): TracksideConfig {
  const def: ScenarioDef = { name: 'cfg', line: 'valle-lauro', signalling: 'ETCS', onboard: 'reference', trackside: 'interlocking', events: [] };
  const r = resolveScenario(def);
  const sim = new Simulation(r.line, r.train, r.scen, def);
  return JSON.parse(JSON.stringify(sim.tr!.cfg)) as TracksideConfig;
}
class Bench {
  field: Field; ixl: Interlocking; t = 0; heads: { head: number; len: number; on: boolean }[] = [];
  constructor(cfg: TracksideConfig, trains: { head: number; len: number }[] = []) {
    this.field = new Field(cfg); this.ixl = new Interlocking(cfg);
    for (const x of trains) { this.field.addTrain(x.head, x.len); this.heads.push({ ...x, on: true }); }
    this.field.step(0, this.heads);
  }
  /** Advances by n cycles of 0.1 s; covered = routes included in an authority */
  cycle(n = 1, covered: string[] = [], move?: (h: { head: number }) => void): void {
    for (let i = 0; i < n; i++) {
      this.ixl.receive(this.field.telegrams());
      this.field.receive(this.ixl.cycle(this.t, { train: null, covered: new Set(covered) }), this.t);
      this.t = +(this.t + 0.1).toFixed(6);
      if (move) for (const h of this.heads) move(h);
      this.field.step(this.t, this.heads);
    }
  }
  state(id: string) { return this.ixl.routes.get(id)!.state; }
}
{
// @test T2: interlocking against the field: setting, conflicts, cancellation, point unable to move, no detection [EU38-SCI-P, EU38-Cd_Move_Point, EU38-Msg_Point_Position, EU38-Msg_Movement_Failed, EU38-Msg_Ability_To_Move_Point]
  const cfg = configValleLauro();
  cfg.parameters.ars = false;
  const b = new Bench(cfg);
  b.cycle(3);
  assert.equal(b.ixl.points.get('Ponte Sabato/1')!.pos, 'N', 'the point starts in normal');
  // immediate setting (point already in position) and conflicting routes
  assert.equal(b.ixl.request(b.ixl.routes.get('Ponte Sabato/1')!, b.t), null);
  b.cycle(1);
  assert.equal(b.state('Ponte Sabato/1'), 'set');
  assert.match(b.ixl.request(b.ixl.routes.get('Ponte Sabato/2')!, b.t) ?? '', /conflicting/);
  // immediate cancellation if not covered by an authority
  b.ixl.command({ type: 'cancel_route', id: 'Ponte Sabato/1' }, b.t, { train: null, covered: new Set() });
  assert.equal(b.state('Ponte Sabato/1'), 'free');
  // diverging entry: point movement (6 s) then set
  assert.equal(b.ixl.request(b.ixl.routes.get('Ponte Sabato/2')!, b.t), null);
  b.cycle(10);
  assert.equal(b.state('Ponte Sabato/2'), 'setting');
  assert.equal(b.ixl.points.get('Ponte Sabato/1')!.pos, 'moving');
  b.cycle(60);
  assert.equal(b.state('Ponte Sabato/2'), 'set');
  assert.equal(b.ixl.points.get('Ponte Sabato/1')!.pos, 'R');
  // delayed cancellation if the route is already included in an authority; then back to normal
  b.ixl.command({ type: 'cancel_route', id: 'Ponte Sabato/2' }, b.t, { train: null, covered: new Set(['Ponte Sabato/2']) });
  assert.equal(b.state('Ponte Sabato/2'), 'cancelling');
  b.cycle(1190, ['Ponte Sabato/2']);
  assert.equal(b.state('Ponte Sabato/2'), 'cancelling');
  b.cycle(20, ['Ponte Sabato/2']);
  assert.equal(b.state('Ponte Sabato/2'), 'free');
  b.cycle(80);
  assert.equal(b.ixl.points.get('Ponte Sabato/1')!.pos, 'N', 'after the cancellation the point returns to normal');
  // point unable to move: the diverging route is not set, the straight one is
  b.field.pointFault('Ponte Sabato/1', 'blocked');
  b.cycle(2);
  assert.match(b.ixl.request(b.ixl.routes.get('Ponte Sabato/2')!, b.t) ?? '', /unable to move/);
  assert.equal(b.ixl.request(b.ixl.routes.get('Ponte Sabato/1')!, b.t), null);
  b.cycle(1);
  assert.equal(b.state('Ponte Sabato/1'), 'set');
  // point without detection: the set route loses its integrity and is not valid for authorities
  b.field.pointFault('Ponte Sabato/1', 'no_detection');
  b.cycle(2);
  assert.equal(b.ixl.intact(b.ixl.routes.get('Ponte Sabato/1')!), false);
  b.field.pointFault('Ponte Sabato/1', 'none');
  b.cycle(2);
  assert.equal(b.ixl.intact(b.ixl.routes.get('Ponte Sabato/1')!), true);
  console.log('interlocking: setting, conflicting routes, immediate and delayed cancellation, point failure: ok');
}
// @test T8: the train ahead in session with the interlocking: routes, authority, end of session [YT-CT, YT-ARS, EU-SCI-RBC, S026-3.5.3]
for (const name of ['nominal', 'overtaking', 'operator-commands', 'point-failure', 'tvps-failure']) {
  const [{ def }] = loadScenarios(`scenarios/trackside/${name}.json`);
  const { line, train, scen } = resolveScenario(def);
  const sim = new Simulation(line, train, scen, def), drive = builtInDriver();
  const lead = sim.leader!;
  assert.ok(lead && lead.ob, `${name}: the train ahead should be a train of the run with its onboard`);
  let leaderLeftPS: number | null = null, holdChecked = false;
  const ps = sim.L.st[1];
  while (!sim.done && sim.time < 3000) {
    drive(sim);
    sim.step(FIXED_DT);
    if (name === 'overtaking') {
      if (leaderLeftPS == null && lead.S.s > ps.s + 400) leaderLeftPS = sim.time;
      // while the train ahead waits on track I its exit route is not set: the controlled train can leave from II
      if (!holdChecked && lead.S.doors && lead.S.doorT > 60) {
        const dep = sim.tr!.panel!.routes.find(r => r.name === 'Departure from Ponte Sabato track I');
        assert.equal(dep?.state, 'free', 'the exit of the waiting train ahead should not be set');
        holdChecked = true;
      }
    }
  }
  assert.ok(sim.S.finished && sim.S.spad === 0, `${name}: the controlled train did not finish or passed an EOA`);
  assert.ok(lead.S.finished, `${name}: the train ahead did not end its run at the last station`);
  // its onboard supervises it: it never passes the end of its authority, even when a failure takes a route away
  assert.equal(lead.S.spad, 0, `${name}: the train ahead passed the end of its authority`);
  // once the train ahead has ended its run its session is closed, or its End of Mission is on the way when the run
  // ended with it
  const eom = sim.tr!.pendingRadio.some(m => m.NID_MESSAGE === 150 && m.NID_ENGINE === lead.ob!.engine);
  assert.ok(eom || !(sim.tr!.panel?.sessions ?? []).some(x => x.engine === lead.ob!.engine), `${name}: the session of the train ahead is still open`);
  if (name === 'overtaking') {
    assert.ok(holdChecked, 'overtaking: the train ahead did not wait');
    const dep = sim.trains[0].realised.find(x => x.station === 'Ponte Sabato')!.departure_s as number;
    assert.ok(leaderLeftPS != null && leaderLeftPS > dep, `overtaking: the train ahead left Ponte Sabato before the controlled train (${leaderLeftPS} < ${dep})`);
  }
}
console.log('train ahead in session: routes and authority respected, no exit route held while waiting, session closed at the end of its run: ok');

// @test T7: block consent on a single-track segment, exchanged between the stations at its ends [YT-CT, YT-CONSENT]
{
  const [{ def: cross }] = loadScenarios('scenarios/services/crossing.json');
  const d2: ScenarioDef = { ...cross, onboard: 'reference', trackside: 'interlocking' };
  const r2 = resolveScenario(d2);
  const cfg = JSON.parse(JSON.stringify(new Simulation(r2.line, r2.train, r2.scen, d2).tr!.cfg)) as TracksideConfig;
  cfg.parameters.ars = false;
  const b = new Bench(cfg);
  b.cycle(3);
  const route = (station: string, dir: 1 | -1, type: string, branch = 'I') => cfg.routes.find(r => r.name.startsWith(type) && r.station != null && r.name.includes(station) && (r.dir ?? 1) === dir && r.branch_start === branch)!.id;
  const fwdDep = route('Ponte Sabato', 1, 'Departure'), revDep = route('San Felice Scalo', -1, 'Departure');
  const seg = cfg.routes.find(r => r.id === fwdDep)!.segment as number;
  assert.equal(cfg.routes.find(r => r.id === revDep)!.segment, seg, 'the two departures should enter the same segment');
  const blocks = (dir: 1 | -1) => cfg.routes.filter(r => r.segment === seg && r.type === 'block' && (r.dir ?? 1) === dir).map(r => b.state(r.id));
  // at the start the consent is held on the side of the origin: the block works in the nominal direction
  assert.equal(b.ixl.segDir.get(seg), 1);
  assert.ok(blocks(1).every(x => x === 'set') && blocks(-1).every(x => x === 'free'), 'the block should work only in the direction of the consent');
  assert.equal(b.ixl.request(b.ixl.routes.get(fwdDep)!, b.t), null);
  // the other end asks: refused while a departure into the segment is set
  assert.match(b.ixl.request(b.ixl.routes.get(revDep)!, b.t) ?? '', /waiting for the block consent from Ponte Sabato/);
  b.cycle(3);
  assert.equal(b.ixl.segDir.get(seg), 1, 'the consent must not move while a train may enter the segment');
  b.ixl.command({ type: 'cancel_route', id: fwdDep }, b.t, { train: null, covered: new Set() });
  // it asks again after the refusal (every 2 s) and the consent travels with one cycle per message
  let granted = -1;
  for (let k = 0; k < 40 && granted < 0; k++) { b.cycle(1); if (b.ixl.request(b.ixl.routes.get(revDep)!, b.t) == null) granted = k; }
  assert.ok(granted >= 0, 'the consent should be given once the segment is empty');
  assert.equal(b.ixl.segDir.get(seg), -1);
  b.cycle(2);
  assert.ok(blocks(1).every(x => x === 'free') && blocks(-1).every(x => x === 'set'), 'the idle blocks of the other direction should be released');
  // the consent is never held by both ends: while it travels nobody holds it
  assert.ok(b.ixl.ilsLog.some(m => m.kind === 'refuse') && b.ixl.ilsLog.some(m => m.kind === 'grant'));
  console.log(`block consent: held by Ponte Sabato, request of San Felice Scalo refused with a departure set, given when the segment is empty (${b.ixl.ilsLog.length} messages), idle blocks released: ok`);
}

{
  // @test T3: sectional release driven by the occupancy of the sections [EU44-SCI-TDS, EU44-Msg_TVPS_Occupancy_Status]
  // sectional release: a train runs on the entry to track I; the points zone is released before the end
  const cfg = configValleLauro();
  cfg.parameters.ars = false;
  const r = cfg.routes.find(x => x.id === 'Ponte Sabato/1')!;
  const b = new Bench(cfg, [{ head: r.start_m - 300, len: 100 }]);
  b.cycle(3);
  assert.equal(b.ixl.request(b.ixl.routes.get(r.id)!, b.t), null);
  b.cycle(1);
  const seen: string[] = [];
  let end = -1;
  const zone = cfg.tvps.find(x => x.id === 'Ponte Sabato/1PZ')!;
  for (let i = 0; i < 2000 && end < 0; i++) {
    b.cycle(1, [], h => { if (h.head < r.end_m - 20) h.head += 1; });
    const st = b.state(r.id);
    if (!seen.includes(st)) seen.push(st);
    if (st === 'free' && seen.includes('occupied')) end = b.heads[0].head;
  }
  assert.deepEqual(seen, ['set', 'occupied', 'free']);
  // the tail has left the points zone and the head is on the destination: the route is released without waiting for the end
  assert.ok(end - 100 >= zone.to_m && end < r.end_m - 100, `route released with the head at ${end} m`);
  assert.equal(b.ixl.points.get('Ponte Sabato/1')!.lock, null);
  assert.equal(b.ixl.tvps.get('Ponte Sabato/1PZ')!.lock, null);
  const zoneFree = zone.to_m;
  console.log(`sectional release: points zone (up to ${zoneFree.toFixed(0)} m) and route released with the head at ${end.toFixed(0)} m, before the end at ${r.end_m.toFixed(0)} m`);
}
{
  // @test T4: trailed point reported as unintended position and unable to move [EU38-Msg_Point_Position, EU38-Msg_Ability_To_Move_Point]
  // trailed point: the exit point set for track II, a train arrives from track I
  const cfg = configValleLauro();
  cfg.parameters.ars = false;
  const d2 = cfg.points.find(d => d.id === 'Ponte Sabato/2')!;
  const b = new Bench(cfg, [{ head: d2.s_m - 200, len: 50 }]);
  b.cycle(3);
  assert.equal(b.ixl.request(b.ixl.routes.get('Ponte Sabato/4')!, b.t), null);  // departure from II: 2R
  b.cycle(80);
  assert.equal(b.ixl.points.get('Ponte Sabato/2')!.pos, 'R');
  b.cycle(300, [], h => { h.head += 1; });
  assert.ok(b.field.events.some(e => e.includes('Point Ponte Sabato/2 trailed')), 'trailed point not detected');
  assert.equal(b.ixl.points.get('Ponte Sabato/2')!.able, false, 'the trailed point is no longer able to move');
  console.log('trailed point: detected by the field and reported to the interlocking as unintended position');
}

// ---------------------------------------------------------------------------------------------
// @test T5: nominal runs with the authority built from the routes [S026-3.8.3, S026-3.8.5, S026-8.7.2]
// 3. nominal runs with the interlocking trackside
async function run(def: ScenarioDef, ctl = ato(), trackside?: TracksideProvider) {
  const r = resolveScenario(def);
  const sim = new Simulation(r.line, r.train, r.scen, def);
  await runLockstep(sim, ctl, { period: 0.2, ...(trackside ? { trackside: trackside } : {}) });
  return sim;
}
for (const line of ['valle-lauro', 'appennino']) {
  const def: ScenarioDef = { name: 'nominal', line: line, signalling: 'ETCS', onboard: 'reference', trackside: 'interlocking', events: [] };
  const a = await run(def), b = await run(def);
  assert.ok(a.S.finished, `${line}: run not completed`);
  assert.equal(a.S.interventions, 0, `${line}: protection interventions`);
  assert.equal(a.S.spad, 0, `${line}: overruns`);
  assert.equal(hash(a.csv()), hash(b.csv()), `${line}: two equal runs gave different data`);
  console.log(`nominal run ${line} with interlocking trackside: arrival at ${a.S.t.toFixed(1)} s, no intervention, deterministic (${hash(a.csv())})`);
}

// ---------------------------------------------------------------------------------------------
// 4. example scenarios: same outcome with the simple and the interlocking trackside (reference onboard)
for (const { file, def } of loadScenarios('scenarios')) {
  if ((def.signalling ?? 'ETCS') !== 'ETCS') continue;
  const s = await run({ ...def, onboard: 'reference', trackside: 'simple' });
  const a = await run({ ...def, onboard: 'reference', trackside: 'interlocking' });
  const name = file.split(/[\\/]/).pop();
  assert.equal(a.verdict().outcome, s.verdict().outcome, `${name}: outcome with interlocking trackside ${a.verdict().outcome}, with simple trackside ${s.verdict().outcome}`);
  console.log(`${name}: ${a.verdict().outcome} with both tracksides (overruns ${s.S.spad} → ${a.S.spad})`);
}

// ---------------------------------------------------------------------------------------------
// @test T6: the trackside as an external program gives an identical run [EU38-SCI-P, EU44-SCI-TDS]
// 5. external trackside: identical to the in-process trackside
{
  const def: ScenarioDef = { name: 'external', line: 'valle-lauro', signalling: 'ETCS', onboard: 'reference', trackside: 'external', events: [] };
  const ch = await openChannel<TracksideRequest, TracksideResponse>('exec:npx --no-install tsx examples/trackside/trackside_stdio.ts', 'the trackside');
  const e = await run(def, ato(), ch.call);
  await ch.close();
  const i = await run({ ...def, trackside: 'interlocking' });
  assert.equal(hash(e.csv()), hash(i.csv()), 'the external trackside produced a run different from the in-process one');
  console.log(`external trackside via exec: run identical to the in-process one (${hash(e.csv())})`);
  // several trains with one session each, and the conflict rule: the same, train by train
  const [{ def: p }] = loadScenarios('scenarios/services/precedence.json');
  const ch2 = await openChannel<TracksideRequest, TracksideResponse>('exec:npx --no-install tsx examples/trackside/trackside_stdio.ts', 'the trackside');
  const e2 = await run({ ...p, trackside: 'external' }, ato(), ch2.call);
  await ch2.close();
  const i2 = await run(p);
  const all = (sim: Simulation) => hash(sim.trains.map(r => sim.csv(r)).join('\n'));
  assert.ok(e2.trains.length === 2 && e2.trains.every(r => r.S.finished), 'precedence via exec: a train did not finish');
  assert.equal(all(e2), all(i2), 'precedence: the external trackside produced a run different from the in-process one');
  console.log(`external trackside via exec, two trains in session: run identical to the in-process one (${all(e2)})`);
  // trains in both directions: reverse routes, block consent and Q_DIR = 0 authorities, the same in and out of process
  const [{ def: cx }] = loadScenarios('scenarios/services/crossing-interlocking.json');
  const ch3 = await openChannel<TracksideRequest, TracksideResponse>('exec:npx --no-install tsx examples/trackside/trackside_stdio.ts', 'the trackside');
  const e3 = await run({ ...cx, trackside: 'external' }, ato(), ch3.call);
  await ch3.close();
  const i3 = await run(cx);
  for (const r of i3.trains) assert.ok(r.S.finished && i3.summary(r).overruns === 0 && i3.summary(r).interventions === 0, `crossing: ${r.id} not finished or protection involved`);
  assert.ok(!i3.S.events.some(e => /trailed/.test(e.text)), 'crossing: a point was trailed');
  assert.equal(all(e3), all(i3), 'crossing: the external trackside produced a run different from the in-process one');
  console.log(`external trackside via exec, trains in both directions: run identical to the in-process one (${all(e3)}), no point trailed: ok`);
}

// ---------------------------------------------------------------------------------------------
// 6. overtaking: the train runs on track II of Ponte Sabato
{
  const [{ def }] = loadScenarios('scenarios/trackside/overtaking.json');
  const r = resolveScenario(def);
  const sim = new Simulation(r.line, r.train, r.scen, def);
  let onII = false;
  const ctl = ato();
  await runLockstep(sim, o => { if (sim.tr!.field.branchesOf(0).has('II:Ponte Sabato')) onII = true; return ctl(o); }, { period: 0.2 });
  assert.ok(onII, 'the train did not run on track II');
  assert.equal(sim.verdict().outcome, 'passed');
  console.log(`overtaking: the regional train ran on track II of Ponte Sabato, arrival at ${sim.S.t.toFixed(1)} s`);
}
// ---------------------------------------------------------------------------------------------
// 7. RBC/RBC handover: two RBCs on the line, the authority runs on across the border
{
  // every NRBC message delivered and every radio message received by an RBC, in order
  const log: string[] = [];
  const rx = TracksideRbc.prototype.receiveNrbc, rr = TracksideRbc.prototype.receive;
  TracksideRbc.prototype.receiveNrbc = function (m, t) { log.push(`${m.NID_RBC}>${m.to} ${m.NID_NRBCMESSAGE}`); return rx.call(this, m, t); };
  const t156: number[] = [];
  TracksideRbc.prototype.receive = function (m, t) { if (this.area && m.NID_MESSAGE === 156) { log.push(`train>${this.area.nid} ${m.NID_MESSAGE}`); t156.push(t); } return rr.call(this, m, t); };
  const sc = (f: string) => loadScenarios(`scenarios/trackside/${f}`)[0].def;
  const runAll = async (def: ScenarioDef, trackside?: TracksideProvider) => { log.length = 0; t156.length = 0; const sim = await run(def, ato(), trackside); return { sim, log: [...log] }; };
  // the end of authority beyond the border comes from the route related information, whose distances are rounded down
  // to the metre from the border group and then again from the last group of the train: it may be 1 m shorter, and come
  // up to 2 s later (the route related information follows the setting of the route). Everything else, the motion of the train above all, must be the same as with one RBC
  const same = (a: Simulation, b: Simulation, what: string) => {
    for (let k = 0; k < b.trains.length; k++) {
      const x = a.csv(a.trains[k]).split('\n'), y = b.csv(b.trains[k]).split('\n'), j = x[0].split(',').indexOf('eoa_m');
      assert.equal(x.length, y.length, `${what}: ${b.trains[k].id} has a different number of samples`);
      let late = 0;
      for (let i = 1; i < x.length; i++) {
        const p = x[i].split(','), q = y[i].split(',');
        const dq = Math.abs(Number(p[j]) - Number(q[j]));
        if (dq > 1.01) late++;
        p[j] = q[j] = '';
        assert.equal(p.join(), q.join(), `${what}: ${b.trains[k].id} differs from the run with one RBC at ${p[0]} s`);
      }
      assert.ok(late <= 4, `${what}: ${b.trains[k].id}: end of authority different for ${late} samples`);
    }
  };
  const firsts = (l: string[]) => l.filter((x, i) => l.indexOf(x) === i);

  // @test HO1: nominal handover, the same run as with one RBC, with the Subset-039 sequence and the session closed [S026-3.15.1, S026-3.15.1.1.1-c, S026-3.15.1.1.6-c, S026-3.15.1.2.1-c, S026-3.15.1.2.3-c, S026-3.15.1.2.4-c, S026-3.15.1.2.6-c, S026-3.15.1.2.7-c, S026-3.15.1.2.8-c, S026-3.15.1.3.1-c, S026-3.15.1.3.3-c, S026-3.15.1.3.4-c, S026-3.15.1.3.5-c, S026-3.15.1.3.6-c, S026-3.15.1.3.7-c, S026-3.15.1.4.1-c, S026-3.15.1.4.2-c, S026-3.15.1.4.3-c, S026-3.15.1.4.5-c, S026-3.15.1.5.1-c, S026-5.15, S026-5.15.1.1-c, S026-5.15.1.4-c, S026-5.15.2-c, S026-7.4.2.27-c, S026-7.4.2.10-c, S039-4.3.1.1, S039-4.5.1, S039-4.5.2, S039-4.6.2, S039-4.6.3, S039-5.2, S039-5.3, S039-5.4]
  const h = await runAll(sc('handover.json'));
  const one = await run(sc('nominal.json'));
  assert.ok(h.sim.S.finished && h.sim.S.spad === 0 && h.sim.S.interventions === 0, 'handover: run not completed or protection involved');
  assert.equal(h.sim.S.t.toFixed(2), one.S.t.toFixed(2), 'handover: arrival different from the run with one RBC');
  same(h.sim, one, 'handover');
  const seq = firsts(h.log.filter(x => !/ 223$/.test(x)));
  const want = ['1>2 201', '2>1 205', '1>2 202', '2>1 221', '1>2 205', '1>2 203', '2>1 222', 'train>1 156'];
  for (const w of want) assert.ok(seq.includes(w), `handover: message ${w} missing (${seq.join(', ')})`);
  for (let i = 1; i < want.length; i++) assert.ok(seq.indexOf(want[i - 1]) < seq.indexOf(want[i]), `handover: ${want[i - 1]} after ${want[i]}`);
  assert.ok(h.log.some(x => x === '1>2 223') && h.log.some(x => x === '2>1 223'), 'handover: no life sign between the RBCs');
  const p = h.sim.tr!.panel!;
  assert.deepEqual(p.rbcs?.map(r => [r.NID_RBC, r.sessions.length, r.handovers.length]), [[1, 0, 0], [2, 1, 0]], 'handover: at the end the train must be in session with RBC 2 only');
  console.log(`RBC/RBC handover: same run as with one RBC (end of authority within 1 m), sequence ${seq.join(' → ')}: ok`);

  // @test HO2: without the RBC/RBC link or the radio of the accepting RBC the train stops before the border, then continues [S026-5.15.4.2-c, S026-3.15.1.2.4-c, S039-4.4, S039-4.6.2, S039-4.6.3]
  const alone = await run({ ...sc('handover.json'), leader: { on: false } });
  for (const f of ['handover-link-loss.json', 'handover-radio-loss.json']) {
    const { sim } = await runAll(sc(f));
    assert.equal(sim.verdict().outcome, 'passed', `${f}: outcome ${sim.verdict().outcome}`);
    assert.equal(sim.S.spad, 0, `${f}: overruns`);
    assert.equal(sim.S.interventions, 0, `${f}: interventions`);
    // at standstill before the border (main signal at 7725 m) while the fault lasts, and only then
    const stops = sim.csv().split('\n').slice(1).map(l => l.split(',').map(Number)).filter(([t, x, v]) => v < 0.5 && x > 7300 && x < 7725);
    assert.ok(stops.length && stops.every(([t]) => t > 200 && t <= 505), `${f}: the train did not wait before the border during the fault`);
    const held = sim.summary().signalling_constrained_s - alone.summary().signalling_constrained_s;
    assert.ok(held > 60, `${f}: time held by the signalling only ${held.toFixed(1)} s more than with one RBC`);
    console.log(`${f}: train at standstill before the border at ${Math.max(...stops.map(z => z[1])).toFixed(0)} m until ${Math.max(...stops.map(z => z[0])).toFixed(1)} s, ${held.toFixed(1)} s more held by the signalling, arrival at ${sim.S.t.toFixed(1)} s, no overrun or intervention: ok`);
  }

  // @test HO3: handover in both directions and with two trains, the same runs as with one RBC [S026-3.15.1.1.1-c, S026-3.15.1.3.5-c, S039-4.3.1.1]
  for (const [name, def] of [['crossing', loadScenarios('scenarios/services/crossing-interlocking.json')[0].def], ['overtaking', sc('overtaking.json')]] as const) {
    const a = await runAll({ ...def, rbc_borders_m: [7600] }), b = await run(def);
    same(a.sim, b, name);
    assert.ok(a.log.filter(x => / 222$/.test(x)).length >= 2, `${name}: fewer than two handovers`);
    console.log(`${name} with two RBCs: ${a.log.filter(x => / 222$/.test(x)).length} handovers, same run as with one RBC: ok`);
  }

  // @test HO4: the trackside with two RBCs as an external program gives an identical run, deterministic [S039-4.4]
  const ch = await openChannel<TracksideRequest, TracksideResponse>('exec:npx --no-install tsx examples/trackside/trackside_stdio.ts', 'the trackside');
  const e = await run({ ...sc('handover-link-loss.json'), trackside: 'external' }, ato(), ch.call);
  await ch.close();
  const i1 = await run(sc('handover-link-loss.json')), i2 = await run(sc('handover-link-loss.json'));
  assert.equal(hash(i1.csv()), hash(i2.csv()), 'handover: two equal runs gave different data');
  assert.equal(hash(e.csv()), hash(i1.csv()), 'handover: the external trackside produced a run different from the in-process one');
  console.log(`handover with the link lost, trackside via exec: identical to the in-process one and deterministic (${hash(e.csv())}): ok`);

  // @test HO5: without the order to terminate, the onboard repeats the report of its rear end past the border, then ends the session by itself [S026-3.15.1.3.9-c]
  const alone2 = await runAll({ ...sc('handover.json'), leader: { on: false } });
  const tNormal = t156[0];
  const P = TracksideRbc.prototype as unknown as { terminateOrder: (ses: unknown, t: number) => unknown };
  const order = P.terminateOrder;
  // the Handing Over RBC sends a message 24 without packet 42: the onboard accepts only the order from it, and ignores it
  P.terminateOrder = function (this: TracksideRbc, ses, t) { const m = order.call(this, ses, t) as { packets: unknown[] }; return { ...m, packets: [] }; };
  const late = await runAll({ ...sc('handover.json'), leader: { on: false } });
  P.terminateOrder = order;
  assert.equal(hash(late.sim.csv()), hash(alone2.sim.csv()), 'termination by the onboard: the run changed');
  assert.ok(t156.length === 1 && t156[0] - tNormal > 59 && t156[0] - tNormal < 62, `termination by the onboard: session with RBC 1 ended at ${t156[0]?.toFixed(1)} s, with the order at ${tNormal.toFixed(1)} s`);
  console.log(`no order to terminate: the onboard repeats its report three times every 15 s and ends the session with RBC 1 at ${t156[0].toFixed(1)} s instead of ${tNormal.toFixed(1)} s: ok`);

  // @test HO6: an End of Mission during the transaction cancels it: the Accepting RBC orders the onboard to terminate the session opened with it [S026-3.15.1.2.9-c, S026-3.15.1.4.4-c, S039-5.4]
  {
    // the End of Mission arrives at RBC 1 once the train is in session with RBC 2 and before its front end is past the border
    let seen2 = false, injected = -1;
    const base = TracksideRbc.prototype.receive;
    TracksideRbc.prototype.receive = function (m, t) {
      if (this.area?.nid === 2 && m.NID_MESSAGE === 136) seen2 = true;
      const h = this.sessions.get(1)?.hov;
      if (this.area?.nid === 1 && seen2 && injected < 0 && h?.acked && !h.announced) { injected = t; base.call(this, { NID_MESSAGE: 150, T_TRAIN: Math.round(t * 100), NID_ENGINE: 1, NID_RBC: 1 }, t); }
      return base.call(this, m, t);
    };
    log.length = 0; t156.length = 0;
    const def = { ...sc('handover.json'), leader: { on: false } };
    const r = resolveScenario(def), sim = new Simulation(r.line, r.train, r.scen, def);
    await runLockstep(sim, ato(), { period: 0.2, maxTime: 650 });
    TracksideRbc.prototype.receive = base;
    const i204 = log.indexOf('1>2 204');
    assert.ok(injected > 0 && i204 >= 0, `cancellation: no 204 (${log.filter(x => !/ 223$/.test(x)).join(', ')})`);
    assert.ok(!log.slice(0, i204).includes('1>2 203'), 'cancellation: sent after the announcement');
    assert.ok(log.slice(i204).includes('train>2 156'), 'cancellation: the onboard did not terminate the session with RBC 2');
    console.log(`End of Mission at RBC 1 at ${injected.toFixed(1)} s during the handover: cancellation (204) to RBC 2, which orders the onboard to terminate its session: ok`);
  }

  // @test HO7: a radio message for an RBC that does not exist is discarded with a warning [S026-3.15.1.3.7-c]
  {
    const def: ScenarioDef = { ...sc('handover.json'), leader: { on: false }, trackside: 'external' };
    const r = resolveScenario(def), sim = new Simulation(r.line, r.train, r.scen, def);
    const ts = new Trackside();
    let sent = false;
    await runLockstep(sim, ato(), { period: 0.2, maxTime: 120, trackside: req => {
      if (!sent && req.radio.length) { sent = true; req = { ...req, radio: [...req.radio, { ...req.radio[0], NID_RBC: 9 }] }; }
      return ts.step(req);
    } });
    assert.ok(sent && sim.S.events.some(e => e.kind === 'WARN' && /for RBC 9, which does not exist: discarded/.test(e.text)), 'unknown RBC: no warning');
    console.log('radio message for RBC 9, which does not exist: discarded with a warning: ok');
  }
  TracksideRbc.prototype.receiveNrbc = rx; TracksideRbc.prototype.receive = rr;
}
console.log('verify-trackside: all ok');
