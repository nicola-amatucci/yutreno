# Passengers

With `passengers` in a scenario the trains carry people. They arrive on the platforms from an origin–destination demand, wait, board the first train that serves their destination when it has room, and alight there. Who boards and alights sets the dwell, and the people on board add to the mass of the train. The run reports waiting, travel, delay and load, and the open data publish the occupancy.

The model is **aggregate**: it follows flows of passengers, not individuals. The questions YuTreno asks of passengers (dwell times, punctuality, energy, comfort) depend on the flows, and an aggregate model keeps the run deterministic and its measures exact for those flows. Route choice by individual passengers is outside the model.

Without `passengers` nothing of this exists and every run is the same as before.

The code: `src/core/passengers.ts` holds the model (demand, platforms, queues, boarding and alighting, measures), independent of the trains; `src/core/boarding.ts` joins it to the trains of the run (the doors open and close at a stop, the dwell, the mass on board, the energy per passenger-km in `Simulation.passengers()`).

## A first example

```json
{
 "line": "valle-lauro",
 "trains": { "count": 4, "headway_s": 600, "directions": "both" },
 "passengers": {
  "demand": [
   { "from": "Valle Lauro", "to": "Monte Clanio", "per_hour": 900 },
   { "from": "Ponte Sabato", "to": "Monte Clanio", "per_hour": 700 },
   { "from": "Monte Clanio", "to": "Valle Lauro", "per_hour": 250 }
  ]
 }
}
```

This is a scenario configuration ([SCENARIO_CONFIG.md](SCENARIO_CONFIG.md)); `passengers` is copied into the scenario as it is, and the same field works in any scenario. The complete example is `examples/scenario-config/valle-lauro-passengers.json`:

```
npm run headless -- --scenario examples/scenario-config/valle-lauro-passengers.json --controller examples/ato.js
```

The last line of the output summarises the passengers. With `--output <folder>` the file `<scenario>_<run>_passengers.json` holds all the measures and every stop of every train. From TypeScript, `Simulation.passengers()` returns the same data during the run or at its end.

## The demand

Each element of `demand` is a flow from one station to another, in passengers per hour, optionally within a window `start_s`–`end_s` in seconds of the run; flows with the same pair add up. A morning peak is several windows with different rates.

A flow can change train: with `"via": "<station>"` its passengers ride to that station, walk to the other platform in `transfer_s` (default 60 s) and take the first train that serves their destination, queuing with those who start there. The change is declared, not chosen by the passengers, and happens once.

`arrivals` chooses how people arrive:
- `uniform` (default): a continuous flow. Amounts are real numbers (1.5 passengers is half of three), the run is fully deterministic and the measures are exact for the flow;
- `poisson`: between two visits of a train to a platform the number of people arrived is drawn from a Poisson distribution with the mean of the flow, using the generator seeded by `seed` (default 1). Amounts are whole people. The same seed gives the same run, byte for byte.

## At a stop

When the doors open, the passengers for this station alight. Then those waiting for a station that the train serves further on board, oldest first, as long as there is room; when there is not, every destination gets a share of the room in proportion to its queue (largest remainder with whole people). When the doors close, those who arrived meanwhile board too. Those who still want this train and cannot board stay on the platform for the next one, and are counted as **left behind** at every departure (one person left by two trains counts twice).

The dwell the passengers need is

```
dwell = fixed_s + max(alighting, boarding) / doors × per_passenger_s × (1 + crowding × standing share)
```

where *doors* is the number of doorways of the train, used in parallel, and the standing share is the part of the standing places taken, before or after the stop, whichever is higher. The defaults are `fixed_s` 12 s (opening, closing and departure clearance), `per_passenger_s` 1.5 s and `crowding` 0.6. They are of the order of the values measured for regional trains in the literature on dwell times, which relates them to the passengers through the doors and to crowding (Weston for London Underground; TCRP Report 165, *Transit Capacity and Quality of Service Manual*, chapter on dwell); they are declared defaults of YuTreno, to be calibrated on the line studied.

The doors stay open until the passengers have finished, and anyway until the minimum dwell and the timetabled departure. This holds for the services and for the controlled train: the built-in driver and an external controller see the doors open and cannot take traction. At its origin the controlled train takes the people waiting when it leaves, without extending its stop. At the last stop everyone alights; anyone whose stop the train did not serve (a stop missed, or skipped by the regulator) is counted as **carried past**.

## Capacity

The train has `seats`, `standing` places and `doors` (doorways per side) among its parameters. When they are missing they come from the length: 2.7 seats and 2.0 standing places per metre, one doorway every 14 m. The regional EMU of 110 m thus has 297 seats, 220 standing places and 8 doorways, close to a four-car regional unit.

## Mass on board

Every person adds `mass_kg` (default 75 kg) to the train. The mass of a passenger with luggage used for performance calculations is a standard value (EN 15663, *Vehicle reference masses*); 75 kg is of that order and can be changed with `mass_kg`. The added mass:
- increases the mass and the equivalent mass of the train (people do not rotate, so the rotating mass factor does not apply to them); in the multi-mass model each vehicle gets its share in proportion to its length;
- slows the acceleration and increases the gradient force and the adhesion limits;
- leaves the nominal deceleration unchanged, because the brake force follows the mass, as with the load-weighing valve of passenger trains. The stopping distance under the service brake therefore stays the same;
- increases the traction energy.

