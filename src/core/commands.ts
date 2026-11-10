/**
 * What changes a run while it runs (phase 8, R1): the events of the scenario at their time or position (faults,
 * restrictions, messages, breakdowns, blocked stretches, control centre commands, commands of the dispatcher), the
 * decisions of the regulator and the commands of the dispatcher, which share `regulatorCommand`, and the reroute of
 * a train (docs/SCENARIOS.md, docs/REGULATOR.md, docs/CONTROL_ROOM.md). `Simulation` keeps `dispatch`,
 * `regulatorCommand` and the two ticks it calls in its step.
 */
import { compileCorridor, directed, planItinerary, refreshCorridorLimits } from './network';
import { describeEvent, isAnnounced, mergeLimits, type ScenarioEventDef } from './scenario';
import { Rbc, buildBaliseGroups } from './simple-rbc';
import type { OnboardState, Simulation, TrainRun } from './simulation';
import * as obx from './onboard-bridge';
import * as tfc from './traffic';
import * as tsx from './trackside-bridge';
import { SERVICE_LEAD, moveKey, type NodeClaim } from './traffic';
import type { DispatchCommand, RegulatorCommand, Station } from './types';
import type { OperatorCommand } from '../trackside';

/** Fires and closes the scenario events; called at every step */
export function scenarioTick(sim: Simulation): void {
  const S = sim.S;
  for (const e of sim.scenarioEvents) {
    if (e.phase === 'pending') {
      const q = e.def.when || {}, who = target(sim, e.def);
      // the time of the run: it goes on after the controlled train has arrived, while services still run
      if (e.def.type === 'dispatch') continue;  // between the steps, see dispatchTick
      if ((q.t == null || sim.time + 1e-9 >= q.t) && (q.pos == null || (who.active && who.S.s >= q.pos))) {
        e.phase = 'active';
        e.tFired = sim.time;
        applyFault(sim, e.def, true);
        // a command is given once; the loss of the RBC–RBC link, with a duration, ends with the link coming back
        if (e.def.type === 'message' || e.def.type === 'rbc_emergency_stop' || (e.def.type === 'operator_command' && !(e.def.command?.type === 'rbc_link' && e.def.duration_s != null))) e.phase = 'done';
      }
    } else if (e.phase === 'active' && e.def.duration_s != null && sim.time + 1e-9 >= (e.tFired as number) + e.def.duration_s) {
      e.phase = 'done';
      applyFault(sim, e.def, false);
    }
  }
  const f = sim.faults;
  if (!sim.ob && !f.radioOk && !f.radioBrake && S.t - f.radioLostAt >= f.radioTimeout) {
    f.radioBrake = true;
    S.radioBrakes++;
    sim.event('WARN', 'No message from the RBC for ' + Math.round(f.radioTimeout) + ' s: ETCS commands the service brake');
  }
}

/**
 * Commands of the dispatcher written in the scenario (`dispatch` events): given at the end of the step that reaches
 * their time, where a command given from the page or a program at that time falls, before the controllers see the
 * new state. So a run repeated from `dispatchedEvents(sim.dispatched)` is the run in which they were given live
 */
export function dispatchTick(sim: Simulation): void {
  for (const e of sim.scenarioEvents) {
    if (e.phase !== 'pending' || e.def.type !== 'dispatch' || sim.time + 1e-9 < (e.def.when?.t ?? 0)) continue;
    e.phase = 'done';
    e.tFired = sim.time;
    if (e.def.dispatch) dispatch(sim, e.def.dispatch);
  }
}

/** Train an event concerns: the service named in `train`, or the controlled train (internal, also called by regulator-bridge.ts) */
export function target(sim: Simulation, d: ScenarioEventDef): TrainRun {
  return (d.train && sim.trains.find(r => r.id === d.train)) || sim.train;
}

