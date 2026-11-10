/**
 * Phase checks of the multi-train work (phase 3d): line capacity and determinism of the whole chain.
 *
 *  1. Minimum headway, simplified UIC 406: the headway computed from the blocking times of one train (from the moment
 *     a follower would start braking for the signal at the entrance of a block section until the tail clears it)
 *     against the headway measured with two identical services, the smallest at which the second runs exactly as the
 *     first. With the automatic block, the internal ETCS supervision, the reference onboard and the interlocking.
 *  2. Capacity of a node, UIC 406 with two different trains on a network with the interlocking trackside: the
 *     headway computed from the blocking times of the sections the two trains share (the first train until it clears
 *     them, the second from the moment it would brake for the start of the first route that holds them) against the
 *     measured one, for a train that diverges into the branch followed by one that goes straight on, and for a train
 *     that comes out of the branch followed by one that joins the same line at the node.
 *  4. Time held by the signalling (docs/CAPACITY.md): zero for a train alone; for the second of two identical services
 *     zero above a threshold headway, never above the measured minimum headway, and not decreasing below it.
 *  5. Moving block (docs/MOVING_BLOCK.md): the minimum headway computed from the confirmed rear ends the RBC has for the
 *     first train and the permitted curve of the follower, against the measured one, and below the fixed block one.
 *  3. Determinism of everything together: trains in both directions, disruptions, interlocking trackside and
 *     regulator as external programs give the same run as in process.
 *   npx tsx scripts/verify-capacity.ts
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { FIXED_DT, Simulation, autoDriver, resolveScenario, runLockstep, toCorridor, type RegulatorRequest, type RegulatorResponse, type ScenarioDef, type ServiceDef } from '../src/core';
import type { TracksideRequest, TracksideResponse } from '../src/trackside';
import { loadScenarios, openChannel } from '../src/server/headless';
import { builtInDriver } from './lib/drive';

/** Start of the two services: the controlled train has left the line by then */
const T0 = 1000;
const stops = (t: number): ServiceDef['stops'] => [
  { station: 'Valle Lauro', departure_s: t }, { station: 'Ponte Sabato', arrival_s: t + 260, departure_s: t + 290 },
  { station: 'San Felice Scalo', arrival_s: t + 620, departure_s: t + 650 }, { station: 'Monte Clanio', arrival_s: t + 880 }];
/** Braking assumed for the approach time of the blocking times: service deceleration (m/s²) and reaction and brake build-up (s) */
const APPROACH = { decel: 0.5, reaction_s: 6 };

type Variant = 'BACC' | 'ETCS' | 'reference' | 'interlocking' | 'moving';
const conditions = (v: Variant): Partial<ScenarioDef> => v === 'BACC' ? { signalling: 'BACC' } : v === 'reference' ? { onboard: 'reference' } : v === 'interlocking' ? { onboard: 'reference', trackside: 'interlocking' } : v === 'moving' ? { onboard: 'reference', spacing: 'moving_block' } : {};
/** Margin of the moving block (m), the default */
const MB_MARGIN = 50;

/** Two services A and B, B h seconds after A (or A alone); positions of both at every step */
function pair(v: Variant, h: number | null) {
  const services: ServiceDef[] = [{ id: 'A', stops: stops(T0) }, ...(h != null ? [{ id: 'B', stops: stops(T0 + h) }] : [])];
  const def: ScenarioDef = { name: 'headway', line: 'valle-lauro', train: 'regional', signalling: 'ETCS', leader: { on: false }, services, ...conditions(v) };
  const { line, train, scen } = resolveScenario(def);
  const sim = new Simulation(line, train, scen, def), drive = builtInDriver();
  const a: number[] = [], b: number[] = [], traj: [number, number, number][] = [], rears: [number, number][] = [];
  while (!sim.done && sim.time < 4000) {
    drive(sim);
    sim.step(FIXED_DT);
    const A = sim.trains[1];
    a.push(A.S.s);
    if (A.active && !A.S.finished) traj.push([sim.time, A.S.s, A.S.v]);
    // the confirmed rear end the RBC has for A (message-based onboard), when it changes
    const c = A.ob?.rbc.confirmedRear(A.ob.engine, sim.time);
    if (c != null && A.active && !A.S.finished && (!rears.length || rears[rears.length - 1][1] !== c)) rears.push([sim.time, c]);
    if (sim.trains[2]) b.push(sim.trains[2].S.s);
  }
  for (const r of sim.trains) assert.ok(r.S.finished && sim.summary(r).overruns === 0, `${v} h=${h}: ${r.id} not finished or overrun`);
  return { sim, a, b, traj, rears, arr: sim.timetable()[1].stops[3].arrival_s as number };
}

