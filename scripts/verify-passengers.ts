/**
 * Checks of the passengers (phase 6, docs/PASSENGERS.md):
 *   PAX1 conservation: arrived = boarded + waiting, boarded = alighted + on board, for the run and for every train,
 *        with continuous and with Poisson arrivals (whole people)
 *   PAX2 dwell in closed form: fixed time + max(boarding, alighting) / doorways × time per person, slower when people
 *        stand; in a run the doors close when the passengers have finished
 *   PAX3 capacity: never more on board than seats and standing places; who cannot board waits for the next train
 *   PAX4 mass on board: the time to accelerate grows with the equivalent mass, the stopping distance under the
 *        load-weighed service brake does not change
 *   PAX5 determinism: the same seed gives the same run, another seed another one; with no demand the run is the one
 *        without passengers
 *   PAX6 external dynamics: examples/dynamics_point.js with payload_kg reproduces the internal point model with passengers
 *   PAX7 open data: SIRI-ET RecordedDepartureOccupancy and GTFS-Realtime occupancy from the counts of the run
 *   PAX8 the controlled train keeps its doors open until its passengers have boarded
 *   PAX9 control room snapshot: people waiting at every station and on board of every train, without changing the run
 *   PAX10 passengers who change train: on the Rocca Sabato branch the change at San Felice Scalo; when the connection
 *        is lost they wait for the next train, and the lost connection costs passenger-minutes
 *   npx tsx scripts/verify-passengers.ts
 */
// @test PAX1: conservation of the passengers [YT-PAX]
// @test PAX2: dwell from boarding and alighting in closed form [YT-PAX]
// @test PAX3: capacity of the trains and passengers left behind [YT-PAX]
// @test PAX4: mass of the passengers on acceleration and braking [YT-PAX]
// @test PAX5: determinism with the seed, no change without demand [YT-PAX]
// @test PAX6: external dynamics with the mass of the passengers [YT-PAX]
// @test PAX7: occupancy in SIRI-ET and GTFS-Realtime [YT-PAX]
// @test PAX8: the controlled train waits for its passengers [YT-PAX]
// @test PAX9: passengers in the control room snapshot [YT-PAX]
// @test PAX10: passengers changing train and the cost of a lost connection [YT-PAX]
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import {
  DEFAULT_SCENARIO, FIXED_DT, LINE_PRESETS, PassengerModel, Simulation, TRAIN_PRESETS, capacityOf, clone, resolveScenario, runLockstep,
  scenarioFromConfig, validateScenario, type DynamicsProvider, type LineDef, type PassengerDef, type ScenarioDef, type TrainParams,
} from '../src/core';
import { DEFAULT_FEED_OPTIONS as O, encodeFeed, gtfsRealtime, siriEstimatedTimetable } from '../src/feeds';
import { loadJsController, loadJsDynamics, loadScenarios } from '../src/server/headless';
import { builtInDriver } from './lib/drive';

const VL = ['Valle Lauro', 'Ponte Sabato', 'San Felice Scalo', 'Monte Clanio'];
const demand = (k = 1): PassengerDef['demand'] => [
  { from: 'Valle Lauro', to: 'Monte Clanio', per_hour: 600 * k }, { from: 'Valle Lauro', to: 'San Felice Scalo', per_hour: 300 * k },
  { from: 'Ponte Sabato', to: 'Monte Clanio', per_hour: 400 * k }, { from: 'Monte Clanio', to: 'Valle Lauro', per_hour: 500 * k },
  { from: 'San Felice Scalo', to: 'Ponte Sabato', per_hour: 200 * k },
];
const withPax = (p: PassengerDef | undefined, count = 3, sig: 'ETCS' | 'BACC' = 'ETCS'): ScenarioDef => {
  const s = scenarioFromConfig({ line: 'valle-lauro', signalling: sig, trains: { count, headway_s: 600, directions: 'both' } });
  return p ? { ...s, passengers: p } : s;
};
async function run(def: ScenarioDef, opt: { train?: TrainParams; dyn?: DynamicsProvider } = {}): Promise<Simulation> {
  assert.deepEqual(validateScenario(def), [], 'valid scenario');
  const r = resolveScenario(def);
  const sim = new Simulation(r.line, opt.train ?? r.train, r.scen, def);
  await runLockstep(sim, loadJsController('examples/ato.js'), { period: 0.2, source: 'ato', dynamics: opt.dyn });
  return sim;
}
const near = (a: number, b: number, tol = 1e-6) => Math.abs(a - b) <= tol;

