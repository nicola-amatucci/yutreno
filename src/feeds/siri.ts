/**
 * SIRI 2.x real-time deliveries of the run: Vehicle Monitoring (positions) and Estimated Timetable (actual and
 * expected times of every journey). The identifiers are those of the NeTEx timetable (Italian profile), so a
 * consumer joins the two without tables of correspondence. Element order follows the SIRI 2.1 schema.
 */
import { occupancyLevel, type Simulation } from '../core';
import { CONTROLLED_NUMBER, Ids, ServiceCalendar, trips, tripState, xml, type FeedOptions, type Trip } from './model';

/**
 * Filters of a SIRI Lite request, as in the dynamic RAP interface of the Italian profile (/siri-lite/...): line,
 * operator, dataset (the codespace, agencyCode of the static RAP) and maximum number of items; a filter that does not
 * match gives an empty delivery.
 */
export interface SiriQuery { LineRef?: string; OperatorRef?: string; datasetId?: string; maxSize?: number }

/** Trips selected by a query */
function selected(sim: Simulation, o: FeedOptions, ids: Ids, q: SiriQuery, controlledNumber: string): Trip[] {
  if ((q.datasetId && q.datasetId !== o.codespace) || (q.OperatorRef && q.OperatorRef !== ids.operator)) return [];
  return trips(sim, controlledNumber).filter(t => !q.LineRef || q.LineRef === ids.lineOf(t.line.key));
}

/** ISO 8601 duration of a signed number of seconds, as SIRI writes Delay */
const duration = (s: number): string => (s < 0 ? '-' : '') + 'PT' + Math.abs(Math.round(s)) + 'S';

/** Journey identity; in SIRI-ET the operator follows the journey ends, in SIRI-VM it precedes them */
function head(sim: Simulation, o: FeedOptions, ids: Ids, t: Trip, et: boolean): string {
  const first = t.stops[0], last = t.stops[t.stops.length - 1];
  return `<LineRef>${ids.lineOf(t.line.key)}</LineRef>`
    + `<DirectionRef>${t.dir > 0 ? 'outbound' : 'inbound'}</DirectionRef>`
    + `<FramedVehicleJourneyRef><DataFrameRef>${o.date}</DataFrameRef><DatedVehicleJourneyRef>${ids.journey(t.number)}</DatedVehicleJourneyRef></FramedVehicleJourneyRef>`
    // a journey cancelled entirely (EstimatedTimetableAlterationGroup, after the reference to the journey)
    + (et && t.cancelled === 'all' ? '<Cancellation>true</Cancellation>' : '')
    + `<JourneyPatternRef>${ids.pattern(t.dir, t.stops.map(p => p.name))}</JourneyPatternRef>`
    + `<VehicleMode>rail</VehicleMode>`
    + `<PublishedLineName>${xml(t.line.name)}</PublishedLineName>`
    + (et ? '' : `<OperatorRef>${ids.operator}</OperatorRef>`)
    + `<OriginRef>${ids.stopPoint(first.name, t.dir)}</OriginRef><OriginName>${xml(first.name)}</OriginName>`
    + `<DestinationRef>${ids.stopPoint(last.name, t.dir)}</DestinationRef><DestinationName>${xml(last.name)}</DestinationName>`
    + (et ? `<OperatorRef>${ids.operator}</OperatorRef>` : '')
    + `<VehicleJourneyName>${xml(t.number)}</VehicleJourneyName>`;
}

