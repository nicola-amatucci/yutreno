/**
 * Reference traffic regulator of YuTreno (docs/REGULATOR.md).
 *
 * It receives at every cycle the state of the traffic (trains with plan, current and realised timetable, faults,
 * disruptions, routes of the interlocking) and answers with decisions on the timetable: priorities, new times,
 * cancelled routes. It is deliberately simple and explainable, a baseline against which a research regulator can be
 * compared through the same protocol:
 *
 *  1. **priorities**: a train that cannot run normally goes after the others: −2 when broken down, −1 with traction or
 *     brake below 70 %; otherwise 0, so the conflict rule of the interlocking decides as without a regulator;
 *  2. **rescheduling**: the delay of a train is carried over its next stops (arrival = plan + delay, departure not
 *     before arrival + minimum dwell, never before the plan), so that the timetable used by route setting and by the
 *     single-track consent is the one that will really happen, and the published one too;
 *  3. **breakdowns**: the departure of a broken-down train is moved after the expected end of the fault (or kept
 *     2 minutes ahead while the end is unknown), and a departure route already set for it is cancelled;
 *  4. **line blocked**: a train that would run into a blocked stretch is held at the last station before it, until
 *     the expected reopening (or 2 minutes ahead while unknown), instead of stopping in open line at the signal;
 *  5. **cancellation**: a train broken down in a station with no expected end of the fault is taken out of service
 *     there after 10 minutes: it ends at that station and its next stops are cancelled;
 *  6. **connections**: a connection that the feeder can no longer make within the maximum wait is released, so that
 *     the departing train leaves on time instead of waiting in vain;
 *  7. **reroute** (network): a train not yet appeared whose route crosses a blocked stretch of the main line with no
 *     reopening before it gets there runs along the shortest other route that avoids it, passing the stops not on it.
 *
 * Like the trackside it imports only types from the engine, so it can be copied into an external program.
 */
import type { RegulatorCommand, RegulatorDisruption, RegulatorRequest, RegulatorResponse, RegulatorStop, RegulatorTrain } from '../core/types';

type NetworkConfig = NonNullable<NonNullable<RegulatorRequest['configuration']>['network']>;

/** Parameters of the reference regulator */
export const REGULATOR_PARAMETERS = {
  /** Margin after the expected end of a fault or of a blockage (s) */
  margin_s: 30,
  /** A new time is sent only when it differs from the current one by more than this (s) */
  threshold_s: 20,
  /** Delays below this are not carried over the next stops (s) */
  delay_s: 60,
  /** While the end of a fault is unknown the departure is kept this far ahead (s) */
  hold_s: 120,
  /** Traction or brake below this factor lower the priority */
  slow_factor: 0.7,
  /** A train broken down in a station, with no expected end, is cancelled from there after this time (s) */
  cancel_after_s: 600,
};

type Config = NonNullable<RegulatorRequest['configuration']>;

/** Distance before a station within which a train counts as approaching it (m), as the entry window of route setting */
const APPROACH_M = 3500;

export class ReferenceRegulator {
  private cfg: Config | null = null;
  private prio = new Map<string, number>();
  /** Reasons already written in the log, so that a decision renewed at every cycle is told once */
  private told = new Set<string>();
  readonly params = { ...REGULATOR_PARAMETERS };

  step(req: RegulatorRequest): RegulatorResponse {
    if (req.start && req.configuration) this.cfg = req.configuration;
    const commands: RegulatorCommand[] = [], log: string[] = [];
    for (const tr of req.trains) {
      if (tr.finished) continue;
      this.priority(tr, commands, log);
      if (this.cancel(tr, req, commands, log)) continue;
      if (this.reroute(tr, req, commands, log)) continue;
      this.reschedule(tr, req, commands, log);
      this.cancelRoutes(tr, req, commands, log);
    }
    this.connections(req, commands, log);
    return { commands, log };
  }

  /** 1. Priority from the state of the train */
  private priority(tr: RegulatorTrain, out: RegulatorCommand[], log: string[]): void {
    const P = this.params;
    const slow = tr.traction_factor < P.slow_factor || tr.brake_factor < P.slow_factor;
    const p = tr.broken ? -2 : slow ? -1 : 0;
    if ((this.prio.get(tr.id) ?? 0) === p) return;
    this.prio.set(tr.id, p);
    out.push({ type: 'priority', train: tr.id, value: p });
    log.push(`${tr.id}: priority ${p}` + (tr.broken ? ' (broken down)' : slow ? ` (traction ${Math.round(tr.traction_factor * 100)} %, brake ${Math.round(tr.brake_factor * 100)} %)` : ' (running normally again)'));
  }

