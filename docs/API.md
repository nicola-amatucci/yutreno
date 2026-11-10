# Controller API (version 3)

## Lockstep operation

Simulator and controller run in lockstep. At every control period the simulator sends an observation and stops until it receives the command. The period goes from 0.1 to 1 s of simulated time; the default is 0.2 s. The results do not depend on response times: the same controller on the same line produces the same data in the browser, in Node and via WebSocket.

The controller can be connected in three ways:

- **In the browser.** JavaScript code that defines `function control(obs, mem)` and runs in a Web Worker. `mem` is an object that persists from one step to the next.
- **Headless.** `npm run headless -- --controller file.js` loads the same format in a Node `vm` context.
- **External, via WebSocket.** The controller is the server and the simulator connects as a client, be it the page opened locally or `npm run headless -- --controller ws://host:port`. At every period the simulator sends a JSON observation message and waits for a JSON command message. In the page published as an artifact the network is blocked: for WebSocket use the local page.

In the interface the controller is released after its third answer missing for more than 1.5 s (each time the last command is kept), or if the driver touches the lever.

## Versions

| Version | Names | Content | How to get it |
| :-- | :-- | :-- | :-- |
| 3 (default) | English | everything below, including `etcs_ato` | default |
| 2 | Italian (0.x) | the same content as version 3 with the Italian names of version 0.x | JavaScript controllers that define `controllo` instead of `control`; `--api 2`; `observe(period, 2)` |
| 1 | Italian (0.x) | version 2 without `etcs_ato` | `--api 1`; `observe(period, 1)`; `runLockstep(..., { api: 1 })` |

Versions 2 and 3 have the same fields in the same order: version 2 is version 3 passed through `toLegacy(obs, 'observation')`, and `toEnglish` gives version 3 back (`scripts/verify-ato-s130.ts` checks both directions). Commands are accepted with either names: `{ "trazione": 1 }` and `{ "traction": 1 }` are the same command. The glossary of the names is in `src/core/legacy.ts`.

## Observation

Quantities are in SI units; positions are chainages from the origin of the line and refer to the head of the train. The complete type is `Observation` in `src/core/types.ts`.

| Field | Content |
| :-- | :-- |
| `version` | 3 |
| `train_id` | identifier of the observed train, present only when the scenario has service trains (`train` for the controlled one) |
| `t`, `dt` | simulated time and control period (s) |
| `pos_m`, `vel_ms`, `acc_ms2` | position, speed, acceleration |
| `traction`, `brake`, `lever` | current commands (0–1) and equivalent lever position (−8…10) |
| `forces_kN` | `traction`, `brake`, `electric_brake`, `resistance`, `gradient` |
| `signalling` | `ETCS` or `BACC` (automatic block with SCMT) |
| `supervision` | `state` (NOR, IND, OVS, WAR, SBI, INT), `v_permitted_ms`, `v_warning_ms`, `v_intervention_ms`, `v_mrsp_ms`, `target` {`distance_m`, `speed_ms`, `type`} |
| `ma` | ETCS only: `eoa_m`, `svl_m`, `v_release_ms`, `reason` |
| `signal` | automatic block only: next signal {`id`, `pos_m`, `aspect` green/yellow/red} |
| `speed_profile` | `[from_m, to_m, v_ms]` for the next 8 km |
| `gradient_profile` | `[from_m, to_m, permille]` for the next 8 km |
| `current_gradient_permille` | average gradient under the train |
| `next_stop` | {`name`, `pos_m`, `arrival_s`, `departure_s`} or `null` |
| `doors_open`, `emergency`, `vigilance_alarm` | onboard states |
| `slip`, `wsp` | the requested traction or braking exceeds adhesion |
| `radio_ok` | radio connection with the RBC (always `true` with the automatic block) |
| `speed_restrictions` | active temporary speed restrictions: `[from_m, to_m, v_ms]`, already included in `speed_profile` |
| `adhesion_mu` | nominal rail adhesion; the reduced adhesion zones of the scenarios are not known onboard |
| `model` | dynamics model: `multimass`, `point` or `external` |
| `onboard` | ETCS supervision in use (`type`: `internal`, `reference`, `external`); with a message-based onboard also the mode (`FS`, `SB`, `TR`, `PT`) and the reference balise group (`lrbg`) |
| `tail_speed_ms`, `jerk_ms3` | speed of the last vehicle and filtered jerk at the head |
| `coupler_forces_kN` | coupler forces from head to tail, positive in tension; empty with the point mass |
| `line`, `train` | name and length of the line; parameters of the train model |
| `events` | announced events since the last step: {`t`, `type`, `text`}; `type` is INFO, WARN, EMG, VIG, STOP, SIG, CTL or FAULT |
| `etcs_ato` | onboard data for ATO, see below; `null` with the automatic block and outside full supervision |