function applyFault(sim: Simulation, d: ScenarioEventDef, on: boolean): void {
  const f = sim.faults, hid = !isAnnounced(d), etcs = sim.scen.sig === 'ETCS';
  const zone = (list: [number, number, number][], v: number) => {
    if (on) list.push([d.from_m as number, d.to_m as number, v]);
    else { const i = list.findIndex(z => z[0] === d.from_m && z[1] === d.to_m && z[2] === v); if (i >= 0) list.splice(i, 1); }
  };
  switch (d.type) {
    case 'radio_loss':
      if (!etcs) { if (on) sim.event('FAULT', 'Radio failure: with the automatic block running is not affected', hid); return; }
      // several RBCs: the radio link with one RBC only
      if (d.rbc != null) { f.radioRbc = on ? d.rbc : undefined; sim.event(on ? 'FAULT' : 'INFO', on ? `Radio link with RBC ${d.rbc} lost` : `Radio link with RBC ${d.rbc} restored`, hid); return; }
      // the radio of one train only (message-based onboard): its messages are lost in both directions
      if (d.train) { const r = target(sim, d); r.radioLost = on; sim.event(on ? 'FAULT' : 'INFO', `Train ${d.train}: radio link with the RBC ${on ? 'lost' : 'restored'}`, hid, r); return; }
      if (on) { f.radioOk = false; f.radioLostAt = sim.S.t; f.radioTimeout = d.timeout_s ?? 20; f.radioBrake = false; sim.event('FAULT', 'Radio link with the RBC lost: the movement authority is no longer updated', hid); }
      else { f.radioOk = true; if (f.radioBrake) { f.radioBrake = false; } sim.event('INFO', 'Radio link with the RBC restored', hid); }
      return;
    case 'speed_restriction':
      zone(f.tsr, d.v_kmh as number);
      if (sim.tr) sim.tr.pendingCmd.push(on ? { type: 'speed_restriction', id: 'scenario-' + d.from_m + '-' + d.to_m, from_m: d.from_m as number, to_m: d.to_m as number, v_kmh: d.v_kmh as number } : { type: 'revoke_speed_restriction', id: 'scenario-' + d.from_m + '-' + d.to_m });
      sim.L.lim = mergeLimits(sim.baseLim, f.tsr);
      if (sim.Lr) { const len = sim.L.len; sim.Lr.lim = mergeLimits(sim.baseLimR, f.tsr.map(z => [len - z[1], len - z[0], z[2]] as [number, number, number])); }
      for (const r of sim.trains) refreshCorridorLimits(sim.net, r.cor);
      sim.event('FAULT', on ? describeEvent(d) : describeEvent(d) + ' revoked', hid);
      return;
    case 'low_adhesion':
      zone(f.adh, d.mu as number);
      sim.event('FAULT', on ? describeEvent(d) : 'End of the low-adhesion zone', hid);
      return;
    case 'brake_degraded': {
      const r = target(sim, d);
      r.brakeFactor = on ? (d.factor as number) : 1;
      if (r === sim.train) f.brake = r.brakeFactor;
      sim.event('FAULT', on ? describeEvent(d) : 'Brake fully effective again', hid, r);
      return;
    }
    case 'traction_reduced': {
      const r = target(sim, d);
      r.tractionFactor = on ? (d.factor as number) : 1;
      if (r === sim.train) f.traction = r.tractionFactor;
      sim.event('FAULT', on ? describeEvent(d) : 'Full traction again', hid, r);
      return;
    }
    case 'odometry_drift': {
      // the odometry the engine sends to a message-based onboard, not the true position of the train
      const r = target(sim, d);
      if (!r.ob) { if (on) sim.event('FAULT', 'Odometry drift: only a message-based onboard reads the odometry, no effect', hid, r); return; }
      obx.setOdometerDrift(r.ob, r.S.s, on ? (d.slope as number) : 0);
      sim.event('FAULT', on ? describeEvent(d) : (d.train ? `Train ${d.train}` : 'The train') + `: the odometer no longer drifts (error kept: ${r.ob.odo.err.toFixed(1)} m)`, hid, r);
      return;
    }
    case 'integrity_loss': {
      // what the train interface tells a message-based onboard (an external source of integrity, Subset-026 §3.6.5.2)
      const r = target(sim, d);
      r.integrityLost = on;
      sim.event('FAULT', on ? describeEvent(d) : (d.train ? `Train ${d.train}` : 'The train') + ': train integrity confirmed again', hid, r);
      return;
    }
    case 'train_stopped': {
      const r = target(sim, d);
      r.heldUntil = on ? (d.duration_s != null ? sim.time + d.duration_s : Infinity) : -Infinity;
      sim.event('FAULT', on ? describeEvent(d) : 'The train can move again', hid, r);
      return;
    }
    case 'line_blocked': {
      const a = d.from_m as number, b = d.to_m as number;
      if (on) sim.blocks.push([a, b]); else { const i = sim.blocks.findIndex(z => z[0] === a && z[1] === b); if (i >= 0) sim.blocks.splice(i, 1); }
      // with the interlocking trackside the sections of the stretch are reported disturbed: no route through them
      if (sim.tr) for (const s of sim.tr.cfg.tvps) if (s.to_m > a && s.from_m < b) sim.tr.field.tvpsFault(s.id, on);
      sim.event('FAULT', on ? describeEvent(d) : `Line open again from ${(a / 1000).toFixed(3)} to ${(b / 1000).toFixed(3)} km`, hid);
      return;
    }
    case 'leader_stopped': {
      // the train ahead is a service train: it stops as a train broken down, with the full service brake
      if (!on) return;
      const r = sim.leader;
      if (!r || !r.active || r.S.finished) { sim.event('FAULT', 'The train ahead stops, but it has already left the line', hid); return; }
      r.heldUntil = sim.time + (d.duration_s ?? 120);
      sim.event('FAULT', describeEvent(d) + ' at km ' + (sim.headLine(r) / 1000).toFixed(3), hid);
      return;
    }
    case 'rbc_emergency_stop':
      sim.event('FAULT', etcs ? 'Emergency stop message from the RBC' : 'Immediate stop order from the signaller', hid);
      // from the control centre to the RBC of the trackside component: as with the simple RBC, the order is a single
      // message 16, so the revocation follows at the next cycle and the onboard resumes at standstill (a held stop
      // uses operator_command)
      if (sim.tr) { sim.tr.pendingCmd.push({ type: 'emergency_stop' }); sim.tr.nextCmd.push({ type: 'revoke_emergency_stop' }); }
      else if (sim.ob) sim.ob.rbc.stopOrder = true;  // the RBC sends message 16: the onboard brakes
      else sim.emergency(etcs ? 'RBC order' : 'stop order');
      return;
    case 'message':
      sim.event('INFO', 'Message: ' + d.text, hid);
      return;
    case 'point_failure':
    case 'tvps_failure': {
      if (!sim.tr) { if (on) sim.event('FAULT', describeEvent(d) + ': no effect without the interlocking trackside', hid); return; }
      const tr = sim.tr, el = d.element as string;
      const ok = tr.fields.some(f => d.type === 'point_failure' ? f.pointFault(el, on ? (d.mode ?? 'blocked') : 'none') : f.tvpsFault(el, on));
      sim.event('FAULT', ok ? (on ? describeEvent(d) : describeEvent(d) + ': repaired') : 'Unknown element: ' + d.element, hid);
      return;
    }
    case 'operator_command':
      if (!on) { if (sim.tr && d.command?.type === 'rbc_link') sim.tr.pendingCmd.push({ type: 'rbc_link', up: true }); return; }
      if (!sim.tr) { sim.event('INFO', describeEvent(d) + ': no effect without the interlocking trackside', hid); return; }
      sim.tr.pendingCmd.push(d.command as unknown as OperatorCommand);
      sim.event('INFO', describeEvent(d), hid);
      return;
  }
}

