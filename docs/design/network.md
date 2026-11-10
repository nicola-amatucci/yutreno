# Network

Code: `src/core/network.ts`, `createNetworkService` in `src/core/trains.ts`, the traffic of several trains in `src/core/traffic.ts` (`occupantsFor`, `updateOrientation`, `heldSignals`, the node routes `buildGates`/`updateGates`/`gateAspects`, the appearance of the services `originFree`/`activate`, connections and blocks of rolling stock `waitConnection`/`linkBlocks`), and for the interlocking trackside `nodeMoves`, `lineTimetable`, `fieldTrainsOn` in `src/core/trackside-bridge.ts`, the node layout in `src/core/field.ts` (`addNodeRoutes`), the separate interlockings in `src/trackside/` (`Trackside`, `Interlocking` with the boundary consent, `TracksideRbc.computeMaCorridor`), built-in networks in `src/core/presets.ts`. Checks: `scripts/verify-network.ts`. Matrix rows: `YT-NET`, `YT-NODE`, `YT-IXL-NET`.

## What it is for

Until phase 3 YuTreno simulated a corridor: one line, run in both directions. A network adds lines that meet in nodes, so that a train can run from one line to another, two trains can join a line at a node, and later (phase 4 of the plan) connections, rolling stock circulations and rerouting become possible. This document describes step 4a: the model of the network, the itineraries of the trains, and the trackside of the engine (automatic block or ETCS with the internal supervision) on a network.

## The model

A network is a set of lines, each with its own chainage, like the net elements of the macroscopic level of the UIC RailTopoModel (IRS 30100), on which railML 3 is built. Nodes are not declared: a station with the same name on two lines is the same operational point, the node where a train can change line. The first line is the main one: the controlled train runs on it, and so do the train ahead and the scenario events with chainages (speed restrictions, low adhesion, blocked stretches).

```json
"network": "valle-lauro-rocca"
"network": { "name": "...", "lines": ["valle-lauro", { "id": "my-branch", "name": "...", "plan": [...], ... }] }
```

Every line keeps its own plan. `compileNetwork` places the lines in a common plan: starting from the main line, every line joined to an already placed one is translated so that the two points of the node coincide; its orientation is that of its own plan. The plan is used by the view and the open data; dynamics and signalling use only the chainages.

The built-in network `valle-lauro-rocca` joins the Valle Lauro line and the branch San Felice Scalo – Rocca Sabato (9.6 km, three stations, single track with two-track stations like the main line) at San Felice Scalo.

## Itineraries and corridors

A service can declare `route`, the lines it runs along in running order. Without it the train runs on the main line if the main line has all its stops, otherwise on the first line that has them all. `planItinerary` checks the route: consecutive lines must share exactly one station, every stop must be on the line of its leg and in running order; the errors name the train, the line and the station.

The itinerary is compiled into a **corridor** by `compileCorridor`: a compiled line like that of a single-line run, so that dynamics, supervision, the built-in driver and the observation stay one-dimensional and unchanged. The first leg runs from the start of its directed line to the node, the middle ones from node to node, the last one from the node to the end of its directed line (the directed line is the line itself or, against its direction, the mirrored line). Curvature, profile, limits, stations, tunnels and signals are taken from the directed lines and moved to the chainages of the corridor; the plan is that of the common frame; the heading continues from one leg to the next.

Two properties keep the single-line runs as they were:

- a corridor on a single line **is** the directed line, the same object (`L`, or the mirrored line built once): trains on one line share signals and limits exactly as before;
- every leg says where it comes from (`CorridorLeg`: line, direction, origin in the corridor and in the directed line, bounds). `onLine` gives where a train is on a line, in the chainages of the directed line, clipped to the legs on that line; for a one-line corridor it returns the head and the length unchanged, with the same floating-point operations as the old code. The traces of all the service scenarios of phases 2 and 3 are identical byte by byte.

The signals of a corridor of several lines are copies; `sigRef` says which signal of which line each one comes from. At every step the engine computes the aspects of every line and direction in use, then copies them onto the corridors (`copyAspects`). Temporary speed restrictions rebuild the limits of these corridors (`refreshCorridorLimits`).

## Signalling on a network

The rules of the single line apply to every line:

