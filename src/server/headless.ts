/**
 * Headless runs, faster than real time, with a JavaScript or external controller.
 *
 *   npm run headless -- --line valle-lauro --signalling ETCS --controller examples/ato.js
 *   npm run headless -- --line appennino --controller ws://localhost:8765 --output runs
 *   npm run headless -- --scenario scenarios --controller examples/ato.js     (all the scenarios of a folder)
 *
 * A JavaScript controller is a file defining `function control(obs, mem)`, the same format as the controller in the
 * browser. A ws:// address connects an external controller, for example examples/example_controller.py, with the
 * same protocol as the page.
 *
 * With --dynamics the train dynamics come from an external model (co-simulation), for example MATLAB/Simulink
 * listening on TCP: see docs/EXTERNAL_DYNAMICS.md.
 *
 *   npm run headless -- --dynamics examples/dynamics_point.js
 *   npm run headless -- --dynamics tcp://localhost:5555 --coupling 0.05
 *   npm run headless -- --dynamics "exec:octave-cli -q examples/octave/yutreno_dynamics.m"
 *
 * Programs written for YuTreno 0.x keep working: the Italian option names are accepted as aliases, a JavaScript
 * controller, model or onboard defining the Italian function (`controllo`, `dinamica`, `bordo`) receives the Italian
 * formats, and `--protocol 1` sends the Italian requests to external programs (see src/core/legacy.ts).
 */
import { spawn } from 'node:child_process';
import { connect as tcpConnect } from 'node:net';
import type { Readable, Writable } from 'node:stream';
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { createContext, runInContext } from 'node:vm';
import {
  DEFAULT_SCENARIO, LINE_PRESETS, TRAIN_PRESETS, Simulation, VALUES_IT_EN, clone, fitPlan, legacyProvider, resolveScenario, runLockstep, toEnglish, toLegacy, validateScenario,
  type Command, type Controller, type TracksideProvider, type RegulatorProvider, type RegulatorRequest, type RegulatorResponse, type DynamicsProvider, type DynamicsRequest, type DynamicsResponse, type OnboardProvider, type OnboardRequest, type OnboardResponse, type LineDef, type Observation, type Scenario, type ScenarioDef, type TrainParams,
} from '../core';
import type { TracksideRequest, TracksideResponse } from '../trackside';
import { makeScenario, resolvePaths } from './make-scenario';

interface Args { [k: string]: string }

/** Italian option names of version 0.x, still accepted */
const OPTION_ALIASES: Record<string, string> = {
  linea: 'line', treno: 'train', segnalamento: 'signalling', meteo: 'weather', aderenza: 'adhesion', controllore: 'controller',
  periodo: 'period', ripetizioni: 'repetitions', uscita: 'output', dinamica: 'dynamics', accoppiamento: 'coupling', bordo: 'onboard',
  'ciclo-bordo': 'onboard-cycle', terra: 'trackside', protocollo: 'protocol', aiuto: 'help',
};
/** Italian option values of version 0.x, still accepted */
const VALUE_ALIASES: Record<string, Record<string, string>> = {
  weather: VALUES_IT_EN.weather, adhesion: VALUES_IT_EN.adhesion, onboard: VALUES_IT_EN.onboard, trackside: VALUES_IT_EN.trackside,
};

export function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    let k = a.slice(2);
    const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : 'true';
    k = OPTION_ALIASES[k] ?? k;
    out[k] = VALUE_ALIASES[k]?.[v] ?? v;
  }
  return out;
}