// PAX1
for (const arrivals of ['uniform', 'poisson'] as const) {
  const sim = await run(withPax({ demand: demand(), arrivals, seed: 3 }));
  const r = sim.passengers()!;
  assert.ok(r.boarded > 500, `PAX1 ${arrivals}: passengers carried (${r.boarded})`);
  assert.ok(near(r.arrived, r.boarded + r.waiting, 0.01), `PAX1 ${arrivals}: arrived ${r.arrived} = boarded ${r.boarded} + waiting ${r.waiting}`);
  assert.ok(near(r.boarded, r.alighted + r.onboard, 0.01), `PAX1 ${arrivals}: boarded = alighted + on board`);
  for (const t of r.trains) assert.ok(near(t.boarded, t.alighted + t.onboard, 0.01), `PAX1 ${arrivals}: train ${t.train_id}`);
  assert.equal(r.carried_past, 0, `PAX1 ${arrivals}: nobody carried past`);
  if (arrivals === 'poisson') for (const s of r.stops) assert.ok(Number.isInteger(s.boarded) && Number.isInteger(s.alighted), 'PAX1: whole people with Poisson arrivals');
  for (const t of sim.trains) assert.ok(sim.summary(t).finished && sim.summary(t).overruns === 0, `PAX1 ${arrivals}: ${t.id} arrives`);
  console.log(`PAX1 ${arrivals}: ${r.arrived.toFixed(1)} arrived = ${r.boarded.toFixed(1)} boarded + ${r.waiting.toFixed(1)} waiting; ${r.alighted.toFixed(1)} alighted, ${r.passenger_km.toFixed(0)} passenger-km, mean wait ${r.mean_wait_s} s`);
}

// PAX2
{
  const TR: TrainParams = { ...clone(TRAIN_PRESETS.regional), seats: 100, standing: 50, doors: 4 };
  const m = new PassengerModel({ demand: [{ from: 'A', to: 'B', per_hour: 3600 }, { from: 'B', to: 'C', per_hour: 3600 }] });
  const a = m.open('x', TR, 'A', 0, [{ name: 'B', s: 1000, arr: 200 }, { name: 'C', s: 2000, arr: 400 }], null, 100);
  assert.ok(near(a.boarded, 100) && near(a.dwell_s, 12 + 100 / 4 * 1.5), `PAX2: 100 boarding through 4 doorways take 12 + 25 × 1.5 s (${a.dwell_s})`);
  m.close('x', TR, 'A', 0, [{ name: 'B', s: 1000, arr: 200 }, { name: 'C', s: 2000, arr: 400 }], 100);
  // at B 100 alight and 150 would board (150 s of flow): all fit (150 places), 150 on board: half the standing places used
  const b = m.open('x', TR, 'B', 1000, [{ name: 'C', s: 2000, arr: 400 }], 200, 250);
  assert.ok(near(b.alighted, 100) && near(b.boarded, 150), 'PAX2: alighting and boarding at B');
  const share = (150 - 100) / 50;
  assert.ok(near(b.dwell_s, 12 + 150 / 4 * 1.5 * (1 + 0.6 * share)), `PAX2: standing passengers slow the flow (${b.dwell_s})`);
  // in a run: every stop whose passengers need more than the timetable and the minimum dwell ends with them
  const sim = await run(withPax({ demand: [{ from: 'Ponte Sabato', to: 'Monte Clanio', per_hour: 2400 }, { from: 'San Felice Scalo', to: 'Valle Lauro', per_hour: 2400 }] }));
  const r = sim.passengers()!, tt = sim.timetable();
  let binding = 0;
  for (const s of r.stops) {
    if (s.dwell_s === 0) continue;
    const t = tt.find(x => x.id === s.train_id)!, st = t.stops.find(x => x.station === s.station && x.arrival_s != null && Math.abs((x.arrival_s ?? 0) - s.t) < 0.06);
    if (!st || st.departure_s == null || st.arrival_s == null) continue;
    assert.ok(st.departure_s >= st.arrival_s + s.dwell_s - 0.06, `PAX2: ${s.train_id} at ${s.station} leaves after its passengers`);
    const planned = st.planned_departure_s ?? -Infinity;
    if (s.dwell_s > 20 && st.arrival_s + s.dwell_s > planned + 0.1) { assert.ok(st.departure_s - st.arrival_s - s.dwell_s < 2, `PAX2: ${s.train_id} at ${s.station} leaves when its passengers have finished (the departure is taken when the train moves, as at a timetabled departure)`); binding++; }
  }
  assert.ok(binding >= 2, `PAX2: stops held by the passengers (${binding})`);
  console.log(`PAX2 dwell: 12 + 25 × 1.5 = ${a.dwell_s} s, with half the standing places taken ${b.dwell_s.toFixed(1)} s; ${binding} stops of the run held by their passengers`);
}

