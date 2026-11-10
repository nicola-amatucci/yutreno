/**
 * Checks of the timetable imports (GTFS, NeTEx, railML 2 and 3): round trip of every service scenario through the exports (the
 * imported services are those of the scenario), matching to the line, service days, times after midnight, other
 * producers' files (deflated ZIP with a folder, quoted CSV, NeTEx with prefixes, operating periods, missing day
 * offsets, railML 3 itinerary ranges with offsets, railML 2 train parts), and the XML reader. railML also carries the
 * minimum dwells, so its round trip keeps them.
 *   npx tsx scripts/verify-imports.ts
 */
import assert from 'node:assert/strict';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { LINE_PRESETS, Simulation, resolveScenario, type ServiceDef } from '../src/core';
import {
  CONTROLLED_NUMBER, DEFAULT_FEED_OPTIONS as O, gtfsFiles, importGtfs, importNetex, importRailml, importTimetable, netexTimetable, normalService, parseCsv, parseXml, railmlTimetable, unzip, zip,
} from '../src/feeds';
import { loadScenarios } from '../src/server/headless';

const enc = new TextEncoder();
const norm = (s: ServiceDef[]) => s.map(normalService);
/** Services as railML gives them back: normal form plus the minimum dwell of every intermediate stop (20 s by default) */
const withDwells = (s: ServiceDef[]) => s.map(x => { const n = normalService(x); n.stops.forEach((p, i) => { if (i > 0 && i < n.stops.length - 1) p.min_dwell_s = x.stops[i].min_dwell_s ?? 20; }); return n; });

/** ZIP with deflated entries, data descriptors and a folder, as many producers write them */
function deflatedZip(files: Record<string, string>, folder: string): Uint8Array {
  const parts: Buffer[] = [], central: Buffer[] = [];
  let off = 0;
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Uint8Array) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  for (const [n, t] of Object.entries(files)) {
    const name = Buffer.from(folder + '/' + n), raw = enc.encode(t), data = deflateRawSync(raw), c = crc(raw);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(8, 6); h.writeUInt16LE(8, 8); h.writeUInt16LE(name.length, 26);
    const dd = Buffer.alloc(16); dd.writeUInt32LE(0x08074b50, 0); dd.writeUInt32LE(c, 4); dd.writeUInt32LE(data.length, 8); dd.writeUInt32LE(raw.length, 12);
    const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(20, 4); cd.writeUInt16LE(20, 6); cd.writeUInt16LE(8, 8); cd.writeUInt16LE(8, 10);
    cd.writeUInt32LE(c, 16); cd.writeUInt32LE(data.length, 20); cd.writeUInt32LE(raw.length, 24); cd.writeUInt16LE(name.length, 28); cd.writeUInt32LE(off, 42);
    parts.push(h, name, Buffer.from(data), dd); central.push(cd, name);
    off += 30 + name.length + data.length + 16;
  }
  const cdBuf = Buffer.concat(central), e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(Object.keys(files).length, 8); e.writeUInt16LE(Object.keys(files).length, 10); e.writeUInt32LE(cdBuf.length, 12); e.writeUInt32LE(off, 16);
  return new Uint8Array(Buffer.concat([...parts, cdBuf, e]));
}

// ---- XML reader ----
{
  const x = parseXml(`<?xml version="1.0"?><!-- c --><n:Root xmlns:n="urn:x" a='1 &amp; 2'><n:A>x &lt; y<!-- c --> z</n:A><B><![CDATA[<raw> & ok]]></B><C/><D k="&#x41;&#66;"/></n:Root>`);
  assert.equal(x.name, 'Root');
  assert.equal(x.attrs.a, '1 & 2');
  assert.equal(x.children[0].text, 'x < y z');
  assert.equal(x.children[1].text, '<raw> & ok');
  assert.equal(x.children[2].name, 'C');
  assert.equal(x.children[3].attrs.k, 'AB');
  assert.throws(() => parseXml('<a><b></a>'), /does not close/);
  console.log('XML reader: prefixes, entities, comments, CDATA, empty elements, errors');
}