const HELP = `Usage: npm run headless -- [options]
  --line <id|file.json>         ${Object.keys(LINE_PRESETS).join(', ')} or a line JSON file (default valle-lauro)
  --train <id|file.json>        ${Object.keys(TRAIN_PRESETS).join(', ')} or a JSON file (default regional)
  --signalling ETCS|BACC        default ETCS
  --weather clear|rain|fog      --adhesion auto|dry|wet|leaves
  --controller <file.js|ws://host:port>   default examples/ato.js
  --controller-params <json>    parameters of a JavaScript controller, given to it as the global PARAMS, for example
                                '{"profile":"cautious","seed":3}' for examples/driver_model.js (docs/DRIVER_MODEL.md)
  --agents <file.js|ws://host:port>   agent driving the service trains with driver "agent" (one instance of the
                                JavaScript file per train; over WebSocket one connection, observations with train_id)
  --period <s>                  control period (default 0.2)
  --repetitions <n>             number of runs (default 1)
  --scenario <file.json|folder> scenario of events and faults; with a folder runs all its scenarios
                                (line, train and conditions come from the scenario, unless given explicitly)
  --output <folder>             saves the CSV, events and JSON summary of every run
  --dynamics <file.js|tcp://host:port|ws://host:port|exec:command>
                                train dynamics from an external model (co-simulation); the train switches to the 'external' model.
                                With exec: the engine starts the command and talks to it on stdin/stdout, one JSON line per message
                                (for example "exec:octave-cli -q examples/octave/yutreno_dynamics.m" or "exec:python examples/python/yutreno_dynamics.py --stdio")
  --coupling <s>                coupling interval with the external model (default 0.05, a multiple of 0.005)
  --onboard <internal|reference|file.js|exec:command|tcp://host:port|ws://host:port>
                                ETCS only: onboard supervision; 'reference' is the EVC of the core with Subset-026 balises and messages,
                                the other values connect an external EVC with the same protocol
  --onboard-cycle <s>           onboard cycle (default 0.1)
  --api 1|2|3                   version of the controller observation (default 3; 1 and 2 are the Italian formats of 0.x)
  --trackside <simple|interlocking|exec:command|tcp://host:port|ws://host:port>
                                ETCS with a message-based onboard only: 'interlocking' is the trackside component (interlocking and
                                RBC) in process, the other values connect it as an external program with the same protocol
  --protocol 1|2                protocol version for external dynamics, onboard and trackside programs (default 2; 1 sends the
                                Italian requests of 0.x)
  --regulator <none|reference|exec:command|tcp://host:port|ws://host:port>
                                traffic regulator: 'reference' is the one of src/regulator in process, the other values connect an
                                external program with the regulator protocol (docs/REGULATOR.md)
  --regulator-cycle <s>         regulator cycle (default 5)
The Italian option names and values of version 0.x (--linea, --treno, --bordo riferimento, --terra acc…) are still accepted.
`;

/** Loads a scenario or all the scenarios of a folder, in alphabetical order; Italian scenarios of 0.x are translated */
export function loadScenarios(path: string): { file: string; def: ScenarioDef }[] {
  const files = statSync(path).isDirectory() ? readdirSync(path).filter(f => f.endsWith('.json')).sort().map(f => join(path, f)) : [path];
  return files.map(file => {
    const raw = JSON.parse(readFileSync(file, 'utf8'));
    // a scenario configuration (line and number of trains, docs/SCENARIO_CONFIG.md) becomes its scenario
    if (raw && typeof raw.trains === 'object' && raw.trains && typeof raw.trains.count === 'number') return { file, def: makeScenario(resolvePaths(raw, dirname(resolve(file)))) };
    const def = toEnglish<ScenarioDef>(raw);
    const err = validateScenario(def);
    if (err.length) throw new Error(`${file}: ${err.join('; ')}`);
    return { file, def };
  });
}

/** Line from a built-in id or from a JSON file */
export function loadLine(v: string | undefined): LineDef {
  if (!v || LINE_PRESETS[v]) return clone(LINE_PRESETS[v || 'valle-lauro']);
  return fitPlan(toEnglish<LineDef>(JSON.parse(readFileSync(v, 'utf8'))));
}
/** Train from a built-in id or from a JSON file */
export function loadTrain(v: string | undefined): TrainParams {
  const id = v ? (VALUES_IT_EN.train[v] ?? v) : 'regional';
  if (TRAIN_PRESETS[id]) return clone(TRAIN_PRESETS[id]);
  return toEnglish<TrainParams>(JSON.parse(readFileSync(v as string, 'utf8')));
}

/**
 * Loads a JavaScript controller in the browser format, isolated in a vm context. A controller written for 0.x defines
 * `controllo` instead of `control`: it receives the Italian observation (version 2) whatever the requested version.
 */
