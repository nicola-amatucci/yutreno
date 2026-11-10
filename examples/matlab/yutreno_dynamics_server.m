function yutreno_dynamics_server(port, step)
%YUTRENO_DYNAMICS_SERVER Train dynamics model for YuTreno, listening on TCP.
%
%   yutreno_dynamics_server              % port 5555, example point mass
%   yutreno_dynamics_server(5555, @yutreno_step_simulink)   % your Simulink model
%
% Then, in a terminal in the YuTreno folder:
%   npm run headless -- --dynamics tcp://localhost:5555 --coupling 0.05
%
% The YuTreno engine connects as a client and, at every coupling interval, sends a JSON line (the request)
% and waits for a JSON line (the response). The format is described in docs/EXTERNAL_DYNAMICS.md.
%
% step is a function  [response, mem] = step(request, mem)  that advances the model by request.dt seconds
% with the inputs of the request and returns the state of the head of the train at the end of the interval.
% mem is the state of the model from one call to the next.
%
% Requires MATLAB R2021a or later (tcpserver, readline, writeline). It serves one run at a time; when a
% run ends it waits for the next one. Ctrl+C to quit.

if nargin < 1 || isempty(port), port = 5555; end
if nargin < 2 || isempty(step), step = @yutreno_step_point; end

srv = tcpserver("127.0.0.1", port, "Timeout", 3600);
configureTerminator(srv, "LF");
cleanup = onCleanup(@() delete(srv));
fprintf('Dynamics model listening on tcp://localhost:%d\n', port);

while true
    while ~srv.Connected
        pause(0.05);
    end
    mem = struct();
    n = 0;
    while srv.Connected
        if srv.NumBytesAvailable == 0
            pause(0.0005);
            continue
        end
        line = readline(srv);
        if strlength(line) == 0, continue, end
        request = jsondecode(line);
        [response, mem] = step(request, mem);
        writeline(srv, jsonencode(response));
        n = n + 1;
    end
    fprintf('Run finished after %d exchanges\n', n);
    flush(srv);
end
end
