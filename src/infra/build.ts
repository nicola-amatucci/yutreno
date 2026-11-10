/**
 * Builds a YuTreno line from the imported sources, with the provenance of every datum and the import report.
 *
 * Declared priority (docs/INFRA_IMPORT.md): the geometry, the stations, the tunnels and the mapped signals come from
 * OpenStreetMap; where both sources give a speed the RINF one is kept (decision 10 of docs/ROADMAP.md: RINF is the
 * official register, and a real timetable showed a lower OSM limit to be wrong), and the OSM limits set aside are
 * listed in the report; with `speedPolicy: 'lower'` the lower of the two is kept instead; the gradient, the protection system and the electrification come from
 * RINF where it gives them and from OSM elsewhere. What neither source gives is generated and marked as such.
 */
import { compileLine } from '../core/line';
import type { LineDef, StationDef } from '../core/types';
import { cumulative, project, resample, simplify, toPlan } from './geo';
import { demProfile, parseElevation } from './dem';
import { osmTrack, parseOverpass } from './osm';
import { parseRinf, rinfOverlay, type RinfOverlay } from './rinf';
import type { Attr, InfraImport, InfraImportOptions, InfraReport, Provenance, ShareOf, SourceId } from './types';

export const OSM_ATTRIBUTION = '© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)';
export const RINF_ATTRIBUTION = 'RINF, European Union Agency for Railways (https://www.era.europa.eu/domains/registers/rinf_en)';
export const DEM_ATTRIBUTION = 'Produced using Copernicus data and information funded by the European Union - EU-DEM layers';
export const DEM_DEFAULT = 'EU-DEM v1.1, 25 m (Copernicus Land Monitoring Service), through OpenTopoData'

const slug = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const r1 = (x: number) => Math.round(x * 10) / 10;

/** Value of a set of ranges on [a, b): the first range that covers the middle of the stretch */
const at = <T>(r: Attr<T>[], a: number, b: number): Attr<T> | undefined => { const m = (a + b) / 2; return r.find(x => x.a <= m && x.b > m); };

/** Elementary stretches between all the bounds of some sets of ranges */
function cuts(len: number, ...sets: { a: number; b: number }[][]): number[] {
  const c = new Set([0, len]);
  for (const r of sets) for (const x of r) { if (x.a > 0 && x.a < len) c.add(x.a); if (x.b > 0 && x.b < len) c.add(x.b); }
  const out: number[] = [];
  for (const x of [...c].sort((a, b) => a - b)) if (!out.length || x - out[out.length - 1] > 0.05) out.push(x);
  if (out[out.length - 1] !== len) out[out.length - 1] = len;
  return out;
}

function share(len: number, r: { a: number; b: number; prov: Provenance }[], rest: Provenance = 'generated'): ShareOf {
  const o: ShareOf = { source: 0, derived: 0, generated: 0 };
  let covered = 0;
  for (const x of r) { const l = Math.max(0, Math.min(len, x.b) - Math.max(0, x.a)); o[x.prov] += l; covered += l; }
  o[rest] += Math.max(0, len - covered);
  return { source: Math.round(o.source), derived: Math.round(o.derived), generated: Math.round(o.generated) };
}

function mergeAttr<T>(r: Attr<T>[]): Attr<T>[] {
  const out: Attr<T>[] = [];
  for (const x of r) {
    const l = out[out.length - 1];
    if (l && l.v === x.v && l.src === x.src && l.prov === x.prov && Math.abs(l.b - x.a) < 1e-6) { l.b = x.b; if (x.ref) l.ref = [...new Set([...(l.ref ?? '').split(' '), ...x.ref.split(' ')].filter(Boolean))].join(' '); }
    else out.push({ ...x });
  }
  return out;
}

