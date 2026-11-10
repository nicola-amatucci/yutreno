/**
 * The infrastructure of a line in railML 3.2, and back.
 *
 * Export: one netElement for the whole line with a linear positioning system in metres; the vertices of the plan as
 * geometry points with geometric coordinates (WGS84 longitude and latitude for a georeferenced line, a local plane in
 * metres otherwise) and the altitude; operational points for the stations; speed sections of the basic static speed
 * profile; constant gradient curves; tunnels as over crossings and bridges as under crossings. Every location carries
 * both the intrinsic coordinate (0..1) and the linear coordinate in metres.
 *
 * Import reads the same structures back into a line (`LineDef`): name, georeferencing, plan, profile, stations, speed
 * limits and tunnels survive the round trip (`verify-infra`, INF7). The timetable of the stations, the block length
 * and the leading freight train are not infrastructure and get defaults; a railML timetable is imported with
 * `npm run import`.
 *
 * The structure follows the railML 3.2 data model published on the railML wiki (topology, geometry, functional
 * infrastructure, positioning in `common`); like the timetable export of src/feeds/railml.ts it has not been
 * validated against the XSD, which railML.org distributes to registered users.
 */
import { compileLine } from '../core/line';
import type { LineDef } from '../core/types';
import { all, kid, kids, parseXml, type XmlNode } from '../feeds/xml';
import { cumulative, fromPlan, toPlan, type XY } from './geo';

const esc = (s: unknown): string => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c] as string));
const n6 = (x: number) => +x.toFixed(6);
const slugId = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'x';

/** Altitude of the profile at chainage s (linear between the points, constant beyond the ends) */
function altAt(profile: [number, number][], s: number): number {
  if (!profile.length) return 0;
  if (s <= profile[0][0]) return profile[0][1];
  for (let i = 1; i < profile.length; i++) if (s <= profile[i][0]) {
    const [a, za] = profile[i - 1], [b, zb] = profile[i];
    return b > a ? za + (zb - za) * (s - a) / (b - a) : zb;
  }
  return profile[profile.length - 1][1];
}

