# Scenario guide: from zero to execution

This guide takes you from an empty folder to a scenario of your own, run without graphics, run in the page and, if you want, added to YuTreno as a built-in scenario with its expected outcome in the checks. It follows one worked example from start to end: rain on the Appennino line and a worksite restriction on the descent after the summit. The example is in the repository as `scenarios/wet-descent-worksite.json`, so every command below can be run as it is. The reference for the format is [SCENARIOS.md](SCENARIOS.md).

## 1. Install and check

You need Node.js 22 or later and git.

```bash
git clone <repository> yutreno
cd yutreno
npm install
npm run verify        # optional: all the checks, a few minutes
```

`npm run verify` is not needed to write scenarios, but it tells you that the installation works: it ends with `All 23 checks passed`, with the time it took.

## 2. Decide what the scenario should test

A scenario is an experiment: it should answer one question. Write it down first, in one sentence. For the example: *does the example controller respect a temporary speed restriction announced at short notice, on a descent, with wet rail, without the protection intervening and within its delay budget?*

From the question follow the choices:

- **line**: `appennino`, because it has a long climb to the summit station of Valico (km 12+650) and a descent towards Piano Alto (km 18+200);
- **train**: `regional`;
- **signalling and onboard**: ETCS level 2 with the `reference` onboard, which builds the Subset-026 curves from the messages of the RBC;
- **conditions**: `rain`, which with `adhesion: auto` gives wet rail (μ 0.20);
- **events**: a message to the driver and a temporary speed restriction of 60 km/h between km 14+000 and km 15+500, both triggered when the head passes km 12+900, just after the departure from Valico;
- **criteria**: at most 540 s of delay and stops within 3 m of the marker, in addition to the defaults (arrival, no missed stop, no intervention, no overrun, no missed vigilance). The delay budget is large because the line has a freight train ahead, which the regional train follows up the climb; to study the restriction alone, add `"leader": { "on": false }`.

To look at a line, open the page (`npm run dev`), go to the *Line* tab and choose it in the menu: plan, profile, stations, limits and tunnels are all there. The built-in lines are defined in `src/core/presets.ts`.

## 3. Write the file

Create `my-scenarios/wet-descent.json`:

```json
{
  "name": "Wet rail and a worksite on the descent",
  "description": "Rain on the Appennino line: wet rail all along and, after the summit station of Valico, a 60 km/h worksite restriction on the descent towards Piano Alto, announced to the driver as he leaves Valico.",
  "line": "appennino",
  "train": "regional",
  "signalling": "ETCS",
  "onboard": "reference",
  "weather": "rain",
  "events": [
    { "type": "message", "when": { "pos": 12900 }, "text": "Worksite ahead: 60 km/h from km 14+000 to km 15+500" },
    { "type": "speed_restriction", "from_m": 14000, "to_m": 15500, "v_kmh": 60, "when": { "pos": 12900 } }
  ],
  "criteria": { "delay_max_s": 540, "stop_error_max_m": 3 }
}
```

Positions are chainages in metres from the origin of the line, referred to the head of the train. An event without `when` is active from the start; with `when` it triggers at a time (`t`, seconds), at a position (`pos`, metres) or when both are reached. `duration_s` ends it after that time.

## 4. Validate

Run it once without graphics. If the file has errors, the runner lists them all and stops, before running anything:

```text
$ npm run headless -- --scenario my-scenarios/broken.json
my-scenarios/broken.json: event 1: from_m and to_m are needed, with to_m > from_m; event 2: unknown type «fog» (available: radio_loss, speed_restriction, low_adhesion, brake_degraded, traction_reduced, leader_stopped, rbc_emergency_stop, message, point_failure, tvps_failure, operator_command, train_stopped, line_blocked, dispatch)
```

The same validation runs in the page when you apply a JSON scenario.

## 5. Run without graphics

```text
$ npm run headless -- --scenario my-scenarios/wet-descent.json --output runs
Wet rail and a worksite on the descent     PASSED  arrival  1570 s, mean stopping error 1.56 m, net energy 206.4 kWh
    train ahead leader       PASSED  arrival 1455.4 s, interventions 0, overruns 0
```

The default controller is `examples/ato.js`. The second line is the freight train ahead, judged only on the safety of its run. With `--output runs` the runner writes three files per run in `runs/`, and with other trains also their timetable and a CSV and a summary for each of them:

