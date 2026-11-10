/**
 * NeTEx → service trains. Reads a PublicationDelivery (frames composite or not, Italian EPIP profile or other
 * profiles): stop names from the stop places assigned to the scheduled stop points, order from the journey patterns,
 * times from the timetabled passing times with their day offsets, train numbers from TrainNumber (ForAdvertisement),
 * and, with a service day, the day types assigned by date, operating day or operating period.
 */
import { secondsOf, toServices, type ImportOptions, type ImportResult, type RawTrip } from './import';
import { all, kid, kidText, kids, parseXml, type XmlNode } from './xml';

const ref = (n: XmlNode | undefined, ...names: string[]): string => {
  for (const x of names) { const r = kid(n, x)?.attrs.ref; if (r) return r; }
  return '';
};
const nameOf = (n: XmlNode | undefined): string => kidText(n, 'Name') || kidText(n, 'ShortName');

/** Days (YYYY-MM-DD) from a to b */
const daysBetween = (a: string, b: string): number => Math.round((Date.parse(b.slice(0, 10) + 'T12:00:00Z') - Date.parse(a.slice(0, 10) + 'T12:00:00Z')) / 86400000);
const WEEK = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function importNetex(text: string, o: ImportOptions = {}): ImportResult {
  const warnings: string[] = [];
  const doc = parseXml(text);
  if (doc.name !== 'PublicationDelivery') throw new Error(`NeTEx: root element is ${doc.name}, not PublicationDelivery`);
  const index = (name: string) => new Map(all(doc, name).map(n => [n.attrs.id, n]));

  // stop names
  const places = index('StopPlace'), quays = new Map<string, string>();
  for (const sp of places.values()) for (const q of all(sp, 'Quay')) quays.set(q.attrs.id, nameOf(sp));
  const ssp = index('ScheduledStopPoint'), stopName = new Map<string, string>();
  for (const [id, n] of ssp) stopName.set(id, nameOf(n));
  for (const a of all(doc, 'PassengerStopAssignment')) {
    const s = ref(a, 'ScheduledStopPointRef'), p = places.get(ref(a, 'StopPlaceRef')), q = quays.get(ref(a, 'QuayRef'));
    const n = (p && nameOf(p)) || q;
    if (s && n) stopName.set(s, n);
  }

  // points of the journey patterns
  const spijp = new Map<string, { stop: string; order: number }>();
  for (const p of all(doc, 'StopPointInJourneyPattern')) spijp.set(p.attrs.id, { stop: ref(p, 'ScheduledStopPointRef'), order: +(p.attrs.order ?? 0) });

  // calendar
  const dayTypes = index('DayType'), periods = new Map([...index('OperatingPeriod'), ...index('UicOperatingPeriod')]), opDays = index('OperatingDay');
  const assignments = all(doc, 'DayTypeAssignment');
  const runsOn = (dt: string, date: string): boolean => {
    let on = false;
    const dow = WEEK[new Date(date + 'T12:00:00Z').getUTCDay()];
    const days = kidText(kid(kid(dayTypes.get(dt), 'properties'), 'PropertyOfDay'), 'DaysOfWeek');
    for (const a of assignments.filter(x => ref(x, 'DayTypeRef') === dt)) {
      let match = false;
      if (kid(a, 'Date')) match = kidText(a, 'Date').slice(0, 10) === date;
      else if (ref(a, 'OperatingDayRef')) match = kidText(opDays.get(ref(a, 'OperatingDayRef')), 'CalendarDate').slice(0, 10) === date;
      else if (ref(a, 'OperatingPeriodRef', 'UicOperatingPeriodRef')) {
        const p = periods.get(ref(a, 'OperatingPeriodRef', 'UicOperatingPeriodRef'));
        const from = kidText(p, 'FromDate') || kidText(p, 'FromOperatingDayRef'), to = kidText(p, 'ToDate'), bits = kidText(p, 'ValidDayBits');
        if (from && from.slice(0, 10) <= date && (!to || date <= to.slice(0, 10))) {
          const k = daysBetween(from, date);
          match = bits ? bits[k] === '1' : !days || days.split(/\s+/).includes(dow) || days.includes('Everyday');
        }
      }
      if (!match) continue;
      if (kidText(a, 'isAvailable') === 'false') return false;
      on = true;
    }
    return on;
  };

  const trainNumbers = index('TrainNumber');
  const raw: RawTrip[] = [];
  let skipped = 0;
  for (const j of all(doc, 'ServiceJourney')) {
    const tn = trainNumbers.get(ref(kid(j, 'trainNumbers'), 'TrainNumberRef'));
    const number = kidText(tn, 'ForAdvertisement') || kidText(tn, 'Description') || kidText(j, 'PublicCode') || kidText(j, 'PrivateCode')
      || j.attrs.id?.split(':').pop() || nameOf(j);
    if (o.date) {
      const dts = kids(kid(j, 'dayTypes'), 'DayTypeRef').map(d => d.attrs.ref);
      if (dts.length && !dts.some(d => runsOn(d, o.date as string))) { skipped++; continue; }
    }
    const pts = kids(kid(j, 'passingTimes'), 'TimetabledPassingTime').map((p, k) => {
      const pr = spijp.get(ref(p, 'StopPointInJourneyPatternRef', 'PointInJourneyPatternRef'));
      if (!pr) throw new Error(`NeTEx: ${j.attrs.id}: passing time without a stop point in journey pattern`);
      const t = (tag: string) => {
        const v = kidText(p, tag + 'Time');
        return v ? secondsOf(v.replace(/(Z|[+-]\d\d:\d\d)$/, '')) + 86400 * +(kidText(p, tag + 'DayOffset') || 0) : null;
      };
      return { k, order: pr.order, name: stopName.get(pr.stop) ?? pr.stop, arr: t('Arrival'), dep: t('Departure') };
    });
    pts.sort((a, b) => a.order - b.order || a.k - b.k);
    // times that go back without a day offset cross midnight: some files leave the offset out
    let last = -Infinity, wrapped = false;
    for (const p of pts) for (const f of ['arr', 'dep'] as const) {
      let v = p[f];
      if (v == null) continue;
      while (v < last) { v += 86400; wrapped = true; }
      p[f] = last = v;
    }
    if (wrapped) warnings.push(`${number}: times after midnight without a day offset, read as the following day`);
    raw.push({ number, stops: pts.map(({ name, arr, dep }) => ({ name, arr, dep })) });
  }
  if (skipped) warnings.push(`${skipped} journeys not running on ${o.date}`);
  return { format: 'netex', services: toServices(raw, o, warnings), warnings };
}
