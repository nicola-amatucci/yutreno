# How far it can run in real time

Today YuTreno runs in lockstep: the engine stops until the external controller, dynamics and onboard respond, and for this reason every run is repeatable bit by bit. A real onboard computer does not wait. It has its own clock, reads odometry and balises when they arrive and commands the brakes when it decides. To connect it, the engine would have to follow the clock. This page measures how far it is from that, without changing anything in the engine yet.

```bash
npx tsx scripts/measure-realtime.ts            # about 90 s; results in results/realtime/measures.json
npx tsx scripts/measure-realtime.ts --fast     # short tests
```

## The measures

The measures come from two machines, on 5 November 2026, on the Appennino line with the simple ATO:
- **A**: the Linux virtual machine on the development machine, with 2 cores of a Xeon W-2223 at 3.6 GHz;
- **B**: a cloud container with 2 Xeon cores at 2.1 GHz.

Both use Node 22. Durations are in milliseconds.

**Engine computation.** A run of 1161 s simulated takes less than 2 s of computation.

| Test | Real time (A / B) | Step p50 | Step p99.9 | Maximum step |
| :-- | --: | --: | --: | --: |
| point mass, internal supervision | 1409× / 1174× | 0.002 | 0.05 / 0.07 | 6.2 / 8.2 |
| multi-mass, internal supervision | 1546× / 1268× | 0.002 | 0.03 / 0.04 | 2.2 / 8.1 |
| multi-mass, reference onboard | 676× / 654× | 0.002 | 0.32 / 0.33 | 2.1 / 7.9 |

Since 7 November the Appennino line has a freight train ahead that is a train of the run, with its own multi-mass model and, with the reference onboard, its own onboard (decision 12 of [ROADMAP.md](ROADMAP.md)): the engine computes two trains, and the run lasts 1356 s. Repeated on machine B that day, the three tests give 674×, 787× and 539× real time (2.0, 1.7 and 2.5 s of computation), the exchanges with external programs about the same latencies as below, and the loop locked to the clock no step late out of 12,000.

The cycle of the reference onboard costs 0.07 ms in median and at most 2–8 ms. Its budget is 100 ms. The peaks of the step coincide with the pauses of the V8 garbage collector: from 53 to 298 pauses per run, the longest 6–9 ms.

**Exchanges with external programs.** Round trip, first exchange excluded.

| Channel | Cycle | p50 | p99.9 | Maximum | First exchange |
| :-- | :-: | --: | --: | --: | --: |
| onboard via `exec:` (Node) | 100 ms | 0.24 / 0.17 | 4.0 / 6.7 | 8.7 / 10.2 | 746 / 493 |
| dynamics via `exec:` (Python) | 50 ms | 0.21 / 0.17 | 1.3 / 2.2 | 2.5 / 8.7 | 39 / 27 |
| dynamics via TCP (Python) | 50 ms | 0.22 / 0.19 | 0.8 / 1.2 | 3.0 / 1.8 | 1.5 / 0.5 |
| dynamics via WebSocket (bridge) | 50 ms | 0.12 / 0.08 | 1.4 / 1.3 | 4.3 / 7.6 | 7 / 3 |

The first exchange includes the start of the external program: almost a second for a Node process that compiles TypeScript at start-up.

**Loop locked to the clock.** It is a prototype inside the measurement script, not in the engine. It runs one step every 5 real ms, for 60 s, with the reference onboard, and measures the delay of every step with respect to the moment it was due.

| Machine | Delay p50 | p99 | p99.9 | Maximum | Steps more than 5 ms late |
| :-- | --: | --: | --: | --: | --: |
| A | 0.0002 | 0.001 | 0.02 | 0.3 | 0 of 12,000 |
| B | 0.0002 | 0.5 | 2.7 | 9.6 | 2 of 12,000 |

## What they mean

**Computing power is not the problem.** The engine is 500 to 1500 times faster than real time, and stays so even with an external onboard and dynamics. A step costs a few microseconds on a 5 ms budget. The onboard cycle and the exchanges with external programs are also below a millisecond in median.

**The problem is the tails of the distribution.** In Node the pauses of the garbage collector and the scheduling of the operating system produce rare delays of a few milliseconds. On the development machine the loop locked to the clock had none in 60 s. On the cloud container two steps out of 12,000 arrived more than 5 ms late, the worst with 9.6 ms. Such a delay does not lose steps, because the loop recovers them at once, but it shifts in time what the onboard sees.

**How much a delay weighs depends on speed.** At 300 km/h the train runs 8.3 cm in a millisecond. A 10 ms delay therefore shifts by about 80 cm the moment the onboard sees a balise or a new odometry value. For a supervision with 100 ms cycles and confidence intervals of metres it is little. For tests on location accuracy or on pulse odometry it is not.

**These measures are not guarantees.** They are distributions observed in 60 s on shared machines, one of them virtual. A hard real-time system requires a proven upper bound, and Node on a general-purpose operating system does not give it.

## What follows

There are three levels, in order of difficulty.

1. **Soft real time, with a simulated or software EVC.** Cycles of 50–100 ms and a precision of tens of centimetres are enough. Node is sufficient, as the measures show. A clock-locked mode of the engine is needed, in which the engine no longer waits for the responses: it uses the last output received, as the train interface would, and records at what time it arrived.
2. **Bench with real hardware (HIL) at message level.** The connection goes through network or serial, with cycles in the order of tens of milliseconds. It is still feasible in Node, provided a dedicated and non-virtualised computer is used, and the delay of every exchange is measured in the run itself, so that every test declares its own timing precision.
3. **Bench with physical signals:** odometer pulses, telegrams towards an antenna, TIU lines. Guaranteed times in the order of microseconds are needed. It must not be done in Node: a dedicated process is needed, in C or Rust on a PREEMPT_RT kernel or on a microcontroller, that generates the signals, with the engine passing it the state a few milliseconds apart. The physical model railway in [PHYSICAL_MODEL.md](PHYSICAL_MODEL.md) is a small instance of this level.

The most important point for the method is another. **Real time and determinism do not go together.** If the engine does not wait for the responses, the result depends on when they arrive, and two runs are no longer identical bit by bit. In real time repeatability must be recovered in another way: by recording inputs and outputs with their times, so as to be able to replay the run in lockstep and compare it. They are two different experiments, and must be declared as such.

## Limits of the measures

- Both machines had 2 cores, and A is a virtual machine.
- The web page was not measured: there the loop is tied to the frames, and every external program receives at most one exchange per frame.
- The loop locked to the clock is a measurement prototype with a busy wait in the last millisecond, which occupies a core.
