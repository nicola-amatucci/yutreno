/**
 * Checks of the network model (phase 4a, docs/design/network.md): compilation of a network and of the corridors of
 * the itineraries, the rules of the itineraries, and runs of trains through a node with the trackside of the engine:
 * crossing on the single track of a branch, trains joining a line at a node one at a time, no two trains on the same
 * track, determinism. Runs without a network are covered by the other checks and by the campaign fingerprint.
 *   npx tsx scripts/verify-network.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FIXED_DT, LINE_PRESETS, NETWORK_PRESETS, STEP, Simulation, compileCorridor, compileLine, compileNetwork, directed, gradeOf, limitOf, onLine, planItinerary, resolveScenario, runLockstep, toCorridor, validateScenario, type ScenarioDef, type TracksideProvider } from '../src/core';
import type { TracksideRequest, TracksideResponse } from '../src/trackside';
import { DEFAULT_FEED_OPTIONS, feedStations, gtfsFiles, netexTimetable, trips } from '../src/feeds';
import { loadJsController, loadScenarios, openChannel } from '../src/server/headless';
import { beneventoJson } from './real-network';
import { readFileSync as readText } from 'node:fs';
import { builtInDriver } from './lib/drive';

const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;

// @test NET-1: network and corridors: nodes, common plan, one-line corridors are the lines, corridors of two lines match their sources [YT-NET]
const main = compileLine(JSON.parse(JSON.stringify(LINE_PRESETS['valle-lauro'])));
const net = compileNetwork(NETWORK_PRESETS['valle-lauro-rocca'], main, LINE_PRESETS);
{
  assert.deepEqual(net.nodes, [{ name: 'San Felice Scalo', lines: [0, 1] }], 'one node, San Felice Scalo');
  assert.deepEqual(net.warnings, [], 'no warnings');
  const at = (j: number) => {
    const n = net.lines[j], s = (n.L.st.find(x => x.name === 'San Felice Scalo') as { s: number }).s, k = s / STEP, i = Math.floor(k), r = k - i;
    return [n.L.X[i] + (n.L.X[i + 1] - n.L.X[i]) * r + n.dx, n.L.Y[i] + (n.L.Y[i + 1] - n.L.Y[i]) * r + n.dy];
  };
  const [a, b] = [at(0), at(1)];
  assert.ok(near(a[0], b[0], 1e-6) && near(a[1], b[1], 1e-6), 'the node is the same point of the common plan');
  // a corridor on one line is the line itself, or the mirrored line
  assert.equal(compileCorridor(net, planItinerary(net, ['Valle Lauro', 'Monte Clanio'])).line, main, 'one line forwards: the line');
  assert.equal(compileCorridor(net, planItinerary(net, ['Monte Clanio', 'Valle Lauro'])).line, directed(net.lines[0], -1), 'one line backwards: the mirrored line');
  assert.equal(compileCorridor(net, planItinerary(net, ['San Felice Scalo', 'Rocca Sabato'])).line, net.lines[1].L, 'a stop list on the branch only runs on the branch');

  for (const [stops, route] of [[['Valle Lauro', 'Ponte Sabato', 'San Felice Scalo', 'Pietrarsa', 'Rocca Sabato'], ['valle-lauro', 'rocca-sabato']], [['Rocca Sabato', 'San Felice Scalo', 'Valle Lauro'], ['rocca-sabato', 'valle-lauro']]] as const) {
    const it = planItinerary(net, [...stops], [...route]), cor = compileCorridor(net, it), C = cor.line;
    const D0 = directed(net.lines[it[0].line], it[0].dir), D1 = directed(net.lines[it[1].line], it[1].dir);
    const j0 = (D0.st.find(x => x.name === 'San Felice Scalo') as { s: number }).s, j1 = (D1.st.find(x => x.name === 'San Felice Scalo') as { s: number }).s;
    assert.ok(near(C.len, j0 + D1.len - j1, 1e-6), 'length: first line to the node, second from the node');
    assert.deepEqual(C.st.map(x => x.name), [...D0.st.filter(x => x.s <= j0).map(x => x.name), ...D1.st.filter(x => x.s > j1).map(x => x.name)], 'stations of both lines, the node once');
    // limits, gradients and curvature equal to those of the line each point comes from
    let worst = 0;
    for (let c = 5; c < C.len - 5; c += 37.3) {
      const p = c < j0 ? { D: D0, d: c } : { D: D1, d: j1 + (c - j0) };
      assert.equal(limitOf(C, c), limitOf(p.D, p.d), `limit at ${c.toFixed(1)}`);
      assert.ok(near(gradeOf(C, c), gradeOf(p.D, p.d), 1e-9), `gradient at ${c.toFixed(1)}`);
      const k = Math.round(c / STEP);
      if (Math.abs(k * STEP - j0) > 2 * STEP) worst = Math.max(worst, Math.abs(C.K[k] - (k * STEP < j0 ? D0.K[k] : D1.K[Math.round((j1 + k * STEP - j0) / STEP)])));
    }
    assert.ok(worst < 1e-4, `curvature from the lines (max difference ${worst})`);
    for (let k = 1; k < C.N; k++) assert.ok(Math.hypot(C.X[k] - C.X[k - 1], C.Y[k] - C.Y[k - 1]) < STEP + 1, `plan continuous at sample ${k}`);
    assert.equal(C.sig.length, D0.sig.filter(x => x.s <= j0).length + D1.sig.filter(x => x.s > j1).length, 'signals of both lines');
    assert.ok(C.sig.every((x, i) => i === 0 || x.s > C.sig[i - 1].s), 'signals in order');
    // from the corridor to the lines and back
    for (let c = 0; c < C.len; c += 211) {
      const lg = cor.legs.find(x => c >= x.lo && c <= x.hi) as (typeof cor.legs)[0];
      const p = onLine(cor.legs, lg.line, c, 0) as { head: number };
      assert.ok(near(toCorridor(cor.legs, lg.line, lg.dir, p.head) as number, c, 1e-6), `round trip at ${c}`);
    }
  }
  console.log('network: node at San Felice Scalo on the same point of the plan; one-line corridors are the lines; two-line corridors: stations, limits, gradients, curvature, plan and signals from their lines: ok');
}

// @test NET-2: itineraries: route through shared stations, stops in running order, errors [YT-NET]
{
  const route = ['valle-lauro', 'rocca-sabato'];
  assert.throws(() => planItinerary(net, ['Valle Lauro', 'Rocca Sabato'], ['valle-lauro', 'nowhere']), /not in the network/);
  assert.throws(() => planItinerary(net, ['Valle Lauro', 'Rocca Sabato']), /no line has all the stops/);
  assert.throws(() => planItinerary(net, ['Valle Lauro', 'Monte Clanio', 'Rocca Sabato'], route), /not on the route|running order/);
  assert.throws(() => planItinerary(net, ['Ponte Sabato', 'Valle Lauro', 'Rocca Sabato'], route), /running order/);
  const it = planItinerary(net, ['Valle Lauro', 'Pietrarsa'], route);
  assert.deepEqual(it.map(g => [g.line, g.dir, g.from, g.to]), [[0, 1, 'Valle Lauro', 'San Felice Scalo'], [1, 1, 'San Felice Scalo', 'Pietrarsa']], 'passing the node without stopping');
  assert.ok(validateScenario({ name: 'x', services: [{ id: 'A', route, stops: [{ station: 'Valle Lauro', departure_s: 0 }, { station: 'Rocca Sabato' }] }] }).some(e => /needs a network/.test(e)), 'a route needs a network');
  assert.ok(validateScenario({ name: 'x', network: 'nowhere' }).some(e => /unknown network/.test(e)), 'unknown network');
  console.log('itineraries: route through the node, stops in running order, errors for unknown lines, missing routes and wrong order: ok');
}

/** Runs with the built-in ATO on every train; checks at every step that no two trains share a track */
function run(def: ScenarioDef) {
  const { line, train, scen } = resolveScenario(def);
  const sim = new Simulation(line, train, scen, def), drive = builtInDriver();
  const lines = sim.net.lines;
  // single-track sections of every line, as in the engine
  const seg = lines.map(n => n.L.st.slice(1).map((x, k) => [n.L.st[k].s + 250, x.s - 250]));
  let overlaps = 0, opposed = 0;
  const together = new Map<string, number>();
  const inNode = (j: number, dir: 1 | -1, a: number, b: number) => {
    const D = directed(lines[j], dir), dN = (D.st.find(x => x.name === 'San Felice Scalo') as { s: number } | undefined)?.s;
    if (dN == null) return false;
    return b > dN - 400 && a < dN + 250;
  };
  while (!sim.done && sim.time < 5000) {
    drive(sim);
    sim.step(FIXED_DT);
    sim.sample();
    const on = sim.trains.filter(r => r.active && !r.S.finished);
    for (let j = 0; j < lines.length; j++) {
      const ps = on.map(r => ({ r, p: onLine(r.legs, j, r.S.s, r.TR.L) })).filter(x => x.p) as { r: typeof on[0]; p: { head: number; len: number; dir: 1 | -1 } }[];
      const len = lines[j].L.len, span = (p: { head: number; len: number; dir: 1 | -1 }) => p.dir > 0 ? [p.head - p.len, p.head] : [len - p.head, len - p.head + p.len];
      for (let x = 0; x < ps.length; x++) for (let y = x + 1; y < ps.length; y++) {
        const [a1, b1] = span(ps[x].p), [a2, b2] = span(ps[y].p);
        if (ps[x].p.dir === ps[y].p.dir) { if (b1 > a2 && b2 > a1) overlaps++; }
        else if (seg[j].some(([p, q]) => b1 > p && a1 < q && b2 > p && a2 < q)) opposed++;
        // two trains of the same direction in the station of the node at the same time
        if (ps[x].p.dir === ps[y].p.dir) {
          const d = ps[x].p.dir, D = directed(lines[j], d), toD = (p: { head: number; len: number }) => [p.head - p.len, p.head];
          const [c1, e1] = toD(ps[x].p), [c2, e2] = toD(ps[y].p);
          if (inNode(j, d, c1, e1) && inNode(j, d, c2, e2) && D) together.set(`${ps[x].r.id}+${ps[y].r.id}`, (together.get(`${ps[x].r.id}+${ps[y].r.id}`) ?? 0) + 1);
        }
      }
    }
  }
  const h = createHash('sha256');
  for (const r of sim.trains) h.update(JSON.stringify(r.S.rows));
  return { sim, overlaps, opposed, together, hash: h.digest('hex').slice(0, 16) };
}
const realised = (sim: Simulation, id: string, st: string) => (sim.trains.find(r => r.id === id) as Simulation['trains'][0]).realised.find(x => x.station === st) as { arrival_s: number | null; departure_s: number | null };
const [{ def: branch }] = loadScenarios('scenarios/services/branch.json');

