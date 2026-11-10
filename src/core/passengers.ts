/**
 * Aggregate passenger model (docs/PASSENGERS.md, phase 6): origin–destination demand with an arrival rate per
 * hour, platform queues, boarding and alighting at the stops, capacity of the trains with the passengers left on the
 * platform, dwell time from the people boarding and alighting, measures of waiting, travel, delay and load.
 *
 * Passengers are flows, not agents. With `arrivals: 'uniform'` (default) the arrivals are a continuous flow and the
 * amounts are real numbers: the run is deterministic and the measures exact for the flows. With `arrivals: 'poisson'`
 * the arrivals between two visits of a queue are a Poisson count drawn with the seed of the scenario, so they are
 * whole people and the run is still repeatable. The model is called by the simulation when doors open and close;
 * without `passengers` in the scenario it does not exist and nothing changes.
 */
import type { TrainParams } from './types';

/** A flow of passengers from one station to another (passengers per hour), optionally within a time window */
export interface DemandDef {
  from: string;
  to: string;
  per_hour: number;
  /** Window of the flow in seconds of the run (default the whole run) */
  start_s?: number;
  end_s?: number;
  /** Station where these passengers change train: they ride to `via`, then take a train that serves `to` */
  via?: string;
}

export interface PassengerDef {
  demand: DemandDef[];
  /** Continuous flow (default, deterministic) or Poisson arrivals with `seed` */
  arrivals?: 'uniform' | 'poisson';
  seed?: number;
  /** Fixed part of a stop: opening, closing and departure clearance (s, default 12) */
  fixed_s?: number;
  /** Time for one person to board or alight through one doorway (s, default 1.5) */
  per_passenger_s?: number;
  /** Growth of that time with the standing load: × (1 + crowding × standing share) (default 0.6) */
  crowding?: number;
  /** Mass of a person with luggage carried by the train (kg, default 75) */
  mass_kg?: number;
  /** Time to walk from one train to the other when changing (s, default 60) */
  transfer_s?: number;
}

/** Capacity of a train: seats, standing places and doorways per side (defaults from the length) */
export interface Capacity { seats: number; standing: number; doors: number }

export function capacityOf(TR: TrainParams): Capacity {
  return {
    seats: TR.seats ?? Math.round(2.7 * TR.L),
    standing: TR.standing ?? Math.round(2.0 * TR.L),
    doors: TR.doors ?? Math.max(1, Math.round(TR.L / 14)),
  };
}

/** A stop of a train still ahead: name, chainage on the train's corridor (m) and planned arrival */
export interface StopAhead { name: string; s: number; arr: number | null }

/** Passengers waiting for one destination at one station, as cohorts in order of arrival */
/**
 * Passengers waiting for one train stop at one station, as cohorts in order of arrival. `final` is where they end
 * their journey: `to` itself, or a station beyond it when they change train at `to`. A cohort of passengers who
 * changed train can board from `tReady` and keeps the start of their journey
 */
interface Cohort { n: number; tMean: number; tFirst: number; tReady?: number; tStart?: number }
interface Queue { from: string; to: string; final: string; t: number; cohorts: Cohort[] }

/** A group of passengers on board with the same origin, destination and boarding */
interface Group { from: string; to: string; final: string; n: number; sBoard: number; tBoard: number; tStart: number }

interface TrainPax { logAt: number; cap: Capacity; groups: Group[]; maxLoad: number; seatKm: number; sLast: number | null; boarded: number; alighted: number; maxOnboard: number; pkm: number }

export interface StopResult { alighted: number; boarded: number; left_behind: number; onboard: number; dwell_s: number }

export interface PassengerTrainResult {
  train_id: string;
  boarded: number;
  alighted: number;
  onboard: number;
  max_onboard: number;
  /** Highest onboard / seats at a departure */
  max_load_factor: number;
  /** Passenger-km of the passengers who alighted / seat-km run between stops */
  mean_load_factor: number;
  passenger_km: number;
  seats: number;
  standing: number;
}

