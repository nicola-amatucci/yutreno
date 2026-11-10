/**
 * Builds a real line from the public sources in one command (docs/LINE_TUTORIAL.md): OpenStreetMap through Overpass,
 * RINF through the ERA knowledge graph, altitudes from EU-DEM through OpenTopoData, then the import of
 * src/infra (docs/INFRA_IMPORT.md).
 *
 *   npm run line-from-sources -- --from "Cancello" --to "Benevento" --out lines/cancello-benevento
 *        [--bbox south,west,north,east] [--rinf-line <label>|auto|none] [--no-dem] [--refresh] [--id <id>] [--name <name>]
 *
 * Every download is saved in the output folder (overpass.json, rinf.json, dem.json) and reused on the next run, so a
 * run interrupted by a busy server resumes where it stopped and a line can be rebuilt offline; --refresh downloads
 * again. The output is line.json, report.md and railml.xml, as with npm run import-infra.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ENDPOINTS, abbreviated, demUrls, elevationPoints, importInfrastructure, normName, overpassQuery, overpassStationQuery,
  railmlInfrastructure, reportMarkdown, rinfFindLineQuery, rinfSectionsQuery, type BBox, type InfraImport,
} from '../infra';
import { parseArgs } from './headless';

export interface SourcesOptions {
  from: string;
  to: string;
  /** Output folder: downloads and results */
  out: string;
  bbox?: BBox;
  /** National line of RINF: its label, `auto` to look for it from the terminal stations (default), `none` to skip RINF */
  rinfLine?: string;
  /** Altitudes from EU-DEM (default true) */
  dem?: boolean;
  refresh?: boolean;
  id?: string;
  name?: string;
}

/** What the script needs from the network: a fetch-like function, replaced in the checks by the saved files */
export type Fetcher = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

const UA = { 'User-Agent': 'YuTreno line-from-sources (https://github.com/nicola-amatucci/yutreno)' };

/** Overpass with the public servers in turn, retrying with growing waits; an empty or broken answer counts as a failure */
async function overpass(q: string, f: Fetcher, wait: (ms: number) => Promise<void>, log: (s: string) => void): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    for (const url of ENDPOINTS.overpass) {
      try {
        const r = await f(url, { method: 'POST', headers: { ...UA, 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q) });
        const t = await r.text();
        if (!r.ok) { log(`  ${url}: HTTP ${r.status}`); continue; }
        const j = JSON.parse(t);
        if (!Array.isArray(j.elements) || !j.elements.length || !/^\d{4}-/.test(j.osm3s?.timestamp_osm_base ?? '')) { log(`  ${url}: empty or broken answer (timestamp ${j.osm3s?.timestamp_osm_base})`); continue; }
        return t;
      } catch (e) { log(`  ${url}: ${(e as Error).message}`); }
    }
    await wait(10000 * (attempt + 1));
  }
  throw new Error('Overpass: no server answered; try again later, or download the extract by hand (docs/LINE_TUTORIAL.md, step 2)');
}

