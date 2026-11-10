/**
 * Checks of the control room snapshot (docs/CONTROL_ROOM.md): `Simulation.controlRoom()` against the state of the
 * engine, on a single line and on a network, with the trackside of the engine and with the interlocking trackside;
 * determinism; every active train on the schematic, also off the main line.
 * CR2: the dispatcher (`Simulation.dispatch`): a speed restriction put in force and revoked, a train held, a stop
 * skipped, refusals with their reason, and the run repeated with the commands given at the same times.
 * CR3: the commands of the dispatcher written into the scenario as `dispatch` events (`withDispatched`): the scenario
 * is valid and gives the same run as the commands given live.
 *   npx tsx scripts/verify-control-room.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { CONTROL_ROOM_VERSION, FIXED_DT, Simulation, directed, onLine, resolveScenario, validateScenario, withDispatched, type ControlRoomSnapshot, type ScenarioDef } from '../src/core';
import { loadScenarios } from '../src/server/headless';
import { builtInDriver } from './lib/drive';

const [{ def: branch }] = loadScenarios('scenarios/services/branch.json');
const [{ def: crossing }] = loadScenarios('scenarios/services/crossing.json');
const [{ def: crossingIxl }] = loadScenarios('scenarios/services/crossing-interlocking.json');

/** A run that takes a snapshot every 10 s and checks it against the engine; returns the fingerprint of all the snapshots */
function run(def: ScenarioDef) {
  const { line, train, scen } = resolveScenario(def);
  const sim = new Simulation(line, train, scen, def), drive = builtInDriver();
  const h = createHash('sha256');
  // when the field last changed its occupancy of every section: the panel of the trackside is one cycle behind
  const changed = new Map<string, { occ: boolean; t: number }>();
  let snaps = 0, seenOff = 0, checkedSections = 0;
  while (!sim.done && sim.time < 6000) {
    drive(sim);
    sim.step(FIXED_DT);
    const tr = sim.tr;
    if (tr) for (const f of tr.fields) for (const id of f.tvps.keys()) {
      const occ = f.occupiedBy(id).length > 0, c = changed.get(id);
      if (!c || c.occ !== occ) changed.set(id, { occ, t: sim.time });
    }
    if (Math.round(sim.time / FIXED_DT) % Math.round(10 / FIXED_DT) !== 0) continue;
    const c: ControlRoomSnapshot = sim.controlRoom();
    snaps++;
    h.update(JSON.stringify(c));
    assert.equal(c.type, 'control_room'); assert.equal(c.version, CONTROL_ROOM_VERSION);
    assert.deepEqual(JSON.parse(JSON.stringify(c)), c, 'the snapshot is plain JSON');
    const lines = sim.net.lines;
    assert.deepEqual(c.network.lines.map(l => l.id), lines.map(n => n.id), 'every line of the network');
    for (const [j, l] of c.network.lines.entries()) {
      // signals: the aspects of the directed lines, in the chainages of the line
      for (const d of l.directions) {
        const D = directed(lines[j], d), mine = l.signals.filter(g => g.dir === d);
        assert.equal(mine.length, D.sig.length, `${l.id} ${d}: signals`);
        mine.forEach((g, i) => { assert.equal(g.aspect, D.sig[i].asp ?? null, `${l.id} ${d} ${g.id}: aspect`); assert.ok(Math.abs(g.s_m - (d > 0 ? D.sig[i].s : D.len - D.sig[i].s)) < 0.06, `${l.id} ${g.id}: position`); });
      }
      // the interlocking: sections as the field sees them, except those that changed within the last trackside cycle
      for (const s of l.sections ?? []) {
        const f = changed.get(s.id);
        if (!f || sim.time - f.t < (tr?.period ?? 0) + 2 * FIXED_DT || s.state === 'disturbed') continue;
        checkedSections++;
        assert.equal(s.state === 'occupied', f.occ, `${s.id} at ${sim.time.toFixed(1)} s: ${s.state} in the snapshot, ${f.occ ? 'occupied' : 'vacant'} on the field`);
      }
    }
    for (const r of sim.trains) {
      const t = c.trains.find(x => x.id === r.id);
      assert.ok(t, `${r.id} in the table`);
      const on = r.active && !r.S.finished;
      assert.equal(t.status === 'finished', r.S.finished && r.cancelled !== 'all', `${r.id}: status ${t.status}`);
      if (!on) { assert.equal(t.line, null, `${r.id}: no position off the line`); continue; }
      // every active train is on the schematic, on the line of its head, with the stretch of every line it is on
      assert.ok(t.line != null && t.s_m != null, `${r.id}: on the schematic`);
      const j = lines.findIndex(n => n.id === t.line), p = onLine(r.legs, j, r.S.s, r.TR.L);
      assert.ok(p, `${r.id}: on line ${t.line}`);
      assert.ok(Math.abs((p.dir > 0 ? p.head : lines[j].L.len - p.head) - (t.s_m as number)) < 0.06, `${r.id}: chainage`);
      if (j > 0) seenOff++;
      assert.ok(Math.abs(t.v_kmh - r.S.v * 3.6) < 0.06, `${r.id}: speed`);
      // the block under the head is occupied in its direction
      const l = c.network.lines[j], x = t.s_m as number, d = t.dir as 1 | -1;
      const b = l.blocks.find(k => k.dir === d && (d > 0 ? x > k.from_m + 1 && x <= k.to_m : x >= k.from_m && x < k.to_m - 1));
      if (b) assert.ok(b.occupied, `${r.id}: block ${b.from_m}–${b.to_m} of direction ${d} not occupied`);
    }
    // the delays are those of the timetable of the run
    const tt = sim.timetable();
    for (const t of c.trains) {
      const plan = tt.find(x => x.id === t.id) as ReturnType<Simulation['timetable']>[number];
      const last = [...plan.stops].reverse().find(s => s.departure_delay_s != null || s.arrival_delay_s != null);
      if (last && t.delay_s != null) assert.ok(Math.abs(t.delay_s - (last.departure_delay_s ?? last.arrival_delay_s as number)) < 0.11, `${t.id}: delay ${t.delay_s} against ${JSON.stringify(last)}`);
    }
    assert.ok(c.log.length <= 200 && c.log.every((e, i) => i === 0 || e.t_s >= c.log[i - 1].t_s), 'log in order');
  }
  return { sim, snaps, seenOff, checkedSections, hash: h.digest('hex').slice(0, 16) };
}

