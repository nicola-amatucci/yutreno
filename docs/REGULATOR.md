# Traffic regulator

The interlocking sets routes and the RBC grants authorities, but neither decides *which* train should go first when the timetable no longer holds. The timetable may stop holding because a train breaks down, the line is blocked or a train runs slowly. In a real control centre that decision belongs to the traffic regulator, a person or a traffic management system. In YuTreno it belongs to a program that speaks the **regulator protocol**. The protocol has the same shape as the others: JSON requests at a fixed period, the run stops until the answer arrives.

The regulator sees the traffic, not the safety. It cannot move a point or extend an authority. It changes the timetable, the priorities and the tracks, and it can send the control centre commands that the signaller could send. The interlocking and the RBC keep protecting the trains whatever the regulator decides, so a bad regulator makes the traffic worse but never unsafe. This is the point of the separation: the protocol is meant for research on rescheduling without touching the core.

## How it is chosen

| `regulator` | What decides |
| :-- | :-- |
| `none` | nobody (default): the timetable stays the planned one, the interlocking applies its conflict rule |
| `reference` | the reference regulator of `src/regulator/`, in process |
| `external` | an external program with the protocol below (`exec:`, TCP, WebSocket) |

In a scenario: `"regulator": "reference"`, with an optional `"regulator_period_s"` (default 5 s). From the command line:

```
npm run headless -- --scenario scenarios/services/breakdown.json
npm run headless -- --scenario scenarios/services/breakdown.json --regulator none
npm run headless -- --scenario scenarios/services/breakdown.json --regulator "exec:npx tsx examples/regulator/regulator_stdio.ts"
npm run headless -- --scenario scenarios/services/breakdown.json --regulator "exec:python3 examples/regulator/regulator_example.py"
```

The regulator works with every signalling and trackside. Its decisions act through what exists in each:

- **retimed departures**: the starting signals of the station (automatic block and internal ETCS) and, with the interlocking trackside, automatic route setting;
- **priorities**: the order of conflicting route requests in the interlocking and the consent of single-track sections between the two directions.

Without a regulator nothing changes: the 48 runs of the reference campaign keep their fingerprint.

## The protocol

At every cycle (`regulator_period_s`, from t = 0) the engine sends a `RegulatorRequest` and waits for a `RegulatorResponse`. The regulator decides before the trackside cycle of the same step, so a decision reaches the interlocking at once. Types are in `src/core/types.ts`.

### Request

```json
{
  "type": "regulator", "version": 1, "start": false, "t": 405,
  "trains": [
    { "id": "R 5101", "engine": 2, "category": "Regional EMU (4 cars)", "dir": 1, "active": true, "finished": false,
      "s_m": 10402.2, "v_kmh": 0, "at_station": "San Felice Scalo", "next_station": "San Felice Scalo",
      "delay_s": -116.6, "track_now": "I", "broken": true, "broken_until_s": 1000,
      "traction_factor": 1, "brake_factor": 1, "priority": -2,
      "stops": [
        { "station": "Ponte Sabato", "s_m": 5200, "planned_arrival_s": null, "planned_departure_s": 100,
          "arrival_s": null, "departure_s": 100, "min_dwell_s": 20, "track": null, "skipped": false,
          "realised_arrival_s": 40, "realised_departure_s": 101.3 },
        { "station": "San Felice Scalo", "s_m": 10400, "planned_arrival_s": 440, "planned_departure_s": 560,
          "arrival_s": 440, "departure_s": 1030, "min_dwell_s": 20, "track": null, "skipped": false,
          "realised_arrival_s": 323.4, "realised_departure_s": null },
        { "station": "Monte Clanio", "s_m": 15000, "planned_arrival_s": 900, "planned_departure_s": null,
          "arrival_s": 1370, "departure_s": null, "min_dwell_s": 20, "track": null, "skipped": false,
          "realised_arrival_s": null, "realised_departure_s": null }
      ] }
  ],
  "disruptions": [
    { "id": 0, "type": "train_stopped", "train": "R 5101", "since_s": 400, "until_s": 1000,
      "text": "Train R 5101 breaks down and cannot move for 600 s" }
  ],
  "routes": [ { "id": "San Felice Scalo/3", "name": "Departure from San Felice Scalo track I", "state": "free" } ]
}
```

