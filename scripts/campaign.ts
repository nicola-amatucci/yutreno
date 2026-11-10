/**
 * Reproducible measurement campaign: matrix onboard × ATO × scenario, with and without hidden faults.
 *
 *   npm run campaign                                 # configuration campaigns/reference.json, output results/campaign-reference
 *   npm run campaign -- --output folder --details    # also saves the CSV and events of every run
 *   npm run campaign -- --config other.json
 *
 * Outputs, all deterministic except metadata.json:
 *   runs.csv         one row per run: metrics, interventions by type, parameters and hash of the run output
 *   summary.csv      totals by faults × onboard × ATO
 *   determinism.csv  repeatability checks: the same run twice, in a new process and with the external onboard via exec:
 *   parameters.json  national values, train data and line gradients used, with their hashes
 *   metadata.json    code version, Node version and wall-clock duration (not deterministic, kept out of the CSVs)
 *
 * The hash of a run is the SHA-256 of its CSV (Simulation.csv) followed by the event log in JSON: two runs with the
 * same hash produced the same data, sample by sample.
 */
import { createHash } from 'node:crypto';
import { execSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import {
  DEFAULT_NATIONAL, DEFAULT_SCENARIO, Simulation, clone, resolveScenario, runLockstep, toEnglish,
  type OnboardNationalValues, type OnboardProvider, type OnboardRequest, type OnboardResponse, type Scenario, type ScenarioDef,
} from '../src/core';
import { loadJsController, loadScenarios, openChannel } from '../src/server/headless';

interface ParamSet { name: string; description?: string; braking_model: 'gamma' | 'lambda'; national_values: Partial<OnboardNationalValues> }
interface Config {
  name: string; description?: string; scenarios: string[]; onboards: string[]; ato: Record<string, string>; faults: boolean[];
  period_s: number; parameters: ParamSet[]; determinism: { scenario: string; ato: string; external_onboard: string };
}
/** A run of the matrix: `onboard` is internal, reference or the address of an external onboard (exec:, tcp://, ws://) */
interface Spec { scenario: string; faults: boolean; onboard: string; ato: string; atoFile: string; period: number; param: ParamSet }

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const f = (x: number | null | undefined, d: number) => (x == null || !isFinite(x) ? '' : x.toFixed(d));

function args(argv: string[]): Record<string, string> {
  const a: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) if (argv[i].startsWith('--')) a[argv[i].slice(2)] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
  return a;
}

/** Gradient statistics of a compiled line (‰) */
function gradients(sim: Simulation) {
  let up = 0, down = 0, sum = 0, len = 0;
  for (const p of sim.L.prof) { up = Math.max(up, p.i); down = Math.min(down, p.i); sum += Math.abs(p.i) * (p.b - p.a); len += p.b - p.a; }
  return { ascent_max_permille: +up.toFixed(2), descent_max_permille: +down.toFixed(2), mean_abs_gradient_permille: +(sum / Math.max(1, len)).toFixed(2) };
}