export interface PassengerResults {
  arrivals: 'uniform' | 'poisson';
  /** People arrived on the platforms up to the time of the results (with Poisson arrivals, those since the last call of a train are counted at their expected number) */
  arrived: number;
  boarded: number;
  alighted: number;
  waiting: number;
  onboard: number;
  /** Passengers who could not board a train they wanted because it was full, counted at each departure */
  left_behind: number;
  /** Passengers carried beyond their stop because the train did not serve it */
  carried_past: number;
  /** Passengers who changed train (alighted at their `via` to take another train) */
  transfers: number;
  /** Journeys ended at their destination */
  journeys: number;
  /** Wait at the origin of those who boarded there */
  mean_wait_s: number;
  max_wait_s: number;
  /** Wait between alighting at the station of the change and boarding the next train (walking time included) */
  mean_transfer_wait_s: number;
  max_transfer_wait_s: number;
  /** Time spent changing train by all passengers (passenger-minutes): what a lost connection costs */
  transfer_passenger_min: number;
  /** Per station of change: passengers who changed there and their mean wait */
  transfer_stations: { station: string; transfers: number; boarded: number; mean_wait_s: number }[];
  /** From the arrival on the platform to the alighting at the destination, changes included */
  mean_journey_s: number;
  /** Arrival delay at the destination weighted by the passengers who alight (s) */
  mean_passenger_delay_s: number;
  passenger_km: number;
  trains: PassengerTrainResult[];
  /** Per stop of every train, in the order they happened */
  stops: { train_id: string; station: string; t: number; alighted: number; boarded: number; left_behind: number; onboard: number; dwell_s: number }[];
}

/** Mulberry32: small, fast, and the same in every JavaScript engine */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Poisson count with mean lambda: Knuth for small means, a rounded normal for large ones */
function poisson(lambda: number, u: () => number): number {
  if (lambda <= 0) return 0;
  if (lambda < 30) {
    const L = Math.exp(-lambda);
    let k = 0, p = 1;
    do { k++; p *= u(); } while (p > L);
    return k - 1;
  }
  const z = Math.sqrt(-2 * Math.log(Math.max(1e-12, u()))) * Math.cos(2 * Math.PI * u());
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * z));
}

/** Shares `space` among amounts in proportion; whole numbers by largest remainder (ties to the first) when `whole` */
function share(amounts: number[], space: number, whole: boolean): number[] {
  const tot = amounts.reduce((a, b) => a + b, 0);
  if (tot <= space + 1e-12) return amounts.slice();
  const f = space / tot;
  if (!whole) return amounts.map(a => a * f);
  const exact = amounts.map(a => a * f), out = exact.map(Math.floor);
  let rest = Math.round(space - out.reduce((a, b) => a + b, 0));
  const order = exact.map((e, i) => [e - Math.floor(e), i] as const).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (rest <= 0) break; if (out[i] < amounts[i]) { out[i]++; rest--; } }
  return out;
}

const EPS = 1e-9;

export class PassengerModel {
  readonly def: PassengerDef;
  private readonly whole: boolean;
  private readonly u: () => number;
  private readonly queues = new Map<string, Queue>();
  private readonly trains = new Map<string, TrainPax>();
  private readonly log: PassengerResults['stops'] = [];
  private tot = { arrived: 0, boarded: 0, alighted: 0, leftBehind: 0, carriedPast: 0, wait: 0, firstBoarded: 0, maxWait: 0, journey: 0, journeys: 0, delayN: 0, delay: 0, pkm: 0, transfers: 0, tWait: 0, tBoarded: 0, tMaxWait: 0 };
  private readonly byTransfer = new Map<string, { transfers: number; boarded: number; wait: number }>();

