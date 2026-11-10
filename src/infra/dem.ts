/**
 * Altitudes of a line from a digital elevation model (DEM), for the lines where neither RINF nor OpenStreetMap give
 * gradients.
 *
 * `elevationPoints` gives the points of a line every 100 m; their altitudes, from a DEM service such as OpenTopoData
 * with the EU-DEM 25 m dataset, come back to the import with `parseElevation`. A DEM gives the altitude of the
 * ground: on a bridge it is the valley below and over a tunnel the hill above, so the points within tunnels and
 * bridges (with 30 m around their ends) are left out and the track is taken as straight between the ends. Cuttings and
 * embankments are rarely tagged, so the rest goes through a running median over 1 km, which removes hills and valleys
 * the track passes through or over, and a moving average over 1 km, because a railway does not follow the small
 * undulations of the ground; then it is reduced to the changes of gradient that move the altitude by more than 0.5 m.
 */
import { compileLine, xyOf } from '../core/line';
import type { LineDef } from '../core/types';
import { fromPlan, type LatLon } from './geo';

export interface ElevationPoint { lat: number; lon: number; elevation: number }

/** Points of the line every `step` metres, with their chainage, to ask a DEM service for */
export function elevationPoints(def: LineDef, step = 100): { s: number; lat: number; lon: number }[] {
  if (!def.geo) throw new Error('the line has no georeferencing (geo)');
  const L = compileLine(JSON.parse(JSON.stringify(def))), [x0, y0] = xyOf(L, 0), a = (def.geo.rotation_deg ?? 0) * Math.PI / 180;
  const out: { s: number; lat: number; lon: number }[] = [];
  for (let s = 0; s <= L.len + 1e-6; s += step) {
    const [x, y] = xyOf(L, Math.min(s, L.len)), dx = x - x0, dy = y - y0;
    const p = fromPlan(def.geo, [dx * Math.cos(a) - dy * Math.sin(a), dx * Math.sin(a) + dy * Math.cos(a)]);
    out.push({ s: Math.round(s), lat: +p.lat.toFixed(6), lon: +p.lon.toFixed(6) });
  }
  return out;
}

/**
 * Reads the altitudes: the answer of OpenTopoData (`{results: [{location: {lat, lng}, elevation}]}`), a list of such
 * answers, or a list of `{lat, lon, elevation}`. Points without an altitude are skipped.
 */
export function parseElevation(input: string | object): ElevationPoint[] {
  const j = typeof input === 'string' ? JSON.parse(input) : input;
  const out: ElevationPoint[] = [];
  const add = (x: any) => {
    if (x?.results) { for (const r of x.results) add({ lat: r.location?.lat, lon: r.location?.lng ?? r.location?.lon, elevation: r.elevation }); return; }
    const z = x?.elevation ?? x?.ele ?? x?.z;
    if (typeof x?.lat === 'number' && typeof (x.lon ?? x.lng) === 'number' && typeof z === 'number' && isFinite(z)) out.push({ lat: x.lat, lon: x.lon ?? x.lng, elevation: z });
  };
  if (Array.isArray(j)) j.forEach(add); else add(j);
  if (!out.length) throw new Error('no altitudes in the elevation file');
  return out;
}

/** Altitude profile along the line from DEM points with their chainage: structures bridged, smoothed, simplified */
export function demProfile(pts: { s: number; z: number }[], structures: [number, number][], len: number): [number, number][] {
  const margin = 30;
  const inside = (s: number) => structures.some(([a, b]) => s > a - margin && s < b + margin);
  const p = pts.filter(q => !inside(q.s)).sort((a, b) => a.s - b.s);
  if (p.length < 2) return [];
  const zAt = (s: number) => {
    if (s <= p[0].s) return p[0].z;
    for (let i = 1; i < p.length; i++) if (s <= p[i].s) return p[i - 1].z + (p[i].z - p[i - 1].z) * (s - p[i - 1].s) / Math.max(1e-9, p[i].s - p[i - 1].s);
    return p[p.length - 1].z;
  };
  // regular grid every 50 m; running median over ±500 m, which removes the hills of untagged cuttings and the valleys
  // of untagged embankments up to about 1 km wide, then moving average over ±500 m
  const grid: [number, number][] = [];
  for (let s = 0; s < len; s += 50) grid.push([s, zAt(s)]);
  grid.push([len, zAt(len)]);
  const med: [number, number][] = grid.map(([s]) => {
    const w = grid.filter(([t]) => Math.abs(t - s) <= 500).map(([, z]) => z).sort((a, b) => a - b);
    return [s, w.length % 2 ? w[w.length >> 1] : (w[w.length / 2 - 1] + w[w.length / 2]) / 2];
  });
  const sm: [number, number][] = med.map(([s]) => {
    let sum = 0, n = 0;
    for (const [t, z] of med) if (Math.abs(t - s) <= 500) { sum += z; n++; }
    return [s, sum / n];
  });
  // Douglas–Peucker on (s, z) with 0.5 m
  const keep = new Uint8Array(sm.length); keep[0] = keep[sm.length - 1] = 1;
  const stack: [number, number][] = [[0, sm.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    let far = -1, d = 0.5;
    for (let i = a + 1; i < b; i++) {
      const z = sm[a][1] + (sm[b][1] - sm[a][1]) * (sm[i][0] - sm[a][0]) / (sm[b][0] - sm[a][0]);
      if (Math.abs(sm[i][1] - z) > d) { d = Math.abs(sm[i][1] - z); far = i; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return sm.filter((_, i) => keep[i]).map(([s, z]) => [Math.round(s * 10) / 10, Math.round(z * 10) / 10]);
}

export type { LatLon };