/** Reroute of a train not yet appeared: new itinerary and corridor, the stops not on the new lines removed */
function reroute(sim: Simulation, run: TrainRun, route: string[]): string | null {
  if (!sim.networked) return 'a reroute needs a network';
  if (run.driver === 'controlled') return 'the controlled train runs on the main line';
  if (run.active) return `${run.id} is already on the line`;
  if (!Array.isArray(route) || !route.length) return 'the route is a list of line ids';
  // the itinerary from the origin to the destination along the new lines; the stops kept are those on it
  const o = run.stations[0], d = run.stations[run.stations.length - 1];
  let it;
  try { it = planItinerary(sim.net, [o.name, d.name], route, `reroute of ${run.id}`); } catch (e) { return (e as Error).message; }
  const passes = compileCorridor(sim.net, it).line.st;
  const onRoute = (name: string) => passes.some(x => x.name === name);
  const keep = run.stations.filter(x => onRoute(x.name));
  try { it = planItinerary(sim.net, keep.map(x => x.name), route, `reroute of ${run.id}`); } catch (e) { return (e as Error).message; }
  if (sim.tr) {
    // the interlockings have the node routes and the reverse routes generated at the start: the new itinerary must find them
    for (const g of it) if (g.dir < 0 && !sim.ixlReverse[g.line]) return `line ${sim.net.lines[g.line].id} has no routes against its direction in the interlocking`;
    for (const m of tsx.nodeMoves(sim, it)) if (!sim.ixlMoves.has(moveKey(m))) return `no node routes at ${m.node} from ${m.from} to ${m.to} in the interlockings`;
  }
  for (const g of it) {
    if (g.line === 0 && g.dir < 0 && !sim.Lr) sim.baseLimR = directed(sim.net.lines[0], -1).lim.map(l => [l[0], l[1], l[2]] as [number, number, number]);
    sim.dirsOf[g.line].add(g.dir);
    if (sim.dirsOf[g.line].size > 1 && !sim.orients[g.line].length) sim.orients[g.line] = sim.net.lines[g.line].L.st.slice(1).map(() => 0);
  }
  const cor = compileCorridor(sim.net, it);
  const dwells = run.stations.map((x, i) => [x, run.dwells[i]] as const).filter(([x]) => onRoute(x.name));
  run.stations.splice(0, run.stations.length, ...keep.map(x => ({ ...x, s: (cor.line.st.find(y => y.name === x.name) as Station).s })));
  run.dwells.splice(0, run.dwells.length, ...dwells.map(([, d]) => d));
  for (const p of run.plan) { const y = cor.line.st.find(z => z.name === p.name); if (y) p.s = y.s; }
  run.line = cor.line; run.legs = cor.legs; run.cor = cor;
  run.itin = it;
  // a message-based onboard gets balise groups and an RBC along the new corridor
  if (run.ob) {
    run.ob.own = true; run.ob.bgs = buildBaliseGroups(cor.line); run.ob.rbc = new Rbc(cor.line, run.ob.bgs);
    run.ob.baseLim = cor.line.lim.map(l => [l[0], l[1], l[2]] as [number, number, number]);
  }
  run.dir = it[0].dir;
  sim.place(run.stations[0].s, 0, run);
  run.S.trace = [[run.stations[0].s, 0]];
  if (sim.tr) {
    // the trackside learns the new corridor and the timetables of the lines (empty on the lines it no longer runs along)
    const tr = sim.tr, ob = run.ob as OnboardState;
    tr.pendingCmd.push({ type: 'corridor', engine: ob.engine, corridor: tsx.corridorConfig(sim, run) });
    sim.net.lines.forEach((n, j) => {
      tr.fields[j].setDirection(run.fieldIndex, run.legs.find(g => g.line === j)?.dir ?? 1);
      tr.pendingCmd.push({ type: 'timetable', engine: ob.engine, timetable: run.legs.some(g => g.line === j) ? tsx.serviceTimetable(sim, run, j) : [], ...(j > 0 ? { line: n.id } : {}) });
    });
    sim.event('INFO', `Regulator: ${run.id} rerouted along ${route.join(', ')}` + (keep.length < run.plan.length ? ` (passes ${run.plan.filter(p => !keep.some(x => x.name === p.name)).map(p => p.name).join(', ')})` : ''));
    return null;
  }
  // the node routes follow the new itineraries; owners keep their routes
  const owners = sim.gates.filter(g => g.owner).map(g => ({ node: g.node, line: g.line, dir: g.dir, run: (g.owner as NodeClaim).run, kind: (g.owner as NodeClaim).kind }));
  const done = sim.gates.flatMap(g => g.claims.filter(c => c.done).map(c => ({ node: g.node, line: g.line, dir: g.dir, run: c.run })));
  sim.gates = tfc.buildGates(sim);
  for (const g of sim.gates) {
    const o = owners.find(x => x.node === g.node && x.line === g.line && x.dir === g.dir);
    if (o) g.owner = g.claims.find(c => c.run === o.run && c.kind === o.kind) ?? null;
    for (const c of g.claims) if (done.some(x => x.node === g.node && x.line === g.line && x.dir === g.dir && x.run === c.run)) c.done = true;
  }
  sim.event('INFO', `Regulator: ${run.id} rerouted along ${route.join(', ')}` + (keep.length < run.plan.length ? ` (passes ${run.plan.filter(p => !keep.some(x => x.name === p.name)).map(p => p.name).join(', ')})` : ''));
  return null;
}

