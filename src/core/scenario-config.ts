/**
 * Scenario configuration (docs/SCENARIO_CONFIG.md): a short JSON that chooses the line and the number of service
 * trains, and that becomes a complete scenario. The services either follow the timetable of the line, repeated every
 * `headway_s` in one or both directions, or are taken from a real timetable extract (format
 * `yutreno-timetable-extract`, examples/infra/salerno-mercato-s-severino/timetable.json). Pure function: it depends
 * neither on the DOM nor on Node, so the page, the command line and the tests produce the same scenario.
 */
import type { LineDef, OnboardKind, Signalling, TracksideKind, Weather } from './types';
import type { ScenarioDef, ServiceDef, ServiceStopDef } from './scenario';
import { LINE_PRESETS, TRAIN_PRESETS, clone } from './presets';
import type { PassengerDef } from './passengers';

export interface ScenarioConfig {
  name?: string;
  description?: string;
  /** Id of a built-in line, or the line itself (the command line also accepts the path of a line.json) */
  line: string | LineDef;
  /** Id of a built-in train (default 'regional') for the controlled train and the services */
  train?: string;
  signalling?: Signalling;
  onboard?: OnboardKind;
  trackside?: TracksideKind;
  weather?: Weather;
  /** Train ahead of the controlled train on the line (default off) */
  leader?: boolean;
  trains: {
    /** Number of service trains, besides the controlled train */
    count: number;
    /** Departure of the first service from its origin (s from the start of the run; default: the controlled train's departure plus `headway_s`) */
    first_departure_s?: number;
    /** Time between two services of the same direction (s, default 600) */
    headway_s?: number;
    /** Directions of the services: 'forward' as the controlled train (default), 'backward', or 'both' alternating */
    directions?: 'forward' | 'backward' | 'both';
    /** With 'both': departure of the first backward service (default: `first_departure_s` plus half `headway_s`) */
    first_backward_departure_s?: number;
    /** Dwell at the intermediate stations (s, default that of the line timetable) */
    dwell_s?: number;
    /** Prefix of the train numbers (default 'R'); numbers are odd forward and even backward, from 101 */
    prefix?: string;
  };
  /**
   * Real timetable instead of the generated one: the first `trains.count` trips that leave at or after `from`.
   * The command line also accepts the path of the extract
   */
  timetable?: TimetableExtract | string;
  /** Time of day of a real timetable from which trips are taken ('HH:MM', default the first trip) */
  from?: string;
  /** With a real timetable: seconds of the run at which the first chosen trip leaves (default 300) */
  offset_s?: number;
  /** Passengers of the run, copied into the scenario (docs/PASSENGERS.md) */
  passengers?: PassengerDef;
}

export interface TimetableExtract {
  format: 'yutreno-timetable-extract';
  version: 1;
  source?: Record<string, string>;
  trips: { number: string; day_type?: string; stops: { station: string; arrival?: string; departure?: string }[] }[];
}

const words = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim().split(' ').filter(Boolean);

/**
 * Same station: the same words, where a word of one letter (an abbreviation such as «S.» for «San») matches a word
 * that starts with it. «MERCATO S.SEVERINO» is «Mercato San Severino», «SALERNO» is not «Salerno Irno»
 */
export function sameStation(a: string, b: string): boolean {
  const x = words(a), y = words(b);
  if (x.length !== y.length) return false;
  return x.every((w, i) => w === y[i] || (w.length === 1 && y[i].startsWith(w)) || (y[i].length === 1 && w.startsWith(y[i])));
}

const clock = (hhmm: string): number => {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(hhmm.trim());
  if (!m) throw new Error(`invalid time «${hhmm}» (HH:MM)`);
  return +m[1] * 3600 + +m[2] * 60 + (m[3] ? +m[3] : 0);
};

/** Checks a configuration; returns the errors (empty if valid) */
export function validateScenarioConfig(c: ScenarioConfig): string[] {
  const err: string[] = [];
  if (!c || typeof c !== 'object') return ['the configuration is not an object'];
  if (typeof c.line === 'string' ? !LINE_PRESETS[c.line] : !c.line || !Array.isArray(c.line.stations)) err.push(typeof c.line === 'string' ? `unknown line «${c.line}» (available: ${Object.keys(LINE_PRESETS).join(', ')})` : 'line: an id or a line');
  if (c.train != null && !TRAIN_PRESETS[c.train]) err.push(`unknown train «${c.train}» (available: ${Object.keys(TRAIN_PRESETS).join(', ')})`);
  const t = c.trains;
  if (!t || !Number.isInteger(t.count) || t.count < 0 || t.count > 200) err.push('trains.count: an integer from 0 to 200');
  else {
    if (t.headway_s != null && !(t.headway_s > 0)) err.push('trains.headway_s: a positive number of seconds');
    if (t.directions != null && !['forward', 'backward', 'both'].includes(t.directions)) err.push('trains.directions: forward, backward or both');
    if (t.dwell_s != null && !(t.dwell_s >= 0)) err.push('trains.dwell_s: zero or more seconds');
  }
  if (c.timetable != null && typeof c.timetable === 'object' && c.timetable.format !== 'yutreno-timetable-extract') err.push('timetable: format yutreno-timetable-extract expected');
  if (c.timetable != null && typeof c.timetable === 'string') err.push('timetable: the extract must be loaded (a path is read by the command line)');
  if (c.from != null) { try { clock(c.from); } catch (e) { err.push(`from: ${(e as Error).message}`); } }
  return err;
}