// @test NET-3: trains through a node with the trackside of the engine: crossing on the branch, no shared track, determinism [YT-NET, YT-NODE]
for (const sig of ['ETCS', 'BACC'] as const) {
  const def: ScenarioDef = { ...branch, signalling: sig };
  const a = run(def), b = run(def);
  assert.equal(a.hash, b.hash, `${sig}: deterministic`);
  for (const r of a.sim.trains) {
    const s = a.sim.summary(r);
    assert.ok(r.S.finished && s.overruns === 0 && s.interventions === 0, `${sig} ${r.id}: ${JSON.stringify(s.checks.filter(c => !c.ok))}`);
  }
  assert.equal(a.overlaps, 0, `${sig}: two trains on the same track`);
  assert.equal(a.opposed, 0, `${sig}: opposing trains on one single-track section`);
  // the two services cross at Pietrarsa: the one from the node leaves only after the other has arrived
  const up = realised(a.sim, 'R 3101', 'Pietrarsa'), down = realised(a.sim, 'R 3102', 'Pietrarsa');
  assert.ok((up.departure_s as number) >= (down.arrival_s as number) && (down.departure_s as number) >= (up.arrival_s as number), `${sig}: crossing at Pietrarsa`);
  // the opposite train late: the crossing stays at Pietrarsa, R 3101 waits for it
  const late = run({ ...def, services: (def.services ?? []).map(sv => sv.id === 'R 3102' ? { ...sv, stops: sv.stops.map((x, i) => i === 0 ? { ...x, departure_s: 1100 } : x) } : sv) });
  // (the realised departure is the closing of the doors: R 3101 then waits at the starting signal)
  const end1 = realised(a.sim, 'R 3101', 'Rocca Sabato'), end2 = realised(late.sim, 'R 3101', 'Rocca Sabato'), down2 = realised(late.sim, 'R 3102', 'Pietrarsa');
  assert.ok((end2.arrival_s as number) > (down2.arrival_s as number) + 120, `${sig}: R 3101 waits at Pietrarsa for the late train`);
  assert.equal(late.overlaps + late.opposed, 0, `${sig}: late opposite train, track shared`);
  console.log(`${sig}: branch through the node, crossing at Pietrarsa, R 3101 at Rocca Sabato ${end1.arrival_s?.toFixed(0)} s, ${end2.arrival_s?.toFixed(0)} s with R 3102 220 s late; no shared track, deterministic (${a.hash}): ok`);
}

