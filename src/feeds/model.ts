/**
 * Data model shared by the open data feeds (GTFS, GTFS-Realtime, NeTEx, SIRI): the line georeferenced in WGS84,
 * the service calendar that turns simulated time into instants of a real day, stable identifiers, the planned
 * timetable of every train and its real-time state. Pure functions of the simulation: no DOM, no Node.
 */
import { xyOf, type CompiledLine, type Simulation, type TrainRun } from '../core';

/** Options of the feeds: day, time zone, start of the run, identifiers */
export interface FeedOptions {
  /** Service day, YYYY-MM-DD */
  date: string;
  /** Local time of t = 0, HH:MM:SS (the clock of the page starts at 08:00:00) */
  start: string;
  /** IANA time zone of the timetable */
  timezone: string;
  /** NUTS 2 code of the region in the identifiers of the Italian NeTEx profile (IT:<region>:<type>:<codespace>:<id>) */
  region: string;
  /** Codespace of the identifiers and operator code */
  codespace: string;
  /** Operator */
  /**
   * Operator; with `vat` (partita IVA or codice fiscale) its identifier takes the form the Italian SIRI profile asks for,
   * IT:<region>:Operator:<vat>:<codespace>:<codespace>
   */
  operator: { name: string; url: string; phone?: string; vat?: string };
}

export const DEFAULT_FEED_OPTIONS: FeedOptions = {
  date: '2026-11-05', start: '08:00:00', timezone: 'Europe/Rome', region: 'ITF3', codespace: 'yutreno',
  operator: { name: 'YuTreno', url: 'https://github.com/nicola-amatucci/yutreno' },
};

/** Number shown to passengers for the controlled train, which has no service id */
export const CONTROLLED_NUMBER = 'R 2001';

/** Default position of lines without georeferencing (Campania) */
export const DEFAULT_GEO = { lat: 40.879, lon: 14.632, rotation_deg: 0 };
const R_EARTH = 6371008.8;

/** WGS84 position of a chainage of the line: local plan (x east, y north) rotated and placed at the line origin */
export function wgs84(L: CompiledLine, s: number): { lat: number; lon: number } {
  const [x, y] = xyOf(L, s);
  return wgs84xy(L, x, y);
}

/** WGS84 position of a point of the plan of a line (on a network, of the common plan, whose origin is that of the main line) */
export function wgs84xy(L: CompiledLine, x: number, y: number): { lat: number; lon: number } {
  const g = { ...DEFAULT_GEO, ...(L.def.geo ?? {}) };
  const [x0, y0] = xyOf(L, 0);
  const a = (g.rotation_deg ?? 0) * Math.PI / 180, dx = x - x0, dy = y - y0;
  const e = dx * Math.cos(a) - dy * Math.sin(a), n = dx * Math.sin(a) + dy * Math.cos(a);
  const lat = g.lat + n / R_EARTH * 180 / Math.PI;
  const lon = g.lon + e / (R_EARTH * Math.cos(g.lat * Math.PI / 180)) * 180 / Math.PI;
  return { lat: +lat.toFixed(7), lon: +lon.toFixed(7) };
}

/** Bearing (degrees clockwise from north) of a train running in direction dir at chainage s of the line */
export function bearing(L: CompiledLine, s: number, dir: 1 | -1): number {
  const a = wgs84(L, Math.max(0, s - 5)), b = wgs84(L, Math.min(L.len, s + 5));
  const dn = (b.lat - a.lat), de = (b.lon - a.lon) * Math.cos(a.lat * Math.PI / 180);
  let deg = Math.atan2(de, dn) * 180 / Math.PI;
  if (dir < 0) deg += 180;
  return +(((deg % 360) + 360) % 360).toFixed(1);
}

// ---------- calendar ----------

/** Offset (minutes) of the time zone from UTC at a UTC instant */
function tzOffset(utcMs: number, tz: string): number {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const p: Record<string, number> = {};
  for (const x of f.formatToParts(new Date(utcMs))) if (x.type !== 'literal') p[x.type] = +x.value;
  return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second) - Math.floor(utcMs / 1000) * 1000) / 60000);
}

