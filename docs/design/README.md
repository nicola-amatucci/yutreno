# Design documents

One document per component of YuTreno. Each one says what the component is for, what it is responsible for and what it is not, its interfaces, its main data structures and algorithms, the invariants it must keep, how it is tested and where it is meant to be extended. They complement [ARCHITECTURE.md](../ARCHITECTURE.md), which follows the data through a run, and [STANDARDS.md](../STANDARDS.md), which discusses the standards behind the components.

| Component | Code | Document |
| :-- | :-- | :-- |
| Simulation core: line, presets, run loop, scenarios, verdict, compatibility layer | `src/core/simulation.ts`, `run-state.ts`, `trains.ts`, `outputs.ts`, `commands.ts`, `leader.ts`, `boarding.ts`, `line.ts`, `presets.ts`, `scenario.ts`, `legacy.ts` | [core.md](core.md) |
| Train dynamics: multi-mass and point mass | `src/core/dynamics.ts`, `consist.ts` | [dynamics.md](dynamics.md) |
| Block signalling, internal ETCS supervision and SCMT | `src/core/signalling.ts` | [signalling.md](signalling.md) |
| Reference ETCS onboard (EVC) and its exchanges with the engine | `src/core/evc.ts`, `onboard-bridge.ts` | [reference-onboard.md](reference-onboard.md) |
| Simple message-based RBC and balise groups | `src/core/simple-rbc.ts` | [simple-rbc.md](simple-rbc.md) |
| Interlocking trackside: field, interlocking, RBC, control table | `src/core/field.ts`, `trackside-bridge.ts`, `src/trackside/` | [interlocking-trackside.md](interlocking-trackside.md) |
| Traffic regulator: reference regulator and its protocol | `src/regulator/`, `src/core/regulator-bridge.ts` | [regulator.md](regulator.md) |
| Network: lines meeting in nodes, itineraries compiled into corridors, node routes | `src/core/network.ts`, `traffic.ts` | [network.md](network.md) |
| Protocols: controller API, external dynamics, onboard, trackside, regulator, versions | `src/core/types.ts`, `controller.ts`, `legacy.ts` | [protocols.md](protocols.md) |
| Web interface and 3D view | `src/web/`, `src/docs/` | [web-interface.md](web-interface.md) |
| Open data feeds: GTFS, GTFS-Realtime, SIRI, NeTEx Italian profile | `src/feeds/`, `src/server/feeds-server.ts` | [feeds.md](feeds.md) |
| Passengers: demand, boarding, dwell, capacity, mass on board | `src/core/passengers.ts`, `boarding.ts` | [PASSENGERS.md](../PASSENGERS.md) |
| Control room snapshot | `src/core/control-room.ts`, `src/web/control-room.ts` | [CONTROL_ROOM.md](../CONTROL_ROOM.md) |
| Import of the real infrastructure: OpenStreetMap, RINF, terrain model | `src/infra/`, `src/server/import-infra.ts` | [INFRA_IMPORT.md](../INFRA_IMPORT.md) |
| Tools: headless runner, bridge, campaign, curve validation, traceability, Docker | `src/server/`, `scripts/`, `docker/` | [tools.md](tools.md) |

Three rules cut across all of them.

1. **Determinism.** With the same line, train, scenario and commands a run produces the same data byte by byte. No component reads the clock or uses non-repeatable randomness; external programs are coupled in lockstep.
2. **Layer boundaries.** The core does not depend on the browser or on Node; the interface contains no physics or signalling; the reference onboard, the trackside and the regulator import nothing from the engine except protocol types and the compatibility layer, so that an external program can do everything they do.
3. **Public protocols.** The five protocols (controller, dynamics, onboard, trackside, regulator) are interfaces other people program against: new fields are optional, names follow the standards where one exists, and the Italian formats of version 0.x keep working.

The Italian copies are in [docs/it/progetto/](../it/progetto/LEGGIMI.md).
