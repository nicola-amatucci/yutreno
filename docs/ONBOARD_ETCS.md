# Message-based ETCS onboard and external onboard

With ERTMS/ETCS level 2 YuTreno can do the onboard supervision in three ways, chosen with the `onboard` field of the conditions, with the `--onboard` option of headless runs or with the *ETCS onboard* entry in the page.

**Internal** is the simplified supervision of the first versions, still the default value. The onboard knows the movement authority and the line limits directly, without balises or messages, and computes simplified curves.

**Reference** brings in the message-based trackside and an onboard computer (EVC) written to know the world only through the protocol described here. The RBC speaks with the messages and packets of Subset-026, the onboard locates itself on the balises and builds the braking curves following §3.13.

**External** uses the same protocol, but the onboard computer is an external program: an EVC developed elsewhere, a research prototype, one day a real unit.

In all three cases YuTreno remains the rest of the world: line, interlocking and block, RBC, balises, odometry, train dynamics, scenarios and verdict. The onboard sees only what an EVC installed on a train would see. The design of the reference onboard is in [design/reference-onboard.md](design/reference-onboard.md); which Subset-026 clauses it implements, simplifies or omits is in the [traceability matrix](traceability/README.md).

## Trackside

**Balises.** The balise groups are generated from the compiled line:
- one under the train at departure, which acts as the stored position for the start of mission;
- one 40 m before every stop;
- one 20 m before every stop marker board (the block signals, which in level 2 become marker boards);
- others along the line, so that there are never more than 1200 m between two groups.

Every group has two balises 3 m apart, with `NID_C` = 1 and a progressive `NID_BG`. The telegram carries the header of §8.3 and no packet, because in level 2 the balises are used for location. The group is identified by `NID_LRBG = NID_C · 2^14 + NID_BG`.

**RBC.** It keeps one session per train, identified by the `NID_ENGINE` of its position reports (1 for the controlled train, then the service trains in order); every session has its own LRBG and its own authority. It opens the session at the first position report of the onboard (message 136 with packet 0). From then on it sends message 3, referred to the last balise group reported by the onboard, with these packets:

| Packet | Content |
| :-- | :-- |
| 15 | level 2 movement authority: one section up to the end of authority (`L_ENDSECTION`), danger point 50 m beyond (`D_DP`), release speed 15 km/h (`V_RELEASEDP` = 3) |
| 27 | static speed profile (`D_STATIC`, `V_STATIC` in 5 km/h steps), closed by `V_STATIC` = 127 |
| 21 | gradients in integer ‰, rounded on the safe side (`Q_GDIR`, `G_A`), closed by `G_A` = 255 |
| 5 | linking of the balise groups ahead of the train |
| 65 and 66 | temporary speed restrictions of the scenarios, issued and revoked |

The message leaves when something changes (authority, LRBG, restrictions) and anyway every 5 s, so that the onboard can supervise the radio contact. The stop order of the scenarios becomes message 16 (unconditional emergency stop). With the radio failed the messages in both directions are lost and the RBC does not repeat them.

All distances are in metres (`Q_SCALE` = 1). The balise groups have a nominal direction, that of the line. A train running the other way (a service towards the origin) reads `N_PIG` = 1 before `N_PIG` = 0: the onboard recognises that it passed the group in reverse and says so in its position reports (`Q_DIRLRBG`, `Q_DLRBG`, `Q_DIRTRAIN` = 0). The RBC then sends it packets with `Q_DIR` = 0, with distances counted from the LRBG in its direction of running, and the onboard keeps only the packets valid for its orientation (`Q_DIR` equal to it, or 2). Trains running in the nominal direction receive `Q_DIR` = 1, as before. A group is added just beyond the stations where trains start in reverse, so that they too have a stored position behind them; it is numbered after the groups of the line, which keep their identifiers. The iterations of a packet are in the `elements` field, after the values of the first element, which stay at the level of the packet. It is the way Subset-026 orders them, with `N_ITER` saying how many elements follow.

With `--trackside interlocking` the authority comes from the routes of an interlocking instead: see [TRACKSIDE.md](TRACKSIDE.md).