// ---- CSV ----
{
  const rows = parseCsv('﻿a,b,c\r\n1,"x, ""y""",3\n\n2,,"multi\nline"\n');
  assert.deepEqual(rows, [{ a: '1', b: 'x, "y"', c: '3' }, { a: '2', b: '', c: 'multi\nline' }]);
  console.log('CSV: BOM, quotes, commas, empty lines, line breaks in fields');
}

// ---- round trip of every service scenario through GTFS and NeTEx ----
// (the scenarios on a network are left out: their feeds are not produced yet, docs/design/network.md)
const oneLine = loadScenarios('scenarios/services').filter(x => !x.def.network);
for (const { file, def } of oneLine) {
  const { line, train, scen } = resolveScenario(def);
  const sim = new Simulation(line, train, scen, def);
  const want = norm(def.services ?? []);
  const files = gtfsFiles(sim, O), o = { line, date: O.date };
  const g = importGtfs(files, o), n = importNetex(netexTimetable(sim, O), o), rm = importRailml(railmlTimetable(sim, O), o);
  assert.deepEqual(norm(g.services), want, `${file}: GTFS round trip`);
  assert.deepEqual(norm(n.services), want, `${file}: NeTEx round trip`);
  assert.deepEqual(rm.services, withDwells(def.services ?? []), `${file}: railML round trip`);
  for (const r of [g, n, rm]) assert.deepEqual(r.warnings, [`${CONTROLLED_NUMBER}: same timetable as the line, it is the controlled train: not imported as a service`]);
  // the controlled train, when asked for, comes back with the timetable of the line
  const k = importGtfs(files, { ...o, keepControlled: true }).services.find(s => s.id === CONTROLLED_NUMBER)!;
  assert.deepEqual(k.stops.map(s => s.station), line.stations.map(s => s.name));
  // another start of the run shifts the times; another day has no trip
  const early = importNetex(netexTimetable(sim, O), { ...o, start: '07:00:00' });
  assert.equal(early.services.find(s => s.id === def.services![0].id)!.stops[0].departure_s, (def.services![0].stops[0].departure_s as number) + 3600);
  assert.equal(importGtfs(files, { ...o, date: '2026-11-06' }).services.length, 0);
  assert.equal(importNetex(netexTimetable(sim, O), { ...o, date: '2026-11-06' }).services.length, 0);
  // the archive of the export, read back through the generic entry point
  const z = await importTimetable('feed.zip', zip(files), o);
  assert.deepEqual(norm(z.services), want);
  console.log(`${file}: GTFS, NeTEx and railML round trip, ${want.length} services identical`);
}

// ---- rolling stock circulations: the block of the services goes through GTFS (block_id) and back ----
// @test IMP-B: blocks of the rolling stock circulation through GTFS block_id [YT-BLOCK]
{
  const base = loadScenarios('scenarios/services/crossing.json')[0].def;
  const services: ServiceDef[] = [
    { id: 'R 2201', train: 'regional', block: 'B7', stops: [{ station: 'Valle Lauro', departure_s: 1000 }, { station: 'Ponte Sabato', arrival_s: 1260, departure_s: 1290 }, { station: 'Monte Clanio', arrival_s: 1900 }] },
    { id: 'R 2202', block: 'B7', stops: [{ station: 'Monte Clanio', departure_s: 2300 }, { station: 'San Felice Scalo', arrival_s: 2560, departure_s: 2600 }, { station: 'Valle Lauro', arrival_s: 3200 }] },
  ];
  const def = { ...base, services }, { line, train, scen } = resolveScenario(def), sim = new Simulation(line, train, scen, def);
  const files = gtfsFiles(sim, O);
  assert.ok(/,block_id\r\n/.test(files['trips.txt'].split('\r\n')[0] + '\r\n'), 'block_id column');
  const back = importGtfs(files, { line, date: O.date });
  assert.deepEqual(back.services.map(normalService).map(s => [s.id, s.block]), [['R 2201', 'B7'], ['R 2202', 'B7']], 'blocks imported');
  console.log('blocks: block_id written by the GTFS export and read back by the import: ok');
}

