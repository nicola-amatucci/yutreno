# What YuTreno can do

YuTreno is a train driving and railway operations simulator for research and teaching. This document lists everything it can do, by category, with the place where each function is described in detail. It ends with what YuTreno does not do, a summary of its structure, a map of the documentation and the references it draws on. It is meant for three readers: whoever uses the simulator, whoever develops it, and whoever writes about it.

State on 8 November 2026. The numbers below (lines, scenarios, checks) are those of the repository on that date.

## At a glance

| Category | In one sentence |
| :-- | :-- |
| [Driving and the cab](#1-driving-and-the-cab) | A 3D cab in the browser, with DMI, lever, vigilance and emergency, driven by hand or by a program. |
| [Lines, trains and dynamics](#2-lines-trains-and-dynamics) | Lines drawn or imported, trains as chains of vehicles with couplers, or as a point mass. |
| [Signalling and train protection](#3-signalling-and-train-protection) | ETCS level 2 with three kinds of onboard and the moving block as an option, the automatic block with SCMT, and an interlocking trackside with EULYNX telegrams. |
| [Automatic driving](#4-automatic-driving) | Controllers in any language, two reference ATOs, the Subset-130 data, agents and an environment for reinforcement learning. |
| [Scenarios, faults and verdict](#5-scenarios-faults-and-verdict) | Sixteen kinds of event, announced or hidden, and a verdict with criteria. |
| [Traffic](#6-traffic) | Service trains with a timetable in both directions, networks, a traffic regulator, a dispatcher and a control room. |
| [Passengers](#7-passengers) | Origin–destination demand, boarding and alighting, dwell, capacity and mass on board. |
| [Real infrastructure and timetables](#8-real-infrastructure-and-timetables) | Lines imported from OpenStreetMap, RINF and a terrain model; timetables imported from GTFS, NeTEx and railML. |
| [Open data](#9-open-data) | A run published as GTFS, GTFS-Realtime, SIRI, NeTEx (Italian profile) and railML. |
| [External programs](#10-external-programs-and-co-simulation) | Dynamics, onboard, trackside, regulator, controller and agents as external programs, on public protocols. |
| [Measurement and reproducibility](#11-measurement-and-reproducibility) | Bit-for-bit determinism, measurement campaigns with fingerprints, golden masters, 23 checks and a requirement matrix. |
| [Teaching](#12-teaching) | A page that explains the dynamics model with equations, checks and a laboratory. |
| [Ways to run it](#13-ways-to-run-it) | In the browser, headless, from TypeScript, behind a bridge or in Docker. |

## 1. Driving and the cab

The view is from the cab, in 3D, built from the line: curves, gradients, tunnels with portals, stations with platforms, shelters and footbridge, catenary, kilometre posts, signals or marker boards, the trains of the run. Light, fog and rain change with the time of day and the weather. A lighter 2D view stays available, also without WebGL.

- **Controls.** A lever with ten traction steps, neutral, seven service braking steps and emergency; vigilance every 55 s with 5 s to acknowledge; doors held at stations until the timetabled departure. Keyboard, gamepad, USB lever with calibration, touch buttons. [GUIDE.md](GUIDE.md)
- **DMI and gauges.** The DMI with permitted speed, target distance and supervision curves; brake pipe and brake cylinder gauges; lamps for vigilance, doors, wheel slip and emergency.
- **Ride in another train.** The camera can ride in the cab of any train of the run, on any line of a network, also running back.
- **Run data.** Stops with their error, event log, a CSV with one row every half second (position, speed, curves, commands, forces, adhesion, energy, couplers, onboard mode), the final report with the verdict.
- **Accessibility.** Reduced motion is respected; three graphics qualities.

## 2. Lines, trains and dynamics

- **Built-in lines.** Valle Lauro – Monte Clanio (15.3 km, four stations), the Appennino pass (18.5 km, up to 25 ‰), the branch San Felice Scalo – Rocca Sabato (9.6 km) and the link Ponte Sabato – Pietrarsa; two built-in networks made of them. Every line has a freight train ahead that can be switched on or off.
- **Line editor.** Plan by dragging vertices, altitude profile, stations and timetable, speed limits, tunnels; library in the browser, export and import as JSON. [GUIDE.md](GUIDE.md#lines-and-trains), [API.md](API.md#line-format)
- **Generated signalling.** Starting, home and intermediate signals from the stations and the block length; balise groups for ETCS; on single track, a track for each direction in every station. [MODEL.md](MODEL.md)
- **Built-in trains.** A regional EMU of four cars, a high-speed train of eight cars and a heavy freight train, all editable: masses, effort and power, Davis resistance, brakes, consist and couplers. [GUIDE.md](GUIDE.md#lines-and-trains)
- **Multi-mass model.** Every vehicle and every coupler, with spring, damper and slack; traction split on the motored vehicles and limited by adhesion that falls with speed; Davis resistance distributed along the train, curve resistance, gradient under every vehicle, tunnel factor; pneumatic brake propagating along the train or electro-pneumatic; electric braking with regeneration; wheel slip and anti-skid. [MODEL.md](MODEL.md), [design/dynamics.md](design/dynamics.md)
- **Point mass.** The same forces on one mass, for teaching.
- **Adhesion and weather.** Dry, wet or leaves, from the weather or chosen; zones of reduced adhesion in the scenarios.
- **Energy.** Traction and regenerated energy for every train; energy per passenger-km with passengers.

## 3. Signalling and train protection

The same line runs with ERTMS/ETCS level 2 or with the Italian automatic block protected by SCMT, so that the two systems can be compared.

- **ETCS level 2, simplified internal supervision.** The original supervision of YuTreno: movement authority from the block, ceiling and braking curves with indication, warning, service brake and emergency. [MODEL.md](MODEL.md#signalling)
- **ETCS level 2, reference onboard.** An onboard computer (EVC) that knows the world only through Subset-026 balises and messages: location on the last balise group, position reports, movement authority, static speed profile, gradients and temporary speed restrictions, curves of §3.13 (EBD, SBD, EBI, SBI, warning, permitted, indication, release speed), trip and post trip, emergency stop, radio contact supervision, the data for ATO of Subset-130. [ONBOARD_ETCS.md](ONBOARD_ETCS.md), [design/reference-onboard.md](design/reference-onboard.md)
- **ETCS level 2, external onboard.** Any EVC speaking the same JSON protocol, as a process, over TCP or WebSocket; the guide goes from a minimal onboard in Python to integrating openETCS. [EVC_GUIDE.md](EVC_GUIDE.md), [INDEPENDENT_ONBOARDS.md](INDEPENDENT_ONBOARDS.md)
- **Simple message-based RBC.** One session per train, messages 3, 15, 16 and 24 with packets 15, 21, 27, 65, the stop as message 16; trains in both directions with `Q_DIR`. [design/simple-rbc.md](design/simple-rbc.md)
- **Interlocking trackside.** An interlocking that moves points and reads track circuits with EULYNX telegrams (SCI-P, SCI-TDS), sets routes from an RFI-style control table with a translator, automatic route setting by timetable or first come, block consent on single track, overlaps and sectional release, failures of points and track circuits, a control centre with routes, ARS switch and emergency stop; an RBC that builds the authority from the set routes; on a line, several RBCs with the handover of Subset-026 §3.15.1 and Subset-039 (pre-announcement, route related information, taking over of responsibility, life sign) and an onboard with two sessions. One interlocking per line on a network, with node routes and boundaries between interlockings. [TRACKSIDE.md](TRACKSIDE.md), [design/interlocking-trackside.md](design/interlocking-trackside.md)
- **Moving block.** ETCS Level 2 with moving block, with the simple RBC and a message-based onboard on every train: the authority of a following train ends a margin behind the confirmed rear end the train ahead last reported with integrity confirmed (`Q_INTEGRITY`, `L_TRAININT`); report period by packet 58 and a radio delay as parameters; rear end frozen when integrity or the radio of the train ahead is lost. [MOVING_BLOCK.md](MOVING_BLOCK.md)
- **Automatic block and SCMT.** Three-aspect signals, red behind every occupied section; SCMT as a simplified supervision towards the red signal and the speed reductions. [MODEL.md](MODEL.md), [STANDARDS.md](STANDARDS.md#scmt)
- **Curve validation.** Cases and tools to compare the reference onboard with the braking curves tool of the ERA. [CURVE_VALIDATION.md](CURVE_VALIDATION.md)

## 4. Automatic driving

- **Controllers.** A program receives an observation (speed, position, supervision, authority or signal, profiles, next stop, events, Subset-130 data) and answers with a command (traction, brake or lever, vigilance, emergency). In the browser in JavaScript, headless in JavaScript, or in any language over WebSocket; the simulation waits for every answer. [API.md](API.md)
- **Two reference ATOs.** `examples/ato.js` follows the permitted speed; `examples/ato_s130.js` plans its braking on the data the onboard passes to ATO according to Subset-130 (`N_LOC_EBI`, `A_BRAKE_SAFE`, MRSP, gradients, reaction times). Stops, vigilance and regulator are the same, so the comparison measures only the use of those data. [CAMPAIGN.md](CAMPAIGN.md#the-two-atos)
- **Subset-130 data.** Every onboard (internal, reference, external) provides them; `N_LOC_EBI` is checked to be the point where the protection really intervenes. [API.md](API.md#onboard-data-for-ato-subset-130)
- **Agents.** The service trains can be driven by an external agent, one per train or one for all; an environment speaking JSON lines and a Python/Gymnasium wrapper for reinforcement learning. [AGENTS.md](AGENTS.md)
- **A model of a human driver.** `examples/driver_model.js` drives between a low curve below the permitted speed and the permitted speed, responds late with a rate that grows with time and uses a share of traction and brake, in three profiles (cautious, medium, aggressive) with a seed; a driver campaign compares them with the ATO on the ETCS scenarios. [DRIVER_MODEL.md](DRIVER_MODEL.md)
- **Built-in driver.** The service trains and the freight train ahead are driven by an ATO inside the core, with the logic of `examples/ato.js`.

## 5. Scenarios, faults and verdict

A scenario is a JSON file that prepares a run (line, train, signalling, onboard, trackside, weather, time of day, regulator, services, network, passengers) and schedules events at a time, at a position or both. [SCENARIOS.md](SCENARIOS.md), [SCENARIO_GUIDE.md](SCENARIO_GUIDE.md)

- **Sixteen event types.** Radio loss, loss of train integrity, odometry drift, temporary speed restriction, low adhesion, degraded brake, reduced traction, train ahead stopped, RBC emergency stop, message to the driver, point failure, track circuit failure, control centre command, a train broken down, a blocked stretch of line, a command of the dispatcher.
- **Announced or hidden.** An event is shown in the cab and to the controllers, or stays only in the log and is discovered from its effects (the leaves, a degraded brake).
- **Verdict.** Criteria on arrival, delay, stopping error, missed stops, interventions, overruns, vigilance, excess over the limit, energy, coupler forces and jerk; a verdict with the list of checks.
- **Example scenarios.** 26: eight general ones (radio loss, RBC stop, leaves, degraded brake, train ahead stopped with ETCS and with SCMT, worksite restriction, wet descent), eight with the interlocking (nominal, overtaking, point failure, track circuit failure, operator commands, handover between two RBCs, also with the link between them or the radio of the second lost), ten with service trains (crossing, also with the interlocking, following, precedence, breakdown, cancellation, branch, branch shuttle, reroute on a loop, the real network around Benevento).
- **Scenario configuration.** A short JSON that chooses the line and the number of trains, with services generated from the line or taken from a real timetable; also a form in the page. [SCENARIO_CONFIG.md](SCENARIO_CONFIG.md)

## 6. Traffic

- **Service trains.** Other trains with stops and times, in both directions, driven by the built-in ATO or by an agent; realised and planned timetable, delays; rolling stock circulations (`block`) and connections between trains. [SCENARIOS.md](SCENARIOS.md#service-trains)
- **Single track.** Every station has a track for each direction; between stations a section is given to one direction at a time (single-line block consent), with conflict rules by timetable or first come.
- **The train ahead.** A freight train among the trains of the run, with its own dynamics, signals, supervision and onboard. [MODEL.md](MODEL.md#vigilance-stops-and-the-train-ahead)
- **Networks.** Lines that meet in shared stations; every train runs along a corridor compiled from its itinerary; node routes; with the interlocking, one interlocking per line and one RBC. [design/network.md](design/network.md)
- **Traffic regulator.** A program that receives the state of the traffic and decides priorities, new times, skipped stops, cancellations, tracks, reroutes, connections and control centre commands; a reference regulator with seven rules; the same protocol for an external one. [REGULATOR.md](REGULATOR.md)
- **Dispatcher.** Commands given now from the page or from a program, refused with their reason when they cannot apply, recorded with their time and replayable as scenario events. [CONTROL_ROOM.md](CONTROL_ROOM.md)
- **Control room.** A schematic of the whole network with signals, occupied sections, single-track orientation, routes and points, the trains coloured by delay, the table of the trains and the log; one public, versioned snapshot of the engine, also served over HTTP. [CONTROL_ROOM.md](CONTROL_ROOM.md)
- **Disruptions.** A train broken down, a blocked stretch, a failed point or track circuit, with their effects on the following trains.
- **Line capacity.** The minimum headway measured with two identical trains, against the one computed from the blocking times of the block sections (simplified UIC 406), also at a node; and the time every train is held by the signalling rather than by the line, with the headway below which a following train starts to be held. [CAPACITY.md](CAPACITY.md)

## 7. Passengers

An aggregate model moves people between platforms and trains. [PASSENGERS.md](PASSENGERS.md)

- **Demand.** Origin–destination flows per hour with optional windows; continuous or Poisson arrivals with a seed; changes of train at a given station.
- **Stops.** People alight, then board within seats and standing places; who does not fit waits for the next train; the dwell follows the people through the doors and the crowding, and holds the doors.
- **Mass on board.** Every person adds to the mass of the train and of its vehicles, and reaches the external dynamics.
- **Measures.** Boarded, alighted, waiting, left behind, wait, journey, delay per passenger, passenger-km, load factors, energy per passenger-km, changes and their waits; occupancy in SIRI and GTFS-Realtime; people on the platforms in the 3D view.

## 8. Real infrastructure and timetables

- **Line import.** A line from an Overpass extract of OpenStreetMap, a RINF SPARQL result and a terrain model (EU-DEM), with a declared priority of the sources, the provenance of every datum (source, derived, generated), and a report with licences and consistency between the sources; one command downloads the sources and imports. [INFRA_IMPORT.md](INFRA_IMPORT.md), [LINE_TUTORIAL.md](LINE_TUTORIAL.md)
- **Real lines in the repository.** Avellino – Benevento (30.5 km, ten stations, from OpenStreetMap and EU-DEM), Cancello – Benevento (49.3 km, twelve stations, also from RINF), the two as a network at Benevento, and Salerno – Mercato San Severino (18.4 km, nine stations) with an extract of its real timetable.
- **railML infrastructure.** Export and import of a line as railML 3.2.
- **Timetable import.** GTFS, NeTEx and railML timetables become the services of a scenario; exporting and importing again gives the same services. [OPEN_DATA.md](OPEN_DATA.md)
- **Plausibility.** The running times of a timetable against the simulated ones, stretch by stretch, within declared bounds. [INFRA_IMPORT.md](INFRA_IMPORT.md)

## 9. Open data

A run publishes its timetable and its progress in the formats that passenger information systems read. [OPEN_DATA.md](OPEN_DATA.md), [TIMETABLE_STANDARDS.md](TIMETABLE_STANDARDS.md)

- **Planned timetable.** GTFS, NeTEx (Italian EPIP profile), railML 3.2.
- **Real time.** GTFS-Realtime (trip updates, vehicle positions, occupancy) and SIRI (ET, VM, Lite paths of the Italian profile).
- **Server.** `npm run feeds` serves the feeds of a run over HTTP while it runs, with the control room on `/control-room`; or writes them at a given time.
- **Validity.** The same identifiers in every format; output checked against the official schemas and validators (NeTEx, SIRI, GTFS validator).

## 10. External programs and co-simulation

Five public protocols let other programs take a part of the run. They are versioned, new fields are optional, and the engine waits for every answer, so a run with external programs is as deterministic as one without. [design/protocols.md](design/protocols.md)

| Protocol | Who answers | Examples | Document |
| :-- | :-- | :-- | :-- |
| Controller (version 3) | whoever drives | JavaScript, Python | [API.md](API.md) |
| Dynamics (version 2) | a dynamics model | JavaScript, Python, Octave, MATLAB/Simulink | [EXTERNAL_DYNAMICS.md](EXTERNAL_DYNAMICS.md) |
| Onboard (version 2) | an ETCS onboard computer | Python, TypeScript, openETCS | [ONBOARD_ETCS.md](ONBOARD_ETCS.md) |
| Trackside (version 2) | interlocking and RBC | TypeScript | [TRACKSIDE.md](TRACKSIDE.md) |
| Regulator (version 1) | a traffic regulator | TypeScript, Python | [REGULATOR.md](REGULATOR.md) |

- **Transports.** A process on stdin/stdout, TCP or WebSocket; a bridge takes the page to external programs.
- **Agents.** A sixth channel for the drivers of the service trains. [AGENTS.md](AGENTS.md)
- **Compatibility.** The Italian names and formats of version 0.x are accepted on input, and produced for programs written for them.

## 11. Measurement and reproducibility

- **Determinism.** Fixed step of 5 ms, no clock, seeded randomness: the same line, train, scenario and commands give the same data byte by byte, also with external programs connected. [ARCHITECTURE.md](ARCHITECTURE.md#the-run-fixed-step-and-determinism)
- **Measurement campaign.** Onboard × ATO × scenario, with and without hidden faults, 48 runs with measures, parameters and SHA-256 fingerprints of inputs and outputs, and determinism checks also with the onboard as an external process. It separates the effect of the onboard from that of the ATO. [CAMPAIGN.md](CAMPAIGN.md)
- **Service campaign.** A sweep of lines, number of trains, headways, directions, signalling and passenger demand, with punctuality, passenger, energy and signalling measures, and the headway thresholds of a sweep. [CAMPAIGN.md](CAMPAIGN.md#service-campaign)
- **Driver campaign.** Three driving profiles with five seeds each against the ATO, with two onboards, on the ETCS scenarios: energy, time, warnings, interventions and their spread. [DRIVER_MODEL.md](DRIVER_MODEL.md#the-driver-campaign)
- **Checks.** 22 scripts (`npm run verify`): physics in closed form, multi-mass dynamics against theory, onboard and Subset-026 clause by clause, trackside, scenarios, services, regulator, capacity, network, passengers, control room, open data, imports, infrastructure, scenario configuration, ATO, traceability. [README.md](../README.md#checks)
- **Golden masters.** The fingerprints of 234 runs (every scenario in six variants, and the campaigns) and of 24 states of the page: a change meant to leave the behaviour alone must leave them unchanged. [design/tools.md](design/tools.md)
- **Requirement traceability.** A matrix of 383 rows of Subset-026, Subset-130, Subset-039, EULYNX and RFI practice with their status (implemented, simplified, divergent, missing, out of scope) and the tests of every implemented or simplified row. [traceability/README.md](traceability/README.md)
- **Real time.** Measures of how far the engine and the external channels can follow the clock, and what a bench with real hardware would need. [REAL_TIME.md](REAL_TIME.md)

## 12. Teaching

- **The model page.** `dist/model.html` describes the dynamics model with equations, the checks and an interactive laboratory, computed by the core itself. [MODEL.md](MODEL.md)
- **Point mass and two systems.** The simpler model and the comparison ETCS against automatic block and SCMT on the same line.
- **Physical model railway.** A feasibility study and a first draft of a model train driven by YuTreno, with NFC balises and a radio RBC. [PHYSICAL_MODEL.md](PHYSICAL_MODEL.md)

## 13. Ways to run it

- **In the browser.** `npm run dev`, or `dist/yutreno.html` with a double click: no server and no connection needed.
- **Headless.** `npm run headless`: runs, scenario folders with verdict, external controllers, dynamics, onboards, trackside, regulator and agents; CSV, events, summary and timetable on disk. A run takes one or two seconds.
- **From TypeScript.** `Simulation` and `runLockstep()` from `src/core`. [API.md](API.md#using-the-core-from-typescript)
- **Docker.** A container that runs a demo campaign and stays up with the simulator and the bridges. [docker/README.md](../docker/README.md)

## What YuTreno does not do

These limits matter to anyone who uses its results.

- **The reference onboard is not validated nor certified.** The comparison with the ERA braking curves tool is started but not complete. Of 231 sections of Subset-026 chapters 3, 4, 5, 7 and 8, 3 are implemented, 77 simplified, 9 divergent, 122 missing and 20 out of scope; there is no start of mission, no modes other than SB, FS, TR and PT, no levels other than 2, no bit encoding of messages, no lambda brake model. Three known divergences in §3.13 change the numbers. [STANDARDS.md](STANDARDS.md), [traceability/README.md](traceability/README.md)
- **No onboard written by others is connected yet.** The path to cesarBLG/ETCS and milanredele/etcs-dmi is estimated, not done. [INDEPENDENT_ONBOARDS.md](INDEPENDENT_ONBOARDS.md)
- **SCMT is a simplified supervision**, without coded track circuits nor RFI specifications.
- **The interlocking is a reconstruction** of Italian practice, one program per line, without flank protection or point geometry; the control table is not an RFI document. The handover between RBCs works on a single line, not at a network node, and needs an onboard with two radio terminals. The moving block works with the simple RBC on a single line, without trackside detection as a fallback nor virtual sections. [TRACKSIDE.md](TRACKSIDE.md#what-is-simplified), [MOVING_BLOCK.md](MOVING_BLOCK.md#what-it-does-not-do)
- **The dynamics is longitudinal only**; the pneumatic brake has a pure propagation delay without the pressure in the brake pipe; adhesion is an empirical curve.
- **Passengers are aggregate flows**, not agents choosing their route.
- **It runs in lockstep, not against the clock.** A clock-locked loop exists only as a measurement prototype. [REAL_TIME.md](REAL_TIME.md)
- **One controlled train**; the other trains are driven by the built-in ATO or by agents. The DMI does not follow the ERA iconography.

## Structure

YuTreno is written in TypeScript (about 28,000 lines with the scripts and the examples). The code is divided into layers, and the boundary between them is the most important rule of the project. [ARCHITECTURE.md](ARCHITECTURE.md)

| Folder | Content | Depends on |
| :-- | :-- | :-- |
| `src/core/` | the simulation: line and network, trains, dynamics, signalling and supervision, reference onboard, simple RBC, field of the interlocking, traffic, passengers, scenarios and verdict, observation and commands, control room snapshot, compatibility with 0.x | nothing outside itself and `src/trackside/` |
| `src/trackside/` | interlocking, RBC, control table and translator | only types of the engine |
| `src/regulator/` | the reference traffic regulator | only types of the engine |
| `src/feeds/` | open data out and timetable import | reads the simulation |
| `src/infra/` | import of real lines | nothing of the browser or Node |
| `src/web/` | the page: 3D and 2D views, DMI, editors, timetable, control room, controllers in the browser | reads the core, decides nothing physical |
| `src/server/` | Node tools: headless runner, bridge, agent environment, open data server, importers | the core |
| `src/docs/` | the model page | the core |
| `examples/` | controllers, ATOs, external onboards, trackside and regulator as programs, dynamics models, agent environment, scenario configurations, imported lines, open data output | the protocols |
| `scenarios/`, `campaigns/`, `validation/` | example scenarios, campaign configurations, cases for the curve validation | |
| `scripts/` | build, 23 checks, golden masters, campaigns, traceability, curve validation, measures | |
| `docs/` | guides, API, model, standards, design documents, traceability; Italian copies in `docs/it/` | |

Three rules cut across all of it: **determinism** (no component reads the clock or uses non-repeatable randomness), **layer boundaries** (the core does not depend on the browser or Node; the onboard, the trackside and the regulator import nothing from the engine but types, so that an external program can do everything they do), and **public protocols** (new fields are optional, names follow the standards, the 0.x formats keep working). [design/README.md](design/README.md)

## Documentation map

**For users.**
- [README](../README.md): what it is and how to start.
- [GUIDE.md](GUIDE.md): the page, tab by tab.
- [SCENARIO_GUIDE.md](SCENARIO_GUIDE.md) and [SCENARIOS.md](SCENARIOS.md): writing and running scenarios.
- [SCENARIO_CONFIG.md](SCENARIO_CONFIG.md): scenarios from a short configuration.
- [API.md](API.md) and [AGENTS.md](AGENTS.md): writing a controller or an agent; [DRIVER_MODEL.md](DRIVER_MODEL.md): the model of a human driver.
- [LINE_TUTORIAL.md](LINE_TUTORIAL.md) and [INFRA_IMPORT.md](INFRA_IMPORT.md): a real line from scratch.
- [CONTROL_ROOM.md](CONTROL_ROOM.md), [PASSENGERS.md](PASSENGERS.md), [OPEN_DATA.md](OPEN_DATA.md): traffic, passengers, open data.
- [docker/README.md](../docker/README.md): the demo in a container.

**For developers.**
- [ARCHITECTURE.md](ARCHITECTURE.md): layers, data flow, fixed step, where to work for the most common changes.
- [design/](design/README.md): one document per component (core, dynamics, signalling, reference onboard, simple RBC, interlocking trackside, regulator, network, protocols, web interface, open data, tools).
- [ROADMAP.md](ROADMAP.md): where the project stands, the decisions of the owner, what comes next.
- `CLAUDE.md` and `AGENTS.md` in the root: the rules of the repository (commits, checks, golden masters, documentation in two languages).
- The protocols: [EXTERNAL_DYNAMICS.md](EXTERNAL_DYNAMICS.md), [ONBOARD_ETCS.md](ONBOARD_ETCS.md), [EVC_GUIDE.md](EVC_GUIDE.md), [TRACKSIDE.md](TRACKSIDE.md), [REGULATOR.md](REGULATOR.md).

**For research.**
- [STANDARDS.md](STANDARDS.md) and [TIMETABLE_STANDARDS.md](TIMETABLE_STANDARDS.md): what each standard prescribes, what YuTreno takes and where it stops.
- [MODEL.md](MODEL.md): the physical and signalling model.
- [CAMPAIGN.md](CAMPAIGN.md), [CAPACITY.md](CAPACITY.md), [DRIVER_MODEL.md](DRIVER_MODEL.md), [CURVE_VALIDATION.md](CURVE_VALIDATION.md), [REAL_TIME.md](REAL_TIME.md): measures and their method.
- [traceability/README.md](traceability/README.md): the requirement matrix.
- [INDEPENDENT_ONBOARDS.md](INDEPENDENT_ONBOARDS.md) and [PHYSICAL_MODEL.md](PHYSICAL_MODEL.md): feasibility studies.

## References

The references cited in the documents, gathered by subject. Every document gives the ones it uses next to the point where it uses them.

**ERTMS/ETCS and ATO.**
- European Union Agency for Railways (ERA), ERTMS/ETCS Subset-026 v4.0.0, *System Requirements Specification*.
- ERA, Subset-130 v1.0.0, *ETCS–ATO interface* (packets 6 ETCS_ATO_Dynamic and 11 ETCS_ATO_BRAKE_DECELERATIONS).
- ERA, Subset-034 (train interface), Subset-039 (RBC–RBC handover), Subset-076 (test specifications), Subset-094 (functional requirements for an onboard reference test facility).
- ERA, braking curves tool and its user guide.

**Interlocking, traffic management and capacity.**
- EULYNX, Baseline 4 Release 4: Eu.Doc.38 (SCI-P, points), Eu.Doc.44 (SCI-TDS, train detection), Eu.Doc.36; System Definition Eu.Doc.7 v4.2 (SCI-ILS, adjacent interlockings).
- EULYNX and ERTMS Users Group, RCA.Doc.19, *RCA TMS-PE component specification*, and *RCA SCI_1 specification*.
- Europe's Rail, *Traffic CS system concept*, 2025.
- RFI, *Sistema Controllo Marcia Treno (SCMT)*; RFI practice of the control tables (Tabelle delle Condizioni), as reconstructed in YuTreno.
- UIC, Code 406, *Capacity*, 2nd edition, June 2013; *Evaluating line capacity with an analytical UIC Code 406 compression method and blocking time stairway*, Energies 13(7) 1853, 2020.
- UIC, IRS 30100 *RailTopoModel*, 1st edition, 2016.
- V. Cacchiani et al., *An overview of recovery models and algorithms for real-time railway rescheduling*, Transportation Research Part B 63, 2014.
- F. Corman, L. Meng, *A review of online dynamic models and algorithms for railway traffic management*, IEEE Transactions on Intelligent Transportation Systems 16(3), 2015.
- TU Dresden, *The ON-TIME real-time railway traffic management framework*.
- E. Barbaro, I. La Paglia, F. Bernardini, G. Bucca, R. Corradi, M. Bocciolone, A. Collina, *A modular simulation tool for fixed block and moving block railway signalling systems*, Railway Engineering Science 34(2), 2026, pp. 257–274: the closest simulator to YuTreno, source of the model of a human driver and of the time held by the signalling.

**Train dynamics and passengers.**
- UIC 540 and 544 (brakes), and the literature on longitudinal train dynamics: Davis resistance, Röckl curve resistance, Curtius–Kniffler adhesion.
- V. Gîlcă, D. Borcoși, the two-mass toy train model (2019); Control Tutorials for MATLAB & Simulink (University of Michigan).
- EN 15663, *Vehicle reference masses*.
- TCRP Report 165, *Transit Capacity and Quality of Service Manual*, chapter on dwell; Weston, dwell times on London Underground.
- Modelica Association, *Functional Mock-up Interface 2.0* (co-simulation).

**Timetables, passenger information and open data.**
- Directive 2010/40/EU and Delegated Regulation (EU) 2017/1926 (MMTIS), with its revision 2024/490; Implementing Regulation (EU) 2026/253 (TSI Telematics).
- CEN Transmodel, NeTEx and SIRI 2.1; the Italian NeTEx and SIRI profiles (5T) and the National Access Point (CCISS, Ministry of Infrastructure and Transport).
- GTFS and GTFS-Realtime (Google, MobilityData), and the MobilityData GTFS validator.
- railML 3.2 (timetable and infrastructure schemes, rolling stock circulations).

**Infrastructure data.**
- OpenStreetMap and the OpenRailwayMap tagging (also its Italian guidelines), Overpass API; licence ODbL.
- ERA, *Register of Infrastructure* (RINF), its terms of use and the ERA vocabulary; Commission Implementing Regulation (EU) 2019/777.
- Copernicus Land Monitoring Service, EU-DEM v1.1, through OpenTopoData.
- D. H. Douglas, T. K. Peucker, *Algorithms for the reduction of the number of points required to represent a digitized line or its caricature*, The Canadian Cartographer 10(2), 1973.

**Related open-source projects.**
- openETCS: deliverables D3.5.4 (API), D3.6.1 (functional model), D3.8 (open source code) and the generated code `openETCS/srcAndBinary`.
- cesarBLG/ETCS and milanredele/etcs-dmi, candidate independent onboards.
- TU Dresden, ETCS test layout at 1:22.5; the model railway sources in [PHYSICAL_MODEL.md](PHYSICAL_MODEL.md#sources).

The links to every source are in the *Sources* sections of [STANDARDS.md](STANDARDS.md#sources), [TIMETABLE_STANDARDS.md](TIMETABLE_STANDARDS.md#sources), [INFRA_IMPORT.md](INFRA_IMPORT.md#sources), [EVC_GUIDE.md](EVC_GUIDE.md#sources), [PHYSICAL_MODEL.md](PHYSICAL_MODEL.md#sources), [design/network.md](design/network.md#sources), [CAPACITY.md](CAPACITY.md) and [DRIVER_MODEL.md](DRIVER_MODEL.md#sources).
