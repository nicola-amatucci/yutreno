# Line capacity: blocking times and minimum headway

How close can two trains follow each other on a line, and does the simulator agree with the textbook computation? `scripts/verify-capacity.ts` answers both questions for the Valle Lauro line and checks that the two numbers stay close. It is the simplified version of the method of UIC Code 406.

## The method

In UIC Code 406 a train occupies each block section for longer than it takes to run through it. The section must be free from the moment a following train would have to start braking if it were not, and it stays occupied until the tail of the train has cleared it and the route is released. The 2013 edition calls this the occupancy time of the block, made of:

- a margin before the train enters, covering route setting, sight and approach;
- the running time through the block;
- the clearing time, which depends on the length of the train;
- the release time.

Drawn for every section along the line, these times form the *blocking time stairway*. Two trains of the same type can follow each other at the largest blocking time of the stairway: that is their minimum headway. The compression method of the leaflet pushes the train paths of a timetable together until the stairways touch. The occupancy time obtained, divided by the period, is the capacity consumption.

YuTreno computes the stairway from the run of a single regional train (stops at Ponte Sabato and San Felice Scalo, 30 s dwells), with these simplifications:

- **Approach.** The section must be free where the following train would start braking for the signal at its entrance: braking distance at 0.5 m/s² plus 6 s of reaction and brake build-up, at the speed the train has there. With the automatic block the information arrives only at the previous signal, with the caution aspect, so the approach starts there at the latest.
- **Clearing.** The section is freed when the tail passes the exit signal; at the terminus, when the train arrives and leaves the line.
- **What is missing.** Setup and release times of the route, buffer times, and timetables with different trains.

The measured headway comes from two identical services, the second h seconds after the first. It is the smallest h at which the second runs exactly as the first, shifted by h: at every 5 ms step it is where the first was h seconds before. This is the meaning of "unimpeded" in UIC 406. The arrival time alone is not enough, because the slack of the dwells absorbs any slowing down.

## Results

| Signalling | Computed | Critical section | Measured | Difference |
| :-- | :-- | :-- | :-- | :-- |
| ETCS, internal supervision | 250.0 s | signal 9, 10.000–10.650 km | 244 s | −2.4 % |
| automatic block and SCMT | 253.4 s | signal 10, 10.650–11.967 km | 246 s | −2.9 % |
| ETCS, reference onboard | 250.0 s | signal 9 | 239 s | −4.4 % |
| ETCS, reference onboard and interlocking | 250.0 s | signal 9 | 252 s | +0.8 % |

The critical section is the one that contains the stop of San Felice Scalo: the train occupies it while slowing down, during the dwell and while starting again. The computation is slightly cautious for the block systems, because the onboard brakes later than the assumed curve. With the interlocking the measured headway is 2 s longer, because entry and departure routes also take time to be set and released, and the computation leaves that out.

With 250 s of headway the line carries at most 14 trains per hour in one direction. The 2013 leaflet recommends occupancy time rates of at most 75 % in the peak hour on mixed-traffic and high-speed lines and 85 % on dedicated suburban lines (60 % and 70 % over the day): that is about 10 trains per hour on a mixed line. On a single-track line with crossings the real limit is lower, because the two directions share the sections; the check covers only trains in the same direction.

`verify-capacity` fails when computed and measured differ by more than 5 %. It also checks that a run with everything together gives the same data in process and with the trackside and the regulator as external programs: trains in both directions, line blocked, a train broken down then slowed, the regulator.

## Time held by the signalling

The minimum headway says how close two trains can run; it does not say what a shorter headway costs the people on the second train. YuTreno measures that cost directly, as the model of Barbaro et al. (2026) does with its *signalling activation time*: the time a train spends held down by the signalling rather than by the line. It is `signalling_constrained_s` in the summary of every train, and `signalling_constrained_s` (all trains) and `signalling_constrained_max_s` (the train held the longest) in the service campaign.

A train is held by the signalling in a step when both hold:

- the target that sets its permitted speed is one of the signalling: an end of authority or a signal at danger, that is a target at speed 0 that is not the end of the line;
- its permitted speed is lower by at least 1 km/h than what the line and the next stop would allow. The line allows the permitted speed of the same supervision with no authority and no signals, so with the same curves towards the lower limits ahead. The stop allows the speed from which the train stops at the stop marker with its service deceleration, and 0 while it stands there with the doors open, or at its origin before the departure time.

The rule reads only the supervision the train is given, so it is the same for the internal supervision, the reference onboard, an external onboard and the automatic block. It measures the protection, not the driver: a driver who brakes for a target before the supervision lowers the permitted speed is slowed down without being held.

`verify-capacity` (CAP4) runs the two services of the table above at headways around the measured one:

| Signalling | Held at the measured headway | 20 s shorter | 60 s shorter | No longer held from | Measured headway |
| :-- | :-- | :-- | :-- | :-- | :-- |
| ETCS, internal supervision | 0 s | 19.7 s | 59.7 s | 244 s | 244 s |
| automatic block and SCMT | 0 s | 19.8 s | 59.8 s | 245 s | 246 s |
| ETCS, reference onboard | 0 s | 20 s | 60 s | 223 s | 239 s |
| ETCS, reference onboard and interlocking | 0.4 s | 6.3 s | 6.3 s | 252 s | 252 s |

