# Trackside: interlocking and RBC

At first the YuTreno trackside was a simple RBC inside the engine. It computed the movement authority from the position of the train ahead and from the block signals, without points, routes or track circuits. It was enough to test an onboard, but it said nothing about how an authority really comes about: from routes set by an interlocking, on elements that can fail.

The trackside component (`src/trackside/`) adds this piece. It is an interlocking that moves points and reads track circuits with EULYNX telegrams, plus an RBC that builds the authority from the routes of the interlocking. The engine simulates only the field, that is points and track circuits, and talks to the trackside through a request-response protocol. The same class runs in-process or as an external program, like the ETCS onboard and the external dynamics.

This document explains how it is made, what it takes from the standards and what is instead invented or simplified. The last part is the most important, because it says where the results obtained with this trackside cannot be transferred to a real system. The design of the code is in [design/interlocking-trackside.md](design/interlocking-trackside.md).

## How it is chosen

The trackside is chosen in the conditions of the scenario (`trackside`) or with the `--trackside` option of headless runs:

| Value | What it does |
|---|---|
| `simple` | the RBC of the engine, as before (default) |
| `interlocking` | the trackside component in-process: interlocking and RBC |
| `exec:command`, `tcp://`, `ws://` | the same protocol towards an external program (`trackside: 'external'`) |

The interlocking trackside requires ETCS and a message-based onboard, that is the reference onboard or an external one. With the automatic block and SCMT the option is ignored, with the internal simplified onboard the engine rejects the configuration. In the page there is the **Trackside** menu next to the onboard one, and with the interlocking trackside the **control centre panel** appears.

```
npm run headless -- --onboard reference --trackside interlocking
npm run headless -- --onboard reference --trackside "exec:npx tsx examples/trackside/trackside_stdio.ts"
npm run headless -- --scenario scenarios/trackside
```

With the simple trackside no number changes: the 48 runs of the reference campaign give the same results as before the interlocking existed.

## Architecture

The boundary runs between the field, which is in the engine, and the logic, which is in the trackside.

- **The field** (`Field` in `src/core/field.ts`) is physics only. Points move in a fixed movement time and can be blocked, lose the detection of their position or be trailed. Track circuits are occupied when a train is on them, on the right branch: between the two points of a station the train is on track I or on track II, according to the position of the entry point when the head passed it. If the exit point is not set for the branch the train arrives from, the field reports a trailed point. The field can also lower the speed allowed on the diverging branch.
- **The interlocking** (`Interlocking` in `src/trackside/interlocking.ts`) knows the elements only from the telegrams. It moves the points and manages the routes: setting, detection, occupation, release and cancellation.
- **The RBC** (`TracksideRbc` in `src/trackside/rbc.ts`) receives the position reports of the onboard and builds the authority from the routes the interlocking considers valid.
- **`Trackside`** (`src/trackside/index.ts`) puts interlocking and RBC together behind the protocol.

At every trackside cycle (0.1 s by default) these things happen in order:

1. the engine sends the trackside the field telegrams, the radio messages of the onboard and the control centre commands;
2. the interlocking updates the state of the elements;
3. the RBC reads the messages of the onboard;
4. the control centre commands go to the interlocking or to the RBC;
5. the interlocking advances the routes and automatic route setting;
6. the RBC computes the authority.

The response carries the commands for the elements, the radio messages for the onboard, the panel state and the events to log. The in-process onboard exchanges before the trackside, so the trackside receives the messages of the same cycle; with an external onboard or trackside the order is the same. The external trackside via `exec:` therefore produces a run identical byte for byte to the in-process one, and `verify-trackside` checks it.

The protocol is a public interface, like that of the onboard. The types are in `src/trackside/types.ts` (`TracksideRequest`, `TracksideResponse`). The first request has `start: true` and contains the complete `configuration`, that is elements, routes, balises, line and timetable. The following ones contain only the changes:

```json
{ "type": "trackside", "version": 2, "start": false, "t": 12.3, "dt": 0.1,
  "field": [ { "interface": "SCI-TDS", "message": "Msg_TVPS_Occupancy_Status", "sender": "Line/B3", "receiver": "IXL", "Occupancy_Status": 2, "Change_Trigger": 1 } ],
  "radio": [ { "NID_MESSAGE": 136, "...": "..." } ],
  "commands": [ { "type": "set_route", "id": "Ponte Sabato/2" } ] }
```