/** Blocking times of the block sections from the run of one train; the largest is the minimum headway of identical trains */
function blockingTimes(v: Variant, one: ReturnType<typeof pair>) {
  const L = one.sim.L, len = one.sim.trains[1].TR.L;
  const tAt = (x: number) => { for (const [t, s] of one.traj) if (s >= x) return t; return Infinity; };
  const vAt = (x: number) => { for (const [, s, w] of one.traj) if (s >= x) return w; return 0; };
  const rows: { signal: string; from_m: number; to_m: number; approach_m: number; start: number; end: number; time: number }[] = [];
  for (let i = 0; i < L.sig.length; i++) {
    const s0 = L.sig[i].s, s1 = i + 1 < L.sig.length ? L.sig[i + 1].s : L.len;
    if (s0 < L.st[0].s || s0 > L.st[L.st.length - 1].s) continue;
    // approach: the follower must find the section clear where its braking for the entrance signal would begin
    let x = s0;
    for (let k = 0; k < 100; k++) {
      const w = vAt(x), nx = s0 - (w * w / (2 * APPROACH.decel) + w * APPROACH.reaction_s);
      if (Math.abs(nx - x) < 0.5) break;
      x = nx;
    }
    // with the automatic block the driver learns it only at the previous signal (caution aspect)
    if (v === 'BACC' && i > 0) x = Math.min(x, L.sig[i - 1].s);
    // clearing: the tail passes the exit signal (or the train leaves the line at the terminus)
    const start = tAt(Math.max(x, L.st[0].s)), end = Math.min(tAt(s1 + len), one.arr);
    rows.push({ signal: L.sig[i].id, from_m: s0, to_m: s1, approach_m: x, start, end, time: end - start });
  }
  return rows;
}

const hash = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

