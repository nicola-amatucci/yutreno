/**
 * The exchanges of the engine with the traffic regulator (phase 8, R1): the request of a cycle (the trains with
 * their plan, current and realised timetable, position and delay, the disruptions in force, the network) and the
 * response, whose decisions `Simulation.regulatorCommand` applies (docs/REGULATOR.md, docs/design/regulator.md).
 * `Simulation` keeps `regulatorDue`, `regulatorRequest` and `regulatorResponse` as its methods.
 */
import { FIXED_DT } from './dynamics';
import { describeEvent } from './scenario';
import type { RegulatorState, Simulation, TrainRun } from './simulation';
import * as tfc from './traffic';
import type { RegulatorRequest, RegulatorResponse, RegulatorStop, RegulatorTrain } from './types';

/** True when an external regulator must receive the request of the next cycle before `step()` */
export function regulatorDue(sim: Simulation): boolean {
  const reg = sim.reg;
  return !!reg && reg.kind === 'external' && !sim.done && sim.time + FIXED_DT > reg.t1 + 1e-9;
}

/** Request for the regulator: the trains with their plan, current timetable and realised one, the disruptions in force */
export function regulatorRequest(sim: Simulation): RegulatorRequest {
  const reg = sim.reg as RegulatorState, tr = sim.tr, len = sim.L.len;
  const r1 = (x: number | null | undefined) => (x == null || !isFinite(x) ? null : +x.toFixed(1));
  const trains: RegulatorTrain[] = sim.trains.map(r => {
    const S = r.S, next = r.stations[S.nextSt];
    const stops: RegulatorStop[] = r.plan.map(p => {
      const i = r.stations.findIndex(x => x.name === p.name), st = i >= 0 ? r.stations[i] : null;
      const re = r.realised.find(x => x.station === p.name);
      return {
        station: p.name, s_m: r.dir > 0 ? p.s : len - p.s, planned_arrival_s: p.arr, planned_departure_s: p.dep,
        arrival_s: st ? st.arr : null, departure_s: st ? st.dep : null, min_dwell_s: i >= 0 ? r.dwells[i] : 0,
        track: r.tracks.get(p.name) ?? null, skipped: !st,
        realised_arrival_s: r1(re?.arrival_s), realised_departure_s: r1(re?.departure_s),
      };
    });
    let delay: number | null = null;
    for (let k = r.realised.length - 1; k >= 0 && delay == null; k--) {
      const re = r.realised[k], p = r.plan.find(x => x.name === re.station);
      if (!p) continue;
      if (re.departure_s != null && p.dep != null) delay = re.departure_s - p.dep;
      else if (re.arrival_s != null && p.arr != null) delay = re.arrival_s - p.arr;
    }
    let track: 'I' | 'II' | null = null;
    if (tr && r.active && !S.finished) {
      const idx = r === sim.train ? 0 : r.fieldIndex, br = [...tr.field.branchesOf(idx)];
      // the field records the diverging branches; inside a station otherwise the train is on track I
      if (br.some(b => b.startsWith('II:'))) track = 'II';
      else if (sim.L.st.some(x => Math.abs(sim.headLine(r) - x.s) < 400)) track = 'I';
    }
    const broken = sim.time < r.heldUntil;
    const net = sim.networked ? regulatorNet(sim, r) : null;
    if (net) stops.forEach((x, k) => { x.s_m = net.stopS[k]; x.line = net.stopLine[k]; });
    return {
      id: r.id, engine: r.ob ? r.ob.engine : null, category: r.TR.name, dir: r.dir, active: r.active, finished: S.finished,
      s_m: +(net ? net.s : sim.headLine(r)).toFixed(1), v_kmh: +(S.v * 3.6).toFixed(1), at_station: S.doors && next ? next.name : null,
      next_station: next ? next.name : null, delay_s: r1(delay), track_now: track,
      broken, broken_until_s: broken && isFinite(r.heldUntil) ? r1(r.heldUntil) : null,
      traction_factor: r.tractionFactor, brake_factor: r.brakeFactor, priority: r.priority, stops,
      ...(r.cancelled ? { cancelled: r.cancelled } : {}),
      ...(net ? { route: net.route, position: net.position } : {}),
      ...(net ? { dir: net.dir } : {}),
    };
  });
  const disruptions = sim.scenarioEvents.filter(e => e.phase === 'active').map(e => {
    const d = e.def, t0 = e.tFired as number;
    const until = d.type === 'train_stopped' ? (isFinite(sim.target(d).heldUntil) ? sim.target(d).heldUntil : null) : d.duration_s != null ? t0 + d.duration_s : null;
    return {
      id: e.i, type: d.type, ...(d.train ? { train: d.train } : {}), ...(d.from_m != null ? { from_m: d.from_m } : {}), ...(d.to_m != null ? { to_m: d.to_m } : {}),
      ...(d.element ? { element: d.element } : {}), since_s: r1(t0) as number, until_s: r1(until), text: describeEvent(d),
    };
  });
  const req: RegulatorRequest = { type: 'regulator', version: 1, start: reg.exchanges === 0, t: +sim.time.toFixed(6), trains, disruptions };
  if (sim.connections.length) req.connections = sim.connections.map(c => ({ station: c.station, from: c.from.id, to: c.to.id, transfer_s: c.transfer, max_wait_s: c.maxWait, outcome: c.outcome }));
  if (tr?.panel) req.routes = tr.panel.routes.map(x => ({ id: x.id, name: x.name, state: x.state }));
  if (req.start) {
    req.configuration = {
      line: sim.L.def.name, length_m: len, stations: sim.L.st.map(x => ({ name: x.name, s_m: x.s })), signalling: sim.scen.sig,
      trackside: sim.scen.sig === 'ETCS' ? sim.scen.trackside ?? 'simple' : 'simple', conflict_rule: sim.scenario?.conflict_rule ?? 'timetable',
      ...(tr ? { routes: tr.cfg.routes.filter(x => !x.automatic).map(x => ({ id: x.id, name: x.name, station: x.station, station_name: x.station == null ? null : sim.L.st[x.station]?.name ?? null, type: x.type, branch_start: x.branch_start, branch_end: x.branch_end })) } : {}),
      ...(sim.networked ? { network: { name: sim.net.name, lines: sim.net.lines.map(n => ({ id: n.id, name: n.L.def.name, length_m: n.L.len, stations: n.L.st.map(x => ({ name: x.name, s_m: x.s })) })) } } : {}),
    };
  }
  return req;
}