## Onboard data for ATO (Subset-130)

In the ATO over ETCS architecture the ETCS onboard passes to the onboard ATO, every 200 ms, what it is supervising: Subset-130 defines it in packets 6 (ETCS_ATO_Dynamic) and 11 (ETCS_ATO_BRAKE_DECELERATIONS). `etcs_ato` carries those data with the names of the specification. The units are SI instead of cm, cm/s and mm/s², and the positions are line chainages like `pos_m` instead of readings of the onboard location counter. As in the specification, the data exist only in full supervision (FS).

| Field | Content |
| :-- | :-- |
| `M_MODE` | ETCS mode (`FS`) |
| `V_EST`, `A_EST` | estimated speed and acceleration |
| `V_PERMITTED` | permitted speed at the current location (the same as `supervision.v_permitted_ms`) |
| `V_MRSP`, `MRSP` | current MRSP and its changes ahead of the train, `[N_LOC_MRSP, V_MRSP]`; an increase applies from when the tail has cleared the stretch |
| `N_LOC_EBI` | estimated head location where, keeping the current speed, emergency braking would be triggered; `null` if no intervention limit is supervised, for example at standstill |
| `N_LOC_EOALOA`, `V_EOALOA`, `N_LOC_SVL` | end of authority, speed allowed there (0) and danger point |
| `V_RELEASE_ATO` | supervised release speed; `null` if the authority reaches the end of the line |
| `A_BRAKE_SAFE` | safe deceleration of the emergency brake, without the gradient contribution (m/s²) |
| `GRADIENT` | deceleration due to the gradient, positive uphill: `[N_LOC_GRADCHANGE, A_GRADIENT]` |
| `T_TRACTION`, `T_BE_REACT` | time during which traction remains after the emergency command and reaction time of the emergency brake (s) |
| `L_UNCERTAINTY_OVERREADING`, `L_UNCERTAINTY_UNDERREADING` | location uncertainty (m) |

All three onboards provide these data, each from its own computations:
- **the internal supervision** derives them from its simplified curves;
- **the reference onboard** solves the EBD curve backwards on the gradient down to the current speed and subtracts the distance run during the reaction times;
- **an external onboard** provides them in the optional field `dmi.ato` of its response ([ONBOARD_ETCS.md](ONBOARD_ETCS.md)). If it does not, `etcs_ato` contains only the speeds and `N_LOC_EBI` and `A_BRAKE_SAFE` are `null`.

`N_LOC_EBI` is the datum an ATO cannot derive by itself. `scripts/verify-ato-s130.ts` checks that it really is the point where the protection intervenes: a train at constant speed that never brakes is stopped within 1.3 m of the announced point. `scripts/verify-subset026.ts` checks it against the closed form d_EBD(v) − v·T_be on level track.

`examples/ato_s130.js` is an ATO that uses these data. It plans braking with its own curve and with the intervention curve rebuilt from `A_BRAKE_SAFE`, `GRADIENT` and the reaction times, and brakes fully if it gets too close to `N_LOC_EBI`. In the page it is loaded with the *Subset-130 example* button of the controller tab. The comparison with the simple ATO is in [CAMPAIGN.md](CAMPAIGN.md).

