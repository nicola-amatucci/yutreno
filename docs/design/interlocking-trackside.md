# Interlocking trackside

## Purpose

Make the movement authority come from routes set by an interlocking on elements that can fail, as in a real installation, while keeping the engine free of interlocking logic. The component is split along the EULYNX boundary: the engine simulates the field, the trackside (`src/trackside/`) holds the logic and talks to the engine through a public protocol, so that it can run in-process or as an external program. The user-level description is in [TRACKSIDE.md](../TRACKSIDE.md).

## Parts

| Part | Code | Role |
| :-- | :-- | :-- |
| Layout generator | `generateLayout()` in `src/core/field.ts` | control tables of the example lines: two-track stations with entry and exit points, block sections on the line |
| Control table translator | `translateControlTables()` in `control-table.ts` | checks the tables, derives conflicts, produces the interlocking configuration |
| Engine side | `src/core/trackside-bridge.ts` | the field of every line stepped with the trains on it, the configuration of the first exchange (corridors, node movements, timetables for the automatic route setting), request and response, radio messages routed by `NID_ENGINE` |
| Field | `Field` in `src/core/field.ts` | points (movement time, faults, trailing), track sections (occupancy by branch, disturbance), EULYNX telegrams |
| Interlocking | `Interlocking` in `interlocking.ts` | element states from telegrams, route setting, integrity, sectional release, cancellation, automatic route setting |
| RBC | `TracksideRbc` in `rbc.ts` | position from reports, authority from the chain of set routes, messages 3 and 16 |
| Facade | `Trackside` in `index.ts` | one cycle of the protocol: telegrams, radio, commands in; telegrams, radio, panel, events out |

## Cycle

`Trackside.step(req)` (every 100 ms by default): `toEnglish`; on `start`, build interlocking and RBC from the `configuration`; the interlocking reads the field telegrams; the RBC reads the onboard messages; operator commands go to the interlocking or the RBC; the interlocking advances routes and ARS and produces the commands for the elements; the RBC computes the authority and the messages; the panel is assembled. The in-process onboard exchanges before the trackside, so the order is the same in-process and external.

## Both directions

With a service towards the origin, `generateLayout(L, { reverse: true })` (`addReverse` in `field.ts`) adds the reverse routes over the same elements: entries from the far side and departures towards the origin in the intermediate stations, the departure from the terminus, the arrival at the origin, and the line block from the end towards the origin. Their markers stand at the section boundaries, with `dir: -1`. Cross-site references `Site/name` let a reverse block route use the first section owned by a station departure. Routes carry `dir` and, for departures and blocks, the `segment` they enter.

Each segment has a block consent (`segDir`: +1 held by the station on the side of the origin, −1 by the other, 0 in transit), +1 at the start. A departure from the end without it sends a request (`send`) and waits; `consentCycle` delivers the messages of the previous cycle: the holder grants only with the segment empty (`segmentEmpty`: no active departure, all sections vacant), releasing its idle automatic blocks, otherwise it refuses and the requester retries after 2 s. A single token, held by at most one end, keeps opposing trains out of the segment. Automatic blocks are requested only in the direction of the consent.

ARS, the hold of `heldByTimetable` and the setting of the track of a train after an entry reason in the chainages of each train (`u()`), mirrored for trains towards the origin, which report it through the RBC (`TrainPos.dir`). Opposing trains do not hold each other's departures: they meet the consent.

The RBC takes the direction of a session from `Q_DIRLRBG` and computes the authority in the train's frame: routes and markers of its direction, packets with `Q_DIR` = 0 and mirrored profiles. The field (`Field`) knows the direction of every train: it takes the branch from the first point met and occupies from the head backwards.

## Route state machine

free → setting (no active conflict, sections free, points not locked by others and able to move; lock and command) → set (all points detected within 20 s, otherwise released) → occupied (train entered) → free again by sectional release (each section released after being occupied and left, its points unlocked and returned to normal; the route released when the train occupies the destination). A set route that loses integrity (point without detection, disturbed section) is not valid for authorities. Cancellation is immediate, or delayed by 120 s if the route is covered by an authority (`RbcInfo.covered`).

## Authority

The RBC starts from the route containing (or being entered by) the head, on the train's branch, and appends consecutive routes that are set, intact and with free sections; a route already in the previous authority stays valid when occupied by the train itself. EOA at the end of the last route, SvL at the end of its overlap if free; distances rounded down. Message 3 carries packets 15, 27 (line limits with the diverging speeds), 21, 5, 65/66. The control centre emergency stop sends message 16 and withholds authorities until revoked, for one engine or for all. The RBC keeps an `RbcSession` per `NID_ENGINE`; with more than one session the first route of the chain must be one already granted to that train (`ses.ma.routes`), because track II shares the chainages of track I. Messages to engines other than 1 carry `NID_ENGINE` for the engine to route them.