/** Imports a line from an Overpass extract and, if given, the RINF query result and the altitudes of a DEM */
export function importInfrastructure(osm: string | object, o: InfraImportOptions, rinf?: string | object, elevation?: string | object): InfraImport {
  const t = osmTrack(parseOverpass(osm), o);
  const plan = resample(simplify(t.plan, 1, 15), 25).map(([x, y]) => [r1(x), r1(y)] as [number, number]);
  // the compiled line follows a spline through the plan: chainages are scaled to its length
  const probe = compileLine({ name: 'probe', plan, profile: [], stations: [], limits: [], tunnels: [], block: 1300, freight: { on: false, s0: 0, vmax: 60, stopAt: 0, wait: 0, len: 400 } });
  const k = probe.len / t.len, len = probe.len;
  const sc = <T extends { a: number; b: number }>(r: T[]): T[] => r.map(x => ({ ...x, a: x.a * k, b: x.b * k }));
  const stations = t.stations.map(s => ({ ...s, s: r1(s.s * k) }));
  const osmSpeed = sc(t.speed), tunnels = sc(t.tunnels), osmElec = sc(t.electrification), osmSig = sc(t.signalling);
  const stubs = t.stubs.map(([a, b]) => [a * k, b * k] as [number, number]);
  const osmEle = t.elevation.map(e => ({ ...e, s: e.s * k }));
  const signals = t.signals.map(s => ({ ...s, s: r1(s.s * k) }));
  const warnings = [...t.warnings];
  const ov: RinfOverlay | null = rinf != null ? rinfOverlay(parseRinf(rinf), stations) : null;
  if (ov) warnings.push(...ov.warnings);
  const defSpeed = o.defaultSpeed_kmh ?? 80;

  // speed: RINF where it covers the line (or the lower of the two with speedPolicy 'lower'), OSM elsewhere
  const lowerWins = o.speedPolicy === 'lower';
  const speed: Attr<number>[] = [], conflicts: { a: number; b: number; osm: number; rinf: number }[] = [];
  const sc0 = cuts(len, osmSpeed, ov?.speed ?? []);
  for (let i = 0; i < sc0.length - 1; i++) {
    const a = sc0[i], b = sc0[i + 1], x = at(osmSpeed, a, b), y = ov ? at(ov.speed, a, b) : undefined;
    let pick: Attr<number>;
    if (x && y) {
      pick = lowerWins && x.v < y.v ? x : y;
      if (x.v !== y.v) conflicts.push({ a: r1(a), b: r1(b), osm: x.v, rinf: y.v });
    } else pick = x ?? y ?? { a, b, v: defSpeed, prov: 'generated', src: 'yutreno' };
    speed.push({ ...pick, a, b });
  }
  const speedM = mergeAttr(speed).map(x => ({ ...x, a: r1(x.a), b: r1(x.b) }));
  const mc = mergeAttr(conflicts.map(c => ({ a: c.a, b: c.b, v: `${c.osm}/${c.rinf}`, prov: 'source' as Provenance, src: 'osm' as SourceId })))
    .map(c => { const osm = +c.v.split('/')[0], rinf = +c.v.split('/')[1]; return { a: c.a, b: c.b, osm, rinf, kept: (lowerWins && osm < rinf ? 'osm' : 'rinf') as 'osm' | 'rinf' }; });

  // DEM: altitudes of the ground along the line, with tunnels and bridges bridged
  let demGrad: Attr<number>[] = [], demAlt0: number | null = null, demPoints = 0;
  if (elevation != null) {
    const raw = t.plan, cum = cumulative(raw);
    const pts = parseElevation(elevation).map(e => { const pr = project(raw, cum, toPlan(t.origin, { lat: e.lat, lon: e.lon })); return { s: pr.s * k, z: e.elevation, d: pr.d }; }).filter(q => q.d < 50);
    demPoints = pts.length;
    const structures = [...tunnels, ...sc(t.bridges)].map(x => [x.a, x.b] as [number, number]);
    const dp = demProfile(pts, structures, len);
    if (dp.length >= 2) {
      demAlt0 = dp[0][1];
      for (let i = 0; i < dp.length - 1; i++) demGrad.push({ a: dp[i][0], b: dp[i + 1][0], v: +((dp[i + 1][1] - dp[i][1]) / Math.max(1, dp[i + 1][0] - dp[i][0]) * 1000).toFixed(2), prov: 'derived', src: 'dem' });
    } else warnings.push('elevation: fewer than two points on the line');
  }

  // gradient: RINF, else the DEM, else the altitudes of the OSM nodes, else level
  const ele = osmEle;
  const eleCuts = ele.map(e => ({ a: e.s, b: e.s }));
  const gc = cuts(len, ov?.gradient ?? [], demGrad, eleCuts);
  const gradient: Attr<number>[] = [];
  for (let i = 0; i < gc.length - 1; i++) {
    const a = gc[i], b = gc[i + 1], y = (ov ? at(ov.gradient, a, b) : undefined) ?? at(demGrad, a, b);
    if (y) { gradient.push({ ...y, a, b }); continue; }
    const m = (a + b) / 2, j = ele.findIndex(e => e.s > m);
    if (ele.length >= 2 && j > 0) {
      const p = ele[j - 1], q = ele[j];
      gradient.push({ a, b, v: +((q.ele - p.ele) / Math.max(1, q.s - p.s) * 1000).toFixed(2), prov: 'derived', src: 'osm', ref: `${p.ref} ${q.ref}` });
    } else gradient.push({ a, b, v: 0, prov: 'generated', src: 'yutreno' });
  }
  const gradM = mergeAttr(gradient);
  // the RINF gradients against the DEM, station to station: the climb each gives (m)
  const rise = (g: Attr<number>[], a: number, b: number) => g.reduce((x, y) => x + y.v * Math.max(0, Math.min(b, y.b) - Math.max(a, y.a)) / 1000, 0);
  const covered = (g: Attr<number>[], a: number, b: number) => g.reduce((x, y) => x + Math.max(0, Math.min(b, y.b) - Math.max(a, y.a)), 0) >= 0.95 * (b - a);
  const gradientCheck: InfraReport['gradient_check'] = [];
  if (ov?.gradient.length && demGrad.length) for (let i = 0; i < stations.length - 1; i++) {
    const a = stations[i].s, b = stations[i + 1].s;
    if (b <= a || !covered(ov.gradient, a, b)) continue;
    const r = rise(ov.gradient, a, b), d = rise(demGrad, a, b);
    gradientCheck.push({ from: stations[i].name, to: stations[i + 1].name, rinf_m: +r.toFixed(1), dem_m: +d.toFixed(1) });
    if (Math.abs(r - d) > 15) warnings.push(`gradient ${stations[i].name} – ${stations[i + 1].name}: RINF climbs ${r.toFixed(1)} m, the DEM ${d.toFixed(1)} m`);
  }
  const alt0 = demAlt0 != null ? demAlt0 : ele.length ? ele[0].ele - gradM.filter(g => g.b <= ele[0].s + 1e-6).reduce((x, g) => x + g.v * (g.b - g.a) / 1000, 0) : 100;
  const profile: [number, number][] = [[0, +alt0.toFixed(1)]];
  let alt = alt0;
  for (const g of gradM) { alt += g.v * (g.b - g.a) / 1000; profile.push([r1(g.b), +alt.toFixed(1)]); }

  // electrification and protection: RINF where present, OSM elsewhere
  const overlay = (base: Attr<string>[], top: Attr<string>[]): Attr<string>[] => {
    const c = cuts(len, base, top), out: Attr<string>[] = [];
    for (let i = 0; i < c.length - 1; i++) { const x = at(top, c[i], c[i + 1]) ?? at(base, c[i], c[i + 1]); if (x) out.push({ ...x, a: c[i], b: c[i + 1] }); }
    return mergeAttr(out).map(x => ({ ...x, a: r1(x.a), b: r1(x.b) }));
  };
  const signalling = overlay(osmSig, ov?.signalling ?? []), electr = overlay(osmElec, ov?.electrification ?? []);
  const etcs = signalling.filter(x => /ETCS L[23]/.test(x.v)).reduce((s, x) => s + x.b - x.a, 0);

  // block length from the spacing of the main signals
  const mains = signals.filter(s => s.kind === 'main' || s.kind === 'combined').map(s => s.s).sort((a, b) => a - b);
  const gaps = mains.slice(1).map((s, i) => s - mains[i]).filter(g => g > 400 && g < 4000).sort((a, b) => a - b);
  const blockDerived = gaps.length >= 2;
  const block = blockDerived ? Math.round(gaps[gaps.length >> 1] / 10) * 10 : (o.defaultBlock_m ?? 1300);

  // timetable generated from the limits: running time at the limit plus 60 s, rounded up to 10 s, dwell 30 s
  const runTime = (a: number, b: number) => {
    let s = 0;
    for (const x of speedM) { const l = Math.max(0, Math.min(b, x.b) - Math.max(a, x.a)); s += l / (x.v / 3.6); }
    return Math.ceil((s / 0.9 + 60) / 10) * 10;
  };
  let tt = 0;
  const st: StationDef[] = stations.map((x, i) => {
    if (i > 0) tt += runTime(stations[i - 1].s, x.s);
    const arr = i === 0 ? null : tt, dep = i === stations.length - 1 ? null : (i === 0 ? 0 : tt + 30);
    if (dep != null) tt = dep;
    return { name: x.name, s: x.s, arr, dep };
  });

  const id = o.id ?? slug(`${st[0].name} ${st[st.length - 1].name}`);
  const name = o.name ?? `${st[0].name} – ${st[st.length - 1].name}`;
  const attribution = [OSM_ATTRIBUTION, ...(ov ? [RINF_ATTRIBUTION] : []), ...(demAlt0 != null ? [DEM_ATTRIBUTION] : [])].join('; ');
  const line: LineDef & { id: string } = {
    id, name,
    geo: { lat: +t.origin.lat.toFixed(7), lon: +t.origin.lon.toFixed(7), rotation_deg: 0 },
    attribution,
    plan, profile, stations: st,
    limits: speedM.map(x => [x.a, x.b, x.v] as [number, number, number]),
    tunnels: tunnels.map(x => [r1(x.a), r1(x.b)] as [number, number]),
    block,
    freight: { on: false, s0: 0, vmax: 80, stopAt: 0, wait: 0, len: 450 },
  };

  const L = compileLine(JSON.parse(JSON.stringify(line)));
  if (L.rmin < 150) warnings.push(`minimum radius ${Math.round(L.rmin)} m: check the alignment where the mapped geometry is coarse`);
  if (L.imax > 35) warnings.push(`maximum gradient ${L.imax.toFixed(1)} ‰: check the altitudes of the sources`);
  for (const c of ov?.consistency ?? []) if (Math.abs(c.diff_pct) > 5) warnings.push(`${c.from} – ${c.to}: OSM ${c.osm_m} m against RINF ${c.rinf_m} m (${c.diff_pct} %)`);

  const aligned = [{ a: 0, b: len, prov: 'source' as Provenance }];
  const alignmentShare = share(len, stubs.length ? [...stubs.map(([a, b]) => ({ a, b, prov: 'generated' as Provenance })), ...(() => {
    const out: { a: number; b: number; prov: Provenance }[] = []; let s = 0;
    for (const [a, b] of stubs) { if (a > s) out.push({ a: s, b: a, prov: 'source' }); s = b; }
    if (s < len) out.push({ a: s, b: len, prov: 'source' });
    return out;
  })()] : aligned);
  const report: InfraReport = {
    format: 'yutreno-infra-report', version: 1,
    line: { id, name, length_m: Math.round(len), from: st[0].name, to: st[st.length - 1].name },
    sources: [
      { id: 'osm', description: `OpenStreetMap, Overpass extract (${t.ways.length} ways on the path)`, licence: 'Open Database License 1.0: attribution, and share-alike for derived databases such as this line', attribution: OSM_ATTRIBUTION, elements: t.extract.elements, ...(t.extract.timestamp ? { timestamp: t.extract.timestamp } : {}) },
      ...(ov ? [{ id: 'rinf' as SourceId, description: 'RINF, register of infrastructure of the ERA, SPARQL query of the knowledge graph', licence: 'ERA terms of use of the RINF data (https://www.era.europa.eu/system/files/2022-11/rinf_terms_of_use_en.pdf)', attribution: RINF_ATTRIBUTION }] : []),
      ...(demAlt0 != null ? [{ id: 'dem' as SourceId, description: `${o.demSource ?? DEM_DEFAULT}, ${demPoints} points on the line`, licence: 'Copernicus data policy: free and open use with attribution', attribution: DEM_ATTRIBUTION }] : []),
      { id: 'yutreno', description: 'rules of YuTreno for what the sources do not give', licence: 'as the rest of YuTreno', attribution: '' },
    ],
    shares: {
      alignment: alignmentShare,
      stations: { source: stations.filter(s => s.prov === 'source').length, derived: stations.filter(s => s.prov === 'derived').length, generated: 0 },
      speed: share(len, speedM),
      gradient: share(len, gradM),
      tunnels: alignmentShare,
      signals: blockDerived ? { source: 0, derived: Math.round(len), generated: 0 } : { source: 0, derived: 0, generated: Math.round(len) },
      signalling: share(len, signalling),
      electrification: share(len, electr),
    },
    stations,
    speed: speedM,
    gradient: gradM.map(x => ({ ...x, a: r1(x.a), b: r1(x.b) })),
    signalling, electrification: electr,
    signals: { mapped: signals.length, main: mains.length, block_m: block, block_prov: blockDerived ? 'derived' : 'generated' },
    suggested_sig: etcs >= 0.95 * len ? 'ETCS' : 'BACC',
    consistency: ov?.consistency ?? [],
    speed_conflicts: mc,
    gradient_check: gradientCheck,
    warnings,
  };
  return { line, report };
}