// PAX3
{
  const small: TrainParams = { ...clone(TRAIN_PRESETS.regional), seats: 80, standing: 40 };
  const def = withPax({ demand: [{ from: 'Valle Lauro', to: 'Monte Clanio', per_hour: 1500 }, { from: 'Ponte Sabato', to: 'San Felice Scalo', per_hour: 600 }] }, 4);
  for (const sv of def.services!) sv.train = small;
  const sim = await run(def, { train: small });
  const r = sim.passengers()!;
  for (const t of r.trains) assert.ok(t.max_onboard <= 120 + 1e-6, `PAX3: ${t.train_id} carries at most 120 (${t.max_onboard})`);
  assert.ok(r.left_behind > 100, `PAX3: passengers left behind (${r.left_behind})`);
  const vl = r.stops.filter(s => s.station === 'Valle Lauro');
  assert.ok(vl.filter(s => s.train_id !== 'train' && s.boarded > 0).every(s => s.onboard >= 120 - 1e-6), 'PAX3: every service leaving Valle Lauro is full');
  // the passengers of Ponte Sabato for San Felice Scalo find no room on full trains
  assert.ok(near(r.arrived, r.boarded + r.waiting, 0.01), 'PAX3: conservation');
  console.log(`PAX3 capacity 120: trains full from Valle Lauro, ${r.left_behind.toFixed(0)} passenger-departures left behind, ${r.waiting.toFixed(0)} still waiting`);
}

// PAX4
{
  const flat: LineDef = clone(LINE_PRESETS['valle-lauro']);
  flat.profile = [[0, 100], [100000, 100]];
  flat.freight = { ...flat.freight, on: false };
  const point: TrainParams = { ...clone(TRAIN_PRESETS.regional), model: 'point' };
  const kmh = (sim: Simulation) => sim.S.v * 3.6;
  async function drive(p: PassengerDef | undefined) {
    const def: ScenarioDef = { name: 'mass', line: flat, train: point, signalling: 'BACC', leader: { on: false }, ...(p ? { passengers: p } : {}) };
    const r = resolveScenario(def);
    const sim = new Simulation(r.line, point, r.scen, def);
    // held until 600 s, then full traction to 40 km/h (timed from 20 km/h, at full force, past the ramp of the force
    // and the release of the brake, which do not depend on the mass), then full service brake to standstill
    let tStart = 0, tAcc = 0, sBrake = 0, phase = 0;
    while (sim.time < 2000 && phase < 3) {
      if (phase === 0) { sim.applyCommand({ traction: 0, brake: 1 }); if (sim.time >= 600) { sim.applyCommand({ traction: 1, brake: 0 }); phase = 1; } }
      else if (phase === 1 && !tStart && kmh(sim) >= 20) tStart = sim.time;
      else if (phase === 1 && kmh(sim) >= 40) { tAcc = sim.time - tStart; sBrake = sim.S.s; sim.applyCommand({ traction: 0, brake: 1 }); phase = 2; }
      else if (phase === 2 && sim.S.v === 0) { sBrake = sim.S.s - sBrake; phase = 3; }
      sim.step(FIXED_DT);
    }
    assert.equal(phase, 3, 'PAX4: the test drive was completed');
    return { tAcc, sBrake, pay: sim.trains[0].payload, ME: sim.trains[0].ME };
  }
  const empty = await drive(undefined);
  const full = await drive({ demand: [{ from: 'Valle Lauro', to: 'Monte Clanio', per_hour: 3000 }] });
  // 3000 an hour for the 600 s the train is held, plus those arriving until it moves
  assert.ok(full.pay >= 500 * 75 && full.pay < 505 * 75, `PAX4: about 500 passengers of 75 kg on board (${full.pay} kg)`);
  const ratio = full.ME / empty.ME;
  assert.ok(Math.abs(full.tAcc / empty.tAcc - ratio) / ratio < 0.02, `PAX4: time from 20 to 40 km/h × ${(full.tAcc / empty.tAcc).toFixed(3)} against the mass ratio ${ratio.toFixed(3)}`);
  // within 2 %: while the brake builds up the traction force decays, and accelerates the empty train a little more
  assert.ok(Math.abs(full.sBrake - empty.sBrake) / empty.sBrake < 0.02, `PAX4: stopping distance ${full.sBrake.toFixed(1)} m loaded, ${empty.sBrake.toFixed(1)} m empty`);
  const v = 40 / 3.6, theory = v * v / (2 * TRAIN_PRESETS.regional.bSvc);
  assert.ok(full.sBrake > theory && full.sBrake < theory + v * 3, `PAX4: stopping distance ${full.sBrake.toFixed(1)} m against ${theory.toFixed(1)} m plus the brake build-up`);
  console.log(`PAX4 mass: +${(full.pay / 1000).toFixed(1)} t, time from 20 to 40 km/h ${empty.tAcc.toFixed(2)} → ${full.tAcc.toFixed(2)} s (mass ratio ${ratio.toFixed(3)}), stopping distance ${empty.sBrake.toFixed(1)} → ${full.sBrake.toFixed(1)} m (theory ${theory.toFixed(1)} m + build-up)`);
}