/** Calendar of a service day: simulated time ↔ local time and instants */
export class ServiceCalendar {
  /** Seconds after local midnight of t = 0 */
  readonly t0: number;
  /**
   * UTC milliseconds of the origin of the times of the day: local noon minus 12 hours, as GTFS defines it. It is
   * local midnight except on the days of the change of time, where it keeps the times after the change equal to
   * the wall clock (08:00:00 is 08:00 of the clock on the last Sunday of March too).
   */
  readonly originUtc: number;
  constructor(readonly o: FeedOptions) {
    const [h, m, s] = o.start.split(':').map(Number);
    this.t0 = h * 3600 + m * 60 + (s || 0);
    const [Y, M, D] = o.date.split('-').map(Number);
    const noon = Date.UTC(Y, M - 1, D, 12) - tzOffset(Date.UTC(Y, M - 1, D, 12), o.timezone) * 60000;
    this.originUtc = noon - 12 * 3600000;
  }
  /** Seconds after local midnight of a simulated time */
  local(t: number): number { return this.t0 + t; }
  /** HH:MM:SS of a simulated time, beyond 24:00 for trips after midnight as GTFS and NeTEx allow */
  hms(t: number): string {
    const x = Math.round(this.local(t));
    return [Math.floor(x / 3600), Math.floor(x / 60) % 60, x % 60].map(v => String(v).padStart(2, '0')).join(':');
  }
  /** UTC milliseconds of a simulated time */
  utcMs(t: number): number { return this.originUtc + this.local(t) * 1000; }
  /** POSIX seconds of a simulated time */
  posix(t: number): number { return Math.round(this.utcMs(t) / 1000); }
  /** ISO 8601 local date-time with offset, as SIRI and NeTEx write it */
  iso(t: number): string {
    const ms = Math.round(this.utcMs(t) / 1000) * 1000, off = tzOffset(ms, this.o.timezone), d = new Date(ms + off * 60000);
    const p = (v: number, n = 2) => String(v).padStart(n, '0');
    const sign = off >= 0 ? '+' : '-', ao = Math.abs(off);
    return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}${sign}${p(Math.floor(ao / 60))}:${p(ao % 60)}`;
  }
  /** Service day as YYYYMMDD (GTFS) */
  get gtfsDate(): string { return this.o.date.replace(/-/g, ''); }
}

// ---------- identifiers ----------

export const slug = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase();

/** Identifiers in the form of the Italian NeTEx profile, used unchanged in GTFS and SIRI */
export class Ids {
  constructor(private o: FeedOptions, private L: CompiledLine) {}
  private id(type: string, local: string): string { return `IT:${this.o.region}:${type}:${this.o.codespace}:${local}`; }
  get operator(): string {
    const v = this.o.operator.vat;
    return v ? `IT:${this.o.region}:Operator:${v}:${this.o.codespace}:${this.o.codespace}` : this.id('Operator', this.o.codespace);
  }
  get line(): string { return this.id('Line', slug(this.L.def.name)); }
  /** A line of the feeds by its key (on a network, the lines a trip runs along) */
  lineOf(key: string): string { return this.id('Line', key); }
  get network(): string { return this.id('Network', slug(this.L.def.name)); }
  stopPlace(name: string): string { return this.id('StopPlace', slug(name)); }
  quay(name: string, dir: number): string { return this.id('Quay', slug(name) + (dir > 0 ? '-1' : '-2')); }
  stopPoint(name: string, dir: number): string { return this.id('ScheduledStopPoint', slug(name) + (dir > 0 ? '-1' : '-2')); }
  journey(trainId: string): string { return this.id('ServiceJourney', slug(trainId)); }
  pattern(dir: number, stops: string[]): string { return this.id('ServiceJourneyPattern', (dir > 0 ? 'out-' : 'in-') + stops.map(slug).join('_')); }
  route(dir: number, key = slug(this.L.def.name)): string { return this.id('Route', key + (dir > 0 ? '-out' : '-in')); }
  interchange(from: string, to: string, station: string): string { return this.id('ServiceJourneyInterchange', `${slug(from)}-${slug(to)}-${slug(station)}`); }
  get dayType(): string { return this.id('DayType', this.o.date); }
  vehicle(trainId: string): string { return this.id('Vehicle', slug(trainId)); }
}

// ---------- timetable and state ----------

export interface PlannedStop {
  name: string;
  /** Chainage of the line */
  s: number;
  /** Planned times: the timetable before any decision of the regulator */
  arr: number | null;
  dep: number | null;
  /** Current times, after the decisions of the regulator (equal to the planned ones without a regulator) */
  curArr: number | null;
  curDep: number | null;
  /** The regulator removed the stop (skipped, or after the station where a cancelled train ends) */
  skipped: boolean;
}
export interface Trip {
  run: TrainRun;
  /** Train number shown to passengers */
  number: string;
  /** Direction: on a line its direction; on a network, outbound when the trip starts on the lower line of the network */
  dir: 1 | -1;
  /** The line of the feeds the trip belongs to: on a network, the lines it runs along */
  line: { key: string; name: string };
  /** WGS84 position and bearing at a chainage of the trip (that of `stops[].s` and of `tripState().s`) */
  pos: (s: number) => { lat: number; lon: number };
  heading: (s: number) => number;
  /** Block of the rolling stock circulation, if any */
  block: string | null;
  stops: PlannedStop[];
  /** Cancelled by the regulator: entirely, or from a station on */
  cancelled: null | 'all' | 'partial';
}

/** Bearing (degrees clockwise from north) from point a to point b */
function bearingOf(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dn = (b.lat - a.lat), de = (b.lon - a.lon) * Math.cos(a.lat * Math.PI / 180);
  const deg = Math.atan2(de, dn) * 180 / Math.PI;
  return +(((deg % 360) + 360) % 360).toFixed(1);
}

/** A station of the feeds with its position: on a network, every station of every line, a node once */
export interface FeedStation { name: string; lat: number; lon: number }
export function feedStations(sim: Simulation): FeedStation[] {
  if (!sim.networked) return sim.L.st.map(st => ({ name: st.name, ...wgs84(sim.L, st.s) }));
  const out: FeedStation[] = [], seen = new Set<string>();
  for (const n of sim.net.lines) for (const st of n.L.st) {
    if (seen.has(st.name)) continue;
    seen.add(st.name);
    const [x, y] = xyOf(n.L, st.s);
    out.push({ name: st.name, ...wgs84xy(sim.L, x + n.dx, y + n.dy) });
  }
  return out;
}

/**
 * The trains of the run with their planned stops (and the current ones). On a line the chainages are those of the
 * line; on a network those of the corridor of each train, with the position from the common plan of the network
 */
export function trips(sim: Simulation, controlledNumber = CONTROLLED_NUMBER): Trip[] {
  const L = sim.L;
  // the feeds describe the passenger services: a freight train (the train ahead of the line) is not in them
  return sim.trains.filter(r => !r.freight).map(r => {
    let line: Trip['line'], dir: 1 | -1, pos: Trip['pos'], heading: Trip['heading'];
    if (!sim.networked) {
      line = { key: slug(L.def.name), name: L.def.name }; dir = r.dir;
      pos = s => wgs84(L, s); heading = s => bearing(L, s, r.dir);
    } else {
      const ls = [...new Set(r.legs.map(g => g.line))].sort((a, b) => a - b), net = sim.net.lines;
      line = { key: ls.map(j => slug(net[j].L.def.name)).join('+'), name: ls.map(j => net[j].L.def.name).join(' / ') };
      const first = r.legs[0], last = r.legs[r.legs.length - 1];
      dir = r.legs.length === 1 ? first.dir : first.line < last.line ? 1 : -1;
      // a corridor on one line has the plan of that line: it is moved into the common plan like the line
      const C = r.line, off = r.cor.sigRef ? { dx: 0, dy: 0 } : net[first.line];
      pos = s => { const [x, y] = xyOf(C, s); return wgs84xy(L, x + off.dx, y + off.dy); };
      heading = s => bearingOf(pos(Math.max(0, s - 5)), pos(Math.min(C.len, s + 5)));
    }
    return {
    run: r, number: r === sim.train ? controlledNumber : r.id, dir, line, pos, heading, block: r.block, cancelled: r.cancelled,
    stops: r.plan.map((st, i) => {
      const first = i === 0, last = i === r.plan.length - 1;
      const arr = first ? null : st.arr ?? st.dep, dep = last ? null : st.dep ?? st.arr;
      const cur = r.cancelled === 'all' ? undefined : r.stations.find(x => x.name === st.name);
      const curArr = cur && !first ? cur.arr ?? cur.dep : null, curDep = cur && !last ? cur.dep ?? (cur === r.stations[r.stations.length - 1] ? null : cur.arr) : null;
      return { name: st.name, s: sim.networked || r.dir > 0 ? st.s : sim.L.len - st.s, arr, dep, curArr, curDep, skipped: !cur };
    }),
    };
  });
}

/** Real-time state of a trip: position, stop sequence, actual and expected times at every stop */
export interface TripState {
  active: boolean;
  finished: boolean;
  /** Head in the chainages of the trip (those of the line, or of the corridor on a network) */
  s: number;
  speed: number;
  /** Index (0-based) of the stop the train is at or heading to */
  stopIndex: number;
  atStop: boolean;
  /** Current delay (s): of the last arrival or departure made, 0 before departure */
  delay: number;
  /** Actual times for the stops already made, expected for the others: planned + delay, never before the current timetable */
  times: { arr: number | null; dep: number | null; actualArr: boolean; actualDep: boolean }[];
}

export function tripState(sim: Simulation, trip: Trip): TripState {
  const r = trip.run, S = r.S;
  const s = sim.networked || r.dir > 0 ? S.s : sim.L.len - S.s;
  let delay = 0;
  const times = trip.stops.map((p, i) => {
    const re = r.realised.find(x => x.station === p.name);
    const arr = i === 0 ? null : re?.arrival_s ?? null, dep = re?.departure_s ?? null;
    if (arr != null && p.arr != null) delay = arr - p.arr;
    if (dep != null && p.dep != null) delay = dep - p.dep;
    return { arr, dep, actualArr: arr != null, actualDep: dep != null };
  });
  for (let i = 0; i < times.length; i++) {
    const p = trip.stops[i], x = times[i];
    if (p.skipped) { x.arr = null; x.dep = null; continue; }
    // the regulator may have moved a time later than the delay alone would: the current timetable is a lower bound
    if (!x.actualArr && p.arr != null) x.arr = Math.max(p.arr + Math.max(0, delay), p.curArr ?? -Infinity);
    // a train does not leave before its departure time: an early running is absorbed at the next stop
    if (!x.actualDep && p.dep != null && p.curDep != null) x.dep = Math.max(p.dep + Math.max(0, delay), p.curDep);
    if (!x.actualDep && p.curDep == null) x.dep = null;
  }
  // index in the plan of the stop the train is at or heading to
  const cur = r.stations[Math.min(r.stations.length - 1, Math.max(0, r.active ? S.nextSt : 0))];
  const stopIndex = Math.max(0, trip.stops.findIndex(p => p.name === cur?.name));
  return { active: r.active && !S.finished, finished: S.finished, s, speed: S.v, stopIndex, atStop: S.doors || (S.v < 0.1 && Math.abs(trip.stops[stopIndex].s - s) < 30), delay: Math.round(delay), times };
}

/** Escapes text for XML */
export const xml = (s: unknown): string => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string));
