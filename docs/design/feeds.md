# Open data feeds

## Purpose

`src/feeds/` turns a run into the formats of passenger information and timetable exchange: GTFS, NeTEx (Italian EPIP profile) and railML 3.2 for the planned timetable, GTFS-Realtime and SIRI 2.1 for positions and actual and expected times. `src/server/feeds-server.ts` serves them over HTTP while the run follows the clock. The other way round, it imports GTFS, NeTEx and railML timetables as service trains (`src/server/import-timetable.ts`, *Timetable* tab). The user documentation is [OPEN_DATA.md](../OPEN_DATA.md).

The component reads the simulation and never writes it: the feeds are pure functions of `Simulation`, so reading them does not change the run, and the same run gives the same bytes.

## Structure

| File | Content |
| :-- | :-- |
| `model.ts` | `FeedOptions`, georeferencing (`wgs84`, `bearing`), `ServiceCalendar`, identifiers (`Ids`), planned trips (`trips`) and real-time state (`tripState`) |
| `gtfs.ts` | `gtfsFiles()`: the text files of the GTFS feed |
| `zip.ts` | `zip()`: archive with stored entries and a fixed date, no dependencies |
| `gtfs-rt.ts` | `gtfsRealtime()`: FeedMessage of VehiclePositions or TripUpdates with the field names of `gtfs-realtime.proto`; `encodeFeed()`: protobuf writer that follows the field numbers of the specification |
| `siri.ts` | `siriVehicleMonitoring()`, `siriEstimatedTimetable()`: XML in the element order of the SIRI 2.1 schema |
| `netex.ts` | `netexTimetable()`: PublicationDelivery with a CompositeFrame `EU_PI_LINE_OFFER` and the calendar, resource, site, service and timetable frames; train numbers as `TrainNumber` |
| `railml.ts` | `railmlTimetable()`: railML 3.2 (operational points, base itineraries with times and minimum dwells, itineraries, validity, operational trains); `importRailml()` for railML 3.x and 2.x |
| `xml.ts` | `parseXml()`: minimal XML reader (local names, attributes, text) for the imports |
| `import.ts` | `ImportOptions`, `toServices()` (matching to the line, times from the start of the run, drops with warnings), `normalService()`, `detectFormat()` |
| `import-gtfs.ts`, `import-netex.ts` | `importGtfs()` (with `parseCsv()`), `importNetex()` |
| `import-any.ts` | `importTimetable()`: recognises the format, unzips GTFS (`unzip()` in `zip.ts`, with the inflate function of the platform) |

Like the core, `src/feeds/` uses neither the DOM nor Node (the server adds HTTP and gzip), so the page can produce the same files.

## Model

**Trips.** `trips(sim)` lists the trains of the run with their planned stops in the chainages of the line: for a train running against the line the station chainage is mirrored (`L.len − s`). On a network the chainages are those of the corridor of the train, and every trip carries its line of the feeds (`line`), its position and bearing functions (`pos`, `heading`, on the common plan of the network) and its block; `feedStations(sim)` gives every station once. On a single line `pos` is `wgs84(L, s)` and the output is identical to before. The first stop has no arrival and the last no departure, as in all four formats. The controlled train takes the number `CONTROLLED_NUMBER` (`R 2001`); services use their id.

**State.** `tripState(sim, trip)` reads the head of the train, its speed, the next station index (`S.nextSt`) and the record `realised`. The delay is that of the last event made (arrival or departure); expected times are planned times plus the delay, only if positive. Each format then decides how to present it: GTFS-RT gives `delay` and `time` per stop event, SIRI-ET separates `RecordedCalls` (stops left) from `EstimatedCalls`, SIRI-VM reports the monitored call of the next stop.

**Calendar.** `ServiceCalendar` maps simulated time to local time and to instants: `originUtc` is local noon minus twelve hours of the service day (the GTFS definition), so times after a change of time stay equal to the wall clock; offsets come from `Intl.DateTimeFormat` with the IANA zone, rounded to minutes.

**Identifiers.** `Ids` builds `IT:<region>:<type>:<codespace>:<slug>` for every object; GTFS and SIRI use the NeTEx identifiers as they are. Slugs remove accents and punctuation, so identifiers depend only on names and options.

**Geography.** `wgs84(L, s)` rotates the local plan by `geo.rotation_deg` and places it at `geo.lat`, `geo.lon` with an equirectangular projection; `bearing` takes the direction between two points 10 m apart and turns it by 180° for trains against the line.

## Invariants

- The feeds do not change the run; the determinism fingerprints of the campaign do not depend on them.
- Identifiers are the same in all formats and in all runs of a scenario.
- The static feeds (GTFS, NeTEx) depend on the timetable, not on the progress of the run.
- Every NeTEx reference resolves inside the delivery, apart from the EPIP frame types.
- Exporting and importing again gives back the same services (normal form; railML also the minimum dwells).
- Imports never drop silently: every stop, trip or day left out is in `warnings`.
- The output validates against the official schemas: NeTEx against `NeTEx_publication_EPIP.xsd` of the Italian profile, SIRI against `siri.xsd`; GTFS has no errors in the MobilityData validator.

## Tests

`scripts/verify-feeds.ts` (in `npm run verify`): calendar with CET, CEST and the day of the change; GTFS integrity (unzipped and parsed), coordinates equal to those of the line, independence from the progress of the run; GTFS-RT decoded with `gtfs-realtime-bindings` and compared with the source object and the simulation; SIRI identifiers present in NeTEx, recorded calls equal to the departures made, delays equal to GTFS-RT; NeTEx references and identifier pattern; determinism. `scripts/verify-imports.ts` (in `npm run verify`): round trip of every service scenario and of a 25-train timetable through GTFS, NeTEx and railML, files of other producers in each format, CSV and XML readers. `scripts/feeds-validate.ts` runs the official validators; its results are in [OPEN_DATA.md](../OPEN_DATA.md#conformance).

## Extending

- **A new format** (for example SIRI-SX or GTFS-Fares) goes in a new file of `src/feeds/` that uses `trips`, `tripState`, `ServiceCalendar` and `Ids`, with an endpoint in the server and checks in `verify-feeds`.
- **Cancellations and platform changes** need the simulation to have them first; then `tripState` carries them and the formats map them (`schedule_relationship`, `Cancellation`, `ArrivalPlatformName`).
- **A new import format** produces `RawTrip[]` and hands them to `toServices`, which does the matching; `detectFormat` and `importTimetable` recognise it.
- **Infrastructure from railML** (operational points with positions, tracks) would let an imported timetable bring its own line; today the stops are matched to a line that already exists.