- `trains` lists every train of the run: the controlled one (`"train"`) and the services, also those not yet appeared (`active: false`) and those arrived (`finished: true`).
- Positions are line chainages, whatever the direction of the train.
- `stops` keeps three timetables side by side:
  - the **plan** (`planned_*`), which never changes and is the reference for delays;
  - the **current** one (`arrival_s`, `departure_s`), with the decisions already taken;
  - the **realised** one (`realised_*`).
- `delay_s` is the delay at the last event, an arrival or a departure, measured against the plan.
- `disruptions` are the scenario faults in force: broken trains, line blocks, degraded brake and traction, failed points and sections, speed restrictions. `until_s` is the expected end when the event has a duration, otherwise `null`: the regulator then does not know when it ends.
- `routes` (interlocking trackside only) is the state of the station routes from the last panel.
- The example is the request at 405 s of `services/breakdown` (only R 5101 and one route shown): the reference regulator has already lowered the priority of R 5101 and moved its departure to 1030 s, and the arrival at Monte Clanio follows (1370 s).
- The first request (`start: true`) also carries `configuration`: the line, its stations, the signalling, the trackside, the conflict rule and, with the interlocking, the station routes with station and branches.

On a network the configuration carries `network` (its lines, the first being the main one, with their stations), every train its `route` and `position` (the line its head is on and the chainage there), every stop its `line`; `s_m` and `dir` of a train refer to the main line when its route uses it. With connections the request carries `connections`, with their maximum wait and outcome.

### Response

```json
{
  "commands": [
    { "type": "priority", "train": "R 5101", "value": -2 },
    { "type": "retime", "train": "R 5101", "station": "San Felice Scalo", "departure_s": 1030 },
    { "type": "retime", "train": "R 5101", "station": "Monte Clanio", "arrival_s": 1370 }
  ],
  "log": ["R 5101: priority -2 (broken down)", "R 5101: departure from San Felice Scalo moved to 1030 s (0:17:10) (broken down)"]
}
```

This is the answer of the reference regulator at 400 s, when the breakdown begins. Had the departure route of R 5101 already been set, it would also have sent `{ "type": "operator", "command": { "type": "cancel_route", "id": "San Felice Scalo/3" } }`.

| Command | Fields | Effect |
| :-- | :-- | :-- |
| `retime` | `train`, `station`, `arrival_s`, `departure_s` | New times at a stop not yet left. A train standing at the stop keeps its arrival; a service waits for the new departure, a starting signal stays red until it. With the interlocking, automatic route setting receives the new timetable. |
| `skip_stop` | `train`, `station` | The service passes a station where it was timetabled to stop. Not for the origin, the destination or the controlled train, whose stops are those of the line. |
| `cancel` | `train`, `from_station` | Cancellation. Without `from_station` a train not yet appeared is cancelled entirely, a train on the line ends at its next station; with it, the train ends at that station. The stops after it are removed, and on arrival the train leaves the line (taken out of service). Not for the controlled train. |
| `track` | `train`, `station`, `track` (`I`, `II`) | The track to use in the station (interlocking trackside). |
| `priority` | `train`, `value` | Priority in conflicts, default 0, the higher first. Interlocking: it comes before the conflict rule, and a departure waits for a train with higher priority approaching the station. Single track: it decides the consent before the timetable. |
| `operator` | `command` | A control centre command for the interlocking (`set_route`, `cancel_route`, `ars`, `emergency_stop`…, see [TRACKSIDE.md](TRACKSIDE.md)). |
| `reroute` | `train`, `route` | On a network: a train not yet appeared runs along these lines (ids in running order). The stops not on the new itinerary are passed; origin and destination must stay. |
| `connection` | `from`, `to`, `station`, `max_wait_s` | New maximum wait of a connection still pending; 0 means the departing train no longer waits. |