// @test CR1: the control room snapshot matches the engine and is deterministic, on a line and on a network, with both tracksides [YT-CR]
const cases: [string, ScenarioDef][] = [
  ['crossing, automatic block', { ...crossing, signalling: 'BACC' }],
  ['crossing, interlocking', crossingIxl],
  ['branch, automatic block', { ...branch, signalling: 'BACC' }],
  ['branch, interlocking', { ...branch, signalling: 'ETCS', onboard: 'reference', trackside: 'interlocking' }],
];
for (const [name, def] of cases) {
  const a = run(def), b = run(def);
  assert.equal(a.hash, b.hash, `${name}: two equal runs gave different snapshots`);
  if (def.network) assert.ok(a.seenOff > 0, `${name}: no train seen off the main line`);
  if (def.trackside === 'interlocking') assert.ok(a.checkedSections > 0, `${name}: no section checked`);
  console.log(`${name}: ${a.snaps} snapshots match the engine (signals, blocks, trains, delays${a.checkedSections ? `, ${a.checkedSections} section states` : ''}${a.seenOff ? `, ${a.seenOff} times a train off the main line` : ''}), deterministic (${a.hash}): ok`);
}

// @test CR2: dispatcher commands from the control room, repeatable [YT-CR]
{
  const [{ def: following }] = loadScenarios('scenarios/services/following.json');
  type Plan = { t: number; c: Parameters<Simulation['dispatch']>[0] }[];
  const drive = (plan: Plan, def: ScenarioDef = following) => {
    const { line, train, scen } = resolveScenario(def);
    const sim = new Simulation(line, train, scen, def), drive = builtInDriver();
    let k = 0, vmaxIn = 0, refused: (string | null)[] = [];
    while (!sim.done && sim.time < 3000) {
      while (k < plan.length && sim.time + 1e-9 >= plan[k].t) refused.push(sim.dispatch(plan[k++].c));
      drive(sim);
      sim.step(FIXED_DT);
      const r = sim.trains.find(t => t.id === 'R 2102')!;
      if (r.active && !r.S.finished && sim.time < 1100 && r.S.s > 5000 && r.S.s < 6000) vmaxIn = Math.max(vmaxIn, r.S.v * 3.6);
    }
    const h = createHash('sha256').update(sim.trains.map(t => sim.csv(t)).join('\n') + JSON.stringify(sim.timetable())).digest('hex').slice(0, 16);
    return { sim, vmaxIn, refused, h };
  };
  const tsr = { type: 'speed_restriction' as const, from_m: 5000, to_m: 6000, v_kmh: 40 };
  const plan: Plan = [
    { t: 100, c: tsr },
    { t: 100, c: tsr },                                                          // the same again: refused
    { t: 200, c: { type: 'retime', train: 'R 2102', station: 'Ponte Sabato', departure_s: 780 } },
    { t: 300, c: { type: 'skip_stop', train: 'R 2104', station: 'San Felice Scalo' } },
    { t: 300, c: { type: 'skip_stop', train: 'train', station: 'San Felice Scalo' } }, // the controlled train: refused
    { t: 300, c: { type: 'priority', train: 'R 9999', value: 1 } },                 // no such train: refused
    { t: 1100, c: { ...tsr, revoke: true } },
  ];
  const a = drive(plan), none = drive([]);
  assert.deepEqual(a.refused.map(x => x != null), [false, true, false, false, true, true, false], `CR2: applied and refused commands (${JSON.stringify(a.refused)})`);
  assert.ok(a.vmaxIn <= 40 + 1 && none.vmaxIn > 50, `CR2: R 2102 at most 40 km/h in the restriction (${a.vmaxIn.toFixed(1)}, ${none.vmaxIn.toFixed(1)} without)`);
  const ps = a.sim.trains.find(t => t.id === 'R 2102')!.realised.find(x => x.station === 'Ponte Sabato')!;
  assert.ok(ps.departure_s! >= 780, `CR2: R 2102 held at Ponte Sabato until 780 s (${ps.departure_s})`);
  const r4 = a.sim.trains.find(t => t.id === 'R 2104')!;
  assert.ok(!r4.realised.some(x => x.station === 'San Felice Scalo' && x.arrival_s != null && x.departure_s != null && x.departure_s - x.arrival_s > 1), 'CR2: R 2104 does not stop at San Felice Scalo');
  assert.equal(a.sim.dispatched.length, 4, 'CR2: four commands recorded');
  assert.equal(a.sim.S.events.filter(e => e.text.startsWith('Dispatcher:')).length, 7, 'CR2: every command in the log');
  // the run repeated from the record of the commands
  const again = drive(a.sim.dispatched.map(d => ({ t: d.t_s, c: d.command })));
  assert.equal(again.h, a.h, 'CR2: the same commands at the same times give the same run');
  assert.notEqual(a.h, none.h, 'CR2: the commands change the run');
  console.log(`CR2 dispatcher: restriction 40 km/h (R 2102 at ${a.vmaxIn.toFixed(1)} km/h, ${none.vmaxIn.toFixed(1)} without), held until ${ps.departure_s!.toFixed(1)} s, stop skipped, 3 refusals with their reason, repeated from the record (${a.h}): ok`);

  // @test CR3: dispatcher commands written into the scenario as events, the same run [YT-CR]
  {
    // the same plan, with a command at the start of the run and one given while the controlled train moves
    const live = drive([{ t: 0, c: { type: 'priority', train: 'R 2104', value: 5 } }, ...plan, { t: 437.5, c: { type: 'speed_restriction', from_m: 9000, to_m: 10000, v_kmh: 50 } }]);
    const def = withDispatched(following, live.sim.dispatched);
    assert.deepEqual(validateScenario(def), [], 'CR3: the scenario with the commands is valid');
    assert.equal(def.events!.filter(e => e.type === 'dispatch').length, live.sim.dispatched.length, 'CR3: one event per command applied');
    assert.deepEqual(validateScenario({ ...following, events: [{ type: 'dispatch', when: { pos: 100 }, dispatch: { type: 'priority', train: 'R 2102', value: 1 } }] }).length, 1, 'CR3: a command at a position is refused');
    const replay = drive([], JSON.parse(JSON.stringify(def)));
    assert.equal(replay.h, live.h, 'CR3: the scenario with the commands gives the run in which they were given live');
    assert.deepEqual(replay.sim.dispatched, live.sim.dispatched, 'CR3: the same commands recorded at the same times');
    assert.ok(replay.sim.scenarioEvents.filter(e => e.def.type === 'dispatch').every(e => e.phase === 'done'), 'CR3: every command given');
    console.log(`CR3 dispatcher commands as scenario events: ${live.sim.dispatched.length} commands, the same run (${replay.h}): ok`);
  }
}
console.log('verify-control-room: all ok');
