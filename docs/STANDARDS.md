# Standards

YuTreno is a research and teaching simulator, not a railway product. It nonetheless draws on several standards, because a simulator that wants to test real onboard computers, real ATOs or real interlocking logic must speak their language and reproduce their rules where it matters. This document discusses each standard YuTreno uses: what the standard prescribes, what YuTreno takes from it, where it stops and why, and how the result is checked. The row-by-row detail is in the [traceability matrix](traceability/README.md); here the discussion stays at the level of the reasoning.

A general warning first. Nothing in YuTreno is safety-certified, and nothing should be read as conformity to a standard. When this document says "implemented" it means that YuTreno does what the clause describes, within the data it receives, and that a test checks it. Conformity in the regulatory sense would require the CENELEC process (EN 50126, EN 50128, EN 50129), independent assessment and, for ETCS, the Subset-076 test sequences on the product. YuTreno uses the standards as a precise vocabulary and as a source of rules to reproduce, so that what is measured in the simulator can be compared with what a real system would do.

## Overview

| Standard | What it covers | What YuTreno takes | Where |
| :-- | :-- | :-- | :-- |
| ERA Subset-026 v4.0.0 (ETCS SRS) | onboard and trackside behaviour of ETCS, data language, messages | level 2 full supervision: location, MA, SSP, gradients, TSR, braking curves (§3.13), modes SB/FS/TR/PT, packets and messages as decoded JSON | `src/core/evc.ts`, `src/core/simple-rbc.ts`, `src/trackside/rbc.ts` |
| ERA Subset-130 v1.0.0 (ETCS–ATO) | data the ETCS onboard gives the ATO onboard | packets 6 and 11, in SI units and line chainages | `EtcsAtoData`, `etcs_ato` in the observation |
| ERA braking curves tool | reference computation of §3.13 curves | the comparison method and the cases | `scripts/curve-validation.ts`, `validation/` |
| EULYNX Baseline 4 R4 (SCI-P, SCI-TDS) | standard interfaces between interlocking and field elements | telegram names, fields and codes for points and train detection | `src/core/field.ts`, `src/trackside/interlocking.ts` |
| RFI practice for computer-based interlockings | control tables (*Tabelle delle Condizioni*), routes, release | a reconstructed control table format and its translator | `src/trackside/control-table.ts` |
| RFI SCMT and BACC | Italian national train protection and coded track circuits | a simplified supervision towards red signals and speed reductions | `src/core/signalling.ts` |
| UIC 540/544, literature on longitudinal dynamics | brakes and train dynamics | brake propagation, coupler models, resistances | `src/core/dynamics.ts`, `src/core/consist.ts` |
| FMI (co-simulation) | coupling of simulation units | the master/slave co-simulation loop of the external dynamics | `dynamicsRequest`/`dynamicsResponse` |
| Transmodel, NeTEx (Italian EPIP profile), SIRI (Italian profile), GTFS, GTFS-Realtime, railML 2 and 3 | timetables and passenger information | export of the timetable and of the real-time state of a run, import of timetables | `src/feeds/`, [TIMETABLE_STANDARDS.md](TIMETABLE_STANDARDS.md) |

## Subset-026: the ETCS system requirements

### What it prescribes

Subset-026 is the System Requirements Specification of ETCS. It describes how the onboard locates itself on balise groups and keeps a confidence interval, how it receives and uses movement authorities, static speed profiles, gradients and temporary speed restrictions, how it computes braking curves and supervision limits (§3.13), which modes it can be in and how it moves between them (chapters 4 and 5), and the language used on balises and radio: variables, packets and messages with their bit layout (chapters 7 and 8). Version 4.0.0 is the one of the 2023 TSI; Italy runs Baseline 3 (v3.6.0) in service.

### What YuTreno takes

YuTreno takes the part of the specification that a level 2 test bench in full supervision needs, and implements it in two places that must agree with each other: the trackside (balise groups, RBC with messages 3 and 16) and the reference onboard (`ReferenceEvc`).

