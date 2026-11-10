/**
 * Service campaign (docs/CAMPAIGN.md, "Service campaign"): a sweep over the parameters of the service, that is lines,
 * number of trains, headway, directions, signalling and passenger demand, with measures of punctuality, passengers
 * and energy for each run. Every run is a scenario configuration (docs/SCENARIO_CONFIG.md) driven by examples/ato.js,
 * so the results are deterministic: runs.csv carries a fingerprint per run and determinism.csv repeats one run.
 *   npx tsx scripts/service-campaign.ts [--config campaigns/services.json] [--output <folder>]
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Simulation, resolveScenario, runLockstep, scenarioFromConfig, type LineDef, type OnboardKind, type PassengerDef, type ScenarioConfig, type Signalling } from '../src/core';
import { loadJsController } from '../src/server/headless';
import { resolvePaths } from '../src/server/make-scenario';

export interface ServiceCampaign {
  name: string;
  description?: string;
  /** Lines: id of a built-in line or path of a line.json, relative to the campaign file */
  lines: string[];
  trains: number[];
  headways_s: number[];
  directions: ('forward' | 'backward' | 'both')[];
  signalling: Signalling[];
  /** ETCS onboard of every train (default: the one of the scenario configuration, the internal supervision) */
  onboard?: OnboardKind;
  /** Train spacing to compare (docs/MOVING_BLOCK.md); without it the runs are those of the fixed block, without a column */
  spacing?: ('fixed_block' | 'moving_block')[];
  /** Passengers per hour leaving every station, spread evenly over the other stations; 0 = no passengers */
  demand_per_station_per_hour: number[];
  arrivals?: 'uniform' | 'poisson';
  seed?: number;
  /** Controller of the driven train (default examples/ato.js) */
  controller?: string;
  /** Delay up to which a train is on time at its last stop (s, default 180) */
  on_time_s?: number;
}

export interface ServiceSpec { line: string | LineDef; lineName: string; trains: number; headway_s: number; directions: 'forward' | 'backward' | 'both'; signalling: Signalling; onboard?: OnboardKind; spacing?: 'fixed_block' | 'moving_block'; demand: number; arrivals: 'uniform' | 'poisson'; seed: number; controller: string; onTime: number }

const f = (x: number | null | undefined, d: number) => (x == null || !isFinite(x) ? '' : x.toFixed(d));
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

/** Every station sends `perHour` people an hour, spread evenly over the others (as the form of the page) */
export function evenDemand(line: LineDef, perHour: number, arrivals: 'uniform' | 'poisson', seed: number): PassengerDef | undefined {
  if (!(perHour > 0)) return undefined;
  const n = line.stations.map(s => s.name), share = perHour / Math.max(1, n.length - 1);
  return { arrivals, seed, demand: n.flatMap(a => n.filter(b => b !== a).map(b => ({ from: a, to: b, per_hour: share }))) };
}

