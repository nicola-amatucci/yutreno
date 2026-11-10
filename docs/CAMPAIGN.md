# Measurement campaign

With the reference ETCS onboard the example ATO consumes 13–22% more energy than with the simplified supervision, and with the degraded brake it causes three protection interventions. Those numbers do not tell whose merit or fault it is. It may be the onboard, which computes different curves. It may also be the simple ATO, which follows the permitted speed of the onboard and inherits the shape of its curves. The campaign separates the two causes. It repeats the same runs crossing two onboards, two ATOs and the scenarios, with and without the hidden faults, and for every run it records measures, parameters and a fingerprint of the data.

```bash
npm run campaign                                  # about a minute, results in results/campaign-reference/
npm run campaign -- --details                     # also saves CSV and events of every run
npm run campaign -- --config mine.json --output folder
```

## The matrix

The configuration is in [`campaigns/reference.json`](../campaigns/reference.json):
- **onboards**: `internal`, that is the simplified supervision, and `reference`, that is the message-based EVC of the core ([ONBOARD_ETCS.md](ONBOARD_ETCS.md));
- **ATO**: `simple` ([`examples/ato.js`](../examples/ato.js)) and `s130` ([`examples/ato_s130.js`](../examples/ato_s130.js)), described below;
- **scenarios**: the six ETCS scenarios of `scenarios/`;
- **faults**: every scenario twice, with its events and without (`events: []`), so every run with faults has its nominal twin on the same line with the same train;
- **parameters**: one or more sets of national values and the braking model of the train.

In total there are 6 scenarios × 2 × 2 × 2 = 48 runs for every set of parameters. The nominal twins of the scenarios on the same line are the same run and must have the same hash: it is a first free check.

## The two ATOs

The **simple ATO** uses only the speeds of the supervision. It keeps the permitted speed minus 2 m/s, stops 25 m before the end of authority and stops the head at the marker with 0.45 m/s².

