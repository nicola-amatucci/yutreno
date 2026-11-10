# YuTreno: state of the art and how to resume

> Italian copy: [it/STATO_DELL_ARTE.md](it/STATO_DELL_ARTE.md).

Written on 9 November 2026, when development paused. It is the short version for whoever picks the project up again: what YuTreno can do today, how good the evidence is, how to start working again in half an hour, and what comes next, in order. The full history of every step and decision is in [ROADMAP.md](ROADMAP.md); the rules for working in the repository are in `CLAUDE.md` (and `AGENTS.md` for other agents).

## Where the project stands

The plan born on 5 November 2026 ("more trains with timetables, passengers") is complete, together with the phases added on the way. All work is on `main`; there are no other branches and no open decisions (sixteen were taken, listed in the roadmap).

| Phase | Content |
| :-- | :-- |
| 1–3 | several trains, timetables and service trains in both directions; ETCS with one session per train, interlocking with block consent, faults, traffic regulator with a public protocol, UIC 406 capacity |
| 4 | simulated network: lines meeting at shared stations, corridors, connections, rolling stock rosters, node routes and one interlocking per line |
| 5 | import of real lines from OpenStreetMap, RINF and EU-DEM with provenance and report; Avellino – Benevento, Cancello – Benevento (as a network with Benevento), Salerno – Mercato San Severino checked against its real timetable |
| 6 | aggregate passengers: demand, boarding and dwell, capacity, mass on board, transfers, occupancy in the open data |
| 7 | page tools: timetable editor, control room, scenario form, riding in another train, dispatcher, people on platforms |
| 8 | refactoring with unchanged numbers: golden master, `Simulation` split into eleven modules, faster checks |
| 9 | the train ahead is a real freight train of the run |
| 10 | RBC handover on a line (Subset-026 §3.15.1 and §5.15, Subset-039), with the interlocking trackside |
| 11 | ETCS Level 2 with moving block, from the confirmed rear end and train integrity |
| research requests | human driver model, time held by the signalling, odometry drift, train integrity |
| 9 November | a marker passed at danger is counted and holds the train; two trains on the same stretch of line are reported (decision 16) |

In numbers: about 21,700 lines of TypeScript in `src/`, 31 scenarios (`scenarios/`, `scenarios/trackside/`, `scenarios/services/`), three real lines, open data in six formats valid against the official schemas, external programs for controller, dynamics, onboard, trackside and regulator, each with an example and a check that the external run equals the internal one.

## How good the evidence is

- **23 checks** (`npm run verify`, about fifteen minutes on two cores) cover the engine, the protocols, the formats, the real lines, the network, passengers, capacity, moving block and handover. Each new rule has a check that fails if the rule is switched off.
- **The golden master** (`npm run golden`, 282 runs, 15–28 minutes) fingerprints every part of every scenario in six variants of signalling, onboard, trackside and regulator, plus the two campaigns. The page has its own golden master (24 states). A change meant to leave behaviour alone must keep both unchanged.
- **Traceability**: `docs/traceability/matrix.csv` has 395 requirement rows of Subset-026, Subset-039, Subset-130, EULYNX and the control table: 62 implemented, 143 simplified, 16 divergent, 153 missing, 21 out of scope, each implemented or simplified row with a tagged test.
- **Campaigns** are deterministic and fingerprinted: onboard × ATO × scenario (`a41b59b99b29cfae`), service, driver model, fixed against moving block.
- **What is not validated**: the reference onboard curves have not been compared with the ERA braking curve tool ([CURVE_VALIDATION.md](CURVE_VALIDATION.md)); SCMT is a simplified supervision, since the RFI specifications are not public; the moving block follows X2Rail-5 at the level of principles, not a certified implementation.

## The limits that matter most

These are the ones to keep in mind when reading results; the full list is in the roadmap.

