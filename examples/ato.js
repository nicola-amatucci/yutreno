// Example controller: simplified ATO
// It follows the permitted speed with a margin, stops before the end of authority
// and stops the head of the train at the stop marker of every station.
// obs: observation sent by the simulator, mem: object kept from one step to the next.

const MARGIN = 2.0;     // m/s below the permitted speed (about 7 km/h)
const DECEL = 0.45;     // m/s², design deceleration for stops
const KP = 0.55, KI = 0.08;

function control(obs, mem) {
  const cmd = {};
  if (obs.vigilance_alarm) cmd.vigilance = true;
  if (obs.emergency || obs.doors_open) {
    mem.i = 0;
    return Object.assign(cmd, { traction: 0, brake: 0.5 });
  }

  let vTarget = obs.supervision.v_permitted_ms - MARGIN;

  // end of authority or red signal: stop 25 m before
  const tg = obs.supervision.target;
  if (tg && tg.speed_ms === 0) {
    const d = tg.distance_m - 25;
    vTarget = Math.min(vTarget, Math.sqrt(2 * DECEL * Math.max(0, d)));
    if (d < 1) return Object.assign(cmd, { traction: 0, brake: 1 });
  }

  // station stop: stopping curve on the stop marker
  const st = obs.next_stop;
  if (st) {
    const d = st.pos_m - obs.pos_m;
    if (d < 600) vTarget = Math.min(vTarget, Math.max(d > 2 ? 0.8 : 0, Math.sqrt(2 * DECEL * Math.max(0, d - 0.5))));
    if (d < 0.6) return Object.assign(cmd, { traction: 0, brake: 1 });
  }

  // proportional-integral speed regulator
  const e = vTarget - obs.vel_ms;
  mem.i = Math.max(-3, Math.min(3, (mem.i || 0) + e * obs.dt));
  const u = KP * e + KI * mem.i;
  if (u >= 0) { cmd.traction = Math.min(1, u); cmd.brake = 0; }
  else { cmd.traction = 0; cmd.brake = Math.min(1, -u * 0.8); }
  return cmd;
}
