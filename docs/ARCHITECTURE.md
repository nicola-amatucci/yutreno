# Code architecture

This guide is for those who modify YuTreno. It explains how the parts are divided, how data flows during a run and where to work for the most common changes. To use the simulator the [user guide](GUIDE.md) is enough; to write a controller there is the [API](API.md). Each component has its own design document in [design/](design/README.md).

## One core, three ways to run it

The code is divided into layers. The boundary between them is the most important rule of the project.

`src/core/` contains the whole simulation: line compilation, built-in trains, signalling with the onboard supervision, dynamics, the reference onboard, the field of the interlocking trackside, scenarios and verdict. It imports nothing from the browser or from Node. This is why the same `Simulation` class runs in three places without changes: in the page, in the Web Worker that hosts a JavaScript controller and in the Node process of headless runs.

Since phase 8 the class `Simulation` (`simulation.ts`) is the conductor of the run: it holds the state (`run-state.ts`) and the order of the operations of a step, and gives every part of the work to a module that takes the run as its first argument:

| Module | What it does |
| :-- | :-- |
| `trains.ts` | creates the controlled train and the service trains, on a line or a network |
| `dynamics.ts` | the point-mass and multi-mass models, the external model, the commands that reach traction and brakes; `FIXED_DT` |
| `onboard-bridge.ts`, `trackside-bridge.ts`, `regulator-bridge.ts` | the exchanges with the ETCS onboard, the interlocking trackside and the regulator |
| `commands.ts` | the events of the scenario, the faults, the decisions of the regulator and the commands of the dispatcher |
| `traffic.ts` | authorities from the signals and, with `spacing: 'moving_block'`, from the confirmed rear end of the train ahead (`movingAuthority`), single-track orientation, node routes, appearance of the services, connections |
| `leader.ts` | the train ahead: the `freight` of the line as a freight service train, its stops, its timetable for the interlocking |
| `boarding.ts` | passengers at the stops of the trains |
| `outputs.ts`, `control-room.ts` | observation, CSV, results, verdict, realised timetable, summary, control room snapshot |

The public methods of `Simulation` did not change. The modules import from the class only its types, so there are no cycles between them, and every step of the move left the 234 runs of the golden master byte for byte the same.

`src/trackside/` contains the interlocking trackside: interlocking, RBC and control table. It imports nothing from the engine (only types and the compatibility layer), and the engine imports it.

`src/web/` is the interface. It reads the state of the simulation to draw it and sends it commands, but decides nothing physical or about signalling. If a behaviour of the train depends on a line of `src/web/`, it is in the wrong place.

`src/feeds/` turns a run into open data (GTFS, GTFS-Realtime, SIRI, NeTEx Italian profile, railML) and imports GTFS, NeTEx and railML timetables as service trains. Like the core it imports nothing from the browser or from Node, and it only reads the simulation ([design/feeds.md](design/feeds.md)).

`src/infra/` imports the real infrastructure: a line from an Overpass extract of OpenStreetMap and a RINF query result, with the provenance of every datum and an import report ([INFRA_IMPORT.md](INFRA_IMPORT.md)). Like the feeds it imports nothing from the browser or from Node; `src/server/import-infra.ts` is its command line (`npm run import-infra`).

`src/server/` contains the Node tools: `headless.ts`, which runs runs and scenario campaigns with a JavaScript or external controller, `bridge.ts`, which takes the page to external programs on TCP or as processes, `agent-env.ts` for external agents and `feeds-server.ts`, which serves the open data feeds of a run over HTTP.

Next to these, `src/docs/` generates the page describing the dynamics model. Its charts and laboratory call the core, so they must be checked again when the model changes.

## Names and compatibility

Up to version 0.1 every name in YuTreno was Italian; from version 0.2 the code, the formats and the protocols are in English, with the names of the standards where a standard exists (Subset-026 variables, EULYNX telegrams). `src/core/legacy.ts` keeps version 0.x working:

- `toEnglish(x)` translates keys and values of any input (scenarios, lines, trains, commands, responses of external programs, configurations saved in the browser) using the glossary `KEYS_IT_EN` and the value maps `VALUES_IT_EN`. It is applied where inputs enter the core: `validateScenario`, `resolveScenario`, `applyCommand`, `dynamicsResponse`, `onboardResponse`, `tracksideResponse`, `ReferenceEvc.step`, `Trackside.step`.
- `toLegacy(x, kind)` produces the Italian format of version 0.x for observations (versions 1 and 2), dynamics, onboard and trackside requests (protocol version 1), keeping the order of the keys.