  constructor(def: PassengerDef) {
    this.def = def;
    this.whole = def.arrivals === 'poisson';
    this.u = rng(def.seed ?? 1);
    // queues in the order of the demand, so that the draws are always made in the same order: the queue at the
    // origin and, for who changes train, the queue at the station of the change
    for (const d of def.demand) {
      this.queue(d.from, d.via ?? d.to, d.to);
      if (d.via) this.queue(d.via, d.to, d.to);
    }
  }

  private queue(from: string, to: string, final: string): Queue {
    const k = from + '\u0000' + to + '\u0000' + final;
    let q = this.queues.get(k);
    if (!q) { q = { from, to, final, t: 0, cohorts: [] }; this.queues.set(k, q); }
    return q;
  }

  /** Queues at a station for a stop of a train, in the order they were created */
  private queuesFor(station: string, to: string): Queue[] {
    return [...this.queues.values()].filter(q => q.from === station && q.to === to);
  }

  private train(id: string, TR: TrainParams): TrainPax {
    let p = this.trains.get(id);
    if (!p) { p = { logAt: -1, cap: capacityOf(TR), groups: [], maxLoad: 0, seatKm: 0, sLast: null, boarded: 0, alighted: 0, maxOnboard: 0, pkm: 0 }; this.trains.set(id, p); }
    return p;
  }

  /** People on board of a train */
  onboard(id: string): number {
    const p = this.trains.get(id);
    return p ? p.groups.reduce((a, g) => a + g.n, 0) : 0;
  }

  /** Capacity of a train, once it has met passengers */
  capacity(id: string): Capacity | null { return this.trains.get(id)?.cap ?? null; }

  /** Boarding, alighting and people on board of a train at its last stop at a station, null if it has not stopped there */
  stopOf(id: string, station: string): { alighted: number; boarded: number; onboard: number } | null {
    for (let i = this.log.length - 1; i >= 0; i--) { const e = this.log[i]; if (e.train_id === id && e.station === station) return { alighted: e.alighted, boarded: e.boarded, onboard: e.onboard }; }
    return null;
  }

  /** Mass of the people on board (kg) */
  payload(id: string): number { return this.onboard(id) * (this.def.mass_kg ?? 75); }

  /** Expected arrivals of a queue between its last update and t, with their mean and first arrival time */
  private expected(q: Queue, t: number): { n: number; mean: number; first: number } {
    let n = 0, tw = 0, first = Infinity;
    if (t <= q.t + EPS) return { n, mean: 0, first };
    for (const d of this.def.demand) {
      if (d.from !== q.from || (d.via ?? d.to) !== q.to || d.to !== q.final) continue;
      const a = Math.max(q.t, d.start_s ?? 0), b = Math.min(t, d.end_s ?? Infinity);
      if (b <= a) continue;
      const m = d.per_hour / 3600 * (b - a);
      n += m; tw += m * (a + b) / 2; first = Math.min(first, a);
    }
    return { n, mean: n > 0 ? tw / n : 0, first };
  }

  /** Brings a queue up to time t with the arrivals of its flows (with Poisson arrivals, draws them) */
  private update(q: Queue, t: number): void {
    if (t <= q.t + EPS) return;
    const e = this.expected(q, t);
    let n = e.n;
    const mean = e.mean, first = e.first;
    if (this.whole) n = poisson(n, this.u);
    if (n > 0) { q.cohorts.push({ n, tMean: mean, tFirst: first }); this.tot.arrived += n; }
    q.t = t;
  }

  private waitingFor(q: Queue): number { return q.cohorts.reduce((a, c) => a + c.n, 0); }
  /** Those who can board at t: passengers changing train only once they have walked to the platform */
  private readyFor(q: Queue, t: number): number { return q.cohorts.reduce((a, c) => a + ((c.tReady ?? -Infinity) <= t + EPS ? c.n : 0), 0); }

