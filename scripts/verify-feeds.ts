/**
 * Checks of the open data feeds (GTFS, GTFS-Realtime, SIRI, NeTEx Italian profile): structure, referential
 * integrity, agreement between the formats and with the simulation, calendar and time zone, determinism.
 * The protobuf of GTFS-Realtime is decoded with the official bindings (gtfs-realtime-bindings). Validation against
 * the official schemas and validators is in scripts/feeds-validate.ts (needs Java and xmllint).
 *   npx tsx scripts/verify-feeds.ts
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { inflateRawSync } from 'node:zlib';
import { DEFAULT_FEED_OPTIONS as O, ServiceCalendar, encodeFeed, gtfsFiles, gtfsRealtime, netexTimetable, parseXml, siriEstimatedTimetable, siriVehicleMonitoring, trips, tripState, wgs84, zip } from '../src/feeds';
import { FeedRun, feedFiles } from '../src/server/feeds-server';
import { loadScenarios } from '../src/server/headless';
import { Simulation, autoDriver, resolveScenario, runLockstep, type ScenarioDef } from '../src/core';
import { EXAMPLE_DIR, exampleFiles } from './feeds-examples';

const { transit_realtime: RT } = createRequire(import.meta.url)('gtfs-realtime-bindings');
const def = loadScenarios('scenarios/services/crossing.json')[0].def;

/** Reads a CSV of the GTFS feed into objects */
function table(text: string): Record<string, string>[] {
  const [head, ...rows] = text.trim().split('\r\n').map(l => l.split(','));
  return rows.map(r => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}
/** Entries of a ZIP archive (stored or deflated), checking signatures and sizes */
function unzip(b: Uint8Array): Record<string, string> {
  const d = new DataView(b.buffer, b.byteOffset, b.byteLength), out: Record<string, string> = {};
  let p = 0;
  while (d.getUint32(p, true) === 0x04034b50) {
    const method = d.getUint16(p + 8, true), size = d.getUint32(p + 18, true), n = d.getUint16(p + 26, true), x = d.getUint16(p + 28, true);
    const name = new TextDecoder().decode(b.subarray(p + 30, p + 30 + n)), data = b.subarray(p + 30 + n + x, p + 30 + n + x + size);
    out[name] = new TextDecoder().decode(method ? inflateRawSync(data) : data);
    p += 30 + n + x + size;
  }
  assert.equal(d.getUint32(p, true), 0x02014b50, 'central directory after the entries');
  return out;
}
const ids = (s: string, re: RegExp) => [...s.matchAll(re)].map(m => m[1]);

// ---- calendar and time zone ----
{
  const winter = new ServiceCalendar(O);
  assert.equal(winter.iso(0), '2026-11-05T08:00:00+01:00', 'CET in November');
  assert.equal(winter.posix(0), Date.UTC(2026, 10, 5, 7) / 1000);
  assert.equal(winter.hms(17 * 3600 + 30), '25:00:30', 'GTFS times beyond 24:00');
  const summer = new ServiceCalendar({ ...O, date: '2026-07-01' });
  assert.equal(summer.iso(0), '2026-07-01T08:00:00+02:00', 'CEST in July');
  // the day of the change to summer time: times count from noon minus 12 h (GTFS), so 08:00:00 is 08:00 CEST
  const dst = new ServiceCalendar({ ...O, date: '2026-03-29' });
  assert.equal(dst.originUtc, Date.UTC(2026, 2, 28, 22));
  assert.equal(dst.iso(0), '2026-03-29T08:00:00+02:00');
  console.log('calendar: CET, CEST, day of the change, times after midnight');
}

// ---- a run in progress: both trains running, the controlled one has made two stops ----
const run = new FeedRun(def);
run.advance(500);
const sim = run.sim, T = trips(sim);
assert.equal(T.length, 2);
assert.ok(T.every(t => tripState(sim, t).active), 'both trains running at t = 500 s');

// ---- GTFS ----
{
  const files = unzip(zip(gtfsFiles(sim, O)));
  for (const f of ['agency.txt', 'stops.txt', 'routes.txt', 'trips.txt', 'stop_times.txt', 'calendar_dates.txt', 'shapes.txt', 'feed_info.txt']) assert.ok(files[f], f);
  const stops = table(files['stops.txt']), tr = table(files['trips.txt']), st = table(files['stop_times.txt']), sh = table(files['shapes.txt']);
  const stopIds = new Set(stops.map(s => s.stop_id));
  assert.equal(stops.filter(s => s.location_type === '1').length, sim.L.st.length, 'one station per stop place');
  assert.ok(stops.filter(s => s.location_type === '0').every(s => stopIds.has(s.parent_station)), 'platforms belong to a station');
  assert.equal(tr.length, T.length);
  assert.equal(st.length, T.reduce((n, t) => n + t.stops.length, 0));
  assert.ok(st.every(r => stopIds.has(r.stop_id) && tr.some(t => t.trip_id === r.trip_id)), 'stop_times refer to existing stops and trips');
  for (const t of tr) {
    const rows = st.filter(r => r.trip_id === t.trip_id), sec = (h: string) => h.split(':').reduce((a, v) => a * 60 + +v, 0);
    for (let i = 1; i < rows.length; i++) {
      assert.ok(sec(rows[i].arrival_time) >= sec(rows[i - 1].departure_time), 'times do not decrease');
      assert.ok(+rows[i].shape_dist_traveled > +rows[i - 1].shape_dist_traveled, 'distances increase');
    }
    const shape = sh.filter(r => r.shape_id === t.shape_id);
    assert.ok(+shape[shape.length - 1].shape_dist_traveled + 1 >= +rows[rows.length - 1].shape_dist_traveled, 'the shape covers the trip');
  }
  // station coordinates are those of the line, and the two directions use platforms 1 and 2
  const vl = stops.find(s => s.stop_id.endsWith(':StopPlace:yutreno:valle-lauro'))!;
  assert.deepEqual([+vl.stop_lat, +vl.stop_lon], Object.values(wgs84(sim.L, sim.L.st[0].s)));
  assert.deepEqual(new Set(st.filter(r => r.trip_id.endsWith('r-2101')).map(r => r.stop_id.slice(-2))), new Set(['-2']));
  // the GTFS is a function of the timetable, not of the progress of the run
  const end = new FeedRun(def); end.advance(4000);
  assert.ok(end.sim.done, 'the run ends');
  assert.deepEqual(zip(gtfsFiles(end.sim, O)), zip(gtfsFiles(sim, O)), 'same GTFS at any time of the run');
  console.log(`GTFS: ${stops.length} stops, ${tr.length} trips, ${st.length} stop_times, ${sh.length} shape points`);
}

// ---- GTFS-Realtime, decoded with the official bindings ----
{
  const vp = gtfsRealtime(sim, O, 'vehicles'), tu = gtfsRealtime(sim, O, 'trips');
  const dv = RT.FeedMessage.toObject(RT.FeedMessage.decode(encodeFeed(vp)), { enums: String, longs: Number });
  const dt = RT.FeedMessage.toObject(RT.FeedMessage.decode(encodeFeed(tu)), { enums: String, longs: Number });
  const now = new ServiceCalendar(O).posix(sim.time);
  assert.equal(dv.header.gtfsRealtimeVersion, '2.0');
  assert.equal(dv.header.incrementality, 'FULL_DATASET');
  assert.equal(dv.header.timestamp, now);
  assert.equal(dv.entity.length, 2);
  for (const [i, e] of dv.entity.entries()) {
    const src = vp.entity[i].vehicle!, v = e.vehicle;
    assert.equal(v.trip.tripId, src.trip.trip_id);
    assert.equal(v.trip.directionId, src.trip.direction_id);
    assert.equal(v.vehicle.label, src.vehicle.label);
    assert.ok(Math.abs(v.position.latitude - src.position.latitude) < 1e-5 && Math.abs(v.position.longitude - src.position.longitude) < 1e-5, 'float32 position');
    assert.ok(Math.abs(v.position.speed - src.position.speed) < 1e-3);
    assert.equal(v.position.odometer, src.position.odometer, 'double odometer');
    assert.equal(v.currentStatus, src.current_status);
    assert.equal(v.stopId, src.stop_id);
    assert.equal(v.timestamp, now);
  }
  // the position is that of the train on the line
  for (const t of T) {
    const e = vp.entity.find(x => x.vehicle!.trip.trip_id.endsWith(t.number.toLowerCase().replace(' ', '-')))!, st = tripState(sim, t);
    assert.deepEqual([e.vehicle!.position.latitude, e.vehicle!.position.longitude], Object.values(wgs84(sim.L, st.s)));
    assert.ok(Math.abs(e.vehicle!.position.speed - t.run.S.v) < 0.01);
  }
  // trip updates: a time for every stop; actual times where realised, delay = actual − planned
  for (const [i, e] of dt.entity.entries()) {
    const t = T[i], u = e.tripUpdate, cal = new ServiceCalendar(O);
    assert.equal(u.stopTimeUpdate.length, t.stops.length);
    assert.equal(u.stopTimeUpdate[0].arrival, undefined, 'no arrival at the origin');
    assert.equal(u.stopTimeUpdate[t.stops.length - 1].departure, undefined, 'no departure at the destination');
    for (const re of t.run.realised) {
      const k = t.stops.findIndex(p => p.name === re.station), x = u.stopTimeUpdate[k], p = t.stops[k];
      if (re.departure_s != null && p.dep != null) {
        assert.equal(x.departure.time, cal.posix(re.departure_s));
        assert.equal(x.departure.delay, Math.round(re.departure_s - p.dep));
      }
      if (re.arrival_s != null && p.arr != null) assert.equal(x.arrival.time, cal.posix(re.arrival_s));
    }
    // expected times do not go back along the trip
    const times = u.stopTimeUpdate.flatMap((x: { arrival?: { time: number }; departure?: { time: number } }) => [x.arrival?.time, x.departure?.time]).filter((v: number | undefined) => v != null);
    for (let k = 1; k < times.length; k++) assert.ok(times[k] >= times[k - 1], 'times along the trip do not decrease');
  }
  console.log(`GTFS-RT: ${dv.entity.length} vehicle positions, ${dt.entity.length} trip updates decoded`);
}

// ---- SIRI: same journeys and identifiers as NeTEx, recorded and estimated calls ----
const netex = netexTimetable(sim, O);
{
  const vm = siriVehicleMonitoring(sim, O), et = siriEstimatedTimetable(sim, O);
  assert.equal((vm.match(/<VehicleActivity>/g) ?? []).length, 2);
  assert.equal((et.match(/<EstimatedVehicleJourney>/g) ?? []).length, 2);
  assert.match(vm, /<ResponseTimestamp>2026-11-05T08:08:20\+01:00<\/ResponseTimestamp>/);
  const journeys = new Set(ids(netex, /<ServiceJourney id="([^"]+)"/g)), points = new Set(ids(netex, /<ScheduledStopPoint id="([^"]+)"/g));
  for (const x of [vm, et]) {
    assert.ok(ids(x, /<DatedVehicleJourneyRef>([^<]+)</g).every(j => journeys.has(j)), 'SIRI journeys are NeTEx journeys');
    assert.ok(ids(x, /<StopPointRef>([^<]+)</g).every(p => points.has(p)), 'SIRI stop points are NeTEx stop points');
  }
  assert.equal(ids(vm, /<LineRef>([^<]+)</g)[0], ids(netex, /<Line id="([^"]+)"/g)[0]);
  // stops already left are RecordedCalls with actual times; the delay in VM agrees with GTFS-RT
  const made = T.reduce((n, t) => n + t.run.realised.filter(r => r.departure_s != null).length, 0);
  assert.equal((et.match(/<RecordedCall>/g) ?? []).length, made);
  assert.equal((et.match(/<ActualDepartureTime>/g) ?? []).length, made);
  const tu = gtfsRealtime(sim, O, 'trips');
  const delays = ids(vm, /<Delay>(-?PT\d+S)<\/Delay>/g).map(d => (d.startsWith('-') ? -1 : 1) * +d.replace(/\D/g, ''));
  assert.deepEqual(delays, tu.entity.map(e => e.trip_update!.delay));
  // Italian SIRI profile: journey patterns of the NeTEx timetable, vehicle in ET, filters of the dynamic RAP interface
  const patterns = new Set(ids(netex, /<ServiceJourneyPattern id="([^"]+)"/g));
  for (const x of [vm, et]) assert.ok(ids(x, /<JourneyPatternRef>([^<]+)</g).every(p => patterns.has(p)) && /<JourneyPatternRef>/.test(x), 'SIRI journey patterns are NeTEx patterns');
  assert.equal((et.match(/<VehicleRef>/g) ?? []).length, 2);
  const line = ids(vm, /<LineRef>([^<]+)</g)[0];
  assert.equal((siriVehicleMonitoring(sim, O, { LineRef: line }).match(/<VehicleActivity>/g) ?? []).length, 2);
  assert.equal((siriVehicleMonitoring(sim, O, { LineRef: 'IT:X:Line:x:y' }).match(/<VehicleActivity>/g) ?? []).length, 0);
  assert.equal((siriEstimatedTimetable(sim, O, { datasetId: 'other' }).match(/<EstimatedVehicleJourney>/g) ?? []).length, 0);
  assert.equal((siriEstimatedTimetable(sim, O, { maxSize: 1 }).match(/<EstimatedVehicleJourney>/g) ?? []).length, 1);
  const vat = { ...O, operator: { ...O.operator, vat: '01234567890' } };
  assert.match(siriVehicleMonitoring(sim, vat), /<OperatorRef>IT:ITF3:Operator:01234567890:yutreno:yutreno<\/OperatorRef>/, 'operator with VAT number');
  console.log(`SIRI: VM and ET with NeTEx identifiers and journey patterns, ${made} recorded calls, SIRI Lite filters, operator with VAT number`);
}

// ---- NeTEx: every reference resolves inside the delivery ----
{
  const defined = new Set(ids(netex, / id="([^"]+)"/g));
  const refs = ids(netex, / ref="([^"]+)"/g).filter(r => !r.startsWith('epip:'));
  const missing = refs.filter(r => !defined.has(r) && r !== O.codespace);
  assert.deepEqual(missing, [], 'references without an object');
  assert.equal(new Set(ids(netex, / id="([^"]+)"/g)).size, ids(netex, / id="([^"]+)"/g).length, 'unique identifiers');
  assert.ok(ids(netex, / id="([^"]+)"/g).filter(x => x.startsWith('IT:')).every(x => /^IT:ITF3:[A-Za-z]+:yutreno:[^:]+$/.test(x)), 'IT:<region>:<type>:<codespace>:<id>');
  assert.equal((netex.match(/<ServiceJourney /g) ?? []).length, T.length);
  assert.equal((netex.match(/<TimetabledPassingTime /g) ?? []).length, T.reduce((n, t) => n + t.stops.length, 0));
  assert.match(netex, /<DepartureTime>08:00:00<\/DepartureTime>/);
  assert.match(netex, /<TimeZone>Europe\/Rome<\/TimeZone>/);
  console.log(`NeTEx: ${defined.size} objects, ${refs.length} references resolved`);
}

// ---- determinism: the feeds do not change the run, the same run gives the same bytes ----
{
  const a = new FeedRun(def), b = new FeedRun(def);
  a.advance(300); feedFiles(a.sim, O); a.advance(700);
  b.advance(700);
  const fa = feedFiles(a.sim, O), fb = feedFiles(b.sim, O);
  for (const k of Object.keys(fa)) assert.deepEqual(fa[k], fb[k], k);
  assert.equal(a.sim.S.s, b.sim.S.s);
  console.log('determinism: reading the feeds does not change the run, same bytes from the same run');
}
// ---- the examples in the repository are the output of the current code ----
{
  const files = exampleFiles();
  for (const [k, v] of Object.entries(files)) assert.equal(readFileSync(`${EXAMPLE_DIR}/${k}`, 'utf8'), v, `${EXAMPLE_DIR}/${k} is out of date: run npx tsx scripts/feeds-examples.ts`);
  // the indented XML is the same document
  assert.equal(parseXml(files['netex/timetable.xml']).children.length, parseXml(netexTimetable(sim, O)).children.length);
  console.log(`examples: ${Object.keys(files).length} files in ${EXAMPLE_DIR} up to date`);
}
// ---- decisions of the regulator: rescheduled, skipped and cancelled in the real-time feeds ----
// @test FD-REG: rescheduled times, skipped stops and cancelled trips in GTFS-Realtime and SIRI [YT-REG]
{
  const stops = (t: number) => [{ station: 'Valle Lauro', departure_s: t }, { station: 'Ponte Sabato', arrival_s: t + 260, departure_s: t + 290 },
    { station: 'San Felice Scalo', arrival_s: t + 620, departure_s: t + 650 }, { station: 'Monte Clanio', arrival_s: t + 880 }];
  const def: ScenarioDef = { name: 'regulated', line: 'valle-lauro', train: 'regional', signalling: 'ETCS', leader: { on: false }, regulator: 'external',
    services: [{ id: 'R 1', stops: stops(100) }, { id: 'R 3', stops: stops(1200) }] };
  const { line, train, scen } = resolveScenario(def);
  const rs = new Simulation(line, train, scen, def), mem = {};
  await runLockstep(rs, o => autoDriver(o, mem), { period: 0.2, maxTime: 600, regulator: q => ({ commands: q.start ? [
    { type: 'cancel', train: 'R 3' }, { type: 'skip_stop', train: 'R 1', station: 'Ponte Sabato' },
    { type: 'retime', train: 'R 1', station: 'San Felice Scalo', departure_s: 900 }] : [] }) });
  const cal = new ServiceCalendar(O);
  const d = RT.FeedMessage.toObject(RT.FeedMessage.decode(encodeFeed(gtfsRealtime(rs, O, 'trips'))), { enums: String, longs: Number });
  const tu = (id: string) => d.entity.find((e: { id: string }) => e.id === id).tripUpdate;
  assert.equal(tu('tu-r-3').trip.scheduleRelationship, 'CANCELED');
  assert.equal(tu('tu-r-3').stopTimeUpdate?.length ?? 0, 0);
  const r1 = tu('tu-r-1').stopTimeUpdate;
  assert.equal(r1[1].scheduleRelationship, 'SKIPPED');
  assert.ok(!r1[1].arrival && !r1[1].departure, 'a skipped stop has no times');
  assert.equal(r1[2].departure.time, cal.posix(900), 'the expected departure is the rescheduled one');
  assert.equal(r1[2].departure.delay, 900 - 750, 'the delay is measured against the plan');
  const et = siriEstimatedTimetable(rs, O);
  const journey = (n: string) => et.split('<EstimatedVehicleJourney>').find(j => j.includes(`<VehicleJourneyName>${n}</VehicleJourneyName>`)) as string;
  assert.match(journey('R 3'), /<\/FramedVehicleJourneyRef><Cancellation>true<\/Cancellation><JourneyPatternRef>/);
  assert.equal((journey('R 3').match(/<Cancellation>true/g) ?? []).length, 5, 'the journey and its four calls are cancelled');
  assert.match(journey('R 1'), /<StopPointName>Ponte Sabato<\/StopPointName><Cancellation>true<\/Cancellation><AimedArrivalTime>/);
  assert.ok(journey('R 1').includes(`<AimedDepartureTime>${cal.iso(750)}</AimedDepartureTime><ExpectedDepartureTime>${cal.iso(900)}</ExpectedDepartureTime>`), 'aimed from the plan, expected from the new timetable');
  // the static timetable is the plan: decisions of the regulator are real-time information
  assert.equal(table(unzip(zip(gtfsFiles(rs, O)))['stop_times.txt']).filter(r => /r-3/.test(r.trip_id)).length, 4);
  console.log('regulator in the feeds: R 3 CANCELED, Ponte Sabato of R 1 SKIPPED, new departure 900 s with the delay against the plan, SIRI cancellations in place, static GTFS unchanged: ok');
}

console.log('verify-feeds: OK');
