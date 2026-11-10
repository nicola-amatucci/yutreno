# Guide: connecting an ETCS onboard computer to YuTreno

This guide is for those who have, or want to write, an ETCS onboard computer (EVC) and want to test it on YuTreno. The computer can be a research prototype, a teaching implementation or an existing EVC to wrap with an adapter. The second part describes the concrete path to integrate openETCS, the open implementation born from the European project of the same name, which we have already downloaded, compiled and run.

The protocol is described in [ONBOARD_ETCS.md](ONBOARD_ETCS.md); here we explain how to use it.

## What you get

The idea is simple. YuTreno simulates everything outside the onboard computer:
- the line with its balises;
- the RBC that grants the authorities;
- the train moving according to its dynamics;
- the driver, human or automatic;
- the faults of the scenarios and the final verdict.

The computer receives what it would receive on a real train (odometry, balise telegrams, radio messages) and responds as a real EVC would: service braking, emergency, traction cut-off, messages for the RBC and indications for the DMI.

The engine runs in lockstep with the computer: it stops, sends it the request and restarts only with the response. So a run is repeatable byte by byte. A scenario that puts an EVC in difficulty, for example leaves on the rail, a degraded brake or a radio lost at a precise point, can be replayed identically after every change of the code. The verdict says whether the train stopped where it should, whether the protection intervened and whether there was an overrun of the authority.

There is an important detail: the engine counts overruns but does not brake in place of the onboard. An EVC that gets a curve wrong lets the train pass beyond the end of authority, and the verdict records it. It is exactly what one wants to find out in a test.

## How a run looks, seen from the onboard

At the **first request** the field `start` is true and three things arrive:
- the train data: length, maximum speed, decelerations, braking and traction cut-off times, rotating masses;
- the national values;
- the stored position, that is the balise group under the train and the distance of the head from it.

It is the equivalent of a start of mission with a valid position. The onboard must reset itself, record that group as LRBG and send a position report at once (message 136 with packet 0). Until the RBC receives that report it does not open the session and sends nothing.

**The first authority.** Once the report is received, at the next cycle message 3 arrives, referred exactly to that balise group. It contains the movement authority (packet 15), the static speed profile (27), the gradients (21), the linking of the balises ahead (5) and any temporary speed restrictions (65). The onboard converts all distances from the LRBG to its own coordinates and supervises from there.

**While running**, at every cycle (100 ms unless chosen otherwise) arrive:
- the odometry;
- the balises passed in the cycle, each with the odometer reading at the passage;
- the radio messages.

The RBC renews message 3 every 5 s even if nothing changes, and sends it again at once when the authority, the reference group or a restriction changes. The onboard must send position reports at every balise group read, because the RBC always uses the last reported LRBG as the reference of the following messages.

**The scenarios** come into play halfway through the run. With the radio failed the messages are lost in both directions and the onboard must notice it by itself with `T_NVCONTACT`. The stop order arrives as message 16. Reduced adhesion zones and the degraded brake are not announced: they are seen only from their effects, that is longer braking and wheel slip.

**At the end** of the run the channel closes: with a process, stdin closes and the program must terminate.

## From the minimal onboard to your own EVC

The shortest path starts from `examples/onboard/minimal_onboard.py`. It is an onboard in little more than a hundred lines of Python that takes the train to the terminus on both lines. The first step is to run it as it is:

```bash
npm run headless -- --onboard "exec:python examples/onboard/minimal_onboard.py"
npm run headless -- --line appennino --onboard "exec:python examples/onboard/minimal_onboard.py"
```

From there you replace one piece at a time with your own code, checking after every step that the run stays passed.

**The read loop.** One line of JSON per request, one per response, nothing else on stdout. Diagnostic messages go to stderr, which appears on the YuTreno console. To understand what arrives it is worth, the first times, writing every request and response to a file from your own program.

**Location.** The balise group is recognised from its first balise (`N_PIG` = 0). The identifier to use in the messages is `NID_C · 16384 + NID_BG`. The odometer reading at the passage is the reference to which the distances of the packets are added.

