/**
 * Writes the examples of the feeds in examples/feeds/: the crossing scenario (scenarios/services/crossing.json) at
 * t = 600 s, with both trains running, in every format YuTreno produces. XML is indented and the GTFS archive is
 * unpacked so that the files can be read in the repository; verify-feeds checks that they are up to date.
 *   npx tsx scripts/feeds-examples.ts
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DEFAULT_FEED_OPTIONS as O, formatXml, gtfsFiles, gtfsRealtime, netexTimetable, railmlTimetable, siriEstimatedTimetable, siriVehicleMonitoring } from '../src/feeds';
import { FeedRun } from '../src/server/feeds-server';
import { loadScenarios } from '../src/server/headless';

export const EXAMPLE_DIR = 'examples/feeds', EXAMPLE_TIME = 600;

/** The example files (path relative to examples/feeds → content) */
export function exampleFiles(): Record<string, string> {
  const run = new FeedRun(loadScenarios('scenarios/services/crossing.json')[0].def);
  run.advance(EXAMPLE_TIME);
  const sim = run.sim, out: Record<string, string> = {};
  // GTFS writes CRLF; the examples use LF like the rest of the repository, so that git does not rewrite them
  for (const [k, v] of Object.entries(gtfsFiles(sim, O))) out['gtfs/' + k] = v.replace(/\r\n/g, '\n');
  out['gtfs-rt/vehicle-positions.json'] = JSON.stringify(gtfsRealtime(sim, O, 'vehicles'), null, 2) + '\n';
  out['gtfs-rt/trip-updates.json'] = JSON.stringify(gtfsRealtime(sim, O, 'trips'), null, 2) + '\n';
  out['siri/vehicle-monitoring.xml'] = formatXml(siriVehicleMonitoring(sim, O));
  out['siri/estimated-timetable.xml'] = formatXml(siriEstimatedTimetable(sim, O));
  out['netex/timetable.xml'] = formatXml(netexTimetable(sim, O));
  out['railml/timetable.xml'] = formatXml(railmlTimetable(sim, O));
  return out;
}

const isMain = process.argv[1] && /feeds-examples\.ts$/.test(process.argv[1]);
if (isMain) {
  for (const [k, v] of Object.entries(exampleFiles())) {
    const p = join(EXAMPLE_DIR, k);
    mkdirSync(join(p, '..'), { recursive: true });
    writeFileSync(p, v);
  }
  console.log(`examples written in ${EXAMPLE_DIR}`);
}
