# Physical and signalling model

## Train dynamics

The complete description, with equations, charts and an interactive laboratory, is in the page generated from `src/docs/` (`npm run build` produces `dist/model.html`). Here is the summary; the design of the code is in [design/dynamics.md](design/dynamics.md).

YuTreno offers two internal models, chosen with the `model` field of the train parameters. A third value, `external`, hands the dynamics over to an external program in co-simulation, for example a Simulink model: it is described in [EXTERNAL_DYNAMICS.md](EXTERNAL_DYNAMICS.md).

**Multi-mass (default).** The train is a chain of N vehicles (`consist`), connected by couplers with spring, damper and slack (`coupler`). It is the generalisation of the two-mass model of the toy train (Gîlcă and Borcoși 2019; Control Tutorials for MATLAB & Simulink), as in the literature on longitudinal train dynamics. For every vehicle:

    m_i · k_r · dv_i/dt = Ft_i − Fb_i − R_i(v_i) − m_i · g · i_i − T_i + T_{i−1}

where `T_i` is the force in the coupler between vehicles i and i+1, positive in tension. The coupler transmits no force within ±slack/2 of extension; beyond it, it is `k·(e ∓ slack/2) + c·de/dt`, never changing sign because of the damper.

- **Traction.** The commanded effort, limited by starting force and power, is split among the motored vehicles in proportion to their mass. Each one is limited by adhesion μ(v)·m_i·g. Adhesion decreases with speed according to Curtius and Kniffler, `0.161 + 7.5/(44 + v[km/h])`, scaled to the value of the rail condition.
- **Braking.** The total force is split in proportion to the mass. Every vehicle receives it with a delay `x_i / vProp` if the brake is pneumatic (the command travels along the brake pipe, 280 m/s), or at once with the electro-pneumatic brake. Then it applies it with a first-order response. Wheel slide protection limits the force to 95% of adhesion.
- **Resistances.** Distributed Davis: A and B in proportion to the mass, C for 35% on the leading vehicle and the rest uniform. The aerodynamic term is multiplied by `kTunnel` inside tunnels. The curve resistance follows Röckl: 650/(R−55) ‰ above 300 m of radius, 500/(R−30) ‰ below. Gradient and curve are those under the centre of gravity of each vehicle.
- **Integration.** Semi-implicit Euler with a fixed step of 5 ms for all vehicles together. A vehicle at standstill stays still until the force pushing it exceeds brake and breakaway resistance: the train does not roll back.

**Point mass (teaching).** The train is a single equivalent mass. The effort is limited by maximum force, power and constant adhesion on the motored axles. Braking is limited by adhesion on all axles and follows the first-order response, without propagation. The gradient is the average under the whole length of the train. It is the model of the first versions, which `verify-ato` keeps identical.

In both models the electric brake covers the first part of the braking force, up to its maximum force and power limit, and regenerates energy with its efficiency. The SLIP and WSP indicators light up when the demand exceeds adhesion.

## Signalling

From the stations and the block section length three kinds of signal are generated: starting signals 250 m after every station, home signals 400 m before the next station and intermediate signals at a regular spacing. A section occupied by the train ahead makes its entry signal red and the previous one yellow; starting signals stay red until the departure time.

**ERTMS/ETCS level 2, internal simplified supervision.** There are no lineside signals. The RBC grants the movement authority (MA) up to the start of the first section the block would make red, with the danger point (SvL) 50 m beyond. The onboard computer considers as targets the end of authority (EoA) and every reduction of the static speed profile, and builds for each one the curves of the table.

| Curve | Deceleration | Dead time |
| :-- | :-- | :-- |
| Permitted (P) | service | Tbs + driver reaction (1.5 + 4 s) |
| Warning (W) | service | Tbs + 2 s |
| Service brake intervention (SBI) | service | Tbs |
| Emergency brake intervention (EBI) | emergency, towards the SvL | Tbe (2 s) |

The deceleration is reduced for adhesion and for the steepest descent up to the target. The supervision state is one of these:

- normal;
- indication, 5 s before the permitted curve;
- overspeed;
- warning;
- service braking commanded;
- intervention with emergency braking.

Passing the end of authority leads to the emergency brake (trip). The release speed is 15 km/h.

These curves are **not** the models of Subset-026: they reproduce its qualitative behaviour for teaching and controller research. The Subset-026 curves are those of the reference onboard ([ONBOARD_ETCS.md](ONBOARD_ETCS.md), [design/reference-onboard.md](design/reference-onboard.md)), checked clause by clause in `scripts/verify-subset026.ts`.

**SCMT, simplified.** There is a single curve towards the red signal, with a deceleration of 0.55 m/s² and release at 30 km/h. The warning triggers at +3 km/h and the intervention at +7 km/h. Passing a red signal leads to the emergency brake. What real SCMT does and what is missing is discussed in [STANDARDS.md](STANDARDS.md#scmt).

## Vigilance, stops and the train ahead

**Vigilance.** It has a fixed cycle of 55 s while running and leaves 5 s to acknowledge; if the acknowledgement does not arrive, the emergency brake is applied. The reaction times are recorded.

**Stops.** A stop is valid if the train stops with its head within 20 m of the marker. The doors stay open for at least 20 s and until the timetabled departure, and traction is inhibited while they are open.

**Train ahead.** It is a freight train among the trains of the run, with the same dynamics, signals, supervision and built-in driver as the service trains. By default it has two locomotives and as many loaded wagons as fit in its length (`len`), and runs at most at `vmax`. It stands at `s0` and leaves when the run starts, passes the stations, makes its stop for `wait` seconds (in the station within 400 m of `stopAt`, or in open line) and ends its run at the last station of the line. Its driver plans its stops at 0.25 m/s², because the pneumatic brake of a long train builds up slowly. It carries no passengers and is not in the open data feeds. Until 7 November 2026 it was a kinematic model that ran without signals; [ROADMAP.md](ROADMAP.md) explains the change (decision 12).

## Known simplifications

Draft gears have no friction hysteresis; adhesion is an empirical curve and not a contact model with creep; the pneumatic brake has a pure propagation delay without computing the pressure in the brake pipe; the model is longitudinal only. Separate distant signals, the fourth aspect, level crossings and several commanded trains on the same line are also missing.
