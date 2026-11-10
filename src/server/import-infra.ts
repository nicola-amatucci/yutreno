/**
 * Imports a real line from an OpenStreetMap extract (Overpass JSON) and, optionally, a RINF query result, as a YuTreno
 * line with its import report (docs/INFRA_IMPORT.md).
 *   npm run import-infra -- --osm extract.json --from "Borgo Alto" --to "Ripa Bassa" [--rinf rinf.json]
 *                           [--id <id>] [--name <name>] [--output line.json] [--report report.md] [--railml-out infra.xml]
 *   npm run import-infra -- --railml infra.xml [--output line.json]      reads back a railML 3.2 infrastructure
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { elevationPoints, importInfrastructure, importRailmlInfrastructure, railmlInfrastructure, reportMarkdown } from '../infra';
import { parseArgs } from './headless';

const HELP = `Usage: npm run import-infra -- --osm <Overpass .json> --from <station> --to <station> [options]
  --rinf <file.json>        result of the RINF SPARQL query (SPARQL JSON), laid over the OSM data
  --id <id>, --name <name>  id and name of the line (default from the terminal stations)
  --default-speed <km/h>    speed where no source gives one (default 80)
  --speed-policy <rinf|lower>  where both sources give a speed: RINF (default) or the lower of the two
  --block <m>               block length if the mapped signals do not give one (default 1300)
  --service-tracks          also follow sidings, yards, spurs and crossovers
  --output <file.json>      writes the line (default: printed)
  --report <file>           writes the import report: Markdown, or JSON if the name ends in .json
  --elevation <file.json>   altitudes of a DEM along the line (OpenTopoData answers or [{lat, lon, elevation}])
  --elevation-points <file> writes the points of the line every 100 m, to ask a DEM service for their altitudes
  --railml-out <file.xml>   also writes the infrastructure of the line in railML 3.2
  --railml <file.xml>       instead of OSM: reads a line from a railML 3.2 infrastructure (one netElement)
`;

function main(): void {
  const a = parseArgs(process.argv.slice(2));
  if (a.railml && !a.help) {
    const line = importRailmlInfrastructure(readFileSync(a.railml, 'utf8'));
    const json = JSON.stringify(line, null, 1) + '\n';
    if (a.output) writeFileSync(a.output, json); else process.stdout.write(json);
    return;
  }
  if (a.help || !a.osm || !a.from || !a.to) { process.stdout.write(HELP); if (!a.help) process.exitCode = 1; return; }
  const r = importInfrastructure(readFileSync(a.osm, 'utf8'), {
    from: a.from, to: a.to, id: a.id, name: a.name,
    defaultSpeed_kmh: a['default-speed'] ? +a['default-speed'] : undefined,
    ...(a['speed-policy'] ? { speedPolicy: a['speed-policy'] as 'rinf' | 'lower' } : {}),
    defaultBlock_m: a.block ? +a.block : undefined,
    serviceTracks: a['service-tracks'] === 'true',
  }, a.rinf ? readFileSync(a.rinf, 'utf8') : undefined, a.elevation ? readFileSync(a.elevation, 'utf8') : undefined);
  for (const w of r.report.warnings) console.error('warning: ' + w);
  const json = JSON.stringify(r.line, null, 1) + '\n';
  if (a.output) writeFileSync(a.output, json); else process.stdout.write(json);
  if (a['elevation-points']) writeFileSync(a['elevation-points'], JSON.stringify(elevationPoints(r.line)) + '\n');
  if (a['railml-out']) writeFileSync(a['railml-out'], railmlInfrastructure(r.line));
  if (a.report) writeFileSync(a.report, a.report.endsWith('.json') ? JSON.stringify(r.report, null, 1) + '\n' : reportMarkdown(r.report));
  const sh = r.report.shares, L = r.report.line.length_m;
  console.error(`${r.report.line.name}: ${(L / 1000).toFixed(3)} km, ${r.line.stations.length} stations; from the sources: alignment ${Math.round(sh.alignment.source / L * 100)} %, speed ${Math.round((sh.speed.source + sh.speed.derived) / L * 100)} %, gradient ${Math.round((sh.gradient.source + sh.gradient.derived) / L * 100)} %`);
}

const isMain = process.argv[1] && /import-infra\.ts$/.test(process.argv[1]);
if (isMain) try { main(); } catch (e) { console.error(String((e as Error)?.message ?? e)); process.exit(1); }