/** Services that repeat the timetable of the line */
function generated(line: LineDef, c: ScenarioConfig): ServiceDef[] {
  const t = c.trains, st = line.stations;
  if (st.length < 2) throw new Error('the line needs at least two stations');
  // running time of each stretch and dwell at each station, from the line timetable
  const run: number[] = [], dwell: number[] = [];
  for (let i = 0; i < st.length; i++) {
    const a = st[i].arr, d = st[i].dep;
    dwell.push(i === 0 || i === st.length - 1 ? 0 : t.dwell_s ?? (a != null && d != null ? Math.max(0, d - a) : 30));
    if (i > 0) {
      const prevDep = st[i - 1].dep ?? st[i - 1].arr;
      if (a == null || prevDep == null || a <= prevDep) throw new Error(`the line timetable has no running time between «${st[i - 1].name}» and «${st[i].name}»`);
      run.push(a - prevDep);
    }
  }
  const stops = (dep: number, backward: boolean): ServiceStopDef[] => {
    const order = backward ? st.map((_, i) => st.length - 1 - i) : st.map((_, i) => i);
    const out: ServiceStopDef[] = [];
    let time = dep;
    order.forEach((k, j) => {
      if (j > 0) time += run[backward ? k : k - 1];
      if (j === 0) out.push({ station: st[k].name, departure_s: time });
      else if (j === order.length - 1) out.push({ station: st[k].name, arrival_s: time });
      else { out.push({ station: st[k].name, arrival_s: time, departure_s: time + dwell[k] }); time += dwell[k]; }
    });
    return out;
  };
  const head = t.headway_s ?? 600;
  const first = t.first_departure_s ?? (st[0].dep ?? 0) + head;
  const firstBack = t.first_backward_departure_s ?? first + (t.directions === 'both' ? head / 2 : 0);
  const prefix = t.prefix ?? 'R';
  const out: ServiceDef[] = [];
  let fw = 0, bw = 0;
  for (let i = 0; i < t.count; i++) {
    const back = t.directions === 'backward' || (t.directions === 'both' && i % 2 === 1);
    const k = back ? bw++ : fw++;
    out.push({ id: `${prefix} ${back ? 102 + 2 * k : 101 + 2 * k}`, ...(c.train ? { train: c.train } : {}), stops: stops((back ? firstBack : first) + k * head, back) });
  }
  return out;
}

/** Services taken from a real timetable extract: the stations of the line, by name, in the order of each trip */
function fromTimetable(line: LineDef, tt: TimetableExtract, c: ScenarioConfig): ServiceDef[] {
  const pos = (name: string) => line.stations.findIndex(s => sameStation(s.name, name));
  const from = c.from != null ? clock(c.from) : -Infinity;
  const trips = tt.trips
    .map(tr => {
      const stops = tr.stops.filter(s => pos(s.station) >= 0);
      const t0 = stops.length ? clock(stops[0].departure ?? stops[0].arrival ?? '') : NaN;
      return { tr, stops, t0 };
    })
    .filter(x => x.stops.length >= 2 && x.t0 >= from)
    .sort((a, b) => a.t0 - b.t0 || a.tr.number.localeCompare(b.tr.number))
    .slice(0, c.trains.count);
  if (!trips.length) return [];
  const zero = trips[0].t0 - (c.offset_s ?? 300);
  return trips.map(({ tr, stops }) => {
    const idx = stops.map(s => pos(s.station));
    if (!idx.every((k, i) => i === 0 || Math.sign(k - idx[i - 1]) === Math.sign(idx[1] - idx[0]))) throw new Error(`trip ${tr.number}: the stops are not in the order of the line`);
    const n = stops.length;
    return {
      id: tr.number,
      ...(c.train ? { train: c.train } : {}),
      stops: stops.map((s, i) => {
        const arr = i > 0 ? clock(s.arrival ?? s.departure ?? '') - zero : null;
        const dep = i < n - 1 ? clock(s.departure ?? s.arrival ?? '') - zero : null;
        const out: ServiceStopDef = { station: line.stations[idx[i]].name };
        if (arr != null) out.arrival_s = arr;
        if (dep != null) out.departure_s = dep;
        return out;
      }),
    };
  });
}

/** Builds the scenario of a configuration (the timetable, if any, already loaded) */
export function scenarioFromConfig(c: ScenarioConfig): ScenarioDef {
  const err = validateScenarioConfig(c);
  if (err.length) throw new Error(err.join('; '));
  const line = typeof c.line === 'string' ? clone(LINE_PRESETS[c.line]) : c.line;
  const tt = c.timetable as TimetableExtract | undefined;
  const services = tt ? fromTimetable(line, tt, c) : generated(line, c);
  const what = tt
    ? `${services.length} trains of the real timetable${tt.source?.publisher ? ` (${tt.source.publisher})` : ''}`
    : `${services.length} service trains every ${c.trains.headway_s ?? 600} s (${c.trains.directions ?? 'forward'})`;
  return {
    name: c.name ?? `${line.name}: ${services.length} trains`,
    description: c.description ?? `Generated from a configuration: line ${line.name}, the controlled train and ${what}.`,
    line: c.line,
    train: c.train ?? 'regional',
    ...(c.signalling ? { signalling: c.signalling } : {}),
    ...(c.onboard ? { onboard: c.onboard } : {}),
    ...(c.trackside ? { trackside: c.trackside } : {}),
    ...(c.weather ? { weather: c.weather } : {}),
    leader: { on: c.leader ?? false },
    services,
    ...(c.passengers ? { passengers: c.passengers } : {}),
  };
}
