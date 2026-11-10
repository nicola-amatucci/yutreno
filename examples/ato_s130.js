// Example controller: ATO using the data of the ETCS onboard for ATO (Subset-130, API version 3).
//
// The simple ATO (ato.js) follows the permitted speed of the onboard with a fixed margin: it brakes when the
// permitted curve brakes, so its driving style depends on the onboard. This ATO plans by itself instead:
//  - it brakes towards every MRSP reduction (obs.etcs_ato.MRSP) and towards the end of authority (N_LOC_EOALOA)
//    with its own planning deceleration, corrected for the gradient (GRADIENT) and never beyond a fraction of the
//    safe deceleration of the onboard (A_BRAKE_SAFE);
//  - it rebuilds the intervention curve of the onboard from the Subset-130 data only (A_BRAKE_SAFE, GRADIENT,
//    T_BE_REACT, T_TRACTION) and never exceeds it, with a guard time: when the speed difference is small, reaction
//    times rather than deceleration decide where to brake;
//  - it watches the announced intervention limit (N_LOC_EBI): if at the current speed it would reach it in less than
//    the guard time, it applies full service brake before the protection does;
//  - it uses V_PERMITTED only as a ceiling, with a small margin.
// Station stops, vigilance and speed regulator are those of the simple ATO, so that the comparison between the two
// measures only the effect of the Subset-130 data.
// Without etcs_ato (automatic block, API version 1, an onboard that does not provide the data) it behaves like ato.js.

const MARGIN = 2.0;       // m/s below the permitted speed, as ato.js (without Subset-130 data)
const MARGIN_MRSP = 1.0;  // m/s below the MRSP
const MARGIN_P = 0.5;     // m/s below V_PERMITTED, used only as a ceiling
const DECEL = 0.45;       // m/s², design deceleration, the same as ato.js
const SAFE_FRACTION = 0.5; // the planning deceleration does not exceed this fraction of A_BRAKE_SAFE
const DECEL_MIN = 0.15;   // m/s², minimum planning deceleration after the gradient correction
const LEAD = 10;          // m: MRSP reductions are reached with this lead
const T_LEAD = 2;         // s: the own curve is evaluated where the train will be after this time (regulator and brake delay)
const EOA_STOP = 25;      // m before the end of authority, as ato.js
const GUARD_S = 3;        // s beyond the brake reaction times: minimum distance from the EBI limit
const PRE_WARNING_S = 4;  // s more during which traction stays cut off
const KP = 0.55, KI = 0.08;

// least favourable gradient (most negative deceleration) between a and b
function worstGradient(grad, a, b) {
  let g = 0, first = true;
  for (let i = 0; i < grad.length; i++) {
    const from = grad[i][0], end = i + 1 < grad.length ? grad[i + 1][0] : Infinity;
    if (end <= a || from >= b) continue;
    g = first ? grad[i][1] : Math.min(g, grad[i][1]); first = false;
  }
  return Math.min(0, g);
}

