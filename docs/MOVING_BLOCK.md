# Moving block

> Italian copy: [it/BLOCCO_MOBILE.md](it/BLOCCO_MOBILE.md).

With the fixed block a train may enter a block section only when the train ahead has cleared it: its authority ends at the signal before the first occupied section. With the moving block it ends a margin behind the rear end of the train ahead, wherever that is. Since the 2023 CCS TSI (Regulation (EU) 2023/1695) this is not a level of its own: what used to be called Level 3 is now "ETCS Level 2 with moving block". In YuTreno it is therefore an option of Level 2 that a scenario turns on (phase 11, decision 15; the plan is in the owner's project, `sviluppo/piano-blocco-mobile.md`).

## How to ask for it

```json
{
  "line": "valle-lauro", "signalling": "ETCS", "onboard": "reference",
  "spacing": "moving_block",
  "moving_block": { "margin_m": 50, "report_period_s": 6, "radio_delay_s": 0 }
}
```

`spacing` is `fixed_block` by default; `moving_block` holds three optional parameters:
- `margin_m`, the margin between the confirmed rear end of a train and the end of authority of the train behind it (the "L3 margin" of the X2Rail-5 specification, whose size the specification leaves to the implementation), 50 m by default;
- `report_period_s`, the period of the position reports that the RBC asks of every train with packet 58 (`T_CYCLOC`), 6 s by default, as the reference onboard reports anyway;
- `radio_delay_s`, how long a position report takes to reach the RBC, 0 by default.

The moving block needs position reports from every train, so it works with ETCS, a message-based onboard (`reference` or `external`) on every train, the simple trackside and a single line. If a variant of the scenario chooses something else (the internal supervision, the automatic block, the interlocking trackside, a network), the run keeps the fixed block and the log says so with a warning.

## The rule

For a train that follows another one in the same direction, the RBC takes the confirmed rear end of the train ahead from its last position report with train integrity confirmed. By Subset-026 §3.6.5.2.4 that is the reported front end minus `L_TRAININT`, the confirmed train length, which runs from the min safe rear end at the time the train was last known to be integer to the estimated front end, so it already contains the odometry uncertainty. The danger point is that rear end, and the end of authority lies the margin behind it. The authority actually given is the shorter of that one and the one the signals would give if the trains of the same direction were not there: the signals keep protecting the departures held for the timetable, the single-track sections given to the opposite direction and the blocked stretches.

The rear end is never moved forwards. In the meantime the train ahead can only have gone on, so the last reported rear end is always on the safe side; an old report costs capacity, never safety. This is where the period of the reports and the delay of the radio become measurable: the follower stays behind a rear end that is up to one period plus one delay old.

A train ahead whose rear end the RBC has never had confirmed (just appeared, or an onboard that does not report integrity) is spaced by the fixed block behind it.

## Integrity and radio

The train interface of a message-based onboard can report that train integrity is lost: the scenario event `integrity_loss` with `train` (the id of a service, `leader` for the freight train ahead, or the controlled train by default) and a duration. The engine then sends the onboard `train.integrity` in its request, only after the first such event, so that the requests of every other run do not change. The reference onboard reports the loss at once (Subset-026 §3.6.5.1.4 d) and in every report until integrity is confirmed again (§3.6.5.2.9), with `Q_INTEGRITY` 3 and no `L_TRAININT`; otherwise it reports `Q_INTEGRITY` 1 with `L_TRAININT` equal to the train length plus `L_DOUBTUNDER`, as if an external source confirmed integrity just before every report. `Q_INTEGRITY` is the Baseline 4 name; the trackside still reads the Baseline 3 name `Q_LENGTH`, with the same values, from an external onboard.

While integrity is lost the RBC has no new confirmed rear end and keeps the old one: the follower stops behind the place where the train ahead was last known to be integer, and goes on when integrity is confirmed again. The same happens when the train ahead stops talking: `radio_loss` with `train` cuts the radio of that train only, in both directions (and its own onboard brakes after `T_NVCONTACT` without messages from the RBC, as with every radio loss).

## What it does not do

The moving block is the one without trackside train detection, between trains of the same direction, in the path of the simple RBC. Left out on purpose: the interlocking trackside, where a route into an occupied section would need permissive routes; trackside detection as a fallback and the virtual sections of hybrid train detection; trains without an integrity monitoring device mixed with trains that have one, except for the fixed block behind a train never confirmed; the track status "unknown" and the sweeping of the X2Rail-5 specification after a failure; the physical model of the integrity monitoring device and of the safe train length; the confirmation of integrity by the driver. The aspects of the signals and the control room still show the block sections occupied: under the moving block they are not what spaces the trains.

## Checks

`npm run verify` runs `verify-moving-block` (MB1–MB6) on the Valle Lauro line with `examples/ato.js` and the reference onboard:

| Case | Moving block | Fixed block |
| :-- | :-- | :-- |
| Behind the freight train (`moving-block`): minimum distance to its rear end, arrival | 94.2 m, 942.8 s | 613.8 m, 1001.8 s |
| The freight train stops on the line for 300 s (`moving-block-leader-stopped`): distance at which the follower waits, arrival | 85.6 m, 1247.6 s | 210.1 m, 1306.6 s |
| Integrity of the freight train lost from 150 to 450 s (`moving-block-integrity-loss`): rear end frozen at 4994 m, arrival | 962.7 s | — |
| Radio of the freight train lost from 150 to 250 s (`moving-block-radio-loss`): rear end frozen at 4994 m, arrival | 1042.2 s | — |
| Reports every 2 s instead of 6 s, arrival | 942.0 s | — |
| Reports 5 s late, arrival | 945.5 s | — |

At every step of every moving block run the follower stays at least the margin less 5 m behind the true rear end of the train ahead, and its end of authority is never closer than the margin to it. With a 600 s headway the second service keeps the realised timetable of the fixed block and is never held by the signalling. The minimum distance of the first row is reached at 7.6 km, where the freight train makes its 150 s stop on the line: the follower waits behind it at the margin plus the age of the last report, where with the fixed block it waited a block section further back.

**Capacity.** `verify-capacity` (CAP5) computes the minimum headway of two regional trains from the confirmed rear ends of the first one and measures it: 193.2 s computed, 199 s measured (+3.0 %), against 239 s with the fixed block and the same onboard. The block comparison campaign (`campaigns/block-comparison.json`) finds that the second train is no longer held by the signalling from 200 s instead of 230 s ([CAPACITY.md](CAPACITY.md#moving-block)).

The rows of the matrix are those of Subset-026 §3.6.5.1–3.6.5.2 and packets 0 and 58, and four rows of the X2Rail-5 specification (`X2R5-MB-*`).