The **Subset-130 ATO** uses the data the onboard makes available to ATO ([API.md](API.md#onboard-data-for-ato-subset-130)). It does not follow the permitted curve, but plans by itself on three levels:
- **its own braking curve** towards every MRSP reduction and towards the end of authority, with the same design deceleration as the simple ATO. The curve is corrected for the worst gradient, evaluated 2 s ahead and never beyond half of `A_BRAKE_SAFE`;
- **a rebuilt intervention curve** with the Subset-130 data only (`A_BRAKE_SAFE`, `GRADIENT`, `T_BE_REACT`, `T_TRACTION`) plus 7 s of guard. The train never exceeds it. When the speed difference is small it is the reaction times, not the deceleration, that decide where to brake, and there its own curve alone would arrive late;
- **a guard** on the limit announced by the onboard: if at the current speed the train would reach `N_LOC_EBI` within the reaction times plus 3 s, it brakes fully with the service brake. Within another 4 s it only removes traction.

Stops, vigilance and speed regulator are the same as in the simple ATO, so the difference between the two measures only the effect of the Subset-130 data. Without those data, that is with the automatic block, with API version 1 or with an onboard that does not provide them, the Subset-130 ATO behaves like the simple ATO.

## Outputs

All files are deterministic, except `metadata.json`:

| File | Content |
| :-- | :-- |
| `runs.csv` | one row per run: case, line, faults, onboard, ATO, parameters, outcome; running time and delay; traction, regenerated and net energy; valid and missed stops, mean, maximum and final stop error; warnings (W), service brakings (SBI), interventions (EBI), radio brakings, emergencies, end of authority overruns, ATO guards; maximum excess over the limit and maximum jerk; decelerations of the train and gradients of the line; fingerprints of the national values, of the inputs and of the output |
| `summary.csv` | totals per parameters × faults × onboard × ATO |
| `determinism.csv` | repeatability checks, see below |
| `parameters.json` | the configuration and, for every combination, complete national values, train data and gradients of the line |
| `metadata.json` | code commit and presence of uncommitted changes, Node version, real duration, fingerprint of `runs.csv` |

The **output fingerprint** (`hash_output`) is the SHA-256 of the CSV of the run (`Simulation.csv()`, one sample every 0.5 s with 34 quantities) followed by the event log in JSON. Two runs with the same fingerprint have produced the same data, sample by sample. The **input fingerprint** (`hash_inputs`) summarises line, train, conditions, scenario, controller code and control period. Together they allow anyone to redo a run and compare the outcome with the published one without exchanging the raw data.

The fingerprints contain texts too (names of lines and trains, event messages): translating YuTreno into English in version 0.2 changed them without changing any number. The comparison with the runs of version 0.1 was done row by row on the numeric columns of the CSV, which are identical.

## Determinism

After the matrix the campaign repeats one run: degraded brake, reference onboard, Subset-130 ATO. It repeats it in four ways:
1. a second time in the same process;
2. in a new process, to exclude shared state in memory;
3. with the same reference onboard as an **external process** connected via `exec:` (`examples/onboard/onboard_stdio.ts`), which exchanges JSON requests and responses with the engine on stdin/stdout at every 100 ms cycle;
4. a second time with the external onboard.

All of them must give the same fingerprint as the run of the matrix, otherwise the command exits with an error. In this version they do. The external channel therefore introduces no difference, not even of rounding: JSON numbers are read back identical in double precision.

## Parameters

Every set of parameters has a name, a braking model and national values that replace the default ones (`DEFAULT_NATIONAL` in `src/core/evc.ts`, with the speed margins of Subset-026 §A.3.1). For example:

```json
{ "name": "maximum-margins", "braking_model": "gamma",
  "national_values": { "dV_ebi_min": 15, "dV_sbi_min": 10, "dV_warning_min": 5, "T_driver": 6 } }
```

The national values reach the onboard in the first request, so they apply to the reference onboard and to external onboards. The internal supervision has its own margins and does not use them: in its rows `hash_national_values` is empty.

The train of the reference onboard has constant decelerations, that is the **gamma model** of Subset-026 §3.13. The lambda model, with the brake percentage converted into decelerations, is not implemented and the campaign rejects a set that asks for it. Gradients are not a parameter of the campaign but of the line. For every run `runs.csv` gives the maximum ascent, the maximum descent and the mean absolute gradient, and `parameters.json` contains the complete profile along the line of the scenario.

## Results

With the `base` set, the campaign gives these totals over the six runs of every cell:

| Faults | Onboard | ATO | Net energy (kWh) | W | SBI | EBI | Passed |
| :-- | :-- | :-- | --: | --: | --: | --: | :-: |
| no | internal | simple | 838.2 | 0 | 0 | 0 | 6/6 |
| no | reference | simple | 987.8 | 0 | 0 | 0 | 6/6 |
| no | internal | Subset-130 | 825.3 | 0 | 0 | 0 | 6/6 |
| no | reference | Subset-130 | 833.4 | 0 | 0 | 0 | 6/6 |
| yes | internal | simple | 848.6 | 3 | 0 | 0 | 4/6 |
| yes | reference | simple | 1001.5 | 4 | 5 | 3 | 4/6 |
| yes | internal | Subset-130 | 827.4 | 1 | 0 | 0 | 4/6 |
| yes | reference | Subset-130 | 836.0 | 0 | 0 | 0 | 4/6 |

Since 6 November 2026 the controlled train keeps its doors open until the timetabled departure, as the service trains do; before, they closed after the minimum dwell of 20 s and the train left early. Every total fell by 2.7 to 5.1 kWh, most likely because the train, leaving on time, runs up less behind the freight train ahead and brakes less. Running times, interventions and verdicts did not change, nor did the fingerprint of the determinism check, computed on a run that the change does not touch.

Since 7 November 2026 the freight train ahead of the two lines of the scenarios is a train of the run like the service trains, with its dynamics, signals, supervision and built-in driver, standing on the line when the run starts (decision 12, [MODEL.md](MODEL.md#vigilance-stops-and-the-train-ahead)); before it was a kinematic train that ran without signals. It is slower, and the controlled train follows it: every cell runs 820–900 s longer over its six runs and consumes 11.8 to 35.2 kWh more. With faults the reference onboard with the simple ATO now has five warnings, two service brakings and two interventions instead of four, three and three: the brakings and interventions all in the degraded brake, one warning in the leaves. The verdicts, the two percentages below and the conclusions did not change; the fingerprint of the determinism check did (`a41b59b99b29cfae` instead of `06d2b24225a458fd`), because that run has a train ahead. Since 8 November the engine also counts a marker passed at danger ([signalling.md](design/signalling.md#overruns-and-an-authority-recomputed-from-the-position)): in the degraded brake the reference onboard with the simple ATO passes signals 12 and 13 behind the freight train, now two end of authority overruns in `runs.csv`. Since 9 November the engine also holds a train at a marker it has passed at danger until the marker clears (decision 16): in that run the train stops behind signals 12 and 13 and waits for the freight train to clear them, so it arrives 70 s later (1374.7 s instead of 1304.3 s) and its cell has 1001.5 kWh, four warnings, five service brakings and three interventions instead of 989.9 kWh, five, two and two. Every other run and the fingerprint of the determinism check did not change.

Without faults, with the simple ATO the reference onboard costs 17.9% more than the internal supervision. With the Subset-130 ATO it costs 1.0% more. About 95% of the difference (141.5 of 149.6 kWh) therefore depends on the ATO following the permitted curve, not on the onboard. With faults, the three interventions and the five service brakings of the reference onboard disappear with the Subset-130 ATO, which with that onboard does not even receive warnings. In both cases the running times stay within a few seconds.

The two failed runs of every cell with faults are the same for all combinations: the leaves and the degraded brake lead to a missed stop. They are faults that cannot be seen onboard and that neither ATO tries to estimate.

The numbers hold for this ATO and for this reference onboard, which is not validated against the ERA tool ([CURVE_VALIDATION.md](CURVE_VALIDATION.md)). They must not be read as a property of ATOs or onboards in general.

## Service campaign

The reference campaign compares onboards and ATOs on one train. The service campaign asks the questions of a timetable instead: how punctuality, waiting, crowding and energy change with the number of trains, the headway and the passenger demand.

```
npm run service-campaign -- [--config campaigns/services.json] [--output <folder>]
```

`campaigns/services.json` lists `lines` (built-in ids or paths of a `line.json`, relative to the file), `trains`, `headways_s`, `directions`, `signalling` and `demand_per_station_per_hour` (people an hour leaving every station, spread evenly over the others, 0 for no passengers), with `arrivals`, `seed` and `on_time_s` (default 180 s). Every combination is a scenario configuration ([SCENARIO_CONFIG.md](SCENARIO_CONFIG.md)) with the controlled train and the service trains driven by `examples/ato.js`. The example sweeps Valle Lauro and the real line Salerno – Mercato San Severino with 2 and 4 trains every 10 and 15 minutes in both directions and 0, 600 and 1200 passengers an hour per station: 24 runs in about four minutes.

`runs.csv` has one row per run: the parameters; trains arrived, interventions and overruns; mean and maximum delay of the services at their last stop and the share on time; passengers boarded, left behind, mean and maximum wait, journey, delay per passenger, highest load factor, passenger-km; the time held by the signalling of all trains and of the train held the longest ([CAPACITY.md](CAPACITY.md#time-held-by-the-signalling)); net energy and energy per passenger-km; the end of the run and a fingerprint of the run. `determinism.csv` repeats the first run. When runs differ only by headway, `thresholds.csv` gives for each group the smallest headway of the sweep from which no train is held by the signalling any more. The demand runs for the whole run, so the people arrived after the last train stay on the platforms and are not in the measures of those who boarded.

In the example, on Valle Lauro the delay grows only with 1200 passengers an hour and trains every 15 minutes, when the dwells lengthen and some people are left behind; on Salerno – Mercato San Severino, with nine stations, the same demand fills the trains and the services with 4 trains every 10 minutes arrive a minute late on average. These numbers depend on the declared defaults of the passenger model ([PASSENGERS.md](PASSENGERS.md)) and are an example of use, not a result about those lines.

`campaigns/headway-sweep.json` is such a sweep: two trains in the same direction on Valle Lauro, the second from 180 to 300 s after the first, with the automatic block and with ETCS. The second train is held by the signalling for 66 s at 180 s with the automatic block and 64 s with ETCS, about one second less for every second of headway added, and no longer from 245 s in both cases; the arrival delay is the same in every run, because the slack of the timetable absorbs the waiting (20 runs in about 25 s).

Two optional fields compare the train spacing: `onboard` (the ETCS onboard of every train) and `spacing` (a list of `fixed_block` and `moving_block`, [MOVING_BLOCK.md](MOVING_BLOCK.md)); with them `runs.csv` and `thresholds.csv` get the columns `onboard` and `spacing`, without them the runs and their columns are those of before. `campaigns/block-comparison.json` sweeps the same two trains from 120 to 300 s with the reference onboard and both spacings: the second train is no longer held from 230 s with the fixed block and from 200 s with the moving block (24 runs in about 70 s; [CAPACITY.md](CAPACITY.md#moving-block)).

`verify-scenario-config` (`SCF5`) runs a small sweep and checks its measures and its determinism.

## Checks

`scripts/verify-ato-s130.ts` checks:
- that the observation versions keep their content (version 1 without `etcs_ato`, version 2 equal to version 3 with the Italian names);
- that `N_LOC_EBI` is the point where the protection really intervenes. A driver who keeps a constant speed and never brakes, with an almost ineffective brake so that service braking does not slow him down, is stopped within 0.2 m of the announced point with the internal supervision and within 1.3 m with the reference onboard;
- that the external onboard provides the same ATO data as the one of the core;
- that the Subset-130 ATO drives without interventions on all lines and that its consumption depends on the onboard less than a third as much as that of the simple ATO.
