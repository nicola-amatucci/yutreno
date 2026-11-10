// Example external dynamics model: the point mass of YuTreno rewritten outside the engine.
// It is a reference for writing your own model (in JavaScript, Python, MATLAB/Simulink...) and a test:
// with a coupling interval of 5 ms it reproduces the internal 'point' model.
//
//   npm run headless -- --dynamics examples/dynamics_point.js
//
// req: request of the engine (see docs/EXTERNAL_DYNAMICS.md); mem: object kept from one call to the next.
// Returns the state of the head of the train at the end of the interval req.dt.

const G = 9.81, H = 1 / 200;   // gravity and internal integration step (s)

function dynamics(req, mem) {
  if (req.start) {
    const T = req.train;
    Object.assign(mem, { T, ME: T.m * T.rot, s: req.state.pos_m, v: req.state.vel_ms, Ft: 0, Fb: 0, Fed: 0, eT: 0, eR: 0 });
  }
  // passengers on board (optional field payload_kg): they add to the mass and to the equivalent mass
  const pay = req.payload_kg ?? 0;
  const T = pay ? { ...mem.T, m: mem.T.m + pay } : mem.T, ME = mem.ME + pay, c = req.commands, b = req.track, k = req.faults;
  const mu = b.adhesion_mu;
  // relative altitude from the list of gradients: integral of the gradient up to x
  const rise = (x0, x1) => { let h = 0; for (const [a, z, i] of b.gradients) { const lo = Math.max(a, x0), hi = Math.min(z, x1); if (hi > lo) h += (hi - lo) * i / 1000; } return h; };
  const gradeAt = x => { for (const [a, z, i] of b.gradients) if (x >= a && x < z) return i; return b.gradients.length ? b.gradients[b.gradients.length - 1][2] : 0; };
  let slip = false, wsp = false, a = 0, R = 0, Fg = 0;
  const n = Math.max(1, Math.round(req.dt / H));
  for (let q = 0; q < n; q++) {
    const v = mem.v;
    // traction: maximum force, power and adhesion on the motored axles
    const fcap = Math.min(T.Fmax, T.Pw / Math.max(v, 1)) * k.traction_factor;
    const muT = mu * T.adh * T.m * G;
    let trac = c.traction * fcap;
    slip = trac > muT && c.traction > 0;
    if (slip) trac = muT;
    const rate = T.Fmax * 0.45 * H;
    mem.Ft += Math.max(-2 * rate, Math.min(rate, trac - mem.Ft));
    mem.Ft = Math.min(Math.max(mem.Ft, 0), Math.min(fcap, muT));
    // braking: service or emergency, limited by adhesion, with a first-order response
    let brk = (c.emergency ? ME * T.bEm : ME * T.bSvc * Math.min(1, Math.max(0, c.brake))) * k.brake_factor;
    const muB = mu * T.m * G * 0.95;
    wsp = brk > muB && v > 0.5;
    if (brk > muB) brk = muB;
    const tau = brk > mem.Fb ? T.tauB : T.tauR;
    mem.Fb += (brk - mem.Fb) * (1 - Math.exp(-H / Math.max(0.05, tau)));
    mem.Fed = v > 1.5 && !c.emergency ? Math.min(mem.Fb, T.edMax, T.Pw / Math.max(v, 1)) : 0;
    // average gradient under the train and Davis resistance
    const back = Math.max(0, mem.s - T.L);
    const i = mem.s - back > 1 ? rise(back, mem.s) / (mem.s - back) * 1000 : gradeAt(mem.s);
    Fg = T.m * G * i / 1000;
    R = v > 0.01 ? T.A + T.B * v + T.C * v * v : 0;
    const drive = mem.Ft - Fg;
    if (v < 0.01) { const opp = mem.Fb + T.A; if (drive > opp) a = (drive - opp) / ME; else { a = 0; mem.v = 0; } }
    else a = (drive - mem.Fb - R) / ME;
    mem.v = Math.max(0, mem.v + a * H);
    mem.s += mem.v * H;
    mem.eT += mem.Ft * mem.v * H / T.eta / 3.6e6;
    mem.eR += mem.Fed * mem.v * H * T.etaR / 3.6e6;
  }
  return {
    pos_m: mem.s, vel_ms: mem.v, acc_ms2: a, slip, wsp,
    forces_kN: { traction: mem.Ft / 1000, brake: mem.Fb / 1000, electric_brake: mem.Fed / 1000, resistance: R / 1000, gradient: Fg / 1000 },
    traction_energy_kWh: mem.eT, regenerated_energy_kWh: mem.eR,
  };
}

if (typeof module !== 'undefined') module.exports = { dynamics };