  /**
   * Takes n people from a queue, oldest first among those who can board; returns the wait of those starting their
   * journey and of those changing train, apart, and the mean start of their journeys
   */
  private take(q: Queue, n: number, t: number) {
    let left = n, wait = 0, maxWait = 0, tWait = 0, tN = 0, tMax = 0, start = 0;
    for (let i = 0; i < q.cohorts.length && left > EPS; i++) {
      const c = q.cohorts[i];
      if ((c.tReady ?? -Infinity) > t + EPS) continue;
      const k = Math.min(c.n, left);
      if (c.tStart != null) { tWait += k * (t - c.tMean); tN += k; tMax = Math.max(tMax, t - c.tFirst); start += k * c.tStart; }
      else { wait += k * (t - c.tMean); maxWait = Math.max(maxWait, t - c.tFirst); start += k * c.tMean; }
      c.n -= k; left -= k;
    }
    q.cohorts = q.cohorts.filter(c => c.n > EPS);
    return { wait, maxWait, tWait, tN, tMax, tStart: n > 0 ? start / n : t };
  }

  /**
   * Doors open at a stop (or a train is ready at its origin): alighting of who is going here, boarding of who is
   * going to a stop ahead, within the capacity. Returns the dwell the passengers need. With no stop ahead every one
   * on board alights; those whose stop was not served are counted as carried past.
   */
  open(id: string, TR: TrainParams, station: string, s: number, ahead: StopAhead[], plannedArr: number | null, t: number): StopResult {
    const p = this.train(id, TR);
    // seat-km since the last stop
    if (p.sLast != null) p.seatKm += p.cap.seats * Math.abs(s - p.sLast) / 1000;
    p.sLast = s;
    const last = ahead.length === 0;
    let alighted = 0;
    const loadBefore = this.onboard(id);
    p.groups = p.groups.filter(g => {
      if (g.to !== station && !last) return true;
      alighted += g.n;
      this.tot.alighted += g.n;
      const km = g.n * Math.abs(s - g.sBoard) / 1000;
      this.tot.pkm += km; p.pkm += km;
      if (g.to !== station) this.tot.carriedPast += g.n;
      else if (g.final !== station) {
        // they change here: they walk to the platform of the next train and wait for one that serves their destination
        this.queue(station, g.final, g.final).cohorts.push({ n: g.n, tMean: t, tFirst: t, tReady: t + (this.def.transfer_s ?? 60), tStart: g.tStart });
        this.tot.transfers += g.n;
        const b = this.byTransfer.get(station) ?? { transfers: 0, boarded: 0, wait: 0 };
        b.transfers += g.n; this.byTransfer.set(station, b);
      } else {
        this.tot.journey += g.n * (t - g.tStart); this.tot.journeys += g.n;
        if (plannedArr != null) { this.tot.delay += g.n * (t - plannedArr); this.tot.delayN += g.n; }
      }
      return false;
    });
    p.alighted += alighted;
    const boarded = last ? 0 : this.board(id, p, station, s, ahead, t);
    const onboard = this.onboard(id);
    // dwell: the larger of the two flows through the doors, slower when people stand
    const standShare = p.cap.standing > 0 ? Math.max(0, Math.min(1, (Math.max(loadBefore, onboard) - p.cap.seats) / p.cap.standing)) : 0;
    const h = (this.def.per_passenger_s ?? 1.5) * (1 + (this.def.crowding ?? 0.6) * standShare);
    const dwell = (this.def.fixed_s ?? 12) + Math.max(alighted, boarded) / p.cap.doors * h;
    const r = { alighted, boarded, left_behind: 0, onboard, dwell_s: dwell };
    p.logAt = this.log.length;
    this.log.push({ train_id: id, station, t, ...r });
    return r;
  }