// @test CAP1: minimum headway measured against the blocking times, simplified UIC 406 [YT-CAP]
const table: string[] = [], sigTable: string[] = [];
for (const v of ['ETCS', 'BACC', 'reference', 'interlocking'] as Variant[]) {
  const one = pair(v, null);
  const rows = blockingTimes(v, one);
  const crit = rows.reduce((p, q) => (q.time > p.time ? q : p));
  const hc = crit.time;
  // B unimpeded: at every step it is where A was h seconds before; with it the time B spends held by the signalling
  const runs = new Map<number, { dev: number; sig: number }>();
  const measure = (h: number) => {
    if (runs.has(h)) return runs.get(h) as { dev: number; sig: number };
    const r = pair(v, h), k = Math.round(h / FIXED_DT);
    let m = 0;
    // past the end of A's run B is compared with where A stopped: a B slowed down arrives later and runs longer
    for (let j = k; j < r.b.length; j++) m = Math.max(m, Math.abs(r.b[j] - one.a[Math.min(j - k, one.a.length - 1)]));
    const x = { dev: m, sig: r.sim.summary(r.sim.trains[2]).signalling_constrained_s };
    runs.set(h, x);
    return x;
  };
  const deviation = (h: number) => measure(h).dev;
  const lo0 = Math.floor(hc * 0.85), hi0 = Math.ceil(hc * 1.1);
  let lo = lo0, hi = hi0;
  assert.ok(deviation(lo) > 1, `${v}: B is not impeded even at ${lo} s, far below the computed ${hc.toFixed(0)} s`);
  assert.ok(deviation(hi) < 1, `${v}: B is still impeded at ${hi} s, above the computed ${hc.toFixed(0)} s`);
  while (hi - lo > 1) { const m = Math.floor((lo + hi) / 2); if (deviation(m) < 1) hi = m; else lo = m; }
  const hm = hi, err = (hm - hc) / hc;
  assert.ok(Math.abs(err) <= 0.05, `${v}: measured headway ${hm} s, computed ${hc.toFixed(1)} s (${(err * 100).toFixed(1)} %)`);
  // @test CAP4: time held by the signalling, zero for a train alone and above a threshold headway that matches the measured one [YT-CAP, YT-SIG-TIME]
  // A alone: no time held by the signalling (with a message-based onboard, the radio cycle at departures)
  const alone = one.sim.summary(one.sim.trains[1]).signalling_constrained_s;
  assert.ok(alone <= (v === 'ETCS' || v === 'BACC' ? 0 : 1), `${v}: a train alone is held by the signalling for ${alone} s`);
  const held = (h: number) => measure(h).sig > alone + 0.5;
  let slo = lo0, shi = hi0;
  assert.ok(held(slo) && !held(shi), `${v}: time held by the signalling ${measure(slo).sig} s at ${slo} s, ${measure(shi).sig} s at ${shi} s`);
  while (shi - slo > 1) { const m = Math.floor((slo + shi) / 2); if (held(m)) slo = m; else shi = m; }
  const hs = shi;
  // held by the signalling means slowed down, so the threshold is never above the measured headway; it can be below it
  // when the driver brakes for a target before the supervision lowers the permitted speed
  assert.ok(hs <= hm + 1, `${v}: threshold of the time held by the signalling ${hs} s, above the measured headway ${hm} s`);
  const s20 = measure(hs - 20).sig, s60 = measure(hs - 60).sig;
  assert.ok(s60 >= s20 && s20 > alone + 0.5, `${v}: the time held by the signalling does not grow below the threshold (${s20} s at −20 s, ${s60} s at −60 s)`);
  sigTable.push(`${v.padEnd(12)} B held by the signalling ${measure(hm).sig} s at ${hm} s, ${s20} s at ${hs - 20} s, ${s60} s at ${hs - 60} s; zero from ${hs} s (measured headway ${hm} s, A alone ${alone} s)`);
  table.push(`${v.padEnd(12)} computed ${hc.toFixed(1)} s (section of signal ${crit.signal}, ${(crit.from_m / 1000).toFixed(3)}–${(crit.to_m / 1000).toFixed(3)} km), measured ${hm} s (${err >= 0 ? '+' : ''}${(err * 100).toFixed(1)} %), at most ${Math.floor(3600 / hc)} trains/h, ${Math.floor(0.75 * 3600 / hc)} within the 75 % of UIC 406`);
}
console.log('minimum headway of two regional trains, Valle Lauro line:\n  ' + table.join('\n  ') + '\n  : ok');
console.log('time held by the signalling of the second train:\n  ' + sigTable.join('\n  ') + '\n  : ok');