The **data language** is that of the specification: packets 0, 5, 15, 21, 27, 65, 66, 255 and messages 3, 16, 136 carry the Subset-026 variable names (`NID_LRBG`, `L_ENDSECTION`, `V_STATIC`, `G_A`…), with the iterations in the order of the specification. They travel as decoded JSON rather than as bits: the bit encoding of chapters 7 and 8 is the first missing piece for connecting real onboards (see [INDEPENDENT_ONBOARDS.md](INDEPENDENT_ONBOARDS.md)).

**Location** follows §3.6: the onboard references everything to the last relevant balise group, identified by the balise with `N_PIG` = 0, and keeps a confidence interval that grows with the distance travelled. Position reports (message 136 with packet 0) are sent at every balise group, at every mode change and periodically.

**Movement authority, static profile, gradients and TSRs** follow §3.8 and §3.11 in their level 2, single-section form: end of authority, danger point and release speed; the most restrictive speed profile considering the train length and the maximum train speed; gradients with the rotating mass correction.

**Braking curves** follow the structure of §3.13 with the gamma model: EBD and SBD integrated over the gradient profile, EBI derived from the EBD with the traction cut-off and brake build-up times, SBI as the more restrictive of SBI1 (from the SBD towards the EOA) and SBI2 (from the EBD), warning, permitted and indication speeds, ceiling margins interpolated between the national values of §A.3.1. The commands (service brake, emergency brake, traction cut-off) are held until their revocation condition.

**Modes** are reduced to four of the nineteen: Stand By, Full Supervision, Trip and Post Trip, with the trip at the end of authority and on the unconditional emergency stop, and the reaction to the loss of radio contact (`T_NVCONTACT`, `M_NVCONTACT`).

### Where it stops

The matrix counts, out of 231 sections of chapters 3, 4, 5, 7 and 8: 3 implemented, 77 simplified, 9 divergent, 122 missing, 20 out of scope. The missing part is large but coherent: start of mission and the RBC dialogue that goes with it (155, 32, 159, 129, 8, 132), the other modes (on sight, staff responsible, shunting…), level transitions, multi-section authorities with timers, conditional emergency stop and acknowledgements, the lambda brake model, and the bit encoding.

Inside §3.13, three divergences change the numbers and are discussed in the matrix: the gradient taken at the head instead of the worst under the train, the emergency times added instead of overlapped, and the missing estimated acceleration and speed error. They are known, declared and, where possible, quantified. Two others have been corrected: the SBI2, W, P and I limits of speed reduction targets now come from the EBD of the target as the text asks, and the indication time includes the driver time.

### How it is checked

`scripts/verify-subset026.ts` drives the reference onboard cycle by cycle with hand-built telegrams and messages and checks each group of clauses, in closed form where the clause gives a formula: EBD and SBD on constant gradients with the rotating mass correction, EBI shifted by v·(T_traction + T_be), SBI = min(SBI1, SBI2), SBI2, W, P and I of a speed reduction from its EBD, ceiling margins at 80, 160 and 250 km/h, MRSP with train length and V_MAXTRAIN, trip with the min safe front, post trip, emergency stop, radio contact. The system-level checks (`verify-onboard`, `verify-curve-validation`, `verify-ato-s130`) check that the same onboard behaves sensibly on complete runs. Every implemented or simplified row of the matrix is linked to at least one of these tests, and `verify-traceability` fails otherwise.

The independent check is the ERA braking curves tool: the cases and the comparison script are ready ([CURVE_VALIDATION.md](CURVE_VALIDATION.md)), the values of the tool still have to be entered.

## Subset-130: the ETCS–ATO interface

### What it prescribes