const km = (m: number) => (m / 1000).toFixed(3);
const pct = (x: ShareOf, tot: number) => tot ? `${(x.source / tot * 100).toFixed(0)} % / ${(x.derived / tot * 100).toFixed(0)} % / ${(x.generated / tot * 100).toFixed(0)} %` : '–';

/** The import report as Markdown, for people */
export function reportMarkdown(r: InfraReport): string {
  const L = r.line.length_m, out: string[] = [];
  out.push(`# Import report: ${r.line.name}`, '', `Line \`${r.line.id}\`, ${km(L)} km from ${r.line.from} to ${r.line.to}. Suggested signalling: ${r.suggested_sig}.`, '');
  out.push('## Sources and licences', '');
  for (const s of r.sources) out.push(`- **${s.id}**: ${s.description}${s.timestamp ? `, data of ${s.timestamp}` : ''}. Licence: ${s.licence}.${s.attribution ? ` Attribution: ${s.attribution}.` : ''}`);
  out.push('', '## How much of the line is real', '', '| Property | Source / derived / generated |', '| :-- | :-- |');
  for (const [k, v] of Object.entries(r.shares)) out.push(`| ${k} | ${k === 'stations' ? `${v.source} / ${v.derived} / ${v.generated} stations` : pct(v, L)} |`);
  out.push('', `Signals: ${r.signals.mapped} mapped on the path, ${r.signals.main} main; block sections of ${r.signals.block_m} m, ${r.signals.block_prov}. The signals of the simulation are generated with that block length: a result on this line is read with that caution.`);
  out.push('', '## Stations', '', '| Station | km | Provenance | Element |', '| :-- | --: | :-- | :-- |');
  for (const s of r.stations) out.push(`| ${s.name} | ${km(s.s)} | ${s.prov} | ${s.ref} |`);
  out.push('', '## Speed', '', '| From km | To km | km/h | Provenance | Source |', '| --: | --: | --: | :-- | :-- |');
  for (const s of r.speed) out.push(`| ${km(s.a)} | ${km(s.b)} | ${s.v} | ${s.prov} | ${s.src}${s.ref ? ` ${s.ref.split(' ').slice(0, 3).join(' ')}${s.ref.split(' ').length > 3 ? ' …' : ''}` : ''} |`);
  const above = r.speed_conflicts.filter(c => c.osm > c.rinf), below = r.speed_conflicts.filter(c => c.osm < c.rinf);
  if (above.length) {
    out.push('', 'Where OSM gives more than the RINF maximum of the section, the RINF value is kept:', '');
    for (const c of above) out.push(`- km ${km(c.a)}–${km(c.b)}: OSM ${c.osm} km/h, RINF ${c.rinf} km/h`);
  }
  if (below.length) {
    out.push('', below.some(c => c.kept === 'rinf')
      ? 'Where OSM gives less than RINF, the RINF value is kept (policy `rinf`, the default): these OSM limits are set aside and may be local limits that RINF does not record, to check against a timetable (`npm run plausibility`):'
      : 'Where OSM gives less than RINF, the lower OSM value is kept (policy `lower`):', '');
    for (const c of below) out.push(`- km ${km(c.a)}–${km(c.b)}: OSM ${c.osm} km/h, RINF ${c.rinf} km/h, kept ${c.kept === 'osm' ? 'OSM' : 'RINF'}`);
  }
  if (r.gradient_check.length) {
    out.push('', '## Gradients of RINF against the DEM', '', 'Climb from station to station (m) with the gradients of RINF, used for the line, and with the ground of the DEM:', '', '| From | To | RINF m | DEM m |', '| :-- | :-- | --: | --: |');
    for (const c of r.gradient_check) out.push(`| ${c.from} | ${c.to} | ${c.rinf_m} | ${c.dem_m} |`);
  }
  if (r.consistency.length) {
    out.push('', '## Consistency of the sources', '', '| From | To | OSM m | RINF m | Difference |', '| :-- | :-- | --: | --: | --: |');
    for (const c of r.consistency) out.push(`| ${c.from} | ${c.to} | ${c.osm_m} | ${c.rinf_m} | ${c.diff_pct} % |`);
  }
  out.push('', '## Protection and electrification', '');
  for (const s of r.signalling) out.push(`- km ${km(s.a)}–${km(s.b)}: ${s.v} (${s.src})`);
  for (const s of r.electrification) out.push(`- km ${km(s.a)}–${km(s.b)}: ${s.v} (${s.src})`);
  if (!r.signalling.length && !r.electrification.length) out.push('Not given by the sources.');
  if (r.warnings.length) { out.push('', '## Warnings', ''); for (const w of r.warnings) out.push(`- ${w}`); }
  return out.join('\n') + '\n';
}
