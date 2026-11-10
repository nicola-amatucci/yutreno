/**
 * Imports of timetables into service trains (`ServiceDef`): the parts common to the formats. Each format reader
 * produces raw trips (number, stops by name, local times of the day); this module matches the stops to the stations
 * of the line, turns times into seconds from the start of the run and drops what the line cannot run.
 */
import type { LineDef, ServiceDef, ServiceStopDef } from '../core';
import { slug } from './model';

export interface ImportOptions {
  /** Local time of t = 0, HH:MM:SS (default 08:00:00, the clock of the page) */
  start?: string;
  /** Service day YYYY-MM-DD: only trips running on that day (default: every trip) */
  date?: string;
  /** Line whose stations the stops are matched to; without it the names are kept as they are */
  line?: LineDef;
  /** Keep a trip identical to the timetable of the line, which is the controlled train (default false) */
  keepControlled?: boolean;
}

/** A trip as read from a file, before matching */
export interface RawTrip {
  number: string;
  stops: { name: string; arr: number | null; dep: number | null; minDwell?: number }[];
  /** Block of the rolling stock circulation (GTFS block_id) */
  block?: string;
}

export interface ImportResult {
  format: 'gtfs' | 'netex' | 'railml';
  services: ServiceDef[];
  /** What was dropped or adjusted, one line each */
  warnings: string[];
}

/** Seconds after local midnight of HH:MM:SS (hours beyond 24 allowed) */
export function secondsOf(hms: string): number {
  const m = /^\s*(\d+):(\d\d)(?::(\d\d)(?:\.\d+)?)?\s*$/.exec(hms);
  if (!m) throw new Error(`invalid time "${hms}"`);
  return +m[1] * 3600 + +m[2] * 60 + +(m[3] ?? 0);
}

/** Matches raw trips to the line and converts them into services */
export function toServices(raw: RawTrip[], o: ImportOptions, warnings: string[]): ServiceDef[] {
  const t0 = secondsOf(o.start ?? '08:00:00');
  const names = new Map((o.line?.stations ?? []).map(s => [slug(s.name), s.name]));
  const used = new Set<string>(), out: ServiceDef[] = [];
  for (const r of raw) {
    let stops = r.stops;
    if (o.line) {
      const off = stops.filter(s => !names.has(slug(s.name)));
      if (off.length) {
        stops = stops.filter(s => names.has(slug(s.name)));
        warnings.push(`${r.number}: stops not on the line dropped (${[...new Set(off.map(s => s.name))].join(', ')})`);
      }
    }
    if (stops.length < 2) { warnings.push(`${r.number}: fewer than two stops on the line, trip dropped`); continue; }
    const sv: ServiceStopDef[] = stops.map((s, i) => {
      const station = o.line ? names.get(slug(s.name)) as string : s.name;
      const first = i === 0, last = i === stops.length - 1;
      // a stop kept in the middle of a trip whose ends were outside the line still needs both times
      const arr = first ? null : s.arr ?? s.dep, dep = last ? null : s.dep ?? s.arr;
      const d: ServiceStopDef = { station };
      if (arr != null) d.arrival_s = arr - t0;
      if (dep != null) d.departure_s = dep - t0;
      if (s.minDwell != null) d.min_dwell_s = s.minDwell;
      return d;
    });
    if ((sv[0].departure_s ?? 0) < 0) { warnings.push(`${r.number}: departs before the start of the run (${o.start ?? '08:00:00'}), trip dropped`); continue; }
    if (o.line && !o.keepControlled && isLineTimetable(sv, o.line)) { warnings.push(`${r.number}: same timetable as the line, it is the controlled train: not imported as a service`); continue; }
    let id = r.number || 'trip';
    for (let k = 2; used.has(id); k++) id = `${r.number} (${k})`;
    if (id !== r.number) warnings.push(`${r.number}: number already used, imported as "${id}"`);
    used.add(id);
    out.push({ id, stops: sv, ...(r.block ? { block: r.block } : {}) });
  }
  return out;
}

/** True if a service runs the stations and times of the line timetable */
function isLineTimetable(sv: ServiceStopDef[], line: LineDef): boolean {
  const st = line.stations;
  if (sv.length !== st.length) return false;
  return sv.every((s, i) => s.station === st[i].name
    && (i === 0 || (s.arrival_s ?? null) === (st[i].arr ?? st[i].dep))
    && (i === st.length - 1 || (s.departure_s ?? null) === (st[i].dep ?? st[i].arr)));
}

/** Normal form of a service, for comparisons: intermediate stops with both times, no defaults written */
export function normalService(s: ServiceDef): ServiceDef {
  const n = s.stops.length;
  return {
    id: s.id, ...(s.block ? { block: s.block } : {}), stops: s.stops.map((p, i) => {
      const a = i === 0 ? null : p.arrival_s ?? p.departure_s ?? null, d = i === n - 1 ? null : p.departure_s ?? p.arrival_s ?? null;
      const q: ServiceStopDef = { station: p.station };
      if (a != null) q.arrival_s = a;
      if (d != null) q.departure_s = d;
      return q;
    }),
  };
}

/** Guesses the format of a file from its name and first bytes */
export function detectFormat(name: string, head: Uint8Array): 'gtfs' | 'netex' | 'railml' | null {
  if (head[0] === 0x50 && head[1] === 0x4b) return 'gtfs';
  const t = new TextDecoder().decode(head.subarray(0, 4096));
  if (/<(\w+:)?PublicationDelivery\b/.test(t)) return 'netex';
  if (/<(\w+:)?railml\b/i.test(t)) return 'railml';
  if (/\.zip$/i.test(name)) return 'gtfs';
  return null;
}
