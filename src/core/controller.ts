/**
 * Lockstep execution with a controller: at every period the simulation stops, sends an observation and waits for
 * the command. The controller may be synchronous or asynchronous (Web Worker, WebSocket): results do not depend on
 * response times. With an external dynamics model, onboard unit or trackside the run also stops whenever it is
 * their turn and waits for their answer (co-simulation).
 */
import { FIXED_DT, Simulation } from './simulation';
import { toLegacy, LEGACY_KEYS } from './legacy';
import type { Command, DynamicsRequest, DynamicsResponse, Observation, OnboardRequest, OnboardResponse, RegulatorRequest, RegulatorResponse } from './types';
import type { TracksideRequest, TracksideResponse } from '../trackside/types';

export type Controller = (obs: Observation) => Command | null | undefined | Promise<Command | null | undefined>;

/** External dynamics model: receives the request for an interval and returns the state at the end of the interval */
export type DynamicsProvider = (req: DynamicsRequest) => DynamicsResponse | Promise<DynamicsResponse>;

/** External ETCS onboard: receives odometry, balises and RBC messages of a cycle and returns commands, messages and DMI */
export type OnboardProvider = (req: OnboardRequest) => OnboardResponse | Promise<OnboardResponse>;

/** External trackside (interlocking and RBC): receives field telegrams, onboard messages and operator commands of a cycle */
export type TracksideProvider = (req: TracksideRequest) => TracksideResponse | Promise<TracksideResponse>;

/** External traffic regulator: receives the state of the traffic and returns decisions on the timetable */
export type RegulatorProvider = (req: RegulatorRequest) => RegulatorResponse | Promise<RegulatorResponse>;

/**
 * Wraps a provider written for the Italian protocols of YuTreno 0.x (version 1): requests are translated back to the
 * Italian format before being sent. Responses need no wrapping, because the engine accepts both formats.
 */
export function legacyProvider<Q extends object, R>(call: (q: Q) => R | Promise<R>, kind: Exclude<keyof typeof LEGACY_KEYS, 'observation'>): (q: Q) => R | Promise<R> {
  return (q: Q) => call(toLegacy<Q>({ ...q, version: 1 }, kind));
}

export interface RunOptions {
  /** Control period in seconds of simulated time */
  period?: number;
  /** Maximum simulated time (s); default 7200 s; when a timetabled time of the trains is later than that, one hour after the last of them */
  maxTime?: number;
  /** Name written in the «command» column of the CSV */
  source?: string;
  /** External dynamics model, required if the train has `model: 'external'` */
  dynamics?: DynamicsProvider;
  /** External ETCS onboard, required if the conditions have `onboard: 'external'` */
  onboard?: OnboardProvider;
  /** Version of the observation sent to the controller: 3 (default) English, 1 and 2 the Italian formats of 0.x */
  api?: 1 | 2 | 3;
  /** External trackside, required if the conditions have `trackside: 'external'` */
  trackside?: TracksideProvider;
  /** External regulator, required if the conditions have `regulator: 'external'` */
  regulator?: RegulatorProvider;
  /**
   * Agent driving the service trains with `driver: 'agent'`: it receives the observation of each of them, with
   * `train_id`, at the same period as the controller
   */
  agents?: Controller;
}

/** If needed, queries the external regulator before the next step */
export async function exchangeRegulator(sim: Simulation, regulator: RegulatorProvider | undefined): Promise<void> {
  if (!sim.regulatorDue()) return;
  if (!regulator) throw new Error('the run uses an external regulator, but no regulator is connected');
  sim.regulatorResponse(await regulator(sim.regulatorRequest()));
}

/** If needed, queries the external trackside before the next step */
export async function exchangeTrackside(sim: Simulation, trackside: TracksideProvider | undefined): Promise<void> {
  if (!sim.tracksideDue()) return;
  if (!trackside) throw new Error('the run uses an external trackside, but no trackside is connected');
  sim.tracksideResponse(await trackside(sim.tracksideRequest()));
}

/** If needed, queries the external ETCS onboard before the next step */
export async function exchangeOnboard(sim: Simulation, onboard: OnboardProvider | undefined): Promise<void> {
  if (!sim.onboardDue()) return;
  if (!onboard) throw new Error('the run uses an external ETCS onboard, but no onboard is connected');
  sim.onboardResponse(await onboard(sim.onboardRequest()));
}

/** If needed, queries the external dynamics model before the next step */
export async function exchangeDynamics(sim: Simulation, dynamics: DynamicsProvider | undefined): Promise<void> {
  if (!sim.dynamicsDue()) return;
  if (!dynamics) throw new Error('the train uses an external dynamics model, but no model is connected');
  sim.dynamicsResponse(await dynamics(sim.dynamicsRequest()));
}

/** Runs a complete headless run, as fast as possible */
export async function runLockstep(sim: Simulation, controller: Controller, opt: RunOptions = {}): Promise<Simulation> {
  // services of a long timetable may run after two hours: the run then lasts until an hour after the last of them
  // (a timetable within two hours keeps the limit of 7200 s, so the runs of before do not change)
  const lastPlanned = Math.max(0, ...sim.trains.flatMap(r => r.stations.map(st => Math.max(st.arr ?? 0, st.dep ?? 0))));
  const period = opt.period ?? 0.2, maxTime = opt.maxTime ?? (lastPlanned > 7200 ? lastPlanned + 3600 : 7200);
  sim.S.commandSource = opt.source ?? 'controller';
  let nextT = 0;
  while (!sim.done && sim.time < maxTime) {
    if (!sim.S.finished && sim.S.t + 1e-9 >= nextT) {
      const cmd = await controller(sim.observe(period, opt.api ?? 3));
      sim.S.ctlTicks++;
      sim.applyCommand(cmd);
      nextT = sim.S.t + period - 1e-9;
    }
    for (const run of sim.agentsDue()) {
      if (!opt.agents) throw new Error(`service ${run.id} is driven by an agent, but no agent is connected`);
      run.S.ctlTicks++;
      sim.applyCommand(await opt.agents(sim.observe(period, 3, run)), run);
      run.nextCtl = run.S.t + period - 1e-9;
    }
    if (sim.onboardDue()) await exchangeOnboard(sim, opt.onboard);
    if (sim.regulatorDue()) await exchangeRegulator(sim, opt.regulator);
    if (sim.tracksideDue()) await exchangeTrackside(sim, opt.trackside);
    if (sim.dynamicsDue()) await exchangeDynamics(sim, opt.dynamics);
    sim.step(FIXED_DT);
    sim.sample();
  }
  return sim;
}