A command that cannot be applied, such as an unknown train, a stop already left or an operator command without the interlocking, is not an error of the run. It goes to the log as a warning (*Regulator: retime ignored, …*) and the run continues. The lines of `log` go to the log of the run as *Regulator: …*.

The timetable written by headless runs (`_timetable.json`) and returned by `timetable()` keeps the plan and adds, only where they exist, the decisions: `rescheduled_arrival_s`, `rescheduled_departure_s`, `skipped` and, for the train, `cancelled` (`all` or `partial`). The open data feeds publish them as real-time information ([OPEN_DATA.md](OPEN_DATA.md)): new expected times, `SKIPPED` stops and `CANCELED` trips in GTFS-Realtime, cancelled calls and journeys in SIRI.

## The reference regulator

`ReferenceRegulator` (`src/regulator/index.ts`) is deliberately simple. It is a baseline against which a research regulator can be compared, not a good regulator. It applies five rules, with the parameters of `REGULATOR_PARAMETERS`:

1. **Priorities.** A broken-down train gets −2, a train with traction or brake below 70 % gets −1, the others 0. It does not favour categories: with equal priorities the conflict rule of the interlocking decides as without a regulator.
2. **Rescheduling.** A delay of more than 60 s is carried over the next stops. The arrival becomes the planned one plus the delay. The departure is not before the arrival plus the minimum dwell, nor before the plan, so the slack in the timetable absorbs the delay. Times are sent only when they differ from the current ones by more than 20 s.
3. **Breakdowns.** The departure of a broken-down train is moved to 30 s after the expected end of the fault. If the end is unknown, the departure is kept 2 minutes ahead and pushed on at every cycle. A departure route already set for the train in its station is cancelled, if another train of the same direction is in the station or approaching it: the cancellation is delayed by 120 s when the RBC has already granted the route. When the fault ends, a train standing in the station leaves at once.
4. **Line blocked.** A train that would run into a blocked stretch is held at the last station before it, until 30 s after the expected reopening (or 2 minutes ahead while the reopening is unknown). The train does not stop in open line at the protecting signal.
5. **Cancellation.** A train broken down at its platform with no expected end of the fault is taken out of service there after 10 minutes: it ends at that station, and its next stops are cancelled. In the scenario `services/cancellation` R 5101 breaks down at San Felice Scalo with no end; the controlled train passes it on track II and arrives at Monte Clanio at 847 s, and after ten minutes R 5101 ends there. Without a regulator the controlled train stays behind it, because route setting keeps giving precedence to the train timetabled earlier.
6. **Connections.** A connection that the feeder can no longer make within the maximum wait is released (`connection` with `max_wait_s` 0). The earliest arrival of the feeder is its timetable plus its delay, and not before the end of its breakdown when that is known. In `services/branch-shuttle` with the controlled train broken down for 600 s, the shuttle leaves San Felice Scalo on time; without the regulator it waits 300 s and loses the connection anyway.
7. **Reroute.** On a network, a train not yet appeared whose route runs along a blocked stretch of the main line, with no reopening before it gets there, is sent along the shortest other route that avoids it (the simple paths of up to four lines through the nodes); the stops not on it are passed. In `services/loop-reroute` R 3101 goes from Ponte Sabato to Pietrarsa on the link, passes San Felice Scalo and arrives at Rocca Sabato at 1788 s; without the regulator it waits for the reopening and arrives at 4099 s. Rule 4 holds a train only if its route runs along the blocked stretch.

Three cases show what it changes, with the same data as `verify-regulator`:

