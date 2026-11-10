# Independent onboards: feasibility note

The differential comparison between ETCS onboards makes sense only if at least one onboard was written by others, without knowing YuTreno. The reference onboard of the core is not enough: it is written together with the trackside it must test. This note evaluates the two most promising open candidates, [cesarBLG/ETCS](https://github.com/cesarBLG/ETCS) and [milanredele/etcs-dmi](https://github.com/milanredele/etcs-dmi), and estimates the effort to connect them to the external onboard protocol ([ONBOARD_ETCS.md](ONBOARD_ETCS.md)).

Both repositories were read on 5 November 2026, without running their code:
- cesarBLG/ETCS at commit `0ca9cee` of 22 October 2026;
- milanredele/etcs-dmi at commit `cf85cea` of 30 October 2026.

## What an onboard must do to enter the campaign

The YuTreno protocol is closed-loop and lockstep. At every cycle the engine sends odometry, balises read and radio messages, and waits for commands towards the train, messages for the RBC and DMI. A real onboard does not know it is stopped between one cycle and the next, so an adapter must make it believe that time flows only when the engine says so. Four things are needed:
1. the time of the onboard must come from the engine;
2. the data must be translated between the decoded JSON of YuTreno and the format of the onboard, which for both candidates is the bit encoding of Subset-026 §7–8;
3. the onboard must be brought into full supervision without a driver, that is with an automatic start of mission;
4. the outputs must be read: emergency, service braking, traction cut-off and DMI speeds, plus, for the Subset-130 ATO, the EBI location.

## cesarBLG/ETCS

It is an onboard in C++, about 25,000 lines in the EVC part, under the **MPL-2.0** licence. It covers level 1 and level 2, with Euroradio over TCP, and was born for OpenRails and SimRail, where it is really used.

**Time.** All the time of the onboard goes through `platform->get_timer()`, and the main loop (`update()` in `evc.cpp`, every 50 ms) reschedules itself with `platform->delay()`. The code already has several interchangeable platforms (`platform/`: console, SDL, SimRail). A «YuTreno» platform that returns the simulated time and runs the waits when the engine advances makes the onboard lockstep. The only two non-repeatable points are two `std::random_device`, one for the train identifier and one in the secure radio connection. They must be replaced by a fixed seed, a two-line change.

**Inputs and outputs.** The onboard talks to the simulator through a bus of textual parameters in OpenRails style (`OR_interface/interface.cpp`):
- `distance`, `speed` and `acceleration` for odometry;
- `etcs::telegram` for telegrams, as a bit string;
- `etcs::emergency`, `etcs::fullbrake` and `etcs::tractioncutoff` for the commands;
- `etcs::vperm`, `etcs::vsbi`, `etcs::vtarget`, `etcs::dtarget` and `etcs::supervision` for the DMI.

Radio messages go through Euroradio instead. The packet classes (`Packets/`) have the names of the Subset-026 variables and can read and write themselves in bits. The adapter can therefore build the packets from the YuTreno JSON and have the onboard itself encode them.

**Start of mission.** In level 2 the onboard opens the session with the RBC and carries out the start of mission dialogue: 155, 32, 159, 129, 8, 146, then the authority request. The YuTreno RBC today opens the session at the first position report and must be extended. The `bot_driver` option removes the driver acknowledgements. The DMI inputs (identifier, level, train data, start) must anyway be simulated on the DMI bus.

**ATO data.** The bus does not expose the EBI location. The adapter can derive it from the supervision targets (`Supervision/`), or the Subset-130 ATO falls back to the simple behaviour.

## milanredele/etcs-dmi

It is a complete DMI and, since September 2026, an onboard that implements Subset-026 v4.0.0 in SPARK/Ada, with proof of absence of run-time errors, for TI Hercules microcontrollers. The repository counts about 54,000 lines in the `evc/` part, is under the **GPL-3.0** licence and is very active.

**Time.** It is the candidate best suited to lockstep. The core (`EVC_Core`) exposes `Handle_Input (Port, Payload)`, `Tick (Dt_Ms)` and `Take_Outputs`, uses no threads, dynamic allocation or floating point, and does everything in integers with rounding on the safe side. A cycle is a call, and determinism is in the design, it does not need an adapter.

**Inputs and outputs.** The ports are documented byte by byte in `evc/evc_ports.ads`:
- BTM: a telegram of 210 or 830 bits, with the odometer stamp;
- RTM: a radio message of chapter 8;
- odometer: 22 bytes;
- TIU: emergency, service braking, traction cut-off and reasons;
- DMI: the DMI frame protocol;
- JRU.

The bit encoder is generated from a catalogue of the packets, and `sim/` already contains a trackside, an automatic driver and a test ATO.

**Two corrections to what we expected.** First: the **ATO port exists but has no format yet**, and the onboard rejects every input on it (`evc_ports.ads`: «no payload is defined»). The Subset-130 data therefore do not come out today. Second: the onboard can be **driven only in level 1**. The plan of the repository (`doc/EVC-PLAN.md`) gives phases E0–E3 closed and E4, level 1 modes and procedures, integrated. The next one is E5, that is radio, sessions and level 2. The transition conditions concerning level 2 answer false today.

**Start of mission.** In level 1 it goes through the DMI frames: driver identifier, level, train data, start. The automatic driver of `sim/` already does it and can be reused.

**Consequence for YuTreno.** Until E5 is there, the onboard can be tested only with a level 1 trackside, that is with balises carrying the authority in packet 12, linked to the signals. YuTreno today generates level 2 and for level 1 would need a new trackside.

## Effort estimate

The estimates are in days of focused work and include tests and documentation. There is work common to both candidates: a **bit encoder and decoder** of Subset-026 §7–8 telegrams and messages in the YuTreno core, for the packets and messages the trackside already produces. It was already among the planned steps for the bench ([ONBOARD_ETCS.md](ONBOARD_ETCS.md#towards-hardware)) and it also tests the decoder of the onboard. For cesarBLG it could be avoided by using the classes of the onboard, but keeping it in the core makes the translation independent of the onboard under test.

| Work | cesarBLG, level 2 | milanredele, level 1 |
| :-- | :-: | :-: |
| Bit encoder and decoder in the core (common) | 5–7 | 5–7 |
| Time from the engine: YuTreno platform or call to `Tick` | 3–5 | 1–2 |
| Process adapter: external onboard protocol on stdin/stdout | 2–3 | 3–4 (Ada host, build with Alire) |
| Start of mission: RBC dialogue (cesarBLG) or DMI frames (milanredele) | 3–5 | 2–3 |
| Level 1 trackside with packet 12 at the signals | — | 4–6 |
| Outputs, DMI and EBI location for ATO | 2–3 | 2–4 (derived from inside, the ATO port does not give it) |
| Determinism, campaign and Docker | 2–3 | 2–3 |
| **Total** | **17–26** | **19–29** |

## Risks

**cesarBLG.**
- The 50 ms cycle and the YuTreno one, 100 ms, must be aligned: the engine must grant two onboard cycles for every protocol cycle, or the protocol must go down to 50 ms.
- The code is written for use in a driving simulator, and some behaviour may depend on that environment: OpenRails or SimRail, cab, train configuration in `config.json`.
- The MPL-2.0 licence applies per file: the modified onboard files stay MPL, the adapter can have the licence one prefers. Publishing everything poses no problem.

**milanredele.**
- Level 2 depends on the timing of somebody else's project.
- The comparison in level 1 requires scenarios different from today's, so it would not be a comparison on the same scenarios as the reference onboard until that one also supports level 1.
- The GPL-3.0 licence extends to an adapter that links to the code. A separate adapter that talks to the onboard as an external process is instead a program of its own. In any case the publication of data and scenarios is not affected.

## Recommendation

**cesarBLG in level 2** is the advisable independent onboard. It works on the same scenarios as the reference onboard, the licence creates no constraints and its time can be replaced without touching the logic. The proposed order of work:
1. the bit encoder, which is needed anyway;
2. the deterministic platform with the repeatability check of the campaign, that is two runs with the same hash;
3. the start of mission;
4. the entry into the matrix of `campaigns/reference.json` as a third onboard.

milanredele remains the best candidate for repeatability and for the quality of the code with respect to the specification. It is worth following its phase E5 and, meanwhile, proposing to the author a format for the ATO port with the Subset-130 data (packets 6 and 11). That port is today defined but empty, and the project declares it welcomes written decisions where the specification is silent. When level 2 arrives, the cost of connecting it goes down to about 10–14 days, because the common encoder and the campaign will already be ready.
