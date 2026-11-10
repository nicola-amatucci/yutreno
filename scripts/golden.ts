/**
 * Golden master of the runs (phase 8, R0): the fingerprints of every run the checks rely on, so that a change meant
 * to leave the behaviour alone (a refactoring) proves in minutes that no byte of any run changed, and says which run
 * and which part of it did.
 *
 * The runs:
 *   - every scenario of scenarios/ and every configuration of examples/scenario-config/, driven by examples/ato.js,
 *     as written and in the variants ETCS, automatic block, ETCS with the reference onboard, the same with the
 *     interlocking trackside, and with the reference regulator (a variant equal to another run, or not accepted by
 *     the engine, is recorded as such: an error is a behaviour too);
 *   - the reference campaign (scripts/campaign.ts) and the service campaign (scripts/service-campaign.ts), whose
 *     runs carry their own output fingerprint.
 * For each run of the first kind it keeps one fingerprint per part, so a difference points at it: the samples of
 * every train (Simulation.csv), the event logs, the realised timetable, the passengers, the summaries and verdict,
 * the commands of the dispatcher and a control room snapshot every 60 s.
 *
 *   npx tsx scripts/golden.ts            compares with golden/fingerprints.json (exit 1 on any difference)
 *   npx tsx scripts/golden.ts --update   writes golden/fingerprints.json
 *   options: --jobs <n> (default: the number of processors), --only <text> (runs whose id contains it, no campaigns),
 *            --quick (the scenarios and configurations as written, no variants and no campaigns: a few minutes)
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXED_DT, Simulation, autoDriver, resolveScenario, runLockstep, type ScenarioDef } from '../src/core';
import { loadJsController, loadScenarios } from '../src/server/headless';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'golden', 'fingerprints.json');
const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16);

/** Variants of a scenario: overrides of its conditions */
const VARIANTS: Record<string, Partial<ScenarioDef>> = {
  as_written: {},
  etcs: { signalling: 'ETCS' },
  bacc: { signalling: 'BACC' },
  etcs_reference: { signalling: 'ETCS', onboard: 'reference' },
  etcs_interlocking: { signalling: 'ETCS', onboard: 'reference', trackside: 'interlocking' },
  regulator: { regulator: 'reference' },
};

interface Case { id: string; file: string; variant: string }
type Parts = Record<string, string>;

function scenarioFiles(dir: string): string[] {
  return readdirSync(dir).sort().flatMap(f => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? scenarioFiles(p) : f.endsWith('.json') ? [p] : [];
  });
}

function cases(): Case[] {
  const files = [...scenarioFiles(join(ROOT, 'scenarios')), ...scenarioFiles(join(ROOT, 'examples', 'scenario-config'))];
  return files.flatMap(file => Object.keys(VARIANTS).map(variant => ({ id: `${relative(ROOT, file).replace(/\\/g, '/')}#${variant}`, file, variant })));
}

/** One run: the fingerprints of its parts */
async function runCase(c: Case): Promise<Parts> {
  const [{ def: base }] = loadScenarios(c.file);
  const def: ScenarioDef = { ...JSON.parse(JSON.stringify(base)), ...VARIANTS[c.variant] };
  let sim: Simulation;
  try {
    const r = resolveScenario(def);
    sim = new Simulation(r.line, r.train, r.scen, def);
  } catch (e) { return { error: sha(String((e as Error).message)), error_text: String((e as Error).message).slice(0, 160) }; }
  // the variant is the same run as the scenario as written: recorded once
  const snaps: string[] = [];
  const step = sim.step.bind(sim), every = Math.round(60 / FIXED_DT);
  let k = 0;
  sim.step = (dt?: number) => { step(dt); if (++k % every === 0) snaps.push(JSON.stringify(sim.controlRoom(50))); };
  const mems = new Map<string, object>();
  try {
    await runLockstep(sim, loadJsController(join(ROOT, 'examples', 'ato.js')), {
      period: 0.2, source: 'ato',
      agents: obs => { const id = String((obs as { train_id?: string }).train_id); if (!mems.has(id)) mems.set(id, {}); return autoDriver(obs, mems.get(id)!); },
    });
  } catch (e) { return { error: sha(String((e as Error).message)), error_text: String((e as Error).message).slice(0, 160), at_s: sim.time.toFixed(3) }; }
  const trains = sim.trains;
  return {
    conditions: sha(JSON.stringify(sim.scen)),
    samples: sha(trains.map(t => t.id + '\n' + sim.csv(t)).join('\n')),
    events: sha(JSON.stringify(trains.map(t => t.S.events))),
    timetable: sha(JSON.stringify(sim.timetable())),
    passengers: sha(JSON.stringify(sim.passengers())),
    summaries: sha(JSON.stringify(trains.map(t => [sim.summary(t), sim.verdict(t)]))),
    dispatched: sha(JSON.stringify(sim.dispatched)),
    control_room: sha(snaps.join('\n')),
    end_s: sim.time.toFixed(3),
  };
}

/** Runs a child process and returns its standard output */
function child(args: string[]): Promise<string> {
  return new Promise((ok, ko) => {
    const p = spawn(process.execPath, [...process.execArgv, ...args], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { err += d; });
    p.on('close', code => code === 0 ? ok(out) : ko(new Error(`${args.slice(0, 2).join(' ')} exit ${code}: ${err.slice(-400)}`)));
  });
}

