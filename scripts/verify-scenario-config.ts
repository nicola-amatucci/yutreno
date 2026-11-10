/**
 * Checks of the scenario configuration (docs/SCENARIO_CONFIG.md): a short JSON with the line and the number of
 * trains that becomes a complete scenario.
 *   SCF1 services generated from the line timetable, in one or both directions, with their numbers and times
 *   SCF2 errors of a configuration
 *   SCF3 services from a real timetable extract: station names of the timetable matched to those of the line
 *   SCF4 the configuration runs: headless loads it as a scenario and every train arrives
 *   SCF5 the service campaign: a sweep of trains and demand with its measures, deterministic
 *   npx tsx scripts/verify-scenario-config.ts
 */
// @test SCF1: services generated from the line timetable [YT-SCENCFG]
// @test SCF2: errors of a scenario configuration [YT-SCENCFG]
// @test SCF3: services from a real timetable extract [YT-SCENCFG]
// @test SCF4: a scenario configuration runs with the example controller [YT-SCENCFG]
// @test SCF5: service campaign over trains and passenger demand [YT-SCENCFG]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LINE_PRESETS, Simulation, resolveScenario, runLockstep, sameStation, scenarioFromConfig, validateScenario, validateScenarioConfig, type LineDef, type TimetableExtract } from '../src/core';
import { loadJsController, loadScenarios } from '../src/server/headless';
import { loadConfig } from '../src/server/make-scenario';
import { runService, specsOf, toCsv } from './service-campaign';

// SCF1
const vl = LINE_PRESETS['valle-lauro'];
const fw = scenarioFromConfig({ line: 'valle-lauro', trains: { count: 3, headway_s: 600 } });
assert.equal(validateScenario(fw).length, 0, 'SCF1: valid scenario');
assert.deepEqual(fw.services!.map(s => s.id), ['R 101', 'R 103', 'R 105'], 'SCF1: odd numbers forward');
assert.deepEqual(fw.services!.map(s => s.stops[0].departure_s), [600, 1200, 1800], 'SCF1: first departure after the controlled train, then every headway');
const s0 = fw.services![0].stops, st = vl.stations;
assert.deepEqual(s0.map(x => x.station), st.map(x => x.name), 'SCF1: every station of the line');
for (let i = 1; i < st.length; i++) assert.equal((s0[i].arrival_s as number) - (s0[i - 1].departure_s as number), (st[i].arr as number) - (st[i - 1].dep as number), 'SCF1: running times of the line');
const both = scenarioFromConfig({ line: 'valle-lauro', trains: { count: 4, headway_s: 900, directions: 'both', dwell_s: 45 } });
assert.deepEqual(both.services!.map(s => s.id), ['R 101', 'R 102', 'R 103', 'R 104'], 'SCF1: alternating directions');
assert.deepEqual(both.services!.map(s => s.stops[0].departure_s), [900, 1350, 1800, 2250], 'SCF1: backward trains half a headway later');
const b0 = both.services![1].stops;
assert.deepEqual(b0.map(x => x.station), [...st].reverse().map(x => x.name), 'SCF1: backward from the last station');
assert.ok(b0.slice(1, -1).every(x => (x.departure_s as number) - (x.arrival_s as number) === 45), 'SCF1: dwell of the configuration');
console.log(`SCF1 generated services: ${fw.services!.length} forward every 600 s, ${both.services!.length} in both directions`);

// SCF2
assert.ok(validateScenarioConfig({ line: 'nowhere', trains: { count: 2 } }).some(e => e.includes('unknown line')), 'SCF2: unknown line');
assert.ok(validateScenarioConfig({ line: 'valle-lauro', trains: { count: -1 } }).some(e => e.includes('count')), 'SCF2: negative count');
assert.ok(validateScenarioConfig({ line: 'valle-lauro', trains: { count: 1, directions: 'up' as 'forward' } }).some(e => e.includes('directions')), 'SCF2: direction');
assert.ok(validateScenarioConfig({ line: 'valle-lauro', from: '7h', trains: { count: 1 } }).some(e => e.includes('from')), 'SCF2: time of day');
assert.throws(() => scenarioFromConfig({ line: 'valle-lauro', train: 'tram', trains: { count: 1 } }), /unknown train/, 'SCF2: unknown train');
console.log('SCF2 errors of a configuration reported');

