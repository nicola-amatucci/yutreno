# Event and fault scenarios

A scenario is a JSON file that prepares a run and schedules what will happen during the journey. It chooses line, train and conditions, and sets events that trigger at a given time or when the head of the train reaches a position. At the end of the run its criteria produce an objective verdict, passed or failed. The same scenario can be played by hand in the interface or driven by a controller, also in series and without graphics. The simulation stays deterministic, so two controllers are compared on exactly the same conditions.

The example scenarios are in the `scenarios/` folder, those of the trackside with interlocking and RBC in `scenarios/trackside/`, and they also appear in the *Scenarios* tab of the page. A step-by-step guide to writing one is in [SCENARIO_GUIDE.md](SCENARIO_GUIDE.md).

## Structure

```json
{
  "name": "Worksite speed restriction",
  "description": "Text shown in the briefing and in the Scenarios tab.",
  "line": "valle-lauro",
  "train": "regional",
  "signalling": "ETCS",
  "weather": "clear",
  "adhesion": "auto",
  "events": [
    { "type": "speed_restriction", "from_m": 6500, "to_m": 8000, "v_kmh": 50 },
    { "type": "radio_loss", "when": { "pos": 11500 }, "duration_s": 90, "timeout_s": 20 }
  ],
  "criteria": { "delay_max_s": 240 }
}
```

Only `name` is mandatory. This is what the other fields contain:

