/**
 * Checks the import of the real infrastructure (docs/INFRA_IMPORT.md) on the synthetic sources of
 * scripts/infra-fixture.ts, whose chainages are known:
 *   INF1 the path, the plan and the chainage: length, georeferencing back to the coordinates of the sources
 *   INF2 stations, stop positions, siding and branch left out, stubs beyond a terminal
 *   INF3 speed with the declared priority, tunnels, block from the mapped signals, gradient, provenance
 *   INF4 RINF laid on the line through a block post, consistency of the lengths
 *   INF5 determinism and independence from the order of the elements; errors
 *   INF6 the imported line runs with the example controller, with automatic block and with ETCS
 *   INF7 railML 3.2 infrastructure export and import give back the line, for the imported and the built-in lines
 *   INF8 plausibility of the running times of a timetable against the simulated ones
 *   INF9 gradients from a digital elevation model, with the ground over a tunnel left out
 *   INF10 a real line: Avellino – Benevento from OpenStreetMap and EU-DEM (examples/infra/avellino-benevento/)
 *   INF11 a real line in RINF: Cancello – Benevento from OpenStreetMap, RINF and EU-DEM (examples/infra/cancello-benevento/)
 *   INF12 npm run line-from-sources: queries, downloads and resume, with the saved sources in place of the network
 *   INF13 a real line with a real timetable: Salerno – Mercato San Severino (examples/infra/salerno-mercato-s-severino/),
 *         every trip of the Trenitalia timetable in the direction of the line no faster than the simulated train,
 *         the RINF speed in the tunnel near Salerno and the RINF gradient profile against the DEM
 *   INF14 the RINF gradient profile placed by the kilometres of the stations, with the kilometres decreasing
 *         along the line, a station kilometre that disagrees and a change outside the line left out
 *   npx tsx scripts/verify-infra.ts
 */
// @test INF1: path, plan and chainage of an OSM extract [YT-INFRA]
// @test INF2: stations and stop positions of an OSM extract [YT-INFRA]
// @test INF3: speed, tunnels, block and gradient with their provenance [YT-INFRA]
// @test INF4: RINF sections laid on the imported line [YT-INFRA]
// @test INF5: the import is deterministic [YT-INFRA]
// @test INF6: an imported line runs with the example controller [YT-INFRA]
// @test INF7: railML 3.2 infrastructure round trip [YT-INFRA]
// @test INF8: plausibility of the running times against a timetable [YT-INFRA]
// @test INF9: gradients from a digital elevation model [YT-INFRA]
// @test INF10: import of a real line from OpenStreetMap and EU-DEM [YT-INFRA]
// @test INF11: a real line from OpenStreetMap, RINF and EU-DEM, consistency of the sources [YT-INFRA]
// @test INF12: the line from the sources in one command, with resume [YT-INFRA]
// @test INF13: a real line against its real timetable [YT-INFRA]
// @test INF14: the RINF gradient profile placed by the kilometres of the stations [YT-INFRA]
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DEFAULT_SCENARIO, LINE_PRESETS, Simulation, TRAIN_PRESETS, clone, compileLine, limitOf, gradeOf, runLockstep, scenarioFromConfig, xyOf, type LineDef, type Signalling, type TimetableExtract } from '../src/core';
import { wgs84 } from '../src/feeds/model';
import { haversine, importInfrastructure, importRailmlInfrastructure, osmTrack, railmlInfrastructure, parseOverpass, parseRinf, reportMarkdown, rinfOverlay } from '../src/infra';
import { loadJsController } from '../src/server/headless';
import { plausibility } from '../src/server/plausibility';
import { lineFromSources, type Fetcher } from '../src/server/line-from-sources';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ARC_LEN, ORIGIN, STATIONS, dem, groundAt, latLonAt, overpass, rinf, xOfS } from './infra-fixture';

const osm = overpass(), rf = rinf();
const opts = { from: 'Borgo Alto', to: 'Ripa Bassa' };
const { line, report } = importInfrastructure(osm, opts, rf);
const L = compileLine(clone(line));
// chainage of the track node nearest to an arc length of the fixture (nodes every 25 m of x)
const nodeS = (s: number) => { const x = Math.round(xOfS(s) / 25) * 25; let a = 0, px = 0, py = 0; for (let q = 1; q <= x; q++) { const y = 600 * Math.sin(q / 2500); a += Math.hypot(1, y - py); px = q; py = y; } void px; return a; };