// @test NET-4: trains joining a line at a node: the node route is given to one train at a time [YT-NODE]
for (const sig of ['ETCS', 'BACC'] as const) {
  const join: ScenarioDef = { ...branch, signalling: sig, services: [...(branch.services ?? []), { id: 'R 2103', train: 'regional', stops: [
    { station: 'Monte Clanio', departure_s: 1200 },
    { station: 'San Felice Scalo', arrival_s: 1450, departure_s: 1480 },
    { station: 'Ponte Sabato', arrival_s: 1760, departure_s: 1790 },
    { station: 'Valle Lauro', arrival_s: 2050 } ] }] };
  const a = run(join);
  for (const r of a.sim.trains) {
    const s = a.sim.summary(r);
    assert.ok(r.S.finished && s.overruns === 0 && s.interventions === 0, `${sig} ${r.id}: ${JSON.stringify(s.checks.filter(c => !c.ok))}`);
  }
  assert.equal(a.overlaps + a.opposed, 0, `${sig}: two trains on the same track`);
  assert.ok(!a.together.has('R 3102+R 2103') && !a.together.has('R 2103+R 3102'), `${sig}: two trains in the node station towards Valle Lauro at once`);
  const x = realised(a.sim, 'R 3102', 'San Felice Scalo'), y = realised(a.sim, 'R 2103', 'San Felice Scalo');
  const [first, second] = (x.arrival_s as number) < (y.arrival_s as number) ? [x, y] : [y, x];
  assert.ok((second.arrival_s as number) > (first.departure_s as number), `${sig}: the second train enters the node after the first has left`);
  console.log(`${sig}: R 3102 from the branch and R 2103 from Monte Clanio join towards Valle Lauro one at a time (San Felice Scalo ${x.arrival_s?.toFixed(0)}–${x.departure_s?.toFixed(0)} s and ${y.arrival_s?.toFixed(0)}–${y.departure_s?.toFixed(0)} s): ok`);
}