// @test CAP5: moving block, minimum headway measured against the one computed from the confirmed rear ends of the first train [YT-CAP, X2R5-MB-CRE, X2R5-MB-MARGIN]
{
  const one = pair('moving', null);
  // B, h seconds behind A, at x with speed w needs a clear distance before the end of authority, the margin behind the
  // rear end the RBC has for A: the first time A's confirmed rear end reaches x + braking + margin, less the time B is
  // there. Without block sections the braking is that of the permitted curve of the reference onboard towards the end
  // of authority, followed by the ATO: service deceleration of the train, T_brake_service + T_driver, no gradients
  const TR = one.sim.trains[1].TR, dec = TR.bSvc, react = Math.max(1, 1.5 * TR.tauB) + 4;
  let hc = 0, at = 0;
  for (const [tau, x, w] of one.traj) {
    if (tau >= one.arr) break;
    const need = x + w * w / (2 * dec) + w * react + MB_MARGIN;
    const r = one.rears.find(([, c]) => c >= need);
    if (!r || r[0] >= one.arr) continue;
    if (r[0] - tau > hc) { hc = r[0] - tau; at = x; }
  }
  const fixedHm = Number(/reference\s+computed [\d.]+ s \(section of signal \S+, [\d.–]+ km\), measured (\d+) s/.exec(table.join('\n'))?.[1]);
  const dev = (h: number) => { const r = pair('moving', h), k = Math.round(h / FIXED_DT); let m = 0; for (let j = k; j < r.b.length; j++) m = Math.max(m, Math.abs(r.b[j] - one.a[Math.min(j - k, one.a.length - 1)])); return m; };
  let lo = Math.floor(hc * 0.8), hi = Math.ceil(hc * 1.15);
  assert.ok(dev(lo) > 1 && dev(hi) < 1, `moving block: B impeded at ${hi} s or free at ${lo} s, computed ${hc.toFixed(1)} s`);
  while (hi - lo > 1) { const m = Math.floor((lo + hi) / 2); if (dev(m) < 1) hi = m; else lo = m; }
  const err = (hi - hc) / hc;
  assert.ok(Math.abs(err) <= 0.05, `moving block: measured headway ${hi} s, computed ${hc.toFixed(1)} s (${(err * 100).toFixed(1)} %)`);
  assert.ok(hi < fixedHm, `moving block: measured headway ${hi} s, not below the fixed block one with the same onboard (${fixedHm} s)`);
  console.log(`moving block (margin ${MB_MARGIN} m, reports every 6 s, braking ${dec} m/s² after ${react.toFixed(1)} s): computed ${hc.toFixed(1)} s (at ${(at / 1000).toFixed(3)} km), measured ${hi} s (${err >= 0 ? '+' : ''}${(err * 100).toFixed(1)} %), fixed block with the same onboard ${fixedHm} s: ok`);
}