// PAX5
{
  const ato = loadJsController('examples/ato.js');
  const h = (sim: Simulation) => createHash('sha256').update(sim.trains.map(t => sim.csv(t)).join('\n') + JSON.stringify(sim.passengers())).digest('hex').slice(0, 16);
  const a = h(await run(withPax({ demand: demand(), arrivals: 'poisson', seed: 11 })));
  const b = h(await run(withPax({ demand: demand(), arrivals: 'poisson', seed: 11 })));
  const c = h(await run(withPax({ demand: demand(), arrivals: 'poisson', seed: 12 })));
  assert.equal(a, b, 'PAX5: same seed, same run');
  // reading the passengers during the run, as the page does, does not draw arrivals nor change the run
  {
    const def = withPax({ demand: demand(), arrivals: 'poisson', seed: 11 });
    const r = resolveScenario(def), sim = new Simulation(r.line, r.train, r.scen, def);
    let nextRead = 0;
    await runLockstep(sim, o => { if (sim.time >= nextRead) { sim.passengers(); sim.pax!.waitingAt('Ponte Sabato', sim.time); nextRead += 7; } return ato(o); }, { period: 0.2, source: 'ato' });
    assert.equal(h(sim), a, 'PAX5: reading the passengers during the run leaves it unchanged');
  }
  assert.notEqual(a, c, 'PAX5: another seed, another run');
  const csv = (sim: Simulation) => createHash('sha256').update(sim.trains.map(t => sim.csv(t)).join('\n')).digest('hex').slice(0, 16);
  const none = csv(await run(withPax(undefined)));
  const zero = csv(await run(withPax({ demand: [{ from: 'Valle Lauro', to: 'Monte Clanio', per_hour: 0 }] })));
  assert.equal(zero, none, 'PAX5: without demand the run is the one without passengers');
  console.log(`PAX5 determinism: seed 11 twice ${a}, seed 12 ${c}; no demand = no passengers (${none})`);
}

// PAX6
{
  const p: PassengerDef = { demand: [{ from: 'Ponte Sabato', to: 'Monte Clanio', per_hour: 2400 }, { from: 'Ponte Sabato', to: 'San Felice Scalo', per_hour: 1200 }] };
  const tr = (model: 'point' | 'external'): TrainParams => ({ ...clone(TRAIN_PRESETS.regional), model, ...(model === 'external' ? { external: { period_s: FIXED_DT } } : {}) });
  const def: ScenarioDef = { ...withPax(p, 0), train: undefined };
  const ref = await run(def, { train: tr('point') });
  const ext = await run(def, { train: tr('external'), dyn: loadJsDynamics('examples/dynamics_point.js') });
  const a = ref.passengers()!, b = ext.passengers()!;
  assert.ok(a.trains[0].max_onboard > 150, `PAX6: the controlled train carries passengers (${a.trains[0].max_onboard})`);
  assert.ok(Math.abs(ref.result().t_s - ext.result().t_s) < 0.05, `PAX6: arrival ${ext.result().t_s} against ${ref.result().t_s}`);
  assert.ok(Math.abs(ref.result().net_energy_kWh - ext.result().net_energy_kWh) < 0.05, 'PAX6: energy');
  assert.ok(near(a.boarded, b.boarded, 0.01), 'PAX6: the same passengers');
  console.log(`PAX6 external dynamics with ${a.trains[0].max_onboard.toFixed(0)} passengers on board: arrival ${ext.result().t_s.toFixed(2)} s against ${ref.result().t_s.toFixed(2)} s`);
}

