/**
 * Builds a scenario from a configuration (docs/SCENARIO_CONFIG.md): line, number of trains and, optionally, a real
 * timetable extract. Paths in the configuration are relative to the configuration file.
 *   npm run make-scenario -- --config examples/scenario-config/salerno.json [--output scenario.json]
 *   npm run make-scenario -- --line valle-lauro --trains 4 [--headway 600] [--directions both] [--output file]
 * The scenario runs with `npm run headless -- --scenario <file>`; headless also accepts the configuration itself.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { LINE_PRESETS, scenarioFromConfig, validateScenario, type LineDef, type ScenarioConfig, type ScenarioDef, type TimetableExtract } from '../core';

/** Reads a configuration and loads the line and the timetable it refers to by path */
export function loadConfig(path: string): ScenarioConfig {
  const c = JSON.parse(readFileSync(path, 'utf8')) as ScenarioConfig;
  return resolvePaths(c, dirname(resolve(path)));
}

export function resolvePaths(c: ScenarioConfig, base: string): ScenarioConfig {
  const out = { ...c };
  if (typeof c.line === 'string' && !LINE_PRESETS[c.line] && /\.json$/i.test(c.line)) out.line = JSON.parse(readFileSync(resolve(base, c.line), 'utf8')) as LineDef;
  if (typeof c.timetable === 'string') out.timetable = JSON.parse(readFileSync(resolve(base, c.timetable), 'utf8')) as TimetableExtract;
  return out;
}

/** Scenario of a configuration, checked as any other scenario */
export function makeScenario(c: ScenarioConfig): ScenarioDef {
  const def = scenarioFromConfig(c);
  const err = validateScenario(def);
  if (err.length) throw new Error(err.join('; '));
  return def;
}

function main(argv: string[]): void {
  const a: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  if (a.help || (!a.config && !a.line)) {
    console.log('npm run make-scenario -- --config <file.json> [--output <file>]\n' +
      '       npm run make-scenario -- --line <preset|line.json> --trains <n> [--headway <s>] [--first <s>] [--directions forward|backward|both]\n' +
      '                                [--dwell <s>] [--train <id>] [--signalling ETCS|BACC] [--timetable <extract.json> [--from HH:MM]] [--output <file>]\n' +
      `lines: ${Object.keys(LINE_PRESETS).join(', ')}`);
    return;
  }
  let c: ScenarioConfig;
  if (a.config) c = loadConfig(a.config);
  else {
    const num = (k: string) => (a[k] != null ? Number(a[k]) : undefined);
    c = resolvePaths({
      line: a.line,
      ...(a.train ? { train: a.train } : {}),
      ...(a.signalling ? { signalling: a.signalling as ScenarioConfig['signalling'] } : {}),
      ...(a.timetable ? { timetable: a.timetable } : {}),
      ...(a.from ? { from: a.from } : {}),
      trains: {
        count: Number(a.trains ?? 1),
        ...(a.headway ? { headway_s: num('headway') } : {}),
        ...(a.first ? { first_departure_s: num('first') } : {}),
        ...(a.dwell ? { dwell_s: num('dwell') } : {}),
        ...(a.directions ? { directions: a.directions as 'forward' } : {}),
      },
    }, process.cwd());
  }
  const def = makeScenario(c);
  const json = JSON.stringify(def, null, 1) + '\n';
  if (a.output) {
    writeFileSync(a.output, json);
    console.log(`${a.output}: ${def.name}, ${def.services?.length ?? 0} services`);
  } else process.stdout.write(json);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  try { main(process.argv.slice(2)); } catch (e) { console.error(`error: ${(e as Error).message}`); process.exit(1); }
}