New names go in the glossary only if a version 0.x format used the Italian one: a field born in English needs nothing.

## The run: fixed step and determinism

A run comes from four ingredients: the line definition, the train parameters, the conditions (signalling, time of day, weather, adhesion, onboard, trackside) and, optionally, a scenario. `compileLine()` turns the JSON line into a `CompiledLine` sampled every 10 m, with curvature, direction, altitudes, contiguous limits, stations, tunnels and signals generated from the stations and the block spacing. The `Simulation` constructor then prepares the consist (multi-mass or point mass), the train ahead and the initial state.

Time advances only with `step(FIXED_DT)`, in steps of 5 ms. At every step, in order:

1. the scenario events that trigger are applied;
2. the block updates signal aspects and movement authority (with several trains, the train ahead among them, from the occupation of all of them);
3. the onboard supervision computes curves and state;
4. the dynamics integrates the forces;
5. overruns, protection interventions, vigilance, stops and end of run are checked.

After every step whoever drives the loop calls `sample()`, which every half second adds a row to the run log (the CSV).

No part of the core uses the system clock or non-repeatable random numbers, so with the same ingredients and commands two runs produce byte by byte the same data. `verify-ato` and `verify-scenarios` check it by comparing the fingerprints of the CSVs. A change that breaks determinism is an error even if the train seems to behave well.

## Commands and controllers

The driver and the controllers talk to the simulation in the same way. `observe(period)` returns a read-only object with what can be seen in the cab: speed, position, DMI, signal, announced events. `applyCommand(command)` sets traction, brake, vigilance or emergency. The not announced events of a scenario, such as leaves or a degraded brake, never appear in the observation.

