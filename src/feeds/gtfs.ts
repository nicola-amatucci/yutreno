/**
 * GTFS static feed of the run: one agency, one route per line (on a network, per set of lines a trip runs along), the
 * trips of the controlled train and of the services, their blocks and the connections between them
 */
import type { Simulation } from '../core';
import { CONTROLLED_NUMBER, Ids, ServiceCalendar, feedStations, slug, trips, wgs84, type FeedOptions } from './model';

const csv = (rows: (string | number | null | undefined)[][]): string =>
  rows.map(r => r.map(v => { const x = v == null ? '' : String(v); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }).join(',')).join('\r\n') + '\r\n';

/** Files of the GTFS feed (name → content) */
export function gtfsFiles(sim: Simulation, o: FeedOptions, controlledNumber = CONTROLLED_NUMBER): Record<string, string> {
  const L = sim.L, cal = new ServiceCalendar(o), ids = new Ids(o, L), T = trips(sim, controlledNumber);
  const agencyId = o.codespace;
  const files: Record<string, string> = {};
  files['agency.txt'] = csv([['agency_id', 'agency_name', 'agency_url', 'agency_timezone', 'agency_lang'], [agencyId, o.operator.name, o.operator.url, o.timezone, 'it']]);
  // a station for every stop place, with a platform for each direction that has trips
  const dirs = [1, -1].filter(d => T.some(t => t.dir === d));
  const stops: (string | number)[][] = [['stop_id', 'stop_name', 'stop_lat', 'stop_lon', 'location_type', 'parent_station', 'platform_code']];
  for (const p of feedStations(sim)) {
    const st = p;
    stops.push([ids.stopPlace(st.name), st.name, p.lat, p.lon, 1, '', '']);
    for (const dir of dirs) stops.push([ids.quay(st.name, dir), st.name, p.lat, p.lon, 0, ids.stopPlace(st.name), dir > 0 ? '1' : '2']);
  }
  files['stops.txt'] = csv(stops);
  const lines = [...new Map(T.map(t => [t.line.key, t.line])).values()];
  files['routes.txt'] = csv([['route_id', 'agency_id', 'route_short_name', 'route_long_name', 'route_type'], ...lines.map(l => [ids.lineOf(l.key), agencyId, '', l.name, 2])]);
  files['calendar_dates.txt'] = csv([['service_id', 'date', 'exception_type'], [o.date, cal.gtfsDate, 1]]);
  // the block column only when some train has a block, so that the feeds of the runs without them do not change
  const blocks = T.some(t => t.block);
  const tr: (string | number)[][] = [['route_id', 'service_id', 'trip_id', 'trip_headsign', 'trip_short_name', 'direction_id', 'shape_id', ...(blocks ? ['block_id'] : [])]];
  // shapes: on a line one per direction; on a network one per line, direction and pair of ends of the trips
  const shapeOf = (t: (typeof T)[0]) => sim.networked ? `shape-${t.line.key}-${t.dir > 0 ? 0 : 1}-${slug(t.stops[0].name)}-${slug(t.stops[t.stops.length - 1].name)}` : 'shape-' + (t.dir > 0 ? 0 : 1);
  const st: (string | number)[][] = [['trip_id', 'arrival_time', 'departure_time', 'stop_id', 'stop_sequence', 'shape_dist_traveled']];
  for (const t of T) {
    const tid = ids.journey(t.number), last = t.stops[t.stops.length - 1];
    tr.push([ids.lineOf(t.line.key), o.date, tid, last.name, t.number, t.dir > 0 ? 0 : 1, shapeOf(t), ...(blocks ? [t.block ?? ''] : [])]);
    const s0 = t.stops[0].s;
    t.stops.forEach((p, i) => {
      const a = p.arr ?? p.dep, d = p.dep ?? p.arr;
      st.push([tid, cal.hms(a as number), cal.hms(d as number), ids.quay(p.name, t.dir), i + 1, Math.abs(p.s - s0).toFixed(1)]);
    });
  }
  files['trips.txt'] = csv(tr);
  files['stop_times.txt'] = csv(st);
  // shapes of the two directions, a point every 50 m, with distances measured from the first stop of each trip direction
  const sh: (string | number)[][] = [['shape_id', 'shape_pt_lat', 'shape_pt_lon', 'shape_pt_sequence', 'shape_dist_traveled']];
  const first = { 1: L.st[0]?.s ?? 0, [-1]: L.st[L.st.length - 1]?.s ?? L.len } as Record<number, number>;
  if (sim.networked) {
    // along the corridor of the first trip of each shape, from its first stop to its last one
    const done = new Set<string>();
    for (const t of T) {
      const id = shapeOf(t);
      if (done.has(id)) continue;
      done.add(id);
      const a = t.stops[0].s, b = t.stops[t.stops.length - 1].s, n = Math.max(2, Math.ceil(Math.abs(b - a) / 50) + 1);
      for (let k = 0; k < n; k++) { const s = a + (b - a) * k / (n - 1), p = t.pos(s); sh.push([id, p.lat, p.lon, k + 1, Math.abs(s - a).toFixed(1)]); }
    }
  }
  for (const dir of sim.networked ? [] : dirs) {
    const a = dir > 0 ? first[1] : first[-1], b = dir > 0 ? first[-1] : first[1];
    const n = Math.max(2, Math.ceil(Math.abs(b - a) / 50) + 1);
    for (let k = 0; k < n; k++) {
      const s = a + (b - a) * k / (n - 1), p = wgs84(L, s);
      sh.push(['shape-' + (dir > 0 ? 0 : 1), p.lat, p.lon, k + 1, Math.abs(s - a).toFixed(1)]);
    }
  }
  files['shapes.txt'] = csv(sh);
  // connections: a timed transfer, the departing train waits for the feeder (transfer_type 1)
  if (sim.connections.length) {
    const num = (r: (typeof T)[0]['run']) => (T.find(t => t.run === r) as (typeof T)[0]);
    files['transfers.txt'] = csv([['from_stop_id', 'to_stop_id', 'from_trip_id', 'to_trip_id', 'transfer_type', 'min_transfer_time'],
      ...sim.connections.map(c => { const f = num(c.from), t = num(c.to); return [ids.quay(c.station, f.dir), ids.quay(c.station, t.dir), ids.journey(f.number), ids.journey(t.number), 1, c.transfer]; })]);
  }
  files['feed_info.txt'] = csv([['feed_publisher_name', 'feed_publisher_url', 'feed_lang', 'feed_start_date', 'feed_end_date', 'feed_version', 'feed_contact_url'],
    [o.operator.name, o.operator.url, 'it', cal.gtfsDate, cal.gtfsDate, `${slug(L.def.name)}-${o.date}`, o.operator.url]]);
  return files;
}
