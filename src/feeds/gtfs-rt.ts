/**
 * GTFS-Realtime feeds of the run: VehiclePositions and TripUpdates, as a JavaScript object with the field names of
 * gtfs-realtime.proto and encoded in protobuf by a small writer that follows the field numbers of the specification.
 */
import { occupancyLevel, type Simulation } from '../core';
import { CONTROLLED_NUMBER, Ids, ServiceCalendar, slug, trips, tripState, type FeedOptions } from './model';

export interface FeedMessage {
  header: { gtfs_realtime_version: string; incrementality: 'FULL_DATASET'; timestamp: number };
  entity: FeedEntity[];
}
interface TripDescriptor { trip_id: string; start_date: string; schedule_relationship: 'SCHEDULED' | 'CANCELED'; route_id: string; direction_id: number }
interface FeedEntity {
  id: string;
  vehicle?: {
    trip: TripDescriptor; vehicle: { id: string; label: string };
    position: { latitude: number; longitude: number; bearing: number; odometer: number; speed: number };
    current_stop_sequence: number; stop_id: string; current_status: 'INCOMING_AT' | 'STOPPED_AT' | 'IN_TRANSIT_TO'; timestamp: number;
    /** With passengers (docs/PASSENGERS.md) */
    occupancy_status?: 'EMPTY' | 'MANY_SEATS_AVAILABLE' | 'FEW_SEATS_AVAILABLE' | 'STANDING_ROOM_ONLY' | 'CRUSHED_STANDING_ROOM_ONLY' | 'FULL'; occupancy_percentage?: number;
  };
  trip_update?: {
    trip: TripDescriptor; vehicle: { id: string; label: string }; timestamp: number; delay: number;
    stop_time_update: StopTimeUpdate[];
  };
}
interface StopTimeUpdate { stop_sequence: number; stop_id: string; arrival?: { delay: number; time: number }; departure?: { delay: number; time: number }; schedule_relationship?: 'SKIPPED' }

/** VehiclePositions (kind 'vehicles') or TripUpdates (kind 'trips') at the current time of the run */
export function gtfsRealtime(sim: Simulation, o: FeedOptions, kind: 'vehicles' | 'trips', controlledNumber = CONTROLLED_NUMBER): FeedMessage {
  const L = sim.L, cal = new ServiceCalendar(o), ids = new Ids(o, L), now = cal.posix(sim.time);
  const entity: FeedEntity[] = [];
  for (const t of trips(sim, controlledNumber)) {
    const st = tripState(sim, t);
    if (kind === 'vehicles' && !st.active) continue;
    // a train cancelled entirely is published as such; the other finished trains without a run are not
    if (kind === 'trips' && st.finished && !t.run.realised.length && t.cancelled !== 'all') continue;
    const trip: TripDescriptor = { trip_id: ids.journey(t.number), start_date: cal.gtfsDate, schedule_relationship: t.cancelled === 'all' ? 'CANCELED' : 'SCHEDULED', route_id: ids.lineOf(t.line.key), direction_id: t.dir > 0 ? 0 : 1 };
    const vehicle = { id: ids.vehicle(t.number), label: t.number };
    if (kind === 'vehicles') {
      const p = t.pos(st.s), stop = t.stops[st.stopIndex];
      entity.push({
        id: 'vp-' + slug(t.number), vehicle: {
          trip, vehicle, position: { latitude: p.lat, longitude: p.lon, bearing: t.heading(st.s), odometer: +Math.abs(st.s - t.stops[0].s).toFixed(1), speed: +st.speed.toFixed(2) },
          current_stop_sequence: st.stopIndex + 1, stop_id: ids.quay(stop.name, t.dir),
          current_status: st.atStop ? 'STOPPED_AT' : Math.abs(stop.s - st.s) < 400 ? 'INCOMING_AT' : 'IN_TRANSIT_TO', timestamp: now,
          ...occupancy(sim, t.run.id),
        },
      });
    } else {
      // a cancelled trip carries no stop time updates; a stop removed by the regulator is SKIPPED
      const upd = t.cancelled === 'all' ? [] : t.stops.map((p, i) => {
        const x = st.times[i], u: StopTimeUpdate = { stop_sequence: i + 1, stop_id: ids.quay(p.name, t.dir) };
        if (p.skipped) { u.schedule_relationship = 'SKIPPED'; return u; }
        if (i > 0 && p.arr != null && x.arr != null) u.arrival = { delay: Math.round(x.arr - p.arr), time: cal.posix(x.arr) };
        if (i < t.stops.length - 1 && p.dep != null && x.dep != null) u.departure = { delay: Math.round(x.dep - p.dep), time: cal.posix(x.dep) };
        return u;
      });
      entity.push({ id: 'tu-' + slug(t.number), trip_update: { trip, vehicle, timestamp: now, delay: st.delay, stop_time_update: upd } });
    }
  }
  return { header: { gtfs_realtime_version: '2.0', incrementality: 'FULL_DATASET', timestamp: now }, entity };
}