Subset-130 specifies the interface between the ETCS onboard and the ATO onboard in the ATO over ETCS architecture. Every 200 ms the ETCS onboard sends packet 6 (ETCS_ATO_Dynamic): mode, estimated speed and acceleration, permitted speed, MRSP and its changes, location of the emergency brake intervention (`N_LOC_EBI`), end of authority and supervised location, release speed, gradients, reaction times and location uncertainty. Packet 11 carries the safe brake decelerations. Positions are readings of the onboard location counter in centimetres, with timestamps and reference balises.

### What YuTreno takes

All the variables of packets 6 and 11 that a level 2 onboard in full supervision can fill in are produced, with the names of the specification, by all three onboards (internal, reference, external through `dmi.ato`) and passed to the controller in `etcs_ato`. Units are SI and positions are line chainages, a declared divergence that keeps the observation homogeneous with `pos_m`. Transport is the lockstep observation, not a 200 ms cycle with a 1000 ms timeout.

`N_LOC_EBI` is the variable that matters most, because an ATO cannot compute it by itself: it depends on the onboard's own curves and times. Two checks pin it down: in `verify-ato-s130` a driver who keeps constant speed and never brakes is stopped within 0.2 m (internal) and 1.3 m (reference) of the announced point; in `verify-subset026` it matches d_EBD(v) − v·T_be on level track.

### Where it stops

Static data, driver inputs and ATO-specific packets (5, 7, 8, 9, 10), `N_LOC_RSM`, `A_MAXREDADH`, `V_DELTA0`, the linking iterations and the information sets are missing. They are not needed for the question YuTreno asks of the ATO data, which is whether an ATO that plans with them behaves better than one that follows the permitted curve ([CAMPAIGN.md](CAMPAIGN.md)).

## EULYNX: interlocking and field elements

### What it prescribes

EULYNX standardises the interfaces of the signalling system, so that interlockings and field elements of different suppliers can work together. Baseline 4 Release 4 publishes, among others, SCI-P (Eu.Doc.38, interlocking–point) and SCI-TDS (Eu.Doc.44, interlocking–train detection), with telegrams, parameters, codes, state machines and the PDI connection layer underneath.

### What YuTreno takes

Between the interlocking and the simulated field the telegrams are those of the documents, with names, fields and codes: `Cd_Move_Point`, `Msg_Point_Position`, `Msg_Movement_Failed`, `Msg_Ability_To_Move_Point` for points, `Msg_TVPS_Occupancy_Status` for track sections. The field reports unintended positions for trailed points, disturbed sections for failures, and the change trigger of every status message. Because the boundary is a standard interface, the same interlocking can talk to a simulated field today and, in principle, to real or physical object controllers tomorrow (see [PHYSICAL_MODEL.md](PHYSICAL_MODEL.md)).

### Where it stops

There is no byte encoding and no PDI connection, hence no version check and no initialisation procedure; train detection points, force clear, filling level and POM status are missing. The interfaces between interlocking and RBC (SCI-RBC) and between interlocking and control centre (SCI-CC) are not published in B4R4: those of YuTreno are its own and declared as such. `verify-trackside` checks the interlocking against the field telegram by telegram, without the engine.

## RFI practice: control tables and route logic

### What it is

In Italy the logic of a computer-based interlocking (ACC) is designed from the station's schematic plan and its control tables (*Tabelle delle Condizioni*): for every route, the points and their positions, the track circuits to check, the overlap, the conflicting routes, the speed on the diverging branch and the release mode. They are design documents of RFI practice rather than a single public standard.

### What YuTreno takes

YuTreno describes routes in a control table format reconstructed from that practice (`ControlTable`), translates it into the interlocking configuration and derives the conflicts that follow from shared elements. The interlocking implements route setting, detection, integrity, sectional release, immediate and delayed cancellation (a simple form of approach locking) and automatic route setting by timetable, and the RBC builds the authority from the chain of set routes.

### Where it stops