  /** Doors close: who arrived meanwhile boards too; who still wants this train and cannot board is left behind */
  close(id: string, TR: TrainParams, station: string, s: number, ahead: StopAhead[], t: number): void {
    const p = this.train(id, TR);
    if (p.sLast == null) p.sLast = s;
    const more = this.board(id, p, station, s, ahead, t);
    let left = 0;
    for (const a of ahead) for (const q of this.queuesFor(station, a.name)) left += this.readyFor(q, t);
    this.tot.leftBehind += left;
    const onboard = this.onboard(id);
    p.maxLoad = Math.max(p.maxLoad, onboard / Math.max(1, p.cap.seats));
    p.maxOnboard = Math.max(p.maxOnboard, onboard);
    // the stop opened at this station gets the latecomers; the origin of the controlled train has no opening
    const e = p.logAt >= 0 ? this.log[p.logAt] : null;
    if (e && e.station === station) { e.boarded += more; e.left_behind = left; e.onboard = onboard; }
    else this.log.push({ train_id: id, station, t, alighted: 0, boarded: more, left_behind: left, onboard, dwell_s: 0 });
    p.logAt = -1;
  }

  private board(id: string, p: TrainPax, station: string, s: number, ahead: StopAhead[], t: number): number {
    const qs: Queue[] = [];
    for (const a of ahead) for (const q of this.queuesFor(station, a.name)) { this.update(q, t); qs.push(q); }
    if (!qs.length) return 0;
    const space = Math.max(0, p.cap.seats + p.cap.standing - this.onboard(id));
    const want = qs.map(q => this.readyFor(q, t));
    const take = share(want, space, this.whole);
    let boarded = 0;
    qs.forEach((q, i) => {
      const n = take[i];
      if (n <= EPS) return;
      const w = this.take(q, n, t);
      p.groups.push({ from: station, to: q.to, final: q.final, n, sBoard: s, tBoard: t, tStart: w.tStart });
      this.tot.wait += w.wait; this.tot.firstBoarded += n - w.tN; this.tot.maxWait = Math.max(this.tot.maxWait, w.maxWait);
      if (w.tN > 0) {
        this.tot.tWait += w.tWait; this.tot.tBoarded += w.tN; this.tot.tMaxWait = Math.max(this.tot.tMaxWait, w.tMax);
        const b = this.byTransfer.get(station)!; b.boarded += w.tN; b.wait += w.tWait;
      }
      boarded += n;
    });
    this.tot.boarded += boarded;
    p.boarded += boarded;
    return boarded;
  }

  /**
   * People waiting at a station now: those already on the platform when a train last called plus the arrivals
   * since then. It only reads: with Poisson arrivals the people arrived since the last call are their expected
   * number, drawn only when a train calls, so reading the model never changes the run
   */
  waitingAt(station: string, t: number): number {
    let n = 0;
    for (const q of this.queues.values()) if (q.from === station) n += this.waitingFor(q) + this.expected(q, t).n;
    return n;
  }

  /** People waiting at a station now, by destination (see `waitingAt`) */
  waitingTo(station: string, t: number): { to: string; n: number }[] {
    const out: { to: string; n: number }[] = [];
    for (const q of this.queues.values()) if (q.from === station) out.push({ to: q.to, n: this.waitingFor(q) + this.expected(q, t).n });
    return out;
  }