```json
{ "field": [ { "interface": "SCI-P", "message": "Cd_Move_Point", "sender": "IXL", "receiver": "Ponte Sabato/1", "Commanded_Point_Position": 2 } ],
  "radio": [ { "NID_MESSAGE": 3, "...": "..." } ],
  "panel": { "ars": true, "routes": [], "points": [], "tvps": [], "ma": null, "speed_restrictions": [] } }
```

**On a network** ([design/network.md](design/network.md)) the configuration is that of the main line with the optional field `network`, and a trackside that does not need networks can ignore everything below. `network.interlockings` has one entry per other line (its elements, routes, markers, stations and the timetables of the trains along it, in its chainages; its sites are prefixed with the id of the line); `network.boundaries` lists the nodes between two interlockings with the one that holds the consent at the start; `network.corridors` gives, for every train that runs off the main line, its balise groups and the legs of its corridor (line, direction, origin in the corridor and on the line, bounds, `null` for unbounded). Some fields only appear on a network: points of type `junction` with the line they lead to, routes with `link` (`line`, `side` `out` or `in`, `boundary`), markers with `node`, timetable entries with `from_line` and `to_line`, the `line` of a `timetable` command, the command `corridor` (the new corridor of a train rerouted before it appears), and sessions in the panel with `frame: "corridor"` when the authority is in the chainages of the corridor. The sessions of the panel also list the `routes` their authority runs over, on a network and on a single line. The reference trackside runs one interlocking per line and a single RBC; the boundary consent travels between the interlockings with one cycle of delay and, on the line that ends at the node, goes with the block consent of the segment next to it.

`examples/trackside/trackside_stdio.ts` is the template for writing a trackside in another language, or for connecting a real interlocking simulator: one line of JSON per message, on stdin and stdout. A trackside written for version 0.x speaks protocol version 1 with Italian names (`tipo: "terra"`, `campo`, `comandi`, `quadro`) and is connected with `--protocol 1`.

## What comes from EULYNX

Between interlocking and field the telegrams are those of EULYNX Baseline 4 Release 4. Message names, field names and codes are those of the documents; the byte encoding is missing. These are used:

- **SCI-P** (Eu.Doc.38, point):
  - `Cd_Move_Point`, with Commanded_Point_Position 0x01 right and 0x02 left;
  - `Msg_Point_Position`, with Reported_Point_Position 0x01 end position right, 0x02 left, 0x03 no end position, 0x04 unintended position;
  - `Msg_Movement_Failed`;
  - `Msg_Ability_To_Move_Point`, with 0x01 able to move and 0x02 unable to move.
- **SCI-TDS** (Eu.Doc.44, train detection): `Msg_TVPS_Occupancy_Status`, with Occupancy_Status 0x01 vacant, 0x02 occupied, 0x03 disturbed and Change_Trigger 0x01 passage, 0x04 failure, 0x05 initial state.

The normal position of a point, right or left, is a design datum of the control table. The interlocking uses it to translate normal and reverse into the EULYNX right and left commands.