/** Applies one decision of the regulator; returns why it cannot, or null (internal, also called by regulator-bridge.ts) */
export function regulatorCommand(sim: Simulation, c: RegulatorCommand): string | null {
  if (!c || typeof c !== 'object') return 'not an object';
  if (c.type === 'operator') {
    if (!sim.tr) return 'the run does not use the interlocking trackside';
    sim.tr.pendingCmd.push(c.command as unknown as OperatorCommand);
    return null;
  }
  if (c.type === 'connection') {
    const k = sim.connections.find(x => x.from.id === c.from && x.to.id === c.to && x.station === c.station);
    if (!k) return `no connection from ${c.from} to ${c.to} at ${c.station}`;
    if (k.outcome !== 'pending') return `the connection at ${c.station} is already ${k.outcome}`;
    if (typeof c.max_wait_s !== 'number' || !(c.max_wait_s >= 0)) return 'max_wait_s must be a number ≥ 0';
    k.maxWait = c.max_wait_s;
    return null;
  }
  const run = sim.trains.find(x => x.id === c.train);
  if (!run) return `no train «${(c as { train?: string }).train}»`;
  if (c.type === 'reroute') return run.S.finished ? `${run.id} has finished` : reroute(sim, run, c.route);
  if (run.S.finished) return `${run.id} has finished`;
  const S = run.S, sync = () => {
    if (!sim.tr || !run.ob) return;
    const ob = run.ob;
    // on a network every interlocking the train runs through gets its part of the new timetable
    if (sim.networked && run.itin) for (const g of run.itin) sim.tr.pendingCmd.push({ type: 'timetable', engine: ob.engine, timetable: tsx.serviceTimetable(sim, run, g.line), ...(g.line > 0 ? { line: sim.net.lines[g.line].id } : {}) });
    else sim.tr.pendingCmd.push({ type: 'timetable', engine: ob.engine, timetable: tsx.serviceTimetable(sim, run) });
  };
  if (c.type === 'priority') {
    if (typeof c.value !== 'number' || !isFinite(c.value)) return 'value must be a number';
    run.priority = c.value;
    if (sim.tr && run.ob) sim.tr.pendingCmd.push({ type: 'priority', engine: run.ob.engine, value: c.value });
    return null;
  }
  if (c.type === 'cancel') {
    if (run.driver === 'controlled') return 'the controlled train cannot be cancelled';
    const k = c.from_station == null ? (run.active ? S.nextSt : 0) : run.stations.findIndex(x => x.name === c.from_station);
    if (k < 0) return `${run.id} does not stop at «${c.from_station}»`;
    // a service not yet appeared has not left its origin, whatever its stop index says
    if (k < (run.active ? S.nextSt : 0)) return `${run.id} has already left ${run.stations[k].name}`;
    if (k === 0 && !run.active) {
      // the whole train: it never appears
      run.cancelled = 'all'; S.finished = true;
      if (sim.tr && run.ob) {
        const ob = run.ob, tr = sim.tr;
        if (sim.networked && run.itin) for (const g of run.itin) tr.pendingCmd.push({ type: 'timetable', engine: ob.engine, timetable: [], ...(g.line > 0 ? { line: sim.net.lines[g.line].id } : {}) });
        else tr.pendingCmd.push({ type: 'timetable', engine: ob.engine, timetable: [] });
      }
      sim.event('INFO', `Regulator: ${run.id} cancelled`);
      return null;
    }
    if (k === run.stations.length - 1) return `${run.id} ends at ${run.stations[k].name} anyway`;
    // it ends at station k: the stops after it are removed, and it leaves the line on arrival
    for (const st of run.stations.slice(k + 1)) run.tracks.delete(st.name);
    run.stations.splice(k + 1); run.dwells.splice(k + 1);
    run.stations[k].dep = null;
    run.cancelled = 'partial';
    sim.event('INFO', `Regulator: ${run.id} ends at ${run.stations[k].name}`);
    if (S.doors && k === S.nextSt) sim.finish(run);
    sync();
    return null;
  }
  const i = run.stations.findIndex(x => x.name === c.station);
  if (i < 0) return `${run.id} does not stop at «${c.station}»`;
  const standing = S.doors && i === S.nextSt;
  if (i < S.nextSt) return `${run.id} has already left ${c.station}`;
  const st = run.stations[i];
  if (c.type === 'track') {
    if (c.track !== 'I' && c.track !== 'II') return 'track must be I or II';
    run.tracks.set(st.name, c.track); sync();
    return null;
  }
  if (c.type === 'skip_stop') {
    if (run.driver === 'controlled') return 'the stops of the controlled train are those of the line';
    if (i === 0 || i === run.stations.length - 1) return 'the origin and the destination cannot be skipped';
    if (standing) return `${run.id} is already standing at ${c.station}`;
    run.stations.splice(i, 1); run.dwells.splice(i, 1); run.tracks.delete(st.name); sync();
    return null;
  }
  if (c.type === 'retime') {
    const ok = (x: unknown) => x === undefined || x === null || (typeof x === 'number' && isFinite(x));
    if (!ok(c.arrival_s) || !ok(c.departure_s)) return 'times must be numbers or null';
    if (c.arrival_s !== undefined && !standing && i > 0) st.arr = c.arrival_s;
    if (c.departure_s !== undefined && i < run.stations.length - 1) st.dep = c.departure_s;
    if (st.arr != null && st.dep != null && st.dep < st.arr) st.dep = st.arr;
    if (i === 0 && !run.active && st.dep != null) run.appear = st.dep - SERVICE_LEAD;
    if (standing && run.driver !== 'controlled') {
      const re = run.realised[run.pendingDep];
      S.doorDue = Math.max((re?.arrival_s ?? S.t) + run.dwells[i], st.dep ?? -Infinity, S.t);
    }
    sync();
    return null;
  }
  return 'unknown command';
}

