/**
 * GTFS static → service trains. Reads stops (a platform takes the name of its station), trips, stop times and the
 * calendar; with a service day keeps only the trips that run on it (calendar.txt with its exceptions in
 * calendar_dates.txt). Trips with frequencies are not expanded.
 */
import { secondsOf, toServices, type ImportOptions, type ImportResult, type RawTrip } from './import';

/** Parses a CSV file of GTFS (RFC 4180, BOM and CRLF allowed) into objects */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [], f = '', q = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(f); f = ''; rows.push(row); row = []; }
    else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  const [head, ...body] = rows.filter(r => r.length > 1 || r[0] !== '');
  if (!head) return [];
  const h = head.map(x => x.trim());
  return body.map(r => Object.fromEntries(h.map((k, i) => [k, (r[i] ?? '').trim()])));
}

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/** Services of a GTFS feed, given its files (name → text) */
export function importGtfs(files: Record<string, string>, o: ImportOptions = {}): ImportResult {
  const warnings: string[] = [];
  const need = (f: string) => { if (files[f] == null) throw new Error(`GTFS: ${f} missing`); return parseCsv(files[f]); };
  const stops = need('stops.txt'), trips = need('trips.txt'), times = need('stop_times.txt');
  const byId = new Map(stops.map(s => [s.stop_id, s]));
  const nameOf = (id: string): string => {
    const s = byId.get(id);
    if (!s) throw new Error(`GTFS: stop_times refers to unknown stop ${id}`);
    const p = s.parent_station ? byId.get(s.parent_station) : undefined;
    return (p ?? s).stop_name;
  };

  // service days
  let runs = (_: string) => true;
  if (o.date) {
    const ymd = o.date.replace(/-/g, ''), dow = DAYS[new Date(o.date + 'T12:00:00Z').getUTCDay()];
    const cal = files['calendar.txt'] != null ? parseCsv(files['calendar.txt']) : [];
    const ex = files['calendar_dates.txt'] != null ? parseCsv(files['calendar_dates.txt']) : [];
    const on = new Set(cal.filter(c => c.start_date <= ymd && ymd <= c.end_date && c[dow] === '1').map(c => c.service_id));
    for (const e of ex) if (e.date === ymd) { if (e.exception_type === '1') on.add(e.service_id); else on.delete(e.service_id); }
    runs = id => on.has(id);
  }
  if (files['frequencies.txt'] != null && parseCsv(files['frequencies.txt']).length) warnings.push('frequencies.txt ignored: trips with frequencies are imported once, at their stop times');

  const st = new Map<string, Record<string, string>[]>();
  for (const r of times) { const a = st.get(r.trip_id); if (a) a.push(r); else st.set(r.trip_id, [r]); }
  const raw: RawTrip[] = [];
  let skipped = 0;
  for (const t of trips) {
    if (!runs(t.service_id)) { skipped++; continue; }
    const rows = (st.get(t.trip_id) ?? []).sort((a, b) => +a.stop_sequence - +b.stop_sequence);
    // stops without times (interpolated by GTFS) and pick-up/drop-off "no" stays: the train still stops there
    const stopsWithTimes = rows.filter(r => r.arrival_time || r.departure_time);
    if (stopsWithTimes.length < rows.length) warnings.push(`${t.trip_short_name || t.trip_id}: ${rows.length - stopsWithTimes.length} stops without times dropped`);
    raw.push({
      number: t.trip_short_name || t.trip_id,
      ...(t.block_id ? { block: t.block_id } : {}),
      stops: stopsWithTimes.map(r => ({
        name: nameOf(r.stop_id),
        arr: r.arrival_time ? secondsOf(r.arrival_time) : null,
        dep: r.departure_time ? secondsOf(r.departure_time) : null,
      })),
    });
  }
  if (skipped) warnings.push(`${skipped} trips not running on ${o.date}`);
  return { format: 'gtfs', services: toServices(raw, o, warnings), warnings };
}