/**
 * A train on a network as the regulator sees it: on the main line when its route uses it (head projected there,
 * main-line direction), otherwise on its own line; the stops in the chainages of their line
 */
function regulatorNet(sim: Simulation, r: TrainRun) {
  const lines = sim.net.lines, mainLeg = r.legs.find(g => g.line === 0), len = sim.L.len;
  const on = (j: number, dir: 1 | -1, d: number) => (dir > 0 ? d : lines[j].L.len - d);
  const route: string[] = [];
  for (const g of r.legs) if (route[route.length - 1] !== lines[g.line].id) route.push(lines[g.line].id);
  let s: number, dir: 1 | -1;
  if (mainLeg) { const h = tfc.headOn(sim, r, 0, mainLeg.dir) as number; s = mainLeg.dir > 0 ? h : len - h; dir = mainLeg.dir; }
  else { const g = r.legs[0]; s = on(g.line, g.dir, g.d0 + (r.S.s - g.c0)); dir = g.dir; }
  // the line the head is on now
  const cur = r.legs.find(g => r.S.s >= g.lo && r.S.s <= g.hi) ?? r.legs[0];
  const position = r.active && !r.S.finished ? { line: lines[cur.line].id, s_m: +on(cur.line, cur.dir, cur.d0 + (r.S.s - cur.c0)).toFixed(1) } : null;
  const stopS: number[] = [], stopLine: string[] = [];
  for (const p of r.plan) {
    // the leg of the stop: the main line when the train stops there on it
    const legs = r.legs.filter(g => p.s >= g.lo - 1e-6 && p.s <= g.hi + 1e-6);
    const g = legs.find(x => x.line === 0) ?? legs[0] ?? r.legs[0];
    stopS.push(+on(g.line, g.dir, g.d0 + (p.s - g.c0)).toFixed(1)); stopLine.push(lines[g.line].id);
  }
  return { s, dir, route, position, stopS, stopLine };
}

/** Receives the decisions of the regulator and applies them; a command that cannot be applied is logged and skipped */
export function regulatorResponse(sim: Simulation, r: RegulatorResponse): void {
  const reg = sim.reg;
  if (!reg) throw new Error('the run has no regulator');
  if (!r || !Array.isArray(r.commands)) throw new Error('invalid regulator response at t = ' + sim.time.toFixed(3) + ' s: commands is required');
  reg.t1 = sim.time + reg.period; reg.exchanges++;
  for (const text of r.log ?? []) sim.event('INFO', 'Regulator: ' + text);
  for (const c of r.commands) {
    const why = sim.regulatorCommand(c);
    if (why) sim.event('WARN', `Regulator: ${c && (c as { type?: string }).type} ignored, ${why}`);
  }
}