async function sparql(q: string, f: Fetcher): Promise<any> {
  const r = await f(ENDPOINTS.rinf, { method: 'POST', headers: { ...UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'query=' + encodeURIComponent(q) });
  if (!r.ok) throw new Error(`RINF: HTTP ${r.status}`);
  return JSON.parse(await r.text());
}

/** The national line of RINF that has both terminal stations, or null */
async function findRinfLine(from: string, to: string, f: Fetcher, log: (s: string) => void): Promise<string | null> {
  const linesOf = async (station: string) => {
    const word = normName(station).split(' ').sort((a, b) => b.length - a.length)[0];
    const res = await sparql(rinfFindLineQuery(word), f);
    const set = new Set<string>();
    for (const b of res.results?.bindings ?? []) if (normName(b.name.value) === normName(station) || abbreviated(normName(b.name.value), station)) set.add(b.line.value);
    return set;
  };
  const a = await linesOf(from), b = await linesOf(to);
  const both = [...a].filter(x => b.has(x)).sort();
  if (both.length > 1) log(`  RINF: several lines have both stations (${both.join(', ')}); taking ${both[0]}, choose another with --rinf-line`);
  return both[0] ?? null;
}

export async function lineFromSources(o: SourcesOptions, f: Fetcher = fetch as unknown as Fetcher,
  wait: (ms: number) => Promise<void> = ms => new Promise(r => setTimeout(r, ms)), log: (s: string) => void = s => console.error(s)): Promise<InfraImport> {
  mkdirSync(o.out, { recursive: true });
  const file = (n: string) => join(o.out, n);
  const cached = (n: string) => !o.refresh && existsSync(file(n));

  // 1. OpenStreetMap
  if (!cached('overpass.json')) {
    let bbox = o.bbox;
    if (!bbox) {
      log('1. Overpass: looking for the two stations to find the bounding box');
      const st = JSON.parse(await overpass(overpassStationQuery([o.from, o.to]), f, wait, log)).elements as { lat: number; lon: number; tags: Record<string, string> }[];
      const pick = (n: string) => st.find(e => normName(e.tags?.name ?? '') === normName(n));
      const a = pick(o.from), b = pick(o.to);
      if (!a || !b) throw new Error(`station «${!a ? o.from : o.to}» not found in OpenStreetMap: give its exact name or --bbox`);
      const s = Math.min(a.lat, b.lat), n = Math.max(a.lat, b.lat), w = Math.min(a.lon, b.lon), e = Math.max(a.lon, b.lon);
      const m = Math.max(0.05, 0.2 * Math.max(n - s, e - w));
      bbox = [s - m, w - m, n + m, e + m];
    }
    log(`1. Overpass: railway in ${bbox.map(x => x.toFixed(3)).join(',')}`);
    writeFileSync(file('overpass.json'), await overpass(overpassQuery(bbox), f, wait, log));
  } else log('1. Overpass: overpass.json already there');
  const osm = readFileSync(file('overpass.json'), 'utf8');

  // 2. RINF
  let rinf: string | undefined;
  if (o.rinfLine !== 'none') {
    if (!cached('rinf.json')) {
      const line = o.rinfLine && o.rinfLine !== 'auto' ? o.rinfLine : await findRinfLine(o.from, o.to, f, log);
      if (!line) log('2. RINF: no national line has both stations; the line is built from OpenStreetMap alone');
      else {
        log(`2. RINF: sections of ${line}`);
        const res = await sparql(rinfSectionsQuery(line), f);
        if (res.results?.bindings?.length) writeFileSync(file('rinf.json'), JSON.stringify(res, null, 1) + '\n');
        else log(`2. RINF: the line ${line} has no sections`);
      }
    } else log('2. RINF: rinf.json already there');
    if (existsSync(file('rinf.json'))) rinf = readFileSync(file('rinf.json'), 'utf8');
  }

  const opts = { from: o.from, to: o.to, id: o.id, name: o.name };
  // 3. altitudes along the line imported without them
  let dem: string | undefined;
  if (o.dem !== false) {
    if (!cached('dem.json')) {
      const pts = elevationPoints(importInfrastructure(osm, opts, rinf).line);
      log(`3. EU-DEM: ${pts.length} points in ${Math.ceil(pts.length / 100)} requests`);
      const results: unknown[] = [];
      for (const url of demUrls(pts)) {
        let ok = false;
        for (let attempt = 0; attempt < 4 && !ok; attempt++) {
          const r = await f(url, { headers: UA });
          if (r.ok) { results.push(...(JSON.parse(await r.text()).results ?? [])); ok = true; } else await wait(2000 * (attempt + 1));
        }
        if (!ok) throw new Error('OpenTopoData: no answer; try again later or with --no-dem');
        await wait(1100);
      }
      writeFileSync(file('dem.json'), JSON.stringify({ results, status: 'OK' }) + '\n');
    } else log('3. EU-DEM: dem.json already there');
    dem = readFileSync(file('dem.json'), 'utf8');
  }

  // 4. import
  const r = importInfrastructure(osm, opts, rinf, dem);
  writeFileSync(file('line.json'), JSON.stringify(r.line, null, 1) + '\n');
  writeFileSync(file('report.md'), reportMarkdown(r.report));
  writeFileSync(file('railml.xml'), railmlInfrastructure(r.line));
  for (const w of r.report.warnings) log('warning: ' + w);
  log(`4. ${r.report.line.name}: ${(r.report.line.length_m / 1000).toFixed(3)} km, ${r.line.stations.length} stations; line.json, report.md and railml.xml in ${o.out}`);
  return r;
}

const HELP = `Usage: npm run line-from-sources -- --from <station> --to <station> --out <folder> [options]
  --bbox s,w,n,e            bounding box of the line (default: from the two stations, with a margin)
  --rinf-line <label>       national line of RINF, auto (default) or none
  --no-dem                  no altitudes from EU-DEM
  --refresh                 download again what is already in the folder
  --id <id>, --name <name>  id and name of the line
`;

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  if (a.help || !a.from || !a.to || !a.out) { process.stdout.write(HELP); if (!a.help) process.exitCode = 1; return; }
  const bbox = a.bbox ? a.bbox.split(',').map(Number) as BBox : undefined;
  if (bbox && (bbox.length !== 4 || bbox.some(x => !isFinite(x)))) throw new Error('--bbox: four numbers, south,west,north,east');
  await lineFromSources({ from: a.from, to: a.to, out: a.out, bbox, rinfLine: a['rinf-line'] ?? 'auto', dem: a['no-dem'] !== 'true', refresh: a.refresh === 'true', id: a.id, name: a.name });
}

if (process.argv[1] && /line-from-sources\.ts$/.test(process.argv[1])) main().catch(e => { console.error(String(e?.message ?? e)); process.exit(1); });
