# Train dynamics

## Purpose

Compute how the train moves under the commanded traction and braking, the running resistances, the gradient and the curves, with enough fidelity to measure what matters to automatic driving and comfort: arrival times, energy, stopping accuracy, coupler forces and jerk. The full derivation, with charts and an interactive laboratory, is in the model page (`dist/model.html`); the summary is in [MODEL.md](../MODEL.md).

## Code

`src/core/dynamics.ts` holds the two internal models (`dynamicsPoint`, `dynamicsMulti`), the co-simulation with an external model (`dynamicsDue`, `dynamicsRequest`, `dynamicsResponse` and the interpolation of `dynamicsExternal`) and `effectiveCommands`, the commands that reach traction and brakes after emergency, protection, onboard outputs, doors and a breakdown. `Simulation` calls `advanceDynamics` for every train at each step, and keeps the three exchange functions as its public methods. `FIXED_DT`, the step of 5 ms, is defined here. The consist (vehicles, masses, couplers, Davis coefficients, Röckl) is built by `consist.ts`.

## Models

| `model` | What it simulates | When to use it |
| :-- | :-- | :-- |
| `multimass` (default) | a chain of vehicles joined by couplers with slack, stiffness and damping | research, comfort, freight trains |
| `point` | a single equivalent mass | teaching, reference values of the first versions |
| `external` | nothing: the state comes from an external program in co-simulation | MATLAB/Simulink or other models |

## Multi-mass model

Every vehicle i has mass m_i, length L_i and a motored flag (`consist`). The state is the position and speed of every vehicle (`MultiState`: positions, speeds, coupler forces T). At every step:

1. **Traction**: the commanded effort, limited by the starting force and by the power at the wheel, is split among the motored vehicles in proportion to their mass and limited on each by adhesion μ(v)·m_i·g, with the Curtius–Kniffler speed factor and the rail condition. Exceeding it lights the slip indicator and cuts the effort.
2. **Braking**: the commanded deceleration times the equivalent mass gives the total force, split by mass. Each vehicle receives the command after x_i/v_prop (pneumatic brake) or at once (electro-pneumatic), and applies it with a first-order response (application and release time constants). The electric brake covers the first part of the force and regenerates energy; wheel slide protection limits the force to 95% of adhesion.
3. **Resistances**: Davis A and B by mass, C 35% on the leading vehicle and the rest uniform, multiplied by `kTunnel` inside tunnels; Röckl curve resistance; gradient under the centre of each vehicle.
4. **Couplers**: `couplerForce(e, de, coupler)` is zero within ±slack/2 and spring plus damper beyond, never changing sign because of the damper.
5. **Integration**: semi-implicit Euler for all vehicles together, with the fixed step of 5 ms. A vehicle at standstill stays still until the force pushing it exceeds brake and breakaway resistance.

The head speed and position are those of the first vehicle; the tail speed, the maximum coupler tension and compression and the jerk at the head are tracked for the observation, the CSV and the criteria.

## Point mass

A single mass with the rotating mass factor, effort limited by force, power and constant adhesion on the motored share, braking limited by adhesion on all axles with the first-order response, gradient averaged under the whole train. It is kept identical to the first version of the core: `verify-ato` holds its reference values.

## External dynamics

With `external` the engine does not integrate anything. Every coupling interval (`external.period_s`, default 50 ms, a multiple of 5 ms) it sends `dynamicsRequest()`: commands as they reach the train after the protection, the track around the train (gradients, curves, tunnels, real adhesion), the fault factors and, at the start, the full train parameters. The response gives the head state at the end of the interval; the engine interpolates over the 5 ms steps. The model is the only source of the train state. See [EXTERNAL_DYNAMICS.md](../EXTERNAL_DYNAMICS.md) and [protocols.md](protocols.md).

## Invariants

- The integration step is fixed; halving it must not change the braking distance by more than 0.5% (checked).
- The point mass results must not change unless on purpose, with the reference values updated in the same commit.
- `examples/dynamics_point.js` must reproduce the internal point mass when coupled every 5 ms.

## Tests

`verify-physics` (closed-form braking distance, balancing speed, start on 25 ‰, adhesion-limited braking, both models), `verify-dynamics` (toy train of Gîlcă and Borcoși against theory, natural frequency, static equilibrium, pneumatic vs electro-pneumatic compression, step convergence, multi-mass vs point mass, Röckl and Curtius–Kniffler), `verify-external-dynamics` (external point mass equivalent to the internal one, transports, determinism).

## Known limits and extensions

No friction hysteresis in draft gears, no creep-based contact model (Polach), no brake pipe pressure computation, longitudinal only. Natural extensions: friction draft gear, Polach adhesion, pneumatic brake pipe model, FMU import for external models.