/** Runs one case and returns the metrics, the parameters and the hash of the output */
export async function runOne(spec: Spec) {
  if (spec.param.braking_model !== 'gamma') throw new Error('the reference onboard supports only the gamma braking model (fixed decelerations)');
  const loaded = loadScenarios(spec.scenario)[0].def;
  const def: ScenarioDef = spec.faults ? loaded : { ...loaded, events: [] };
  const r = resolveScenario(def);
  const external = /^(exec:|tcp:\/\/|wss?:\/\/)/.test(spec.onboard);
  const kind = (external ? 'external' : spec.onboard) as 'internal' | 'reference' | 'external';
  const scen: Scenario = { ...DEFAULT_SCENARIO, ...r.scen, onboard: kind, national_values: spec.param.national_values };
  const sim = new Simulation(clone(r.line), r.train, scen, def);
  let onboard: OnboardProvider | undefined, close = () => {};
  if (external) { const ch = await openChannel<OnboardRequest, OnboardResponse>(spec.onboard, 'the ETCS onboard'); onboard = ch.call; close = ch.close; }
  try {
    await runLockstep(sim, loadJsController(spec.atoFile), { period: spec.period, source: basename(spec.atoFile), onboard, api: 3 });
  } finally { close(); }
  const S = sim.S, res = sim.result(), v = sim.verdict();
  const ok = S.stops.filter(s => s.err != null).map(s => Math.abs(s.err as number));
  const last = S.stops[S.stops.length - 1];
  const nv: OnboardNationalValues | null = kind === 'internal' ? null : { ...DEFAULT_NATIONAL, ...spec.param.national_values };
  const TR = sim.TR;
  const train = { name: TR.name, dynamics_model: TR.model ?? 'multimass', mass_kg: TR.m, length_m: TR.L, A_brake_emergency: TR.bEm, A_brake_service: TR.bSvc, rot: TR.rot, vmax_ms: TR.vmax };
  const pend = gradients(sim);
  const out = sim.csv() + '\n' + JSON.stringify(S.events);
  return {
    case_id: basename(spec.scenario, '.json'), line: sim.L.def.name, faults: spec.faults ? 'yes' : 'no', onboard: kind === 'external' ? 'external' : kind, ato: spec.ato,
    parameters: spec.param.name, braking_model: spec.param.braking_model,
    outcome: v.outcome, finished: res.finished ? 1 : 0,
    time_s: f(res.t_s, 2), arrival_delay_s: f(res.arrival_delay_s, 1),
    traction_energy_kWh: f(S.eT, 3), regenerated_energy_kWh: f(S.eR, 3), net_energy_kWh: f(S.eT - S.eR, 3),
    valid_stops: ok.length, missed_stops: S.stops.length - ok.length,
    mean_stop_error_m: f(ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : null, 3),
    max_stop_error_m: f(ok.length ? Math.max(...ok) : null, 3),
    final_stop_error_m: f(last && last.err != null ? last.err : null, 3),
    warnings_W: S.warns, sbi_brakings: S.sbiCount, ebi_interventions: S.interventions, radio_brakings: S.radioBrakes,
    emergencies: S.events.filter(e => e.kind === 'EMG').length, eoa_overruns: S.spad,
    ato_guards: S.events.filter(e => e.kind === 'CTL' && e.text.includes('intervention limit')).length,
    max_over_limit_kmh: f(Math.max(0, S.maxOverLine), 2), max_jerk_ms3: f(S.maxJerk, 3),
    A_brake_emergency_ms2: TR.bEm, A_brake_service_ms2: TR.bSvc,
    ascent_max_permille: pend.ascent_max_permille, descent_max_permille: pend.descent_max_permille, mean_abs_gradient_permille: pend.mean_abs_gradient_permille,
    hash_national_values: nv ? sha(JSON.stringify(nv)).slice(0, 16) : '',
    hash_inputs: sha(JSON.stringify({ line: r.line, train: r.train, scen, def, ato: sha(readFileSync(spec.atoFile, 'utf8')), period: spec.period })).slice(0, 16),
    hash_output: sha(out),
    _details: { csv: sim.csv(), events: S.events, national_values: nv, train: train, gradients: pend },
  };
}

type Row = Awaited<ReturnType<typeof runOne>>;

