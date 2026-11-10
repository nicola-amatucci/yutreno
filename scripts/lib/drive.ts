/**
 * The built-in driver (autoDriver) at the controller's period, as the checks drive the controlled train in their own
 * loops: called before every step, it gives a command when the period has passed. One driver per run: it keeps the
 * memory of the driver and the time of the next command.
 */
import { autoDriver, type Simulation } from '../../src/core';

export function builtInDriver(period = 0.2): (sim: Simulation) => void {
  const mem = {};
  let next = 0;
  return sim => {
    if (!sim.S.finished && sim.S.t + 1e-9 >= next) { sim.applyCommand(autoDriver(sim.observe(period), mem)); next = sim.S.t + period - 1e-9; }
  };
}