## Automatic route setting with several trains

`TracksideConfig.trains` gives a timetable per engine (`TimetableEntry`: station, arrival, departure, chainage, optional track). `automaticRouteSetting` collects the wishes of every train (entries within the window, departures due, passes as soon as the train has entered), keeps the requested track, orders them by the conflict rule and requests the routes in that order. Priorities from the control centre or the regulator (`priority` command, default 0) come first in the order and in the hold: a departure also waits for a train with higher priority. A `timetable` command replaces the timetable of an engine. With `conflict_rule: 'timetable'` and equal priorities `heldByTimetable` holds a departure while a train timetabled earlier at the same station is approaching it or standing on the other track; with `first_come` the order is that of readiness. The track of each train in each station (`trainTrack`) is set by sectional release for the nearest train beyond the route start.

## Interfaces

The engine–trackside protocol (`TracksideRequest`/`TracksideResponse` in `types.ts`, see [protocols.md](protocols.md)); EULYNX SCI-P and SCI-TDS telegrams between field and interlocking; `OperatorCommand` and `PanelState` towards the control centre (page panel or scenario events).

## Invariants

- `src/trackside/` imports nothing from the engine except types and `legacy.ts`.
- The external trackside (`examples/trackside/trackside_stdio.ts`) gives a run identical to the in-process one.
- With `trackside: 'simple'` nothing changes in the results.

## Tests

`verify-trackside` (translation, interlocking against the field without engine, sectional release, trailed point, nominal runs, scenarios with both tracksides, external trackside with one and with two trains in session, overtaking on track II, handover between two RBCs), `verify-services` (overtaking between two trains, the two conflict rules, line blocked) and the expected outcomes of `scenarios/trackside/` in `verify-scenarios`.

## On a network

With a network (`configuration.network`) `Trackside` runs one `Interlocking` per line, each with its own routes, elements and automatic route setting, and one `TracksideRbc` for all. Telegrams go to every interlocking, which takes those of its own elements; set and cancel commands go to the interlocking that has the route, timetables to the one of their `line`. At a node the routes out of an interlocking need the boundary consent, which the interlockings exchange with one cycle of delay (`BoundaryMessage`); a train not yet on a line is placed for automatic route setting where it would be beyond the node (`onCorridorLine`). The RBC builds the authority of a train off the main line along its corridor, across the boundary (`computeMaCorridor`). See [network.md](network.md#separate-interlockings-step-4b).

## Several RBCs

With `configuration.rbcs` (areas and borders, built by the engine from the scenario's `rbc_borders_m`) `Trackside` runs one `TracksideRbc` per area (`RbcArea`) over the same interlocking. `route(m)` delivers a message of the onboard by its `NID_RBC`, else to the RBC that has the engine in session, else to the area of its LRBG; a message for an unknown RBC gets no RBC and becomes a warning in the response events. Each RBC filters routes and markers to its own area (`areaU`) and adds `NID_RBC` to every message. The handover is a small state machine on each side: `RbcSession.hov` (`HovState`: border, ACC, timestamp of the 201, acknowledged, announced, the decoded RRI, taken over) on the Handing Over RBC, driven by `handover()` inside `cycleSession`; `accT` (`AccState`) on the Accepting RBC, driven by `receiveNrbc()` and `accCycle()`. RBC/RBC messages (`NrbcMessage`) are collected from every RBC after its cycle (`nrbcOut`) and delivered at the start of the next one if the link is up: one cycle of delay, independent of the order of the RBCs. Life signs (223) every `life_sign_s` and `linkUp()` with `link_timeout_s` give the communication supervision. The ACC sends the RRI (221) only for a train in session with it, built from its own authority with `message3()` and keeping packets 15, 21 and 27 referred to the border group; the HOV merges it (`ma.beyond`) when its own authority ends at the border and the RRI goes beyond it, or once the front end is past. After the taking over (222) the HOV is silent and orders the session termination when the min safe rear end (`rear()`) is past the border. The view that builds the panel (`supervising()`) takes, per engine, the session of the RBC that supervises it. The design and the reasons are in [TRACKSIDE.md](../TRACKSIDE.md#several-rbcs-and-the-handover); `verify-trackside` HO1–HO7 test it.

## Known limits and extensions

Services keep their session after their run ends (only the train ahead sends End of Mission), block consent exchanged between the ends of a segment but one interlocking program for the whole line, no start of mission, shortening by replacement, no message 18, no diverging geometry, no PDI, fixed timings, reconstructed control table (all listed in [TRACKSIDE.md](../TRACKSIDE.md#what-is-simplified)). Extensions: one interlocking per station rather than per line, flank protection, level crossings, physical object controllers speaking the same telegrams ([PHYSICAL_MODEL.md](../PHYSICAL_MODEL.md)).
