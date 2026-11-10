# Reference ETCS onboard (EVC)

## Purpose

`ReferenceEvc` in `src/core/evc.ts` is an ETCS level 2 onboard computer that knows the world only through the onboard protocol: odometry, balise telegrams and radio messages in, train commands, radio messages and DMI out. It exists for two reasons: to make the message-based ETCS runs possible without an external EVC, and to be the reference against which external EVCs are compared. Its behaviour with respect to Subset-026 and Subset-130 is in the [traceability matrix](../traceability/README.md); this document describes how it is built.

## Responsibilities

- Locate the train on balise groups and keep the confidence interval.
- Receive and store movement authority, static speed profile, gradients and temporary speed restrictions, referred to the LRBG.
- Supervise speed and distance with the braking curves of §3.13 and command the train.
- Manage the modes SB, FS, TR, PT and the reaction to the emergency stop and to the loss of radio contact.
- Report its position to the RBC and provide the Subset-130 data for ATO.

- With several RBCs, keep two sessions and hand over from one to the other (§3.15.1.3).

It does not do start of mission, level transitions, the other modes, multi-section authorities, conditional messages, acknowledgements or bit encoding.

## Cycle

`step(req)` is one onboard cycle (100 ms by default). It translates the request with `toEnglish`, resets on `start` (train data, national values merged with `DEFAULT_NATIONAL`, stored position as LRBG), stores odometry, reads the balises (`readBalise`: only `N_PIG` = 0 sets the reference; if `N_PIG` = 1 of the same group came just before, the group was passed against its nominal direction and the train is oriented in reverse with respect to it, reported in `Q_DIRLRBG`, `Q_DLRBG` and `Q_DIRTRAIN`) and the radio messages (`readRadio`), supervises (`supervise`), sends a position report when due (new LRBG, mode change, every 6 s) and returns outputs, messages, DMI and position.

## Data

All trackside data are converted at reception from distances relative to the LRBG to odometer readings, using the odometer reading stored for that balise group (`bgOdo`). A message referred to an unknown group is discarded, and only the packets valid for the orientation of the train with respect to that group are used (`Q_DIR` equal to it, or 2). Profiles are stored as segments `[from, to, value]`: `ssp`, `grad`, and `tsr` by `NID_TSR`. A new message 3 replaces authority, profile and gradients entirely (declared simplification of §3.7).

## Curves

- `ebdBack(xt, vt, v, a)` is the EBD or SBD towards the target `(xt, vt)` read as a location: where the curve equals `v`, going back segment by segment with the deceleration `a + g·grad/(1000 + 10·M_rotating)` of each gradient segment. It gives the EBI location for `N_LOC_EBI` and is exposed as `brakingCurvePoint()` for the curve validation.
- `solve(x, T, xt, vt, a)` finds the largest speed `v` whose limit location `ebdBack(v) − v·T` is not behind `x`; it gives EBI (`T = T_traction_cut_off + T_brake_emergency`), SBI2 (`+ T_brake_service`), W (`+ T_warning`), P (`+ T_driver`) and I (`+ T_indication`, with `T_indication = max(0.8·T_bs, 5 s) + T_driver`), and SBI1/W/P/I from the SBD towards the EOA. For a speed reduction all of them come from the EBD towards V_target + dV_ebi and none goes below the ceiling limits of the target.
- The ceiling uses the MRSP under the whole train (`mrspSegments`, limited by `V_MAXTRAIN`) with the margins `margin()` interpolated between the national values.

## Two RBCs

`sup` is the supervising RBC (the first `NID_RBC` heard); with messages without `NID_RBC` it stays `null` and nothing below applies. Packet 131 creates `hand` (Accepting RBC, border as odometer reading, session open, report of the front end sent, stored messages). In `readRadio` messages of the ACC are stored, those of the old HOV (`old`) are read only for the termination order (`terminates()`), those of any other RBC are dropped. `positionReport()` addresses the report to `sup` and copies it to the ACC or to the old HOV; at a report with the max safe front end past the border it switches `sup`, keeps the old RBC in `old` and replays the stored messages. `handoverStep()` sends the report of the front end once, and for the old session the report of the min safe rear end, repeated up to 3 times every 15 s before `terminate()` sends message 156 by itself.

## Train integrity

`integrityLost` follows `train.integrity` of the request; its change to lost sets `reportPending` (§3.6.5.1.4 d). `positionReport()` writes `Q_INTEGRITY` 1 with `L_TRAININT` = train length + the doubt under, as if the external source confirmed integrity just before every report, or `Q_INTEGRITY` 3 without a length.

## Commands and modes

Emergency brake above the EBI until standstill; service brake above the SBI until back to P; traction cut-off with either and in SB/PT. Trip when the min safe front passes the EOA (unless the authority reaches the end of the line), on message 16 and, with `M_NVCONTACT` = 0, on loss of radio contact; with `M_NVCONTACT` = 1 the loss of contact commands the service brake. TR becomes PT at standstill; a new authority at standstill brings SB or PT to FS.

## Invariants

- No import from the engine except protocol types and `legacy.ts`: anything it does, an external EVC can do through the protocol.
- The same onboard run in-process and as an external process (`examples/onboard/onboard_stdio.ts`) gives identical data.
- `brakingCurvePoint()` and the DMI speeds come from the same functions, so the curve validation measures the onboard itself.

## Tests

`verify-subset026` (25 requirement-level blocks, closed form where possible), `verify-curve-validation` (EBD, EBI, SBD in closed form on level track), `verify-onboard` (complete runs, scenarios, driver who never brakes, external process), `verify-ato-s130` (`N_LOC_EBI` within 1.3 m of the real intervention, same ATO data in-process and external).

## Known divergences and next steps

The three divergences of §3.13 listed in the matrix: gradient at the head, emergency times added, no estimated acceleration nor speed error. Next steps: complete the ERA tool comparison, correct the overlap of the emergency times, add the start of mission dialogue together with the RBC, then bit encoding.