- With several trains and the engine trackside the authority is recomputed from the position at every step. A marker passed at danger is held as the end of authority only with ETCS, outside the interlocking trackside and networks; two trains on the same stretch are reported, not stopped.
- RBC handover works on a single line only, not at a node of a network; the network has one RBC.
- The moving block needs the simple RBC and a message-based onboard on every train on one line; elsewhere it falls back to the fixed block with a warning.
- Node routes with the engine trackside are a simple rule, with no points or flank protection.
- Passengers are an aggregate model: they do not choose a route or change plan when a connection is lost.
- The Docker demo was run outside a container on 8 November (83 runs, no unexpected failure); the image itself, with Octave and openETCS, has not been built since the demo was brought up to date.

## Resuming in half an hour

1. Clone, `npm ci`, then `npm run typecheck`, `npm run verify -- --quick` and `npm run golden -- --quick` (about a minute and a half together). If something is red, start from there.
2. Read `CLAUDE.md`, then [ROADMAP.md](ROADMAP.md) (status, decisions, limits) and [ARCHITECTURE.md](ARCHITECTURE.md) (data flow and the points to touch for frequent changes).
3. The owner's Claude project "Progetto Videogioco Treni" holds the planning documents (`sviluppo/`, including the Italian copy of the roadmap as `passaggio-consegne.md` and that of this document as `stato-dell-arte.md`) and the research documents (`ricerca/`, including the article plan and the comparison with Barbaro et al.).
4. Before every commit that touches `src/` or `scripts/`: the full `npm run verify` and, for a change meant to leave behaviour alone, the full `npm run golden`. Commits are atomic Conventional Commits, files added one by one, pushed to `main`.

## Roadmap from here

In order of priority. Nothing here is decided yet: each step starts with a short plan for the owner.

### 1. Consolidation (small, before new features)

- **The public repository**: the licences are in place (EUPL-1.2 for the code, CC BY 4.0 for the documentation, the data with the licences of their sources, [NOTICE.md](../NOTICE.md)); the Trenitalia timetable extract comes from public administrations that publish it without a licence, so it is open data by default (article 52 of the Digital Administration Code). The public repository (github.com/nicola-amatucci/yutreno) starts from a single commit; development goes on in the private one (yutreno-dev), and the public one is updated from it.
- **Build and run the Docker image** on a machine with Docker: `docker build -f docker/Dockerfile -t yutreno-demo .` and `docker run --rm -p 8000:8000 -p 8766:8766 -p 8767:8767 yutreno-demo`. It is the only way to check the Octave dynamics and the openETCS onboard in the demo.
- **The example ATO waits when its end of authority is behind it.** Today, held at a marker passed at danger, it applies traction again and the onboard trips every 5 s: harmless for the results, noisy in the events.
- **Hold and same-stretch report everywhere**: extend the hold of a marker passed at danger to the interlocking trackside and to networks, and decide whether two trains on the same stretch should stop the run.

### 2. For the article (research)

- **The draft of the article** on the comparison with Barbaro et al. (Railway Engineering Science, 2026): the fixed against moving block campaign, the driver model campaign, CAP4 and CAP5 already give the numbers.
- **H7 of phase 10**: the minimum headway across an RBC border against the one from blocking times, and RBC areas and borders in the control room snapshot.
- **The confirmed rear end in the control room** for the moving block.
- **Validation of the onboard curves** against the ERA tool with the cases in `validation/cases.json`: the one missing piece to make the onboard results citable as more than a reference implementation.
- **A second real line against its real timetable**, since Benevento has none published.

### 3. Extensions of the signalling (medium)

- RBC handover at a node of a network, and several RBCs on a network.
- One interlocking per station instead of per line, node points inside a station, the geometry of the node turnout and flank protection.
- Moving block with the interlocking trackside, trackside train detection as a fallback, and virtual sub-sections (hybrid level / VSS).
- Block length derived from the maximum speed for imported lines (research request 5), as an option, with 1,300 m staying the default.

### 4. Beyond the current plan (long)

- Passengers as agents who choose their route and react to a lost connection.
- Snapshots and replay for the instructor, sessions with several users.
- DMI iconography compliant with the ERA specifications.
- A physical model railway driven by YuTreno ([PHYSICAL_MODEL.md](PHYSICAL_MODEL.md)).
- A real SCMT model, if the RFI specifications become available.
