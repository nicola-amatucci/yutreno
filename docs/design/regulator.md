# Traffic regulator

## Purpose

Decide which train goes first, and when, once the timetable no longer holds: after a breakdown, a blocked line, a slow train. The regulator works on the plan (times, priorities, tracks, routes) and never on safety, which stays with the interlocking, the RBC and the onboard. Its protocol lets a research regulator (heuristic, optimisation model, agent) run against the same disruptions as the reference one. User documentation: [REGULATOR.md](../REGULATOR.md).

## Parts

- **`ReferenceRegulator`** (`src/regulator/index.ts`): the baseline, with four rules (priorities from faults, delay carried over the next stops, departure of a broken train moved and its set route cancelled, trains held before a blocked stretch) and the parameters of `REGULATOR_PARAMETERS`.
- **Engine side**: the request and the response in `src/core/regulator-bridge.ts`, called by the methods `regulatorDue()`, `regulatorRequest()` and `regulatorResponse()` of `Simulation`; the state `reg` of `Simulation`, typed `RegulatorState` in `src/core/run-state.ts`, and `regulatorCommand()`, which applies a decision and is shared with the dispatcher, in `src/core/commands.ts`. On every train: `plan`, the original timetable kept for delays and outputs, and `priority`.
- **Loop** (`controller.ts`): `exchangeRegulator()` and the option `regulator` of `runLockstep`; `--regulator` in the headless runner.
- **Examples**: `examples/regulator/regulator_stdio.ts` (the reference regulator as a process) and `regulator_example.py` (a minimal one in Python).

## Cycle

At t = 0 and then every `regulator_period_s` (default 5 s, a multiple of 5 ms) the engine builds the request from the trains (plan, current and realised timetable, position in line chainages, track in the station, faults, priority), the active scenario events and, with the interlocking, the routes of the last panel. The first request carries the configuration. The in-process regulator is called at the start of `step()`, after the onboard exchanges and before the trackside; the external one before the trackside exchange of the loop. Decisions are applied at once:

- `retime` changes `stations[i].arr/dep`; a service standing at the stop gets a new `doorDue`, and a service not yet appeared a new `appear`;
- `skip_stop` removes the stop from `stations` and `dwells`;
- `cancel` sets `cancelled`: a service not yet appeared is finished before appearing, one on the line loses the stops after the given station and finishes on arriving there (at once, if it stands there);
- `track` and `priority` set `tracks` and `priority`;
- `operator` goes to `tr.pendingCmd`.

With the interlocking, every change of timetable or track sends the `timetable` command for that engine, and every priority the `priority` command. Without the interlocking the effects come through the starting signals held until the departure (`heldSignals`), through `wanting`, and through the priority, which decides the consent of single-track sections before the timetable (`updateOrientation`).

## On a network

`regulatorNet()` describes a train on a network: its `route`, its `position`, the line of each stop, and `s_m`/`dir` on the main line when the route uses it, so that the rules written for a line (the blocked stretches are on the main line) keep working. `reroute()` gives a train not yet appeared a new itinerary: corridor recompiled, stops not on it removed, node routes rebuilt with their owners. The reference regulator adds rule 6 (release of a connection the feeder can no longer make) and rule 7 (reroute around a blocked stretch along the shortest other path of lines, found from the stations the configuration gives); rule 4 holds a train only if its route runs along the blocked stretch. `RG6`–`RG8` in `verify-regulator` check them, the last one with the regulator as an external program.

## Invariants

- `src/regulator/` imports only types from the engine.
- Without a regulator nothing changes: the request is never built, `plan` equals `stations`, and `timetable()` adds no field.
- The external reference regulator gives a run identical to the in-process one.
- A decision that cannot be applied is logged and skipped, never thrown: a regulator under test must not stop the run.

## Tests

`verify-regulator`:
- validation and protocol with a scripted regulator (cycle, skip_stop, retime, priority, invalid decisions logged, plan kept);
- breakdown in a station and at the departure with the interlocking;
- line blocked with automatic block, ETCS and the interlocking;
- the external regulator via `exec:`;
- determinism.

## Known limits and extensions

- Cancellation ends a train at a station and takes it off the line: no turnback into a return service, no connections between trains.
- No rerouting beyond the choice of track.
- The reference regulator does not optimise anything.
- Trains in both directions with the interlocking (phase 3b-2) would give the regulator crossings to choose.
