# Examples of the open data feeds

Real output of YuTreno for the scenario [`scenarios/services/crossing.json`](../../scenarios/services/crossing.json) at t = 600 s (08:10 on 5 November 2026). At that moment train R 2001 is held at the exit of San Felice Scalo, and R 2101, coming the other way, has just arrived there 54 seconds early and waits for its 08:11 departure.

| Folder | Format | Content |
| :-- | :-- | :-- |
| `gtfs/` | GTFS (the files of `gtfs.zip`, unpacked) | stations and platforms, route, the two trips, stop times, shapes, calendar |
| `gtfs-rt/` | GTFS-Realtime, decoded to JSON | vehicle positions and trip updates; the server sends the same messages in protobuf |
| `siri/` | SIRI 2.1, Italian profile | vehicle monitoring and estimated timetable |
| `netex/` | NeTEx, Italian EPIP profile, level 1 | the planned timetable |
| `railml/` | railML 3.2 | the planned timetable with the minimum dwells |

The files are indented for reading; the server writes the same documents on one line. They are regenerated with `npx tsx scripts/feeds-examples.ts`, and `verify-feeds` fails if they no longer match the code. The standards, with these examples commented, are explained in [docs/TIMETABLE_STANDARDS.md](../../docs/TIMETABLE_STANDARDS.md) (Italian: [docs/it/STANDARD_ORARI.md](../../docs/it/STANDARD_ORARI.md)).