// @test NET-6: rolling stock circulation: the next service of a block leaves not before the arrival of the previous one plus the turnaround [YT-BLOCK]
const [{ def: shuttle }] = loadScenarios('scenarios/services/branch-shuttle.json');
{
  const closed = (sim: Simulation, id: string) => ((sim.trains.find(r => r.id === id) as Simulation['trains'][0]).S.events.find(e => e.text === 'Doors closed') as { t: number }).t;
  const arrival = (sim: Simulation, id: string) => { const r = sim.trains.find(x => x.id === id) as Simulation['trains'][0]; return r.realised[r.realised.length - 1].arrival_s as number; };
  const a = run(shuttle);
  for (const r of a.sim.trains) assert.ok(r.S.finished && a.sim.summary(r).interventions === 0, `${r.id} on time`);
  assert.ok(near(closed(a.sim, 'S 4102'), 1560, 0.01) && near(closed(a.sim, 'S 4103'), 2420, 0.01), 'on time: the turnarounds do not hold the services');
  // S 4101 broken down for 500 s: the delay passes to S 4102 and then to S 4103, in closed form
  const late = run({ ...shuttle, events: [{ type: 'train_stopped', train: 'S 4101', when: { t: 800 }, duration_s: 500 }] });
  const d2 = closed(late.sim, 'S 4102'), w2 = Math.max(1560, arrival(late.sim, 'S 4101') + 300);
  const d3 = closed(late.sim, 'S 4103'), w3 = Math.max(2420, arrival(late.sim, 'S 4102') + 300);
  assert.ok(near(d2, w2, 0.01) && d2 > 1560 + 100, `S 4102 leaves at ${d2}, expected ${w2}`);
  assert.ok(near(d3, w3, 0.01), `S 4103 leaves at ${d3}, expected ${w3}`);
  assert.equal(late.overlaps + late.opposed, 0, 'circulation: track shared');
  assert.ok(validateScenario({ ...shuttle, min_turnaround_s: -1 }).some(e => /min_turnaround_s/.test(e)), 'negative turnaround refused');
  const wrong = { ...shuttle, services: (shuttle.services ?? []).map(sv => sv.id === 'S 4102' ? { ...sv, stops: sv.stops.slice(1) } : sv) };
  const rw = resolveScenario(wrong);
  assert.throws(() => new Simulation(rw.line, rw.train, rw.scen, wrong), /block B1: S 4102 starts at Pietrarsa, but S 4101 ends at Rocca Sabato/);
  console.log(`circulation B1: on time 1560/2420 s; S 4101 500 s late → S 4102 leaves ${d2.toFixed(1)} s, S 4103 ${d3.toFixed(1)} s = arrival of the previous one + 300 s: ok`);
}

// @test NET-7: connections: the departing train waits for the feeder within the maximum wait, kept or lost [YT-CONN]
{
  const conn = (sim: Simulation) => sim.connections[0];
  const at = (n: number) => run({ ...shuttle, events: n ? [{ type: 'train_stopped', train: 'train', when: { t: 300 }, duration_s: n }] : [] });
  const a = at(0), b = at(200), c = at(600);
  assert.equal(conn(a.sim).outcome, 'kept'); assert.equal(conn(a.sim).wait_s, 0, 'feeder on time: no wait');
  const arrB = realised(b.sim, 'train', 'San Felice Scalo').arrival_s as number;
  assert.equal(conn(b.sim).outcome, 'kept', 'feeder 200 s late: kept');
  assert.ok(near(conn(b.sim).wait_s, arrB + 120 - 700, 0.051), `wait ${conn(b.sim).wait_s} s, expected arrival ${arrB.toFixed(1)} + 120 − 700`);
  assert.equal(conn(c.sim).outcome, 'lost', 'feeder 600 s late: lost');
  assert.ok(near(conn(c.sim).wait_s, 300, 0.01), 'lost after the maximum wait');
  const tt = b.sim.timetable().find(x => x.id === 'S 4101') as ReturnType<Simulation['timetable']>[0];
  assert.deepEqual((tt.stops[0] as { connections?: unknown }).connections, [{ from: 'train', outcome: 'kept', wait_s: conn(b.sim).wait_s }], 'connection in the realised timetable');
  assert.ok(validateScenario({ ...shuttle, connections: [{ station: 'San Felice Scalo', from_service: 'X', to_service: 'S 4101' }] }).some(e => /no service «X»/.test(e)), 'unknown feeder refused');
  console.log(`connection at San Felice Scalo: feeder on time kept; 200 s late kept with ${conn(b.sim).wait_s} s of wait; 600 s late lost after 300 s: ok`);
}