/** One run of the sweep and its measures */
export async function runService(s: ServiceSpec): Promise<Record<string, string | number>> {
  const base: ScenarioConfig = { line: s.line, signalling: s.signalling, trains: { count: s.trains, headway_s: s.headway_s, directions: s.directions } };
  const lineDef = typeof s.line === 'string' ? resolveScenario({ name: 'x', line: s.line }).line : s.line;
  const p = evenDemand(lineDef, s.demand, s.arrivals, s.seed);
  const def = { ...scenarioFromConfig(p ? { ...base, passengers: p } : base), ...(s.onboard ? { onboard: s.onboard } : {}), ...(s.spacing ? { spacing: s.spacing } : {}) };
  const r = resolveScenario(def);
  const sim = new Simulation(r.line, r.train, r.scen, def);
  await runLockstep(sim, loadJsController(s.controller), { period: 0.2, source: 'ato' });
  // punctuality of the services at their last stop, against the planned timetable
  const tt = sim.timetable().filter(t => t.id !== 'train');
  const delays = tt.map(t => t.stops[t.stops.length - 1]?.arrival_delay_s).filter((d): d is number => d != null);
  const arrived = sim.trains.filter(t => sim.summary(t).finished).length;
  const px = sim.passengers();
  const energy = sim.trains.reduce((a, t) => a + t.S.eT - t.S.eR, 0);
  const csv = sim.trains.map(t => sim.csv(t)).join('\n') + JSON.stringify(px);
  return {
    line: s.lineName, trains: s.trains, headway_s: s.headway_s, directions: s.directions, signalling: s.signalling,
    ...(s.onboard ? { onboard: s.onboard } : {}), ...(s.spacing ? { spacing: s.spacing } : {}), demand_per_station_h: s.demand,
    arrivals: p ? s.arrivals : '', trains_arrived: arrived, trains_total: sim.trains.length,
    interventions: sim.trains.reduce((a, t) => a + sim.summary(t).interventions, 0), overruns: sim.trains.reduce((a, t) => a + sim.summary(t).overruns, 0),
    mean_delay_s: f(delays.length ? delays.reduce((a, b) => a + b, 0) / delays.length : null, 1), max_delay_s: f(delays.length ? Math.max(...delays) : null, 1),
    on_time_share: f(delays.length ? delays.filter(d => d <= s.onTime).length / delays.length : null, 3),
    passengers: f(px?.boarded, 1), left_behind: f(px?.left_behind, 1), mean_wait_s: f(px?.mean_wait_s, 1), max_wait_s: f(px?.max_wait_s, 1),
    mean_journey_s: f(px?.mean_journey_s, 1), passenger_delay_s: f(px?.mean_passenger_delay_s, 1),
    max_load_factor: f(px ? Math.max(0, ...px.trains.map(t => t.max_load_factor)) : null, 3), passenger_km: f(px?.passenger_km, 1),
    signalling_constrained_s: f(sim.trains.reduce((a, t) => a + sim.summary(t).signalling_constrained_s, 0), 1),
    signalling_constrained_max_s: f(Math.max(0, ...sim.trains.map(t => sim.summary(t).signalling_constrained_s)), 1),
    net_energy_kWh: f(energy, 3), energy_Wh_per_pkm: f(px?.energy_wh_per_pkm, 1),
    end_s: f(sim.time, 1), hash_output: sha(csv).slice(0, 16),
  };
}

/**
 * For every group of runs that differ only by headway: the smallest headway of the sweep from which, at that headway
 * and above, no train is held by the signalling (docs/CAPACITY.md, "Time held by the signalling"), and the next
 * smaller one of the sweep, where some train still is. Empty threshold: held at every headway of the sweep.
 */
export function thresholds(rows: Record<string, string | number>[]): Record<string, string | number>[] {
  const groups = new Map<string, Record<string, string | number>[]>();
  for (const r of rows) {
    const k = [r.line, r.signalling, r.onboard ?? '', r.spacing ?? '', r.trains, r.directions, r.demand_per_station_h].join('|');
    if (!groups.has(k)) groups.set(k, []);
    (groups.get(k) as Record<string, string | number>[]).push(r);
  }
  const out: Record<string, string | number>[] = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const by = [...g].sort((a, b) => Number(a.headway_s) - Number(b.headway_s));
    let i = by.length;
    while (i > 0 && Number(by[i - 1].signalling_constrained_max_s) <= 0.5) i--;
    const r0 = by[0];
    out.push({ line: r0.line, signalling: r0.signalling, ...(r0.spacing ? { onboard: r0.onboard ?? '', spacing: r0.spacing } : {}), trains: r0.trains, directions: r0.directions, demand_per_station_h: r0.demand_per_station_h,
      threshold_s: i < by.length ? by[i].headway_s : '', held_below_s: i > 0 ? by[i - 1].headway_s : '', held_below_max_s: i > 0 ? by[i - 1].signalling_constrained_max_s : '' });
  }
  return out;
}