// PAX7
{
  const def = withPax({ demand: demand(), arrivals: 'poisson', seed: 5 });
  const r = resolveScenario(def);
  const sim = new Simulation(r.line, r.train, r.scen, def);
  const drive = builtInDriver();
  while (sim.time < 1300) {
    drive(sim);
    sim.step(FIXED_DT); sim.sample();
  }
  const et = siriEstimatedTimetable(sim, O);
  const occ = [...et.matchAll(/<RecordedDepartureOccupancy><OccupancyLevel>(\w+)<\/OccupancyLevel><OccupancyPercentage>([\d.]+)<\/OccupancyPercentage><AlightingCount>(\d+)<\/AlightingCount><BoardingCount>(\d+)<\/BoardingCount><OnboardCount>(\d+)<\/OnboardCount><\/RecordedDepartureOccupancy>/g)];
  assert.ok(occ.length >= 5, `PAX7: occupancy of the departures made (${occ.length})`);
  const log = sim.passengers()!.stops.filter(s => s.boarded > 0);
  assert.ok(log.every(s => occ.some(m => +m[4] === Math.round(s.boarded) && +m[5] === Math.round(s.onboard))), 'PAX7: counts of the run in SIRI-ET');
  const RT = GtfsRealtimeBindings.transit_realtime;
  const d = RT.FeedMessage.toObject(RT.FeedMessage.decode(encodeFeed(gtfsRealtime(sim, O, 'vehicles'))), { enums: String });
  const withOcc = d.entity.filter((e: { vehicle?: { occupancyStatus?: string } }) => e.vehicle?.occupancyStatus);
  assert.ok(withOcc.length >= 2, 'PAX7: GTFS-Realtime occupancy of the trains running');
  for (const e of withOcc) {
    const t = sim.trains.find(x => e.id.endsWith(x.id.toLowerCase().replace(/[^a-z0-9]+/g, '-')))!;
    const cap = capacityOf(t.TR), n = sim.pax!.onboard(t.id);
    assert.equal(e.vehicle.occupancyPercentage, Math.round(n / cap.seats * 100), `PAX7: occupancy percentage of ${t.id}`);
  }
  console.log(`PAX7 open data: ${occ.length} SIRI-ET departures with counts, ${withOcc.length} GTFS-Realtime vehicles with occupancy`);
}