With the external dynamics the request carries the mass of the people on board in the optional field `payload_kg`, and `train.m` is the mass without passengers ([EXTERNAL_DYNAMICS.md](EXTERNAL_DYNAMICS.md)). The example models in JavaScript, Python and MATLAB/Octave add it.

## Measures

`Simulation.passengers()` returns:

| Field | Meaning |
| :-- | :-- |
| `arrived`, `boarded`, `alighted`, `waiting`, `onboard` | People arrived on the platforms, boarded, alighted, still waiting and on board |
| `left_behind`, `carried_past` | As above |
| `mean_wait_s`, `max_wait_s` | Wait on the platform of origin of those who boarded |
| `transfers`, `journeys` | Changes of train made, journeys ended at their destination |
| `mean_transfer_wait_s`, `max_transfer_wait_s`, `transfer_passenger_min` | Time from alighting at the station of the change to boarding the next train (walking included), and its total in passenger-minutes: what a lost connection costs |
| `transfer_stations` | Per station of change: passengers who changed there, those who boarded again, their mean wait |
| `mean_journey_s` | From the arrival on the platform to the alighting at the destination, changes included |
| `mean_passenger_delay_s` | Arrival delay at the destination, weighted by the passengers who alight there |
| `passenger_km`, `energy_kwh`, `energy_wh_per_pkm` | Passenger-km, net energy of all the trains and its share per passenger-km |
| `trains` | Per train: boarded, alighted, maximum on board, highest load factor (on board / seats at a departure), mean load factor (passenger-km / seat-km), seats, standing places |
| `stops` | Per stop of every train: alighted, boarded, left behind, on board, dwell needed |

`arrived + transfers = boarded + waiting`, `boarded = alighted + onboard` and `alighted = journeys + transfers + carried_past` always hold (without changes the first is `arrived = boarded + waiting`). Reading the measures never changes the run: with Poisson arrivals the people arrived since a train last called at a platform are counted at their expected number, and drawn only when the next train calls.

## Open data

- **SIRI-ET**: every call already left carries a `RecordedDepartureOccupancy` of SIRI 2.1 with the occupancy level, the percentage of the seats taken and the counts of alighting, boarding and on board passengers. The output is valid against the SIRI schema.
- **GTFS-Realtime**: the vehicle positions carry `occupancy_status` and `occupancy_percentage` (percentage of the seats taken).

The level goes from `empty` to `manySeatsAvailable` (up to half the seats), `fewSeatsAvailable` (up to all the seats), `standingRoomOnly` (up to half the standing places), `crushedStandingRoomOnly` and `full`.

## Limits

- A change of train is declared with `via`, one per flow; passengers do not choose their route nor change their plan when a connection is lost, they wait for the next train.
- The delay per passenger compares the arrival with the timetable of the last train taken; the cost of a lost connection is in the transfer wait and in the journey time.
- Demand does not depend on the service: people arrive at the platforms at the rate given, whatever the timetable.
- One queue per destination and station, without a choice among trains of different speed; whoever is first in the queue boards first.
- The 3D view draws one figure per person waiting, up to 60 per platform: those going towards the end of the line on the platform of track I, the others on that of track II. People boarding and alighting are not animated.

## Changing train: an example

On the network of the Valle Lauro line and its Rocca Sabato branch (`scenarios/services/branch-shuttle.json`) the service S 4101 waits at San Felice Scalo for the controlled train. With

```json
"passengers": { "transfer_s": 60, "demand": [
  { "from": "Valle Lauro", "to": "Rocca Sabato", "via": "San Felice Scalo", "per_hour": 600 },
  { "from": "Ponte Sabato", "to": "Pietrarsa", "via": "San Felice Scalo", "per_hour": 1200 } ] }
```

97 passengers change at San Felice Scalo: when the connection is kept each one waits 127 s, walking included (205 passenger-minutes in all). With a restriction to 15 km/h before San Felice Scalo the controlled train arrives after the longest wait of S 4101, which leaves; they wait 915 s each for S 4103 (1474 passenger-minutes), and their journey grows from 1042 to 1802 s on average (`PAX10`).

## Checks

`verify-passengers`:
- **PAX1**: conservation, with continuous and with Poisson arrivals;
- **PAX2**: dwell in closed form, with and without standing passengers, and doors held by the passengers in a run;
- **PAX3**: capacity and passengers left behind;
- **PAX4**: mass on board: the acceleration time grows with the equivalent mass and the stopping distance stays;
- **PAX5**: determinism with the seed, and no change without demand;
- **PAX6**: external dynamics with the passengers;
- **PAX7**: occupancy in SIRI-ET and GTFS-Realtime;
- **PAX8**: the controlled train waits for its passengers;
- **PAX9**: people waiting and on board in the control room snapshot, which does not change the run;
- **PAX10**: passengers changing train, with the connection kept and lost.