The interfaces between interlocking and RBC (SCI-RBC) and between interlocking and control centre (SCI-CC) are not published in Baseline 4 Release 4: those of YuTreno are its own. The RBC reads routes and element states from the interlocking. In exchange it gives it the train position and the routes already included in an authority, which are needed for the delayed cancellation. The control centre sends commands (`OperatorCommand`) and receives the panel (`PanelState`). The standards are discussed in [STANDARDS.md](STANDARDS.md#eulynx-interlocking-and-field-elements).

## The control table

Routes are not written by hand in the interlocking configuration. They are described in an RFI-style **control table** (*Tabella delle Condizioni*, `ControlTable` in `src/trackside/control-table.ts`), one per site, and `translateControlTables()` converts it.

For every site the table lists the elements:

- points, with chainage, normal position, reverse branch, type and movement time;
- track circuits, with the track they are on;
- signals or ETCS stop marker boards.

For every route it gives:

- origin and end;
- the points with the required position, in the notation `1N` and `2R`;
- the track circuits to check vacant, in order;
- the overlap beyond the end, with length and track circuits;
- the diverging speed;
- the conflicting routes;
- the release mode.

The translator checks that every element mentioned is declared and collects the warnings. It then completes the declared conflicts with those that follow from the elements: two routes conflict if they use the same point in different positions or have a track circuit in common.

The format is a **reconstruction** of Italian practice made for YuTreno, not an RFI document. Names and structure follow what is found in the schematic plans and control tables of an Italian computer-based interlocking (ACC). It must however be validated by interlocking designers, especially for conflicts, overlaps and release.

For the example lines the tables are generated by `generateLayout()` (`src/core/field.ts`). Every intermediate station has:

- a main track I and a loop II;
- an entry point 300 m before the station building and an exit point 310 m after it;
- four routes: entry on I and on II, departure from I and from II, with the diverging branch at 60 km/h;
- a first block section after the station, which belongs to the departure routes.

The origin has only the departure and the terminus only the arrival. The line is a site of its own, with an automatic route for every block section; its elements are named `Line/…`.

**Both directions.** When some service runs towards the origin, `generateLayout(L, { reverse: true })` adds the routes of the reverse direction over the same elements:

- in every intermediate station, the entries from the far side on I (point 2 normal) and on II (point 2 reverse, 60 km/h), with the points zone at the near side as overlap, and the departures from I and II towards the origin;
- the departure from the terminus and the arrival at the origin;
- the line block run from the end towards the origin, one route per block section.

The reverse routes have their own stop markers (`RH`, `RP_I`, `RP_II`, `REND` in the stations, `Line/RB…` at the section boundaries). On ETCS level 2 they are marker boards, so no lineside signal is needed. Routes of the two directions that share a section, or where the overlap of one is the path of the other, are conflicting. Without trains towards the origin the tables stay those of the nominal direction only, byte for byte.

## The interlocking

A route goes through these states:

1. **free**;
2. **setting**: the request is accepted if no conflicting route is active, if the sections of the path and of the overlap are vacant and if the points are not locked by other routes and can be moved. Sections and points are locked and the points commanded;
3. **set**: all points are detected in the required position. If this does not happen within 20 s the route fails and is released;
4. **occupied**: the train has entered;
5. **free** again, with sectional release. Every section is released when the train has occupied it and then left it, and the points it contains are unlocked with it (and go back to normal). The route is released when the sections before the destination are released and the train occupies the destination.

A set route that loses its integrity is no longer valid for authorities, until it becomes intact again or is cancelled. It happens if a point loses its detection or if a section is disturbed.

The cancellation of a set route is immediate, but becomes **delayed** (120 s) if the RBC has already granted an authority that includes it. It is the simple version of approach locking: a train that has already received the authority might no longer be able to stop before the point. An occupied route is not cancelled and is released as the train passes.

The block sections on the line are always set automatically, as soon as they are vacant. With routes in both directions every single-track segment between two stations has a **block consent**, held by one of the two stations at its ends, and only that station can send trains into the segment. At the start it is held by the station on the side of the origin. The automatic block of the segment works in the direction of the consent.

A departure from the other end asks for it. The station that holds the consent gives it only if the segment is empty: no departure into it is active and all its sections are vacant. It then releases the idle block routes of its direction and sends the consent. Otherwise it refuses, and the other end asks again after 2 s. The departure waits meanwhile (*waiting for the block consent from …*).

Every message reaches the other end one cycle later, as between two adjacent interlockings. While the consent travels neither end holds it, so the two ends can never hold it together, not even if they ask in the same cycle. EULYNX gives the line block between adjacent interlockings to the interface SCI-ILS, without fixing its telegrams; the messages here (request, grant, refuse) are YuTreno's. Every transfer goes to the log (*Block consent Ponte Sabato–San Felice Scalo given to San Felice Scalo*), and the panel shows who holds each consent (`consents`). The station routes are set by **automatic route setting** (ARS) for every train in session, the controlled train and the service trains, each according to its own timetable (`configuration.trains`, one entry per `NID_ENGINE`), and the control centre can disable it:

- **entry**: when the train has left the previous station and is less than 3500 m from the home signal. Track I is chosen. Track II is used only if the train is less than 1500 m away and track I is still occupied. So a train ahead that is about to clear the main track does not send the regional train onto the loop without reason;
- **departure**: at the departure time, from the track the train entered. The interlocking knows it from the entry route released with the train on the destination; at the origin it is track I. A station where the timetable has no stop is a **pass**: the departure is requested together with the entry, within the same approach distance, from the track of the entry granted, so that a train running through finds the exit already set. The order of a pass for the conflict rule is its departure from the previous station, the same key other trains see for it.

A stop of the timetable can ask for a track (`"track": "II"` in the scenario): ARS then uses only that one, which is how a timetable plans an overtaking, a slow train waiting on track II while a faster one passes on track I.

When two trains want routes that conflict, typically the same exit of a station, the **conflict rule** (`parameters.conflict_rule`, from the scenario field `conflict_rule`) decides who asks first:

- `timetable` (default): a departure waits while a train timetabled earlier at the same station is approaching it (within the entry window) or standing in it on the other track. The interlocking logs *ARS: departure from … held for a train timetabled earlier*. A late train thus keeps its slot, as a regulator following the timetable would decide;
- `first_come`: requests are made in the order the trains became ready, without looking at the timetable.

Neither rule reschedules, changes priorities or cancels a slot that a broken-down train cannot use: that is the job of the regulator ([REGULATOR.md](REGULATOR.md)). It speaks to the interlocking with two more control centre commands: `{ "type": "priority", "engine": 2, "value": -2 }` gives a train a priority (default 0) that comes before the conflict rule, so that a departure also waits for a train with higher priority approaching the station; `{ "type": "timetable", "engine": 2, "timetable": [...] }` replaces the timetable that automatic route setting follows for that train. The scenario `services/precedence` shows the difference: with `timetable` the controlled train, late after a breakdown, still leaves San Felice Scalo before R 5101 and arrives at Monte Clanio at 939 s; with `first_come` R 5101 leaves first and, slowed by a traction fault, holds the controlled train behind it until 983 s.

## The RBC

The RBC takes the position of the train from report 136: reference balise group, distance run and uncertainty. It builds the authority as a chain of consecutive routes on the branch of the train:

1. the first is the route that contains the head, or that the head is entering;
2. the routes that start where the previous one ends are added, on the same branch, set, intact and with vacant sections;
3. a route already included in the previous authority stays valid even when it is occupied. The RBC knows the train only from the last report, and without this rule it would treat as another train the train itself that has just entered the route.

A train running towards the origin reports `Q_DIRLRBG` = 0. For it the RBC works in the chainages the train sees, those of the line mirrored: it uses the reverse routes and markers and sends packets with `Q_DIR` = 0, distances counted from the LRBG in the direction of running and profiles mirrored, gradients with the opposite sign. This is the same rule as the simple RBC.

The RBC keeps **one session per train**, keyed by the `NID_ENGINE` of its reports. With several sessions the first route of the chain must be one already granted to that train: track II has the same chainages as track I, so a train standing on track I would otherwise look as if it were inside the entry route to track II set for another train. Messages to the controlled train (engine 1) go out as before; messages to the other trains carry `NID_ENGINE`, which the engine uses to deliver them and removes. The interlocking receives from the RBC the positions of all the trains in session (`RbcInfo.trains`) and the union of the routes covered by their authorities. The control centre emergency stop applies to one train (`engine`) or, without it, to all; the panel lists the sessions when there is more than one.

The EOA is the end of the last route of the chain. The SvL is the end of its overlap, if the overlap sections are vacant; otherwise it coincides with the EOA. At the arrival at the terminus the authority reaches the end of the line. The distances of packet 15 are rounded down, so that the transmitted EOA never falls beyond that of the interlocking.

Message 3 contains:

- packet 15;
- the static speed profile (27), with the diverging speeds of the routes overlaid on the line limits;
- the gradients (21);
- the linking to the balises (5);
- the temporary speed restrictions (65 and 66).

It is sent at every change and anyway every 5 s. The emergency stop of the control centre sends message 16 and holds back every new authority until the control centre revokes it. The scenario event `rbc_emergency_stop` stays instead the single order of before: stop and revocation at the next cycle, then the train restarts from standstill at the first authority.

## Several RBCs and the handover

A real line is divided between several RBCs, and a train crossing the border between two of them passes from one to the other without the driver doing anything: this is the RBC/RBC handover of Subset-026 (§3.15.1 and §5.15), with the dialogue between the two RBCs of Subset-039. Since phase 10 the interlocking trackside does it on a single line.

**How it is declared.** The scenario gives the chainages of the borders, `"rbc_borders_m": [7600]`. The engine places each border on the nearest main signal (7725 m on the Valle Lauro line) and takes as border balise group the group within 100 m before it, then passes the trackside the optional field `rbcs` of the configuration: the areas (`NID_RBC`, `from_m`, `to_m`, numbered from 1 from the origin), the borders (chainage, `NID_BG` and position of the border group, the RBCs on either side) and, optionally, the period of the life sign and the time after which the link between two RBCs is lost (`life_sign_s`, 10 s, and `link_timeout_s`, 30 s). The interlocking stays one for the line; each RBC sees only the routes and markers of its own area. Without `rbcs` there is one RBC as before, and no run changes. With the simple trackside the field is ignored; on a network the engine refuses it, because borders at a node are not done yet.

**Radio messages.** With several RBCs every message from an RBC carries `NID_RBC`, the RBC that sends it, and every message from the onboard `NID_RBC`, the RBC it is addressed to. The trackside routes the messages of the onboard by this field (without it, to the RBC that has the train in session, otherwise to the area of its LRBG); a message for an RBC that does not exist is discarded with a warning in the events. The field is optional: with one RBC it is absent.

**The procedure**, seen from the Handing Over RBC (HOV) and the Accepting RBC (ACC), as in the state tables of Subset-039 §4.6:

1. when the authority of the HOV reaches the border, the HOV sends the ACC the **pre-announcement** (201) with the engine, the border group, the mode and the direction, and adds to its message 3 **packet 131**, the transition order, with the distance to the border and the identity of the ACC;
2. the ACC **acknowledges** (205) and the HOV **requests the route related information** (202);
3. the onboard opens its second session, with the ACC, and from then on sends its position reports to both. Once the train is in session with it, the ACC sends the **route related information** (221) with packets 15, 21 and 27 referred to the border group: the authority it would give beyond the border, with its speeds and gradients. It sends a new one whenever that authority changes. The HOV acknowledges each one and extends its own authority with it: beyond the border it sends the onboard only what the ACC sent (§3.15.1.2.4);
4. when the front end of the train, with its odometry uncertainty, passes the border, the HOV sends the **announcement** (203) and the onboard, at its next report to the ACC with the front end beyond the border, switches supervision to the ACC, using the messages of the ACC it had stored. The ACC answers with the **taking over of responsibility** (222);
5. from then on the HOV sends no authority. When a report puts the min safe rear end past the border (the confirmed rear end: the reported front end minus the confirmed train length `L_TRAININT`, from the last report with integrity confirmed, `Q_INTEGRITY` 1 or 2), it orders the onboard to **terminate the session** (message 24 with packet 42, `Q_RBC` = 0); the onboard sends message 156 and the HOV closes the session with message 39. If the order does not come, the onboard repeats the report of its rear end three times every 15 s and then terminates by itself (§3.15.1.3.9, Appendix A.3.1);
6. a **cancellation** (204) is sent by the HOV if the train ends its mission during the transaction; the ACC then orders the onboard to terminate the session it had opened.

Every RBC sends a **life sign** (223) to its neighbours every 10 s. If nothing arrives for 30 s, or the control centre cuts the link, the transaction is aborted (Subset-039 §4.4): the HOV keeps its authority at the border and starts again when the link is back.

The RBC/RBC messages are JSON objects with the Subset-039 names (`NID_NRBCMESSAGE`, `NID_C`, `NID_RBC`, `NID_ENGINE`, `NID_BG`, `T_RBC`, `M_ACK`, `T_RBC_ACK`, `M_MODE`, `Q_DIR`, `packets`; type `NrbcMessage` in `types.ts`). They stay inside the trackside and are delivered with one cycle of delay, so that the order in which the RBCs run does not matter and the run is deterministic. The panel lists, for every RBC, the trains in session and the handovers in progress with their role and step (`rbcs`), and the state of the link (`rbc_link`); the authority and the sessions carry the `NID_RBC` that gives them.

**An implementation choice.** The ACC sends the route related information only once the train is in session with it as well, and uses the authority it gives that train. Subset-039 allows it to send it as soon as it is requested; but then a train whose radio could not reach the ACC would receive from the HOV an authority beyond the border, and would run into an area whose RBC does not know it. In this way a train that cannot reach the ACC stops at the end of the authority of the HOV, as §5.15.4.2 requires.

**Faults.** Two scenario events act on the handover: `{ "type": "radio_loss", "rbc": 2, ... }` cuts the radio of one RBC only, in both directions, and the control centre command `{ "type": "operator_command", "command": { "type": "rbc_link", "up": false }, "duration_s": 300 }` cuts the link between the RBCs for the duration given. In both cases the train stops before the border and continues when the fault ends.

**What the handover does not do.** The onboard needs two radio terminals: the degraded case with one GSM-R session (§3.15.1.3.2 and §5.15.3) comes after the phase (decision 14). The border balise group does not carry packet 131, so the announcement comes only from the RBC and the onboard switches at the announced border (§5.15.1.4). The DMI shows no text of its own for the handover, since Subset-026 prescribes none; the panel shows the step of every handover. Train data (207), the train running number (208), the confirmation of a shortened authority (206, 224) and shunting (209) are not exchanged; successive handovers with an RBC that is accepting and handing over the same train at once are out of scope. The distances of the route related information are rounded down to the metre from the border group, and those of message 3 again from the last group of the train: the end of authority beyond the border may therefore be 1 m shorter than with one RBC, and comes up to 2 s later, after the setting of the route. The motion of the train does not change: in the nominal run, the crossing and the overtaking every other column of the data is identical to the run with one RBC.

## Scenarios and failures

Three types of scenario events apply only with the interlocking trackside:

- `point_failure`, with `element` (for example `"Ponte Sabato/1"`), `mode` `blocked` or `no_detection` and an optional duration;
- `tvps_failure`, with `element` (for example `"Line/B3"`): the track circuit is disturbed;
- `operator_command`, with `command`: a control centre command at a given time or position.

The disruptions that hold for every trackside work here too: `line_blocked` disturbs the track circuits of the stretch, so no route is set through it until it opens again; `train_stopped`, `brake_degraded` and `traction_reduced` with `train` hit one service train, and ARS and the conflict rule see it as a late train ([SCENARIOS.md](SCENARIOS.md)).

The example scenarios in `scenarios/trackside/` all use the Valle Lauro line with the reference onboard:

| Scenario | What happens | Outcome with `ato.js` |
|---|---|---|
| `nominal` | the normal run with the whole trackside | passed, 1001 s |
| `point-failure` | the entry point of Ponte Sabato loses its detection: the entry is not set, the train stops before the home signal and restarts when the failure ends | passed |
| `tvps-failure` | a disturbed block section stops the train until the track circuit is back | passed, 1302 s |
| `overtaking` | a freight train stops on track I of Ponte Sabato: ARS sends the regional train onto track II on the diverging branch, the regional train leaves from II and overtakes the freight train | passed, 1167 s |
| `operator-commands` | the signaller disables ARS, sets the entry on II by hand and enables it again; later he stops the train with the emergency stop and revokes it a minute later | passed, 1059 s |
| `handover` | the nominal run with the line divided between two RBCs at 7725 m: the freight train and then the controlled train pass from RBC 1 to RBC 2 | passed, 1001 s, as with one RBC |
| `handover-link-loss` | without the freight train; the link between the two RBCs is lost from 200 to 500 s: the train stops before the border at 7687 m and continues when the link is back | passed, 867 s |
| `handover-radio-loss` | without the freight train; the radio of RBC 2 is lost from 200 to 500 s: the train cannot open its session with RBC 2 and stops before the border | passed, 867 s |

Since 7 November 2026 the train ahead is a freight service train (decision 12), and the controlled train follows it: the times above grew from 867, 880, 841 and 974 s. The general scenarios give the same outcome and the same counts with the interlocking trackside as with the simple one. Until then there was a difference in the counts, with the degraded brake: with the interlocking trackside the onboard counted 2 end-of-authority overruns that did not appear with the simple trackside. It was not a defect of the new trackside. In both cases the train reached the EOA at more than 30 km/h, because the onboard computes its curves with the nominal brake. The simple RBC however recomputes the authority from the position of the head: as soon as the head passes the signal, the EOA jumps to the next section and the overrun disappears. The interlocking holds the authority until the route is released, and the overrun showed. Behind the slower freight train the controlled train no longer reaches that EOA at speed.

## What is simplified

Here is the honest list, in order of importance for whoever uses the results.

1. **One interlocking for the whole line, and the train ahead.** The controlled train, the service trains of both directions and the train ahead (`leader`) each have a session and a timetable for ARS. Since 7 November 2026 the train ahead is a freight train with its own reference onboard, like the services: it reports its position and receives its authority from the RBC, and its onboard supervises it, so in `point-failure` and `tvps-failure` it no longer runs past an authority shortened under it. Its timetable passes every station, and where it stops its departure stays undecided until it is ready to leave; it has priority −1, so it gives way to the timetabled trains. When its run ends at the last station the engine sends End of Mission (message 150) on its behalf and the RBC closes its session; the services keep theirs. Before 6 November the train ahead ignored routes and signals, and in `operator-commands` it trailed the exit point of Ponte Sabato; until 7 November it was a kinematic train whose position the engine reported, without onboard supervision. The block consent is exchanged between the stations at the ends of each segment, but the interlocking remains one program for the whole line: routes, points and sections are not split between separate interlockings.
2. **No start of mission dialogue.** The session opens at the first position report; messages 155, 32, 159, 129 and 8 are missing.
3. **Shortening of the authority with a new message 3**, without the co-operative procedure of §3.8.6. The reference onboard accepts the shorter authority by replacement.
4. **Revocation of the stop without message 18.** The RBC stops holding back authorities and the onboard restarts at the first authority from standstill.
5. **Track II has the same chainages as track I.** The geometry of the diverging branch is missing: there is only the speed limit on the branch.
6. **No byte encoding and no PDI connection** towards the elements, hence no version check and no EULYNX initialisation procedures.
7. **Fixed parameters**: movement times (6 s), maximum setting time (20 s), cancellation delay (120 s), ARS windows (3500 and 1500 m), overlap (50 m). They are plausible, not taken from a standard.
8. **The control table is a reconstruction**, to be validated.

The traceability matrix (`docs/traceability/matrix.csv`) has a row for each EULYNX telegram used and for the unpublished interfaces. The Subset-026 rows on session, authority and emergency messages also cite the interlocking trackside.

## Checks

`scripts/verify-trackside.ts` checks:

1. **the translation**: the tables of the two lines translate without warnings, every route is followed by another one on the same branch and the two entries of the same station are conflicting;
2. **the interlocking alone against the field**, without engine: setting, conflicting routes, immediate and delayed cancellation with return to normal, point unable to move or without detection, sectional release before the end of the route, trailed point;
3. **the nominal runs** of the two lines with the interlocking trackside: complete, without interventions or overruns, deterministic;
4. **the general scenarios**: the same outcome with the simple and the interlocking trackside;
5. **the external trackside** via `exec:`: a run identical to the in-process one, also with two trains in session (`services/precedence`) and with trains in both directions (`services/crossing-interlocking`), without trailed points;
6. **the overtaking**: the train really runs on track II;
7. **the reverse layout**: on both lines, translation without warnings, the nominal routes unchanged, a continuous chain of routes in the reverse direction, opposing entries conflicting;
8. **the block consent**: a segment given to the first departure, refused to the opposite one, turned when empty;
9. **the handover** (HO1–HO7): the run with two RBCs is the same as with one, with the Subset-039 messages in the order of the procedure and the session with RBC 1 closed; with the link between the RBCs or the radio of RBC 2 lost the train waits before the border during the fault, without overruns or interventions; in both directions (`services/crossing-interlocking`) and with two trains (`overtaking`) every train hands over and runs as with one RBC; the external trackside via `exec:` gives the same run, deterministic; without the order to terminate, the onboard ends the session by itself 60 s later; an End of Mission during the transaction makes RBC 1 cancel it (204) and RBC 2 order the onboard to terminate the session opened with it; a message for an RBC that does not exist is discarded with a warning.

`verify-services` runs the crossing with the interlocking too: never two opposing trains on one single-track section, and a late opposite train that holds the controlled one.

The scenarios of `scenarios/trackside/` have their expected outcome recorded in `verify-scenarios.ts`. Each block is tagged with the matrix rows it covers.
