# Simple message-based RBC and balise groups

## Purpose

`src/core/simple-rbc.ts` is the trackside of the message-based ETCS runs when no interlocking is chosen: it places the balise groups along the line and runs an RBC that turns the authority of the block into Subset-026 messages. It is small on purpose: it gives an onboard everything it needs for level 2 full supervision, with the authority computed as in the internal supervision, so that the only difference between internal and reference runs is the onboard.

## Balise groups

`buildBaliseGroups(L, reverseStarts)` places a group under the train at departure (stored position), one 40 m before every stop, one 20 m before every stop marker board and others so that no gap exceeds 1200 m. Every group has two balises 3 m apart (`BALISE_SPACING`), `NID_C` = 1 and a progressive `NID_BG`; `nidLrbg()` gives `NID_C·2^14 + NID_BG`. `baliseTelegram(bg, nPig)` builds the telegram: header (`Q_UPDOWN`, `M_VERSION`, `N_PIG`, `N_TOTAL`, `M_DUP`, `M_MCOUNT`, `NID_C`, `NID_BG`, `Q_LINK`) and packet 255 only. The engine queues a telegram for every balise passed by the head, with the odometer reading, in the order the train meets them: a train running against the nominal direction reads `N_PIG` 1 before 0. `reverseStarts` adds a group just beyond each station where a train starts in reverse, numbered after the others so that the identifiers of the line do not change.

## RBC

`Rbc` keeps one `RbcSession` per train, by `NID_ENGINE`: last position report with the orientation of the train with respect to its LRBG, state of TSRs and of the emergency stop. All the trains of a run share one `Rbc`; `stopOrder` and `open` refer to the controlled train (engine 1).

- `receive(m)`: a position report (136, or 132) opens the session of its `NID_ENGINE` and updates LRBG, distance and orientation (`Q_DIRLRBG`).
- `tick({ t, ma, baseLim, tsr, engine })`: for the session of `engine`, when it is open and something changed (authority, LRBG, TSRs) or every `refresh` = 5 s, it sends message 3 referred to the last reported LRBG, with packet 15 (one section to the EOA, danger point, release speed), 27 (static profile from the line limits), 21 (integer gradients rounded on the safe side), 5 (linking of the groups ahead), 65/66 (TSRs issued and revoked). When `stopOrder` is set it sends message 16 once.

All distances are in metres (`Q_SCALE` = 1). For a train oriented as the LRBG the packets have `Q_DIR` = 1; for a train running against it `Q_DIR` = 0, and positions, profiles and the groups to link are those of the line seen from its direction (`mirrorLine`), with the authority, limits and TSRs given by the engine in the chainages of that direction. Iterations are in `elements` after the first element, as in Subset-026.

**Moving block.** `receive` also keeps, from every report with integrity confirmed (`Q_INTEGRITY` or `Q_LENGTH` 1 or 2, with `L_TRAININT`), the confirmed rear end of the train in nominal chainages with its time (`RbcSession.rears`, the last 64); `confirmedRear(engine, t, delay)` gives the last one that had reached the RBC `delay` seconds before `t`. With `spacing: 'moving_block'` the engine builds the authority from it (`traffic.ts`, `movingAuthority`, [MOVING_BLOCK.md](../MOVING_BLOCK.md)) and `tick` adds packet 58 with `T_CYCLOC` (`tCycloc`) to every message 3.

## Interfaces

In: the compiled line, the authority of the block (`MovementAuthority`), the base limits, the TSRs of the scenarios, the onboard messages. Out: radio messages. The engine passes them to the onboard only while the radio works; with `radio_loss` both directions are lost.

## Invariants

- Message 3 is always referred to a group the onboard has reported: an onboard that never reports never receives an authority.
- The transmitted EOA never lies beyond the block authority.
- Changing the content of the messages changes the reference runs of the campaign: it must be done on purpose and documented.

## Tests

`verify-moving-block` (confirmed rear end, packet 58, frozen rear end) and `verify-onboard` (placement of the groups, session, one session per train with trains in both directions, content of message 3 with `L_ENDSECTION` equal to the distance from the LRBG to the EOA, TSR as packet 65, stop as message 16) and `verify-subset026` (telegram structure).

## Extensions

Start of mission dialogue (155, 32, 159, 129, 8, 132) and acknowledgements, packet 3 with national values, multi-section authorities. The interlocking trackside ([interlocking-trackside.md](interlocking-trackside.md)) already replaces the authority computation with routes.