export function loadJsController(file: string, globals?: Record<string, unknown>): Controller {
  const code = readFileSync(file, 'utf8');
  // `globals`: parameters the controller reads as global variables, for example PARAMS of examples/driver_model.js
  const ctx = createContext({ Math, console, JSON, Number, Object, Array, isFinite, ...JSON.parse(JSON.stringify(globals ?? {})) });
  const found = runInContext(code + '\n;typeof control === "function" ? [control, false] : typeof controllo === "function" ? [controllo, true] : null', ctx, { filename: file });
  if (!found) throw new Error(file + ' must define function control(obs, mem)');
  const [fn, legacy] = found as [(o: unknown, m: unknown) => Command, boolean];
  const mem = {};
  return (o: Observation) => fn(legacy && o.version === 3 ? toLegacy({ ...o, version: 2 }, 'observation') : o, mem);
}

/** Connects an external controller via WebSocket (Node 22 has a native WebSocket) */
export async function connectWsController(url: string): Promise<{ controller: Controller; close: () => void }> {
  const ws = new WebSocket(url);
  await new Promise<void>((res, rej) => {
    ws.addEventListener('open', () => res(), { once: true });
    ws.addEventListener('error', () => rej(new Error('Connection to ' + url + ' failed: is the controller listening?')), { once: true });
  });
  let pending: ((c: Command) => void) | null = null;
  ws.addEventListener('message', ev => {
    let c: Command = {};
    try { c = JSON.parse(String(ev.data)); } catch { /* invalid response: empty command */ }
    if (pending) { const p = pending; pending = null; p(c); }
  });
  const controller: Controller = o => new Promise<Command>(res => { pending = res; ws.send(JSON.stringify(o)); });
  return { controller, close: () => ws.close() };
}

/** Loads a JavaScript dynamics model defining `function dynamics(req, mem)` (or `dinamica` for 0.x), isolated in a vm context */
export function loadJsDynamics(file: string): DynamicsProvider {
  const code = readFileSync(file, 'utf8');
  const ctx = createContext({ Math, console, JSON, Number, Object, Array, isFinite });
  const found = runInContext(code + '\n;typeof dynamics === "function" ? [dynamics, false] : typeof dinamica === "function" ? [dinamica, true] : null', ctx, { filename: file });
  if (!found) throw new Error(file + ' must define function dynamics(req, mem)');
  const [fn, legacy] = found as [(r: unknown, m: unknown) => DynamicsResponse, boolean];
  const mem = {};
  const call = (r: DynamicsRequest) => fn(r, mem);
  return legacy ? legacyProvider(call, 'dynamics') as DynamicsProvider : call;
}

/** Request/response channel to an external program (dynamics model, ETCS onboard or trackside) */
export interface Channel<Q, R> { call: (q: Q) => Promise<R>; close: () => void }

/** Protocol of JSON lines over any channel (TCP socket, stdin/stdout of a process) */
function lineProtocol<Q, R>(input: Readable, output: Writable, what: string): (q: Q) => Promise<R> {
  let buf = '', pending: { res: (r: R) => void; rej: (e: Error) => void } | null = null;
  input.on('data', (d: Buffer) => {
    buf += d.toString('utf8');
    let i: number;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line || !pending) continue;
      const p = pending; pending = null;
      try { p.res(JSON.parse(line)); } catch { p.rej(new Error('non-JSON response from ' + what + ': ' + line.slice(0, 120))); }
    }
  });
  input.on('close', () => { if (pending) { pending.rej(new Error(what + ' closed the connection')); pending = null; } });
  return q => new Promise((res, rej) => { pending = { res, rej }; output.write(JSON.stringify(q) + '\n'); });
}

/**
 * Opens a request/response channel to an external program.
 *  - exec:command  starts the program and talks to it on stdin/stdout, one JSON line per message
 *    (Octave, Python, any language, no network); the stderr of the program goes to the console.
 *  - tcp://host:port  the program is already listening; one JSON line per message (MATLAB tcpserver).
 *  - ws://host:port  the program is a WebSocket server; one message per request.
 */