// @test CAP3: capacity of a node with separate interlockings, UIC 406 with two different trains on the routes they share [YT-CAP, YT-IXL-NET]
{
  const T = 1000;
  const intoBranch = (t: number): ServiceDef => ({ id: 'A', train: 'regional', route: ['valle-lauro', 'rocca-sabato'], stops: [
    { station: 'Valle Lauro', departure_s: t }, { station: 'Ponte Sabato', arrival_s: t + 260, departure_s: t + 290 },
    { station: 'San Felice Scalo', arrival_s: t + 620, departure_s: t + 660 }, { station: 'Pietrarsa', arrival_s: t + 920, departure_s: t + 950 }, { station: 'Rocca Sabato', arrival_s: t + 1210 }] });
  const straight = (t: number): ServiceDef => ({ id: 'B', train: 'regional', stops: stops(t) });
  const outOfBranch = (t: number): ServiceDef => ({ id: 'A', train: 'regional', route: ['rocca-sabato', 'valle-lauro'], stops: [
    { station: 'Rocca Sabato', departure_s: t }, { station: 'Pietrarsa', arrival_s: t + 260, departure_s: t + 290 },
    { station: 'San Felice Scalo', arrival_s: t + 550, departure_s: t + 590 }, { station: 'Ponte Sabato', arrival_s: t + 900, departure_s: t + 930 }, { station: 'Valle Lauro', arrival_s: t + 1190 }] });
  const joining = (t: number): ServiceDef => ({ id: 'B', train: 'regional', stops: [
    { station: 'Monte Clanio', departure_s: t }, { station: 'San Felice Scalo', arrival_s: t + 250, departure_s: t + 280 },
    { station: 'Ponte Sabato', arrival_s: t + 560, departure_s: t + 590 }, { station: 'Valle Lauro', arrival_s: t + 850 }] });
  /** A run on the network with the interlocking trackside: trajectory, sections occupied and routes of the authority of each service */
  const runNet = (services: ServiceDef[]) => {
    const def: ScenarioDef = { name: 'node capacity', network: 'valle-lauro-rocca', line: 'valle-lauro', train: 'regional', signalling: 'ETCS', onboard: 'reference', trackside: 'interlocking', leader: { on: false }, services };
    const { line, train, scen } = resolveScenario(def);
    const sim = new Simulation(line, train, scen, def), drive = builtInDriver(), tr = sim.tr as NonNullable<Simulation['tr']>;
    const traj = new Map<string, [number, number, number][]>(), occ = new Map<string, Map<string, number>>(), used = new Map<string, Set<string>>();
    while (!sim.done && sim.time < 5000) {
      drive(sim);
      sim.step(FIXED_DT);
      for (const r of sim.trains.slice(1)) {
        if (!r.active || r.S.finished) continue;
        if (!traj.has(r.id)) { traj.set(r.id, []); occ.set(r.id, new Map()); used.set(r.id, new Set()); }
        (traj.get(r.id) as [number, number, number][]).push([sim.time, r.S.s, r.S.v]);
        const o = occ.get(r.id) as Map<string, number>;
        for (const f of tr.fields) for (const id of f.tvps.keys()) if (f.occupiedBy(id).includes(r.fieldIndex)) o.set(id, sim.time);
        for (const id of tr.panel?.sessions?.find(x => x.engine === r.ob?.engine)?.routes ?? []) (used.get(r.id) as Set<string>).add(id);
      }
    }
    for (const r of sim.trains) assert.ok(r.S.finished && sim.summary(r).overruns === 0 && sim.summary(r).interventions === 0, `node capacity: ${r.id} not finished or protection involved`);
    return { sim, traj, occ, used };
  };
  /**
   * Blocking times of the sections the two trains share: A holds a section until it has left it; B needs it from the
   * point where it would start braking for the start of the first route of its authority that holds it (path or
   * overlap). The largest difference is the minimum headway between the two departures. The two tracks of a station
   * count as separate sections: the second train takes the free one, but on track II it runs at the diverging speed
   */
  const computeNode = (A: ReturnType<typeof runNet>, B: ReturnType<typeof runNet>) => {
    const tB = B.traj.get('B') as [number, number, number][], rB = B.sim.trains.find(x => x.id === 'B') as Simulation['trains'][0], tr = B.sim.tr as NonNullable<Simulation['tr']>;
    const tAt = (x: number) => { for (const [t, s] of tB) if (s >= x) return t; return tB[0][0]; };
    const vAt = (x: number) => { for (const [, s, v] of tB) if (s >= x) return v; return 0; };
    const routes = new Map([tr.cfg, ...(tr.cfg.network?.interlockings ?? [])].flatMap((c, j) => c.routes.map(r => [r.id, { r, j, len: c.line.length_m }] as const)));
    const need = new Map<string, number>();
    for (const id of B.used.get('B') as Set<string>) {
      const x = routes.get(id);
      if (!x) continue;
      const d = x.r.dir ?? 1, c = toCorridor(rB.legs, x.j, d, d > 0 ? x.r.start_m : x.len - x.r.start_m);
      if (c == null) continue;
      let p = c;
      for (let k = 0; k < 100; k++) { const w = vAt(p), np = c - (w * w / (2 * APPROACH.decel) + w * APPROACH.reaction_s); if (Math.abs(np - p) < 0.5) break; p = np; }
      for (const s of [...x.r.tvps, ...x.r.tvps_overlap]) need.set(s, Math.min(need.get(s) ?? Infinity, tAt(p)));
    }
    const rows = [...(A.occ.get('A') as Map<string, number>)].filter(([id]) => need.has(id)).map(([id, end]) => ({ id, h: end + FIXED_DT - (need.get(id) as number) }));
    return rows.reduce((p, q) => (q.h > p.h ? q : p));
  };
  const out: string[] = [];
  for (const [name, mkA, mkB] of [['into the branch, then straight on', intoBranch, straight], ['out of the branch, then joining at the node', outOfBranch, joining]] as const) {
    const A = runNet([mkA(T)]), B = runNet([mkB(T)]);
    const crit = computeNode(A, B), hc = crit.h;
    const ref = B.traj.get('B') as [number, number, number][];
    // B unimpeded: step by step where it is when it runs alone
    const deviation = (h: number) => {
      const b = runNet([mkA(T), mkB(T + h)]).traj.get('B') as [number, number, number][];
      let m = 0;
      for (let i = 0; i < b.length; i++) m = Math.max(m, Math.abs(b[i][1] - ref[Math.min(i, ref.length - 1)][1]));
      return m;
    };
    let lo = Math.floor(hc * 0.95), hi = Math.ceil(hc * 1.05);
    assert.ok(deviation(lo) > 1, `${name}: B is not impeded even at ${lo} s, below the computed ${hc.toFixed(0)} s`);
    assert.ok(deviation(hi) < 1, `${name}: B is still impeded at ${hi} s, above the computed ${hc.toFixed(0)} s`);
    // the measured headway itself, to the second, only on request (CAPACITY_SEARCH=1): it takes a run per step
    if (!process.env.CAPACITY_SEARCH) { out.push(`${name}: computed ${hc.toFixed(1)} s (section ${crit.id}), measured within ${lo}–${hi} s (±5 %)`); continue; }
    while (hi - lo > 1) { const m = Math.floor((lo + hi) / 2); if (deviation(m) < 1) hi = m; else lo = m; }
    const err = (hi - hc) / hc;
    out.push(`${name}: computed ${hc.toFixed(1)} s (section ${crit.id}), measured ${hi} s (${err >= 0 ? '+' : ''}${(err * 100).toFixed(1)} %)`);
  }
  console.log('capacity of the node of San Felice Scalo with separate interlockings:\n  ' + out.join('\n  ') + '\n  : ok');
}

