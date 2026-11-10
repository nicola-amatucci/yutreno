# Train dynamics from an external model

YuTreno can hand the train dynamics over to an external program: a MATLAB/Simulink model, a Python script, anything that can read and write JSON. The engine keeps taking care of the rest, that is line, signalling, ETCS or SCMT supervision, the train ahead, scenarios with their faults, stops, vigilance and verdict. From the external model it asks only where the train is and how fast it goes.

It is a co-simulation. Time is divided into coupling intervals, for example 50 ms. At the start of every interval the engine sends the model a request with the commands and the stretch of line around the train. The model integrates its equations up to the end of the interval and responds with the state reached. The engine then crosses the interval with 5 ms steps, interpolating between the starting state and the received one. At every step it checks signals, supervision curves, stops and overruns, as with the internal models.

## Why it works this way

The engine is the *master* of the co-simulation and the model is the *slave*, in FMI terminology. This choice has three consequences.

The first concerns the inputs: they stay constant over the interval (*zero-order hold*). If halfway through the interval the protection commands the emergency brake, the model receives it at the start of the next interval. With 50 ms the maximum delay is smaller than the dead time of the brake (2 s for the ETCS intervention curve), so it does not matter for the supervision. The interval can still be reduced down to 5 ms.

The second concerns determinism. The simulation stops at every exchange and restarts only with the response, so the result depends neither on the speed of the model nor on the network. If the model is deterministic, two equal runs give identical data.

The third is that the external model is the only source of the train state. The engine does not correct the received position or speed: it simply uses them.

## Request

At every interval the engine sends a JSON object like this one (the numbers are examples):

```json
{
  "type": "dynamics", "version": 2, "start": false,
  "t": 12.35, "dt": 0.05,
  "state": { "pos_m": 412.7, "vel_ms": 9.81 },
  "commands": { "traction": 0.6, "brake": 0, "emergency": false, "doors_open": false },
  "track": {
    "from_m": 252.7, "to_m": 912.7, "adhesion_mu": 0.3,
    "gradients": [[252.7, 1800, 0], [1800, 912.7, 6.4]],
    "curves": [[600, 830, 1210]],
    "tunnels": []
  },
  "faults": { "brake_factor": 1, "traction_factor": 1 }
}
```

`start` is true only in the first request of the run. That request also contains `train`, with all the parameters of the train of the *Train* tab: mass, Davis, power, brakes and, if present, the consist with the couplers. The model must reset itself and start from `state`.

`t` and `dt` are the start and the duration of the interval. `state` is the state returned by the previous response and is only a check: the model keeps its own.

`commands` contains what really reaches the train equipment, after the protection. In emergency traction is zero, brake is 1 and `emergency` is true. With braking commanded by ETCS or with the doors open traction is already zero.

`track` describes the line from `from_m`, 50 m behind the tail, to `to_m`, 500 m ahead of the head (the horizon is changed with `external.horizon_m`). Gradients are in per mille, positive uphill. Curves are the stretches with a radius below 20 km, rounded to 10 m; straight track does not appear. `adhesion_mu` is the real adhesion under the train, including the reduced adhesion zones of the scenarios, which the driver does not know.

`faults` carries the factors of the scenario faults (degraded brake, reduced traction). The model applies them to the forces; if it ignores them, those scenarios have no effect.

With passengers in the scenario ([PASSENGERS.md](PASSENGERS.md)) every request also carries `payload_kg`, the mass of the people on board, which changes at every stop; `train.m` is then the mass without passengers. The model adds `payload_kg` to the mass and to the equivalent mass (people do not rotate); the example models do. Without passengers the field is absent.

A model written for version 0.x expects the request with Italian names (`tipo`, `versione: 1`, `stato`, `comandi`, `binario`…): it receives it with `--protocol 1` in headless runs and in the bridge. Its response can use either names.

## Response

The model responds with the state of the head of the train at the end of the interval:

```json
{
  "pos_m": 413.2, "vel_ms": 9.83,
  "acc_ms2": 0.31,
  "forces_kN": { "traction": 98.1, "brake": 0, "electric_brake": 0, "resistance": 5.6, "gradient": 0 },
  "slip": false, "wsp": false,
  "tail_speed_ms": 9.80,
  "coupler_forces_kN": [12.1, 8.3, 4.0],
  "traction_energy_kWh": 1.42, "regenerated_energy_kWh": 0,
  "note": "optional text for the log"
}
```

Only `pos_m` and `vel_ms` are mandatory. The other fields feed the DMI, the forces panel, the CSV, the slip indicators and the criteria of the scenarios on coupler forces and jerk. Energies are cumulative from the start of the run; if they are missing, the engine estimates them from the forces. A response without numeric position or speed stops the run with an error.

## Connecting a model

**Headless runs.** It is the fastest way and the one suited to test campaigns:

```bash
npm run headless -- --dynamics tcp://localhost:5555 --coupling 0.05
npm run headless -- --dynamics ws://localhost:8766
npm run headless -- --dynamics examples/dynamics_point.js        # JavaScript model in the same process
npm run headless -- --dynamics "exec:octave-cli -q examples/octave/yutreno_dynamics.m"     # the engine starts Octave
npm run headless -- --dynamics "exec:python examples/python/yutreno_dynamics.py --stdio"   # the engine starts Python
npm run headless -- --scenario scenarios --dynamics tcp://localhost:5555   # all scenarios with your model
```

`--dynamics` switches the train to the `external` model; all the other options stay valid, including controllers and scenarios. With `tcp://` every message is a line of JSON terminated by a newline, the simplest format for MATLAB. The engine is the client and the model must already be listening.