// ---- round trip of a larger timetable: both directions, short services, times after midnight, minimum dwells ----
{
  const base = loadScenarios('scenarios/services/crossing.json')[0].def, all = oneLine.flatMap(x => x.def.services ?? []);
  const services: ServiceDef[] = [];
  for (let k = 0; k < 8; k++) for (const s of all) services.push({ ...s, id: `${s.id.slice(0, 4)}${k}${services.length}`, stops: s.stops.map(p => ({ ...p,
    ...(p.arrival_s != null ? { arrival_s: p.arrival_s + k * 9000 } : {}), ...(p.departure_s != null ? { departure_s: p.departure_s + k * 9000 } : {}), min_dwell_s: 40 })) });
  services.push({ id: 'R 9001', stops: [{ station: 'Ponte Sabato', departure_s: 1000 }, { station: 'San Felice Scalo', arrival_s: 1300 }] });
  const def = { ...base, services }, { line, train, scen } = resolveScenario(def), sim = new Simulation(line, train, scen, def), o = { line, date: O.date };
  const want = norm(services);
  assert.deepEqual(norm(importGtfs(gtfsFiles(sim, O), o).services), want, 'GTFS, large timetable');
  assert.deepEqual(norm(importNetex(netexTimetable(sim, O), o).services), want, 'NeTEx, large timetable');
  assert.deepEqual(importRailml(railmlTimetable(sim, O), o).services, withDwells(services), 'railML, large timetable, with minimum dwells');
  console.log(`large timetable: ${services.length} services up to ${Math.round(Math.max(...services.flatMap(s => s.stops.map(p => p.arrival_s ?? 0))) / 3600 + 8)}:00, identical after GTFS, NeTEx and railML (railML keeps the minimum dwells too)`);
}

