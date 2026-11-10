/**
 * Driver campaign (docs/DRIVER_MODEL.md): the model of a human driver of examples/driver_model.js against the ATO,
 * with three driving profiles × onboards × the ETCS scenarios of the reference campaign × several seeds per profile,
 * so that every profile has a spread. A campaign of its own, so the reference campaign keeps its fingerprint.
 *
 *   npx tsx scripts/driver-campaign.ts [--config campaigns/drivers.json] [--output <folder>]
 *
 * Outputs: runs.csv (one row per run, with the fingerprint of its CSV and events), summary.csv (mean and standard
 * deviation over the seeds, by driver × onboard), determinism.csv (the first run of a driver repeated with its seed,
 * and the same driver with another seed), metadata.json.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DEFAULT_SCENARIO, Simulation, clone, resolveScenario, runLockstep, type Scenario } from '../src/core';
import { loadJsController, loadScenarios } from '../src/server/headless';

interface Config {
  name: string; description?: string; scenarios: string[]; onboards: ('internal' | 'reference')[];
  /** Reference controllers driving once per scenario, for example the ATO */
  references: Record<string, string>;
  /** The driver model and its profiles, each run with every seed */
  driver: string; profiles: string[]; seeds: number[];
  period_s: number;
}
interface Spec { scenario: string; onboard: 'internal' | 'reference'; driver: string; file: string; params?: Record<string, unknown>; seed: number | null; period: number }

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const f = (x: number | null | undefined, d: number) => (x == null || !isFinite(x) ? '' : x.toFixed(d));

