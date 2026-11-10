function [r, mem] = yutreno_step_simulink(req, mem)
%YUTRENO_STEP_SIMULINK Advances a Simulink model by req.dt seconds for YuTreno.
%
%   yutreno_dynamics_server(5555, @yutreno_step_simulink)
%
% Template to adapt to your own model. It assumes a model 'train_dynamics' that:
%  - reads its inputs from workspace variables (Constant blocks):
%      u_traction, u_brake (0..1), u_emergency (0/1), mu (adhesion),
%      i_mean (average gradient under the train, ‰), radius (curve radius at the head, m; Inf on straight track),
%      tunnel (0/1), k_brake, k_traction (fault factors), and the train parameters in 'train';
%  - writes its outputs with To Workspace blocks (Array format): pos, vel, acc, Ft, Fb, R.
%
% Each interval is a simulation from req.t to req.t + req.dt restarting from the operating point saved at the end
% of the previous one. It is the simplest way to couple an existing model, but every call to sim costs time: Fast
% Restart helps, and a coupling interval of 0.1-0.2 s is advisable. For long runs see the alternatives in
% docs/EXTERNAL_DYNAMICS.md.

model = 'train_dynamics';
if req.start
    load_system(model);
    set_param(model, 'SaveFinalState', 'on', 'FinalStateName', 'xFinal', 'SaveOperatingPoint', 'on');
    set_param(model, 'FastRestart', 'on');
    mem = struct('op', [], 'train', req.train);
end

% inputs held constant over the interval (zero-order hold)
P = reshape(req.track.gradients, [], 3);
s = req.state.pos_m; back = max(0, s - mem.train.L);
in = Simulink.SimulationInput(model);
in = in.setVariable('u_traction', req.commands.traction);
in = in.setVariable('u_brake', req.commands.brake);
in = in.setVariable('u_emergency', double(req.commands.emergency));
in = in.setVariable('mu', req.track.adhesion_mu);
in = in.setVariable('i_mean', mean_gradient(P, back, s));
in = in.setVariable('radius', radius_at(reshape(req.track.curves, [], 3), s));
in = in.setVariable('tunnel', double(in_tunnel(reshape(req.track.tunnels, [], 2), s)));
in = in.setVariable('k_brake', req.faults.brake_factor);
in = in.setVariable('k_traction', req.faults.traction_factor);
in = in.setVariable('train', mem.train);
in = in.setModelParameter('StartTime', num2str(req.t, 17), 'StopTime', num2str(req.t + req.dt, 17));
if ~isempty(mem.op)
    in = in.setInitialState(mem.op);
end
out = sim(in);
mem.op = out.xFinal;

r = struct('pos_m', out.pos(end), 'vel_ms', out.vel(end), 'acc_ms2', out.acc(end), ...
    'forces_kN', struct('traction', out.Ft(end)/1000, 'brake', out.Fb(end)/1000, 'resistance', out.R(end)/1000));
end

function i = mean_gradient(P, x0, x1)
if isempty(P), i = 0; return, end
if x1 - x0 <= 1
    i = P(end, 3);
    for j = 1:size(P, 1), if x1 >= P(j,1) && x1 < P(j,2), i = P(j,3); end, end
    return
end
h = 0;
for j = 1:size(P, 1)
    lo = max(P(j,1), x0); hi = min(P(j,2), x1);
    if hi > lo, h = h + (hi - lo) * P(j,3) / 1000; end
end
i = h / (x1 - x0) * 1000;
end

function R = radius_at(C, x)
R = Inf;
for j = 1:size(C, 1), if x >= C(j,1) && x < C(j,2), R = C(j,3); end, end
end

function g = in_tunnel(T, x)
g = false;
for j = 1:size(T, 1), if x >= T(j,1) && x < T(j,2), g = true; end, end
end
