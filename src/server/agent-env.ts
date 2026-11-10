/**
 * Environment for agents that learn or are tested on YuTreno, for example with reinforcement learning.
 *
 * The agent drives one or more trains of a scenario: the service trains with `driver: "agent"` and, if asked, the
 * controlled train (`train`). Every other train is driven by the built-in ATO. `reset` prepares a run and returns
 * the first observations; `step` applies one command per train and advances the simulation until some train of the
 * agent needs a new decision (every `period` seconds) or the run ends. Runs are deterministic: the same scenario and
 * the same commands give the same observations, which is what makes experiments repeatable.
 *
 * Protocol on stdin/stdout, one JSON object per line (used by examples/agents/yutreno_env.py):
 *   → {"cmd": "reset", "scenario": "scenarios/services/following.json", "agents": ["R 2102"], "period": 0.2}
 *   ← {"t": 300.2, "observations": {"R 2102": {...}}, "done": false}
 *   → {"cmd": "step", "actions": {"R 2102": {"traction": 0.6}}}
 *   ← {"t": 300.4, "observations": {...}, "done": false}            … until "done": true, with "info"
 *   → {"cmd": "close"}
 *   npx tsx src/server/agent-env.ts
 */
import { createInterface } from 'node:readline';
import { FIXED_DT, Simulation, autoDriver, resolveScenario, validateScenario, type AutoDriverMemory, type Command, type Observation, type ScenarioDef, type TrainRun } from '../core';
import { loadScenarios } from './headless';

export interface EnvReset {
  /** Scenario file or scenario object */
  scenario: string | ScenarioDef;
  /** Trains driven by the agent, by id: `train` for the controlled one; services listed here are driven by the agent too */
  agents?: string[];
  /** Decision period (s), default 0.2 */
  period?: number;
  /** Maximum simulated time (s), default 7200 */
  max_time_s?: number;
}

export interface EnvState {
  t: number;
  /** One observation per train of the agent that needs a decision now */
  observations: Record<string, Observation>;
  done: boolean;
  /** At the end: summary of every train and planned and realised timetable */
  info?: { summaries: Record<string, ReturnType<Simulation['summary']>>; timetable: ReturnType<Simulation['timetable']> };
}

export class AgentEnv {
  sim: Simulation | null = null;
  private period = 0.2;
  private maxTime = 7200;
  private controlledByAgent = false;
  private ctlMem: AutoDriverMemory = {};
  private ctlNext = 0;
  private waiting: TrainRun[] = [];

  reset(o: EnvReset): EnvState {
    let def: ScenarioDef;
    if (typeof o.scenario === 'string') [{ def }] = loadScenarios(o.scenario);
    else {
      const err = validateScenario(o.scenario);
      if (err.length) throw new Error(err.join('; '));
      def = o.scenario;
    }
    def = JSON.parse(JSON.stringify(def)) as ScenarioDef;
    const ids = new Set(o.agents ?? []);
    for (const sv of def.services ?? []) if (ids.has(sv.id)) sv.driver = 'agent';
    const { line, train, scen } = resolveScenario(def);
    if (scen.sig === 'ETCS' && (scen.onboard ?? 'internal') !== 'internal') throw new Error('the agent environment uses the internal supervision');
    this.sim = new Simulation(line, train, scen, def);
    this.sim.S.commandSource = ids.has('train') ? 'agent' : 'ato';
    this.period = o.period ?? 0.2;
    this.maxTime = o.max_time_s ?? 7200;
    this.controlledByAgent = ids.has('train');
    this.ctlMem = {}; this.ctlNext = 0; this.waiting = [];
    if (!this.controlledByAgent && !this.sim.trains.some(r => r.driver === 'agent')) throw new Error('no train is driven by the agent: list them in "agents" or give services driver "agent"');
    return this.advance();
  }

  step(actions: Record<string, Command | null | undefined>): EnvState {
    const sim = this.sim;
    if (!sim) throw new Error('call reset first');
    for (const run of this.waiting) {
      sim.applyCommand(actions[run.id] ?? null, run);
      run.S.ctlTicks++;
      if (run === sim.train) this.ctlNext = run.S.t + this.period - 1e-9;
      else run.nextCtl = run.S.t + this.period - 1e-9;
    }
    this.waiting = [];
    return this.advance();
  }

  /** Steps until a train of the agent needs a decision, or the run ends */
  private advance(): EnvState {
    const sim = this.sim as Simulation;
    for (;;) {
      const due: TrainRun[] = [];
      if (!sim.S.finished && sim.S.t + 1e-9 >= this.ctlNext) {
        if (this.controlledByAgent) due.push(sim.train);
        else { sim.applyCommand(autoDriver(sim.observe(this.period), this.ctlMem)); sim.S.ctlTicks++; this.ctlNext = sim.S.t + this.period - 1e-9; }
      }
      due.push(...sim.agentsDue());
      const end = sim.done || sim.time >= this.maxTime;
      if (due.length && !end) {
        this.waiting = due;
        const observations: Record<string, Observation> = {};
        for (const r of due) observations[r.id] = sim.observe(this.period, 3, r);
        return { t: +sim.time.toFixed(3), observations, done: false };
      }
      if (end) {
        const summaries: Record<string, ReturnType<Simulation['summary']>> = {};
        for (const r of sim.trains) summaries[r.id] = sim.summary(r);
        return { t: +sim.time.toFixed(3), observations: {}, done: true, info: { summaries, timetable: sim.timetable() } };
      }
      sim.step(FIXED_DT);
      sim.sample();
    }
  }
}

const isMain = process.argv[1] && /agent-env\.ts$/.test(process.argv[1]);
if (isMain) {
  const env = new AgentEnv();
  const rl = createInterface({ input: process.stdin });
  rl.on('line', line => {
    if (!line.trim()) return;
    let out: unknown;
    try {
      const m = JSON.parse(line) as { cmd: string } & EnvReset & { actions?: Record<string, Command> };
      if (m.cmd === 'reset') out = env.reset(m);
      else if (m.cmd === 'step') out = env.step(m.actions ?? {});
      else if (m.cmd === 'close') { rl.close(); return; }
      else out = { error: 'unknown command ' + m.cmd };
    } catch (e) { out = { error: (e as Error).message }; }
    process.stdout.write(JSON.stringify(out) + '\n');
  });
}