// @test NET-5: what a network does not support yet is refused [YT-NET, YT-IXL-NET]
{
  // with the interlocking trackside a reroute needs the routes generated at the start: here the branch has no routes
  // against its direction, since no train runs that way
  const [{ def: loop }] = loadScenarios('scenarios/services/loop-reroute.json');
  const d: ScenarioDef = { ...loop, signalling: 'ETCS', onboard: 'reference', trackside: 'interlocking', events: [], services: [{ id: 'R 3106', train: 'regional', route: ['ponte-pietrarsa'], stops: [
    { station: 'Pietrarsa', departure_s: 600 }, { station: 'Casale Sabato', arrival_s: 870, departure_s: 900 }, { station: 'Ponte Sabato', arrival_s: 1160 }] }] };
  const r = resolveScenario(d), sim = new Simulation(r.line, r.train, r.scen, d);
  sim.regulatorResponse({ commands: [{ type: 'reroute', train: 'R 3106', route: ['rocca-sabato', 'valle-lauro'] }] });
  assert.ok(sim.S.events.some(e => e.kind === 'WARN' && /reroute ignored, line rocca-sabato has no routes against its direction in the interlocking/.test(e.text)), 'reroute without the routes it needs refused');
  console.log('network: a reroute that would need routes the interlockings do not have is refused with a clear message: ok');
}

// @test NET-9: the message-based reference onboard on a network: balise groups and RBC along the corridor of each train [YT-NET, S026-3.8]
{
  const ref = (d: ScenarioDef): ScenarioDef => ({ ...d, signalling: 'ETCS', onboard: 'reference' });
  const [{ def: loop }] = loadScenarios('scenarios/services/loop-reroute.json');
  for (const def of [branch, shuttle, loop]) {
    const a = run(ref(def)), b = run(ref(def));
    assert.equal(a.hash, b.hash, `${def.name}: deterministic`);
    for (const r of a.sim.trains) {
      const s = a.sim.summary(r);
      assert.ok(r.S.finished && s.overruns === 0 && s.interventions === 0, `${def.name} ${r.id}: ${JSON.stringify(s.checks.filter(c => !c.ok))}`);
      assert.ok(r.ob && r.ob.exchanges > 0 && r.ob.log.some(x => x.direction === 'RBC→onboard'), `${def.name} ${r.id}: the onboard talked with its RBC`);
      assert.equal(r.ob?.own, !!(r.cor.sigRef || r.legs[0].line !== 0), `${def.name} ${r.id}: own balise groups only off the main line`);
    }
    assert.equal(a.overlaps + a.opposed, 0, `${def.name}: track shared`);
  }
  console.log('reference onboard on the network: branch, shuttle and reroute on time, no intervention, the trains off the main line with balise groups and RBC along their corridor, deterministic: ok');
}

// @test NET-8: open data of a network: lines, stations of every line, positions on the common plan, blocks and connections [YT-NET, YT-BLOCK, YT-CONN]
{
  const dist = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) => Math.hypot((a.lat - b.lat) * 111195, (a.lon - b.lon) * 111195 * Math.cos(a.lat * Math.PI / 180));
  for (const def of [branch, shuttle]) {
    const r = resolveScenario(def), sim = new Simulation(r.line, r.train, r.scen, def);
    const T = trips(sim), st = new Map(feedStations(sim).map(x => [x.name, x]));
    assert.deepEqual([...st.keys()].sort(), ['Monte Clanio', 'Pietrarsa', 'Ponte Sabato', 'Rocca Sabato', 'San Felice Scalo', 'Valle Lauro'], 'every station of the network once');
    // the stops of every trip, placed along its corridor, fall on the stations of the network
    for (const t of T) for (const p of t.stops) assert.ok(dist(t.pos(p.s), st.get(p.name) as { lat: number; lon: number }) < 1, `${t.number} at ${p.name}: ${dist(t.pos(p.s), st.get(p.name) as { lat: number; lon: number }).toFixed(1)} m from the station`);
    const files = gtfsFiles(sim, DEFAULT_FEED_OPTIONS), routes = files['routes.txt'].trim().split('\r\n').length - 1;
    if (def === branch) assert.equal(routes, 2, 'routes: the main line and the through line Valle Lauro – Rocca Sabato');
    else {
      assert.equal(routes, 2, 'routes: the main line and the branch');
      assert.equal(files['trips.txt'].split('\r\n').filter(x => x.endsWith(',B1')).length, 3, 'three trips of block B1');
      assert.equal(files['transfers.txt'].trim().split('\r\n').length - 1, 1, 'one transfer');
      const nx = netexTimetable(sim, DEFAULT_FEED_OPTIONS);
      assert.equal((nx.match(/<ServiceJourneyInterchange /g) ?? []).length, 3, 'NeTEx: the connection and two stay-seated interchanges of the block');
      assert.equal((nx.match(/<StaySeated>true<\/StaySeated>/g) ?? []).length, 2);
    }
  }
  console.log('open data of the network: every station once, stops of every trip on their stations (< 1 m), routes per set of lines, block_id, transfers.txt and NeTEx interchanges: ok');
}

