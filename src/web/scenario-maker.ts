// Scenarios tab, "Make a scenario": the scenario configuration of docs/SCENARIO_CONFIG.md as a form. The page only
// collects the choices; the scenario is built by the core (scenarioFromConfig), the same as on the command line.
import { LINE_PRESETS, clone, scenarioFromConfig, validateScenario } from '../core';
import type { LineDef, PassengerDef, ScenarioConfig, TimetableExtract } from '../core';
import { $, cfg, esc } from './state';
import { applyScenario } from './scenarios';
import avellino from '../../examples/infra/avellino-benevento/line.json';
import cancello from '../../examples/infra/cancello-benevento/line.json';
import salerno from '../../examples/infra/salerno-mercato-s-severino/line.json';
import salernoTt from '../../examples/infra/salerno-mercato-s-severino/timetable.json';

/** Lines offered: the line in use, the built-in ones and the real lines of examples/infra, with their real timetable if any */
const REAL: Record<string, { line: LineDef; timetable?: TimetableExtract }> = {
  'real:salerno-mercato-s-severino': {
    line: salerno as unknown as LineDef,
    timetable: salernoTt as unknown as TimetableExtract,
  },
  'real:cancello-benevento': { line: cancello as unknown as LineDef },
  'real:avellino-benevento': { line: avellino as unknown as LineDef },
};

function lineOf(key: string): { line: string | LineDef; timetable?: TimetableExtract } {
  if (key === 'current') return { line: clone(cfg.line) };
  if (REAL[key]) return { line: clone(REAL[key].line), timetable: REAL[key].timetable };
  return { line: key };
}

/** Fills the list of lines (the line in use may have changed) keeping the choice */
export function renderMaker(): void {
  const keep = $('mkLine').value;
  $('mkLine').innerHTML =
    `<option value="current">The line in use: ${esc(cfg.line.name)}</option>` +
    Object.entries(LINE_PRESETS)
      .map(([k, l]) => `<option value="${k}">${esc(l.name)}</option>`)
      .join('') +
    Object.entries(REAL)
      .map(
        ([k, r]) =>
          `<option value="${k}">${esc(r.line.name)} (real${r.timetable ? ', with its timetable' : ''})</option>`,
      )
      .join('');
  if (keep) $('mkLine').value = keep;
  sync();
}

/** The real timetable is offered only for a line that has one */
function sync(): void {
  const has = !!lineOf($('mkLine').value).timetable,
    real = has && $('mkReal').value === 'real';
  $('mkRealL').hidden = !has;
  $('mkFromL').hidden = !real;
  $('mkHead').disabled = real;
  $('mkDir').disabled = real;
}

/** Every station sends `perHour` people an hour, spread evenly over the other stations of the line */
function demandOf(line: LineDef, perHour: number, arrivals: 'uniform' | 'poisson'): PassengerDef | undefined {
  if (!(perHour > 0)) return undefined;
  const names = line.stations.map(s => s.name),
    share = perHour / Math.max(1, names.length - 1);
  return {
    arrivals,
    seed: 1,
    demand: names.flatMap(a =>
      names.filter(b => b !== a).map(b => ({ from: a, to: b, per_hour: Math.round(share * 10) / 10 })),
    ),
  };
}

function make(): void {
  try {
    const { line, timetable } = lineOf($('mkLine').value);
    const def0: LineDef = typeof line === 'string' ? LINE_PRESETS[line] : line;
    const real = !!timetable && $('mkReal').value === 'real';
    const c: ScenarioConfig = {
      line,
      signalling: cfg.scen.sig,
      trains: {
        count: Math.max(0, Math.round(+$('mkCount').value || 0)),
        headway_s: Math.max(60, (+$('mkHead').value || 10) * 60),
        directions: $('mkDir').value,
      },
      ...(real ? { timetable, from: $('mkFrom').value || undefined } : {}),
    };
    const p = demandOf(def0, +$('mkPax').value, $('mkArr').value);
    if (p) c.passengers = p;
    const def = scenarioFromConfig(c);
    const err = validateScenario(def);
    if (err.length) throw new Error(err.join('; '));
    applyScenario(def);
    $('mkMsg').textContent =
      `Applied: ${def.name}, ${def.services?.length ?? 0} service trains${p ? ', with passengers' : ''}. Start the run from the Drive tab; the Timetable and Control room tabs show all the trains.`;
  } catch (e) {
    $('mkMsg').textContent = 'The scenario cannot be made: ' + (e as Error).message;
  }
}

$('mkLine').addEventListener('change', sync);
$('mkReal').addEventListener('change', sync);
$('mkApply').onclick = make;
renderMaker();