The observation has three versions ([API.md](API.md#versions)). Version 3, the default, has English names and contains `etcs_ato`: the data the onboard passes to ATO according to Subset-130 (`EtcsAtoData` in `types.ts`). `Simulation.etcsAto()` takes them from `atoData()` in `signalling.ts` with the internal supervision, or from the `dmi.ato` field of the response with a message-based onboard, converting odometer readings into line chainages. The computation happens only when a controller asks for the observation, so it costs nothing to runs without a controller. The reference onboard computes them at every cycle instead, as a real EVC would.

Controllers run in lockstep with the simulation. Every `period` seconds of simulated time the simulation stops, sends the observation and resumes only when the command arrives. So the result depends neither on the speed of the computer nor on network latency. In the core this loop is `runLockstep()` in `controller.ts`, used by headless runs. In the page the same scheme is in the loop of `main.ts`, which waits for the response of the Worker or of the WebSocket up to 1.5 s and stops the controller after three empty waits.

## External dynamics

With `model: 'external'` the dynamics is not computed by the core but by an external program, in co-simulation. `Simulation` keeps a state `ext` with the coupling interval and the last response. Whoever drives the loop asks `dynamicsDue()` before every step. When it is true, it sends `dynamicsRequest()` to the model and passes the response to `dynamicsResponse()`; then the 5 ms steps interpolate between the starting state and the received one. `step()` refuses to advance if the response is missing, so a badly written loop notices the error at once instead of producing wrong data.

There are three loops, as for the controllers: `runLockstep()` with the `dynamics` option for headless runs, `dynStep()` in `src/web/dynamics.ts` for the page, and the transports in `src/server/headless.ts` (`connectDynamics` for JSON-lines TCP and WebSocket, `spawnDynamics` for a child process on stdin/stdout, `loadJsDynamics` for a JavaScript model). `src/server/bridge.ts` is a minimal WebSocket server that takes the requests of the page to a model on TCP or to a process. The protocol is in [EXTERNAL_DYNAMICS.md](EXTERNAL_DYNAMICS.md).

## Message-based ETCS onboard

With `onboard: 'reference'` or `'external'` in the ETCS conditions, the supervision is no longer `supervise()` of `signalling.ts`. `Simulation` keeps a state `ob` with the balise groups (`buildBaliseGroups` in `simple-rbc.ts`), the message-based RBC (`Rbc`), the balises read, the pending messages and the last response of the onboard. At every step the RBC decides whether to speak, messages pass only with a working radio, and the balises passed by the head are queued with the odometer reading. At every onboard cycle `onboardRequest()` packs everything and `onboardResponse()` applies commands, messages for the RBC and the supervision to show.

The reference onboard (`ReferenceEvc` in `evc.ts`) is called inside `step()`. The external one is served by whoever drives the loop, with `onboardDue()`, exactly like the external dynamics. `evc.ts` imports nothing from the engine: it depends only on the protocol types and on the compatibility layer, and this guarantees that an external EVC can do everything it does. The protocol is in [ONBOARD_ETCS.md](ONBOARD_ETCS.md).

## Trackside with interlocking and RBC

With `trackside: 'interlocking'` or `'external'` (only ETCS with a message-based onboard) the authority no longer comes from the RBC of `simple-rbc.ts`. The engine keeps a state `tr` with the field (`Field` in `field.ts`: points, track circuits and branches taken by the trains), the onboard messages and control centre commands pending and the last panel. At every trackside cycle `tracksideRequest()` packs the EULYNX telegrams of the field, the radio messages and the commands; `tracksideResponse()` applies the commands to the elements, passes the radio messages to the onboard and keeps the panel. After the dynamics `field.step()` updates movements, branches and occupations.

The logic is in `src/trackside/`: the interlocking (`interlocking.ts`), the RBC (`rbc.ts`), the control table with the translator (`control-table.ts`) and the `Trackside` class (`index.ts`) that exposes them behind the protocol. Like `evc.ts`, `src/trackside/` imports nothing from the engine, which instead imports `../trackside`. The in-process trackside is called inside `step()`, after the in-process onboard; the external one is served by whoever drives the loop, with `tracksideDue()`, and `tracksideRequest()` makes the in-process onboard exchange first, so the order is always onboard then trackside. The protocol and the simplifications are in [TRACKSIDE.md](TRACKSIDE.md).

With `rbc_borders_m` in the scenario, `Simulation.rbcAreas()` turns the borders into the `rbcs` field of the trackside configuration and `Trackside` runs one `TracksideRbc` per area: the RBC/RBC messages stay inside the trackside, delivered one cycle later. On the engine side the only changes are `NID_RBC` on the radio messages, which the onboard bridge and the trackside bridge use to cut the radio of one RBC (`FaultState.radioRbc`), and the overruns counted only on the messages of the supervising RBC (the `NID_RBC` of the panel authority).

## Network

With `network` in the scenario the engine compiles a network (`src/core/network.ts`): lines that meet in the stations they share, the first one being the main line `L`. Every service has an itinerary, compiled into a corridor: a compiled line like `L`, so that the train advances in one dimension as on a single line, with legs that say which line and direction every stretch comes from. A corridor on one line is that line (or the mirrored one), the same object. At every step the engine computes the aspects of the signals of every line and direction in use, from the trains on that line (`onLine`), copies them onto the corridors of several lines and applies the node routes, which give the station of a node to one train at a time where trains join a line from another one. With the interlocking trackside every line has its own interlocking and field, and the node routes of the engine are replaced by the routes of the interlockings across the nodes. Without a network the network is `L` alone and nothing changes. See [design/network.md](design/network.md).

## Control room

`Simulation.controlRoom()` (`src/core/control-room.ts`) returns a snapshot of the traffic: lines with stations, signals and aspects, block sections and their occupation, single-track orientations, node routes and, with the interlocking, sections, points and routes; the trains with their position on every line, delay, next stop and status; the log. It only reads the run. The *Control room* tab draws it (`src/web/control-room.ts`), with the schematic laid out from the topology of the network, and the open data server serves it on `/control-room`. It is a public, versioned format that only grows with optional fields. See [CONTROL_ROOM.md](CONTROL_ROOM.md).

## Traffic regulator

With `regulator: 'reference'` or `'external'` the engine keeps a state `reg` and, at every regulator cycle (5 s by default), sends a `RegulatorRequest` with every train (plan, current timetable, realised times, position, faults, priority), the disruptions in force and, with the interlocking, the state of the routes. `regulatorResponse()` applies the decisions: `retime` changes the times of a stop in `run.stations` (the original timetable stays in `run.plan`), `skip_stop` removes a stop, `track` and `priority` set the track and the priority of a train, `operator` passes a control centre command to the interlocking. With the interlocking every change of timetable or priority goes to it as a control centre command (`timetable`, `priority`). The in-process regulator is called in `step()` before the trackside; the external one is served by whoever drives the loop, with `regulatorDue()`, before the trackside exchange, so the order is the same. The reference regulator is in `src/regulator/` and, like the trackside, imports only types. See [REGULATOR.md](REGULATOR.md).

## Passengers

With `passengers` in the scenario the simulation owns a `PassengerModel` (`src/core/passengers.ts`, [PASSENGERS.md](PASSENGERS.md)), a pure aggregate model of the platforms and of the people on board. The engine calls it only at three moments: when the doors of a train open (`paxOpen`: alighting, boarding, dwell needed, which goes into `S.paxDue` and holds the doors), when they close (`paxClose`: latecomers and passengers left behind) and when the controlled train leaves its origin. After each call `setPayload()` brings the mass of the people on board into `TR.m`, `ME` and, in the multi-mass model, the vehicles (`MultiState.pay`). Poisson arrivals are drawn from a seeded generator in the order of the calls, which the fixed step makes deterministic. Without passengers `pax` is null and none of this runs.

## The interface loop

`main.ts` calls `frame()` at every browser frame. The real time elapsed, multiplied by the chosen acceleration, accumulates; the simulation advances by as many fixed steps as fit in the accumulator, with a ceiling per frame. Then it draws.

Drawing is in two modules. `render.ts` works on 2D canvas: DMI, line diagram, distance-speed chart, coupler forces and the essential cab view. `view3d.ts` draws the 3D view with Three.js. The DMI is always drawn first, because its canvas is also the texture of the screen on the 3D cab desk.

`state.ts` collects the shared state of the interface: the configuration saved in the browser, the current simulation in `app.sim`, the shorthand references `S`, `L`, `TR`, `F` and the formatting functions. `store` wraps `localStorage` so that a page with storage blocked still works.

## The 3D view

`view3d.ts` (with its parts `world3d.ts`, `path3d.ts`, `trains3d.ts`, `cab3d.ts` and the shared state `view3d-state.ts`) builds the world once per run, starting from the compiled line, and rebuilds it only if line, signalling, train ahead or quality change. Everything is a deterministic function of the chainage `s` and of `hash()`, so the same line always produces the same landscape.

Coordinates follow the track: the Three.js x axis is the x of the plan, the z axis is the y with changed sign, the height is the altitude minus the starting one. `frame(s)` gives position, running direction and right at every point. `sweep()` extrudes a cross-section along the track, and from it come ballast, rails, platforms, shelters and tunnel vault. Sections must be described counter-clockwise looking in the running direction, with the right towards positive x, so that normals point outwards. The terrain is a ribbon three kilometres wide. Near the track it is low, it rises into embankments over the tunnels and far away becomes hills; at a tunnel mouth it opens into a cutting in front of the portal.

Repeated objects are instanced: sleepers, masts, trees, houses, tunnel lights. Sleepers are the only ones that move: a window of instances ahead of the train is relocated when the train advances by 30 cm.

The trains of the run, the driven one included, are built once as groups of cars (`buildServices()`) and placed every frame on the line the world draws (`placeServices()`). The camera rides in the cab of `viewTrain()`: the driven train, or the train chosen in *Ride in* while it runs. The world is built from one line of the network (`lineIdx`): the main line, or the line the ridden train's head is on, so it is rebuilt when that train passes onto another line, and the cars on the other lines are hidden; it stays a deterministic function of that compiled line. For a train running back the camera looks towards the origin from the second track in stations; the cab model is shown only in the driven train, and the train the camera is in is not drawn. The people waiting on the platforms are two instanced meshes with their places fixed when the world is built (`buildPeople()`); every frame `placePeople()` shows as many as `PassengerModel.waitingTo()` gives for each platform, a pure reading of the run.

The cab is a child group of the camera. It contains the inclined desk, the DMI, the brake pipe and brake cylinder gauges, the lever, the vigilance and emergency buttons, the lamps and the wiper. The gauges are indicative: the pressure in the brake pipe is not simulated, so the needle follows the braking command.

The three qualities change pixel density, shadows, view distance, number of sleepers and density of trees. If WebGL is not available `init3d()` returns false and the page stays on the 2D view.

## Build and checks

`scripts/build.mjs` bundles the interface with esbuild into `dist/app.js` and also produces `dist/yutreno.html`, a single file that opens with a double click, and `dist/artifact.html`, the same content without header for publishing. Separately it generates the model page `dist/model.html`. The example controllers `examples/ato.js` and `examples/ato_s130.js` enter the bundle as text, because the page shows them in the editor.

The screenshots in `docs/img/` are regenerated with `scripts/screenshots.mjs`, which opens the build with Playwright; the instructions are at the top of the file.

`npm run verify` runs every `scripts/verify-*.ts`, several at a time. The checks test the simulator, not the controllers. `npm run golden` keeps the fingerprints of 234 runs (`golden/fingerprints.json`): a change that should not alter the behaviour must leave them all unchanged, and one that alters it on purpose updates them in the same commit ([design/tools.md](design/tools.md)). If a change alters the physics on purpose, the reference values in `verify-ato.ts` are updated in the same commit; `PRINT_REF=1` prints them.

Tests that check a requirement carry a tag `// @test <id>: <title> [<requirement ids>]`. `scripts/traceability.ts` collects them into `docs/traceability/tests.csv` and fills the `tests` column of the matrix; `verify-traceability` fails if an implemented or simplified requirement has no test or if the files are not up to date.

## Frequent changes

**A new event type in the scenarios.** Add the type in `FaultType` and `FAULT_TYPES` (`scenario.ts`), the validation and the description in the same file and the effect in `applyFault()` (`commands.ts`). If the event is visible onboard it goes in `ANNOUNCED_BY_DEFAULT`. If version 0.x had an Italian name for it, add it to the value map of `legacy.ts`. Finally a test in `verify-scenarios.ts` and a row in the table of [SCENARIOS.md](SCENARIOS.md).

**A new scenario.** The file goes in `scenarios/` and in the list of `src/web/scenarios.ts`, and its outcome with `examples/ato.js` in `verify-scenarios.ts`. The step-by-step procedure is in [SCENARIO_GUIDE.md](SCENARIO_GUIDE.md).

**A new built-in line or train.** Add them in `presets.ts`. Several checks run the example controller on every built-in line: the references in `verify-ato.ts` and the length in `verify-line.ts` are needed.

**A new built-in network.** It goes in `NETWORK_PRESETS` (`presets.ts`), with its lines in the built-in lines; the nodes are the stations with the same name. A scenario on it goes in `scenarios/services/`, in `src/web/scenarios.ts` and in `verify-network.ts`.

**A new field in the request or response of the external dynamics.** Add it in `DynamicsRequest` or `DynamicsResponse` (`types.ts`) and in `dynamicsRequest()` or `dynamicsExternal()`, then in the examples (`examples/dynamics_point.js`, `python/yutreno_dynamics.py`, `matlab/`) and in [EXTERNAL_DYNAMICS.md](EXTERNAL_DYNAMICS.md). New response fields must be optional, because existing models do not send them.

**A new ETCS packet or message.** The RBC produces it in `Rbc.tick()` (`simple-rbc.ts`) and, with the interlocking trackside, in `TracksideRbc.cycle()` (`trackside/rbc.ts`), with the names of the Subset-026 variables and the iterations in `elements`. The reference onboard reads it in `ReferenceEvc.readRadio()`. It must be documented in [ONBOARD_ETCS.md](ONBOARD_ETCS.md), covered in `verify-onboard.ts` and in `verify-subset026.ts`, and the row of the matrix updated.

**A new field in the observation.** Add it in `Observation` (`types.ts`) and in `observe()` (`outputs.ts`), then in [API.md](API.md). Existing fields do not change name, because external controllers depend on them. Versions 1 and 2 (`observe(period, 1|2)`) are derived from version 3 by `toLegacy`: a new field enters version 3; if it must also appear in version 2 with an Italian name, add the name to the glossary.

**A new decision of the regulator.** It goes in `RegulatorCommand` (`types.ts`) as an optional variant, in `regulatorCommand()` of `commands.ts` with a clear reason when it cannot be applied, in [REGULATOR.md](REGULATOR.md) and in `verify-regulator.ts`; `examples/regulator/regulator_stdio.ts` must keep giving the same run as the in-process regulator.

**A new element or rule of the trackside.** The field is in `field.ts` (physics of the elements and EULYNX telegrams), the rules in `src/trackside/interlocking.ts` and `rbc.ts`. A new telegram goes in the types of `src/trackside/types.ts` with the names and codes of the EULYNX document, in the traceability matrix and in [TRACKSIDE.md](TRACKSIDE.md); a new test in `verify-trackside.ts`. New fields of the trackside protocol must be optional, and `examples/trackside/trackside_stdio.ts` must keep giving the same run as the in-process trackside.

**A new measure in the campaign.** Add it as a column in `runOne()` of `scripts/campaign.ts`, and possibly in the summary, then in [CAMPAIGN.md](CAMPAIGN.md). The columns of `runs.csv` must stay deterministic: no real times nor disk paths, which go in `metadata.json`.

**A new object in the 3D world.** It goes in `buildWorld()`, placed with `placeAt(object, s, d, h)`: chainage, lateral distance (positive to the right) and height above the rail plane. If it is repeated an `InstancedMesh` is advisable.

## Commit rules

Every commit contains a single logical block, with the files added one by one, and a message in the form `type(scope): summary`. Before committing `npm run typecheck` and `npm run verify` must pass. The complete rules are in `CLAUDE.md`.