  /** Stops not yet left, in running order (the one where the train stands included) */
  private pending(tr: RegulatorTrain): RegulatorStop[] {
    const live = tr.stops.filter(x => !x.skipped);
    const k = tr.next_station == null ? live.length : live.findIndex(x => x.station === tr.next_station);
    return k < 0 ? [] : live.slice(k);
  }

  /** Earliest departures imposed by a breakdown or by a blocked stretch ahead, by station */
  private constraints(tr: RegulatorTrain, req: RegulatorRequest, stops: RegulatorStop[]): Map<string, { t: number; why: string }> {
    const P = this.params, c = new Map<string, { t: number; why: string }>();
    const put = (st: string, t: number, why: string) => { const o = c.get(st); if (!o || t > o.t) c.set(st, { t, why }); };
    const deps = stops.filter(x => x.planned_departure_s != null || x.departure_s != null);
    // on a network the blocked stretches are on the main line: only the stops on it count
    const main = this.cfg?.network?.lines[0]?.id, onMain = deps.filter(x => x.line == null || x.line === main);
    if (tr.broken && deps.length) put(deps[0].station, (tr.broken_until_s ?? req.t + P.hold_s) + P.margin_s, 'broken down');
    for (const d of req.disruptions) {
      if (d.type !== 'line_blocked' || d.from_m == null || d.to_m == null) continue;
      const a = d.from_m, b = d.to_m;
      const ahead = tr.dir > 0 ? tr.s_m < a : tr.s_m > b;
      if (!ahead) continue;
      // on a network, only if the route of the train runs along the blocked stretch of the main line
      const net = this.cfg?.network, live = tr.stops.filter(x => !x.skipped);
      if (net && tr.route && live.length > 1) {
        const m = mainSpan(net, tr.route, live[0].station, live[live.length - 1].station);
        if (!m || !(m[1] > a && m[0] < b)) continue;
      }
      // the last stop before the stretch, in the running direction, that the train still has to leave
      const before = onMain.filter(x => (tr.dir > 0 ? x.s_m <= a : x.s_m >= b));
      const st = before[before.length - 1];
      if (st) put(st.station, (this.until(d) ?? req.t + P.hold_s) + P.margin_s, `line blocked ${(a / 1000).toFixed(3)}–${(b / 1000).toFixed(3)} km`);
    }
    return c;
  }

  private until(d: RegulatorDisruption): number | null { return d.until_s; }