export async function openChannel<Q, R>(spec: string, what: string): Promise<Channel<Q, R>> {
  if (spec.startsWith('exec:')) {
    const command = spec.slice(5).trim();
    const child = spawn(command, { shell: true, stdio: ['pipe', 'pipe', 'inherit'] });
    child.on('error', e => console.error('Cannot start ' + what + ' «' + command + '»: ' + e.message));
    return { call: lineProtocol<Q, R>(child.stdout, child.stdin, what + ' «' + command + '»'), close: () => { try { child.stdin.end(); } catch { /* already closed */ } } };
  }
  if (spec.startsWith('tcp://')) {
    const u = new URL(spec.replace(/^tcp:/, 'http:'));
    const sock = tcpConnect({ host: u.hostname, port: Number(u.port) });
    sock.setNoDelay(true);
    await new Promise<void>((res, rej) => {
      sock.once('connect', () => res());
      sock.once('error', () => rej(new Error('Connection to ' + spec + ' failed: is ' + what + ' listening?')));
    });
    return { call: lineProtocol<Q, R>(sock, sock, what), close: () => sock.end() };
  }
  if (!/^wss?:\/\//.test(spec)) throw new Error('unrecognised address for ' + what + ': ' + spec + ' (use exec:, tcp:// or ws://)');
  const ws = new WebSocket(spec);
  await new Promise<void>((res, rej) => {
    ws.addEventListener('open', () => res(), { once: true });
    ws.addEventListener('error', () => rej(new Error('Connection to ' + spec + ' failed: is ' + what + ' listening?')), { once: true });
  });
  let pending: ((r: R) => void) | null = null;
  ws.addEventListener('message', ev => { if (pending) { const p = pending; pending = null; p(JSON.parse(String(ev.data))); } });
  return { call: q => new Promise(res => { pending = res; ws.send(JSON.stringify(q)); }), close: () => ws.close() };
}

/** Starts a dynamics model as a child process on stdin/stdout (see openChannel, exec:) */
export function spawnDynamics(command: string): { dynamics: DynamicsProvider; close: () => void } {
  const child = spawn(command, { shell: true, stdio: ['pipe', 'pipe', 'inherit'] });
  child.on('error', e => console.error('Cannot start the dynamics model «' + command + '»: ' + e.message));
  const dynamics = lineProtocol<DynamicsRequest, DynamicsResponse>(child.stdout, child.stdin, 'the dynamics model «' + command + '»');
  return { dynamics, close: () => { try { child.stdin.end(); } catch { /* already closed */ } } };
}

/** Connects an external dynamics model via tcp:// or ws:// (see openChannel) */
export async function connectDynamics(url: string): Promise<{ dynamics: DynamicsProvider; close: () => void }> {
  const ch = await openChannel<DynamicsRequest, DynamicsResponse>(url, 'the dynamics model');
  return { dynamics: ch.call, close: ch.close };
}

/** Loads a JavaScript ETCS onboard defining `function onboard(req, mem)` (or `bordo` for 0.x), isolated in a vm context */
export function loadJsOnboard(file: string): OnboardProvider {
  const code = readFileSync(file, 'utf8');
  const ctx = createContext({ Math, console, JSON, Number, Object, Array, isFinite, Map, Set });
  const found = runInContext(code + '\n;typeof onboard === "function" ? [onboard, false] : typeof bordo === "function" ? [bordo, true] : null', ctx, { filename: file });
  if (!found) throw new Error(file + ' must define function onboard(req, mem)');
  const [fn, legacy] = found as [(r: unknown, m: unknown) => OnboardResponse, boolean];
  const mem = {};
  const call = (r: OnboardRequest) => fn(r, mem);
  return legacy ? legacyProvider(call, 'onboard') as OnboardProvider : call;
}

async function main(): Promise<void> {
  const a = parseArgs(process.argv.slice(2));
  if (a.help) { process.stdout.write(HELP); return; }
  const ctlArg = a.controller || 'examples/ato.js';
  const period = Number(a.period || 0.2), reps = Math.max(1, Number(a.repetitions || 1));
  const legacyProtocol = a.protocol === '1';
  const scenarios: { file: string | null; def: ScenarioDef | null }[] = a.scenario ? loadScenarios(a.scenario) : [{ file: null, def: null }];
  const results = [];
  for (const { file, def } of scenarios) {
    const r = resolveScenario(def);
    const line = a.line || !def ? loadLine(a.line) : r.line;
    const train = a.train || !def ? loadTrain(a.train) : r.train;
    if (a.dynamics) train.model = 'external';
    if (a.coupling) train.external = { ...train.external, period_s: Number(a.coupling) };
    const scen: Scenario = {
      ...DEFAULT_SCENARIO, ...r.scen,
      ...(a.signalling ? { sig: a.signalling === 'BACC' ? 'BACC' : 'ETCS' } : {}),
      ...(a.weather ? { met: a.weather as Scenario['met'] } : {}),
      ...(a.adhesion ? { adh: a.adhesion as Scenario['adh'] } : {}),
      ...(a.onboard ? { onboard: a.onboard === 'internal' || a.onboard === 'reference' ? a.onboard : 'external' } : {}),
      ...(a['onboard-cycle'] ? { onboard_period_s: Number(a['onboard-cycle']) } : {}),
      ...(a.trackside ? { trackside: a.trackside === 'simple' || a.trackside === 'interlocking' ? a.trackside : 'external' } : {}),
      ...(a.regulator ? { regulator: a.regulator === 'none' || a.regulator === 'reference' ? a.regulator : 'external' } : {}),
      ...(a['regulator-cycle'] ? { regulator_period_s: Number(a['regulator-cycle']) } : {}),
    };
    const tag = file ? basename(file, '.json') : 'run';
    for (let k = 0; k < reps; k++) {
      const sim = new Simulation(clone(line), train, scen, def);
      let ctl: Controller, close = () => {};
      if (/^wss?:\/\//.test(ctlArg)) ({ controller: ctl, close } = await connectWsController(ctlArg));
      else ctl = loadJsController(ctlArg, a['controller-params'] ? { PARAMS: JSON.parse(a['controller-params']) } : undefined);
      let agents: Controller | undefined, closeAgents = () => {};
      if (a.agents && /^wss?:\/\//.test(a.agents)) ({ controller: agents, close: closeAgents } = await connectWsController(a.agents));
      else if (a.agents) {
        const each: Record<string, Controller> = {};
        agents = (o: Observation) => (each[o.train_id ?? ''] ??= loadJsController(a.agents))(o);
      }
      let dyn: DynamicsProvider | undefined, closeDyn = () => {};
      if (a.dynamics && a.dynamics.startsWith('exec:')) ({ dynamics: dyn, close: closeDyn } = spawnDynamics(a.dynamics.slice(5).trim()));
      else if (a.dynamics && /^(tcp|wss?):\/\//.test(a.dynamics)) ({ dynamics: dyn, close: closeDyn } = await connectDynamics(a.dynamics));
      else if (a.dynamics) dyn = loadJsDynamics(a.dynamics);
      if (dyn && legacyProtocol && !a.dynamics.endsWith('.js')) dyn = legacyProvider(dyn, 'dynamics') as DynamicsProvider;
      const t0 = Date.now();
      let onb: OnboardProvider | undefined, closeOnb = () => {};
      if (scen.onboard === 'external' && a.onboard) {
        if (/^(exec:|tcp:\/\/|wss?:\/\/)/.test(a.onboard)) {
          const ch = await openChannel<OnboardRequest, OnboardResponse>(a.onboard, 'the ETCS onboard');
          onb = legacyProtocol ? legacyProvider(ch.call, 'onboard') as OnboardProvider : ch.call; closeOnb = ch.close;
        } else onb = loadJsOnboard(a.onboard);
      }
      let ter: TracksideProvider | undefined, closeTer = () => {};
      if (scen.trackside === 'external' && a.trackside) {
        const ch = await openChannel<TracksideRequest, TracksideResponse>(a.trackside, 'the trackside');
        ter = legacyProtocol ? legacyProvider(ch.call, 'trackside') as TracksideProvider : ch.call; closeTer = ch.close;
      }
      let reg: RegulatorProvider | undefined, closeReg = () => {};
      if (scen.regulator === 'external') {
        if (!a.regulator) throw new Error('the scenario uses an external regulator: connect it with --regulator exec:…|tcp://…|ws://…');
        const ch = await openChannel<RegulatorRequest, RegulatorResponse>(a.regulator, 'the regulator');
        reg = ch.call; closeReg = ch.close;
      }
      const api = a.api === '1' ? 1 : a.api === '2' ? 2 : 3;
      try {
        await runLockstep(sim, ctl, { period, source: /^wss?:/.test(ctlArg) ? 'ws' : basename(ctlArg), dynamics: dyn, onboard: onb, api, trackside: ter, regulator: reg, agents });
      } finally { close(); closeDyn(); closeOnb(); closeTer(); closeReg(); closeAgents(); }
      const sum = { ...sim.summary(), file: file ? basename(file) : null, run: k + 1, wall_duration_s: (Date.now() - t0) / 1000 };
      results.push(sum);
      if (a.output) {
        mkdirSync(a.output, { recursive: true });
        const base = join(a.output, `${tag}_${String(k + 1).padStart(3, '0')}`);
        writeFileSync(base + '.csv', sim.csv());
        writeFileSync(base + '_events.json', JSON.stringify(sim.S.events, null, 1));
        writeFileSync(base + '_summary.json', JSON.stringify(sum, null, 2));
        if (sim.trains.length > 1) {
          writeFileSync(base + '_timetable.json', JSON.stringify(sim.timetable(), null, 2));
          for (const r of sim.trains.slice(1)) {
            const slug = r.id.replace(/[^A-Za-z0-9]+/g, '-');
            writeFileSync(`${base}_${slug}.csv`, sim.csv(r));
            writeFileSync(`${base}_${slug}_summary.json`, JSON.stringify(sim.summary(r), null, 2));
          }
        }
      }
      const failed = sum.checks.filter(c => !c.ok).map(c => `${c.name.toLowerCase()} ${c.value} (threshold ${c.threshold})`);
      console.log(`${(sum.scenario ?? 'Run without scenario').padEnd(42)} ${sum.outcome.toUpperCase().padEnd(7)} ` +
        `arrival ${sum.t_s.toFixed(0).padStart(5)} s, mean stopping error ${sum.mean_stop_error_m ?? '—'} m, ` +
        `net energy ${(sum.traction_energy_kWh - sum.regenerated_energy_kWh).toFixed(1)} kWh` + (failed.length ? `\n    ${failed.join('; ')}` : ''));
      for (const r of sim.trains.slice(1)) {
        const sr = sim.summary(r), tt = sim.timetable().find(x => x.id === r.id);
        const last = tt?.stops[tt.stops.length - 1];
        console.log(`    ${r.freight ? 'train ahead' : 'service'} ${r.id.padEnd(12)} ${sr.outcome.toUpperCase().padEnd(7)} arrival ${last?.arrival_s ?? '—'} s` +
          (last?.arrival_delay_s != null ? ` (${last.arrival_delay_s >= 0 ? '+' : ''}${last.arrival_delay_s} s)` : '') +
          `, interventions ${sr.interventions}, overruns ${sr.overruns}`);
      }
      const px = sim.passengers();
      if (px) {
        console.log(`    passengers: ${px.boarded.toFixed(0)} boarded, ${px.alighted.toFixed(0)} alighted, ${px.left_behind.toFixed(0)} left behind, ` +
          `mean wait ${px.mean_wait_s} s, mean journey ${px.mean_journey_s} s, delay per passenger ${px.mean_passenger_delay_s} s, ` +
          `${px.passenger_km.toFixed(0)} passenger-km, ${px.energy_wh_per_pkm ?? '—'} Wh per passenger-km` +
          (px.transfers > 0 ? `, ${px.transfers.toFixed(0)} changes of train waiting ${px.mean_transfer_wait_s} s each (${px.transfer_passenger_min} passenger-minutes)` : ''));
        if (a.output) writeFileSync(join(a.output, `${tag}_${String(k + 1).padStart(3, '0')}_passengers.json`), JSON.stringify(px, null, 1));
      }
    }
  }
  if (scenarios.length > 1 || reps > 1) {
    const ok = results.filter(r => r.outcome === 'passed').length;
    console.log(`\nPassed ${ok} of ${results.length}.`);
  }
  if (a.output) writeFileSync(join(a.output, 'summary.json'), JSON.stringify(results, null, 2));
}

const isMain = process.argv[1] && /headless\.ts$/.test(process.argv[1]);
if (isMain) main().catch(e => { console.error(String(e && e.message || e)); process.exit(1); });
