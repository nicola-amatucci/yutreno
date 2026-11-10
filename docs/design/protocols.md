# Protocols

## Purpose

YuTreno talks to five kinds of program it does not control: controllers (who drive), dynamics models (how the train moves), onboard computers (how it is protected), tracksides (where the authority comes from) and regulators (which train goes first when the timetable no longer holds). Each has a protocol with the same shape: the engine sends a JSON request at a fixed period and stops until the JSON response arrives. This document describes what they share; the details are in [API.md](../API.md), [EXTERNAL_DYNAMICS.md](../EXTERNAL_DYNAMICS.md), [ONBOARD_ETCS.md](../ONBOARD_ETCS.md), [TRACKSIDE.md](../TRACKSIDE.md) and [REGULATOR.md](../REGULATOR.md).

## Overview

| Channel | Request | Response | Period | Version | Providers |
| :-- | :-- | :-- | :-- | :-- | :-- |
| Controller | `Observation` | `Command` | 0.1–1 s (default 0.2) | 3 (2 and 1 Italian) | JS `control(obs, mem)`, WebSocket server |
| Dynamics | `DynamicsRequest` | `DynamicsResponse` | `external.period_s` (default 0.05) | 2 (1 Italian) | JS `dynamics(req, mem)`, `exec:`, TCP, WebSocket |
| Onboard | `OnboardRequest` | `OnboardResponse` | `onboard_period_s` (default 0.1) | 2 (1 Italian) | in-process `ReferenceEvc`, JS `onboard(req, mem)`, `exec:`, TCP, WebSocket |
| Trackside | `TracksideRequest` | `TracksideResponse` | `trackside_period_s` (default 0.1) | 2 (1 Italian) | in-process `Trackside`, `exec:`, TCP, WebSocket |
| Regulator | `RegulatorRequest` | `RegulatorResponse` | `regulator_period_s` (default 5) | 1 | in-process `ReferenceRegulator`, `exec:`, TCP, WebSocket |

On the engine side, each channel has its module since phase 8: the dynamics in `src/core/dynamics.ts`, the onboard in `src/core/onboard-bridge.ts` (request, response, the in-process reference onboard and the temporary speed restrictions in the chainages of a corridor), the trackside in `src/core/trackside-bridge.ts`, the regulator in `src/core/regulator-bridge.ts`. `Simulation` keeps the methods `…Due`, `…Request` and `…Response` of every channel, which call these modules.

All types are in `src/core/types.ts` (`src/trackside/types.ts` for the trackside). Fields added for several trains are optional, as the rule wants: the trackside `configuration.trains` (timetables per `NID_ENGINE`) and `parameters.conflict_rule`, `NID_ENGINE` on radio messages to trains other than the controlled one, `engine` on the emergency stop commands, `sessions` in the panel. A trackside that ignores them still serves a single train. The same holds for several RBCs: `configuration.rbcs`, `NID_RBC` on radio messages in both directions, the command `rbc_link`, `rbcs` and `rbc_link` in the panel and `NID_RBC` on its authority and sessions; a trackside with one RBC ignores them, and an onboard that receives no `NID_RBC` works as before. `train.integrity` in the onboard request is sent only after an `integrity_loss` event, so the requests of every other run are unchanged; likewise the odometry carries an error only after an `odometry_drift` event (`odometerReading` in `onboard-bridge.ts`).

## Common rules

- **Lockstep.** The engine stops at every exchange and resumes only with the response; `*Due()` says when an exchange is due, `step()` refuses to advance without it. Results do not depend on timing.
- **First request.** `start: true` carries the static data (train parameters, train data and national values, trackside configuration); the following requests carry only what changes.
- **Names.** English, with the names of the standards where one exists: Subset-026 variables in packets and messages, Subset-130 names in `etcs_ato`, EULYNX names in telegrams.
- **Compatibility.** Responses are passed through `toEnglish`, so a program of version 0.x can answer with Italian names. With `--protocol 1` (or `legacyProvider(call, kind)`) requests are sent in the Italian format of version 0.x through `toLegacy`. The controller observation has versions 1 and 2 with the Italian names; a JavaScript controller defining `controllo` receives version 2.
- **Evolution.** Fields are never renamed; new fields are optional, and new response fields must be ignorable by the engine when absent.
- **Errors.** A response without its mandatory fields stops the run with an error naming the time and the missing fields.

## Transports

`openChannel(spec)` in `src/server/headless.ts` returns a `Channel` for `exec:command` (one JSON line per message on stdin/stdout; stderr goes to the console; stdin closes at the end of the run), `tcp://host:port` (JSON lines, the program listens) and `ws://host:port` (one JSON message per frame, the program listens). `loadJsController`, `loadJsDynamics`, `loadJsOnboard` load JavaScript files in a `vm` context. In the browser only WebSocket exists: `src/server/bridge.ts` takes the page to TCP or to a process.

## Ordering within a step

When several channels are due at the same step the order is: controller (at its period, before the step), regulator, trackside after the in-process onboard (so the trackside sees the messages of the same cycle), onboard, dynamics. `runLockstep()` in `controller.ts` implements it; `exchangeTrackside`, `exchangeOnboard` and `exchangeDynamics` can be used to build other loops.

## Tests

Equivalence of in-process and external providers is checked for each channel: `verify-external-dynamics` (JS, TCP, process), `verify-onboard` and `verify-ato-s130` (onboard as process), `verify-trackside` (trackside as process), and the determinism section of the campaign. `scripts/verify-ato-s130.ts` checks the equivalence of observation versions through `toLegacy` and `toEnglish`.