- the trains of a direction occupy the block sections of that direction on that line, for the part of them that is on the line;
- the trains of the other direction count only for the part of them on single track (in a station each direction has its own track);
- each single-track section of a line is oriented towards one direction at a time, with the same rule of phase 2 (the train that wants to enter, the earlier timetabled departure, the priority of the regulator);
- a starting signal stays red until the departure time of the nearest train behind it.

A train approaching a node from another line is already seen by the signals of the line it will join: `headOn` gives its head in the chainages of that line even before it gets there, so the orientation of the first single-track section after the node is requested in time.

### Node route

The block alone does not protect a node. A train coming from the branch towards Valle Lauro enters the station of San Felice Scalo on the track of the main line towards Valle Lauro, but its last signal belongs to the branch and sees only the trains on the branch; a train coming down the main line sees the branch train only when it has already entered the station. Without a further rule the two trains can end up on the same track (the check `NET-4` fails if the rule is switched off).

The rule is a **node route** for every line and direction that some train joins at a node from another line. The station of the node on that line is given to one train at a time:

- the trains that may enter it are those that join from another line, those that run along the line through the node, and those that start at the node;
- a train asks for the route when it is within 3000 m of the signal in front of the node; a free route goes first to a train within 1500 m of that signal (the nearest), then to the earliest one in the timetable at the node, then in the order of the trains;
- the owner keeps the route until its tail passes the starting signal after the node, or until it ends its run there;
- while another train holds the route, the signal in front of the node is red on the corridor of a joining train (the signal before it turns yellow), and on the line itself for the trains that run along it;
- a train that starts at the node appears only when the route is free, and takes it.

It is the simplest rule that keeps one platform track per direction exclusive. It is not an interlocking: there are no points, no flank protection, no conflict between the directions inside the node. On the interlocking trackside the rule is switched off and replaced by the routes of the separate interlockings (below).

## Connections and rolling stock circulations (steps 4c and 4d)

They are rules of the engine and work on a single line as well as on a network.

**Circulations.** `linkBlocks` chains the services of every block in the order of their departures and checks that each one starts where the previous one ended. The next service appears at its origin only when the previous one has arrived (`after`), and its doors close not before that arrival plus the minimum turnaround. The vehicle is not moved between platforms, coupled or split: the train that arrives disappears and the next service appears with the same parameters. The delay propagates in closed form, departure = max(timetable, arrival of the previous service + turnaround), and `NET-6` checks it to 0.01 s.

**Connections.** `waitConnection` keeps the doors of the departing train open while the feeder has not arrived plus the transfer time, but not beyond its departure plus the maximum wait; the outcome (kept or lost) and the wait are recorded when the doors close, in `connections` and in the realised timetable. The decision is a fixed rule of the station; with the regulator on the network (step 4e) it becomes a decision of the regulator. `NET-7` checks the three cases: feeder on time, late within the maximum wait (wait = arrival + transfer − departure), late beyond it (lost after the maximum wait).

## The regulator on a network (step 4e)

The regulator protocol gets optional fields on a network (the lines and stations in the configuration, `route` and `position` of every train, the line of every stop) and two commands: `reroute`, which gives a train not yet appeared a new itinerary, and `connection`, which changes the maximum wait of a connection. A reroute recompiles the corridor, removes the stops not on the new itinerary and rebuilds the node routes, keeping their owners. The reference regulator uses them in rules 6 and 7 ([REGULATOR.md](../REGULATOR.md)). The network `valle-lauro-anello` adds the link Ponte Sabato – Pietrarsa (9.6 km, with Casale Sabato), which closes a loop: it is the alternative route of `services/loop-reroute`. Its plan is a straight line drawn so that both ends fall on their stations.

## Separate interlockings (step 4b)

With ETCS, a message-based onboard and `trackside: 'interlocking'` (or `'external'`) every line of the network has its own interlocking, with its control tables, its field and its automatic route setting; one RBC builds the authorities for all of them.

**One interlocking per line.** The engine generates the control tables of every line as on a single line (`generateLayout`, with the reverse routes where some train runs against the direction of the line). The sites of the other lines are prefixed with the id of the line (`rocca-sabato:Pietrarsa/1`), so that elements, routes and branches have unique identifiers in the whole network; the main line keeps the identifiers it had. The configuration of the trackside is that of the main line, as before, with the optional field `network`: the other interlockings (`InterlockingConfig`, one per line, with the timetables of the trains that run along it), the boundaries between them at the nodes and the corridors of the trains that run off the main line. The engine simulates one field per line; a train is on the field of every line it is on, for the part of it that is on that line (`fieldTrainsOn`, from `onLine`). Telegrams carry unique identifiers, so the engine sends all of them in one list, as on a single line, and every interlocking takes its own.