function envelope(cal: ServiceCalendar, sim: Simulation, o: FeedOptions, body: string): string {
  const now = cal.iso(sim.time);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Siri xmlns="http://www.siri.org.uk/siri" version="2.1"><ServiceDelivery>`
    + `<ResponseTimestamp>${now}</ResponseTimestamp><ProducerRef>${xml(o.codespace)}</ProducerRef>${body}</ServiceDelivery></Siri>\n`;
}

/** SIRI-VM: one VehicleActivity per train running */
export function siriVehicleMonitoring(sim: Simulation, o: FeedOptions, q: SiriQuery = {}, controlledNumber = CONTROLLED_NUMBER): string {
  const L = sim.L, cal = new ServiceCalendar(o), ids = new Ids(o, L), now = cal.iso(sim.time);
  let acts = '';
  let n = 0;
  for (const t of selected(sim, o, ids, q, controlledNumber)) {
    if (q.maxSize != null && n >= q.maxSize) break;
    const st = tripState(sim, t);
    if (!st.active) continue;
    n++;
    const p = t.pos(st.s), stop = t.stops[st.stopIndex], x = st.times[st.stopIndex];
    const prev = t.stops[Math.max(0, st.stopIndex - 1)], link = Math.abs(stop.s - prev.s), done = Math.abs(st.s - prev.s);
    const call = `<MonitoredCall><StopPointRef>${ids.stopPoint(stop.name, t.dir)}</StopPointRef><VisitNumber>1</VisitNumber><Order>${st.stopIndex + 1}</Order>`
      + `<StopPointName>${xml(stop.name)}</StopPointName><VehicleAtStop>${st.atStop}</VehicleAtStop>`
      + (stop.arr != null ? `<AimedArrivalTime>${cal.iso(stop.arr)}</AimedArrivalTime>` + (x.arr != null ? `<${x.actualArr ? 'Actual' : 'Expected'}ArrivalTime>${cal.iso(x.arr)}</${x.actualArr ? 'Actual' : 'Expected'}ArrivalTime>` : '') : '')
      + (stop.dep != null ? `<AimedDepartureTime>${cal.iso(stop.dep)}</AimedDepartureTime>` + (x.dep != null ? `<${x.actualDep ? 'Actual' : 'Expected'}DepartureTime>${cal.iso(x.dep)}</${x.actualDep ? 'Actual' : 'Expected'}DepartureTime>` : '') : '')
      + `</MonitoredCall>`;
    acts += `<VehicleActivity><RecordedAtTime>${now}</RecordedAtTime><ValidUntilTime>${cal.iso(sim.time + 30)}</ValidUntilTime>`
      + `<ProgressBetweenStops><LinkDistance>${link.toFixed(0)}</LinkDistance><Percentage>${link > 0 ? Math.min(100, done / link * 100).toFixed(1) : '100'}</Percentage></ProgressBetweenStops>`
      + `<MonitoredVehicleJourney>${head(sim, o, ids, t, false)}<Monitored>true</Monitored>`
      + `<VehicleLocation><Longitude>${p.lon}</Longitude><Latitude>${p.lat}</Latitude></VehicleLocation>`
      + `<Bearing>${t.heading(st.s)}</Bearing><Velocity>${Math.round(st.speed)}</Velocity><Delay>${duration(st.delay)}</Delay>`
      + `<VehicleRef>${ids.vehicle(t.number)}</VehicleRef>${call}</MonitoredVehicleJourney></VehicleActivity>`;
  }
  return envelope(cal, sim, o, `<VehicleMonitoringDelivery version="2.1"><ResponseTimestamp>${now}</ResponseTimestamp>${acts}</VehicleMonitoringDelivery>`);
}

/**
 * With passengers (docs/PASSENGERS.md): who alighted, boarded and stayed on board when the train left a stop, as
 * RecordedDepartureOccupancy of SIRI 2.1 (level, percentage of the seats, alighting, boarding and on board counts)
 */
function departureOccupancy(sim: Simulation, trainId: string, station: string): string {
  const x = sim.pax?.stopOf(trainId, station), cap = sim.pax?.capacity(trainId);
  if (!x || !cap) return '';
  const n = (v: number) => Math.max(0, Math.round(v));
  return `<RecordedDepartureOccupancy><OccupancyLevel>${occupancyLevel(x.onboard, cap)}</OccupancyLevel>`
    + `<OccupancyPercentage>${(x.onboard / Math.max(1, cap.seats) * 100).toFixed(1)}</OccupancyPercentage>`
    + `<AlightingCount>${n(x.alighted)}</AlightingCount><BoardingCount>${n(x.boarded)}</BoardingCount><OnboardCount>${n(x.onboard)}</OnboardCount></RecordedDepartureOccupancy>`;
}

/** SIRI-ET: every journey of the day, stops made as RecordedCalls and the others as EstimatedCalls */
export function siriEstimatedTimetable(sim: Simulation, o: FeedOptions, q: SiriQuery = {}, controlledNumber = CONTROLLED_NUMBER): string {
  const L = sim.L, cal = new ServiceCalendar(o), ids = new Ids(o, L), now = cal.iso(sim.time);
  let journeys = '';
  let n = 0;
  for (const t of selected(sim, o, ids, q, controlledNumber)) {
    if (q.maxSize != null && n >= q.maxSize) break;
    const st = tripState(sim, t);
    n++;
    let rec = '', est = '';
    t.stops.forEach((p, i) => {
      const x = st.times[i];
      // made: left, or arrived where the train ends (the last stop, or the one where a cancelled train ends)
      const made = x.actualDep || (x.actualArr && (i === t.stops.length - 1 || (p.curDep == null && !p.skipped)));
      let c = `<StopPointRef>${ids.stopPoint(p.name, t.dir)}</StopPointRef><VisitNumber>1</VisitNumber><Order>${i + 1}</Order><StopPointName>${xml(p.name)}</StopPointName>`;
      if (p.skipped || t.cancelled === 'all') {
        // a call removed by the regulator: cancelled, with the aimed times only
        c += '<Cancellation>true</Cancellation>';
        if (p.arr != null) c += `<AimedArrivalTime>${cal.iso(p.arr)}</AimedArrivalTime>`;
        if (p.dep != null) c += `<AimedDepartureTime>${cal.iso(p.dep)}</AimedDepartureTime>`;
        est += `<EstimatedCall>${c}</EstimatedCall>`;
      } else if (made) {
        if (p.arr != null) c += `<AimedArrivalTime>${cal.iso(p.arr)}</AimedArrivalTime>` + (x.arr != null ? `<ActualArrivalTime>${cal.iso(x.arr)}</ActualArrivalTime>` : '');
        if (p.dep != null) c += `<AimedDepartureTime>${cal.iso(p.dep)}</AimedDepartureTime>` + (x.dep != null ? `<ActualDepartureTime>${cal.iso(x.dep)}</ActualDepartureTime>` : '');
        if (p.dep != null && x.dep != null) c += departureOccupancy(sim, t.run.id, p.name);
        rec += `<RecordedCall>${c}</RecordedCall>`;
      } else {
        // an arrival already made at a stop not yet left stays an expected time equal to the actual one
        if (p.arr != null) c += `<AimedArrivalTime>${cal.iso(p.arr)}</AimedArrivalTime>` + (x.arr != null ? `<ExpectedArrivalTime>${cal.iso(x.arr)}</ExpectedArrivalTime>` : '');
        if (p.dep != null) c += `<AimedDepartureTime>${cal.iso(p.dep)}</AimedDepartureTime>` + (x.dep != null ? `<ExpectedDepartureTime>${cal.iso(Math.max(x.dep, sim.time))}</ExpectedDepartureTime>` : '');
        est += `<EstimatedCall>${c}</EstimatedCall>`;
      }
    });
    journeys += `<EstimatedVehicleJourney>${head(sim, o, ids, t, true)}<Monitored>true</Monitored><VehicleRef>${ids.vehicle(t.number)}</VehicleRef>`
      + (rec ? `<RecordedCalls>${rec}</RecordedCalls>` : '') + (est ? `<EstimatedCalls>${est}</EstimatedCalls>` : '')
      + `<IsCompleteStopSequence>true</IsCompleteStopSequence></EstimatedVehicleJourney>`;
  }
  return envelope(cal, sim, o, `<EstimatedTimetableDelivery version="2.1"><ResponseTimestamp>${now}</ResponseTimestamp>`
    + `<EstimatedJourneyVersionFrame><RecordedAtTime>${now}</RecordedAtTime>${journeys}</EstimatedJourneyVersionFrame></EstimatedTimetableDelivery>`);
}