## Onboard protocol

At every onboard cycle, every 100 ms unless stated otherwise (`onboard_period_s`, `--onboard-cycle`), the engine stops and sends the onboard a JSON request:

```json
{
  "type": "onboard", "version": 2, "start": false, "t": 61.3, "dt": 0.1,
  "odometry": { "distance_m": 1802.4, "speed_ms": 27.1, "acceleration_ms2": 0.12 },
  "balises": [ { "odometer_m": 1801.9, "telegram": { "N_PIG": 0, "NID_C": 1, "NID_BG": 4, "...": "..." } } ],
  "radio": [ { "NID_MESSAGE": 3, "T_TRAIN": 6125, "NID_LRBG": 16388, "packets": [ "..." ] } ],
  "train": { "doors_open": false, "emergency_applied": false, "traction": 0.6, "brake": 0 }
}
```

`odometry` gives the distance run since departure, exact unless the scenario has an `odometry_drift` event: then the distance, the speed and the odometer readings of the balises read more or less than the train runs, by `slope` metres per metre, from the start of the event (see below). `balises` lists the balises read in the cycle, each with the odometer reading at the passage. `radio` contains the RBC messages arrived in the cycle. The first request (`start`) also contains:
- `train_data`: length, maximum speed, emergency and service decelerations, brake and traction cut-off times, rotating masses;
- `national_values`: speed margins, driver and warning times, `T_NVCONTACT` and `M_NVCONTACT`, odometry error;
- `stored_position`: the balise group under the train and the distance of the head from it.

`train.integrity` (optional, `"confirmed"` or `"lost"`) is the train integrity given by an external source through the train interface (Subset-026 §3.6.5.2): the engine sends it only once an `integrity_loss` event has fired, and without it the onboard takes integrity as confirmed. The reference onboard reports it in packet 0 with the Baseline 4 names: `Q_INTEGRITY` 1 and the confirmed train length `L_TRAININT` (train length plus `L_DOUBTUNDER`, since the confirmation is renewed before every report), or `Q_INTEGRITY` 3 without a length, in every report from the loss, which itself triggers a report.

The onboard responds with the commands towards the train, the messages for the RBC and what the DMI must show:

```json
{
  "outputs": { "service_brake": false, "emergency": false, "traction_cut_off": false },
  "emergency_reason": "intervention",
  "radio": [ { "NID_MESSAGE": 136, "T_TRAIN": 6130, "packets": [ { "NID_PACKET": 0, "NID_LRBG": 16388, "D_LRBG": 1, "...": "..." } ] } ],
  "dmi": { "mode": "FS", "state": "NOR", "v_mrsp_ms": 38.9, "v_permitted_ms": 38.9, "v_warning_ms": 40.0,
           "v_sbi_ms": 40.4, "v_intervention_ms": 41.0, "target": { "distance_m": 812, "speed_ms": 25, "type": "limit 90 km/h" } }
}
```