// @test NET-10: separate interlockings on a network: one per line, node routes with junction points, boundary consent, RBC along the corridors, reroute by the regulator [YT-NODE, YT-IXL-NET, YT-REROUTE, EU38-SCI-P, EU44-SCI-TDS, S026-3.8.3]
const [{ def: anello }] = loadScenarios('scenarios/services/loop-reroute.json');
const ixlScenarios: { name: string; def: ScenarioDef }[] = [
  { name: 'branch', def: branch },
  { name: 'shuttle', def: shuttle },
  { name: 'join', def: { ...branch, services: [...(branch.services ?? []), { id: 'R 2103', train: 'regional', stops: [
    { station: 'Monte Clanio', departure_s: 1200 },
    { station: 'San Felice Scalo', arrival_s: 1450, departure_s: 1480 },
    { station: 'Ponte Sabato', arrival_s: 1760, departure_s: 1790 },
    { station: 'Valle Lauro', arrival_s: 2050 } ] }] } },
  // three lines, both ways: two nodes where the link starts and ends, a crossing at Casale Sabato
  { name: 'loop', def: { ...anello, regulator: 'none', events: [], services: [
    { id: 'R 3101', train: 'regional', route: ['valle-lauro', 'ponte-pietrarsa', 'rocca-sabato'], stops: [
      { station: 'Valle Lauro', departure_s: 600 }, { station: 'Ponte Sabato', arrival_s: 880, departure_s: 910 }, { station: 'Casale Sabato', arrival_s: 1170, departure_s: 1200 },
      { station: 'Pietrarsa', arrival_s: 1460, departure_s: 1490 }, { station: 'Rocca Sabato', arrival_s: 1760 } ] },
    { id: 'R 3104', train: 'regional', route: ['rocca-sabato', 'ponte-pietrarsa', 'valle-lauro'], stops: [
      { station: 'Rocca Sabato', departure_s: 700 }, { station: 'Pietrarsa', arrival_s: 960, departure_s: 990 }, { station: 'Casale Sabato', arrival_s: 1250, departure_s: 1280 },
      { station: 'Ponte Sabato', arrival_s: 1540, departure_s: 1570 }, { station: 'Valle Lauro', arrival_s: 1830 } ] } ] } },
  // the regulator reroutes R 3101 around the blocked stretch of the main line, through the link and the node of Pietrarsa
  { name: 'reroute', def: anello },
];
const ixl = (d: ScenarioDef): ScenarioDef => ({ ...d, signalling: 'ETCS', onboard: 'reference', trackside: 'interlocking' });
/** A run with the interlocking trackside: at every step no section of any line occupied by two trains, the speed on track II of a node */
function runIxl(def: ScenarioDef) {
  const { line, train, scen } = resolveScenario(def);
  const sim = new Simulation(line, train, scen, def), drive = builtInDriver();
  const tr = sim.tr as NonNullable<Simulation['tr']>;
  const ids = tr.fields.map(f => [...f.tvps.keys()]);
  let shared = 0, vII = 0, onII = 0;
  const firstShared: string[] = [];
  while (!sim.done && sim.time < 6000) {
    drive(sim);
    sim.step(FIXED_DT);
    sim.sample();
    tr.fields.forEach((f, j) => {
      for (const id of ids[j]) {
        const by = f.occupiedBy(id);
        if (by.length > 1) { shared++; if (firstShared.length < 3) firstShared.push(`${id} at ${sim.time.toFixed(1)} s by ${by.join(', ')}`); }
      }
    });
    // a train on track II of a node station, between the junction and the points: no faster than the diverging speed
    for (const r of sim.trains) {
      if (!r.active || r.S.finished) continue;
      for (let j = 0; j < tr.fields.length; j++) {
        if (![...tr.fields[j].branchesOf(r.fieldIndex)].some(b => b.startsWith('II:'))) continue;
        const p = onLine(r.legs, j, r.S.s, r.TR.L);
        if (!p) continue;
        const near = sim.net.nodes.some(nd => { const D = directed(sim.net.lines[j], p.dir), x = D.st.find(z => z.name === nd.name); return x != null && Math.abs(p.head - x.s) < 300; });
        if (near) { onII++; vII = Math.max(vII, r.S.v * 3.6); }
      }
    }
  }
  const h = createHash('sha256');
  for (const r of sim.trains) h.update(JSON.stringify(r.S.rows));
  return { sim, shared, firstShared, vII, onII, hash: h.digest('hex').slice(0, 16) };
}
for (const { name, def } of ixlScenarios) {
  const a = runIxl(ixl(def)), b = runIxl(ixl(def));
  assert.equal(a.hash, b.hash, `${name}: deterministic`);
  for (const r of a.sim.trains) {
    const s = a.sim.summary(r);
    assert.ok(r.S.finished && s.overruns === 0 && s.interventions === 0, `${name} ${r.id}: ${JSON.stringify(s.checks.filter(c => !c.ok))}, finished ${r.S.finished} at ${r.S.s.toFixed(0)} m`);
    assert.ok(!r.S.events.some(e => /trailed|derail/.test(e.text)), `${name} ${r.id}: a point was trailed`);
  }
  assert.equal(a.shared, 0, `${name}: a section occupied by two trains (${a.firstShared.join('; ')})`);
  assert.ok(a.vII <= 61, `${name}: ${a.vII.toFixed(1)} km/h on track II of a node`);
  if (name === 'reroute') {
    const end = realised(a.sim, 'R 3101', 'Rocca Sabato').arrival_s as number;
    assert.ok(a.sim.S.events.some(e => /rerouted along valle-lauro, ponte-pietrarsa, rocca-sabato/.test(e.text)) && end < 2000, `reroute: R 3101 at Rocca Sabato at ${end.toFixed(0)} s`);
  }
    const panel = (a.sim.tr as NonNullable<Simulation['tr']>).panel as NonNullable<NonNullable<Simulation['tr']>['panel']>;
  const nodeRoutes = panel.routes.filter(x => /\/N\d+$/.test(x.id)).length, ixls = new Set(panel.routes.map(x => x.id.includes(':') ? x.id.split(':')[0] : 'main')).size;
  console.log(`${name} with the interlocking trackside: ${ixls} interlockings, ${nodeRoutes} node routes, every train on time without intervention, no section shared, at most ${a.vII.toFixed(0)} km/h on track II of a node (${a.onII} steps), deterministic (${a.hash}): ok`);
}
{
  // the movements through the node in the branch scenario: R 3101 into the branch, R 3102 out of it, the consent moving between the two interlockings
  const a = runIxl(ixl(branch));
  const msgs = a.sim.S.events.filter(e => /Consent of the node San Felice Scalo/.test(e.text));
  assert.ok(msgs.length >= 1 && msgs.some(e => /interlocking of rocca-sabato/.test(e.text)), 'the consent of the node went to the interlocking of the branch for R 3102');
  const arr = realised(a.sim, 'R 3102', 'San Felice Scalo'), dep = realised(a.sim, 'R 3101', 'San Felice Scalo');
  assert.ok((arr.arrival_s as number) > (dep.departure_s as number), 'R 3102 comes out of the branch after R 3101 went in');
  console.log(`node of San Felice Scalo: R 3101 into the branch at ${dep.departure_s?.toFixed(0)} s, the consent to the branch, R 3102 out of it at ${arr.arrival_s?.toFixed(0)} s: ok`);
}