A train alone is never held, except for 0.4 s with the interlocking, the radio cycles at its departures. Below the threshold the second train loses about one second for every second of headway taken away: it waits in front of the signal for the first train to clear the section. With the internal supervision and the automatic block the threshold is the measured headway within 1 s: the second train is slowed down exactly when the signalling holds it. With the reference onboard it is 16 s lower, because between 223 and 239 s the driver of the second train brakes for the end of authority earlier than the onboard's permitted speed requires, so the train is slowed down but not held. With the interlocking the time held grows in steps: in front of the departure signal of San Felice Scalo the second train waits for the route to be set again once the first has cleared, 6 s whatever the headway down to about 190 s.

The service campaign finds the same threshold with services generated from the timetable of the line (`npm run service-campaign -- --config campaigns/headway-sweep.json`, file `thresholds.csv`): with the automatic block and with ETCS the second train is held for 4.8 and 3.7 s at 240 s and no longer from 245 s. In the same runs the arrival delay does not move, because the slack of the timetable absorbs the waiting: the time held by the signalling shows a cost that punctuality alone hides.

## Moving block

With the moving block ([MOVING_BLOCK.md](MOVING_BLOCK.md)) there are no block sections, so there are no blocking times of sections either. `verify-capacity` (CAP5) computes the headway from the run of the first train alone: at every instant the second train, h seconds behind, at x with speed w, needs the end of its authority beyond x by the braking distance of its permitted curve, which the ATO follows (the service deceleration of the train after `T_brake_service` + `T_driver`, without gradients), and the end of authority lies the margin behind the confirmed rear end the RBC has for the first train. The minimum headway is the largest difference between the time at which that rear end reaches the point needed and the time at which the second train is there.

| Spacing, reference onboard | Computed | Critical point | Measured | Difference |
| :-- | :-- | :-- | :-- | :-- |
| fixed block | 250.0 s | signal 9, 10.000–10.650 km | 239 s | −4.4 % |
| moving block, margin 50 m, reports every 6 s | 193.2 s | 10.035 km | 199 s | +3.0 % |

The critical point is again the approach to San Felice Scalo, where the first train slows down to stop; the moving block saves 40 s there (−17 %), because the second train follows the rear end of the first instead of waiting for it to clear the 650 m section around the stop. The computation is slightly optimistic: the ATO keeps 2 m/s below the permitted speed and the reports come every 6 s at best, so the second train sees the rear end a little later than assumed.

The block comparison campaign repeats the sweep of the time held by the signalling with the two spacings (`npm run service-campaign -- --config campaigns/block-comparison.json`, file `thresholds.csv`): with ETCS and the reference onboard the second train is no longer held from 230 s with the fixed block and from 200 s with the moving block; at 180 s it is held 43.2 s with the fixed block and 31.5 s with the moving block, at 120 s 136.4 s and 115.5 s. The arrival delay does not move in either case, and the net energy of the two trains is slightly lower with the moving block below the threshold (232.7 kWh against 233.0 kWh at 180 s), because the second train brakes less.

## Capacity of a node

On a network with the interlocking trackside ([design/network.md](design/network.md)) the same question is asked at the node of San Felice Scalo, where two different trains share only part of their way. The method is the general one of UIC 406 for two train types: the minimum headway between their departures is the largest difference, over the sections they share, between the moment the first train clears a section and the moment the second needs it.

- **When the first train clears a section.** The last instant the field sees it on the section, from a run of that train alone.
- **When the second train needs it.** At a node the authority is made of routes, and a route can be set only with all its sections and its overlap vacant. So the section is needed from the moment the second train would start braking (0.5 m/s² and 6 s, as above) for the start of the first route of its authority that holds the section, in its path or in its overlap. The routes are those of its authorities in a run alone.
- **The tracks of a station.** Tracks I and II are separate sections. The second train can take the free one, but on track II it runs at the diverging speed, and that already slows it down: it is not unimpeded.

The measured headway is the smallest one at which the second train runs, step by step, exactly as it does alone.

| Movements | Computed | Critical section | Measured | Difference |
| :-- | :-- | :-- | :-- | :-- |
| a train from Valle Lauro into the branch, then one from Valle Lauro straight on to Monte Clanio | 247.1 s | track I of San Felice Scalo | 254 s | +2.8 % |
| a train out of the branch towards Valle Lauro, then one from Monte Clanio that joins the same line at the node | 537.0 s | points zone of Ponte Sabato | 534 s | −0.6 % |

In the first case the critical section is the track of the node: the train for the branch dwells on it and then leaves it through the junction, and the following train must find it free when it decides its track, otherwise it is sent to track II. In the second case the times are counted between departures from two different origins, so the headway includes the running time of the first train to the node; the critical section is the first station they both pass after it.

`verify-capacity` checks that the measured headway is within 5 % of the computed one (the second train impeded 5 % below, unimpeded 5 % above). The measure to the second takes a run per step and is done only with `CAPACITY_SEARCH=1`; the table above was made that way. Crossing movements in opposite directions are not a headway: on single track they are governed by the block consent and the crossing at a station.

Sources:
- E. Barbaro, I. La Paglia, F. Bernardini, G. Bucca, R. Corradi, M. Bocciolone, A. Collina, *A modular simulation tool for fixed block and moving block railway signalling systems*, Railway Engineering Science 34(2), 2026, pp. 257–274
- [UIC Code 406, Capacity, 2nd edition, June 2013](https://tamannaei.iut.ac.ir/sites/tamannaei.iut.ac.ir/files/files_course/uic406_2013.pdf)
- [Evaluating line capacity with an analytical UIC Code 406 compression method and blocking time stairway, Energies 13(7) 1853, 2020](https://www2.mdpi.com/1996-1073/13/7/1853)