The DMI can also contain the optional field `ato`, with the data the onboard makes available to ATO following Subset-130. They are the same fields as `etcs_ato` in the controller observation ([API.md](API.md#onboard-data-for-ato-subset-130)), but with the positions (`N_LOC_EBI`, `N_LOC_EOALOA`, `N_LOC_SVL`, `MRSP`, `GRADIENT`) as onboard odometer readings. The engine converts them into line chainages before passing them to the controller. An onboard that does not provide `ato` works anyway, but an ATO that plans with respect to the EBI does not have the data to do it.

The commands hold until the next response. The engine applies them as the train interface (TIU) would: emergency removes traction and brakes fully, service braking brakes at the service maximum, traction cut-off just removes traction. `emergency_reason` is used by the verdict. Only `intervention` counts as a protection intervention; `trip`, `emergency_stop` and `radio_contact` stay in the log. Passing the end of authority is counted by the engine, which knows where the train really is, and it does not brake in place of the onboard: an onboard that does not brake is exactly what a test must find out. It counts both the head going more than 0.5 m beyond the end of authority and the head passing a marker still at danger for the train, because the authority the engine computes again from the position goes beyond a marker once the head has passed it ([signalling.md](design/signalling.md#overruns-and-an-authority-recomputed-from-the-position)).

With several RBCs the radio messages carry `NID_RBC` (optional): in a message to the onboard the RBC that sends it, in a message from the onboard the RBC it is for. An external onboard that has to cross an RBC border must read it and address its messages with it; with one RBC it is absent.

An EVC written for version 0.x speaks protocol version 1, with Italian names (`tipo: "bordo"`, `odometria`, `boe`, `uscite`…): it is connected with `--protocol 1`, and its responses are accepted with either names.

## Reference onboard

`src/core/evc.ts` is the onboard computer of the core. It locates itself on the last balise group read and keeps a confidence interval that grows with the distance from the group. It converts authority, static profile, gradients and temporary speed restrictions from the LRBG coordinates to odometer coordinates.

For every target, that is every speed reduction, the end of authority and the danger point, it computes the braking curves:
- the emergency (EBD) and service (SBD) braking curves, integrating the deceleration over the gradient stretch by stretch, with the correction for the rotating masses;
- from those, with the traction cut-off, braking and driver times, the intervention (EBI), service brake (SBI), warning (W), permitted (P) and indication (I) speeds.

The ceiling supervision uses the speed margins of Subset-026, interpolated with speed between the minimum and maximum values. The onboard commands the emergency brake beyond the intervention speed and service braking beyond the SBI, until the speed is back below the permitted one. It trips if the head, at its rearmost possible position, passes the end of authority. It brakes if it receives no message from the RBC for more than `T_NVCONTACT` and responds to the stop order. It sends a position report at every balise group, at every mode change and every 6 s.

It also provides the data for ATO. In particular the location of the nearest intervention limit (`N_LOC_EBI`) is obtained by going back along the EBD curve from the target to the current speed, gradient stretch by gradient stretch, and subtracting the distance run during the traction cut-off and braking times.

It is declaredly partial. Among other things it lacks:
- the dependency of the decelerations on speed and the compensation of the estimated acceleration;
- the on sight and staff responsible modes and level transitions;
- multi-section authorities with timers, conditional messages and driver acknowledgements.

After a trip or a stop order, with the train at standstill, the onboard goes back to full supervision at the first authority, without asking for an acknowledgement.

**Two RBCs.** With the interlocking trackside and RBC borders (`rbc_borders_m`, [TRACKSIDE.md](TRACKSIDE.md#several-rbcs-and-the-handover)) the onboard has two radio terminals and can keep two sessions. The first `NID_RBC` it hears is its supervising RBC. Packet 131 in an authority tells it the Accepting RBC and the distance to the border: from then on it sends its position reports to both, stores what the Accepting RBC sends and uses nothing of it yet. At the first report to the Accepting RBC with its max safe front end past the border it switches supervision to it and applies the stored messages; from the old RBC it then accepts only the order to terminate the session (packet 42, `Q_RBC` = 0), to which it answers with message 156. When its min safe rear end passes the border it reports once more; without the order it repeats the report three times every 15 s and then terminates by itself. Messages from any other RBC are ignored. Without `NID_RBC` in the messages it behaves exactly as before. The onboard with a single radio terminal, which must close the first session before opening the second, is not done yet.

The example controller drives with this onboard on all lines without interventions. The scenarios have the same verdicts as with the internal supervision. The runs are tighter, that is later braking and a few kWh more, because the internal supervision uses decelerations reduced prudently for adhesion while the reference onboard uses those of the train data.


**Odometry drift.** The reference onboard locates the train from its last balise group: the distance from the group is the difference of two odometer readings, so an odometer that drifts makes an error that starts again from zero at every group and grows with the distance from it, by the drift. Its confidence interval is 2 m + 1 % of that distance (`odo_error_fixed_m`, `odo_error_relative`) and it does not monitor the accuracy of the odometer (Subset-026 §3.6.8, missing), so a drift above 1 % takes the error outside the interval without the onboard knowing. `verify-onboard` O10 measures it on Valle Lauro behind the freight train, with groups at most 1200 m apart:

| Drift | Largest error | Outside the interval by | Stop before the end of authority |
| :-- | :-- | :-- | :-- |
| none | 0 m | — | 37.4 m |
| −1 % | 11.4 m | — (within) | 26.1 m |
| −5 % (`scenarios/odometry-drift.json`) | 56.9 m | 44.1 m | 2.0 m |
| +5 % | 56.8 m | 42.9 m | 90.7 m |
| −10 % | 113.7 m | 101.5 m | marker 6 passed at danger |

An odometer that reads less than the train runs is the dangerous case: the onboard believes the train further back, and at −10 % the train passes the marker protecting the freight train ahead; the engine counts it as an overrun and holds the train there until the marker clears ([signalling.md](design/signalling.md#overruns-and-an-authority-recomputed-from-the-position)). An odometer that reads more is on the safe side and costs only distance. The stops at the platforms do not change, because `examples/ato.js` reads the distance to the stop from the observation of the engine, not from the onboard.

## Connecting an external EVC

The external onboard uses the same channels as the external dynamics:

```bash
npm run headless -- --onboard "exec:python examples/onboard/minimal_onboard.py"    # process on stdin/stdout
npm run headless -- --onboard tcp://localhost:6000                                 # EVC already listening, JSON lines
npm run headless -- --onboard ws://localhost:8767                                  # EVC as a WebSocket server
npm run headless -- --onboard examples/my_onboard.js                               # function onboard(req, mem) in JavaScript
npm run headless -- --scenario scenarios --onboard "exec:..."                      # all scenarios with your EVC
```

In the page choose *External via API* in the conditions bar and give the WebSocket address. The bridge takes the page to the EVC:

```bash
npm run bridge -- --port 8767 --exec "python examples/onboard/minimal_onboard.py"
```

An external onboard and an external dynamics can be used together, each on its own channel.

There are two examples.
- `examples/onboard/minimal_onboard.py` is a minimal onboard in Python, written on purpose as a template. It locates itself, reads packets 15, 27, 65 and 66, computes a simple curve towards the targets and sends the position reports. It drives the example controller to the terminus on both lines.
- `examples/onboard/onboard_stdio.ts` runs the reference onboard of the core as an external process. The checks verify that it gives exactly the same data as the internal version.

For a step-by-step path, including the integration of openETCS, see [EVC_GUIDE.md](EVC_GUIDE.md).

## Checks

`scripts/verify-onboard.ts` checks:
- the placement of the balises;
- the opening of the session and the content of message 3, with the distance from the reference balise to the end of authority;
- temporary speed restrictions as packet 65 and the stop as message 16;
- complete runs without interventions and deterministic;
- the same verdicts as the internal supervision on all ETCS scenarios;
- a driver who never brakes and is stopped by the onboard before the end of authority;
- the equivalence between internal and external onboard.

`scripts/verify-subset026.ts` tests the reference onboard clause by clause, driving it cycle by cycle with hand-built telegrams and messages: location, position reports, MA and its update, SSP, TSR, train-related restrictions, MRSP with the train length, ceiling margins and states, gradient and rotating mass correction, EBD/SBD/EBI/SBI in closed form, release speed, trip and post trip, emergency stop, radio contact loss and the Subset-130 data. Every block is linked to the matrix rows it covers ([traceability/README.md](traceability/README.md)).

## Towards hardware

The protocol is already what a test bench would need: odometry, balises and radio as inputs, commands towards the train and DMI as outputs, as in the test architecture of Subset-094. Two steps remain.

The first is a real-time mode of the engine, locked to the clock instead of the step, because a real EVC does not wait ([REAL_TIME.md](REAL_TIME.md)). The second are the physical adapters: odometry pulses, telegrams towards an antenna or a BTM simulator, Euroradio towards the RBC, train lines towards the TIU.

Even before that, the bit encoding of telegrams and messages according to Subset-026 §7–8 would be worthwhile, so as to test the decoder of the onboard too.