The format is a reconstruction, not an RFI document, and must be validated with interlocking designers, especially conflicts, overlaps and release. Timings (movement, setting, cancellation delay) are plausible values, not taken from a standard. Only one train is in session: the train ahead occupies sections but does not request routes. All of this is listed in [TRACKSIDE.md](TRACKSIDE.md#what-is-simplified).

## SCMT

### What the real system does

SCMT (*Sistema Controllo Marcia Treno*) is the Italian national train protection, developed by RFI from 2000, certified up to 250 km/h and active on more than 13,000 km of the network. It has a trackside subsystem (SST) and an onboard subsystem (SSB). The SST transmits, through balises of the same technology used by ERTMS (the *punti informativi*, placed near signals, speed reductions and other relevant points), the aspect of the next signal and the line characteristics. The SSB computes ceilings and braking curves from these data and from the train data entered at the start (brake weight percentage, maximum speed, length), and on lines with coded current automatic block (BACC) it also reads the continuous cab signalling codes in the rails (75, 120, 180, 270 per minute, and with the 9-code version the additional 178 Hz codes). It supervises the speed continuously, protects red signals and speed reductions, commands service or emergency braking, and has its own driver controls (acknowledgement of restrictive aspects within a few seconds, release after a stop, trip mode to pass a red signal, shunting). It exists stand-alone, integrated with SSC, or as a national system module inside an ETCS onboard.

### Where YuTreno is

In YuTreno SCMT is **a simplified supervision**, written to make the automatic block runs protected in a recognisable way, not a model of the real system. When the signalling is the automatic block (`BACC`):

- the signals are those of a three-aspect block generated from the stations and the block length, with red behind the train ahead and yellow before it;
- the onboard supervises a single braking curve towards the first red signal and towards every speed reduction within 5 km, with a constant deceleration of 0.55 m/s²;
- towards a red signal the permitted speed never goes below a release speed of 30 km/h;
- the warning triggers at +3 km/h above the permitted curve and the emergency brake at +7 km/h; there is no service brake intervention;
- passing a red signal leads to the emergency brake and counts as an overrun.

What is missing is most of what makes SCMT itself:

- **no punctual information**: there are no SCMT balises; the onboard knows the aspect of every signal directly from the engine, which is a continuous and perfect knowledge the real SSB does not have between two information points;
- **no coded track circuits**: the BACC codes 75/120/180/270 and their meanings (and the RS9 codes) are not simulated, so neither the continuous repetition nor the code-dependent ceilings exist;
- **no train-dependent curves**: the deceleration is a fixed value, not derived from the brake weight percentage, the train length and the gradient as the SSB does;
- **no driver procedures**: no acknowledgement of restrictive aspects, no release button after a stop, no trip mode to pass a red signal, no shunting mode, no special handling of buffer stops;
- **no SSC integration** and no national system module inside the ETCS onboard.

In the matrix SCMT has no rows, because it is not an ERA specification and its functional specifications are RFI documents not covered here. In the scenarios SCMT is used to compare the behaviour of the same controller under ETCS and under the automatic block (for example `leader-stopped-scmt.json`).

### What a real SCMT would need

A credible SCMT model would follow the same pattern as the reference ETCS onboard: a separate onboard module that knows the world only through what the real SSB receives. Concretely:

1. **Trackside**: SCMT information points on the line, generated next to the signals and speed reductions like the ETCS balise groups, carrying the aspect and the line data in the national packet; and, on BACC lines, the coded current of each block section computed from the aspects.
2. **Onboard**: a `ScmtSsb` that reads the information points and the codes, keeps the last known aspect between two points, computes ceilings and braking curves from the train data, and implements the driver procedures (acknowledgement timers, release, trip mode).
3. **Protocol**: the same request/response shape as the ETCS onboard, so that an external SSB could be connected too.
4. **Sources**: the RFI functional specifications of SCMT and BACC, which must be obtained and read before writing the model; this is the main uncertainty.
5. **Tests**: a `verify-scmt.ts` with the same structure as `verify-subset026.ts`, and rows in the matrix for the clauses actually implemented.

Until then, results obtained with the automatic block in YuTreno describe "a simple three-aspect block with a basic speed supervision", not SCMT.

## Braking and dynamics references

The train dynamics does not follow a single standard, but its parameters and laws come from established references: the Davis resistance, Röckl's curve resistance, the Curtius–Kniffler adhesion law, the brake propagation speeds and filling times of UIC 540, the coupler models of the literature on longitudinal train dynamics (Cole et al., Yadav and Vyas). The model page (`dist/model.html`) cites each source and `verify-dynamics` checks the model against closed-form results.

## Co-simulation: FMI

The external dynamics protocol follows the master/slave co-simulation pattern of FMI 2.0: the engine is the master, the model advances by `dt` on request with inputs held constant (zero-order hold), and returns its state. It is not an FMI implementation: an FMU cannot be loaded directly, but the protocol maps one to one onto `doStep`, which makes an FMU wrapper a natural extension ([EXTERNAL_DYNAMICS.md](EXTERNAL_DYNAMICS.md)).

## Test and process standards

**Subset-076** (ETCS test specifications) and **Subset-094** (functional requirements for an onboard reference test facility) describe how a real ETCS onboard is tested in the laboratory. YuTreno's lockstep protocol has the same shape as the Subset-094 architecture (odometry, balises and radio in, train commands and DMI out), which is why it can host external onboards; it does not run the Subset-076 sequences. **EN 50126/50128/50129** govern the safety lifecycle of railway systems; YuTreno does not follow them and must not be used where they apply.

## Traffic management, capacity and the network

**Traffic management.** In the reference architecture of European control-command (RCA, by the EULYNX and EUG consortia), deciding the plan and rescheduling it belong to the traffic management system (TMS). It hands the operational plan to Plan Execution through the interface SCI_1, and Plan Execution asks the safety layer to allocate the elements. YuTreno's regulator ([REGULATOR.md](REGULATOR.md)) follows the same split with a much smaller protocol: decisions on times, priorities, tracks and cancellations go one way, the state of the traffic comes back, and safety stays with the interlocking and the RBC. The rescheduling methods of the literature (retiming, reordering, rerouting, cancelling, reviewed by Cacchiani et al. and by Corman and Meng) are what a research regulator would plug in; the reference regulator is only a baseline.

**Adjacent interlockings.** The EULYNX System Definition gives the exchange with an adjacent interlocking, line block included, to the interface SCI-ILS: commands and statuses in both directions. It does not fix the telegrams of the block consent, so YuTreno's consent between the ends of a single-track segment (request, grant, refuse, one cycle of delay) uses its own messages ([TRACKSIDE.md](TRACKSIDE.md)).

**Capacity.** UIC Code 406 (2nd edition, 2013) defines the occupancy time of a block section and the compression method, and recommends the occupancy rates (75 % in the peak hour on mixed-traffic lines). `verify-capacity` compares the minimum headway computed from the blocking times with the measured one, within 5 % ([CAPACITY.md](CAPACITY.md)).

**Moving block.** Since the 2023 CCS TSI (Regulation (EU) 2023/1695) Level 3 is no longer a level: the moving block is "ETCS Level 2 with moving block". Subset-026 v4.0.0 gives the onboard side, the train integrity in the position report (`Q_INTEGRITY`, `L_TRAININT`, §3.6.5.2) and the report parameters (packet 58); the logic of the RBC is not an interface between suppliers and is described by the system specification of Shift2Rail X2Rail-5 (confirmed rear end, "L3 margin", trains without integrity or not communicating). YuTreno implements both in a simplified form ([MOVING_BLOCK.md](MOVING_BLOCK.md)).

**Network topology.** UIC IRS 30100 (RailTopoModel, 2016) describes the railway network as a graph of net elements and relations at several levels of detail (micro, meso, macro), and is the basis of railML 3. YuTreno's lines are still single corridors in their own format; a network of lines meeting in nodes is the next step of the plan.

## Timetables and passenger information

The standards of the passenger side (Transmodel, NeTEx, SIRI, GTFS) and of timetable exchange between railway applications (railML) have their own document, [TIMETABLE_STANDARDS.md](TIMETABLE_STANDARDS.md): legal frame (MMTIS Regulation, Italian National Access Point and Regional Access Points, TSI Telematics), the model of each standard, annotated examples produced by YuTreno, the correspondence of concepts across formats, the validation tools and the differences from the Italian profiles.

## Sources

- ERA, ERTMS/ETCS Subset-026 v4.0.0 System Requirements Specification; Subset-130 v1.0.0 ETCS–ATO interface; Subset-076; Subset-094; braking curves tool and its user guide. European Union Agency for Railways.
- EULYNX, Baseline 4 Release 4, Eu.Doc.38 (SCI-P) and Eu.Doc.44 (SCI-TDS).
- RFI, [Sistema Controllo Marcia Treno (SCMT)](https://www.rfi.it/it/Sicurezza-e-tecnologie/tecnologie/ccs/Controllo-Marcia-Treno/Sistema-Controllo-Marcia-Treno--SCMT.html).
- [Sistema Controllo Marcia Treno](https://en.wikipedia.org/wiki/Sistema_Controllo_Marcia_Treno) and [Blocco automatico a correnti codificate](https://en.wikipedia.org/wiki/Blocco_automatico_a_correnti_codificate), Wikipedia.
- Modelica Association, Functional Mock-up Interface 2.0.
- EULYNX and ERTMS Users Group, [RCA TMS-PE component specification, RCA.Doc.19](https://public.3.basecamp.com/p/DCGx8enamwvLtQBYnCcn2Eee/upload/download/RCA_TMS-PE_specification.pdf) and [RCA SCI_1 specification](https://public.3.basecamp.com/p/ofsxC3P8zyZRKXJn7nqbS6rJ/upload/download/RCA_SCI_1_specification.pdf).
- EULYNX, [System Definition Eu.Doc.7 v4.2](https://eulynx.eu/storage/simple-file-list/General-Documents/Baseline-set-4-Release-3/20240618-EULYNX-System-Definition-Eu_Doc_7-v4_2-2_A.pdf) (SCI-ILS, adjacent interlocking).
- Europe's Rail, [Traffic CS system concept](https://rail-research.europa.eu/wp-content/uploads/2025/03/Traffic_CS_System_Concept.pdf).
- UIC, [Code 406, Capacity, 2nd edition, June 2013](https://tamannaei.iut.ac.ir/sites/tamannaei.iut.ac.ir/files/files_course/uic406_2013.pdf); [an analytical UIC 406 compression method with blocking time stairway](https://www2.mdpi.com/1996-1073/13/7/1853), Energies 13(7), 2020.
- UIC, [IRS 30100 RailTopoModel](https://www.railtopomodel.org/files/download/RailTopoModel/180416_uic_irs30100.pdf), 2016.
- V. Cacchiani et al., [An overview of recovery models and algorithms for real-time railway rescheduling](https://repub.eur.nl/pub/50112), Transportation Research Part B 63, 2014.
- F. Corman, L. Meng, [A review of online dynamic models and algorithms for railway traffic management](https://repository.tudelft.nl/record/uuid:f3f50b0d-6e00-4b06-9d14-2e126c8ec1f6), IEEE Transactions on Intelligent Transportation Systems 16(3), 2015.
- [The ON-TIME real-time railway traffic management framework](https://fis.tu-dresden.de/portal/de/publications/the-ontime-realtime-railway-traffic-management-framework(9a932df1-ff25-4bc4-94cc-fe29a390bc1d).html), TU Dresden.