// INF1
assert.ok(Math.abs(L.len - (ARC_LEN + 300 - (ARC_LEN - STATIONS[3].s))) < 0.003 * L.len, `INF1: length ${L.len.toFixed(1)} m`);
assert.deepEqual([line.geo!.lat, line.geo!.lon], [ORIGIN.lat, ORIGIN.lon], 'INF1: origin of the plan');
for (const st of L.st) {
  const want = latLonAt(st.s), got = wgs84(L, st.s);
  assert.ok(haversine(want, got) < 3, `INF1: ${st.name} placed ${haversine(want, got).toFixed(1)} m from the track of the sources`);
}
assert.ok(L.rmin > 1000, `INF1: minimum radius ${L.rmin.toFixed(0)} m, noise in the plan`);
console.log(`INF1 plan: ${line.plan.length} vertices, ${(L.len / 1000).toFixed(3)} km, stations within 3 m of the sources, min radius ${L.rmin.toFixed(0)} m`);

// INF2
assert.deepEqual(line.stations.map(s => s.name), STATIONS.map(s => s.name), 'INF2: stations');
STATIONS.forEach((st, i) => {
  const want = st.stop ? nodeS(st.stop) : st.s;
  assert.ok(Math.abs(line.stations[i].s - want) < 2, `INF2: ${st.name} at ${line.stations[i].s} instead of ${want.toFixed(1)}`);
});
assert.equal(report.stations[1].prov, 'source', 'INF2: the stop position is taken from the source');
assert.ok(report.stations.filter((_, i) => i !== 1).every(s => s.prov === 'derived'), 'INF2: projected station nodes are derived');
assert.ok(!report.stations.some(s => s.name === 'Altrove'), 'INF2: the station of the branch is not on the line');
assert.deepEqual(osmTrack(parseOverpass(osm), opts).ways, [501, 502, 503, 504, 505], 'INF2: the path leaves out the siding and the branch');
assert.ok(Math.abs(report.shares.alignment.generated - 300 + (ARC_LEN - STATIONS[3].s)) < 2, `INF2: stub of ${report.shares.alignment.generated} m`);
assert.ok(report.warnings.some(w => /straight track added/.test(w)), 'INF2: the stub is reported');
console.log(`INF2 stations: ${line.stations.map(s => `${s.name} ${s.s}`).join(', ')}`);

// INF3
const v = (s: number) => limitOf(L, s);
// RINF where it covers the line (decision 10), the OSM limit below it set aside and reported; the lower with 'lower'
assert.equal(v(1000), 100, 'INF3: RINF over a lower OSM limit');
assert.ok(report.speed_conflicts.some(c => c.osm === 60 && c.rinf === 100 && c.kept === 'rinf'), 'INF3: the OSM limit set aside is reported');
{
  const low = importInfrastructure(osm, { ...opts, speedPolicy: 'lower' }, rf);
  assert.equal(limitOf(compileLine(low.line), 1000), 60, 'INF3: with speedPolicy lower the lower OSM limit');
  assert.ok(low.report.speed_conflicts.some(c => c.osm === 60 && c.kept === 'osm'), 'INF3: kept OSM with the policy lower');
  const lv = (s: number) => limitOf(compileLine(low.line), s);
  assert.equal(lv(6400), 100, 'INF3: tunnel way (policy lower)');
  assert.equal(lv(8000), 100, 'INF3: maxspeed:backward on a way drawn against the line (policy lower)');
}
assert.equal(v(3000), 100, 'INF3: RINF caps OSM');
assert.equal(v(6400), 110, 'INF3: RINF over the tunnel way');
assert.equal(v(8000), 105, 'INF3: RINF over maxspeed:backward');
assert.equal(v(11000), 90, 'INF3: RINF where OSM has no speed');
assert.equal(v(L.len - 50), 80, 'INF3: default speed where no source gives one');
assert.equal(report.speed.find(x => x.a <= 11000 && x.b > 11000)!.src, 'rinf');
assert.equal(report.speed[report.speed.length - 1].prov, 'generated');
assert.ok(report.speed_conflicts.some(c => c.osm === 120 && c.rinf === 100), 'INF3: conflict reported');
assert.equal(line.tunnels.length, 1);
assert.ok(Math.abs(line.tunnels[0][0] - nodeS(6000)) < 2 && Math.abs(line.tunnels[0][1] - nodeS(6800)) < 2, `INF3: tunnel ${line.tunnels[0]}`);
assert.equal(line.block, 1350, 'INF3: median spacing of the main signals');
assert.equal(report.signals.block_prov, 'derived');
const g1 = gradeOf(L, 2500), g2 = gradeOf(L, 11000);
assert.ok(Math.abs(g1 - (245 - 210) / (nodeS(5025) - 300) * 1000) < 0.05, `INF3: gradient from the altitudes ${g1}`);
assert.ok(Math.abs(g2 + 5.4) < 0.01, `INF3: gradient of RINF ${g2}`);
for (const [k, sh] of Object.entries(report.shares)) if (k !== 'stations') assert.ok(Math.abs(sh.source + sh.derived + sh.generated - L.len) <= 3, `INF3: share of ${k} does not add up`);
assert.equal(report.suggested_sig, 'BACC');
console.log(`INF3 limits ${line.limits.map(l => l[2]).join('/')} km/h, tunnel ${line.tunnels[0].join('–')} m, block ${line.block} m, gradients ${g1.toFixed(2)} and ${g2.toFixed(2)} ‰`);

