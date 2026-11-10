/**
 * railML timetables.
 *
 * Export in railML 3.2: the stations of the line as operational points, and for every train a base itinerary (one
 * point per stop with its times and minimum dwell), an itinerary built from it, a validity for the service day and an
 * operational train with its operational train number. The structure follows the railML 3.2 data model published on
 * the railML wiki (Timetable and Infrastructure subschemas); it has not been validated against the XSD, which is
 * distributed by railML.org to registered users.
 *
 * Import of railML 3.x (the same structures, with itinerary ranges, offsets and bitmask validities) and of railML 2.x
 * (trainParts with ocpsTT and operating periods), the version most infrastructure managers still exchange.
 */
import type { Simulation } from '../core';
import { secondsOf, toServices, type ImportOptions, type ImportResult, type RawTrip } from './import';
import { CONTROLLED_NUMBER, Ids, ServiceCalendar, slug, trips, xml, type FeedOptions, feedStations } from './model';
import { all, kid, kids, parseXml, type XmlNode } from './xml';

/** Time of day and day offset, as railML writes them */
function hmsDay(cal: ServiceCalendar, t: number): { time: string; day: number } {
  const x = Math.round(cal.local(t)), day = Math.floor(x / 86400), r = x - day * 86400;
  return { time: [Math.floor(r / 3600), Math.floor(r / 60) % 60, r % 60].map(v => String(v).padStart(2, '0')).join(':'), day };
}