**The node.** A node joins line A, where its station is intermediate (tracks I and II between points 1 and 2), and line B, which starts or ends there. In the built-in networks San Felice Scalo is intermediate on Valle Lauro and the origin of the branch; Ponte Sabato is intermediate on Valle Lauro and the origin of the link; Pietrarsa is intermediate on the branch and the end of the link. The station of the node belongs to the interlocking of A, which gets (`addNodeRoutes`):

- two junction points at the stop marker of the station, `J1` on track I and `J2` on track II, which in reverse lead to B; every route of A over track I locks `J1` normal, every route over track II locks `J2` normal, so a node route and a through route on the same track conflict on the point as well as on the track;
- node markers on tracks I and II at the junction, in the directions the trains use;
- for a movement from A to B, an entry route from the home signal to the node marker of track I or II, with point 1 (or 2 for the reverse direction) and the junction of that track reversed, with the diverging speed on track II; for a movement from B to A, a route from the node marker of track I or II to the starting marker of that track.

The interlocking of B ends at the node: it gets a route from the node to its first marker (into B) or from its last marker to the node (out of B), on the track of its terminal station. The movements generated are those of the itineraries of the trains (`nodeMoves`); a node that is not a two-track station on one line and the end of the other is refused with a message.

**The boundary consent.** A train crosses a node with a route out of one interlocking and a route into the other. The routes out need the consent of the node, a token held by one interlocking at a time (A at the start); the routes in need the other interlocking to hold it. An interlocking that wants a route out without the consent asks for it; the holder gives it only when none of its routes out towards the node is active, and a route out keeps its last section until the train has left it beyond the node. Requests, grants and refusals travel between the two interlockings with one cycle of delay, as the block consent between the two ends of a single-track segment, but here between distinct components (`BoundaryMessage`, delivered by `Trackside`). The telegrams are YuTreno's: EULYNX SCI-ILS carries the line block between adjacent interlockings, but its telegrams for this case are not published.

Two rules keep two trains in opposite directions from waiting for each other at a node. First, on line B the consent of the node goes with the block consent of the single-track segment next to the node: the interlocking of B gives that segment towards the node only while it holds the consent of the node (and asks for it otherwise), and gives the consent of the node away only with that segment empty and held at the node (asking it back from the far end when it is empty). So a train on the single track towards the node and a train in the node towards that single track cannot both be authorised; at the start the consent is with A when B starts at the node and with B when it ends there, the side the segment is open to. Second, a route into an interlocking from a node frees its overlap once the train in it has stood still for 30 s (timed overlap release): a train that came out of the branch and waits at the starting marker for the single track of the main line no longer blocks the entry of the opposite train it is waiting for. `NET-12` makes both situations happen and fails if either rule is switched off.

**Automatic route setting.** The timetable of a train for the interlocking of a line has the stations of that line from where the train enters it to where it leaves it, with `from_line` on the first one and `to_line` on the last one when the train comes from or goes on to another line (`lineTimetable`). At those stations automatic route setting chooses among the node routes of that line, and only there; elsewhere it ignores them. A train not yet on a line is placed where it would be if the line went on beyond the node it will enter by (`onCorridorLine`, marked `ahead`), so that the route into the node is asked for in time.

**The RBC.** There is one RBC for the whole network (the decision of the plan). A train off the main line has its balise groups along its corridor, as with the simple RBC, and the configuration gives the RBC those groups and the legs of the corridor. For such a train the RBC works in the chainages of the corridor: it moves the routes of every interlocking onto the corridor where the corridor runs along their line in their direction, takes a node route only where the corridor really changes line there, and follows a route out of one interlocking with the route into the next one, across the boundary (`computeMaCorridor`). The authority, the static profile with the speeds of the routes, the gradients and the linking are those of the corridor. The trains on the main line alone are served exactly as on a single line; for them the node routes and markers do not exist.

**Reroutes.** With a regulator the engine generates the node routes of every movement the control tables allow at every node, not only those of the itineraries, so that a reroute by the regulator finds its routes. The reroute of a train not yet appeared sends the trackside its new corridor (`corridor` command) and its timetables for every line (empty on the lines it no longer runs along); a reroute that would need routes the interlockings do not have (a line run against its direction where no train did so at the start) is refused with a message.