// INF4
assert.deepEqual(report.consistency.map(c => c.from), ['Borgo Alto', 'Case Nuove', 'Selva Piana']);
assert.ok(report.consistency.every(c => Math.abs(c.diff_pct) < 2), 'INF4: lengths of the two sources agree');
const pm = rinfOverlay(parseRinf(rf), report.stations).speed.filter(x => x.prov === 'derived');
assert.deepEqual(pm.map(x => x.v), [110, 105], 'INF4: the two sections through the block post');
assert.ok(Math.abs(pm[0].b - (line.stations[1].s + line.stations[2].s) / 2) < 0.1 && pm[1].b === line.stations[2].s, 'INF4: the block post splits the stretch by the RINF lengths');
const only = importInfrastructure(osm, opts);
assert.equal(only.report.sources.length, 2, 'INF4: without RINF only OSM and the rules');
assert.equal(limitOf(compileLine(clone(only.line)), 3000), 120, 'INF4: without RINF the OSM speed stays');
assert.ok(line.attribution!.includes('OpenStreetMap') && line.attribution!.includes('RINF') && !only.line.attribution!.includes('RINF'));
const md = reportMarkdown(report);
assert.ok(md.includes('ODbL') && md.includes('terms of use'), 'INF4: licences in the report');
console.log(`INF4 RINF: ${report.consistency.map(c => `${c.from}–${c.to} ${c.diff_pct} %`).join(', ')}`);

// INF5
const shuffled = { ...osm, elements: [...osm.elements].map((e, i) => [((i * 7919) % 104729), e] as const).sort((a, b) => a[0] - b[0]).map(x => x[1]) };
const again = importInfrastructure(JSON.stringify(shuffled), opts, JSON.stringify(rf));
assert.equal(JSON.stringify(again), JSON.stringify({ line, report }), 'INF5: the order of the elements changes the result');
assert.throws(() => importInfrastructure(osm, { from: 'Borgo Alto', to: 'Nowhere' }), /Nowhere.*not found.*Borgo Alto/);
const fileOsm = JSON.parse(readFileSync('examples/infra/synthetic-overpass.json', 'utf8'));
assert.equal(JSON.stringify(fileOsm), JSON.stringify(osm), 'INF5: examples/infra is not up to date (npx tsx scripts/infra-fixture.ts)');
assert.equal(JSON.stringify(JSON.parse(readFileSync('examples/infra/borgo-alto-ripa-bassa.json', 'utf8'))), JSON.stringify(line), 'INF5: examples/infra/borgo-alto-ripa-bassa.json is not up to date (npm run import-infra)');
assert.equal(readFileSync('examples/infra/borgo-alto-ripa-bassa.railml.xml', 'utf8'), railmlInfrastructure(line), 'INF5: examples/infra/borgo-alto-ripa-bassa.railml.xml is not up to date (npm run import-infra)');
console.log('INF5 deterministic, independent of the order of the elements');

