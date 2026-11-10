/**
 * NeTEx timetable of the run in the Italian profile of the European Passenger Information Profile (EPIP):
 * a PublicationDelivery with one CompositeFrame of type EU_PI_LINE_OFFER, containing the calendar (one day type for
 * the service day), the operator, the stations with one quay per direction, the line with its two routes,
 * scheduled stop points, stop assignments and journey patterns, and the planned service journeys. Identifiers
 * follow the pattern IT:<NUTS region>:<type>:<codespace>:<local id> of the profile, and are the same ones used in
 * GTFS and SIRI.
 */
import type { Simulation } from '../core';
import { CONTROLLED_NUMBER, Ids, ServiceCalendar, feedStations, trips, xml, type FeedOptions, type Trip } from './model';

const V = 'version="1"';
const ref = (tag: string, id: string): string => `<${tag} ref="${xml(id)}" ${V}/>`;
/** Type of frame of the EPIP profile, referenced by version as in the examples of the Italian profile */
const frameType = (t: string): string => `<TypeOfFrameRef ref="epip:${t}" versionRef="1"/>`;

/** Time of day and day offset of a simulated time, as NeTEx writes times after midnight */
function time(cal: ServiceCalendar, t: number): { hms: string; offset: number } {
  const x = Math.round(cal.local(t)), offset = Math.floor(x / 86400), r = x - offset * 86400;
  const hms = [Math.floor(r / 3600), Math.floor(r / 60) % 60, r % 60].map(v => String(v).padStart(2, '0')).join(':');
  return { hms, offset };
}

