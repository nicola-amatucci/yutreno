# Scenario configuration: choose the line and the number of trains

A scenario (`docs/SCENARIOS.md`) describes everything about a run: line, train, events, criteria, the timetable of every service. Writing the stops of ten trains by hand is long. The scenario configuration is a short JSON that says only **which line** and **how many trains**; YuTreno turns it into the complete scenario.

```json
{
 "name": "Valle Lauro: four trains in both directions",
 "line": "valle-lauro",
 "signalling": "ETCS",
 "trains": { "count": 4, "headway_s": 900, "directions": "both" }
}
```

Run it directly, as any scenario:

```
npm run headless -- --scenario examples/scenario-config/valle-lauro-4.json --controller examples/ato.js
```

or write the scenario it produces, to read it, change it or put it among the scenarios:

```
npm run make-scenario -- --config examples/scenario-config/valle-lauro-4.json --output scenario.json
npm run make-scenario -- --line valle-lauro --trains 4 --headway 900 --directions both
```

The controlled train is always there, with the timetable of the line; `count` is the number of the other trains (services, driven by the built-in ATO).

## Fields

| Field | Meaning | Default |
| :-- | :-- | :-- |
| `name`, `description` | Name and description of the scenario | generated |
| `line` | Id of a built-in line (`valle-lauro`, `rocca-sabato`, `ponte-pietrarsa`) or path of a `line.json`, relative to the configuration, for example an imported real line | required |
| `train` | Id of a built-in train, for the controlled train and the services | `regional` |
| `signalling`, `onboard`, `trackside`, `weather` | As in a scenario | those of the run |
| `leader` | Train ahead of the controlled train on the line | `false` |
| `trains.count` | Number of service trains, from 0 to 200 | required |
| `trains.headway_s` | Time between two services of the same direction (s) | 600 |
| `trains.first_departure_s` | Departure of the first service (s from the start) | departure of the controlled train + `headway_s` |
| `trains.directions` | `forward` (as the controlled train), `backward`, or `both` alternating | `forward` |
| `trains.first_backward_departure_s` | With `both`, departure of the first backward service | first departure + half the headway |
| `trains.dwell_s` | Dwell at the intermediate stations (s) | that of the line timetable |
| `trains.prefix` | Prefix of the numbers: forward 101, 103, …, backward 102, 104, … | `R` |
| `timetable` | Path of a real timetable extract (below): the services are its trips instead | none |
| `from` | With `timetable`, time of day from which trips are taken (`HH:MM`) | the first trip |
| `offset_s` | With `timetable`, second of the run at which the first chosen trip leaves | 300 |

Generated services stop at every station, with the running times of the line timetable (`arr` and `dep` of its stations). A backward service uses the same running times read backwards: on a line with steep gradients it may run a little early or late.

On a single-track line, services in both directions cross only in stations with a second track; the automatic block and the interlocking stop a train at the station until the section ahead is free, but with too short a headway two trains can wait for each other. Choose a headway at least as long as the running time between two crossing stations, or check the result in the *Control room*.

## A real timetable

With `timetable` the trains are those of a real timetable: the first `count` trips that leave at or after `from`, in both directions, with their stops and times. The extract is a small JSON:

```json
{
 "format": "yutreno-timetable-extract",
 "version": 1,
 "source": { "publisher": "…", "url": "…", "validity": "…" },
 "trips": [
  { "number": "5004", "stops": [
    { "station": "SALERNO", "departure": "06:00" },
    { "station": "SALERNO IRNO", "arrival": "06:04", "departure": "06:05" },
    { "station": "MERCATO S.SEVERINO", "arrival": "06:36" } ] }
 ]
}
```

Station names are matched to those of the line ignoring case, accents and punctuation; a one-letter word stands for a word that starts with it («MERCATO S.SEVERINO» is «Mercato San Severino»). Stops at stations that are not on the line are left out. The times become seconds of the run so that the first chosen trip leaves at `offset_s`.

`examples/infra/salerno-mercato-s-severino/timetable.json` is the extract of the 21 daily Trenitalia trips of the Salerno – Mercato San Severino line, from the NeTEx of the Campania region on the National Access Point (`docs/LINE_TUTORIAL.md`, section on timetables). `examples/scenario-config/salerno-real-timetable.json` runs its first four morning trips on the line imported from OpenStreetMap, RINF and EU-DEM:

```
npm run headless -- --scenario examples/scenario-config/salerno-real-timetable.json --controller examples/ato.js
```

A full GTFS, NeTEx or railML timetable is imported with `npm run import` instead (`docs/TIMETABLE_STANDARDS.md`); the extract is meant for a single line taken out of a large regional file.

## Length of the run

A run stops after 7200 s of simulated time. When the timetable of a scenario goes beyond that, as a day of real trips does, the run lasts until one hour after the last timetabled time.

## Checks

`verify-scenario-config` checks the generated services (numbers, directions, times), the errors of a configuration, the trips taken from the real timetable and a run with trains in both directions. `verify-infra` (INF13) compares the trips of the real timetable with the simulated running times on the imported line.