// INF6
for (const sig of ['BACC', 'ETCS'] as Signalling[]) {
  const sim = new Simulation(clone(line), clone(TRAIN_PRESETS.regional), { ...DEFAULT_SCENARIO, sig });
  await runLockstep(sim, loadJsController('examples/ato.js'), { period: 0.2, source: 'ato' });
  const s = sim.summary();
  assert.ok(s.finished, `INF6 ${sig}: run not completed`);
  assert.equal(s.interventions, 0, `INF6 ${sig}: protection interventions`);
  assert.equal(s.overruns, 0, `INF6 ${sig}: overruns`);
  for (const f of s.stops) assert.ok(f.err != null && Math.abs(f.err) < 3, `INF6 ${sig}: stop at ${f.name} (${f.err})`);
  console.log(`INF6 ${sig}: arrival ${s.t_s} s, stops ${s.stops.map(f => f.err).join(' / ')} m`);
}
// INF7
for (const [k, def] of [['imported', line], ...Object.entries(LINE_PRESETS)] as [string, LineDef][]) {
  const x = railmlInfrastructure(def), back = importRailmlInfrastructure(x), A = compileLine(clone(def)), B = compileLine(clone(back));
  assert.ok(x.includes('xmlns="https://www.railml.org/schemas/3.2"') && x.includes('<speedSection') && x.includes('<operationalPoint'), `INF7 ${k}: railML structure`);
  assert.ok(Math.abs(A.len - B.len) < 0.05, `INF7 ${k}: length ${A.len} → ${B.len}`);
  assert.deepEqual(back.stations.map(s => [s.name, s.s]), def.stations.map(s => [s.name, +s.s.toFixed(3)]), `INF7 ${k}: stations`);
  assert.deepEqual(back.limits, def.limits.map(([a, b, v]) => [+a.toFixed(3), +b.toFixed(3), v]), `INF7 ${k}: speed limits`);
  assert.deepEqual(back.tunnels, (def.tunnels ?? []).map(([a, b]) => [+a.toFixed(3), +b.toFixed(3)]), `INF7 ${k}: tunnels`);
  let dp = 0, dg = 0;
  for (let s = 0; s <= A.len; s += 25) {
    dp = Math.max(dp, def.geo ? haversine(wgs84(A, s), wgs84(B, s)) : Math.hypot(xyOf(A, s)[0] - xyOf(B, s)[0], xyOf(A, s)[1] - xyOf(B, s)[1]));
    dg = Math.max(dg, Math.abs(gradeOf(A, s) - gradeOf(B, s)));
  }
  assert.ok(dp < 0.05 && dg < 0.01, `INF7 ${k}: position ${dp.toFixed(3)} m, gradient ${dg.toFixed(4)} ‰`);
  assert.equal(railmlInfrastructure(back), railmlInfrastructure(importRailmlInfrastructure(railmlInfrastructure(back))), `INF7 ${k}: second round trip changes the document`);
}
console.log(`INF7 railML 3.2 round trip: the imported line and ${Object.keys(LINE_PRESETS).length} built-in lines, positions within 5 cm`);

// INF8
const pl = await plausibility(line, line.stations.map(s => ({ station: s.name, arrival_s: s.arr, departure_s: s.dep })));
assert.ok(pl.ok && pl.rows.length === 3, `INF8: generated timetable not plausible ${JSON.stringify(pl.rows)}`);
assert.ok(pl.rows.every(r => r.ratio > 1 && r.ratio < 1.35), 'INF8: ratios');
const fast = await plausibility(line, line.stations.map((s, i) => ({ station: s.name, arrival_s: s.arr == null ? null : Math.round(s.arr * 0.7), departure_s: s.dep == null ? null : Math.round(s.dep * 0.7) })));
assert.ok(!fast.ok && fast.rows.some(r => r.ratio < 0.98), 'INF8: a timetable faster than the train is not flagged');
const slow = await plausibility(line, line.stations.map(s => ({ station: s.name, arrival_s: s.arr == null ? null : s.arr * 3, departure_s: s.dep == null ? null : s.dep * 3 })));
assert.ok(!slow.ok, 'INF8: a timetable three times slower is not flagged');
console.log(`INF8 plausibility: ${pl.rows.map(r => `${r.from}–${r.to} ${r.simulated_s} s simulated, ${r.timetable_s} s timetable`).join('; ')}`);
// INF9
const withDem = importInfrastructure(osm, opts, undefined, dem());
const LD = compileLine(clone(withDem.line));
assert.equal(withDem.report.shares.gradient.derived, Math.round(LD.len), 'INF9: the whole gradient from the DEM');
assert.ok(withDem.report.sources.some(x => x.id === 'dem') && withDem.line.attribution!.includes('Copernicus'), 'INF9: DEM source and attribution');
const altAt = (p: [number, number][], s: number) => { for (let i = 1; i < p.length; i++) if (s <= p[i][0]) return p[i - 1][1] + (p[i][1] - p[i - 1][1]) * (s - p[i - 1][0]) / (p[i][0] - p[i - 1][0]); return p[p.length - 1][1]; };
const [ta, tb] = withDem.line.tunnels[0];
for (let s = ta; s <= tb; s += 50) assert.ok(altAt(withDem.line.profile, s) < Math.max(groundAt(ta - 100), groundAt(tb + 100)) + 1, `INF9: the hill over the tunnel is in the profile at ${s.toFixed(0)} m`);
for (const st of STATIONS) assert.ok(Math.abs(altAt(withDem.line.profile, withDem.line.stations.find(x => x.name === st.name)!.s) - st.ele) < 3, `INF9: altitude of ${st.name} ${altAt(withDem.line.profile, withDem.line.stations.find(x => x.name === st.name)!.s).toFixed(1)}`);
const withBoth = importInfrastructure(osm, opts, rf, dem());
assert.ok(Math.abs(gradeOf(compileLine(clone(withBoth.line)), 11000) + 5.4) < 0.01, 'INF9: RINF before the DEM');
console.log(`INF9 DEM: ${withDem.line.profile.length} profile points, altitudes of the stations within 3 m, tunnel bridged`);

