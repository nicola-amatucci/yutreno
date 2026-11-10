/**
 * Passengers and trains (phase 8, R1): at a stop the people alight and board, the dwell they need holds the doors
 * and the mass on board changes the train; the measures of the run add the energy per passenger-km. The model of
 * the demand and of the platforms is `PassengerModel` in passengers.ts (docs/PASSENGERS.md); this module joins it to
 * the trains of the run. `Simulation` keeps `passengers()` as its method.
 */
import type { PassengerResults, StopAhead } from './passengers';
import type { Simulation, TrainRun } from './simulation';

/** Stops of a train after the one at index i: the destinations its passengers can travel to */
function paxAhead(sim: Simulation, run: TrainRun, i: number): StopAhead[] {
  return run.stations.slice(i + 1).map(st => ({ name: st.name, s: st.s, arr: st.arr }));
}

/** Doors open at stop i: passengers alight and board, the dwell they need holds the doors, the mass changes (internal, also called by traffic.ts) */
export function paxOpen(sim: Simulation, run: TrainRun, i: number): void {
  // a freight train carries no passengers
  if (!sim.pax || run.freight) return;
  const st = run.stations[i];
  const r = sim.pax.open(run.id, run.TR, st.name, run.S.s, paxAhead(sim, run, i), i > 0 ? st.arr : null, run.S.t);
  run.S.paxDue = run.S.t + r.dwell_s;
  setPayload(sim, run, sim.pax.payload(run.id));
}

/** Doors close at stop i: latecomers board, who cannot is left on the platform */
export function paxClose(sim: Simulation, run: TrainRun, i: number): void {
  if (!sim.pax || run.freight || !run.stations[i]) return;
  sim.pax.close(run.id, run.TR, run.stations[i].name, run.S.s, paxAhead(sim, run, i), run.S.t);
  setPayload(sim, run, sim.pax.payload(run.id));
}

/**
 * Mass of the passengers on board: it adds to the mass of the train and to its equivalent mass (people do not
 * rotate), and in the multi-mass model to each vehicle in proportion to its length. The brake force follows the
 * mass, as with a load-weighing valve, so the nominal deceleration stays; traction, adhesion and gradient do not
 */
function setPayload(sim: Simulation, run: TrainRun, kg: number): void {
  const d = kg - run.payload;
  if (Math.abs(d) < 1e-9) return;
  run.payload = kg;
  run.TR.m += d;
  run.ME += d;
  const M = run.mm;
  if (M) {
    if (!M.pay) { M.veh = M.veh.map(v => ({ ...v })); M.pay = new Float64Array(M.n); }
    const L = M.veh.reduce((a, v) => a + v.L, 0);
    for (let i = 0; i < M.n; i++) { const di = d * M.veh[i].L / L; M.veh[i] = { ...M.veh[i], m: M.veh[i].m + di }; M.pay[i] += di; }
    M.M += d;
    M.mMot = M.veh.filter(v => v.motored).reduce((a, v) => a + v.m, 0);
  }
}

/** Passengers of the run up to now, with the energy per passenger-km; null without passengers */
export function passengers(sim: Simulation): (PassengerResults & { energy_kwh: number; energy_wh_per_pkm: number | null }) | null {
  if (!sim.pax) return null;
  const r = sim.pax.results(sim.time);
  // the energy of the trains that carry passengers: a freight train does not
  const e = sim.trains.reduce((a, t) => a + (t.freight ? 0 : t.S.eT - t.S.eR), 0);
  return { ...r, energy_kwh: Math.round(e * 10) / 10, energy_wh_per_pkm: r.passenger_km > 0 ? Math.round(e * 1000 / r.passenger_km * 10) / 10 : null };
}