/** The rows of a campaign's runs.csv: an id from the columns before the measures, and the output fingerprint */
function campaignRows(csv: string, prefix: string, keys: string[]): Record<string, Parts> {
  const [head, ...rows] = csv.trim().split('\n').map(l => l.split(','));
  const at = (k: string) => head.indexOf(k), h = at('hash_output');
  const out: Record<string, Parts> = {};
  for (const r of rows) {
    const id = prefix + keys.map(k => r[at(k)]).join('|');
    if (out[id]) throw new Error(`two rows of ${prefix} with the id ${id}`);
    out[id] = { output: r[h] };
  }
  return out;
}

async function campaign(script: string, keys: string[], prefix: string): Promise<Record<string, Parts>> {
  const dir = mkdtempSync(join(tmpdir(), 'yutreno-golden-'));
  try {
    await child([join(ROOT, 'scripts', script), '--output', dir]);
    return campaignRows(readFileSync(join(dir, 'runs.csv'), 'utf8'), prefix, keys);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

async function pool<T>(tasks: (() => Promise<T>)[], jobs: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(jobs, tasks.length) }, async () => { while (next < tasks.length) { const i = next++; out[i] = await tasks[i](); } }));
  return out;
}

async function main() {
  const argv = process.argv.slice(2), opt = (k: string) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : undefined; };
  if (opt('--run')) { process.stdout.write(JSON.stringify(await runCase(JSON.parse(opt('--run')!))) + '\n'); return; }
  const update = argv.includes('--update'), only = opt('--only'), quick = argv.includes('--quick'), jobs = Number(opt('--jobs') ?? availableParallelism());
  if (update && (only || quick)) throw new Error('--update writes every run: not with --only or --quick');
  const partial = !!only || quick;
  const t0 = Date.now(), list = cases().filter(c => (!only || c.id.includes(only)) && (!quick || c.variant === 'as_written'));
  const self = fileURLToPath(import.meta.url);
  let done = 0;
  const tick = () => { if (process.stdout.isTTY) process.stdout.write(`\r${++done} of ${list.length + (partial ? 0 : 2)}`); };
  const tasks: (() => Promise<Record<string, Parts>>)[] = list.map(c => async () => {
    const r = JSON.parse((await child([self, '--run', JSON.stringify(c)])).trim().split('\n').pop()!) as Parts;
    tick();
    return { [c.id]: r };
  });
  // the campaigns first, they are the longest
  if (!partial) tasks.unshift(
    async () => { const r = await campaign('campaign.ts', ['case_id', 'faults', 'onboard', 'ato', 'parameters', 'braking_model'], 'campaign/reference#'); tick(); return r; },
    async () => { const r = await campaign('service-campaign.ts', ['line', 'trains', 'headway_s', 'directions', 'signalling', 'demand_per_station_h'], 'campaign/services#'); tick(); return r; },
  );
  const now: Record<string, Parts> = Object.assign({}, ...(await pool(tasks, jobs)));
  // a variant that gives the same run as the scenario as written is marked as such, not repeated
  for (const [id, p] of Object.entries(now)) {
    const [file, v] = id.split('#');
    const w = now[file + '#as_written'];
    if (v !== 'as_written' && w && !p.error && JSON.stringify(p) === JSON.stringify(w)) now[id] = { same_as: 'as_written' };
  }
  if (process.stdout.isTTY) process.stdout.write('\n');
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  const errors = Object.values(now).filter(p => p.error).length;
  if (update) {
    mkdirSync(dirname(FILE), { recursive: true });
    const sorted = Object.fromEntries(Object.keys(now).sort().map(k => [k, now[k]]));
    writeFileSync(FILE, JSON.stringify(sorted, null, 1) + '\n');
    console.log(`golden: ${Object.keys(now).length} runs written to ${relative(ROOT, FILE)} (${errors} refused by the engine), ${secs} s`);
    return;
  }
  if (!existsSync(FILE)) throw new Error(`${relative(ROOT, FILE)} missing: run with --update first`);
  const old = JSON.parse(readFileSync(FILE, 'utf8')) as Record<string, Parts>;
  const diffs: string[] = [];
  for (const id of Object.keys(now)) {
    let a = old[id];
    const b = now[id];
    if (!a) { diffs.push(`${id}: new run`); continue; }
    // a variant recorded as the same run as the scenario as written, run without it (--only): compared with that run
    if (a.same_as && !b.same_as && !now[id.split('#')[0] + '#' + a.same_as]) a = old[id.split('#')[0] + '#' + a.same_as];
    const parts = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(k => a[k] !== b[k]);
    if (parts.length) diffs.push(`${id}: ${parts.map(k => `${k} ${a[k] ?? '-'} → ${b[k] ?? '-'}`).join(', ')}`);
  }
  if (!partial) for (const id of Object.keys(old)) if (!now[id]) diffs.push(`${id}: run missing`);
  if (diffs.length) { console.log(diffs.join('\n')); console.log(`golden: ${diffs.length} of ${Object.keys(now).length} runs differ, ${secs} s`); process.exit(1); }
  console.log(`golden: ${Object.keys(now).length} runs identical to ${relative(ROOT, FILE)}, ${secs} s`);
}

main().catch(e => { console.error(String(e?.stack ?? e)); process.exit(1); });