/** railML 3.2 document of the planned timetable of the run */
export function railmlTimetable(sim: Simulation, o: FeedOptions, controlledNumber = CONTROLLED_NUMBER): string {
  const L = sim.L, cal = new ServiceCalendar(o), ids = new Ids(o, L), T = trips(sim, controlledNumber);
  const op = (name: string) => 'op-' + slug(name);
  const ops = feedStations(sim).map(st => `<operationalPoint id="${op(st.name)}"><name name="${xml(st.name)}" language="it"/>`
    + `<designator register="${xml(o.codespace)}" entry="${xml(ids.stopPlace(st.name))}"/>`
    + `<opOperations><opOperation operationalType="station"/></opOperations></operationalPoint>`).join('');
  let bis = '', its = '', ots = '';
  for (const t of T) {
    const k = slug(t.number);
    const pts = t.stops.map((p, i) => {
      const time = (tag: string, v: number | null) => { if (v == null) return ''; const x = hmsDay(cal, v); return `<${tag} time="${x.time}"${x.day ? ` dayOffset="${x.day}"` : ''}/>`; };
      // the minimum dwell the train keeps at intermediate stops (the default one when the timetable gives none)
      const md = i > 0 && i < t.stops.length - 1 ? t.run.dwells[i] : null;
      return `<baseItineraryPoint id="bip-${k}-${i + 1}" locationRef="${op(p.name)}"><times scope="commercial">${time('arrival', p.arr)}${time('departure', p.dep)}</times>`
        + `<stop${md != null ? ` minDwellTime="PT${md}S"` : ''}/></baseItineraryPoint>`;
    }).join('');
    bis += `<baseItinerary id="bi-${k}">${pts}</baseItinerary>`;
    its += `<itinerary id="it-${k}"><range baseItineraryRef="bi-${k}"/></itinerary>`;
    ots += `<operationalTrain id="ot-${k}"><name name="${xml(t.number)}" language="it"/>`
      + `<operationalTrainVariant id="otv-${k}" itineraryRef="it-${k}" validityRef="va-1"><identifiers><identifier number="${xml(t.number)}" type="OperationalTrainNumber"/></identifiers>`
      + `<operationalTrainSection><range start="bip-${k}-1" end="bip-${k}-${t.stops.length}"/></operationalTrainSection></operationalTrainVariant></operationalTrain>`;
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<railML xmlns="https://www.railml.org/schemas/3.2" version="3.2">`
    + `<infrastructure id="is-${slug(L.def.name)}"><functionalInfrastructure><operationalPoints>${ops}</operationalPoints></functionalInfrastructure></infrastructure>`
    + `<timetable><validities><validity id="va-1"><name name="${o.date}" language="it"/><bitmaskValidity bitmask="1" fromDate="${o.date}"/></validity></validities>`
    + `<baseItineraries>${bis}</baseItineraries><itineraries>${its}</itineraries><operationalTrains>${ots}</operationalTrains></timetable></railML>\n`;
}

// ---------- import ----------

/** Seconds of an ISO 8601 duration (PT1H2M3S, -PT11M, P1D) */
function duration(s: string | undefined): number {
  if (!s) return 0;
  const m = /^(-)?P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s.trim());
  if (!m) throw new Error(`railML: invalid duration "${s}"`);
  return (m[1] ? -1 : 1) * (+(m[2] ?? 0) * 86400 + +(m[3] ?? 0) * 3600 + +(m[4] ?? 0) * 60 + +(m[5] ?? 0));
}
const daysFrom = (a: string, b: string): number => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a.slice(0, 10) + 'T12:00:00Z')) / 86400000);
const nameOf = (n: XmlNode | undefined): string => {
  const names = kids(n, 'name');
  return (names.find(x => x.attrs.language === 'it') ?? names[0])?.attrs.name ?? n?.attrs.name ?? '';
};

export function importRailml(text: string, o: ImportOptions = {}): ImportResult {
  const doc = parseXml(text);
  if (doc.name.toLowerCase() !== 'railml') throw new Error(`railML: root element is ${doc.name}`);
  const version = doc.attrs.version ?? '', warnings: string[] = [];
  const raw = version.startsWith('2') || doc.name === 'railml' ? railml2(doc, o, warnings) : railml3(doc, o, warnings);
  return { format: 'railml', services: toServices(raw, o, warnings), warnings };
}

/** railML 3.x: operational trains → itineraries → ranges of base itineraries */
function railml3(doc: XmlNode, o: ImportOptions, warnings: string[]): RawTrip[] {
  const byId = (name: string) => new Map(all(doc, name).map(n => [n.attrs.id, n]));
  const ops = byId('operationalPoint'), bis = byId('baseItinerary'), its = byId('itinerary'), vals = byId('validity');
  const runs = (va: string | undefined): boolean => {
    if (!o.date || !va) return true;
    const b = kid(vals.get(va), 'bitmaskValidity');
    if (!b) { warnings.push(`validity ${va} without a bitmask: taken as running every day`); return true; }
    return (b.attrs.bitmask ?? '')[daysFrom(b.attrs.fromDate ?? '', o.date)] === '1';
  };
  const out: RawTrip[] = [];
  let skipped = 0;
  for (const ot of all(doc, 'operationalTrain')) for (const v of kids(ot, 'operationalTrainVariant')) {
    if (!runs(v.attrs.validityRef)) { skipped++; continue; }
    const idn = kids(kid(v, 'identifiers'), 'identifier');
    const number = (idn.find(x => x.attrs.type === 'OperationalTrainNumber') ?? idn.find(x => x.attrs.type === 'CommercialTrainNumber') ?? idn[0])?.attrs.number
      || nameOf(ot) || ot.attrs.id;
    const it = its.get(v.attrs.itineraryRef);
    if (!it) { warnings.push(`${number}: itinerary ${v.attrs.itineraryRef} not found, train dropped`); continue; }
    const shift = duration(v.attrs.offset);
    const stops: RawTrip['stops'] = [];
    for (const r of kids(it, 'range')) {
      const pts = kids(bis.get(r.attrs.baseItineraryRef), 'baseItineraryPoint');
      const a = r.attrs.start ? pts.findIndex(p => p.attrs.id === r.attrs.start) : 0, b = r.attrs.end ? pts.findIndex(p => p.attrs.id === r.attrs.end) : pts.length - 1;
      const off = shift + duration(r.attrs.offset);
      for (const p of pts.slice(Math.max(0, a), b + 1)) {
        if (kid(p, 'pass')) continue;
        const tm = kids(p, 'times'), t = tm.find(x => x.attrs.scope === 'commercial') ?? tm.find(x => x.attrs.scope === 'operational') ?? tm[0];
        const at = (tag: string) => { const e = kid(t, tag); return e?.attrs.time ? secondsOf(e.attrs.time) + 86400 * +(e.attrs.dayOffset ?? 0) + off : null; };
        const md = kid(p, 'stop')?.attrs.minDwellTime;
        // stops already in the trip (the junction of two ranges) are merged
        const name = nameOf(ops.get(p.attrs.locationRef)) || p.attrs.locationRef, prev = stops[stops.length - 1];
        const s = { name, arr: at('arrival'), dep: at('departure'), ...(md ? { minDwell: duration(md) } : {}) };
        if (prev && prev.name === name) { prev.dep = s.dep ?? prev.dep; continue; }
        stops.push(s);
      }
    }
    out.push({ number, stops });
  }
  if (skipped) warnings.push(`${skipped} trains not running on ${o.date}`);
  return out;
}

/** railML 2.x: trainParts with ocpsTT, train numbers from trains or trainParts, operating periods with bitmasks */
function railml2(doc: XmlNode, o: ImportOptions, warnings: string[]): RawTrip[] {
  const ocps = new Map(all(doc, 'ocp').map(n => [n.attrs.id, n.attrs.name || kid(n, 'propOther')?.attrs.name || n.attrs.code || n.attrs.id]));
  const periods = new Map(all(doc, 'operatingPeriod').map(n => [n.attrs.id, n]));
  const numberOf = new Map<string, string>();
  for (const t of all(doc, 'train')) for (const r of all(t, 'trainPartRef')) if (!numberOf.has(r.attrs.ref) && t.attrs.trainNumber) numberOf.set(r.attrs.ref, t.attrs.trainNumber);
  const runs = (tp: XmlNode): boolean => {
    const ref = kid(tp, 'operatingPeriodRef')?.attrs.ref;
    if (!o.date || !ref) return true;
    const p = periods.get(ref), from = p?.attrs.startDate, bits = p?.attrs.bitMask;
    if (!from || !bits) { warnings.push(`operating period ${ref} without startDate and bitMask: taken as running every day`); return true; }
    return bits[daysFrom(from, o.date)] === '1';
  };
  const out: RawTrip[] = [];
  let skipped = 0;
  for (const tp of all(doc, 'trainPart')) {
    if (!runs(tp)) { skipped++; continue; }
    const number = tp.attrs.operationalTrainNumber || tp.attrs.commercialTrainNumber || numberOf.get(tp.attrs.id) || tp.attrs.name || tp.attrs.id;
    const pts = kids(kid(tp, 'ocpsTT'), 'ocpTT').sort((a, b) => +(a.attrs.sequence ?? 0) - +(b.attrs.sequence ?? 0));
    const stops: RawTrip['stops'] = [];
    for (const p of pts) {
      if (p.attrs.ocpType === 'pass') continue;
      const tm = kids(p, 'times'), t = tm.find(x => x.attrs.scope === 'scheduled') ?? tm.find(x => x.attrs.scope === 'published') ?? tm[0];
      const at = (k: string) => t?.attrs[k] ? secondsOf(t.attrs[k]) + 86400 * +(t.attrs[k + 'Day'] ?? 0) : null;
      const md = kid(p, 'stopDescription')?.attrs.minStopTime ?? kid(kid(p, 'stopDescription'), 'stopTimes')?.attrs.minimalTime;
      stops.push({ name: ocps.get(p.attrs.ocpRef) ?? p.attrs.ocpRef, arr: at('arrival'), dep: at('departure'), ...(md ? { minDwell: duration(md) } : {}) });
    }
    out.push({ number, stops });
  }
  if (skipped) warnings.push(`${skipped} train parts not running on ${o.date}`);
  return out;
}