  /** 2–4. New times for the stops not yet left */
  private reschedule(tr: RegulatorTrain, req: RegulatorRequest, out: RegulatorCommand[], log: string[]): void {
    const P = this.params, stops = this.pending(tr);
    if (!stops.length) return;
    const cons = this.constraints(tr, req, stops);
    let lag = Math.max(0, tr.delay_s ?? 0);
    if (lag < P.delay_s) lag = 0;
    stops.forEach((x, i) => {
      const last = i === stops.length - 1;
      const arrived = x.realised_arrival_s != null || tr.at_station === x.station;
      const arrEst = x.realised_arrival_s ?? (x.planned_arrival_s != null ? x.planned_arrival_s + lag : null);
      let arr = x.arrival_s, dep = x.departure_s;
      if (!arrived && x.planned_arrival_s != null) arr = x.planned_arrival_s + lag;
      if (!last && x.planned_departure_s != null) {
        const k = cons.get(x.station);
        let d = Math.max(x.planned_departure_s, lag > 0 && arrEst != null ? arrEst + x.min_dwell_s : -Infinity);
        if (k) d = Math.max(d, k.t);
        // a train standing in the station cannot leave in the past: when the reason to hold it ends, it leaves now
        if (tr.at_station === x.station && d < req.t && (x.departure_s ?? -Infinity) > req.t) d = req.t;
        dep = d;
        lag = Math.max(0, d - x.planned_departure_s);
        if (lag < P.delay_s && !k) lag = 0;
      }
      const moved = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) > P.threshold_s;
      const newArr = !arrived && moved(arr, x.arrival_s) ? +((arr as number).toFixed(1)) : undefined;
      const newDep = !last && moved(dep, x.departure_s) ? +((dep as number).toFixed(1)) : undefined;
      if (newArr === undefined && newDep === undefined) return;
      out.push({ type: 'retime', train: tr.id, station: x.station, ...(newArr !== undefined ? { arrival_s: newArr } : {}), ...(newDep !== undefined ? { departure_s: newDep } : {}) });
      const k = cons.get(x.station);
      if (newDep !== undefined && k && newDep >= k.t - 1e-6) {
        const key = `${tr.id}|${x.station}|${k.why}`;
        if (!this.told.has(key)) { this.told.add(key); log.push(`${tr.id}: departure from ${x.station} moved to ${fmt(newDep)} (${k.why})`); }
      }
    });
  }

  /** 5. A train broken down in a station for good is taken out of service there */
  private cancel(tr: RegulatorTrain, req: RegulatorRequest, out: RegulatorCommand[], log: string[]): boolean {
    if (!tr.broken || tr.broken_until_s != null || tr.cancelled || !this.cfg || tr.v_kmh > 0) return false;
    const d = req.disruptions.find(x => x.type === 'train_stopped' && x.train === tr.id && x.until_s == null);
    if (!d || req.t - d.since_s < this.params.cancel_after_s) return false;
    // only a train still at its platform: one that had already closed the doors has left the stop for the timetable
    const here = tr.at_station;
    const live = tr.stops.filter(x => !x.skipped);
    if (!here || live[live.length - 1]?.station === here) return false;
    out.push({ type: 'cancel', train: tr.id, from_station: here });
    log.push(`${tr.id}: broken down at ${here} with no expected end, taken out of service there`);
    return true;
  }

  /** 6. A connection the feeder can no longer make within the maximum wait is released */
  private connections(req: RegulatorRequest, out: RegulatorCommand[], log: string[]): void {
    for (const c of req.connections ?? []) {
      if (c.outcome !== 'pending' || c.max_wait_s <= 0) continue;
      const f = req.trains.find(x => x.id === c.from), d = req.trains.find(x => x.id === c.to);
      const fs = f?.stops.find(x => x.station === c.station), ds = d?.stops.find(x => x.station === c.station);
      if (!f || !fs || !ds || fs.realised_arrival_s != null) continue;
      const dep = ds.departure_s ?? ds.planned_departure_s;
      if (dep == null) continue;
      // the earliest the feeder can arrive: the timetable plus its delay, and not before the end of its breakdown
      let arr = (fs.arrival_s ?? fs.planned_arrival_s ?? req.t) + Math.max(0, f.delay_s ?? 0);
      if (f.broken) { if (f.broken_until_s == null) continue; arr = Math.max(arr, f.broken_until_s); }
      if (arr + c.transfer_s <= dep + c.max_wait_s) continue;
      out.push({ type: 'connection', from: c.from, to: c.to, station: c.station, max_wait_s: 0 });
      log.push(`${c.to}: connection with ${c.from} at ${c.station} released, the feeder arrives not before ${fmt(arr)}`);
    }
  }

  /** 7. On a network, a train not yet appeared runs around a blocked stretch of the main line when another route avoids it */
  private reroute(tr: RegulatorTrain, req: RegulatorRequest, out: RegulatorCommand[], log: string[]): boolean {
    const net = this.cfg?.network;
    if (!net || tr.active || !tr.route || this.told.has(`reroute|${tr.id}`)) return false;
    const blocks = req.disruptions.filter(d => d.type === 'line_blocked' && d.from_m != null && d.to_m != null);
    if (!blocks.length) return false;
    const live = tr.stops.filter(x => !x.skipped);
    if (live.length < 2) return false;
    const t0 = live[0].departure_s ?? live[0].planned_departure_s ?? req.t;
    const lasting = blocks.filter(d => (d.until_s ?? Infinity) > t0 + this.params.hold_s);
    const crosses = (route: string[]) => { const m = mainSpan(net, route, live[0].station, live[live.length - 1].station); return m != null && lasting.some(d => m[1] > (d.from_m as number) && m[0] < (d.to_m as number)); };
    if (!crosses(tr.route)) return false;
    // the other routes from the line of the origin to the line of the destination, the shortest first
    const best = paths(net, tr.route[0], tr.route[tr.route.length - 1], 4).filter(r => r.join() !== tr.route?.join() && !crosses(r))
      .map(r => ({ r, lost: live.filter(x => !r.some(id => net.lines.find(l => l.id === id)?.stations.some(y => y.name === x.station))).length }))
      .filter(x => {
        const on = (name: string) => x.r.some(id => net.lines.find(l => l.id === id)?.stations.some(y => y.name === name));
        return on(live[0].station) && on(live[live.length - 1].station);
      })
      .sort((a, b) => a.r.length - b.r.length || a.lost - b.lost)[0];
    this.told.add(`reroute|${tr.id}`);
    if (!best) return false;
    out.push({ type: 'reroute', train: tr.id, route: best.r });
    log.push(`${tr.id}: rerouted along ${best.r.join(', ')} around the blocked stretch` + (best.lost ? `, ${best.lost} stop(s) not served` : ''));
    return true;
  }

  /** 3. A departure route set for a broken-down train standing in a station is cancelled */
  private cancelRoutes(tr: RegulatorTrain, req: RegulatorRequest, out: RegulatorCommand[], log: string[]): void {
    if (!tr.broken || tr.v_kmh > 0 || !this.cfg?.routes || !req.routes) return;
    // the station the train stands in: with the doors open, or just after closing them, still at the platform
    const st0 = this.cfg.stations.find(x => x.name === tr.at_station) ?? this.cfg.stations.find(x => Math.abs(x.s_m - tr.s_m) < 400);
    if (!st0) return;
    const here = st0.name;
    // only if another train of the same direction is in the station or approaching it: otherwise the exit is free anyway
    const waiting = req.trains.some(o => o.id !== tr.id && o.active && !o.finished && o.dir === tr.dir &&
      (tr.dir > 0 ? o.s_m > st0.s_m - APPROACH_M && o.s_m < st0.s_m + 400 : o.s_m < st0.s_m + APPROACH_M && o.s_m > st0.s_m - 400));
    if (!waiting) return;
    const branch = tr.track_now === 'II' ? 'II:' + here : 'I';
    for (const r of this.cfg.routes) {
      if (r.type !== 'departure' || r.station_name !== here || r.branch_start !== branch) continue;
      const st = req.routes.find(x => x.id === r.id);
      if (!st || (st.state !== 'set' && st.state !== 'setting')) continue;
      out.push({ type: 'operator', command: { type: 'cancel_route', id: r.id } });
      log.push(`${tr.id}: route ${r.name} cancelled, the train is broken down`);
    }
  }
}

