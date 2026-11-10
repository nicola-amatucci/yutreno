# Validation of the reference onboard curves

The reference onboard (`src/core/evc.ts`) computes the supervision curves following Subset-026 §3.13, with declared simplifications. Until someone compares them with an independent computation, its results hold only inside YuTreno. The independent reference computation is the ERA braking curves tool, the spreadsheet (XLSM) that the Agency publishes with its manual. This page describes how to compare them case by case and how far the work has gone.

**Status on 5 November 2026: started.** The cases are defined and the YuTreno points are generated with one command. The form for the values of the ERA tool is ready and empty: it must be filled in with the tool, which cannot be reached from the YuTreno work network. The comparison script already computes the differences as soon as the form contains values. Independently of the tool, `scripts/verify-curve-validation.ts` and `scripts/verify-subset026.ts` check the curves against the closed-form formulas on level track and on constant gradients.

## The cases

The cases are in [`validation/cases.json`](../validation/cases.json). They are all **single-target**: a single target ahead of the train, constant gradient, constant static profile up to the target. So every difference can be attributed to a single part of the computation.

| Case | Target | Gradient |
| :-- | :-- | :-: |
| `EOA-level` | end of authority, danger point 50 m beyond, release 15 km/h | 0 ‰ |
| `EOA-down-10` | as above | −10 ‰ |
| `EOA-up-10` | as above | +10 ‰ |
| `EOA-down-25` | as above | −25 ‰ |
| `V80-level` | reduction from 160 to 80 km/h | 0 ‰ |
| `V80-down-10` | reduction from 160 to 80 km/h | −10 ‰ |
| `V40-level` | reduction from 160 to 40 km/h | 0 ‰ |

There is a single train, with the gamma model:
- `A_brake_emergency` = 1.3 m/s² and `A_brake_service` = 1.0 m/s², constant with speed;
- `T_brake_emergency` = 1.6 s, `T_brake_service` = 1.2 s, `T_traction_cut_off` = 0.5 s;
- `M_rotating` = 6%, `L_TRAIN` = 150 m, `V_MAXTRAIN` = 160 km/h.

The national values are the default ones of the onboard (`DEFAULT_NATIONAL`):
- speed margins of Subset-026 §A.3.1: `dV_ebi` 7.5–15 km/h, `dV_sbi` 5.5–10 km/h and `dV_warning` 4–5 km/h, between 110 and 210 km/h (140 km/h for the warning);
- `T_driver` = 4 s and `T_warning` = 2 s.

The odometry errors are set to zero, because the tool works on the exact position. The comparison speeds go from 20 to 160 km/h in steps of 10.

## Generating the YuTreno points

```bash
npx tsx scripts/curve-validation.ts                 # results/curve-validation/yutreno_points.csv
```

For every case the script does what a real run would do. It starts the onboard with the stored position and sends it a message 3 with packets 15, 27 and 21. Then, for every speed, it looks for the distance from the target at which each curve equals that speed:
- for **EBI, SBI, W and P** it uses the speeds the onboard publishes on the DMI, searching the position by bisection;
- for **I** it uses the indication;
- for **EBD and SBD** it uses a function of the onboard that goes back along the braking curve on the gradient.

Distances are in metres before the target: before the end of authority or the point of the speed reduction. The EBD of the EOA cases leads to the danger point, so at low speed it has negative distances, beyond the end of authority. An empty cell means that the curve does not reach that speed before the target, or that the onboard does not use that curve. It is the case of the SBD for speed reductions and of the EBI at 20–30 km/h in the EOA cases, which falls beyond the end of authority, where the onboard trips.

`scripts/verify-curve-validation.ts` checks the tool itself. On level track EBD, EBI and SBD match the closed-form formulas within 5 cm, the curves are in the expected order and on a descent they move away from the target.

## Filling in the values of the ERA tool

```bash
npx tsx scripts/curve-validation.ts --era-template    # creates validation/era/era_points.csv, if it does not exist
```

The form has the same rows and columns as the YuTreno points: case, speed and distance from the target for EBD, SBD, EBI, SBI, W, P and I. For every case set in the tool the train, the national values and the target described above, and write in the form the distances from the target at which each curve equals the speed of the row. The quantities of the tool have the Subset-026 names, the same as in `validation/cases.json`.

The tool computes the whole Subset-026 model, including what the reference onboard simplifies. To reduce the differences to those one wants to measure it is advisable to set:
- neutral correction factors of the decelerations: `Kdry_rst` = 1, `Kwet_rst` = 1, `M_NVAVADH` = 0;
- no guidance curve;
- a fixed release speed of 15 km/h instead of a computed one.

What the tool does not allow to neutralise must be noted in the column or at the bottom of the form.

## Comparison

```bash
npx tsx scripts/curve-validation.ts --era validation/era/era_points.csv
```

The script writes `results/curve-validation/differences.csv` with the difference YuTreno − ERA in metres for every curve and speed. A positive difference means that YuTreno asks to brake earlier, that is it is more cautious. On the console it prints the maximum deviation per case and per curve.

## Expected differences

The simplifications of the reference onboard are known. The comparison serves to measure their effect and to find those that are not known. Here is what is expected, curve by curve.

**EBD and SBD.** The onboard uses the decelerations of the train without correction factors. With constant decelerations and neutral factors the curves should match except for the gradient correction. The onboard computes it as g·gradient/(1000 + 10·`M_rotating`), that is with the known rotating mass. A difference growing with the gradient indicates a different formula.

**EBI.** The onboard uses a single dead time, `T_traction_cut_off` + `T_brake_emergency`, run at the current speed. Subset-026 instead distinguishes the time during which traction remains and the reaction time of the brake. During the first it also considers the estimated acceleration of the train and the compensation of the speed error, which are missing here. An EBI closer to the target than that of the tool is therefore expected, that is less cautious, with differences growing with speed and with the assumed acceleration. For speed reductions the onboard stops the EBD at V_target + dV_ebi(V_target): it is a point to check specifically.

**SBI, W, P and I.** Towards the end of authority:
- the SBI is derived from the SBD with `T_brake_service`, or from the EBD with the emergency times plus the service ones, and is the more restrictive of the two;
- W and P add `T_warning` and `T_driver`;
- I adds a lead `T_indication` = max(0.8·`T_brake_service`, 5 s) + `T_driver`.

Towards a speed reduction all four come from the EBD of the target, the one that reaches V_target + dV_ebi(V_target): SBI = EBI − V·`T_brake_service`, then W, P and I as above, none below the ceiling limits of the target.

The tool follows the same structure: the differences should reduce to those the curves inherit from EBD and EBI.

**Ceiling.** The speed margins are interpolated linearly between the minimum and maximum values, as in Subset-026 §A.3.1.

## When it is complete

The validation is complete when it:
1. covers all the cases and all the curves;
2. traces every difference above 1 m back to one of the simplifications listed above, or corrects it in the onboard;
3. reports, for every curve, the maximum deviation and its cause, and records the result in the `validation_judgement` column of the traceability matrix for the rows of §3.13.

The filled-in `validation/era/era_points.csv` goes into the repository together with this page: it is part of the open data.