export function specsOf(c: ServiceCampaign, base: string): ServiceSpec[] {
  const out: ServiceSpec[] = [];
  for (const l of c.lines) {
    const loaded = resolvePaths({ line: l, trains: { count: 0 } }, base).line;
    const lineName = typeof loaded === 'string' ? l : loaded.name;
    for (const sig of c.signalling) for (const sp of c.spacing ?? [undefined]) for (const dir of c.directions) for (const n of c.trains) for (const h of c.headways_s) for (const d of c.demand_per_station_per_hour)
      out.push({ line: loaded, lineName, trains: n, headway_s: h, directions: dir, signalling: sig, ...(c.onboard ? { onboard: c.onboard } : {}), ...(sp ? { spacing: sp } : {}), demand: d, arrivals: c.arrivals ?? 'uniform', seed: c.seed ?? 1, controller: resolve(base, c.controller ?? '../examples/ato.js'), onTime: c.on_time_s ?? 180 });
  }
  return out;
}

export function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (x: unknown) => { const s = String(x ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return cols.join(',') + '\n' + rows.map(r => cols.map(k => cell(r[k])).join(',')).join('\n') + '\n';
}

async function main() {
  const a: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  const file = a.config || 'campaigns/services.json';
  const c = JSON.parse(readFileSync(file, 'utf8')) as ServiceCampaign;
  const out = a.output || join('results', 'service-campaign-' + c.name);
  mkdirSync(out, { recursive: true });
  const specs = specsOf(c, dirname(resolve(file)));
  const t0 = Date.now(), rows: Record<string, string | number>[] = [];
  for (const [i, s] of specs.entries()) {
    const r = await runService(s);
    rows.push(r);
    console.log(`[${String(i + 1).padStart(3)}/${specs.length}] ${String(r.line).slice(0, 26).padEnd(26)} ${String(r.signalling).padEnd(4)} ${String(r.trains).padStart(2)} trains every ${String(r.headway_s).padStart(4)} s ${String(r.directions).padEnd(8)} ` +
      `demand ${String(r.demand_per_station_h).padStart(4)}/h  delay ${String(r.mean_delay_s).padStart(6)} s  on time ${r.on_time_share}  wait ${String(r.mean_wait_s).padStart(6)} s  left ${String(r.left_behind).padStart(6)}  ${r.hash_output}`);
  }
  writeFileSync(join(out, 'runs.csv'), toCsv(rows));
  const th = thresholds(rows);
  if (th.length) {
    writeFileSync(join(out, 'thresholds.csv'), toCsv(th));
    for (const t of th) console.log(`threshold: ${t.line} ${t.signalling}${t.spacing ? ' ' + t.spacing : ''} ${t.trains} trains ${t.directions} demand ${t.demand_per_station_h}/h: no train held by the signalling from ${t.threshold_s || '—'} s (held at ${t.held_below_s || '—'} s)`);
  }
  // determinism: the first run again, in the same process
  const again = await runService(specs[0]);
  const det = [{ check: 'first run of the sweep', hash_output: rows[0].hash_output, same: 1 }, { check: 'first run again in the same process', hash_output: again.hash_output, same: again.hash_output === rows[0].hash_output ? 1 : 0 }];
  writeFileSync(join(out, 'determinism.csv'), toCsv(det));
  writeFileSync(join(out, 'metadata.json'), JSON.stringify({ campaign: c, runs: rows.length, node: process.version, wall_duration_s: (Date.now() - t0) / 1000, hash_runs_csv: sha(readFileSync(join(out, 'runs.csv'), 'utf8')) }, null, 2) + '\n');
  console.log(`\nResults in ${out} (${rows.length} runs, ${((Date.now() - t0) / 1000).toFixed(0)} s); determinism ${det[1].same ? 'same' : 'DIFFERENT'}`);
  if (!det[1].same) process.exit(1);
}

if (process.argv[1] && /service-campaign\.ts$/.test(process.argv[1])) main().catch(e => { console.error(String(e?.message ?? e)); process.exit(1); });