// ---- files of other producers ----
const line = LINE_PRESETS['valle-lauro'];
{
  // GTFS: deflated, inside a folder, calendar.txt with weekdays, a station off the line, quoted names, platform names
  const files: Record<string, string> = {
    'agency.txt': 'agency_id,agency_name,agency_url,agency_timezone\nA,"Ferrovie, Test",https://example.org,Europe/Rome\n',
    'stops.txt': 'stop_id,stop_name,parent_station,location_type\nVL,Valle Lauro,,1\nVL1,Valle Lauro binario 1,VL,0\nPS,PONTE SABATO,,0\nSF,"San Felice Scalo",,0\nMC,Monte Clanio,,0\nXX,Altrove,,0\n',
    'routes.txt': 'route_id,agency_id,route_short_name,route_type\nR,A,R,2\n',
    'trips.txt': 'route_id,service_id,trip_id,trip_short_name\nR,WD,t1,R 3001\nR,WE,t2,R 3003\nR,WD,t3,\n',
    'stop_times.txt': 'trip_id,arrival_time,departure_time,stop_id,stop_sequence\n'
      + 't1,08:20:00,08:20:00,VL1,1\nt1,08:24:00,08:24:30,PS,2\nt1,08:30:00,08:30:30,SF,3\nt1,08:35:00,08:35:00,XX,4\n'
      + 't2,09:00:00,09:00:00,MC,1\nt2,09:15:00,09:15:00,VL,2\n'
      + 't3,23:50:00,23:50:00,VL,1\nt3,24:10:00,24:10:00,MC,2\n',
    'calendar.txt': 'service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\nWD,1,1,1,1,1,0,0,20260101,20261231\nWE,0,0,0,0,0,1,1,20260101,20261231\n',
    'calendar_dates.txt': 'service_id,date,exception_type\nWE,20261105,1\n',
  };
  const r = await importTimetable('other.zip', deflatedZip(files, 'gtfs'), { line, date: '2026-11-05' }, d => inflateRawSync(d));
  assert.equal((await unzip(deflatedZip(files, 'g'), d => inflateRawSync(d)))['g/stops.txt'] != null, true);
  assert.deepEqual(r.services.map(s => s.id), ['R 3001', 'R 3003', 't3']);
  assert.deepEqual(r.services[0].stops, [
    { station: 'Valle Lauro', departure_s: 1200 },
    { station: 'Ponte Sabato', arrival_s: 1440, departure_s: 1470 },
    { station: 'San Felice Scalo', arrival_s: 1800 },
  ], 'platform named after its station, case of names ignored, stop off the line dropped, new destination');
  assert.equal(r.services[2].stops[1].arrival_s, 16 * 3600 + 600, 'times after midnight');
  assert.ok(r.warnings.some(w => /R 3001: stops not on the line dropped \(Altrove\)/.test(w)));
  const sat = importGtfs(files, { line, date: '2026-11-07' });
  assert.deepEqual(sat.services.map(s => s.id), ['R 3003'], 'weekend calendar');
  console.log('GTFS of another producer: deflated ZIP in a folder, calendars, names, stops off the line, after midnight');
}
{
  // NeTEx with a prefix, frames not composite, operating period with ValidDayBits, no TrainNumber, a missing day offset
  const x = `<?xml version="1.0"?>
<nx:PublicationDelivery xmlns:nx="http://www.netex.org.uk/netex" version="1.1"><nx:dataObjects>
 <nx:SiteFrame id="s"><nx:stopPlaces>
  <nx:StopPlace id="sp1"><nx:Name>Valle Lauro</nx:Name><nx:quays><nx:Quay id="q1"><nx:Name>1</nx:Name></nx:Quay></nx:quays></nx:StopPlace>
  <nx:StopPlace id="sp2"><nx:Name>Monte Clanio</nx:Name></nx:StopPlace>
 </nx:stopPlaces></nx:SiteFrame>
 <nx:ServiceCalendarFrame id="c"><nx:dayTypes><nx:DayType id="dt"/></nx:dayTypes>
  <nx:operatingPeriods><nx:UicOperatingPeriod id="op"><nx:FromDate>2026-11-02T00:00:00</nx:FromDate><nx:ToDate>2026-11-08T00:00:00</nx:ToDate><nx:ValidDayBits>1110000</nx:ValidDayBits></nx:UicOperatingPeriod></nx:operatingPeriods>
  <nx:dayTypeAssignments><nx:DayTypeAssignment id="a" order="1"><nx:OperatingPeriodRef ref="op"/><nx:DayTypeRef ref="dt"/></nx:DayTypeAssignment></nx:dayTypeAssignments>
 </nx:ServiceCalendarFrame>
 <nx:ServiceFrame id="f">
  <nx:scheduledStopPoints><nx:ScheduledStopPoint id="p1"><nx:Name>VL</nx:Name></nx:ScheduledStopPoint><nx:ScheduledStopPoint id="p2"><nx:Name>Monte Clanio</nx:Name></nx:ScheduledStopPoint></nx:scheduledStopPoints>
  <nx:stopAssignments><nx:PassengerStopAssignment id="psa" order="1"><nx:ScheduledStopPointRef ref="p1"/><nx:QuayRef ref="q1"/></nx:PassengerStopAssignment></nx:stopAssignments>
  <nx:journeyPatterns><nx:ServiceJourneyPattern id="jp"><nx:pointsInSequence>
   <nx:StopPointInJourneyPattern id="j2" order="2"><nx:ScheduledStopPointRef ref="p2"/></nx:StopPointInJourneyPattern>
   <nx:StopPointInJourneyPattern id="j1" order="1"><nx:ScheduledStopPointRef ref="p1"/></nx:StopPointInJourneyPattern>
  </nx:pointsInSequence></nx:ServiceJourneyPattern></nx:journeyPatterns>
 </nx:ServiceFrame>
 <nx:TimetableFrame id="t"><nx:vehicleJourneys>
  <nx:ServiceJourney id="IT:X:ServiceJourney:op:R4001"><nx:dayTypes><nx:DayTypeRef ref="dt"/></nx:dayTypes><nx:JourneyPatternRef ref="jp"/><nx:passingTimes>
   <nx:TimetabledPassingTime><nx:StopPointInJourneyPatternRef ref="j2"/><nx:ArrivalTime>00:05:00</nx:ArrivalTime></nx:TimetabledPassingTime>
   <nx:TimetabledPassingTime><nx:StopPointInJourneyPatternRef ref="j1"/><nx:DepartureTime>23:45:00+01:00</nx:DepartureTime></nx:TimetabledPassingTime>
  </nx:passingTimes></nx:ServiceJourney>
 </nx:vehicleJourneys></nx:TimetableFrame>
</nx:dataObjects></nx:PublicationDelivery>`;
  const r = importNetex(x, { line, date: '2026-11-04' });
  assert.deepEqual(r.services, [{ id: 'R4001', stops: [{ station: 'Valle Lauro', departure_s: 15 * 3600 + 2700 }, { station: 'Monte Clanio', arrival_s: 16 * 3600 + 300 }] }],
    'order from the pattern, station from the quay, number from the id, midnight without day offset');
  assert.ok(r.warnings.some(w => /without a day offset/.test(w)));
  assert.equal(importNetex(x, { line, date: '2026-11-05' }).services.length, 0, 'ValidDayBits: Thursday off');
  assert.equal(importNetex(x, { line, date: '2026-11-10' }).services.length, 0, 'outside the operating period');
  console.log('NeTEx of another producer: prefixes, quays, pattern order, operating period bits, missing day offset');
}
{
  // railML 3: one base itinerary used by two trains, the second shifted by an offset and cut to a range; bitmask validity
  const x = `<railML xmlns="https://www.railml.org/schemas/3.2" version="3.2"><infrastructure id="i"><functionalInfrastructure><operationalPoints>
   <operationalPoint id="a"><name name="Valle Lauro" language="it"/></operationalPoint><operationalPoint id="b"><name name="Ponte Sabato"/></operationalPoint>
   <operationalPoint id="c"><name name="Bivio" language="it"/></operationalPoint><operationalPoint id="d"><name name="San Felice Scalo"/></operationalPoint>
  </operationalPoints></functionalInfrastructure></infrastructure><timetable>
   <validities><validity id="v"><bitmaskValidity bitmask="0011" fromDate="2026-11-03"/></validity></validities>
   <baseItineraries><baseItinerary id="bi">
    <baseItineraryPoint id="p1" locationRef="a"><times scope="operational"><departure time="08:09:30"/></times><times scope="commercial"><departure time="08:10:00"/></times><stop/></baseItineraryPoint>
    <baseItineraryPoint id="p2" locationRef="b"><times scope="commercial"><arrival time="08:14:00"/><departure time="08:15:00"/></times><stop minDwellTime="PT45S"/></baseItineraryPoint>
    <baseItineraryPoint id="p3" locationRef="c"><times scope="operational"><departure time="08:17:00"/></times><pass/></baseItineraryPoint>
    <baseItineraryPoint id="p4" locationRef="d"><times scope="commercial"><arrival time="08:20:00"/></times><stop/></baseItineraryPoint>
   </baseItinerary></baseItineraries>
   <itineraries><itinerary id="i1"><range baseItineraryRef="bi"/></itinerary><itinerary id="i2"><range baseItineraryRef="bi" start="p2" end="p4" offset="PT1H"/></itinerary></itineraries>
   <operationalTrains>
    <operationalTrain id="t1"><operationalTrainVariant id="v1" itineraryRef="i1" validityRef="v"><identifiers><identifier number="12345" type="OperationalTrainNumber"/><identifier number="R 5001" type="CommercialTrainNumber"/></identifiers></operationalTrainVariant></operationalTrain>
    <operationalTrain id="t2"><name name="R 5003"/><operationalTrainVariant id="v2" itineraryRef="i2" validityRef="v" offset="PT30M"/></operationalTrain>
   </operationalTrains></timetable></railML>`;
  const r = importRailml(x, { line, date: '2026-11-05' });
  assert.deepEqual(r.services, [
    { id: '12345', stops: [{ station: 'Valle Lauro', departure_s: 600 }, { station: 'Ponte Sabato', arrival_s: 840, departure_s: 900, min_dwell_s: 45 }, { station: 'San Felice Scalo', arrival_s: 1200 }] },
    { id: 'R 5003', stops: [{ station: 'Ponte Sabato', departure_s: 900 + 5400, min_dwell_s: 45 }, { station: 'San Felice Scalo', arrival_s: 1200 + 5400 }] },
  ], 'commercial times, passes skipped, ranges, offsets of range and variant, minimum dwell, operational train number');
  assert.equal(importRailml(x, { line, date: '2026-11-04' }).services.length, 0, 'bitmask: not running');
  // railML 2: trainParts with ocpsTT, number from the train, operating period
  const y = `<railml xmlns="http://www.railml.org/schemas/2013" version="2.2"><infrastructure id="i"><operationControlPoints>
   <ocp id="o1" name="Monte Clanio"/><ocp id="o2" name="San Felice Scalo"/><ocp id="o3" name="Valle Lauro"/></operationControlPoints></infrastructure>
   <timetable><operatingPeriods><operatingPeriod id="op" startDate="2026-11-01" bitMask="0000111"/></operatingPeriods>
   <trainParts><trainPart id="tp"><operatingPeriodRef ref="op"/><ocpsTT>
    <ocpTT ocpRef="o3" sequence="3" ocpType="end"><times scope="scheduled" arrival="00:10:00" arrivalDay="1"/></ocpTT>
    <ocpTT ocpRef="o1" sequence="1" ocpType="begin"><times scope="scheduled" departure="23:40:00"/></ocpTT>
    <ocpTT ocpRef="o2" sequence="2" ocpType="stop"><times scope="published" arrival="23:50:00" departure="23:51:00"/><times scope="scheduled" arrival="23:49:30" departure="23:51:00"/><stopDescription minStopTime="PT30S"/></ocpTT>
   </ocpsTT></trainPart></trainParts>
   <trains><train id="t" type="operational" trainNumber="R 6001"><trainPartSequence sequence="1"><trainPartRef ref="tp"/></trainPartSequence></train></trains></timetable></railml>`;
  const r2 = await importTimetable('tt.railml', enc.encode(y), { line, date: '2026-11-05' });
  assert.equal(r2.format, 'railml');
  assert.deepEqual(r2.services, [{ id: 'R 6001', stops: [{ station: 'Monte Clanio', departure_s: 56400 }, { station: 'San Felice Scalo', arrival_s: 56970, departure_s: 57060, min_dwell_s: 30 }, { station: 'Valle Lauro', arrival_s: 58200 }] }],
    'sequence order, scheduled times, day of arrival, train number, minimum stop time');
  assert.equal(importRailml(y, { line, date: '2026-11-04' }).services.length, 0, 'operating period: not running');
  console.log('railML of other producers: 3.x itinerary ranges, offsets, passes, bitmask validity; 2.x train parts, days, operating periods');
}
await assert.rejects(importTimetable('x.txt', enc.encode('hello'), {}), /format not recognised/);
console.log('verify-imports: OK');