**In the page.** In the *Train* tab choose the computation model *External via API*, the WebSocket address and the coupling interval, then *Apply and restart*. The browser speaks only WebSocket, so a model on TCP needs the bridge:

```bash
npm run bridge -- --tcp localhost:5555                  # page → ws://localhost:8766 → MATLAB on TCP
npm run bridge -- --model examples/dynamics_point.js    # the bridge responds with a JavaScript model
npm run bridge -- --exec "octave-cli -q examples/octave/yutreno_dynamics.m"   # one Octave process per run
```

The page must be opened locally (`npm run dev` or `dist/yutreno.html`), because the published one blocks network connections. The connection state appears above the cab view. The page makes at most one exchange per frame, that is about 60 per second, so a 50 ms coupling keeps real time up to about three times the normal speed.

## Process started by the engine

With `exec:` no server is needed. The engine starts the given command and talks to it on the standard streams: it writes every request on stdin as a line of JSON and reads every response from stdout, again one line. When the run ends it closes stdin, and the model terminates at the first empty read. The stderr of the model appears on the engine console: it is the channel for messages and diagnostics. stdout instead is reserved to the protocol, and any print would break it.

It is the simplest connection for interpreted languages, because a read and write loop is enough and no network libraries are needed. It works the same way on Windows, macOS and Linux, provided the command can be reached from the terminal.

## Python

`examples/python/yutreno_dynamics.py` contains the YuTreno point mass written in Python with the standard library only. The function `step(req, mem)` is the one to replace with your own model, for example with a SciPy integrator or a neural network. The script connects in two ways:

```bash
npm run headless -- --dynamics "exec:python examples/python/yutreno_dynamics.py --stdio"   # started by the engine
python examples/python/yutreno_dynamics.py 5555                                            # TCP server, then:
npm run headless -- --dynamics tcp://localhost:5555
```

The TCP server is useful when the model must stay up between runs, or run on another machine.

## Octave

`examples/octave/yutreno_dynamics.m` is the script for GNU Octave, from version 7, which has `jsondecode` and `jsonencode` without additional packages. It reads the requests from stdin and uses the same step function as the MATLAB version (`examples/matlab/yutreno_step_point.m`), so a model written for one works with the other too. To use your own just change the line `step = @yutreno_step_point;`.

```bash
npm run headless -- --dynamics "exec:octave-cli -q examples/octave/yutreno_dynamics.m"
npm run bridge -- --exec "octave-cli -q examples/octave/yutreno_dynamics.m"     # for the page
```

On Windows `octave-cli` is in the `bin` folder of the Octave installation; if it is not in the PATH, write the full path inside the quotes. With the example point mass, the test run (almost a quarter of an hour simulated, 17,500 exchanges) takes about half a minute and gives the same results as the JavaScript model. Octave interprets loops more slowly than Python: with a heavier model a wider coupling is advisable, for example `--coupling 0.1`, or writing the model in vector form.

A technical detail, useful for those writing their own script: on a pipe Octave's `fgetl(stdin)` waits for the next line before returning the current one, and the lockstep exchange would block. The script therefore uses `input('', 's')`, which returns the line as soon as it arrives.

## MATLAB and Simulink

`examples/matlab/` contains three files.

`yutreno_dynamics_server.m` makes MATLAB listen on TCP with `tcpserver`, from R2021a on. For every line received it decodes it with `jsondecode`, calls the step function and responds with `jsonencode`:

```matlab
yutreno_dynamics_server(5555)                              % example point mass
yutreno_dynamics_server(5555, @yutreno_step_simulink)      % your Simulink model
```

`yutreno_step_point.m` is the YuTreno point mass rewritten in MATLAB. It is the function to replace: it receives the request and the state of the model and returns the response and the updated state.

`yutreno_step_simulink.m` is the template for an existing Simulink model. Every interval is a call to `sim` from `t` to `t + dt`, restarting from the *operating point* saved at the end of the previous one. The inputs pass as workspace variables and the outputs come back with *To Workspace* blocks. It is the simplest connection, but every call to `sim` has a fixed cost even with Fast Restart, and a quarter-hour run at 50 ms makes about 17,500 exchanges. To work comfortably a coupling of 0.1–0.2 s is advisable, or one of the faster ways:

- translate the model into a MATLAB function (or generate its code) and call it directly from the step function, without `sim`;
- run the Simulink model for the whole run, with TCP communication blocks that synchronise with YuTreno at every coupling step;
- export the model as an FMU for co-simulation (FMI 2.0). Reading FMUs directly in the engine is a possible development for YuTreno: the protocol described here already follows the FMI `doStep` cycle.

The MATLAB server has not been tested in MATLAB, because it is not available here. The step function `yutreno_step_point.m` is however the same used by the Octave example, tested on complete runs. The TCP protocol is tested with the Python example and in the checks.

## Checks

`scripts/verify-external-dynamics.ts` checks that the point mass rewritten as an external model (`examples/dynamics_point.js`) reproduces the internal model on all lines and signalling systems. With a 5 ms coupling the results match to the hundredth: arrival times, energy and stop errors. With 50 ms the arrival moves by a few hundredths of a second and the energy by less than 0.1%. The check also verifies determinism, the refusal to advance without a response and the content of the requests. Finally it tests the two JSON-lines transports, TCP and process on stdin/stdout, which must give the same data as the direct call.

The external point mass is also the best starting point for a new model. Change one part at a time and compare the run with that of the internal model, with the same scenarios and the same controller.