// ---------- protobuf ----------

class W {
  b: number[] = [];
  varint(v: number): void { let x = BigInt.asUintN(64, BigInt(Math.trunc(v))); while (x > 127n) { this.b.push(Number(x & 127n) | 128); x >>= 7n; } this.b.push(Number(x)); }
  key(f: number, wt: number): void { this.varint(f * 8 + wt); }
  uint(f: number, v: number): void { this.key(f, 0); this.varint(v); }
  int(f: number, v: number): void { this.key(f, 0); this.varint(v); }
  str(f: number, s: string): void { const e = new TextEncoder().encode(s); this.key(f, 2); this.varint(e.length); this.b.push(...e); }
  float(f: number, v: number): void { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, v, true); this.key(f, 5); this.b.push(...new Uint8Array(d.buffer)); }
  double(f: number, v: number): void { const d = new DataView(new ArrayBuffer(8)); d.setFloat64(0, v, true); this.key(f, 1); this.b.push(...new Uint8Array(d.buffer)); }
  msg(f: number, w: W): void { this.key(f, 2); this.varint(w.b.length); this.b.push(...w.b); }
}
const OCCUPANCY = ['EMPTY', 'MANY_SEATS_AVAILABLE', 'FEW_SEATS_AVAILABLE', 'STANDING_ROOM_ONLY', 'CRUSHED_STANDING_ROOM_ONLY', 'FULL'] as const;
const LEVELS = ['empty', 'manySeatsAvailable', 'fewSeatsAvailable', 'standingRoomOnly', 'crushedStandingRoomOnly', 'full'] as const;

/** With passengers: occupancy status and percentage of the seats taken (OccupancyStatus, occupancy_percentage) */
function occupancy(sim: Simulation, id: string): { occupancy_status?: (typeof OCCUPANCY)[number]; occupancy_percentage?: number } {
  const cap = sim.pax?.capacity(id);
  if (!sim.pax || !cap) return {};
  const n = sim.pax.onboard(id);
  return { occupancy_status: OCCUPANCY[LEVELS.indexOf(occupancyLevel(n, cap))], occupancy_percentage: Math.round(n / Math.max(1, cap.seats) * 100) };
}

const ENUM: Record<string, number> = { FULL_DATASET: 0, SCHEDULED: 0, CANCELED: 3, SKIPPED: 1, INCOMING_AT: 0, STOPPED_AT: 1, IN_TRANSIT_TO: 2 };

function tripW(t: TripDescriptor): W {
  const w = new W(); w.str(1, t.trip_id); w.str(3, t.start_date); w.uint(4, ENUM[t.schedule_relationship]); w.str(5, t.route_id); w.uint(6, t.direction_id); return w;
}
function vehW(v: { id: string; label: string }): W { const w = new W(); w.str(1, v.id); w.str(2, v.label); return w; }

/** Encodes a FeedMessage in the protobuf wire format of gtfs-realtime.proto */
export function encodeFeed(m: FeedMessage): Uint8Array {
  const root = new W(), h = new W();
  h.str(1, m.header.gtfs_realtime_version); h.uint(2, ENUM[m.header.incrementality]); h.uint(3, m.header.timestamp);
  root.msg(1, h);
  for (const e of m.entity) {
    const we = new W(); we.str(1, e.id);
    if (e.trip_update) {
      const tu = e.trip_update, w = new W();
      w.msg(1, tripW(tu.trip));
      for (const u of tu.stop_time_update) {
        const ws = new W(); ws.uint(1, u.stop_sequence);
        for (const [f, ev] of [[2, u.arrival], [3, u.departure]] as const) if (ev) { const x = new W(); x.int(1, ev.delay); x.int(2, ev.time); ws.msg(f, x); }
        ws.str(4, u.stop_id); ws.uint(5, u.schedule_relationship ? ENUM[u.schedule_relationship] : 0);
        w.msg(2, ws);
      }
      w.msg(3, vehW(tu.vehicle)); w.uint(4, tu.timestamp); w.int(5, tu.delay);
      we.msg(3, w);
    }
    if (e.vehicle) {
      const v = e.vehicle, w = new W(), p = new W();
      w.msg(1, tripW(v.trip));
      p.float(1, v.position.latitude); p.float(2, v.position.longitude); p.float(3, v.position.bearing); p.double(4, v.position.odometer); p.float(5, v.position.speed);
      w.msg(2, p); w.uint(3, v.current_stop_sequence); w.uint(4, ENUM[v.current_status]); w.uint(5, v.timestamp); w.str(7, v.stop_id); w.msg(8, vehW(v.vehicle));
      if (v.occupancy_status) { w.uint(9, OCCUPANCY.indexOf(v.occupancy_status)); w.uint(10, v.occupancy_percentage ?? 0); }
      we.msg(4, w);
    }
    root.msg(2, we);
  }
  return new Uint8Array(root.b);
}