// @test NET-12: a late train into the branch meets the train coming out of it: no wait for each other across the node [YT-IXL-NET, YT-CONSENT]
{
  // R 3101 late enough that R 3102 is already on the single track of the branch towards the node (300 s), or on the
  // single track of the main line beyond it (600 s): without the consent of the node going with the segment of the
  // branch next to it, and without the timed release of the overlap of the route in from the node, the two trains
  // wait for each other for ever
  const out: string[] = [];
  for (const late of [300, 600]) {
    const def: ScenarioDef = { ...branch, services: (branch.services ?? []).map(sv => sv.id !== 'R 3101' ? sv : { ...sv, stops: sv.stops.map(x => ({
      ...x, ...(x.arrival_s != null ? { arrival_s: x.arrival_s + late } : {}), ...(x.departure_s != null ? { departure_s: x.departure_s + late } : {}) })) }) };
    const a = runIxl(ixl(def));
    for (const r of a.sim.trains) {
      const s = a.sim.summary(r);
      assert.ok(r.S.finished && s.overruns === 0 && s.interventions === 0, `R 3101 ${late} s late: ${r.id} did not finish (${r.S.s.toFixed(0)} m)`);
    }
    assert.equal(a.shared, 0, `R 3101 ${late} s late: a section occupied by two trains (${a.firstShared.join('; ')})`);
    const arr = realised(a.sim, 'R 3101', 'Rocca Sabato').arrival_s as number, dep = realised(a.sim, 'R 3102', 'Valle Lauro').arrival_s as number;
    out.push(`${late} s late: R 3101 at Rocca Sabato ${arr.toFixed(0)} s, R 3102 at Valle Lauro ${dep.toFixed(0)} s`);
  }
  console.log(`late train into the branch against the train coming out: ${out.join('; ')}; no deadlock, no section shared: ok`);
}

