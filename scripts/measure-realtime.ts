/**
 * Measures how far YuTreno can run in real time. It does not change the engine: it runs it and measures its timings.
 *
 *   npx tsx scripts/measure-realtime.ts                 # all tests, report in results/realtime/
 *   npx tsx scripts/measure-realtime.ts --fast          # short tests
 *
 * Tests:
 *  1. Cost of the 5 ms fixed step and real-time factor (simulated time / computing time), per dynamics model and
 *     onboard kind, on the Appennino line with the simple ATO.
 *  2. Cost of one cycle of the reference onboard (budget: 100 ms of simulated time).
 *  3. Round-trip latency of the exchanges with external programs: onboard via exec: (Node process), dynamics via
 *     exec: (Python), dynamics via TCP (listening Python), dynamics via WebSocket (bridge with JavaScript model).
 *  4. Garbage collector pauses during a run.
 *  5. Loop locked to the wall clock: one step every 5 ms of real time, as a real EVC would need; delay with respect
 *     to the clock and missed deadlines at 5 ms and 100 ms.
 * The results depend on the machine: the report gives processor, system and Node version.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { cpus, platform, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { PerformanceObserver } from 'node:perf_hooks';
import {
  DEFAULT_SCENARIO, FIXED_DT, LINE_PRESETS, Simulation, TRAIN_PRESETS, clone, exchangeDynamics, exchangeOnboard, runLockstep,
  type DynamicsProvider, type DynamicsRequest, type DynamicsResponse, type OnboardProvider, type OnboardRequest, type OnboardResponse, type TrainParams,
} from '../src/core';
import { loadJsController, openChannel } from '../src/server/headless';
import { startBridge } from '../src/server/bridge';

const now = () => Number(process.hrtime.bigint()) / 1e6;  // ms
const fast = process.argv.includes('--fast') || process.argv.includes('--rapide');

/** Percentiles and maximum of a series of durations (ms) */
function stats(xs: number[]) {
  if (!xs.length) return { n: 0, medium: 0, p50: 0, p99: 0, p999: 0, max: 0 };
  const s = [...xs].sort((a, b) => a - b), q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return { n: s.length, medium: s.reduce((a, b) => a + b, 0) / s.length, p50: q(0.5), p99: q(0.99), p999: q(0.999), max: s[s.length - 1] };
}
const fmt = (x: number) => (x < 0.01 ? x.toFixed(4) : x < 1 ? x.toFixed(3) : x.toFixed(2));

function sim(model: TrainParams['model'], onboard: 'internal' | 'reference' | 'external', external = false) {
  const train = clone(TRAIN_PRESETS.regional);
  train.model = external ? 'external' : model;
  return new Simulation(clone(LINE_PRESETS.appennino), train, { ...DEFAULT_SCENARIO, onboard: onboard });
}

/** Runs in lockstep with the simple ATO, timing every step, every onboard cycle and every external exchange */
async function timedRun(s: Simulation, opt: { dynamics?: DynamicsProvider; onboard?: OnboardProvider; maxTime?: number }) {
  const ctl = loadJsController('examples/ato.js');
  const step: number[] = [], ext: number[] = [], obCycle: number[] = [];
  let startup: number | null = null;  // the first exchange includes the start of the external program: kept apart
  // the reference onboard runs inside step(): it is timed by wrapping its step method
  const ref = s.ob?.ref;
  if (ref) { const orig = ref.step.bind(ref); ref.step = r => { const t = now(); const o = orig(r); obCycle.push(now() - t); return o; }; }
  const wrapD = opt.dynamics && (async (r: DynamicsRequest) => { const t = now(); const o = await opt.dynamics!(r); if (startup == null) startup = now() - t; else ext.push(now() - t); return o; });
  const wrapO = opt.onboard && (async (r: OnboardRequest) => { const t = now(); const o = await opt.onboard!(r); if (startup == null) startup = now() - t; else ext.push(now() - t); return o; });
  const maxTime = opt.maxTime ?? 7200;
  let nextT = 0;
  const t0 = now();
  while (!s.S.finished && s.S.t < maxTime) {
    if (s.S.t + 1e-9 >= nextT) { s.applyCommand(ctl(s.observe(0.2)) as never); nextT = s.S.t + 0.2 - 1e-9; }
    if (s.onboardDue()) await exchangeOnboard(s, wrapO as OnboardProvider);
    if (s.dynamicsDue()) await exchangeDynamics(s, wrapD as DynamicsProvider);
    const a = now(); s.step(FIXED_DT); s.sample(); step.push(now() - a);
  }
  const wall = now() - t0;
  return { sim_s: s.S.t, wall_ms: wall, realtime_factor: s.S.t * 1000 / wall, step_ms: stats(step), onboard_cycle_ms: stats(obCycle), external_exchange_ms: stats(ext), first_exchange_ms: startup };
}