// @test CAP2: trains in both directions, disruptions, external trackside and regulator: the same run as in process [YT-REG, YT-CONSENT, EU-SCI-RBC]
{
  const [{ def: base }] = loadScenarios('scenarios/services/crossing-interlocking.json');
  const def: ScenarioDef = {
    ...base, regulator: 'reference',
    events: [
      { type: 'line_blocked', from_m: 7000, to_m: 7400, when: { t: 200 }, duration_s: 400 },
      { type: 'train_stopped', train: 'R 2101', when: { t: 450 }, duration_s: 120 },
      { type: 'traction_reduced', train: 'R 2101', factor: 0.6, when: { t: 700 } },
    ],
  };
  const all = (sim: Simulation) => hash(sim.trains.map(r => sim.csv(r)).join('\n'));
  const run = async (d: ScenarioDef, trackside?: (q: TracksideRequest) => Promise<TracksideResponse>, regulator?: (q: RegulatorRequest) => Promise<RegulatorResponse>) => {
    const { line, train, scen } = resolveScenario(d);
    const sim = new Simulation(line, train, scen, d), mem = {};
    await runLockstep(sim, o => autoDriver(o, mem), { period: 0.2, maxTime: 4000, ...(trackside ? { trackside } : {}), ...(regulator ? { regulator } : {}) });
    return sim;
  };
  const i1 = await run(def), i2 = await run(def);
  for (const r of i1.trains) assert.ok(r.S.finished && i1.summary(r).overruns === 0 && i1.summary(r).interventions === 0, `${r.id}: not finished or protection involved`);
  assert.equal(all(i1), all(i2), 'two equal runs differ');
  const tr = await openChannel<TracksideRequest, TracksideResponse>('exec:npx --no-install tsx examples/trackside/trackside_stdio.ts', 'the trackside');
  const rg = await openChannel<RegulatorRequest, RegulatorResponse>('exec:npx --no-install tsx examples/regulator/regulator_stdio.ts', 'the regulator');
  const e = await run({ ...def, trackside: 'external', regulator: 'external' }, tr.call, rg.call);
  await tr.close(); await rg.close();
  assert.equal(all(e), all(i1), 'external trackside and regulator: a run different from the in-process one');
  const decisions = i1.S.events.filter(x => /^Regulator: /.test(x.text)).length;
  console.log(`both directions, line blocked, broken and slowed train, regulator: deterministic, identical with trackside and regulator as external programs (${all(i1)}, ${decisions} decisions logged): ok`);
}

console.log('verify-capacity: all ok');
