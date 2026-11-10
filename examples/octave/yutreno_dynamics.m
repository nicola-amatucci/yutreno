% YUTRENO_DYNAMICS  Train dynamics model for YuTreno in GNU Octave (7 or later).
%
% The engine starts this script and talks to it on stdin/stdout, one JSON line per message,
% without network and without additional packages:
%
%   npm run headless -- --dynamics "exec:octave-cli -q examples/octave/yutreno_dynamics.m"
%   npm run bridge -- --exec "octave-cli -q examples/octave/yutreno_dynamics.m"     (from the page)
%
% The step function is the same as the MATLAB version (examples/matlab/yutreno_step_point.m):
% to use your own model just change the variable step below.
% Beware: stdout is the channel to the engine. Messages and diagnostics go to stderr,
% with fprintf(stderr, ...); any disp() would break the protocol.

1;  % script file, not a function file
here = fileparts(mfilename('fullpath'));
addpath(fullfile(here, '..', 'matlab'));
step = @yutreno_step_point;

mem = struct();
n = 0;
fprintf(stderr, 'Octave: dynamics model ready (%s)\n', func2str(step));
while true
  % input reads a line as soon as it arrives; fgetl(stdin) on a pipe would wait for the next line
  % and block the lockstep exchange. When stdin closes (end of the run) input raises an error.
  try
    line = input('', 's');
  catch
    break
  end
  if isempty(strtrim(line)), continue; end
  request = jsondecode(line);
  [response, mem] = step(request, mem);
  fprintf(stdout, '%s\n', jsonencode(response));
  fflush(stdout);
  n = n + 1;
end
fprintf(stderr, 'Octave: run finished after %d exchanges\n', n);