export async function runOne(spec: Spec) {
  const def = loadScenarios(spec.scenario)[0].def;
  const r = resolveScenario(def);
  const scen: Scenario = { ...DEFAULT_SCENARIO, ...r.scen, onboard: spec.onboard };
  const sim = new Simulation(clone(r.line), r.train, scen, def);
  await runLockstep(sim, loadJsController(spec.file, spec.params ? { PARAMS: spec.params } : undefined), { period: spec.period, source: spec.driver, api: 3 });
  const s = sim.summary(), res = sim.result();
  const out = sim.csv() + '\n' + JSON.stringify(sim.S.events);
  return {
    case_id: basename(spec.scenario, '.json'), onboard: spec.onboard, driver: spec.driver, seed: spec.seed ?? '',
    outcome: s.outcome, finished: s.finished ? 1 : 0, time_s: f(res.t_s, 2), arrival_delay_s: f(res.arrival_delay_s, 1),
    net_energy_kWh: f(s.traction_energy_kWh - s.regenerated_energy_kWh, 2), mean_stop_error_m: f(s.mean_stop_error_m, 2),
    warnings: s.warnings, service_brakings: s.service_brakings, interventions: s.interventions, overruns: s.overruns,
    max_over_limit_kmh: s.max_over_limit_kmh, signalling_constrained_s: s.signalling_constrained_s, max_jerk_ms3: s.max_jerk_ms3,
    hash_output: sha(out).slice(0, 16),
  };
}
type Row = Awaited<ReturnType<typeof runOne>>;

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]);
  const cell = (x: unknown) => { const s = String(x ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return cols.join(',') + '\n' + rows.map(r => cols.map(c => cell(r[c])).join(',')).join('\n') + '\n';
}

/** Mean and sample standard deviation of a column over a group of runs */
function stat(g: Row[], c: keyof Row): [string, string] {
  const x = g.map(r => Number(r[c])).filter(v => isFinite(v));
  if (!x.length) return ['', ''];
  const m = x.reduce((a, b) => a + b, 0) / x.length;
  const sd = x.length > 1 ? Math.sqrt(x.reduce((a, b) => a + (b - m) ** 2, 0) / (x.length - 1)) : 0;
  return [m.toFixed(2), sd.toFixed(2)];
}

async function main() {
  const a: Record<string, string> = {};
  const argv = process.argv.slice(2);
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  const cfg = JSON.parse(readFileSync(a.config || 'campaigns/drivers.json', 'utf8')) as Config;
  const outDir = a.output || join('results', 'driver-campaign-' + cfg.name);
  mkdirSync(outDir, { recursive: true });
  const t0 = Date.now();
  const specs: Spec[] = [];
  for (const scenario of cfg.scenarios) for (const onboard of cfg.onboards) {
    for (const [name, file] of Object.entries(cfg.references)) specs.push({ scenario, onboard, driver: name, file, seed: null, period: cfg.period_s });
    for (const profile of cfg.profiles) for (const seed of cfg.seeds)
      specs.push({ scenario, onboard, driver: profile, file: cfg.driver, params: { profile, seed }, seed, period: cfg.period_s });
  }
  const rows: Row[] = [];
  for (const [i, spec] of specs.entries()) {
    const r = await runOne(spec);
    rows.push(r);
    console.log(`[${String(i + 1).padStart(3)}/${specs.length}] ${r.case_id.padEnd(28)} ${r.onboard.padEnd(9)} ${String(r.driver).padEnd(10)} ${String(r.seed).padStart(2)} ` +
      `${r.outcome.padEnd(7)} ${r.time_s.padStart(8)} s ${r.net_energy_kWh.padStart(7)} kWh  W ${r.warnings} SBI ${r.service_brakings} EBI ${r.interventions}  held ${r.signalling_constrained_s} s  ${r.hash_output}`);
  }
  writeFileSync(join(outDir, 'runs.csv'), toCsv(rows));

  // by driver × onboard, over scenarios and seeds
  const groups = new Map<string, Row[]>();
  for (const r of rows) { const k = r.driver + '|' + r.onboard; if (!groups.has(k)) groups.set(k, []); (groups.get(k) as Row[]).push(r); }
  const summary = [...groups.entries()].map(([k, g]) => {
    const [driver, onboard] = k.split('|');
    const cols: (keyof Row)[] = ['time_s', 'net_energy_kWh', 'warnings', 'service_brakings', 'interventions', 'signalling_constrained_s', 'mean_stop_error_m', 'max_jerk_ms3'];
    const o: Record<string, string | number> = { driver, onboard, runs: g.length, passed: g.filter(r => r.outcome === 'passed').length };
    for (const c of cols) { const [m, sd] = stat(g, c); o[c + '_mean'] = m; o[c + '_sd'] = sd; }
    return o;
  });
  writeFileSync(join(outDir, 'summary.csv'), toCsv(summary));

  // determinism: the same seed gives the same run, another seed a different one
  const first = specs.find(s => s.seed != null) as Spec, ref = rows[specs.indexOf(first)].hash_output;
  const again = (await runOne(first)).hash_output, other = (await runOne({ ...first, seed: first.seed! + 100, params: { ...first.params, seed: first.seed! + 100 } })).hash_output;
  const det = [
    { check: 'first driver run of the matrix', hash_output: ref, ok: 1 },
    { check: 'the same driver and seed again', hash_output: again, ok: again === ref ? 1 : 0 },
    { check: 'the same driver with another seed: a different run', hash_output: other, ok: other !== ref ? 1 : 0 },
  ];
  writeFileSync(join(outDir, 'determinism.csv'), toCsv(det));
  writeFileSync(join(outDir, 'metadata.json'), JSON.stringify({ campaign: cfg, runs: rows.length, node: process.version, wall_duration_s: (Date.now() - t0) / 1000, hash_runs_csv: sha(readFileSync(join(outDir, 'runs.csv'), 'utf8')) }, null, 2) + '\n');

  console.log('\nMean (standard deviation) over scenarios and seeds:');
  for (const s of summary) console.log(`  ${String(s.driver).padEnd(10)} ${String(s.onboard).padEnd(9)} passed ${s.passed}/${s.runs}  time ${s.time_s_mean} (${s.time_s_sd}) s  energy ${s.net_energy_kWh_mean} (${s.net_energy_kWh_sd}) kWh  W ${s.warnings_mean}  SBI ${s.service_brakings_mean}  EBI ${s.interventions_mean}  held ${s.signalling_constrained_s_mean} s`);
  console.log('\nDeterminism:');
  for (const d of det) console.log(`  ${d.ok ? 'ok  ' : 'FAIL'} ${d.check.padEnd(52)} ${d.hash_output}`);
  console.log(`\nResults in ${outDir} (${rows.length} runs, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  if (!det.every(d => d.ok)) process.exit(1);
}

if (process.argv[1] && /driver-campaign\.ts$/.test(process.argv[1])) main().catch(e => { console.error(String(e?.message ?? e)); process.exit(1); });