function control(obs, mem) {
  const cmd = {};
  if (obs.vigilance_alarm) cmd.vigilance = true;
  if (obs.emergency || obs.doors_open) {
    mem.i = 0;
    return Object.assign(cmd, { traction: 0, brake: 0.5 });
  }

  const e = obs.etcs_ato;
  const s130 = !!(e && e.N_LOC_EBI !== undefined && e.A_BRAKE_SAFE != null);
  let vTarget, guard = 0;

  if (s130) {
    const pos = obs.pos_m, v = obs.vel_ms;
    const aBase = Math.min(DECEL, SAFE_FRACTION * e.A_BRAKE_SAFE);
    const decel = (a, b) => Math.max(DECEL_MIN, aBase + worstGradient(e.GRADIENT, a, b));
    vTarget = Math.min(e.V_MRSP - MARGIN_MRSP, e.V_PERMITTED - MARGIN_P);

    // rebuilt intervention curve: from v one reaches vt in v·T + (v² − vt²)/(2A), with T including the guard
    const tGuard = e.T_BE_REACT + e.T_TRACTION + GUARD_S + PRE_WARNING_S;
    const vEbi = (p, vt) => {
      const A = Math.max(DECEL_MIN, e.A_BRAKE_SAFE + worstGradient(e.GRADIENT, pos, p)), d = Math.max(0, p - pos);
      return -A * tGuard + Math.sqrt(A * A * tGuard * tGuard + 2 * A * d + vt * vt);
    };

    // MRSP reductions ahead: own braking curve and rebuilt intervention curve
    let vPrev = e.V_MRSP;
    for (const [p, vt] of e.MRSP) {
      if (vt < vPrev && p > pos) {
        const d = p - pos - LEAD - v * T_LEAD, vf = Math.max(0, vt - MARGIN_MRSP);
        vTarget = Math.min(vTarget, Math.sqrt(vf * vf + 2 * decel(pos, p) * Math.max(0, d)), vEbi(p, vt));
      }
      vPrev = vt;
    }
    if (e.N_LOC_SVL != null && e.V_RELEASE_ATO != null) vTarget = Math.min(vTarget, vEbi(e.N_LOC_SVL, 0));

    // end of authority: stop with a lead
    if (e.N_LOC_EOALOA != null && e.V_EOALOA === 0 && e.V_RELEASE_ATO != null) {
      const d = e.N_LOC_EOALOA - EOA_STOP - pos;
      vTarget = Math.min(vTarget, Math.sqrt(2 * decel(pos, e.N_LOC_EOALOA) * Math.max(0, d - v * T_LEAD)));
      if (d < 1) return Object.assign(cmd, { traction: 0, brake: 1 });
    }

    // guard on the intervention limit: time to reach it at the current speed
    if (e.N_LOC_EBI != null && v > 0.5) {
      const tEbi = (e.N_LOC_EBI - pos) / v, tReact = e.T_BE_REACT + e.T_TRACTION;
      if (tEbi < tReact + GUARD_S) guard = 2;
      else if (tEbi < tReact + GUARD_S + PRE_WARNING_S) guard = 1;
    }
  } else {
    vTarget = obs.supervision.v_permitted_ms - MARGIN;
    const tg = obs.supervision.target;
    if (tg && tg.speed_ms === 0) {
      const d = tg.distance_m - EOA_STOP;
      vTarget = Math.min(vTarget, Math.sqrt(2 * DECEL * Math.max(0, d)));
      if (d < 1) return Object.assign(cmd, { traction: 0, brake: 1 });
    }
  }

  // station stop: stopping curve on the stop marker, as ato.js
  const st = obs.next_stop;
  if (st) {
    const d = st.pos_m - obs.pos_m;
    if (d < 600) vTarget = Math.min(vTarget, Math.max(d > 2 ? 0.8 : 0, Math.sqrt(2 * DECEL * Math.max(0, d - 0.5))));
    if (d < 0.6) return Object.assign(cmd, { traction: 0, brake: 1 });
  }

  if (guard === 2) {
    if (!mem.inGuard) { mem.inGuard = true; cmd.note = 'ATO: close to the intervention limit, full braking'; }
    mem.i = 0;
    return Object.assign(cmd, { traction: 0, brake: 1 });
  }
  mem.inGuard = false;

  // proportional-integral speed regulator, as ato.js
  const err = vTarget - obs.vel_ms;
  mem.i = Math.max(-3, Math.min(3, (mem.i || 0) + err * obs.dt));
  const u = KP * err + KI * mem.i;
  if (u >= 0 && guard === 0) { cmd.traction = Math.min(1, u); cmd.brake = 0; }
  else { cmd.traction = 0; cmd.brake = u >= 0 ? 0 : Math.min(1, -u * 0.8); }
  return cmd;
}