function toCsv(rows: Record<string, unknown>[]): string {
  if (!rows.length) return '';
  const cols = Object.keys(rows[0]).filter(k => !k.startsWith('_'));
  const cell = (x: unknown) => { const s = String(x ?? ''); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  return cols.join(',') + '\n' + rows.map(r => cols.map(c => cell(r[c])).join(',')).join('\n') + '\n';
}

/** Repeats a run in a new process, to rule out state shared inside the process */
function runInFreshProcess(spec: Spec): string {
  const r = spawnSync(process.execPath, [...process.execArgv, process.argv[1], '--run', JSON.stringify(spec)], { encoding: 'utf8', maxBuffer: 1 << 26 });
  if (r.status !== 0) throw new Error('run in a new process failed: ' + r.stderr);
  const line = r.stdout.trim().split('\n').pop() as string;
  return JSON.parse(line).hash_output;
}

async function main() {
  const a = args(process.argv.slice(2));
  if (a.run) { const row = await runOne(JSON.parse(a.run) as Spec); process.stdout.write(JSON.stringify({ hash_output: row.hash_output }) + '\n'); return; }
  const cfgFile = a.config || 'campaigns/reference.json';
  const cfg = toEnglish<Config>(JSON.parse(readFileSync(cfgFile, 'utf8')));
  const outDir = a.output || a.uscita || join('results', 'campaign-' + cfg.name);
  mkdirSync(outDir, { recursive: true });
  const t0 = Date.now();

  const specs: Spec[] = [];
  for (const param of cfg.parameters) for (const scenario of cfg.scenarios) for (const faults of cfg.faults)
    for (const onboard of cfg.onboards) for (const [ato, atoFile] of Object.entries(cfg.ato))
      specs.push({ scenario, faults: faults, onboard: onboard, ato, atoFile, period: cfg.period_s, param });

  const rows: Row[] = [];
  for (const [i, spec] of specs.entries()) {
    const row = await runOne(spec);
    rows.push(row);
    process.stdout.write(`[${String(i + 1).padStart(3)}/${specs.length}] ${row.case_id.padEnd(28)} faults ${row.faults.padEnd(3)} ${row.onboard.padEnd(11)} ${row.ato.padEnd(8)} ` +
      `${row.outcome.padEnd(7)} ${row.net_energy_kWh.padStart(8)} kWh  W ${row.warnings_W} SBI ${row.sbi_brakings} EBI ${row.ebi_interventions}  ${row.hash_output.slice(0, 12)}\n`);
    if (a.details || a.dettagli) {
      const base = join(outDir, 'runs', `${row.case_id}_${row.faults === 'yes' ? 'faults' : 'nominal'}_${row.onboard}_${row.ato}_${row.parameters}`);
      mkdirSync(join(outDir, 'runs'), { recursive: true });
      writeFileSync(base + '.csv', row._details.csv);
      writeFileSync(base + '_events.json', JSON.stringify(row._details.events, null, 1));
    }
  }
  writeFileSync(join(outDir, 'runs.csv'), toCsv(rows));

  // summary by faults × onboard × ATO × parameters
  const groups = new Map<string, Row[]>();
  for (const r of rows) { const k = [r.parameters, r.faults, r.onboard, r.ato].join('|'); if (!groups.has(k)) groups.set(k, []); (groups.get(k) as Row[]).push(r); }
  const synth = [...groups.entries()].map(([k, g]) => {
    const [parameters, faults, onboard, ato] = k.split('|'), sum = (c: keyof Row) => g.reduce((x, r) => x + Number(r[c] || 0), 0);
    return {
      parameters, faults, onboard, ato, runs: g.length, passed: g.filter(r => r.outcome === 'passed').length,
      net_energy_kWh: sum('net_energy_kWh').toFixed(3), time_s: sum('time_s').toFixed(2),
      warnings_W: sum('warnings_W'), sbi_brakings: sum('sbi_brakings'), ebi_interventions: sum('ebi_interventions'), eoa_overruns: sum('eoa_overruns'),
      missed_stops: sum('missed_stops'), ato_guards: sum('ato_guards'),
    };
  });
  writeFileSync(join(outDir, 'summary.csv'), toCsv(synth));

  // determinism checks
  const dcfg = cfg.determinism, p0 = cfg.parameters[0];
  const base: Spec = { scenario: dcfg.scenario, faults: true, onboard: 'reference', ato: dcfg.ato, atoFile: cfg.ato[dcfg.ato], period: cfg.period_s, param: p0 };
  const ref = rows.find(r => r.case_id === basename(dcfg.scenario, '.json') && r.faults === 'yes' && r.onboard === 'reference' && r.ato === dcfg.ato && r.parameters === p0.name)?.hash_output
    ?? (await runOne(base)).hash_output;
  const det: { check: string; hash_output: string; same: number }[] = [];
  const add = (check: string, h: string) => det.push({ check, hash_output: h, same: h === ref ? 1 : 0 });
  add('reference, run of the matrix', ref);
  add('reference, repeated in the same process', (await runOne(base)).hash_output);
  add('reference, repeated in a new process', runInFreshProcess(base));
  const ext1 = (await runOne({ ...base, onboard: dcfg.external_onboard })).hash_output;
  const ext2 = (await runOne({ ...base, onboard: dcfg.external_onboard })).hash_output;
  det.push({ check: 'external onboard via exec:, first run', hash_output: ext1, same: ext1 === ref ? 1 : 0 });
  det.push({ check: 'external onboard via exec:, second run', hash_output: ext2, same: ext2 === ext1 ? 1 : 0 });
  writeFileSync(join(outDir, 'determinism.csv'), toCsv(det));

  // parameters used, one entry per distinct combination
  const par = new Map<string, unknown>();
  for (const r of rows) par.set(r.case_id + '|' + r.onboard + '|' + r.parameters, { case_id: r.case_id, line: r.line, onboard: r.onboard, parameters: r.parameters, braking_model: r.braking_model, ...r._details, csv: undefined, events: undefined, hash_national_values: r.hash_national_values });
  writeFileSync(join(outDir, 'parameters.json'), JSON.stringify({ campaign: cfg, combinations: [...par.values()] }, null, 2) + '\n');

  let commit = '', dirty = false;
  try { commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim(); dirty = execSync('git status --porcelain', { encoding: 'utf8' }).trim() !== ''; } catch { /* outside git */ }
  writeFileSync(join(outDir, 'metadata.json'), JSON.stringify({ commit, uncommitted_changes: dirty, node: process.version, runs: rows.length, wall_duration_s: (Date.now() - t0) / 1000, hash_runs_csv: sha(readFileSync(join(outDir, 'runs.csv'), 'utf8')) }, null, 2) + '\n');

  console.log('\nSummary (total net energy, interventions by type):');
  for (const s of synth) console.log(`  ${s.parameters} faults ${s.faults.padEnd(3)} ${s.onboard.padEnd(11)} ${s.ato.padEnd(8)} ${s.net_energy_kWh.padStart(10)} kWh  W ${s.warnings_W}  SBI ${s.sbi_brakings}  EBI ${s.ebi_interventions}  passed ${s.passed}/${s.runs}`);
  console.log('\nDeterminism:');
  for (const d of det) console.log(`  ${d.same ? 'same     ' : 'DIFFERENT'} ${d.check.padEnd(46)} ${d.hash_output.slice(0, 16)}`);
  console.log(`\nResults in ${outDir} (${rows.length} runs, ${((Date.now() - t0) / 1000).toFixed(0)} s)`);
  const must = det.slice(0, 3).every(d => d.same) && det[4].same === 1;
  if (!must) { console.error('Determinism check failed'); process.exit(1); }
}

const isMain = process.argv[1] && /campaign\.ts$/.test(process.argv[1]);
if (isMain) main().catch(e => { console.error(String(e && e.message || e)); process.exit(1); });
