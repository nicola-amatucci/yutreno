/**
 * Synthetic sources for the infrastructure import: an Overpass extract and a RINF query result of an invented line,
 * Borgo Alto – Ripa Bassa, built from known chainages so that the import can be checked against them. The data are
 * not real; they reproduce the tagging of OpenStreetMap and the columns of the RINF query of docs/INFRA_IMPORT.md.
 *   npx tsx scripts/infra-fixture.ts      writes examples/infra/synthetic-overpass.json, synthetic-rinf.json and synthetic-dem.json
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { fromPlan, type LatLon, type XY } from '../src/infra';

export const ORIGIN: LatLon = { lat: 41.1, lon: 14.8 };
export const TRACK_LEN = 14000;
const STEP = 25;

/** Centre line of the invented track: chainage along x with a gentle S curve */
export function trackXY(x: number): XY { return [x, 600 * Math.sin(x / 2500)]; }

/** Point of the track at arc length s (by integration of the curve, sampled every metre) */
const ARC: number[] = (() => { const a = [0]; for (let x = 1; x <= TRACK_LEN + 50; x++) { const p = trackXY(x - 1), q = trackXY(x); a.push(a[x - 1] + Math.hypot(q[0] - p[0], q[1] - p[1])); } return a; })();
export const ARC_LEN = ARC[TRACK_LEN];
export function xOfS(s: number): number { let x = 0; while (x < ARC.length - 1 && ARC[x + 1] < s) x++; return x + (s - ARC[x]) / (ARC[x + 1] - ARC[x]); }
export function latLonAt(s: number, offset = 0): LatLon {
  const x = xOfS(s), p = trackXY(x), q = trackXY(x + 0.5), d = Math.hypot(q[0] - p[0], q[1] - p[1]);
  return fromPlan(ORIGIN, [p[0] - (q[1] - p[1]) / d * offset, p[1] + (q[0] - p[0]) / d * offset]);
}

export const STATIONS = [
  { name: 'Borgo Alto', s: 300, ele: 210 },
  { name: 'Case Nuove', s: 5000, ele: 245, stop: 5025 },
  { name: 'Selva Piana', s: 9000, ele: 262 },
  { name: 'Ripa Bassa', s: 13950, ele: 236 },
];
export const SIGNALS = [550, 1900, 3250, 4600];

export function overpass(): { version: number; generator: string; osm3s: { timestamp_osm_base: string }; elements: any[] } {
  const el: any[] = [];
  let id = 1000;
  // nodes of the main track every 25 m of x (the arc is a little longer)
  const main: number[] = [];
  const nodeAtX = new Map<number, number>();
  for (let x = 0; x <= TRACK_LEN; x += STEP) {
    const p = fromPlan(ORIGIN, trackXY(x)), n = id++;
    el.push({ type: 'node', id: n, lat: +p.lat.toFixed(7), lon: +p.lon.toFixed(7) });
    main.push(n); nodeAtX.set(x, n);
  }
  const iAt = (s: number) => Math.round(xOfS(s) / STEP);
  // signals and the stop position on track nodes
  for (const s of SIGNALS) { const e = el[iAt(s)]; e.tags = { railway: 'signal', 'railway:signal:main': 'IT:1a', ref: `S${s}` }; }
  el[iAt(4000)].tags = { railway: 'signal', 'railway:signal:distant': 'IT:avviso' };
  const cn = STATIONS[1];
  el[iAt(cn.stop!)].tags = { railway: 'stop', name: cn.name, public_transport: 'stop_position', train: 'yes' };
  // ways
  const cut = (a: number, b: number) => main.slice(iAt(a), iAt(b) + 1);
  const common = { railway: 'rail', electrified: 'contact_line', voltage: '3000', frequency: '0', 'railway:scmt': 'yes', gauge: '1435', usage: 'branch' };
  el.push({ type: 'way', id: 501, nodes: cut(0, 2000), tags: { ...common, maxspeed: '60' } });
  el.push({ type: 'way', id: 502, nodes: cut(2000, 6000), tags: { ...common, maxspeed: '120' } });
  el.push({ type: 'way', id: 503, nodes: cut(6000, 6800), tags: { ...common, maxspeed: '100', tunnel: 'yes', layer: '-1' } });
  el.push({ type: 'way', id: 504, nodes: cut(6800, 10000).reverse(), tags: { ...common, 'maxspeed:forward': '110', 'maxspeed:backward': '100' } });
  el.push({ type: 'way', id: 505, nodes: main.slice(iAt(10000)), tags: { ...common } });
  // a siding at Case Nuove, 5 m beside the main track, joined to it at both ends
  const sid: number[] = [main[iAt(4700)]];
  for (let s = 4750; s <= 5250; s += 50) { const p = latLonAt(s, 5), n = id++; el.push({ type: 'node', id: n, lat: +p.lat.toFixed(7), lon: +p.lon.toFixed(7) }); sid.push(n); }
  sid.push(main[iAt(5300)]);
  el.push({ type: 'way', id: 506, nodes: sid, tags: { railway: 'rail', service: 'siding' } });
  // a branch leaving at Selva Piana towards a station far from the line
  const br: number[] = [main[iAt(9000)]];
  const b0 = fromPlan(ORIGIN, trackXY(xOfS(9000)));
  for (let k = 1; k <= 12; k++) { const n = id++; el.push({ type: 'node', id: n, lat: +(b0.lat - k * 0.0022).toFixed(7), lon: +(b0.lon + k * 0.0009).toFixed(7) }); br.push(n); }
  el.push({ type: 'way', id: 507, nodes: br, tags: { railway: 'rail', maxspeed: '70' } });
  el.push({ type: 'node', id: id++, lat: +(b0.lat - 12 * 0.0022 + 0.0001).toFixed(7), lon: +(b0.lon + 12 * 0.0009).toFixed(7), tags: { railway: 'station', name: 'Altrove' } });
  // station nodes 15 m beside the track
  for (const st of STATIONS) { const p = latLonAt(st.s, 15); el.push({ type: 'node', id: id++, lat: +p.lat.toFixed(7), lon: +p.lon.toFixed(7), tags: { railway: 'station', name: st.name, ele: String(st.ele), 'railway:ref': st.name.slice(0, 3).toUpperCase() } }); }
  return { version: 0.6, generator: 'YuTreno synthetic fixture', osm3s: { timestamp_osm_base: '2026-11-06T00:00:00Z' }, elements: el };
}