function waitPort(child: ChildProcess, pattern: RegExp, ms = 8000): Promise<void> {
  return new Promise((res, rej) => {
    const to = setTimeout(() => rej(new Error('the process did not start in time')), ms);
    const on = (d: Buffer) => { if (pattern.test(d.toString())) { clearTimeout(to); res(); } };
    child.stdout?.on('data', on); child.stderr?.on('data', on);
  });
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Loop locked to the clock: at the deadline of each step it runs the due steps and measures the delay */
async function wallClockRun(duration_s: number) {
  const s = sim('multimass', 'reference');
  const ctl = loadJsController('examples/ato.js');
  const lateness: number[] = [];
  let miss5 = 0, miss100 = 0, nextT = 0, steps = 0;
  const t0 = now();
  while (s.S.t < duration_s && !s.S.finished) {
    const due = t0 + (s.S.t + FIXED_DT) * 1000;
    const wait = due - now();
    if (wait > 1.5) await sleep(Math.floor(wait - 1));
    while (now() < due) { /* busy wait for the last millisecond */ }
    const late = now() - due;
    lateness.push(late);
    if (late > 5) miss5++;
    if (late > 100) miss100++;
    if (s.S.t + 1e-9 >= nextT) { s.applyCommand(ctl(s.observe(0.2)) as never); nextT = s.S.t + 0.2 - 1e-9; }
    s.step(FIXED_DT); s.sample(); steps++;
  }
  return { duration_s: duration_s, steps: steps, delay_ms: stats(lateness), steps_late_over_5ms: miss5, steps_late_over_100ms: miss100 };
}

async function main() {
  const out: Record<string, unknown> = {};
  const gc: number[] = [];
  const obs = new PerformanceObserver(list => { for (const e of list.getEntries()) gc.push(e.duration); });
  obs.observe({ entryTypes: ['gc'] });
  const maxTime = fast ? 200 : 7200;

  console.log('1-2. Step and onboard cycle, without external programs');
  for (const [name, m, b] of [['point, internal supervision', 'point', 'internal'], ['multimass, internal supervision', 'multimass', 'internal'], ['multimass, reference onboard', 'multimass', 'reference']] as const) {
    gc.length = 0;
    const r = await timedRun(sim(m, b), { maxTime });
    await sleep(50);  // the observer delivers the GC pauses asynchronously
    out[name] = { ...r, gc_ms: stats(gc) };
    console.log(`  ${name.padEnd(34)} ${r.sim_s.toFixed(0)} s simulated in ${(r.wall_ms / 1000).toFixed(1)} s: ${r.realtime_factor.toFixed(0)}× real time; step p50 ${fmt(r.step_ms.p50)} ms, p99.9 ${fmt(r.step_ms.p999)} ms, max ${fmt(r.step_ms.max)} ms` +
      (r.onboard_cycle_ms.n ? `; onboard cycle p50 ${fmt(r.onboard_cycle_ms.p50)} ms, max ${fmt(r.onboard_cycle_ms.max)} ms` : '') + `; GC ${gc.length} pauses, max ${fmt(stats(gc).max)} ms`);
  }

  console.log('3. Exchanges with external programs (round trip)');
  const extMax = fast ? 120 : 600;
  {
    const ch = await openChannel<OnboardRequest, OnboardResponse>('exec:npx --no-install tsx examples/onboard/onboard_stdio.ts', 'the onboard');
    try { const r = await timedRun(sim('multimass', 'external'), { onboard: ch.call, maxTime: extMax }); out['onboard via exec: (Node)'] = r; report('onboard via exec: (Node), every 100 ms', r); } finally { ch.close(); }
  }
  {
    const ch = await openChannel<DynamicsRequest, DynamicsResponse>('exec:python3 examples/python/yutreno_dynamics.py --stdio', 'la dinamica');
    try { const r = await timedRun(sim('point', 'internal', true), { dynamics: ch.call, maxTime: extMax }); out['dynamics via exec: (Python)'] = r; report('dynamics via exec: (Python), every 50 ms', r); } finally { ch.close(); }
  }
  {
    const py = spawn('python3', ['-u', 'examples/python/yutreno_dynamics.py'], { stdio: ['ignore', 'pipe', 'pipe'] });
    try {
      await waitPort(py, /5555|listening/i);
      const ch = await openChannel<DynamicsRequest, DynamicsResponse>('tcp://localhost:5555', 'la dinamica');
      try { const r = await timedRun(sim('point', 'internal', true), { dynamics: ch.call, maxTime: extMax }); out['dynamics via TCP (Python)'] = r; report('dynamics via TCP (Python), every 50 ms', r); } finally { ch.close(); }
    } catch (e) { console.log('  dynamics via TCP: not measured (' + (e as Error).message + ')'); } finally { py.kill(); }
  }
  {
    const srv = startBridge({ port: 8799, model: 'examples/dynamics_point.js' });
    try {
      await sleep(300);
      const ch = await openChannel<DynamicsRequest, DynamicsResponse>('ws://localhost:8799', 'la dinamica');
      try { const r = await timedRun(sim('point', 'internal', true), { dynamics: ch.call, maxTime: extMax }); out['dynamics via WebSocket (bridge, JavaScript)'] = r; report('dynamics via WebSocket (bridge, JavaScript), every 50 ms', r); } finally { ch.close(); }
    } finally { srv.close(); }
  }

  console.log('5. Loop locked to the clock (one step every 5 real ms, reference onboard)');
  const wc = await wallClockRun(fast ? 10 : 60);
  out['loop locked to the clock'] = wc;
  console.log(`  ${wc.duration_s} s: delay p50 ${fmt(wc.delay_ms.p50)} ms, p99 ${fmt(wc.delay_ms.p99)} ms, p99.9 ${fmt(wc.delay_ms.p999)} ms, max ${fmt(wc.delay_ms.max)} ms; steps more than 5 ms late: ${wc.steps_late_over_5ms} of ${wc.steps}`);

  obs.disconnect();
  const machine = { processor: cpus()[0]?.model, cores: cpus().length, memory_GB: +(totalmem() / 2 ** 30).toFixed(1), system: `${platform()} ${release()}`, node: process.version, date: new Date().toISOString(), fast: fast };
  const dir = join('results', 'realtime');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'measures.json'), JSON.stringify({ machine: machine, measures: out }, null, 2) + '\n');
  console.log(`\nMachine: ${machine.processor}, ${machine.cores} cores, ${machine.system}, Node ${machine.node}. Results in ${join(dir, 'measures.json')}`);
  process.exit(0);
}

function report(name: string, r: Awaited<ReturnType<typeof timedRun>>) {
  const e = r.external_exchange_ms;
  console.log(`  ${name.padEnd(52)} ${e.n} exchanges: p50 ${fmt(e.p50)} ms, p99 ${fmt(e.p99)} ms, p99.9 ${fmt(e.p999)} ms, max ${fmt(e.max)} ms (first exchange, with the start: ${fmt(r.first_exchange_ms ?? 0)} ms); run ${r.realtime_factor.toFixed(1)}× real time`);
}

main().catch(e => { console.error(String(e && e.message || e)); process.exit(1); });