- `line` is the id of a built-in line (`valle-lauro`, `appennino`) or a complete line in the JSON format of the *Line* tab.
- `train` is the id of a built-in train (`regional`, `high_speed`, `freight`) or its complete parameters.
- `signalling` is `ETCS` or `BACC`.
- `weather` (`clear`, `rain`, `fog`), `time_of_day` (`day`, `dusk`, `night`) and `adhesion` (`auto`, `dry`, `wet`, `leaves`) have the same values as the interface.
- `onboard` (ETCS only) is `internal`, `reference` or `external`; `trackside` is `simple`, `interlocking` or `external` and with a value other than `simple` it requires a message-based onboard (see [TRACKSIDE.md](TRACKSIDE.md)).
- `leader` changes the train ahead of the line, for example `{ "stopAt": 5420, "wait": 400 }` to make it stop in a station. The train ahead is a freight train among the trains of the run: it stands at `s0` when the run starts, follows signals and supervision like the service trains, gives way to them in conflicts and ends its run at the last station ([MODEL.md](MODEL.md#vigilance-stops-and-the-train-ahead)).
- `regulator` is `none` (default), `reference` or `external`, with an optional `regulator_period_s` (default 5 s): the traffic regulator that reschedules trains, changes priorities and cancels routes when something goes wrong ([REGULATOR.md](REGULATOR.md)). Example: `scenarios/services/breakdown.json`.
- `passengers`: origin–destination demand, with boarding and alighting at the stops, dwell from the people through the doors, capacity, mass on board and measures ([PASSENGERS.md](PASSENGERS.md)). Example: `examples/scenario-config/valle-lauro-passengers.json`.
- `spacing` (`fixed_block` or `moving_block`) and `moving_block` (`margin_m`, `report_period_s`, `radio_delay_s`): ETCS Level 2 with moving block, with a message-based onboard and the simple trackside on a single line ([MOVING_BLOCK.md](MOVING_BLOCK.md)). Examples: `scenarios/moving-block*.json`.
- `rbc_borders_m` (interlocking trackside only, single line): the chainages of the borders between RBC areas, for example `[7600]`. Each border goes on the nearest main signal, and the train passes from one RBC to the next with the handover of Subset-026 and Subset-039 ([TRACKSIDE.md](TRACKSIDE.md#several-rbcs-and-the-handover)). Example: `scenarios/trackside/handover.json`.
- `conflict_rule` (interlocking trackside only) is `timetable` (default) or `first_come`: how automatic route setting chooses between two trains that want conflicting routes (see [TRACKSIDE.md](TRACKSIDE.md)).

Omitted fields stay those already in use. In headless runs the options given explicitly on the command line prevail over the scenario.

Scenarios written with the Italian names of version 0.x (`nome`, `linea`, `eventi`, `rallentamento`, `radio_perso`…) are still accepted: they are translated on input by `toEnglish` in `src/core/legacy.ts`.

## Service trains

A scenario can add other trains with their timetable in `services`. The train of the run (the one in the cab or driven by the controller) keeps the timetable of the line; every service is another train with its own dynamics, supervision and stops, driven by the built-in ATO, which follows the same logic as `examples/ato.js`, or with `"driver": "agent"` by an external agent ([AGENTS.md](AGENTS.md)).

```json
"services": [
  { "id": "R 2102", "train": "regional", "stops": [
    { "station": "Valle Lauro", "departure_s": 360 },
    { "station": "Ponte Sabato", "arrival_s": 620, "departure_s": 650, "min_dwell_s": 30 },
    { "station": "Monte Clanio", "arrival_s": 1240 } ] }
]
```

- `id` is the train number, unique in the run. `train` is a built-in train or its parameters; without it the service uses the train of the run.
- `stops` lists the stations served in running order, by name; the first needs `departure_s`. Times are seconds from the start of the run. A station of the line not listed is passed without stopping. The order of the stops gives the running direction: towards the end of the line, or back towards its origin.
- A stop can carry `"track": "I"` or `"II"`: with the interlocking trackside automatic route setting sends the train only onto that track, which is how a timetable plans an overtaking. The other tracksides ignore it.
- The service appears at its origin 60 s before the departure, if the platform is free, with the doors open. It leaves at the departure time, dwells at every stop at least `min_dwell_s` (default 20 s) and not before the timetabled departure, and leaves the line after the last stop.
- Signals and authorities take into account all the trains: the block keeps them apart and a delay propagates to the trains behind. The starting signal of a station stays red until the departure time of the train standing there.
- Services run with the internal supervision, the automatic block or a message-based onboard with the simple RBC: with `onboard: "reference"` every train carries a reference onboard and the RBC keeps a session for each; with `onboard: "external"` the external onboard is on the controlled train and the services carry the reference one. With the interlocking trackside every train has its session and its timetable for automatic route setting, in both directions: the interlocking adds the reverse routes and gives each single-track segment to one direction at a time. Examples: `scenarios/services/precedence.json`, an overtaking decided by the conflict rule, and `scenarios/services/crossing-interlocking.json`, the crossing with the interlocking.

**Both directions.** The line between stations is single track and every station has a track for each direction. A train running back towards the origin sees the line mirrored (`mirrorLine` in `src/core/line.ts`): chainages from the other end, gradients with the opposite sign, its own signals at the same distances from the stations. The single-track sections go from the starting signal of a station to the starting signal of the next one in the other direction, and work like a single-line block with consent: a direction gets a section when one of its trains wants to enter and no train of the other direction is on it, keeps it while its trains are on it or want to enter, and releases it otherwise; with two requests at the same time the earlier timetabled departure wins. Trains of the other direction count as occupation only on single track, so two trains cross in a station, each on its track. The train ahead of the line is a train like the others, so it runs with trains in both directions too. The rule gives no priorities and does not prevent every deadlock of dense timetables: dispatching comes with the regulator of phase 3. Example: `scenarios/services/crossing.json`.

**Networks.** With `"network"` (the id of a built-in network, or a complete one with its `lines`) the run has several lines that meet in the stations they share; the main line is the first one, that of the controlled train, of the train ahead and of the events with chainages. A service can give `"route"`: the lines it runs along, by id and in running order, for example `["valle-lauro", "rocca-sabato"]` from Valle Lauro to Rocca Sabato through San Felice Scalo. Without a route it runs on the main line, or on the first line that has all its stops. The block and the single-track rules apply to every line; where trains join a line from another one, the station of the node on that line is given to one train at a time (node route). A network runs, for now, with the automatic block or with ETCS and the internal supervision; regulator and open data work on it; the interface shows the main line. See [design/network.md](design/network.md). Example: `scenarios/services/branch.json`. A network can also be made of complete lines, for example the real lines imported in [INFRA_IMPORT.md](INFRA_IMPORT.md): `scenarios/services/benevento.json` (written by `npx tsx scripts/real-network.ts`) joins Cancello – Benevento and Avellino – Benevento at Benevento, with a connection and a crossing on the single track.

**Rolling stock circulations.** Services with the same `"block"` are run by the same train, in the order of their departures: each one starts at the station where the previous one ended, appears only when that one has arrived and leaves not before its arrival plus `"min_turnaround_s"` (scenario, default 300 s), so a delay passes from one service to the next. A service of a block without `"train"` takes that of the block. It is the `block_id` of GTFS and a block of the vehicle rostering of railML 3.

**Connections.** `"connections"` lists the connections between trains: at `"station"` the service `"to_service"` waits for `"from_service"` (`"train"` is the controlled train) and leaves not before its arrival plus `"transfer_s"` (default 120 s), but never later than its departure plus `"max_wait_s"` (default 300 s); beyond that it leaves and the connection is lost. The realised timetable records for every connection whether it was kept and how long the train waited. It is a `ServiceJourneyInterchange` of NeTEx. Example of both: `scenarios/services/branch-shuttle.json`.

With the reference regulator a network allows a reroute: `scenarios/services/loop-reroute.json`, on the network `valle-lauro-anello`, blocks the main line between Ponte Sabato and San Felice Scalo and the regulator sends R 3101 along the link Ponte Sabato – Pietrarsa ([REGULATOR.md](REGULATOR.md)).

The fields correspond to the timetable standards: a service is an `operationalTrain` with its `OperationalTrainNumber` in railML 3 (a `trainPart` in railML 2), a `ServiceJourney` in NeTEx and a trip in GTFS; a stop is a `baseItineraryPoint` with its `times` and `stop` (an `ocpTT` in railML 2), a `TimetabledPassingTime` and a row of `stop_times.txt`. Services can be imported from these formats and exported to them ([OPEN_DATA.md](OPEN_DATA.md#importing-timetables)).

With services the run ends when every train has finished. Headless runs with `--output` write, besides the files of the controlled train, `_timetable.json` with the planned and realised timetable of every train (arrival, departure and delays at every stop) and, for every service, its CSV and summary. The observation of a run with services carries `train_id`. The page runs and draws them (line diagram, 3D view, *Timetable* tab with the space-time diagram and the editor). An example is `scenarios/services/following.json`; `verify-services` checks departures, distance between trains, propagation of a delay with both signalling systems, the disruptions (`line_blocked` with the three tracksides, a service stopped or slowed while the others are not), overtaking and the two conflict rules with the interlocking trackside, and determinism.

## When an event triggers

`when` can contain `t` (seconds from the start of the run), `pos` (metres, position of the head) or both; with both, both conditions are needed. Without `when` the event is active from departure. `duration_s` closes the event after that time; without a duration the effect lasts until the end of the run.

## Event types

| Type | Fields | Effect | Announced |
| :-- | :-- | :-- | :-- |
| `speed_restriction` | `from_m`, `to_m`, `v_kmh` | Temporary speed restriction: it enters the speed profile, the supervision curves, the DMI and the observations (`speed_restrictions`). | yes |
| `radio_loss` | `timeout_s` (default 20) | ETCS only: the movement authority stays the one received before the failure. After `timeout_s` without messages the onboard commands the service brake, released when the link is back. With a message-based onboard the messages in both directions are lost and `timeout_s` becomes the national value `T_NVCONTACT`. With the automatic block it has no effect on running. With several RBCs (`rbc_borders_m`), `rbc` limits the loss to the radio of one RBC; with a message-based onboard, `train` (a service id or `leader`) to the radio of one train. | yes |
| `odometry_drift` | `slope` (error per metre run, for example −0.05), `train`, `duration_s` | Message-based ETCS onboard only: the odometry the engine sends to the onboard (distance, speed, odometer readings of the balises) reads `slope` metres more (positive) or less (negative) for every metre the train runs, from the start of the event; at its end the drift stops and the error so far stays. The true position of the train does not change ([ONBOARD_ETCS.md](ONBOARD_ETCS.md)). | no |
| `integrity_loss` | `train` (service id or `leader`, default the controlled train) | Message-based ETCS onboard only: the train interface tells the onboard that train integrity is lost; the onboard reports it at once and in every position report (`Q_INTEGRITY` 3, no `L_TRAININT`) until the end of the event, then confirmed again. With the fixed block it has no effect on running; with the moving block the RBC keeps the last confirmed rear end of that train. | no |
| `low_adhesion` | `from_m`, `to_m`, `mu` | Zone of reduced adhesion. The physics uses the lowest adhesion under the train; the onboard keeps computing its curves with the nominal one. | no |
| `brake_degraded` | `factor` (0–1), `train` | The braking force, service and emergency, is multiplied by the factor. The onboard does not know it. | no |
| `traction_reduced` | `factor` (0–1), `train` | The available tractive effort is multiplied by the factor. | no |
| `train_stopped` | `train`, `duration_s` | The train breaks down: it brakes and cannot move, whatever its driver commands, until the end of the duration (without one, until the end of the run). The trains behind it wait at the signals. | yes |
| `line_blocked` | `from_m`, `to_m`, `duration_s` | The stretch is blocked (an obstacle, a landslide, a worksite not cleared): the signals and the authorities protect it as if a train stood on it, in both directions, and with the interlocking trackside its track circuits are disturbed. | yes |
| `dispatch` | `dispatch` (a command of `Simulation.dispatch`), `when.t` | A command of the dispatcher, given at the time as from the control room ([CONTROL_ROOM.md](CONTROL_ROOM.md)): a decision of the regulator protocol or a temporary speed restriction. It fires at the end of the step that reaches its time, where a command given live falls, so a scenario written with *Write into the scenario* repeats the run. Only at a time, not at a position. | yes |
| `leader_stopped` | `duration_s` (default 120) | The train ahead brakes with the full service brake, as a train broken down, and restarts after the duration: the sections behind it stay occupied. | no |
| `rbc_emergency_stop` | — | Emergency stop order (from the RBC with ETCS, from the signaller with the automatic block). With a message-based onboard it becomes message 16 of the RBC and the onboard brakes; with the interlocking trackside it is a stop from the control centre revoked at the next cycle, so the train restarts from standstill. It does not count as a protection intervention. | yes |
| `message` | `text` | Message to the driver, for example a written order. | yes |
| `point_failure` | `element`, `mode` (`blocked` or `no_detection`), `duration_s` | Interlocking trackside only: the point (for example `"Ponte Sabato/1"`) can no longer be moved, or loses the detection of its position. The routes that use it are not set or are no longer valid for authorities. See [TRACKSIDE.md](TRACKSIDE.md). | no |
| `tvps_failure` | `element`, `duration_s` | Interlocking trackside only: the track circuit (for example `"Line/B3"`) is disturbed and the routes crossing it are not set. | no |
| `operator_command` | `command` | Interlocking trackside only: a control centre command, such as `{ "type": "set_route", "id": "Ponte Sabato/2" }`, `{ "type": "cancel_route", "id": "…" }`, `{ "type": "ars", "active": false }`, `{ "type": "emergency_stop" }` and `{ "type": "revoke_emergency_stop" }`, the last two with an optional `engine` for one train; `{ "type": "rbc_link", "up": false }` with several RBCs cuts the link between them, restored after `duration_s` if given. | yes |

`train` names the service train the event concerns (its `id`, or `leader` for the freight train ahead), for `brake_degraded`, `traction_reduced`, `train_stopped`, `integrity_loss`, `odometry_drift` and `radio_loss`; without it the event concerns the controlled train. In runs with services `brake_degraded` and `traction_reduced` used to act on every train; they now act only on the train concerned. A `pos` in `when` refers to the head of that train.

An **announced** event appears in the cab message and in the `events` of the observation sent to the controllers. A **not announced** event stays only in the log of the run, marked as such, because the driver discovers it from its effects: wheel slip, longer braking, sections that are not released. The field `announced: true|false` changes the default behaviour.

## Criteria and verdict

| Criterion | Default | Check |
| :-- | :-- | :-- |
| `complete` | `true` | the train reaches the terminus stopping at the marker |
| `stop_error_max_m` | 5 | maximum error, in absolute value, among the stops made |
| `missed_stops_max` | 0 | missed stops |
| `interventions_max` | 0 | protection interventions (emergency brake for a curve exceeded) |
| `overruns_max` | 0 | red signals or end of authority passed |
| `missed_vigilance_max` | 0 | vigilance not acknowledged |
| `arrival_max_s` | — | arrival time |
| `delay_max_s` | — | delay at arrival compared with the timetable |
| `over_limit_max_kmh` | — | maximum excess over the line limit, including speed restrictions |
| `energy_max_kWh` | — | net energy (traction minus regeneration) |
| `tension_force_max_kN` | — | maximum coupler tension (multi-mass model) |
| `compression_force_max_kN` | — | maximum coupler compression |
| `jerk_max_ms3` | — | maximum jerk at the head of the train, a comfort index |

The criteria of the scenario are added to the default values or replace them. A run without scenario also receives a verdict, with the default criteria only.

## Use

In the page, the *Scenarios* tab lets you choose a scenario, read its description and edit its JSON. It also shows the state of the events during the run and the verdict, provisional until the run ends. The verdict also appears in the end-of-run report.

Without graphics:

```bash
npm run headless -- --scenario scenarios/radio-loss.json
npm run headless -- --scenario scenarios --controller examples/ato.js --output runs     # campaign on all scenarios
npm run headless -- --scenario scenarios --controller ws://localhost:8765               # with an external controller
```

With a folder all its scenarios are run in alphabetical order. At the end the summary of the passed ones appears, and `--output` contains CSV, events and JSON summary of every run, with the list of checks.

## Outcomes of the example controller

`scripts/verify-scenarios.ts` sets the expected outcomes with `examples/ato.js`. Two scenarios are designed to make it fail:

- **leaves approaching Ponte Sabato** (`leaves-ponte-sabato.json`): it brakes with the design deceleration, slips and overruns the marker by 60 m;
- **degraded brake on a descent** (`degraded-brake.json`): it misses the final stop by 33 m.

They are the first cases on which to measure a better controller. If a new controller passes them, the expected outcome in the checks stays that of the example controller: the checks test the simulator, not the controllers.