export function rinf(): object {
  const op = (n: string) => `http://data.europa.eu/949/functionalInfrastructure/operationalPoints/IT${n.replace(/\W/g, '').toUpperCase()}`;
  const rows: [string, string, string, string, number, number, string?][] = [
    ['sol1', 'BORGO ALTO', 'CASE NUOVE', '4700', 100, 0],
    ['sol2', 'CASE NUOVE', 'PM KM 7+000', '2000', 110, 0],
    ['sol3', 'SELVA PIANA', 'PM KM 7+000', '2000', 105, 0],
    ['sol4', 'SELVA PIANA', 'RIPA BASSA', '4950', 90, 1, '-5.4'],
  ];
  const bindings = rows.flatMap(([sol, a, b, len, v, _n, g]) => [{
    sol: { type: 'uri', value: `http://data.europa.eu/949/functionalInfrastructure/sectionsOfLine/${sol}` },
    opStart: { type: 'uri', value: op(a) }, opEnd: { type: 'uri', value: op(b) },
    opStartName: { type: 'literal', value: a }, opEndName: { type: 'literal', value: b },
    length: { type: 'literal', value: len }, maxSpeed: { type: 'literal', value: String(v) },
    protection: { type: 'literal', value: 'SCMT' }, contactLine: { type: 'literal', value: 'overhead 3 kV DC' },
    ...(g ? { gradient: { type: 'literal', value: g } } : {}),
    lineId: { type: 'literal', value: '999' },
  }]);
  return { head: { vars: ['sol', 'opStart', 'opEnd', 'opStartName', 'opEndName', 'length', 'maxSpeed', 'etcsLevel', 'protection', 'contactLine', 'gradient', 'lineId'] }, results: { bindings } };
}

/** Ground altitude of the invented line: linear between the station altitudes, with a hill of 40 m over the tunnel */
export function groundAt(s: number): number {
  const st = STATIONS;
  let z = st[0].ele;
  if (s >= st[st.length - 1].s) z = st[st.length - 1].ele;
  else for (let i = 1; i < st.length; i++) if (s <= st[i].s) { z = s <= st[0].s ? st[0].ele : st[i - 1].ele + (st[i].ele - st[i - 1].ele) * (s - st[i - 1].s) / (st[i].s - st[i - 1].s); break; }
  const hill = s > 6050 && s < 6750 ? 40 * Math.sin(Math.PI * (s - 6050) / 700) : 0;
  return +(z + hill).toFixed(1);
}

/** Altitudes every 100 m along the track, in the format of an OpenTopoData answer */
export function dem(): object {
  const results = [];
  for (let s = 0; s <= TRACK_LEN; s += 100) { const p = latLonAt(Math.min(s, ARC_LEN)); results.push({ dataset: 'synthetic', elevation: groundAt(s), location: { lat: +p.lat.toFixed(6), lng: +p.lon.toFixed(6) } }); }
  return { results, status: 'OK' };
}

if (process.argv[1] && /infra-fixture\.ts$/.test(process.argv[1])) {
  mkdirSync('examples/infra', { recursive: true });
  writeFileSync('examples/infra/synthetic-overpass.json', JSON.stringify(overpass()) + '\n');
  writeFileSync('examples/infra/synthetic-rinf.json', JSON.stringify(rinf(), null, 1) + '\n');
  writeFileSync('examples/infra/synthetic-dem.json', JSON.stringify(dem()) + '\n');
  console.log('examples/infra/synthetic-overpass.json, synthetic-rinf.json and synthetic-dem.json written');
}