/**
 * Command of the dispatcher, from the control room of the page or from a program: the decisions a regulator can
 * take (retime, skip_stop, cancel, priority, track, reroute, connection, operator) and temporary speed restrictions,
 * given now (docs/CONTROL_ROOM.md). Returns why it cannot be applied, or null. Every command applied is recorded in
 * `dispatched` with its time, so the run can be repeated with the same commands at the same times
 */
export function dispatch(sim: Simulation, c: DispatchCommand): string | null {
  let why: string | null;
  if (c && c.type === 'speed_restriction') {
    const ok = (x: unknown) => typeof x === 'number' && isFinite(x);
    if (!ok(c.from_m) || !ok(c.to_m) || !(c.to_m > c.from_m) || !ok(c.v_kmh) || !(c.v_kmh > 0)) why = 'from_m < to_m and v_kmh > 0 are needed';
    else {
      const on = c.revoke !== true, has = sim.faults.tsr.some(z => z[0] === c.from_m && z[1] === c.to_m && z[2] === c.v_kmh);
      why = on === has ? (on ? 'the same restriction is already in force' : 'no such restriction in force') : null;
      if (!why) applyFault(sim, { when: { t: sim.time }, type: 'speed_restriction', from_m: c.from_m, to_m: c.to_m, v_kmh: c.v_kmh, announced: true }, on);
    }
  } else why = regulatorCommand(sim, c as RegulatorCommand);
  const what = c && typeof c === 'object' ? `${c.type}${'train' in c && c.train ? ' ' + c.train : ''}` : 'command';
  if (why) sim.event('WARN', `Dispatcher: ${what} not applied, ${why}`);
  else { sim.dispatched.push({ t_s: Math.round(sim.time * 1000) / 1000, command: JSON.parse(JSON.stringify(c)) }); sim.event('INFO', `Dispatcher: ${what}`); }
  return why;
}