  /** Measures at time t; reading them does not change the run (see `waitingAt`) */
  results(t: number): PassengerResults {
    const pending = [...this.queues.values()].reduce((a, q) => a + this.expected(q, t).n, 0);
    const waiting = [...this.queues.values()].reduce((a, q) => a + this.waitingFor(q), 0) + pending;
    const T = { ...this.tot, arrived: this.tot.arrived + pending };
    const trains = [...this.trains.entries()].map(([id, p]) => {
      const pkm = p.pkm;
      return {
        train_id: id, boarded: r3(p.boarded), alighted: r3(p.alighted), onboard: r3(this.onboard(id)), max_onboard: r3(p.maxOnboard),
        max_load_factor: r3(p.maxLoad), mean_load_factor: p.seatKm > 0 ? r3(pkm / p.seatKm) : 0, passenger_km: r3(pkm),
        seats: p.cap.seats, standing: p.cap.standing,
      };
    });
    return {
      arrivals: this.whole ? 'poisson' : 'uniform',
      arrived: r3(T.arrived), boarded: r3(T.boarded), alighted: r3(T.alighted), waiting: r3(waiting),
      onboard: r3([...this.trains.keys()].reduce((a, id) => a + this.onboard(id), 0)),
      left_behind: r3(T.leftBehind), carried_past: r3(T.carriedPast), transfers: r3(T.transfers), journeys: r3(T.journeys),
      mean_wait_s: T.firstBoarded > 0 ? r1(T.wait / T.firstBoarded) : 0, max_wait_s: r1(T.maxWait),
      mean_transfer_wait_s: T.tBoarded > 0 ? r1(T.tWait / T.tBoarded) : 0, max_transfer_wait_s: r1(T.tMaxWait),
      transfer_passenger_min: r1(T.tWait / 60),
      transfer_stations: [...this.byTransfer.entries()].map(([station, b]) => ({ station, transfers: r3(b.transfers), boarded: r3(b.boarded), mean_wait_s: b.boarded > 0 ? r1(b.wait / b.boarded) : 0 })),
      mean_journey_s: T.journeys > 0 ? r1(T.journey / T.journeys) : 0,
      mean_passenger_delay_s: T.delayN > 0 ? r1(T.delay / T.delayN) : 0,
      passenger_km: r3(T.pkm),
      trains,
      stops: this.log.map(e => ({ ...e, t: r1(e.t), alighted: r3(e.alighted), boarded: r3(e.boarded), left_behind: r3(e.left_behind), onboard: r3(e.onboard), dwell_s: r1(e.dwell_s) })),
    };
  }

}

/** Occupancy level of SIRI (OccupancyEnumeration) and GTFS-Realtime (OccupancyStatus) from the people on board */
export type OccupancyLevel = 'empty' | 'manySeatsAvailable' | 'fewSeatsAvailable' | 'standingRoomOnly' | 'crushedStandingRoomOnly' | 'full';
export function occupancyLevel(onboard: number, cap: Capacity): OccupancyLevel {
  if (onboard < 0.5) return 'empty';
  if (onboard <= 0.5 * cap.seats) return 'manySeatsAvailable';
  if (onboard <= cap.seats) return 'fewSeatsAvailable';
  if (onboard <= cap.seats + 0.5 * cap.standing) return 'standingRoomOnly';
  if (onboard < cap.seats + cap.standing - 0.5) return 'crushedStandingRoomOnly';
  return 'full';
}

const r1 = (x: number) => Math.round(x * 10) / 10;
const r3 = (x: number) => Math.round(x * 1000) / 1000;

/** Errors of a passenger definition, for the validation of the scenario */
export function validatePassengers(p: PassengerDef | undefined): string[] {
  if (p == null) return [];
  const err: string[] = [];
  if (!Array.isArray(p.demand) || !p.demand.length) err.push('passengers.demand: at least one flow {from, to, per_hour}');
  else p.demand.forEach((d, i) => {
    if (typeof d.from !== 'string' || typeof d.to !== 'string' || d.from === d.to) err.push(`passengers.demand[${i}]: from and to are two different stations`);
    if (!(d.per_hour >= 0)) err.push(`passengers.demand[${i}]: per_hour is zero or more`);
    if (d.start_s != null && d.end_s != null && d.end_s <= d.start_s) err.push(`passengers.demand[${i}]: end_s after start_s`);
    if (d.via != null && (typeof d.via !== 'string' || d.via === d.from || d.via === d.to)) err.push(`passengers.demand[${i}]: via is a station other than from and to`);
  });
  if (p.arrivals != null && p.arrivals !== 'uniform' && p.arrivals !== 'poisson') err.push('passengers.arrivals: uniform or poisson');
  for (const k of ['fixed_s', 'per_passenger_s', 'crowding', 'mass_kg', 'transfer_s'] as const) if (p[k] != null && !(p[k]! >= 0)) err.push(`passengers.${k}: zero or more`);
  return err;
}
