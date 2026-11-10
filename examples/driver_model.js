// Example controller: a model of a human driver (docs/DRIVER_MODEL.md)
//
// It drives between two curves, as in the model of Barbaro et al. (Railway Engineering Science, 2026, §3.2.3):
//   - traction below a low curve, which lies under the permitted speed by a margin drawn once from a Gaussian, so
//     that every driver (every seed) drives a little differently;
//   - braking above an upper curve, but only once the driver has responded: the response comes with a rate that
//     starts at a base value and grows with the time spent above the curve; until then the previous command stays;
//     once braking, the driver brakes back to the permitted speed. The upper curve is the permitted speed (the
//     overspeed shown on the DMI); with brake_above "warning" it is the warning curve, as in the model of Milan;
//   - coasting in between;
//   - two utilisation coefficients scale the traction and the brake (the style of driving);
//   - towards an end of authority the driver brakes to a stop when it is closer than a minimum distance.
// Vigilance, doors and station stops are those of examples/ato.js, so that a comparison with the ATO measures only
// the style of driving.
//
// Parameters: a global object PARAMS, given by the runner (headless: --controller-params '{"profile":"cautious",
// "seed":3}'), with a profile name and a seed, and any single parameter to override. Without it: profile medium,
// seed 1. The randomness comes from a seeded generator, not Math.random, so the same seed gives the same run.

const PROFILES = {
  cautious:   { margin_mean_kmh: 10, margin_sd_kmh: 2.0, k_traction: 0.6, k_brake: 0.8, eoa_distance_m: 150 },
  medium:     { margin_mean_kmh: 5,  margin_sd_kmh: 1.5, k_traction: 0.8, k_brake: 0.8, eoa_distance_m: 100 },
  aggressive: { margin_mean_kmh: 2,  margin_sd_kmh: 1.0, k_traction: 1.0, k_brake: 1.0, eoa_distance_m: 60 },
};
// Response above the upper curve, the same for the three profiles: rate (1/s) = base + growth · time above it.
// With these values the mean response time is about 1.5 s, and 2.7 % of the responses take longer than the 4 s
// that the ETCS curves leave to the driver between the permitted speed and the service brake (T_driver).
const RESPONSE = { response_base_per_s: 0.3, response_growth_per_s2: 0.3, brake_above: 'permitted' };

// Station stops, as in examples/ato.js
const DECEL = 0.45, KP = 0.55, KI = 0.08;

/** mulberry32: a small 32-bit generator, the same sequence for the same seed in every JavaScript engine */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function setup(mem) {
  const given = typeof PARAMS === 'object' && PARAMS ? PARAMS : {};
  const profile = given.profile || 'medium';
  if (!PROFILES[profile]) throw new Error('driver_model.js: unknown profile ' + profile + ' (cautious, medium, aggressive)');
  const P = Object.assign({}, PROFILES[profile], RESPONSE, given);
  const rand = rng(given.seed == null ? 1 : given.seed);
  // Box–Muller: one Gaussian draw for the margin of this driver, never negative
  const u1 = Math.max(rand(), 1e-12), u2 = rand();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  mem.P = P;
  mem.rand = rand;
  mem.margin = Math.max(0, P.margin_mean_kmh + P.margin_sd_kmh * z) / 3.6;
  mem.cmd = { traction: 0, brake: 0 };
  mem.above = null;      // time the speed went above the upper curve, null when below
  mem.braking = false;   // the driver has responded and brakes back to the permitted speed
}

function control(obs, mem) {
  if (!mem.P) setup(mem);
  const P = mem.P, sup = obs.supervision, v = obs.vel_ms;
  const cmd = {};
  if (obs.vigilance_alarm) cmd.vigilance = true;
  if (obs.emergency || obs.doors_open) {
    mem.i = 0; mem.above = null; mem.braking = false;
    mem.cmd = { traction: 0, brake: 0.5 };
    return Object.assign(cmd, mem.cmd);
  }

  // station stop: the stopping curve and regulator of examples/ato.js within 600 m of the stop marker
  const st = obs.next_stop;
  if (st && st.pos_m - obs.pos_m < 600) {
    const d = st.pos_m - obs.pos_m;
    if (d < 0.6) { mem.cmd = { traction: 0, brake: 1 }; return Object.assign(cmd, mem.cmd); }
    let vTarget = Math.min(sup.v_permitted_ms - 2.0, Math.max(d > 2 ? 0.8 : 0, Math.sqrt(2 * DECEL * Math.max(0, d - 0.5))));
    const tg = sup.target;
    if (tg && tg.speed_ms === 0) vTarget = Math.min(vTarget, Math.sqrt(2 * DECEL * Math.max(0, tg.distance_m - 25)));
    const e = vTarget - v;
    mem.i = Math.max(-3, Math.min(3, (mem.i || 0) + e * obs.dt));
    const u = KP * e + KI * mem.i;
    mem.cmd = u >= 0 ? { traction: Math.min(1, u), brake: 0 } : { traction: 0, brake: Math.min(1, -u * 0.8) };
    mem.above = null; mem.braking = false;
    return Object.assign(cmd, mem.cmd);
  }
  mem.i = 0;

  // end of authority or signal at danger closer than the minimum distance: brake to a stop
  const tg = sup.target;
  if (tg && tg.speed_ms === 0 && tg.distance_m < P.eoa_distance_m) {
    mem.cmd = { traction: 0, brake: P.k_brake };
    return Object.assign(cmd, mem.cmd);
  }

  const vP = sup.v_permitted_ms, vUp = P.brake_above === 'warning' && sup.v_warning_ms != null ? sup.v_warning_ms : vP, vLow = vP - mem.margin;
  if (mem.braking) {
    // braking back to the permitted speed
    if (v <= vP) mem.braking = false;
    else mem.cmd = { traction: 0, brake: P.k_brake };
  }
  if (!mem.braking) {
    if (v > vUp) {
      // above the upper curve: the driver responds with a rate growing with the time spent there
      if (mem.above == null) mem.above = obs.t;
      const rate = P.response_base_per_s + P.response_growth_per_s2 * (obs.t - mem.above);
      if (mem.rand() < 1 - Math.exp(-rate * obs.dt)) { mem.braking = true; mem.above = null; mem.cmd = { traction: 0, brake: P.k_brake }; }
      // otherwise the previous command stays
    } else {
      mem.above = null;
      mem.cmd = v < vLow ? { traction: P.k_traction, brake: 0 } : { traction: 0, brake: 0 };
    }
  }
  return Object.assign(cmd, mem.cmd);
}