**Trackside data.** In packets with iterations the values of the first element are at the level of the packet and the following ones in `elements`. Every distance `D_…` is incremental with respect to the previous element. The static profile ends with `V_STATIC` = 127, the gradients with `G_A` = 255. Speeds are in 5 km/h steps, distances in metres.

**Supervision.** Here lies the value of an EVC, and it is the part to compare with the YuTreno reference onboard (`--onboard reference`), which follows Subset-026 §3.13. It is worth running the same scenarios with the two onboards and comparing the CSVs: permitted speed, supervision state and mode are in the same columns. `scripts/verify-subset026.ts` shows, clause by clause, the tests that the reference onboard passes: they are a good model for tests of your own EVC.

**Responses.** Three precautions avoid the most common errors:
- `outputs` and `dmi` must always be present;
- when commanding the emergency brake give `emergency_reason`, because the verdict counts as interventions only those with reason `intervention`;
- the emergency brake must be held until the train is at standstill.

**Tests.** They are done on all the scenarios, then in the page:

```bash
npm run headless -- --scenario scenarios --onboard "exec:python my_onboard.py" --output tests
npm run bridge -- --port 8767 --exec "python my_onboard.py"   # then in the page: ETCS onboard → External via API
```

**Crossing an RBC border.** The scenarios with `rbc_borders_m` divide the line between two RBCs ([TRACKSIDE.md](TRACKSIDE.md#several-rbcs-and-the-handover)); they need the interlocking trackside, `--trackside interlocking`. There every radio message carries `NID_RBC`, and an onboard that ignores it mixes the authorities of the two RBCs. What is needed, in the order the trackside expects it: take the first `NID_RBC` as the supervising RBC and put it in every message you send; when an authority contains packet 131, send your position reports also to the RBC it names (same report, its `NID_RBC`) and keep its messages aside; at the first report to it with the front end, plus the odometry uncertainty, past the border (`D_RBCTR` from the LRBG of the packet), use its stored messages and treat it as the supervising RBC; from the old RBC accept only message 24 with packet 42 and `Q_RBC` = 0, and answer it with message 156. The old RBC orders the termination only from your confirmed rear end, so your position reports must carry `Q_INTEGRITY` 1 (or the Baseline 3 `Q_LENGTH` 1) with `L_TRAININT`. The examples in `examples/onboard/` do not do it: they work with one RBC, as before. The reference onboard is the model (`readRadio`, `positionReport` and `handoverStep` in `src/core/evc.ts`).

**Behind and ahead in a moving block.** With `spacing: 'moving_block'` ([MOVING_BLOCK.md](MOVING_BLOCK.md)) the RBC builds the authority of the train behind yours from the confirmed rear end your position reports give: `Q_INTEGRITY` 1 (or `Q_LENGTH` 1) and `L_TRAININT`, from the min safe rear end when the train was last known to be integer to the estimated front end. Without them your train is never confirmed, and the train behind it is spaced by the fixed block. Report every `T_CYCLOC` seconds of packet 58, which comes in every message 3, and at every balise group; read `train.integrity` of the request and report `Q_INTEGRITY` 3, without `L_TRAININT`, while it is `"lost"`.

If the EVC is written in a compiled language, the simplest connection stays the same: an executable that reads stdin and writes stdout. If it must stay up between runs or run on another machine, it listens on TCP (`--onboard tcp://host:port`) with the same line format.

### Checks on your own onboard

Before blaming your own algorithm it is worth checking the protocol:
- the first response contains a message 136 with the group of the stored position;
- `D_LRBG` is in metres, positive in the running direction;
- the distances of the packets are added to the odometer reading of the LRBG of the message, not of the last group read;
- the emergency brake stays commanded down to zero speed.

If the onboard never receives message 3, almost always the position report is wrong or missing. If the train starts and stops at once, it is usually an error in the reference of the distances.

## Integrating openETCS

### What it is and its status

openETCS was a European project of the ITEA2 programme, closed at the end of 2015. It aimed at a «non-vital reference implementation» of the ETCS onboard, based on Subset-026. The model is written in SCADE and the C code is generated from it. The result is published under the openETCS Open License Terms, a dual licence that includes the EUPL (from 1.1) and Creative Commons Attribution-ShareAlike 3.0.

The generated code is in the `srcAndBinary` repository, whose last commit is from January 2016, with releases v0.3 and v0.4 and the demonstrator of the Amsterdam–Utrecht line. The SCADE model and the documentation are in the `modeling` repository. It is therefore material frozen for years, but complete enough to run. Regenerating the code would require SCADE, which is commercial; to use the already generated one a C compiler is enough.

### What we have verified

The script `examples/openetcs/build.sh` downloads the repository and compiles with gcc the 1109 C files of the onboard computer into a static library. It then builds a minimal test (`test_evc.c`) that initialises the context and runs 500 cycles of 10 ms:

```bash
sh examples/openetcs/build.sh            # creates ./openetcs-build, about 500 MB, one minute
```

The compilation succeeds without changes, provided the SCADE mathematical library (`libmathext`), which in the repository sits next to the ERSA variant, is added to the header path. The test runs: the onboard becomes ready after about a hundred cycles and stays in No Power mode (code 16). It is the expected behaviour, because nobody has activated the cab yet. The context of the computer takes about 2 MB and a cycle costs a fraction of a millisecond.

On Windows the script runs in WSL or in MSYS2 with gcc.

There is a single main generated function:

```c
void EVC(kcg_bool reset, odometry_T_Obu_BasicTypes_Pkg *API_Odometry, T_internal_Type_Obu_BasicTypes_ API_SystemTime,
         API_TrackSideInput_T_API_Msg_Pk *API_fromTrack, DMI_to_EVC_Message_int_T_API_DM *API_fromDMI,
         TIU_Input_msg_API_TIU_Pkg *API_fromTIU, mobileHWStatus_Type_MoRC_Pck *API_mobileHWStatus,
         ps_dataForStartOfMission_T_API_ *API_persistentData, outC_EVC *outC);
```

The outputs are in the `outC` context:
- `API_toRBC`, the messages for the RBC;
- `API_toTIU`, the braking commands;
- `API_toDMI`;
- some service quantities handy for the first tests: `debugCurrentMode`, `debugPermittedSpeed`, `debugIinterventionSpeed`, the nominal position and its limits.

### The adapter

The integration consists of a C program, the adapter, that talks to YuTreno with the external onboard protocol on stdin/stdout and internally calls `EVC()`. Keeping it as a separate process has two advantages. The engine does not change. And the openETCS code, with its reciprocal licence, stays in a program of its own instead of mixing with YuTreno (this is a remark on method, not a legal opinion).

The first task of the adapter is time. YuTreno asks for a cycle every 100 ms, openETCS is designed for 10 ms cycles. For every request the adapter therefore runs ten cycles, with `API_SystemTime` in milliseconds and the odometry interpolated in the cycle. Better still, the onboard cycle can be set to 10 ms with `--onboard-cycle 0.01`, at the price of ten times more exchanges.

The second task is translating the inputs:
- **Odometry.** The `odometry_T` type wants the nominal position with a minimum and a maximum in centimetres, the speeds in cm/s, the acceleration in hundredths of m/s², the measurement time, the motion state and the direction. The YuTreno distance becomes the nominal one, and the interval is built with an error proportional to the distance run.
- **Balises and radio.** They all arrive from a single input, `API_fromTrack`, one message per cycle. The adapter must therefore queue balises and messages and deliver them one per cycle. For a balise the telegram header and the position of the balise centre in odometry are filled in. For a radio message the message header is filled in. In both cases the packets go in «compressed» form: a metadata table with `nid_packet` and start and end addresses, plus a vector of integers with the variables in Subset-026 order. The code of the openETCS trackside simulator (`MEN_demonstrator_stubs/Simulation`) already contains the conversion functions from structured packets to the compressed form. They exist for all the packets our RBC sends (`C_P005_tracksim_compr`, `C_P015_…`, `C_P021_…`, `C_P027V1_…`, `C_P065_…`) and for the national values of packet 3. It is better to use them than to rewrite them. It is also the reason why YuTreno transmits the packets with the names and in the order of the specification.
- **Train interface.** `API_fromTIU` carries the train state: active cab, direction, integrity, traction, sleeping and non leading. With the fixed entry type it also carries the train data, derived from `train_data`. Activating the cab makes the onboard leave the No Power mode.
- **DMI.** The openETCS start of mission goes through the DMI: driver identifier, level 2, RBC data and start command. The adapter must play this sequence on `API_fromDMI` in the first cycles. The DMI protocol follows that of ERSA, whose details are not open, so it must be reconstructed from the generated types (`DMI_to_EVC_Message_int_T`).

The third task are the outputs. `API_toTIU.info.brake_command` becomes `service_brake` and `emergency`. `API_toRBC` must be decompressed into the JSON format of the messages, starting from 136 with packet 0. Permitted speed, intervention speed and mode go into the `dmi` of the response.

### What is also needed on the YuTreno side

openETCS follows the specification more closely than our RBC, and here lies the main part of the work.

The real start of mission goes through a dialogue that our RBC does not do today: the onboard opens the session (155), the RBC answers with the system version (32), the onboard confirms (159) and sends the validated train data (129), the RBC accepts them (8) and the onboard requests the authority (132). The RBC must therefore be extended with these messages, with the acknowledgements (`M_ACK` and message 146) and with the correct use of `T_TRAIN`.

Probably packet 3 with the national values will also be needed and, if the EVC requires it, the authority with sections and timers. They are useful extensions anyway, because they bring the YuTreno trackside closer to the real one for any EVC.

### The proposed plan

1. **Adapter without movement.** The adapter receives the requests, runs the cycles, activates the cab and plays the start of mission on the DMI. It is checked that the onboard reaches Stand By and then tries to open the radio session. It is the point where one finds out how much of the DMI must be reconstructed.
2. **Start of mission dialogue in the YuTreno RBC.** Messages 155, 32, 159, 129, 8, 132 and the acknowledgements, with a check that covers them.
3. **Balises and message 3 in compressed form**, with the conversion functions of the openETCS trackside simulator. Goal: Full Supervision mode with a sensible permitted speed.
4. **Outputs and complete run.** Braking commands, position reports and DMI. Goal: the example controller takes the train to the terminus with the openETCS onboard.
5. **Scenarios and comparison.** All the scenarios with openETCS, with the reference onboard and with the internal supervision, on the same data. It is the most valuable result: three implementations of the same protection system tested under the same repeatable conditions.

The first two steps are those with the most uncertainty, because they depend on how faithfully the openETCS model follows the start of mission of the specification. The last three are translation work between formats already known.

### Risks to keep in mind

The code has been frozen since 2016 and the model covered a subset of the functions, designed for the demonstrator; some parts might be incomplete. The DMI protocol is not public. The sizes of the generated vectors, for example 500 integers for the packets of a message, set limits to respect. And finally the licence: an adapter that includes openETCS code must be distributed respecting its terms.

## Sources

- openETCS, D3.8 Open Source Code (points to the `srcAndBinary` repository and gives the licence): https://itea4.org/index.php/project/workpackage/document/download/2593/D3.8.%20openETCS%20-%20Open%20Source%20Code.pdf
- openETCS, D3.5.4 API (interfaces of the computer, 10 ms cycle, odometry, TIU and DMI types): https://itea4.org/index.php/project/workpackage/document/download/2573/D3.5.4.%20openETCS%20-%20API.pdf
- openETCS, D3.6.1 Functional Model: https://github.com/openETCS/modeling/blob/master/deliverables/D3.6.1.pdf?raw=true
- Generated code: https://github.com/openETCS/srcAndBinary
- ERA, ERTMS/ETCS specifications (Subset-026, Subset-034, Subset-094), published by the European Union Agency for Railways.