// SCF3
assert.ok(sameStation('MERCATO S.SEVERINO', 'Mercato San Severino') && sameStation('FRATTE VILLA COMUNALE', 'Fratte-Villa Comunale'), 'SCF3: abbreviations and punctuation');
assert.ok(!sameStation('SALERNO', 'Salerno Irno') && !sameStation('FRATTE', 'Fratte-Villa Comunale'), 'SCF3: different stations');
const SM = 'examples/infra/salerno-mercato-s-severino/';
const line: LineDef = JSON.parse(readFileSync(SM + 'line.json', 'utf8'));
const tt: TimetableExtract = JSON.parse(readFileSync(SM + 'timetable.json', 'utf8'));
const real = scenarioFromConfig({ line, timetable: tt, from: '09:00', offset_s: 120, trains: { count: 3 } });
assert.equal(validateScenario(real).length, 0, 'SCF3: valid scenario');
assert.deepEqual(real.services!.map(s => s.id), ['5012', '5002', '5005'], 'SCF3: the first trips from 09:00');
// 5012 leaves SALERNO at 09:09, 120 s into the run; 5002 at 09:35; 5005 leaves MERCATO S.SEVERINO at 09:59
assert.deepEqual(real.services!.map(s => s.stops[0].departure_s), [120, 120 + 26 * 60, 120 + 50 * 60], 'SCF3: times of the timetable from the offset');
assert.equal(real.services![2].stops[0].station, 'Mercato San Severino', 'SCF3: station names of the line');
assert.ok(real.services!.every(s => s.stops.every(x => line.stations.some(y => y.name === x.station))), 'SCF3: every stop on the line');
console.log(`SCF3 real timetable: trips ${real.services!.map(s => s.id).join(', ')} from 09:00, names matched to the line`);

// SCF4
const loaded = loadScenarios('examples/scenario-config/valle-lauro-4.json')[0].def;
assert.equal(JSON.stringify(loaded), JSON.stringify(scenarioFromConfig(loadConfig('examples/scenario-config/valle-lauro-4.json'))), 'SCF4: headless reads a configuration as its scenario');
const def = scenarioFromConfig({ line: 'valle-lauro', signalling: 'ETCS', trains: { count: 2, headway_s: 900, directions: 'both' } });
const { line: L, train, scen } = resolveScenario(def);
const sim = new Simulation(L, train, scen, def);
await runLockstep(sim, loadJsController('examples/ato.js'), { period: 0.2, source: 'ato', maxTime: 4000 });
assert.equal(sim.trains.length, 3, 'SCF4: the controlled train and two services');
for (const r of sim.trains) { const s = sim.summary(r); assert.ok(s.finished && s.overruns === 0, `SCF4: ${r.id} arrives`); }
console.log(`SCF4 run: the controlled train and ${sim.trains.length - 1} services arrive, in both directions`);
// SCF5
{
  const specs = specsOf({ name: 't', lines: ['valle-lauro'], trains: [1], headways_s: [900], directions: ['both'], signalling: ['ETCS'], demand_per_station_per_hour: [0, 900] }, process.cwd() + '/campaigns');
  assert.equal(specs.length, 2, 'SCF5: one run per combination');
  const [none, pax] = [await runService(specs[0]), await runService(specs[1])];
  assert.ok(none.trains_arrived === 2 && pax.trains_arrived === 2 && none.overruns === 0, 'SCF5: every train arrives');
  assert.ok(none.passengers === '' && +pax.passengers > 0 && +pax.passenger_km > 0 && pax.energy_Wh_per_pkm !== '', 'SCF5: passenger measures only with demand');
  assert.ok(+pax.net_energy_kWh > +none.net_energy_kWh, 'SCF5: the passengers on board take energy');
  assert.equal((await runService(specs[1])).hash_output, pax.hash_output, 'SCF5: deterministic');
  const csv = toCsv([none, pax]);
  assert.ok(csv.startsWith('line,trains,headway_s,directions,signalling,demand_per_station_h,') && csv.trim().split('\n').length === 3, 'SCF5: runs.csv');
  console.log(`SCF5 service campaign: ${pax.passengers} passengers, ${pax.energy_Wh_per_pkm} Wh per passenger-km, energy ${none.net_energy_kWh} → ${pax.net_energy_kWh} kWh, deterministic`);
}
console.log('scenario configuration: ok');