// @test NET-11: the interlockings of a network as an external program give the same run [YT-IXL-NET]
{
  const lock = async (d: ScenarioDef, provider?: TracksideProvider) => {
    const r = resolveScenario(d), sim = new Simulation(r.line, r.train, r.scen, d);
    await runLockstep(sim, loadJsController('examples/ato.js'), { period: 0.2, ...(provider ? { trackside: provider } : {}) });
    return sim;
  };
  const all = (sim: Simulation) => createHash('sha256').update(sim.trains.map(r => sim.csv(r)).join('\n')).digest('hex').slice(0, 16);
  const out: string[] = [];
  // the branch, and the reroute: the corridor and the timetables of the rerouted train reach the trackside as commands
  for (const [name, def] of [['branch', branch], ['reroute', anello]] as const) {
    const ch = await openChannel<TracksideRequest, TracksideResponse>('exec:npx --no-install tsx examples/trackside/trackside_stdio.ts', 'the trackside');
    const e = await lock({ ...ixl(def), trackside: 'external' }, ch.call);
    await ch.close();
    const i = await lock(ixl(def));
    assert.ok(i.trains.every(r => r.S.finished), `${name} with the ATO: every train finished`);
    assert.equal(all(e), all(i), `${name}: the external trackside produced a run different from the in-process one`);
    out.push(`${name} ${all(e)}`);
  }
  console.log(`interlockings of the network via exec: runs identical to the in-process ones (${out.join(', ')}): ok`);
}

// @test NET-13: a network of two real imported lines meeting at Benevento: crossing, connection, determinism [YT-NET, YT-INFRA]
{
  assert.equal(readText('scenarios/services/benevento.json', 'utf8'), beneventoJson(), 'NET-13: scenarios/services/benevento.json is not up to date (npx tsx scripts/real-network.ts)');
  const [{ def }] = loadScenarios('scenarios/services/benevento.json');
  assert.deepEqual(validateScenario(def), [], 'NET-13: scenario');
  const once = async () => {
    const { line, train, scen } = resolveScenario(def);
    const sim = new Simulation(line, train, scen, def);
    await runLockstep(sim, loadJsController('examples/ato.js'), { period: 0.2, source: 'ato', maxTime: 9000 });
    return sim;
  };
  const sim = await once();
  assert.deepEqual(sim.net.nodes.map(n => n.name), ['Benevento'], 'NET-13: one node');
  const by = new Map(sim.trains.map(t => [t.id, t]));
  for (const [id, t] of by) {
    const r = t.realised;
    assert.ok(r.length > 1 && r[r.length - 1].arrival_s != null, `NET-13: ${id} did not reach its last stop`);
    assert.equal(sim.summary(t).interventions, 0, `NET-13: protection intervention on ${id}`);
  }
  const arr7101 = by.get('R 7101')!.realised.find(x => x.station === 'Benevento')!.arrival_s!;
  const dep7102 = by.get('R 7102')!.realised.find(x => x.station === 'Benevento')!.departure_s!;
  assert.ok(dep7102 >= arr7101 + 120 - 1, `NET-13: connection at Benevento not kept (${arr7101} → ${dep7102})`);
  // the controlled train and R 7102 cross at Benevento: R 7102, waiting at the exit signal, enters the single track to
  // Benevento Appia only after the controlled train has arrived
  const ctl = by.get('train')!.realised, back = by.get('R 7102')!.realised;
  const ctlArr = ctl.find(x => x.station === 'Benevento')!.arrival_s!, backAppia = back.find(x => x.station === 'Benevento Appia')!.arrival_s!;
  const ctlAppia = ctl.find(x => x.station === 'Benevento Appia')!.departure_s!;
  assert.ok(ctlAppia < dep7102 + 5 && backAppia > ctlArr, `NET-13: no crossing at Benevento (controlled train ${ctlAppia} → ${ctlArr}, R 7102 ${dep7102} → ${backAppia})`);
  const cross = { station: 'Benevento' };
  const fp = (x: Simulation) => createHash('sha256').update(JSON.stringify(x.trains.map(t => t.realised))).digest('hex').slice(0, 16);
  assert.equal(fp(await once()), fp(sim), 'NET-13: not deterministic');
  console.log(`real network Cancello – Benevento – Avellino: R 7101 at Benevento ${Math.round(arr7101)} s, R 7102 leaves ${Math.round(dep7102)} s, crossing at ${cross.station} (R 7102 at Benevento Appia ${Math.round(backAppia)} s, after the controlled train arrives at ${Math.round(ctlArr)} s), no interventions, deterministic (${fp(sim)}): ok`);
}

console.log('verify-network: all ok');
