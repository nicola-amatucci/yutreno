# Tools

## Headless runner (`src/server/headless.ts`)

Runs one or more runs without graphics, with a JavaScript or WebSocket controller, optional scenarios (a file or a folder), and any combination of external dynamics, onboard and trackside. Options are parsed by `parseArgs()`, which accepts the English names and the Italian ones of version 0.x (`OPTION_ALIASES`, `VALUE_ALIASES`). With `--output` it writes for every run the CSV, the events (`_events.json`) and the summary (`_summary.json`), plus `summary.json` for the whole set. `--controller-params` gives a JSON object to a JavaScript controller as the global `PARAMS` (`loadJsController(file, globals)`), as `examples/driver_model.js` reads its profile and seed. It exports the loaders and transports used by the scripts: `loadScenarios`, `loadLine`, `loadTrain`, `loadJsController`, `connectWsController`, `loadJsDynamics`, `loadJsOnboard`, `openChannel`, `spawnDynamics`, `connectDynamics`.

## Agent environment (`src/server/agent-env.ts`)

`AgentEnv` prepares a run with the trains of an agent (`reset`) and advances it decision by decision (`step`), driving the other trains with the built-in ATO; run as a process (`npm run agent-env`) it speaks JSON lines on stdin/stdout. `examples/agents/yutreno_env.py` wraps it as a Gymnasium environment. See [AGENTS.md](../AGENTS.md).

## Feeds server (`src/server/feeds-server.ts`)

`FeedRun` advances a scenario with the built-in ATO on the controlled train; `feedFiles()` returns all the feeds at the current time. Run as a process (`npm run feeds`) it serves GTFS, GTFS-Realtime, SIRI and NeTEx over HTTP while the run follows the clock (`--speed`), or with `--at` and `--out` writes the files at a given time. `scripts/feeds-validate.ts` validates the output with the official schemas and the MobilityData GTFS validator. See [feeds.md](feeds.md) and [OPEN_DATA.md](../OPEN_DATA.md).

## Timetable import (`src/server/import-timetable.ts`)

`npm run import` reads a GTFS archive, a NeTEx document or a railML timetable and writes a scenario with its services, matched to the stations of the line, or replaces the services of an existing scenario keeping train, driver and minimum dwells of those with the same number. See [OPEN_DATA.md](../OPEN_DATA.md#importing-timetables).

## Bridge (`src/server/bridge.ts`)

A minimal WebSocket server for the page, which can only speak WebSocket: every connection is forwarded to a TCP server (`--tcp`), to a process started per connection (`--exec`) or answered by a JavaScript model (`--model`). `--protocol 1` translates the requests of the page into the Italian format for programs of version 0.x. `npm run ponte` and the Italian options are kept as aliases.

## Measurement campaign (`scripts/campaign.ts`)

Runs the matrix onboard × ATO × scenario × faults × parameters of a configuration (`campaigns/reference.json`), computes the measures of every run, the input and output fingerprints, the summary per cell, and repeats one run in the same process, in a new process and with the onboard as an external process to check determinism. Outputs in `results/campaign-<name>/`; `--run` runs a single case, `--details` keeps CSV and events. See [CAMPAIGN.md](../CAMPAIGN.md).

## Service campaign (`scripts/service-campaign.ts`)

Sweeps lines, number of trains, headways, directions, signalling and passenger demand of `campaigns/services.json`, every run a scenario configuration; `runs.csv` with punctuality, passenger, energy and signalling measures and a fingerprint per run, `thresholds.csv` with the headway from which no train is held by the signalling when runs differ only by headway (`campaigns/headway-sweep.json`), `determinism.csv`. See [CAMPAIGN.md](../CAMPAIGN.md#service-campaign).

## Driver campaign (`scripts/driver-campaign.ts`)

Runs the profiles of `examples/driver_model.js` with several seeds and the reference controllers of `campaigns/drivers.json` on its scenarios and onboards; `runs.csv`, `summary.csv` with mean and standard deviation per driver and onboard, `determinism.csv` (the same seed again, another seed). See [DRIVER_MODEL.md](../DRIVER_MODEL.md#the-driver-campaign).

## Curve validation (`scripts/curve-validation.ts`)

Generates, for the single-target cases of `validation/cases.json`, the distances at which each curve of the reference onboard equals a set of speeds; creates the form for the ERA tool; compares the two. See [CURVE_VALIDATION.md](../CURVE_VALIDATION.md).

## Real-time measures (`scripts/measure-realtime.ts`)

Measures step cost, onboard cycle cost, round trips with external programs, garbage collector pauses and a clock-locked loop. Results depend on the machine and go in `results/realtime/`. See [REAL_TIME.md](../REAL_TIME.md).

## Traceability (`scripts/traceability.ts`)

Collects the `// @test <id>: <title> [<requirements>]` tags of the verify scripts, writes `docs/traceability/tests.csv`, fills the `tests` column of `docs/traceability/matrix.csv` and checks coverage: every tagged requirement exists, every implemented or simplified row has a test on itself or on a sub-clause. `--check` only checks; `verify-traceability` runs the same check inside `npm run verify`.

## Checks (`scripts/verify-*.ts`, `scripts/run-verify.mjs`)

`npm run verify` runs every verify script, as many at a time as there are processors, longest first, and prints the output of each when it ends; it fails if any fails. `--jobs 1` runs them one after the other with the output as it comes, and `node scripts/run-verify.mjs <name> ...` runs some. Each check is its own process, so running them together does not change their data. The checks share the loop of the built-in driver (`scripts/lib/drive.ts`).

## Golden master (`scripts/golden.ts`, `golden/fingerprints.json`)

`npm run golden` runs every scenario of `scenarios/` and every configuration of `examples/scenario-config/` with `examples/ato.js`, as written and with ETCS, automatic block, the reference onboard, the interlocking trackside and the reference regulator, plus the reference and service campaigns: 234 runs, about 10 minutes on two cores. `--quick` runs only the scenarios and configurations as written (27 runs, about a minute), and `npm run verify -- --quick` only the short checks (13, about 40 s): for everyday work, while the whole set stays required before a commit. For each run it keeps one fingerprint per part (samples of every train, events, realised timetable, passengers, summaries and verdicts, dispatcher commands, a control room snapshot every 60 s), so a difference names the run and the part. A variant equal to the scenario as written is recorded as `same_as`, and one the engine refuses as its error. It is the safety net of the refactoring of phase 8: every step must leave the file unchanged. A change of behaviour on purpose writes it again with `--update`, in the same commit. The list and what each one checks is in the [README](../../README.md#checks). Verify scripts test the simulator, not the controllers.

## Build and screenshots (`scripts/build.mjs`, `scripts/screenshots.mjs`)

esbuild bundles the interface and the model page; the build writes `dist/index.html`, `dist/yutreno.html`, `dist/artifact.html`, `dist/model.html` and `dist/model-artifact.html`. The screenshot script drives the built page with Playwright to regenerate `docs/img/`.

## Docker (`docker/`)

A complete test environment: Node, Python, Octave and the compiled openETCS code; at start-up `demo.sh` runs a campaign over all the ways of connecting external programs and `report.mjs` writes an HTML report; then `start.sh` serves the simulator and starts the two bridges. See [docker/README.md](../../docker/README.md).