/** The NeTEx PublicationDelivery (XML) of the planned timetable of the run */
export function netexTimetable(sim: Simulation, o: FeedOptions, controlledNumber = CONTROLLED_NUMBER): string {
  const L = sim.L, cal = new ServiceCalendar(o), ids = new Ids(o, L), T = trips(sim, controlledNumber);
  const R = `IT:${o.region}`, frame = (kind: string) => `epd:${R}:${kind}:${xml(o.codespace)}`;
  // local times of the service day, in the time zone of the frame defaults
  const midnight = `${o.date}T00:00:00`, endOfDay = `${o.date}T23:59:59`;

  // calendar: one day type, valid on the service day
  const calendarFrame = `<ServiceCalendarFrame id="${frame('ServiceCalendarFrame_EU_PI_CALENDAR')}" ${V}>${frameType('EU_PI_CALENDAR')}`
    + `<ServiceCalendar id="${R}:ServiceCalendar:${xml(o.codespace)}:${o.date}" ${V}><Name>${xml(o.date)}</Name><FromDate>${o.date}</FromDate><ToDate>${o.date}</ToDate>`
    + `<dayTypes><DayType id="${ids.dayType}" ${V}><Name>${xml(o.date)}</Name></DayType></dayTypes>`
    + `<dayTypeAssignments><DayTypeAssignment id="${R}:DayTypeAssignment:${xml(o.codespace)}:${o.date}" order="1" ${V}><Date>${o.date}</Date>${ref('DayTypeRef', ids.dayType)}</DayTypeAssignment></dayTypeAssignments>`
    + `</ServiceCalendar></ServiceCalendarFrame>`;

  const resourceFrame = `<ResourceFrame id="${frame('ResourceFrame_EU_PI_COMMON')}" ${V}>${frameType('EU_PI_COMMON')}`
    + `<organisations><Operator id="${ids.operator}" ${V}><Name>${xml(o.operator.name)}</Name>`
    + `<ContactDetails>${o.operator.phone ? `<Phone>${xml(o.operator.phone)}</Phone>` : ''}<Url>${xml(o.operator.url)}</Url></ContactDetails>`
    + `<OrganisationType>railOperator</OrganisationType></Operator></organisations></ResourceFrame>`;

  // stations: one stop place per station, one quay per running direction (platform 1 and 2)
  const stations = feedStations(sim);
  const loc = (p: { lat: number; lon: number }) => `<Centroid><Location><Longitude>${p.lon}</Longitude><Latitude>${p.lat}</Latitude></Location></Centroid>`;
  const siteFrame = `<SiteFrame id="${frame('SiteFrame_EU_PI_STOP')}" ${V}>${frameType('EU_PI_STOP')}<stopPlaces>`
    + stations.map(st => `<StopPlace id="${ids.stopPlace(st.name)}" ${V}><Name>${xml(st.name)}</Name>${loc(st)}`
      + `<TransportMode>rail</TransportMode><StopPlaceType>railStation</StopPlaceType><quays>`
      + [1, -1].map(dir => `<Quay id="${ids.quay(st.name, dir)}" ${V}><Name>${xml(st.name)} – binario ${dir > 0 ? 1 : 2}</Name>${loc(st)}`
        + `<PublicCode>${dir > 0 ? 1 : 2}</PublicCode><QuayType>railPlatform</QuayType></Quay>`).join('')
      + `</quays></StopPlace>`).join('')
    + `</stopPlaces></SiteFrame>`;

  // journey patterns: one per direction and sequence of stops
  const patterns = new Map<string, Trip>();
  for (const t of T) { const id = ids.pattern(t.dir, t.stops.map(p => p.name)); if (!patterns.has(id)) patterns.set(id, t); }
  const spijp = (pattern: string, i: number) => pattern.replace(':ServiceJourneyPattern:', ':StopPointInJourneyPattern:') + '-' + (i + 1);
  // one line of the feeds per line (on a network, per set of lines the trips run along), a route per line and direction
  const lines = [...new Map(T.map(t => [t.line.key, t.line])).values()];
  const routes = lines.flatMap(l => [...new Set(T.filter(t => t.line.key === l.key).map(t => t.dir))].sort((a, b) => b - a).map(dir => ({ l, dir })));
  const serviceFrame = `<ServiceFrame id="${frame('ServiceFrame_EU_PI_NETWORK')}" ${V}>${frameType('EU_PI_NETWORK')}`
    + `<Network id="${ids.network}" ${V}><Name>${xml(sim.networked ? sim.net.name : L.def.name)}</Name></Network>`
    + `<routes>` + routes.map(({ l, dir }) => `<Route id="${ids.route(dir, l.key)}" ${V}><Name>${xml(l.name)} (${dir > 0 ? 'andata' : 'ritorno'})</Name>`
      + `${ref('LineRef', ids.lineOf(l.key))}<DirectionType>${dir > 0 ? 'outbound' : 'inbound'}</DirectionType></Route>`).join('') + `</routes>`
    + `<lines>` + lines.map(l => `<Line id="${ids.lineOf(l.key)}" ${V}><Name>${xml(l.name)}</Name><TransportMode>rail</TransportMode>`
      + `<PublicCode>${xml(l.name)}</PublicCode>${ref('OperatorRef', ids.operator)}</Line>`).join('') + `</lines>`
    + `<scheduledStopPoints>` + stations.flatMap(p => [1, -1].map(dir => {
      const st = p;
      return `<ScheduledStopPoint id="${ids.stopPoint(st.name, dir)}" ${V}><Name>${xml(st.name)}</Name><Location><Longitude>${p.lon}</Longitude><Latitude>${p.lat}</Latitude></Location><StopType>railStation</StopType></ScheduledStopPoint>`;
    })).join('') + `</scheduledStopPoints>`
    + `<stopAssignments>` + stations.flatMap((st, k) => [1, -1].map((dir, j) =>
      `<PassengerStopAssignment id="${ids.stopPoint(st.name, dir).replace(':ScheduledStopPoint:', ':PassengerStopAssignment:')}" order="${2 * k + j + 1}" ${V}>`
      + ref('ScheduledStopPointRef', ids.stopPoint(st.name, dir)) + ref('StopPlaceRef', ids.stopPlace(st.name)) + ref('QuayRef', ids.quay(st.name, dir))
      + `</PassengerStopAssignment>`)).join('') + `</stopAssignments>`
    + `<journeyPatterns>` + [...patterns].map(([id, t]) => `<ServiceJourneyPattern id="${id}" ${V}>`
      + `<Name>${xml(t.stops[0].name)} – ${xml(t.stops[t.stops.length - 1].name)}</Name>`
      + `<RouteView>${ref('LineRef', ids.lineOf(t.line.key))}</RouteView><pointsInSequence>`
      + t.stops.map((p, i) => `<StopPointInJourneyPattern id="${spijp(id, i)}" order="${i + 1}" ${V}>${ref('ScheduledStopPointRef', ids.stopPoint(p.name, t.dir))}`
        + (i === 0 ? '<ForAlighting>false</ForAlighting>' : '') + (i === t.stops.length - 1 ? '<ForBoarding>false</ForBoarding>' : '') + `</StopPointInJourneyPattern>`).join('')
      + `</pointsInSequence></ServiceJourneyPattern>`).join('') + `</journeyPatterns>`
    + `</ServiceFrame>`;

  // the train number shown to passengers, in the TrainNumber that every journey references
  const tn = (jid: string) => jid.replace(':ServiceJourney:', ':TrainNumber:');
  const trainNumbers = T.map(t => `<TrainNumber id="${tn(ids.journey(t.number))}" ${V}><ForAdvertisement>${xml(t.number)}</ForAdvertisement></TrainNumber>`).join('');
  const journeys = T.map(t => {
    const pid = ids.pattern(t.dir, t.stops.map(p => p.name)), jid = ids.journey(t.number);
    const d0 = time(cal, t.stops[0].dep as number), last = t.stops[t.stops.length - 1];
    const dur = Math.round((last.arr as number) - (t.stops[0].dep as number));
    const passing = t.stops.map((p, i) => {
      let x = `<TimetabledPassingTime id="${jid.replace(':ServiceJourney:', ':TimetabledPassingTime:')}-${i + 1}" ${V}>${ref('StopPointInJourneyPatternRef', spijp(pid, i))}`;
      if (p.arr != null) { const a = time(cal, p.arr); x += `<ArrivalTime>${a.hms}</ArrivalTime>` + (a.offset ? `<ArrivalDayOffset>${a.offset}</ArrivalDayOffset>` : ''); }
      if (p.dep != null) { const d = time(cal, p.dep); x += `<DepartureTime>${d.hms}</DepartureTime>` + (d.offset ? `<DepartureDayOffset>${d.offset}</DepartureDayOffset>` : ''); }
      return x + `</TimetabledPassingTime>`;
    }).join('');
    return `<ServiceJourney id="${jid}" ${V}><Name>${xml(t.number)} ${xml(t.stops[0].name)} – ${xml(last.name)}</Name>`
      + `<TransportMode>rail</TransportMode><DepartureTime>${d0.hms}</DepartureTime>` + (d0.offset ? `<DepartureDayOffset>${d0.offset}</DepartureDayOffset>` : '')
      + `<JourneyDuration>PT${dur}S</JourneyDuration><dayTypes>${ref('DayTypeRef', ids.dayType)}</dayTypes>`
      + ref('ServiceJourneyPatternRef', pid) + ref('OperatorRef', ids.operator)
      + `<trainNumbers>${ref('TrainNumberRef', tn(jid))}</trainNumbers>`
      + `<passingTimes>${passing}</passingTimes></ServiceJourney>`;
  }).join('');
  // interchanges: the connections between trains, and the passage from one service to the next of the same block,
  // where the passengers may stay seated; the EPIP profile has no MaximumWaitTime nor Guaranteed
  const journeyOf = (r: (typeof T)[0]['run']) => T.find(t => t.run === r) as Trip;
  const changes: { from: Trip; to: Trip; station: string; transfer: number | null; seated: boolean }[] = [
    ...sim.connections.map(c => ({ from: journeyOf(c.from), to: journeyOf(c.to), station: c.station, transfer: c.transfer, seated: false })),
    ...T.filter(t => t.run.after).map(t => ({ from: journeyOf(t.run.after as (typeof T)[0]['run']), to: t, station: t.stops[0].name, transfer: null, seated: true })),
  ];
  const interchanges = changes.map(c => `<ServiceJourneyInterchange id="${ids.interchange(c.from.number, c.to.number, c.station)}" ${V}>`
    + (c.seated ? '<StaySeated>true</StaySeated>' : '') + (c.transfer != null ? `<StandardTransferTime>PT${Math.round(c.transfer)}S</StandardTransferTime>` : '')
    + ref('FromPointRef', ids.stopPoint(c.station, c.from.dir)) + ref('ToPointRef', ids.stopPoint(c.station, c.to.dir))
    + ref('FromJourneyRef', ids.journey(c.from.number)) + ref('ToJourneyRef', ids.journey(c.to.number)) + `</ServiceJourneyInterchange>`).join('');
  const timetableFrame = `<TimetableFrame id="${frame('TimetableFrame_EU_PI_TIMETABLE')}" ${V}>${frameType('EU_PI_TIMETABLE')}<vehicleJourneys>${journeys}</vehicleJourneys><trainNumbers>${trainNumbers}</trainNumbers>`
    + (interchanges ? `<journeyInterchanges>${interchanges}</journeyInterchanges>` : '') + `</TimetableFrame>`;

  return `<?xml version="1.0" encoding="UTF-8"?>\n<PublicationDelivery xmlns="http://www.netex.org.uk/netex" xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:siri="http://www.siri.org.uk/siri" version="any">`
    + `<PublicationTimestamp>${midnight}</PublicationTimestamp><ParticipantRef>${xml(o.codespace)}</ParticipantRef>`
    + `<Description>${xml(sim.networked ? sim.net.name : L.def.name)} – orario del ${o.date} (YuTreno)</Description><dataObjects>`
    + `<CompositeFrame id="${frame('CompositeFrame_EU_PI_LINE_OFFER')}" ${V}>`
    + `<ValidBetween><FromDate>${midnight}</FromDate><ToDate>${endOfDay}</ToDate></ValidBetween>${frameType('EU_PI_LINE_OFFER')}`
    + `<codespaces><Codespace id="${xml(o.codespace)}"><Xmlns>${xml(o.codespace)}</Xmlns><XmlnsUrl>${xml(o.operator.url)}</XmlnsUrl></Codespace></codespaces>`
    + `<FrameDefaults><DefaultCodespaceRef ref="${xml(o.codespace)}"/><DefaultLocale><TimeZone>${xml(o.timezone)}</TimeZone><DefaultLanguage>it</DefaultLanguage></DefaultLocale></FrameDefaults>`
    + `<frames>${calendarFrame}${resourceFrame}${siteFrame}${serviceFrame}${timetableFrame}</frames></CompositeFrame>`
    + `</dataObjects></PublicationDelivery>\n`;
}