## Command

| Field | Effect |
| :-- | :-- |
| `traction` | 0–1, fraction of the available effort |
| `brake` | 0–1, fraction of the service brake; above 0.01 it cuts traction |
| `lever` | as an alternative to the previous two: −8 emergency, −7…−1 braking, 0 neutral, 1…10 traction |
| `vigilance` | `true` to acknowledge the vigilance (55 s cycle, 5 s to respond) |
| `emergency` | `true` for emergency braking |
| `note` | text to write in the event log |

Omitted fields leave the previous command unchanged.

## External dynamics

This API is that of the controllers, that is of whoever drives the train. The train dynamics can instead be replaced by an external model, for example in MATLAB/Simulink, through a second channel with its own protocol: it is described in [EXTERNAL_DYNAMICS.md](EXTERNAL_DYNAMICS.md). The two channels can also be used together, with a controller driving a train whose dynamics is computed outside the engine.

## External ETCS onboard

The onboard ETCS supervision can also be handed over to an external computer, with Subset-026 balises and messages. The protocol is in [ONBOARD_ETCS.md](ONBOARD_ETCS.md). A controller driving a train with an external onboard sees in the observation the supervision computed by that onboard.

## Using the core from TypeScript

```ts
import { DEFAULT_SCENARIO, LINE_PRESETS, TRAIN_PRESETS, Simulation, clone, runLockstep } from './src/core';

const sim = new Simulation(clone(LINE_PRESETS['valle-lauro']), clone(TRAIN_PRESETS.regional), { ...DEFAULT_SCENARIO, sig: 'ETCS' });
await runLockstep(sim, obs => ({ traction: obs.vel_ms < 20 ? 1 : 0 }), { period: 0.2 });
console.log(sim.summary());   // also contains outcome and checks of the verdict
console.log(sim.csv());
```

## Scenarios

The constructor accepts a scenario as fourth argument (`ScenarioDef`, see [SCENARIOS.md](SCENARIOS.md)); `resolveScenario(def)` derives line, train and conditions, `sim.verdict()` returns outcome and checks. With service trains, `sim.trains` lists every train (`TrainRun`, the controlled one first), `sim.done` is true when all have finished, `sim.timetable()` gives the planned and realised timetable, and `observe`, `summary`, `csv` and `verdict` accept the train as last argument. The CSV header is `CSV_HEADER` in `src/core/simulation.ts`: besides position, speed, supervision curves, commands, forces, adhesion (`mu`, the effective one under the train), altitude and energy it has the columns `radio`, `tail_speed_kmh`, `max_coupler_tension_kN`, `max_coupler_compression_kN`, `jerk_ms3`, `onboard_mode` and `lrbg`.

## Line format

The JSON of a line (`LineDef` in `src/core/types.ts`) contains:

- `plan`: vertices [x, y] in metres, fitted with a spline;
- `profile`: vertices [chainage, altitude];
- `stations`: objects {`name`, `s`, `arr`, `dep`};
- `limits`: triples [from, to, km/h];
- `tunnels`: pairs [from, to];
- `block`: length of the block sections;
- `geo` (optional): WGS84 position of the plan origin and rotation of its x axis, for the open data feeds;
- `attribution` (optional, imported lines): the attribution the sources of the data require, for example the ODbL of OpenStreetMap;
- `fitLen` (built-in lines): the length the alignment is scaled to;
- `freight`: the train ahead, a freight train that stands on the line when the run starts: `on`, head position `s0`, maximum speed `vmax` (km/h), stop `stopAt` (m, 0 = none) of `wait` seconds, length `len`, and optionally `train`, the id of a built-in train or its parameters ([MODEL.md](MODEL.md#vigilance-stops-and-the-train-ahead)).

It is exported and imported from the *Line* tab and passed to the headless execution with `--line file.json`.
