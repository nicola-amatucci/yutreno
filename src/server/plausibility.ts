/**
 * Plausibility of an imported line against a real timetable (docs/INFRA_IMPORT.md): the running time simulated
 * between consecutive stops, with the train driven as fast as the line allows, against the running time of the
 * timetable on the same stretch.
 *
 * The simulated train is the controlled one with `examples/ato.js`, stopping at every stop of the timetable and always
 * late (all timetabled times are zero), so it never waits nor coasts to keep time; the leading freight train of the
 * line is switched off. The timetable gives the time from
 * the departure at a stop to the arrival at the next. A timetable is not expected to match the simulation, because it
 * contains running time supplements and recovery margins; it is plausible when, stretch by stretch,
 *   lower × simulated ≤ timetable ≤ upper × simulated + slack
 * with the declared defaults lower 0.98 (a timetable cannot be faster than the train can run, with 2 % for the model),
 * upper 1.35 and slack 120 s (supplements, recovery margins and the time to start and stop).
 *   npm run plausibility -- --line <line.json> --scenario <scenario with services.json> [--service <id>] [--train <id>]
 */
import { readFileSync } from 'node:fs';
import { DEFAULT_SCENARIO, LINE_PRESETS, Simulation, TRAIN_PRESETS, clone, runLockstep, type LineDef, type Signalling, type TrainParams } from '../core';
import { loadJsController, parseArgs } from './headless';

export interface TimetableStop { station: string; arrival_s?: number | null; departure_s?: number | null }
export interface PlausibilityRow { from: string; to: string; simulated_s: number; timetable_s: number; ratio: number; ok: boolean }
export interface PlausibilityOptions { train?: TrainParams; sig?: Signalling; lower?: number; upper?: number; slack_s?: number; controller?: string }
export interface Plausibility { rows: PlausibilityRow[]; ok: boolean; bounds: { lower: number; upper: number; slack_s: number } }

/** Simulated running times between consecutive stops of a timetable, and their check against it */
export async function plausibility(line: LineDef, timetable: TimetableStop[], o: PlausibilityOptions = {}): Promise<Plausibility> {
  const lower = o.lower ?? 0.98, upper = o.upper ?? 1.35, slack = o.slack_s ?? 120;
  const order = new Map(line.stations.map((s, i) => [s.name, i]));
  const stops = timetable.filter(t => order.has(t.station));
  if (stops.length < 2) throw new Error('plausibility: the timetable has fewer than two stops on the line');
  for (let i = 1; i < stops.length; i++) if (order.get(stops[i].station)! <= order.get(stops[i - 1].station)!)
    throw new Error('plausibility: the timetable must run in the direction of the line (station order)');
  // the line reduced to the stops of the timetable, all times zero
  const keep = new Set(stops.map(s => s.station));
  const def: LineDef = clone(line);
  def.freight = { ...def.freight, on: false };
  def.stations = line.stations.filter(s => keep.has(s.name)).map((s, i, a) => ({ ...s, arr: i === 0 ? null : 0, dep: i === a.length - 1 ? null : 0 }));
  const sim = new Simulation(def, clone(o.train ?? TRAIN_PRESETS.regional), { ...DEFAULT_SCENARIO, sig: o.sig ?? 'BACC' });
  await runLockstep(sim, loadJsController(o.controller ?? 'examples/ato.js'), { period: 0.2, source: 'ato', maxTime: 6 * 3600 });
  const re = sim.train.realised;
  const rows: PlausibilityRow[] = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i], b = stops[i + 1];
    const ra = re.find(r => r.station === a.station), rb = re.find(r => r.station === b.station);
    if (ra?.departure_s == null || rb?.arrival_s == null) throw new Error(`plausibility: the simulated train did not run ${a.station} – ${b.station}`);
    if (a.departure_s == null || b.arrival_s == null) continue;
    const sim_s = rb.arrival_s - ra.departure_s, tt = b.arrival_s - a.departure_s;
    rows.push({ from: a.station, to: b.station, simulated_s: +sim_s.toFixed(1), timetable_s: tt, ratio: +(tt / sim_s).toFixed(3), ok: tt >= lower * sim_s && tt <= upper * sim_s + slack });
  }
  return { rows, ok: rows.every(r => r.ok), bounds: { lower, upper, slack_s: slack } };
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  if (a.help || !a.line) {
    process.stdout.write('Usage: npm run plausibility -- --line <line.json|preset> [--scenario <file with services>] [--service <id>] [--train <id>] [--lower 0.98] [--upper 1.35] [--slack 120]\n'
      + 'Without --scenario the timetable is that of the stations of the line.\n');
    if (!a.help) process.exitCode = 1;
    return;
  }
  const line: LineDef = LINE_PRESETS[a.line] ? clone(LINE_PRESETS[a.line]) : JSON.parse(readFileSync(a.line, 'utf8'));
  let tt: TimetableStop[] = line.stations.map(s => ({ station: s.name, arrival_s: s.arr, departure_s: s.dep }));
  if (a.scenario) {
    const sc = JSON.parse(readFileSync(a.scenario, 'utf8'));
    const svc = (sc.services ?? []).find((s: { id: string }) => !a.service || s.id === a.service);
    if (!svc) throw new Error(`no service ${a.service ?? ''} in ${a.scenario}`);
    tt = svc.stops;
  }
  const r = await plausibility(line, tt, {
    train: a.train ? TRAIN_PRESETS[a.train] : undefined,
    lower: a.lower ? +a.lower : undefined, upper: a.upper ? +a.upper : undefined, slack_s: a.slack ? +a.slack : undefined,
  });
  console.log('| From | To | Simulated s | Timetable s | Ratio | Plausible |\n| :-- | :-- | --: | --: | --: | :-- |');
  for (const x of r.rows) console.log(`| ${x.from} | ${x.to} | ${x.simulated_s} | ${x.timetable_s} | ${x.ratio} | ${x.ok ? 'yes' : 'no'} |`);
  console.log(`\nBounds: ${r.bounds.lower} × simulated ≤ timetable ≤ ${r.bounds.upper} × simulated + ${r.bounds.slack_s} s. ${r.ok ? 'Plausible.' : 'Not plausible on some stretches.'}`);
  if (!r.ok) process.exitCode = 2;
}

if (process.argv[1] && /plausibility\.ts$/.test(process.argv[1])) main().catch(e => { console.error(String(e?.message ?? e)); process.exit(1); });
