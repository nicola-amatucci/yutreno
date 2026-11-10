/**
 * Built-in automatic driver of the service trains: the same logic as the example controller `examples/ato.js`
 * (follow the permitted speed with a margin, stop before the end of authority, stop at the stop marker), run inside
 * the core so that the trains of a timetable move deterministically without an external program.
 */
import type { Command, Observation } from './types';

const MARGIN = 2.0;
const DECEL = 0.45;
const KP = 0.55, KI = 0.08;

/** Memory of the driver between two calls */
export interface AutoDriverMemory { i?: number }

/**
 * One decision of the built-in ATO, from a version 3 observation; `decel` is the deceleration it plans its stops
 * with (m/s²), lower for a train with a slow brake such as the freight train ahead
 */
export function autoDriver(obs: Observation, mem: AutoDriverMemory, decel = DECEL): Command {
  const cmd: Command = {};
  if (obs.vigilance_alarm) cmd.vigilance = true;
  if (obs.emergency || obs.doors_open) {
    mem.i = 0;
    return Object.assign(cmd, { traction: 0, brake: 0.5 });
  }
  let vTarget = obs.supervision.v_permitted_ms - MARGIN;
  const tg = obs.supervision.target;
  if (tg && tg.speed_ms === 0) {
    const d = tg.distance_m - 25;
    vTarget = Math.min(vTarget, Math.sqrt(2 * decel * Math.max(0, d)));
    if (d < 1) return Object.assign(cmd, { traction: 0, brake: 1 });
  }
  const st = obs.next_stop;
  if (st) {
    const d = st.pos_m - obs.pos_m;
    if (d < 600) vTarget = Math.min(vTarget, Math.max(d > 2 ? 0.8 : 0, Math.sqrt(2 * decel * Math.max(0, d - 0.5))));
    if (d < 0.6) return Object.assign(cmd, { traction: 0, brake: 1 });
  }
  const e = vTarget - obs.vel_ms;
  mem.i = Math.max(-3, Math.min(3, (mem.i || 0) + e * obs.dt));
  const u = KP * e + KI * mem.i;
  if (u >= 0) { cmd.traction = Math.min(1, u); cmd.brake = 0; }
  else { cmd.traction = 0; cmd.brake = Math.min(1, -u * 0.8); }
  return cmd;
}