/** railML 3.2 document with the infrastructure of a line */
export function railmlInfrastructure(def: LineDef & { id?: string }): string {
  const L = compileLine(JSON.parse(JSON.stringify(def)));
  const len = L.len, ne = 'ne-1', lps = 'lps-1', gps = 'gps-1';
  const geo = def.geo;
  const loc = (s: number) => `intrinsicCoord="${n6(Math.min(1, Math.max(0, s / len)))}"`;
  const spot = (id: string, s: number) => `<spotLocation id="${id}" netElementRef="${ne}" applicationDirection="both" ${loc(s)}><linearCoordinate positioningSystemRef="${lps}" measure="${n6(s)}"/></spotLocation>`;
  const lin = (id: string, a: number, b: number) => `<linearLocation id="${id}" applicationDirection="both"><associatedNetElement netElementRef="${ne}" keepsOrientation="true" intrinsicCoordBegin="${n6(a / len)}" intrinsicCoordEnd="${n6(b / len)}">`
    + `<linearCoordinateBegin positioningSystemRef="${lps}" measure="${n6(a)}"/><linearCoordinateEnd positioningSystemRef="${lps}" measure="${n6(b)}"/></associatedNetElement></linearLocation>`;

  // geometry points: the vertices of the plan, with their chainage along the compiled line
  const plan = def.plan, cum = cumulative(plan as XY[]), k = cum[cum.length - 1] > 0 ? len / cum[cum.length - 1] : 1;
  const a0 = (geo?.rotation_deg ?? 0) * Math.PI / 180;
  const pts = plan.map(([x, y], i) => {
    const s = Math.min(len, cum[i] * k), z = altAt(def.profile, s);
    if (geo) {
      const dx = x - plan[0][0], dy = y - plan[0][1];
      const p = fromPlan(geo, [dx * Math.cos(a0) - dy * Math.sin(a0), dx * Math.sin(a0) + dy * Math.cos(a0)]);
      return `<geometryPoint id="gp-${i + 1}">${spot(`gp-${i + 1}-sl`, s).replace('</spotLocation>', `<geometricCoordinate positioningSystemRef="${gps}" x="${p.lon.toFixed(8)}" y="${p.lat.toFixed(8)}" z="${z.toFixed(3)}"/></spotLocation>`)}</geometryPoint>`;
    }
    return `<geometryPoint id="gp-${i + 1}">${spot(`gp-${i + 1}-sl`, s).replace('</spotLocation>', `<geometricCoordinate positioningSystemRef="${gps}" x="${x.toFixed(3)}" y="${y.toFixed(3)}" z="${z.toFixed(3)}"/></spotLocation>`)}</geometryPoint>`;
  }).join('');

  // gradient curves between the points of the profile
  const prof = def.profile.length ? def.profile : [[0, 0], [len, 0]] as [number, number][];
  let gcs = '';
  const edges = [0, ...prof.map(p => p[0]).filter(s => s > 0.01 && s < len - 0.01), len];
  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i], b = edges[i + 1];
    if (b - a < 1e-6) continue;
    const g = (altAt(prof, b) - altAt(prof, a)) / (b - a) * 1000;
    gcs += `<gradientCurve id="gc-${i + 1}" curveType="constantCurve" gradient="${g.toFixed(4)}" length="${n6(b - a)}">${lin(`gc-${i + 1}-ll`, a, b)}</gradientCurve>`;
  }

  const ops = def.stations.map((st, i) => `<operationalPoint id="op-${slugId(st.name)}"><name name="${esc(st.name)}" language="it"/>${spot(`op-${i + 1}-sl`, st.s)}<opOperations><opOperation operationalType="station"/></opOperations></operationalPoint>`).join('');
  const sps = def.limits.map(([a, b, v], i) => `<speedSection id="ss-${i + 1}" maxSpeed="${v}" isTemporary="false">${lin(`ss-${i + 1}-ll`, a, b)}<validForSpeedProfile ref="sp-basic"/></speedSection>`).join('');
  const tun = (def.tunnels ?? []).map(([a, b], i) => `<overCrossing id="tu-${i + 1}" constructionType="tunnel">${lin(`tu-${i + 1}-ll`, a, b)}<crossesElement id="tu-${i + 1}-ce" type="area"/></overCrossing>`).join('');
  const crs = geo
    ? `<geometricPositioningSystem id="${gps}" crsDefinition="urn:ogc:def:crs:EPSG::4326"><name name="WGS84 longitude, latitude; altitude in metres" language="en"/></geometricPositioningSystem>`
    : `<geometricPositioningSystem id="${gps}" crsDefinition="local"><name name="local plane of the line: x east, y north, altitude, in metres" language="en"/></geometricPositioningSystem>`;
  const id = slugId(def.id ?? def.name);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<railML xmlns="https://www.railml.org/schemas/3.2" version="3.2">`
    + `<common id="co-1"><positioning><linearPositioningSystems><linearPositioningSystem id="${lps}" startMeasure="0" endMeasure="${n6(len)}" units="m" linearReferencingMethod="absolute"><name name="${esc(def.name)}" language="it"/></linearPositioningSystem></linearPositioningSystems>`
    + `<geometricPositioningSystems>${crs}</geometricPositioningSystems></positioning>`
    + `<speedProfiles><speedProfile id="sp-basic" isBasicSpeedProfile="true"/></speedProfiles></common>`
    + `<infrastructure id="is-${id}"><topology><netElements><netElement id="${ne}" length="${n6(len)}"><associatedPositioningSystem id="aps-1" positioningSystemRef="${lps}">`
    + `<intrinsicCoordinate id="ic-0" intrinsicCoord="0"><linearCoordinate positioningSystemRef="${lps}" measure="0"/></intrinsicCoordinate>`
    + `<intrinsicCoordinate id="ic-1" intrinsicCoord="1"><linearCoordinate positioningSystemRef="${lps}" measure="${n6(len)}"/></intrinsicCoordinate></associatedPositioningSystem></netElement></netElements>`
    + `<networks><network id="nw-1"><level id="lv-1" descriptionLevel="Micro"><networkResource ref="${ne}"/></level></network></networks></topology>`
    + `<geometry><gradientCurves>${gcs}</gradientCurves><geometryPoints>${pts}</geometryPoints></geometry>`
    + `<functionalInfrastructure><lines><line id="ln-${id}" lineCategory="other:yutreno"><name name="${esc(def.name)}" language="it"/>${lin('ln-ll', 0, len)}</line></lines>`
    + `<operationalPoints>${ops}</operationalPoints>${tun ? `<overCrossings>${tun}</overCrossings>` : ''}<speedSections>${sps}</speedSections>`
    + `<tracks><track id="tr-1" mainDirection="both" type="mainTrack">${lin('tr-ll', 0, len)}</track></tracks></functionalInfrastructure>`
    + `</infrastructure></railML>\n`;
}

const num = (v: string | undefined, what: string): number => {
  const x = v != null ? parseFloat(v) : NaN;
  if (!isFinite(x)) throw new Error(`railML infrastructure: invalid ${what} "${v}"`);
  return x;
};

/** Reads a railML 3 infrastructure with one netElement, as written by railmlInfrastructure */
export function importRailmlInfrastructure(text: string): LineDef & { id: string } {
  const doc = parseXml(text);
  const root = doc.children.find(c => c.name === 'railML') ?? doc;
  const infra = all(root, 'infrastructure')[0];
  if (!infra) throw new Error('railML infrastructure: no <infrastructure>');
  const nes = all(infra, 'netElement');
  if (nes.length !== 1) throw new Error(`railML infrastructure: ${nes.length} netElements, one expected (a single line)`);
  const len = num(nes[0].attrs.length, 'netElement length');
  const measure = (n: XmlNode | undefined, which: 'begin' | 'end' | 'spot'): number => {
    if (!n) throw new Error('railML infrastructure: location missing');
    if (which === 'spot') {
      const lc = kid(n, 'linearCoordinate');
      return lc ? num(lc.attrs.measure, 'measure') : num(n.attrs.intrinsicCoord, 'intrinsicCoord') * len;
    }
    const ae = kid(n, 'associatedNetElement')!;
    const lc = kid(ae, which === 'begin' ? 'linearCoordinateBegin' : 'linearCoordinateEnd');
    return lc ? num(lc.attrs.measure, 'measure') : num(ae.attrs[which === 'begin' ? 'intrinsicCoordBegin' : 'intrinsicCoordEnd'], 'intrinsic coordinate') * len;
  };
  const nameOf = (n: XmlNode | undefined) => (kids(n, 'name').find(x => x.attrs.language === 'it') ?? kids(n, 'name')[0])?.attrs.name ?? n?.attrs.id ?? '';

  const crs = all(root, 'geometricPositioningSystem')[0]?.attrs.crsDefinition ?? 'local';
  const wgs = /4326/.test(crs);
  const gps = all(infra, 'geometryPoint').map(g => { const sl = kid(g, 'spotLocation')!; const gc = kid(sl, 'geometricCoordinate')!; return { s: measure(sl, 'spot'), x: num(gc.attrs.x, 'x'), y: num(gc.attrs.y, 'y'), z: gc.attrs.z != null ? num(gc.attrs.z, 'z') : 0 }; })
    .sort((a, b) => a.s - b.s);
  if (gps.length < 2) throw new Error('railML infrastructure: fewer than two geometry points');
  const origin = wgs ? { lat: gps[0].y, lon: gps[0].x } : null;
  const plan = gps.map(p => origin ? toPlan(origin, { lat: p.y, lon: p.x }).map(v => +v.toFixed(3)) as [number, number] : [p.x, p.y] as [number, number]);

  const gcs = all(infra, 'gradientCurve').map(g => ({ a: measure(kid(g, 'linearLocation'), 'begin'), b: measure(kid(g, 'linearLocation'), 'end'), g: num(g.attrs.gradient ?? '0', 'gradient') })).sort((p, q) => p.a - q.a);
  const profile: [number, number][] = [[0, gps[0].z]];
  let z = gps[0].z;
  for (const c of gcs) { z += c.g * (c.b - c.a) / 1000; profile.push([+c.b.toFixed(3), +z.toFixed(3)]); }

  const stations = all(infra, 'operationalPoint').map(o => ({ name: nameOf(o), s: +measure(kid(o, 'spotLocation'), 'spot').toFixed(3), arr: null, dep: null }))
    .sort((a, b) => a.s - b.s).map((s, i, a) => ({ ...s, arr: i === 0 ? null : i * 600, dep: i === a.length - 1 ? null : i * 600 + (i ? 30 : 0) }));
  const limits = all(infra, 'speedSection').map(sp => [+measure(kid(sp, 'linearLocation'), 'begin').toFixed(3), +measure(kid(sp, 'linearLocation'), 'end').toFixed(3), num(sp.attrs.maxSpeed, 'maxSpeed')] as [number, number, number]).sort((a, b) => a[0] - b[0]);
  const tunnels = all(infra, 'overCrossing').filter(o => o.attrs.constructionType === 'tunnel')
    .map(o => [+measure(kid(o, 'linearLocation'), 'begin').toFixed(3), +measure(kid(o, 'linearLocation'), 'end').toFixed(3)] as [number, number]).sort((a, b) => a[0] - b[0]);
  const line = all(infra, 'line')[0];
  const name = line ? nameOf(line) : nameOf(all(root, 'linearPositioningSystem')[0]) || 'railML line';
  const id = (infra.attrs.id ?? 'is-line').replace(/^is-/, '');
  return {
    id, name,
    ...(origin ? { geo: { lat: origin.lat, lon: origin.lon, rotation_deg: 0 } } : {}),
    plan, profile, stations, limits, tunnels, block: 1300,
    freight: { on: false, s0: 0, vmax: 80, stopAt: 0, wait: 0, len: 450 },
  };
}

