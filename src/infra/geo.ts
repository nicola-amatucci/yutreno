/**
 * Geometry of the import: the local plan of an imported line and the distances on the WGS84 ellipsoid.
 *
 * The plan is the one the open data feeds use to go back to WGS84 (`wgs84xy` in src/feeds/model.ts): x east and y north
 * in metres from the origin, with the same Earth radius and the cosine of the latitude of the origin. Projecting with
 * the inverse of that formula gives back the coordinates of the sources exactly, up to rounding.
 */

export const R_EARTH = 6371008.8;
const RAD = Math.PI / 180;

export type LatLon = { lat: number; lon: number };
export type XY = [number, number];

/** Great-circle distance (m) */
export function haversine(a: LatLon, b: LatLon): number {
  const dlat = (b.lat - a.lat) * RAD, dlon = (b.lon - a.lon) * RAD;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat * RAD) * Math.cos(b.lat * RAD) * Math.sin(dlon / 2) ** 2;
  return 2 * R_EARTH * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Local plan around `o`: the inverse of `wgs84xy` with rotation 0 */
export function toPlan(o: LatLon, p: LatLon): XY {
  return [(p.lon - o.lon) * RAD * R_EARTH * Math.cos(o.lat * RAD), (p.lat - o.lat) * RAD * R_EARTH];
}

export function fromPlan(o: LatLon, [x, y]: XY): LatLon {
  return { lat: o.lat + y / R_EARTH / RAD, lon: o.lon + x / (R_EARTH * Math.cos(o.lat * RAD)) / RAD };
}

/** Cumulative length of a polyline */
export function cumulative(p: XY[]): number[] {
  const c = [0];
  for (let i = 1; i < p.length; i++) c.push(c[i - 1] + Math.hypot(p[i][0] - p[i - 1][0], p[i][1] - p[i - 1][1]));
  return c;
}

/** Nearest point of a polyline: chainage along it and distance from it */
export function project(p: XY[], cum: number[], q: XY): { s: number; d: number } {
  let best = { s: 0, d: Infinity };
  for (let i = 0; i < p.length - 1; i++) {
    const [ax, ay] = p[i], [bx, by] = p[i + 1], dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((q[0] - ax) * dx + (q[1] - ay) * dy) / l2)) : 0;
    const d = Math.hypot(ax + dx * t - q[0], ay + dy * t - q[1]);
    if (d < best.d) best = { s: cum[i] + (cum[i + 1] - cum[i]) * t, d };
  }
  return best;
}

/**
 * Douglas–Peucker simplification with tolerance `tol` (m), then points closer than `minGap` (m) to the previous kept
 * point are dropped, so that the spline of the plan has no noise from densely mapped stretches. The ends are kept.
 */
export function simplify(p: XY[], tol: number, minGap: number): XY[] {
  if (p.length < 3) return p.slice();
  const keep = new Uint8Array(p.length);
  keep[0] = keep[p.length - 1] = 1;
  const stack: [number, number][] = [[0, p.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const [ax, ay] = p[a], [bx, by] = p[b], dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy) || 1;
    let far = -1, dmax = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((p[i][0] - ax) * dy - (p[i][1] - ay) * dx) / l;
      if (d > dmax) { dmax = d; far = i; }
    }
    if (far >= 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  const out: XY[] = [p[0]];
  for (let i = 1; i < p.length - 1; i++) {
    if (!keep[i]) continue;
    const q = out[out.length - 1];
    if (Math.hypot(p[i][0] - q[0], p[i][1] - q[1]) >= minGap) out.push(p[i]);
  }
  const last = p[p.length - 1], q = out[out.length - 1];
  if (out.length > 1 && Math.hypot(last[0] - q[0], last[1] - q[1]) < minGap) out.pop();
  out.push(last);
  return out;
}

/**
 * Points every `step` metres along a polyline, ends included (the last interval is shorter). The spline of the plan is a
 * uniform Catmull-Rom, which makes loops where a short segment follows a long one: evenly spaced vertices avoid them.
 */
export function resample(p: XY[], step: number): XY[] {
  const c = cumulative(p), len = c[c.length - 1], out: XY[] = [];
  const n = Math.max(1, Math.round(len / step));
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const s = len * k / n;
    while (j < p.length - 2 && c[j + 1] < s) j++;
    const f = c[j + 1] > c[j] ? (s - c[j]) / (c[j + 1] - c[j]) : 0;
    out.push([p[j][0] + (p[j + 1][0] - p[j][0]) * f, p[j][1] + (p[j + 1][1] - p[j][1]) * f]);
  }
  return out;
}

/** Name of a station reduced for matching: lower case, no accents, only letters and digits */
export function normName(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Ranges [a, b, value] with equal neighbouring values merged and gaps up to `gap` metres closed */
export function mergeRanges<T>(r: [number, number, T][], gap = 0, eq: (x: T, y: T) => boolean = (x, y) => x === y): [number, number, T][] {
  const out: [number, number, T][] = [];
  for (const [a, b, v] of [...r].sort((x, y) => x[0] - y[0])) {
    const l = out[out.length - 1];
    if (l && eq(l[2], v) && a - l[1] <= gap) l[1] = Math.max(l[1], b);
    else out.push([a, b, v]);
  }
  return out;
}
