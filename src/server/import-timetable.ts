/**
 * Imports a timetable (GTFS .zip, NeTEx XML or railML 2/3) as the service trains of a scenario.
 *   npm run import -- timetable.zip --line valle-lauro --date 2026-11-05 --output scenarios/services/imported.json
 *   npm run import -- netex.xml --scenario scenarios/services/crossing.json      (services replaced, printed)
 * Stops are matched to the stations of the line by name; stops outside the line, trips with fewer than two stops on
 * it, trips before the start of the run and the trip identical to the line timetable (the controlled train) are
 * dropped with a message on stderr.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { basename } from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { resolveScenario, validateScenario, type ScenarioDef } from '../core';
import { importTimetable } from '../feeds';
import { loadLine, loadScenarios, parseArgs } from './headless';

const HELP = `Usage: npm run import -- <GTFS .zip | NeTEx .xml | railML .xml> [options]
  --line <id|file.json>    line whose stations the stops are matched to (default: that of --scenario, or valle-lauro)
  --scenario <file.json>   scenario that receives the services (they replace its own)
  --date YYYY-MM-DD        only the trips running on that day (default: all)
  --start HH:MM:SS         local time of t = 0 (default 08:00:00)
  --keep-controlled        also import the trip identical to the line timetable
  --output <file.json>     writes the scenario (default: printed)
`;

async function main(): Promise<void> {
  const argv = process.argv.slice(2), a = parseArgs(argv), file = argv.find(x => !x.startsWith('--') && !argv[argv.indexOf(x) - 1]?.startsWith('--'));
  if (a.help || !file) { process.stdout.write(HELP); return; }
  const base: ScenarioDef = a.scenario ? loadScenarios(a.scenario)[0].def : { name: basename(file), line: a.line ?? 'valle-lauro', leader: { on: false } };
  const line = a.line ? loadLine(a.line) : resolveScenario(base).line;
  if (a.line) base.line = a.line;
  const r = await importTimetable(file, readFileSync(file), { line, date: a.date, start: a.start, keepControlled: a['keep-controlled'] === 'true' }, d => inflateRawSync(d));
  for (const w of r.warnings) console.error('warning: ' + w);
  if (!r.services.length) throw new Error('no service imported');
  // what the formats do not carry (train, minimum dwells, driver) is kept from the service with the same number
  const prev = new Map((base.services ?? []).map(s => [s.id, s]));
  const services = r.services.map(s => {
    const p = prev.get(s.id);
    if (!p) return s;
    const dwell = new Map(p.stops.map(x => [x.station, x.min_dwell_s]));
    return { ...s, ...(p.train ? { train: p.train } : {}), ...(p.driver ? { driver: p.driver } : {}),
      stops: s.stops.map(x => x.min_dwell_s == null && dwell.get(x.station) != null ? { ...x, min_dwell_s: dwell.get(x.station) } : x) };
  });
  const out: ScenarioDef = { ...base, leader: { ...(base.leader ?? {}), on: false }, services };
  const err = validateScenario(out);
  if (err.length) throw new Error(err.join('; '));
  const json = JSON.stringify(out, null, 2) + '\n';
  if (a.output) { writeFileSync(a.output, json); console.error(`${r.services.length} services from ${({ gtfs: 'GTFS', netex: 'NeTEx', railml: 'railML' })[r.format]} written in ${a.output}`); }
  else process.stdout.write(json);
}

const isMain = process.argv[1] && /import-timetable\.ts$/.test(process.argv[1]);
if (isMain) main().catch(e => { console.error(String((e as Error)?.message ?? e)); process.exit(1); });