**Capacity.** The headway at the node is computed from the blocking times of the routes two different trains share and measured in `verify-capacity` (`CAP3`, [CAPACITY.md](../CAPACITY.md#capacity-of-a-node)).

**Left for later.** More than one RBC on a network: the handover of Subset-039 works on a single line since phase 10 ([TRACKSIDE.md](../TRACKSIDE.md#several-rbcs-and-the-handover)), a border at a node is not done; one interlocking per station rather than per line; nodes inside a station of both lines; the geometry of the junction and flank protection.

## What is not supported yet

A network runs with every trackside: automatic block with SCMT, ETCS with the internal supervision, ETCS with a message-based onboard and the simple RBC, or the interlocking trackside of the section above. With the simple RBC the trains on the main line alone share its balise groups and RBC as before; every other train has balise groups and an RBC laid along its own corridor (`own` in its onboard state), which it always runs forwards, so that position reports, authorities, profiles and linking are in the chainages of the corridor; a reroute lays them again. The authority is the one computed by the engine from the block, as on a single line. `NET-9` runs the three network scenarios with the reference onboard.

The open data feeds work on a network ([OPEN_DATA.md](../OPEN_DATA.md)); the import of timetables still matches the stops to one line.

Other limits: a line is used at most once per itinerary (a turnback is a new service of the same block, step 4d); the controlled train runs on the main line; the interface draws the main line and the trains on it, and leaves out the trains while they are on other lines.

## Invariants

- Without `network` in the scenario the network is the main line alone and every run is identical to before (campaign fingerprint, verify scripts).
- With a network every run is deterministic: trains advance in a fixed order, the node routes are assigned by a total order (distance, timetable, train index).
- Two trains of the same direction never share track on a line; two trains of opposite directions never share a single-track section (checked at every step in `verify-network`).
- With the interlocking trackside no section of any line is ever occupied by two trains, and a single-line run is identical to before: the trackside configuration has no `network` field and the node routes do not exist.

## Checks

`scripts/verify-network.ts`:

- `NET-1`: the node falls on the same point of the plan; corridors on one line are the lines; corridors of two lines have the stations, limits, gradients, curvature, plan and signals of their lines, and the chainages go from the corridor to the lines and back;
- `NET-2`: itineraries through the node, stops in running order, errors;
- `NET-3`: the scenario `scenarios/services/branch.json` with ETCS and with the automatic block, all trains on time with no intervention, the crossing at Pietrarsa, a late opposite train keeps the crossing there, no shared track, determinism;
- `NET-4`: a train from the branch and a train from Monte Clanio join the main line towards Valle Lauro at San Felice Scalo one at a time;
- `NET-5`: what is not supported is refused (a reroute that would need routes the interlockings do not have);
- `NET-8`: open data of the network, stations, positions along the corridors, block_id, transfers and NeTEx interchanges;
- `NET-9`: the message-based reference onboard on the three network scenarios;
- `NET-6`: rolling stock circulation, delay passed on in closed form;
- `NET-7`: connection kept, kept after waiting, lost;
- `NET-10`: the interlocking trackside on five scenarios (branch, shuttle, a train from Monte Clanio joining the main line where the branch train comes out, two trains along three lines of the loop in opposite directions, and the reroute of `loop-reroute` around the blocked main line): every train on time without intervention, no point trailed, no section of any line occupied by two trains at any step, the diverging speed on track II of a node, determinism, the consent of San Felice Scalo moving to the branch for the train that comes out of it;
- `NET-11`: the interlockings of the network as an external program (`examples/trackside/trackside_stdio.ts`) give the same run as in process, also with the reroute;
- `NET-12`: a train into the branch 300 s and 600 s late meets the train coming out of it at the node: no deadlock, no section shared.

## Where to extend it

- More than one RBC on a network, with a border at a node (on a single line it is done); one interlocking per station; nodes inside a station of both lines.
- Step 4c: connections between trains at a node.
- Step 4d: rolling stock circulations and turnbacks, that is a line used twice by one vehicle.
- Step 4e: rerouting by the regulator, which needs alternative itineraries.
- Phase 5: networks imported from RINF and OpenStreetMap, written in the same format.

## Sources

- UIC, IRS 30100 RailTopoModel, 1st edition, 2016.
- railML 3, infrastructure and timetable schemes (net elements, operational points, `baseItineraryPoint`).