| Situation | Without regulator | With the reference regulator |
| :-- | :-- | :-- |
| `services/breakdown`: R 5101 breaks down on track I of San Felice Scalo for 600 s, the controlled train arrives on track II | ARS gives the exit to R 5101 at its timetabled time; the controlled train waits until the fault ends and arrives at Monte Clanio at 1286 s | R 5101 loses priority and its departure moves to 1030 s; the controlled train leaves first and arrives at 847 s. R 5101 arrives at 1202 s in both cases |
| the same breakdown one second after the departure of R 5101: its exit route is already set | the controlled train waits for the end of the fault, 1447 s at Monte Clanio | the regulator cancels the route, ARS holds R 5101 for the train with higher priority, the controlled train arrives at 882 s; R 5101 at 1363 s in both cases |
| line blocked from 7.000 to 7.400 km between t = 200 and 500 s, with automatic block, ETCS or the interlocking | the train stops at the protecting signal, in open line at 6.56 km | the train waits at Ponte Sabato (5.4 km) and leaves at 530 s: about 60 s more on arrival, but no train stranded between stations |

The last case is a real trade-off and shows what a regulator is for: the rule costs a minute and buys a train at a platform instead of in a cutting. Whether it is worth it is a policy, and the policy is what a research regulator would change.

## Writing a regulator

`examples/regulator/regulator_stdio.ts` is the reference regulator as a process (one JSON line in, one out). `examples/regulator/regulator_example.py` is a minimal regulator in Python: it lowers the priority of broken trains and holds trains before a blocked stretch. Both are templates.

A few guidelines:

- **Answer every request**, also with `{"commands": []}`: the run waits.
- **Send decisions on change**, not at every cycle. Commands are idempotent, but each retime of a standing train recomputes its departure.
- **Use the plan for delays and the current timetable for decisions.** The `stops` show both.
- **Do not count on safety.** A regulator that sets two trains against each other only gets refused routes and red signals: the interlocking and the RBC are below it.

The regulator is deterministic as long as the program is: `verify-regulator` checks that the reference regulator via `exec:` gives a run identical to the in-process one.

## What it corresponds to

YuTreno's regulator protocol is its own. It follows the same division of work as the reference architectures of European control-command:

- In the RCA architecture of the EULYNX and EUG consortium, planning and rescheduling belong to the traffic management system (TMS-PAS).
- TMS-PE executes the operational plan by asking the safety layer to allocate the elements, without being responsible for safety.
- The interface between the two (SCI_1) carries, for each train run, the precise path, the order of use of the tracks, the time constraints at the network points and the planned limitations of capacity. Back, it carries the state of execution, including the capacity lost to faults.

YuTreno's requests and responses are much smaller:

- the stations take the place of the network points;
- the tracks I and II take the place of the precise path;
- the priorities take the place of the order of use.

The idea is the same: decisions on the plan go one way, the state of execution comes back.

Real-time rescheduling is a research field of its own: retiming, reordering, rerouting and cancellations, by heuristics or optimisation models. Projects such as ON-TIME have tested such methods with simulated traffic. YuTreno does not implement them; it offers a deterministic test bench where they can be compared on the same disruptions, with the protection always in the loop.

Sources:
- [RCA TMS-PE component specification, RCA.Doc.19 v0.0.7, EULYNX and ERTMS Users Group, 2019](https://public.3.basecamp.com/p/DCGx8enamwvLtQBYnCcn2Eee/upload/download/RCA_TMS-PE_specification.pdf)
- [RCA SCI_1 specification (TMS-PAS – TMS-PE)](https://public.3.basecamp.com/p/ofsxC3P8zyZRKXJn7nqbS6rJ/upload/download/RCA_SCI_1_specification.pdf)
- [Europe's Rail, Traffic CS system concept](https://rail-research.europa.eu/wp-content/uploads/2025/03/Traffic_CS_System_Concept.pdf)
- [The ON-TIME real-time railway traffic management framework, TU Dresden](https://fis.tu-dresden.de/portal/de/publications/the-ontime-realtime-railway-traffic-management-framework(9a932df1-ff25-4bc4-94cc-fe29a390bc1d).html)