// PAX8
{
  const def = withPax({ demand: [{ from: 'Ponte Sabato', to: 'Monte Clanio', per_hour: 7200 }] }, 0, 'BACC');
  const sim = await run(def);
  const r = sim.passengers()!, ps = r.stops.find(s => s.train_id === 'train' && s.station === 'Ponte Sabato')!;
  const tt = sim.timetable().find(x => x.id === 'train')!.stops.find(x => x.station === 'Ponte Sabato')!;
  assert.ok(ps.boarded > 200, `PAX8: ${ps.boarded} board the controlled train at Ponte Sabato`);
  assert.ok(ps.dwell_s > (tt.planned_departure_s! - tt.arrival_s!) && tt.departure_s! - tt.arrival_s! >= ps.dwell_s - 0.06, `PAX8: doors open ${(tt.departure_s! - tt.arrival_s!).toFixed(1)} s for a dwell of ${ps.dwell_s} s`);
  console.log(`PAX8 controlled train: ${ps.boarded.toFixed(0)} boarding at Ponte Sabato hold it ${(tt.departure_s! - tt.arrival_s!).toFixed(1)} s (passenger dwell ${ps.dwell_s} s)`);
}
// PAX9
{
  const def = withPax({ demand: demand(), arrivals: 'poisson', seed: 9 });
  const r = resolveScenario(def), sim = new Simulation(r.line, r.train, r.scen, def);
  const drive = builtInDriver();
  let snaps = 0;
  while (!sim.done && sim.time < 2600) {
    drive(sim);
    sim.step(FIXED_DT); sim.sample();
    if (Math.abs(sim.time % 60) < FIXED_DT / 2) {
      const c = sim.controlRoom(), st = c.network.lines[0].stations;
      for (const x of st) assert.ok(Math.abs((x.waiting ?? NaN) - Math.round(sim.pax!.waitingAt(x.name, sim.time) * 10) / 10) < 1e-9, `PAX9: waiting at ${x.name}`);
      for (const t of c.trains) {
        assert.ok(t.passengers && Math.abs(t.passengers.onboard - Math.round(sim.pax!.onboard(t.id) * 10) / 10) < 1e-9, `PAX9: on board of ${t.id}`);
        assert.equal(t.passengers!.seats, capacityOf(sim.trains.find(x => x.id === t.id)!.TR).seats, 'PAX9: seats');
      }
      snaps++;
    }
  }
  const ref = await run(def);
  assert.equal(JSON.stringify(sim.passengers()), JSON.stringify(ref.passengers()), 'PAX9: taking snapshots leaves the run unchanged');
  assert.equal(new Simulation(r.line, r.train, r.scen, withPax(undefined)).controlRoom().trains[0].passengers, undefined, 'PAX9: no passenger fields without passengers');
  console.log(`PAX9 control room: ${snaps} snapshots with the people waiting and on board, run unchanged`);
}
// PAX10
{
  const [{ def: shuttle }] = loadScenarios('scenarios/services/branch-shuttle.json');
  const pax: PassengerDef = { transfer_s: 60, demand: [
    { from: 'Valle Lauro', to: 'Rocca Sabato', via: 'San Felice Scalo', per_hour: 600 },
    { from: 'Ponte Sabato', to: 'Pietrarsa', via: 'San Felice Scalo', per_hour: 1200 },
    { from: 'San Felice Scalo', to: 'Rocca Sabato', per_hour: 200, end_s: 2400 },
  ] };
  const kept = await run({ ...shuttle, passengers: pax });
  // the same, with a restriction to 15 km/h between Ponte Sabato and San Felice Scalo: the controlled train arrives
  // later than the longest wait of S 4101, which leaves, and those changing wait for S 4103
  const lost = await run({ ...shuttle, passengers: pax, events: [...(shuttle.events ?? []), { type: 'speed_restriction', from_m: 5400, to_m: 7400, v_kmh: 15, when: { t: 0 } }] });
  const outcome = (sim: Simulation) => sim.connections.map(c => c.outcome).join();
  assert.equal(outcome(kept), 'kept', 'PAX10: connection kept');
  assert.equal(outcome(lost), 'lost', 'PAX10: connection lost with the restriction');
  const a = kept.passengers()!, b = lost.passengers()!;
  for (const r of [a, b]) {
    assert.ok(near(r.arrived + r.transfers, r.boarded + r.waiting, 0.01), 'PAX10: arrived + changes = boarded + waiting');
    assert.ok(near(r.boarded, r.alighted + r.onboard, 0.01), 'PAX10: boarded = alighted + on board');
    assert.ok(near(r.alighted, r.journeys + r.transfers + r.carried_past, 0.01), 'PAX10: every alighting ends a journey or is a change');
  }
  const ta = a.transfer_stations.find(x => x.station === 'San Felice Scalo')!, tb = b.transfer_stations.find(x => x.station === 'San Felice Scalo')!;
  assert.ok(ta.transfers > 30 && near(ta.boarded, ta.transfers, 0.01), `PAX10: every one changing at San Felice Scalo takes S 4101 (${ta.boarded} of ${ta.transfers})`);
  assert.ok(a.mean_transfer_wait_s >= 60 && a.mean_transfer_wait_s < 400, `PAX10: change in ${a.mean_transfer_wait_s} s, walking 60 s included`);
  assert.ok(tb.mean_wait_s > 600 && b.transfer_passenger_min > 4 * a.transfer_passenger_min, `PAX10: lost connection: change in ${tb.mean_wait_s} s, ${b.transfer_passenger_min} passenger-minutes against ${a.transfer_passenger_min}`);
  assert.ok(b.mean_journey_s > a.mean_journey_s + 600, `PAX10: longer journeys (${a.mean_journey_s} → ${b.mean_journey_s} s)`);
  console.log(`PAX10 change at San Felice Scalo: ${ta.transfers.toFixed(0)} passengers, connection kept ${a.mean_transfer_wait_s} s each (${a.transfer_passenger_min} passenger-min), lost ${tb.mean_wait_s} s each (${b.transfer_passenger_min} passenger-min); journey ${a.mean_journey_s} → ${b.mean_journey_s} s`);
}
console.log('passengers: ok');