- `wet-descent_001_summary.json`: outcome, arrival time, stop errors, energy, warnings, service brakings, interventions, overruns and the list of checks of the verdict, each with value and threshold. For the example: arrival 460 s late against a limit of 540 s, maximum stopping error 2.5 m against 3 m;
- `wet-descent_001_events.json`: the event log, with time, position, kind and text. It shows the message and the restriction triggering at km 12+900, 1199 s after departure, and the three stops;
- `wet-descent_001.csv`: one row every 0.5 s of simulated time with position, speed, supervision curves, commands, forces, adhesion, energy, onboard mode and LRBG. It opens in any spreadsheet or in pandas.

Runs are deterministic: run the command twice and the CSVs are identical byte by byte.

## 6. Vary the experiment

The command line overrides the scenario, so the same file answers several questions:

```bash
npm run headless -- --scenario my-scenarios/wet-descent.json --controller examples/ato_s130.js     # the ATO that uses the Subset-130 data
npm run headless -- --scenario my-scenarios/wet-descent.json --onboard internal                     # the simplified supervision
npm run headless -- --scenario my-scenarios/wet-descent.json --trackside interlocking               # authority from an interlocking
npm run headless -- --scenario my-scenarios/wet-descent.json --controller ws://localhost:8765       # your controller in any language
npm run headless -- --scenario my-scenarios                                                         # every scenario of the folder
```

For the example the first three variations pass as well; the Subset-130 ATO arrives 5 s later using 22 kWh less, and with the interlocking the regional train overtakes the freight train and arrives 68 s earlier.

To make a fault invisible to the driver and to the controllers, add `"announced": false` to the event: it stays only in the log, and the controller discovers it from its effects. Hidden faults are what the scenarios `leaves-ponte-sabato` and `degraded-brake` use to make the example controller fail.

With the interlocking trackside the scenario can also fail points and track circuits and send control centre commands (`point_failure`, `tvps_failure`, `operator_command`); the scenarios in `scenarios/trackside/` are examples. Service trains with their timetable, a network and passengers are described in [SCENARIOS.md](SCENARIOS.md#service-trains) and [PASSENGERS.md](PASSENGERS.md).

## 7. Run it in the page

1. Start the page with `npm run dev` (or open `dist/yutreno.html` after `npm run build`).
2. Go to the *Scenarios* tab, paste the JSON in the *JSON definition* box and press *Apply this JSON and restart*. The description, the line, the train and the number of events appear on the left.
3. Go to the *Drive* tab. The briefing shows the scenario; press *Start the service* to drive yourself, or *Let the controller drive* to hand the train to the controller of the *Controller and API* tab.
4. During the run the *Scenarios* tab shows the state of every event (waiting, active, done) and the provisional verdict; at the end the report shows the final verdict.

The page keeps the scenario in the browser, so it is still there the next time. To share it, use *Copy JSON*.

## 8. Make it a built-in scenario

If the scenario is worth keeping in YuTreno, three changes make it part of the project, and the checks guarantee that it keeps behaving the same way:

1. copy the file into `scenarios/` (or `scenarios/trackside/` if it needs the interlocking trackside) with a short kebab-case name, for example `scenarios/wet-descent-worksite.json`;
2. add it to the list of the page in `src/web/scenarios.ts`, with an `import` and an entry in `BUILTIN_SCENARIOS`;
3. record its expected outcome with `examples/ato.js` in the `EXPECTED` map of `scripts/verify-scenarios.ts`: `'wet-descent-worksite.json': 'passed'`.

Then run `npm run typecheck` and `npm run verify`. `verify-scenarios` checks the outcome and the determinism; `verify-onboard` and `verify-trackside` also run every ETCS scenario with the reference onboard and with the interlocking trackside and check that the verdict does not change. Commit the three files together, for example with `feat(scenarios): wet rail and worksite on the Appennino descent`.

The expected outcome is that of the example controller, even if the scenario is designed to make it fail: the checks test the simulator, not the controllers.

## 9. Checklist

- One question per scenario, written in the description.
- Positions in metres from the origin of the line, referred to the head.
- Announced or not announced: decide for every fault whether the driver can see it.
- Criteria that measure the question, not only the defaults.
- Run it with at least two controllers or two onboards: a scenario that every combination passes in the same way measures nothing.
- If it becomes built-in: file, page list, expected outcome, `npm run verify`.