// INF10
const AB = 'examples/infra/avellino-benevento/';
const real = importInfrastructure(readFileSync(AB + 'overpass.json', 'utf8'), { from: 'Avellino', to: 'Benevento' }, undefined, readFileSync(AB + 'eudem25m.json', 'utf8'));
assert.equal(JSON.stringify(JSON.parse(readFileSync(AB + 'line.json', 'utf8'))), JSON.stringify(real.line), `INF10: ${AB}line.json is not up to date (npm run import-infra, docs/INFRA_IMPORT.md)`);
const LR = compileLine(clone(real.line));
assert.deepEqual(real.line.stations.map(x => x.name), ['Avellino', 'Montefredane', 'Prata-Pratola', 'Tufo', 'Altavilla Irpina', 'Chianche-Ceppaloni', 'Montorsi', 'Benevento Porta Rufina', 'Benevento Arco Traiano', 'Benevento'], 'INF10: stations');
assert.ok(LR.len > 30000 && LR.len < 31500 && LR.rmin >= 100 && LR.imax < 35, `INF10: length ${LR.len}, min radius ${LR.rmin}, max gradient ${LR.imax}`);
assert.ok(real.report.shares.alignment.source === Math.round(LR.len) && real.report.shares.gradient.derived === Math.round(LR.len), 'INF10: alignment from OSM, gradient from the DEM');
const simR = new Simulation(clone(real.line), clone(TRAIN_PRESETS.regional), { ...DEFAULT_SCENARIO, sig: 'BACC' });
await runLockstep(simR, loadJsController('examples/ato.js'), { period: 0.2, source: 'ato', maxTime: 10000 });
const sr = simR.summary();
assert.ok(sr.finished && sr.interventions === 0 && sr.overruns === 0 && sr.stops.every(f => f.err != null && Math.abs(f.err) < 5), 'INF10: run on the real line');
console.log(`INF10 Avellino – Benevento: ${(LR.len / 1000).toFixed(3)} km, ${real.line.stations.length} stations, min radius ${LR.rmin.toFixed(0)} m, max gradient ${LR.imax.toFixed(1)} ‰, arrival ${sr.t_s} s`);
// INF11
const CB = 'examples/infra/cancello-benevento/';
const cb = importInfrastructure(readFileSync(CB + 'overpass.json', 'utf8'), { from: 'Cancello', to: 'Benevento' }, readFileSync(CB + 'rinf.json', 'utf8'), readFileSync(CB + 'eudem25m.json', 'utf8'));
assert.equal(JSON.stringify(JSON.parse(readFileSync(CB + 'line.json', 'utf8'))), JSON.stringify(cb.line), `INF11: ${CB}line.json is not up to date (npm run import-infra, docs/INFRA_IMPORT.md)`);
assert.equal(cb.line.stations.length, 12, 'INF11: stations');
assert.equal(cb.report.consistency.length, 11, 'INF11: every pair of stations matched to RINF, abbreviated names included');
const bad = cb.report.consistency.filter(c => Math.abs(c.diff_pct) > 1.5);
assert.deepEqual(bad.map(c => [c.from, c.to, c.rinf_m]), [['Benevento Rione Libertà', 'Benevento Appia', 955000]], 'INF11: the sources agree within 1.5 % except the section whose RINF length is in metres instead of kilometres');
assert.ok(cb.report.warnings.some(w => w.includes('955000')), 'INF11: the RINF error is reported');
assert.ok(cb.report.speed.filter(x => x.src === 'rinf').reduce((t, x) => t + x.b - x.a, 0) > 0.95 * cb.report.line.length_m, 'INF11: speeds from RINF');
const LC = compileLine(clone(cb.line));
assert.ok(LC.rmin >= 100 && LC.imax < 35, `INF11: min radius ${LC.rmin}, max gradient ${LC.imax}`);
const simC = new Simulation(clone(cb.line), clone(TRAIN_PRESETS.regional), { ...DEFAULT_SCENARIO, sig: 'BACC' });
await runLockstep(simC, loadJsController('examples/ato.js'), { period: 0.2, source: 'ato', maxTime: 10000 });
const sc = simC.summary();
assert.ok(sc.finished && sc.interventions === 0 && sc.overruns === 0 && sc.stops.every(f => f.err != null && Math.abs(f.err) < 10), 'INF11: run on the real line');
console.log(`INF11 Cancello – Benevento: ${(LC.len / 1000).toFixed(3)} km, ${cb.line.stations.length} stations, OSM and RINF within 1.5 % on ${cb.report.consistency.length - 1} of ${cb.report.consistency.length} stretches, max gradient ${LC.imax.toFixed(1)} ‰, arrival ${sc.t_s} s`);
// INF12
{
  const osmText = readFileSync(CB + 'overpass.json', 'utf8'), rinfJson = JSON.parse(readFileSync(CB + 'rinf.json', 'utf8'));
  const demPts: { lat: number; lon: number; elevation: number }[] = JSON.parse(readFileSync(CB + 'eudem25m.json', 'utf8'));
  const calls: string[] = [];
  const answer = (body: unknown) => ({ ok: true, status: 200, text: async () => typeof body === 'string' ? body : JSON.stringify(body) });
  // the saved sources stand for the network: Overpass, the RINF graph (both queries) and OpenTopoData
  const fake: Fetcher = async (url, init) => {
    calls.push(url.split('?')[0]);
    const body = decodeURIComponent((init?.body ?? '').replace(/\+/g, ' '));
    if (url.includes('interpreter')) {
      if (body.includes('"name"~')) return answer({ osm3s: { timestamp_osm_base: '2026-11-06T16:33:58Z' }, elements: JSON.parse(osmText).elements.filter((e: any) => e.type === 'node' && /^(Cancello|Benevento)$/.test(e.tags?.name ?? '') && /station|halt/.test(e.tags?.railway ?? '')) });
      assert.ok(/way\["railway"~"\^\(rail\|narrow_gauge\)\$"\]\(4[01]\.\d+,14\.\d+,41\.\d+,14\.\d+\)/.test(body), 'INF12: Overpass query with the bounding box of the line');
      return answer(osmText);
    }
    if (url.includes('rinf-plus')) {
      if (body.includes('CONTAINS(LCASE')) return answer({ head: { vars: ['line', 'name'] }, results: { bindings: rinfJson.results.bindings.flatMap((b: any) => [b.opStartName, b.opEndName]).map((n: any) => ({ line: { value: 'CANCELLO-BENEVENTO' }, name: n })) } });
      assert.ok(body.includes('FILTER (?lineId = "CANCELLO-BENEVENTO")'), 'INF12: sections of the line found');
      return answer(rinfJson);
    }
    const locs = new URL(url).searchParams.get('locations')!.split('|').map(x => x.split(',').map(Number));
    assert.ok(locs.length <= 100, 'INF12: at most 100 points per DEM request');
    return answer({ results: locs.map(([lat, lon]) => { const p = demPts.reduce((b, q) => Math.hypot(q.lat - lat, q.lon - lon) < Math.hypot(b.lat - lat, b.lon - lon) ? q : b); return { elevation: p.elevation, location: { lat, lng: lon } }; }), status: 'OK' });
  };
  const dir = mkdtempSync(join(tmpdir(), 'yutreno-lfs-'));
  const quiet = () => {};
  const r1 = await lineFromSources({ from: 'Cancello', to: 'Benevento', out: dir }, fake, async () => {}, quiet);
  for (const f of ['overpass.json', 'rinf.json', 'dem.json', 'line.json', 'report.md', 'railml.xml']) assert.ok(existsSync(join(dir, f)), `INF12: ${f} not written`);
  assert.equal(calls.filter(u => u.includes('interpreter')).length, 2, 'INF12: one Overpass query for the stations and one for the line');
  assert.equal(calls.filter(u => u.includes('opentopodata')).length, Math.ceil((demPts.length + 2) / 100), 'INF12: DEM requests');
  assert.equal(JSON.stringify(r1.line), JSON.stringify(importInfrastructure(osmText, { from: 'Cancello', to: 'Benevento' }, readFileSync(join(dir, 'rinf.json'), 'utf8'), readFileSync(join(dir, 'dem.json'), 'utf8')).line), 'INF12: the line is the import of the saved sources');
  assert.ok(r1.report.consistency.length === 11 && r1.report.shares.gradient.derived > 0, 'INF12: RINF and DEM used');
  const offline: Fetcher = async () => { throw new Error('no network'); };
  const r2 = await lineFromSources({ from: 'Cancello', to: 'Benevento', out: dir }, offline, async () => {}, quiet);
  assert.equal(JSON.stringify(r2.line), JSON.stringify(r1.line), 'INF12: a second run reuses the downloads');
  console.log(`INF12 line-from-sources: ${calls.length} requests (Overpass, RINF, OpenTopoData), the same line again offline from the saved downloads`);
}
// INF13
{
  const SM = 'examples/infra/salerno-mercato-s-severino/';
  const sm = importInfrastructure(readFileSync(SM + 'overpass.json', 'utf8'), { from: 'Salerno', to: 'Mercato San Severino', id: 'salerno-mercato-s-severino' }, readFileSync(SM + 'rinf.json', 'utf8'), readFileSync(SM + 'eudem25m.json', 'utf8'));
  assert.equal(JSON.stringify(JSON.parse(readFileSync(SM + 'line.json', 'utf8'))), JSON.stringify(sm.line), `INF13: ${SM}line.json is not up to date (npm run import-infra, docs/INFRA_IMPORT.md)`);
  assert.equal(sm.line.stations.length, 9, 'INF13: stations');
  assert.ok(sm.report.consistency.length === 8 && sm.report.consistency.every(c => Math.abs(c.diff_pct) < 1.5), 'INF13: OSM and RINF agree within 1.5 % on every stretch');
  const tt: TimetableExtract = JSON.parse(readFileSync(SM + 'timetable.json', 'utf8'));
  // all the trips, with the station names of the line: those in the direction of the line are checked
  const all = scenarioFromConfig({ line: sm.line, timetable: tt, trains: { count: tt.trips.length } }).services!;
  assert.equal(all.length, tt.trips.length, 'INF13: every trip on the line');
  const first = sm.line.stations[0].name;
  const forward = all.filter(sv => sv.stops[0].station === first);
  const runs = new Map<string, Awaited<ReturnType<typeof plausibility>>>();
  let rows = 0, within = 0;
  const faster = new Map<string, string[]>();
  for (const sv of forward) {
    const key = JSON.stringify(sv.stops.map(x => [x.station, x.arrival_s != null ? x.arrival_s - (sv.stops[0].departure_s as number) : null, x.departure_s != null ? x.departure_s - (sv.stops[0].departure_s as number) : null]));
    if (!runs.has(key)) runs.set(key, await plausibility(clone(sm.line), sv.stops));
    const p = runs.get(key)!;
    for (const r of p.rows) {
      if (r.timetable_s < p.bounds.lower * r.simulated_s) faster.set(`${r.from} – ${r.to}`, [...(faster.get(`${r.from} – ${r.to}`) ?? []), sv.id]);
      rows++; if (r.ok) within++;
    }
  }
  // with RINF where it covers the line (decision 10) no stretch is run faster by the timetable than by the simulated train:
  // in the tunnel between Salerno and Salerno Irno RINF gives 60 km/h, and the 30 km/h of OpenStreetMap is set aside and reported
  assert.deepEqual([...faster.keys()], [], `INF13: stretches faster in the timetable than in the simulation: ${[...faster].map(([k, v]) => `${k} (${v.join(', ')})`).join('; ')}`);
  const tun = sm.report.speed.find(x => x.a <= 1000 && x.b >= 1000)!;
  assert.ok(tun.v === 60 && tun.src === 'rinf', `INF13: the 60 km/h of RINF in the tunnel near Salerno Irno (${tun.v} ${tun.src})`);
  assert.ok(sm.report.speed_conflicts.some(c => c.a <= 1000 && c.b >= 1000 && c.osm === 30 && c.rinf === 60 && c.kept === 'rinf'), 'INF13: the 30 km/h of OpenStreetMap set aside and reported');
  // the RINF gradient profile placed by the kilometres of the stations: the climb of every stretch agrees with the DEM
  assert.equal(sm.report.gradient_check.length, 8, 'INF13: RINF against the DEM on every stretch');
  const worst = Math.max(...sm.report.gradient_check.map(g => Math.abs(g.rinf_m - g.dem_m)));
  assert.ok(worst < 6, `INF13: RINF and DEM climbs within 6 m (${worst.toFixed(1)} m)`);
  const fromRinf = sm.report.gradient.filter(x => x.src === 'rinf').reduce((t, x) => t + x.b - x.a, 0);
  assert.ok(fromRinf > 0.9 * sm.report.line.length_m, `INF13: the gradient comes from RINF (${fromRinf.toFixed(0)} m)`);
  console.log(`INF13 Salerno – Mercato San Severino: ${forward.length} trips of the real timetable towards Mercato San Severino, ${within} of ${rows} stretches within the bounds, none faster than the simulated train; RINF 60 km/h in the tunnel (OSM 30 set aside); RINF and DEM climbs within ${worst.toFixed(1)} m`);
}
// INF14
{
  // the kilometres of the line decrease from Borgo Alto (km 20+000) to Ripa Bassa; Selva Piana carries the kilometre
  // of another line; a gradient of RINF holds from its kilometre towards the increasing kilometres: +8 ‰ beyond km 20,
  // -3 ‰ from km 17.5 to km 20, +2 ‰ from km 9 to km 17.5, and a change at km 99, off the line
  const km: Record<string, string> = { 'BORGO ALTO': '999 | 20+000', 'CASE NUOVE': '999 | 15+267', 'SELVA PIANA': '777 | 3+100;999 | 40+000', 'RIPA BASSA': '999 | 6+350' };
  const prof: Record<string, string> = { sol1: '+8.0(20.000) -3.0(17.500) +50.0(99.000)', sol4: '+2.0(9.000)' };
  const r = rinf() as { head: { vars: string[] }; results: { bindings: Record<string, { type: string; value: string }>[] } };
  const rp = { head: { vars: [...r.head.vars, 'gradientProfile', 'opStartKm', 'opEndKm'] }, results: { bindings: r.results.bindings.map(b => {
    const sol = b.sol.value.split('/').pop()!, x = { ...b };
    delete x.gradient;
    if (prof[sol]) x.gradientProfile = { type: 'literal', value: prof[sol] };
    if (km[b.opStartName.value]) x.opStartKm = { type: 'literal', value: km[b.opStartName.value] };
    if (km[b.opEndName.value]) x.opEndKm = { type: 'literal', value: km[b.opEndName.value] };
    return x;
  }) } };
  const gp = importInfrastructure(osm, opts, rp);
  const GL = compileLine(gp.line);
  const sOf = (k: number) => 300 + (20 - k) / (20 - 15.267) * (5032.6 - 300);
  // along the line the kilometres decrease, so the signs turn
  assert.ok(!gp.report.gradient.some(x => x.src === 'rinf' && x.v === -8), 'INF14: the +8 ‰ beyond km 20 holds before Borgo Alto, off the RINF sections');
  assert.ok(Math.abs(gradeOf(GL, 1500) - 3) < 0.05, `INF14: +3 ‰ between km 20 and km 17.5 (${gradeOf(GL, 1500)})`);
  assert.ok(Math.abs(gradeOf(GL, 4000) + 2) < 0.05, `INF14: -2 ‰ between km 17.5 and km 9 (${gradeOf(GL, 4000)})`);
  assert.ok(!gp.report.gradient.some(x => x.src === 'rinf' && x.a <= 12000 && x.b > 12000), 'INF14: no RINF gradient below km 9, where the profile has no change');
  const ch = gp.report.gradient.filter(x => x.src === 'rinf').find(x => Math.abs(x.a - sOf(17.5)) < 5);
  assert.ok(ch, `INF14: the change of km 17.5 at s ${sOf(17.5).toFixed(0)}: ${gp.report.gradient.map(x => `${x.a}–${x.b} ${x.v}`).join(', ')}`);
  assert.ok(gp.report.warnings.some(w => /kilometre 40\.000 of Selva Piana/.test(w)), 'INF14: the kilometre of Selva Piana that disagrees is reported');
  assert.ok(gp.report.warnings.some(w => /km 99\.000 outside the line/.test(w)), 'INF14: the change outside the line is reported');
  console.log(`INF14 RINF gradient profile: ${gp.report.gradient.filter(x => x.src === 'rinf').map(x => `${x.a.toFixed(0)}–${x.b.toFixed(0)} ${x.v} ‰`).join(', ')}`);
}
console.log('infrastructure import: ok');
