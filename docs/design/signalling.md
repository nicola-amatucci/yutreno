# Block signalling, internal ETCS supervision and SCMT

## Purpose

`src/core/signalling.ts` provides the signalling that every run has unless a message-based onboard is chosen: a three-aspect automatic block, the simple RBC logic that turns the block into an ETCS movement authority, and two simplified onboard supervisions, one for ETCS level 2 and one standing for SCMT. It is the original signalling of YuTreno and stays the default because it is fast, robust and identical to the reference values of the checks.

## Block and train ahead

The train ahead is a freight train among the trains of the run (`leader.ts`, [MODEL.md](../MODEL.md#vigilance-stops-and-the-train-ahead)), so with it a run always has several trains: `updateSignals()` sets every signal from the occupancy of the block sections by all of them (`blockOccupiedBy()`): red if the section behind it is occupied, yellow before a red, green otherwise; starting signals stay red until the departure time. A train alone on the line uses `updateInterlocking()`, the same rule without occupation. With ETCS the same logic gives the movement authority: up to the start of the first section the block would make red, with the danger point `ETCS.overlap` = 50 m beyond.

### Overruns and an authority recomputed from the position

With several trains every train gets its authority again at every step from its own position (`authority()`, `movingAuthority()`): the first red signal *ahead of the head*. Once the head is past a marker at danger, that marker is behind it and the next authority goes beyond it, up to the next red, even if the section the marker protects is still occupied. The check of the end of authority (head more than 0.5 m beyond it) therefore sees an overrun only if it happens within one step. So the engine also counts, once, the head passing 0.5 m beyond a marker that is still at danger for that train (`atDangerFor()` in `traffic.ts`: held for its own departure or for the single-track orientation, or protecting a section occupied by another train or a blocked stretch; with the moving block only by a train of the other direction or a blocked stretch), with an `EMG` event *The head of the train has passed signal … at danger*. It does not count it with the automatic block, which has its own check of red signals, with the interlocking trackside, whose authorities come from the trackside, or on a network.

With ETCS the marker then stays the end of authority of that train while it is at danger for it (`TrainRun.passedAtDanger`, reason `signal passed at danger`): the end of authority lies behind the head, the supervision or the onboard trips, and the train goes on only when the marker clears, that is when the section it protects is free and nothing holds it. The overrun is not counted again while the train is held, but the onboard trips again whenever the train moves. Decision 16 chose this ([ROADMAP.md](../ROADMAP.md)). Two cases show it: an odometer reading 10 % less (`verify-onboard` O10), and a driver who never brakes with the reference onboard (O6), stopped 3 cm beyond the marker protecting the freight train standing ahead and then pushing on: held, it stays at least 566 m from the freight train; without the hold it ran into it.

A signal that goes back to danger in front of a train does not need a rule of its own. The case that suggested one, the freight train in `radio-loss` with the reference onboard stuck behind a departure signal, appeared with a first version of the check that read the departure hold of the train behind (`heldSignals` looks at the nearest train before the signal); `atDangerFor` reads that of the train itself, and with it that run does not change at all.

### Two trains on the same stretch

Nothing in the engine stops two trains from running into each other: the signalling has to keep them apart. With several trains the engine checks at every step whether two trains are on the same stretch of line between two stations, where the line has one track (`traffic.sameStretch`), and when it happens it writes an `EMG` event for each of them, *On the same stretch of line as train … between … and …*. Stations are left out, since each direction has its own track there. The event only reports: the trains are not stopped. O6 checks that it appears when the hold is switched off.

## Internal ETCS supervision

`supervise(cx, pos, v)` computes the supervision of the head at `pos` with speed `v`:

- the **ceiling** is the most restrictive line limit under the train (`lineLimitTrain`), with warning and intervention margins (`dWar`, `dEbi`) shaped like those of Subset-026;
- the **targets** are the line limit reductions within the horizon and the end of authority; for each one `vForDist(d, vt, a, T)` gives the speed from which a deceleration `a` after a dead time `T` reaches `vt` within `d`;
- the curves are P (service deceleration, `Tbs + Tdrv`), W (`Tbs + 2 s`), SBI (`Tbs`) and EBI (emergency deceleration towards the SvL, `Tbe`); towards the end of authority none goes below the release speed of 15 km/h;
- the decelerations are reduced for adhesion and for the steepest descent up to the target (`decels`);
- the state is NOR, IND (5 s before P), OVS, WAR, SBI or INT, and the engine applies service braking above the SBI and the emergency brake above the EBI.

These curves are deliberately not the Subset-026 models: they reproduce the qualitative behaviour with few parameters. `atoData()` produces the Subset-130 data from the same curves, so that an ATO can be tested with the internal supervision too.

## SCMT (simplified)

With `signalling: 'BACC'` the supervision is a single braking curve towards the first red signal and towards every speed reduction within 5 km, with a constant deceleration of 0.55 m/s², a release speed of 30 km/h towards a red signal, warning at +3 km/h and emergency brake at +7 km/h, no service brake intervention. Passing a red signal leads to the emergency brake. The aspects are known directly from the engine. What is missing with respect to the real SCMT (information points, coded track circuits, train-dependent curves, driver procedures) and what a real model would need is discussed in [STANDARDS.md](../STANDARDS.md#scmt).

## Interfaces

- In: the compiled line, the train parameters, the aspects of the signals, the scenario faults (radio state, TSRs), the current position and speed.
- Out: a `Supervision` (state, P/W/SBI/EBI, MRSP, target, indication) used by the engine, the DMI, the observation and the CSV; the Subset-130 data on request.

## Invariants

- The internal supervision must keep the reference values of `verify-ato` for the example controller on all lines.
- The ETCS constants in `ETCS` and the SCMT values are shared by the supervision and by `atoData()`: changing one without the other breaks the `N_LOC_EBI` check.

## Tests

`verify-ato` (complete runs without interventions, reference values), `verify-scenarios` (radio loss, TSR, stopped leader under ETCS and SCMT), `verify-ato-s130` (`N_LOC_EBI` within 0.2 m of the real intervention with the internal supervision).

## Extensions

A four-aspect block, separate distant signals, level crossings, several commanded trains. A real SCMT is better built as a separate onboard module with its own protocol, following the reference ETCS onboard (see [STANDARDS.md](../STANDARDS.md#what-a-real-scmt-would-need)).