/** The station two lines share, if exactly one */
function node(net: NetworkConfig, a: string, b: string): string | null {
  const A = net.lines.find(l => l.id === a), B = net.lines.find(l => l.id === b);
  const common = A && B ? A.stations.filter(x => B.stations.some(y => y.name === x.name)) : [];
  return common.length === 1 ? common[0].name : null;
}

/** The simple paths of lines from `from` to `to` through nodes, up to `max` lines */
function paths(net: NetworkConfig, from: string, to: string, max: number): string[][] {
  const out: string[][] = [];
  const walk = (p: string[]) => {
    const last = p[p.length - 1];
    if (last === to) { out.push(p); return; }
    if (p.length >= max) return;
    for (const l of net.lines) if (!p.includes(l.id) && node(net, last, l.id)) walk([...p, l.id]);
  };
  walk([from]);
  return out;
}

/** Stretch [from, to] of the main line run along a route, from the origin or the node where it enters to the destination or the node where it leaves; null if it does not use the main line */
function mainSpan(net: NetworkConfig, route: string[], origin: string, destination: string): [number, number] | null {
  const main = net.lines[0], m = route.indexOf(main.id);
  if (m < 0) return null;
  const at = (name: string | null) => main.stations.find(x => x.name === name)?.s_m;
  const a = at(m === 0 ? origin : node(net, route[m - 1], main.id)), b = at(m === route.length - 1 ? destination : node(net, main.id, route[m + 1]));
  if (a == null || b == null) return null;
  return [Math.min(a, b), Math.max(a, b)];
}

/** Time of the run as h:mm:ss from the start */
function fmt(t: number): string {
  const s = Math.round(t), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${t.toFixed(0)} s (${h}:${String(m).padStart(2, '0')}:${String(s % 60).padStart(2, '0')})`;
}
