function [r, mem] = yutreno_step_point(req, mem)
%YUTRENO_STEP_POINT Point mass of YuTreno as an external model (reference).
% Advances req.dt seconds with internal steps of 5 ms. With --coupling 0.005 it reproduces
% the internal 'point' model. Replace this function with your own model.

G = 9.81; H = 1/200;
if req.start
    T = req.train;
    mem = struct('T', T, 'ME', T.m * T.rot, 's', req.state.pos_m, 'v', req.state.vel_ms, ...
                 'Ft', 0, 'Fb', 0, 'Fed', 0, 'eT', 0, 'eR', 0);
end
T = mem.T; ME = mem.ME; c = req.commands; k = req.faults;
% passengers on board (optional field payload_kg): they add to the mass and to the equivalent mass
if isfield(req, 'payload_kg') && ~isempty(req.payload_kg), T.m = T.m + req.payload_kg; ME = ME + req.payload_kg; end
mu = req.track.adhesion_mu;
P = reshape(req.track.gradients, [], 3);   % rows [from_m, to_m, gradient ‰]

slip = false; wsp = false; a = 0; R = 0; Fg = 0;
n = max(1, round(req.dt / H));
for q = 1:n
    v = mem.v;
    % traction: maximum force, power and adhesion on the motored axles
    fcap = min(T.Fmax, T.Pw / max(v, 1)) * k.traction_factor;
    muT = mu * T.adh * T.m * G;
    trac = c.traction * fcap;
    slip = trac > muT && c.traction > 0;
    if slip, trac = muT; end
    rate = T.Fmax * 0.45 * H;
    mem.Ft = mem.Ft + max(-2*rate, min(rate, trac - mem.Ft));
    mem.Ft = min(max(mem.Ft, 0), min(fcap, muT));
    % braking: service or emergency, limited by adhesion, first-order response
    if c.emergency, brk = ME * T.bEm; else, brk = ME * T.bSvc * min(1, max(0, c.brake)); end
    brk = brk * k.brake_factor;
    muB = mu * T.m * G * 0.95;
    wsp = brk > muB && v > 0.5;
    brk = min(brk, muB);
    if brk > mem.Fb, tau = T.tauB; else, tau = T.tauR; end
    mem.Fb = mem.Fb + (brk - mem.Fb) * (1 - exp(-H / max(0.05, tau)));
    if v > 1.5 && ~c.emergency, mem.Fed = min([mem.Fb, T.edMax, T.Pw / max(v, 1)]); else, mem.Fed = 0; end
    % average gradient under the train and Davis resistance
    back = max(0, mem.s - T.L);
    if mem.s - back > 1
        i = rise(P, back, mem.s) / (mem.s - back) * 1000;
    else
        i = gradient_at(P, mem.s);
    end
    Fg = T.m * G * i / 1000;
    if v > 0.01, R = T.A + T.B * v + T.C * v^2; else, R = 0; end
    drive = mem.Ft - Fg;
    if v < 0.01
        opp = mem.Fb + T.A;
        if drive > opp, a = (drive - opp) / ME; else, a = 0; mem.v = 0; end
    else
        a = (drive - mem.Fb - R) / ME;
    end
    mem.v = max(0, mem.v + a * H);
    mem.s = mem.s + mem.v * H;
    mem.eT = mem.eT + mem.Ft * mem.v * H / T.eta / 3.6e6;
    mem.eR = mem.eR + mem.Fed * mem.v * H * T.etaR / 3.6e6;
end

r = struct('pos_m', mem.s, 'vel_ms', mem.v, 'acc_ms2', a, 'slip', slip, 'wsp', wsp, ...
    'forces_kN', struct('traction', mem.Ft/1000, 'brake', mem.Fb/1000, 'electric_brake', mem.Fed/1000, ...
                        'resistance', R/1000, 'gradient', Fg/1000), ...
    'traction_energy_kWh', mem.eT, 'regenerated_energy_kWh', mem.eR);
end

function h = rise(P, x0, x1)
% height difference (m) between x0 and x1 from the list of gradients
h = 0;
for j = 1:size(P, 1)
    lo = max(P(j,1), x0); hi = min(P(j,2), x1);
    if hi > lo, h = h + (hi - lo) * P(j,3) / 1000; end
end
end

function i = gradient_at(P, x)
i = 0;
if isempty(P), return, end
i = P(end, 3);
for j = 1:size(P, 1)
    if x >= P(j,1) && x < P(j,2), i = P(j,3); return, end
end
end
