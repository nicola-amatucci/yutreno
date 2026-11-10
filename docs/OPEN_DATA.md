# Open data: timetable and real-time feeds

YuTreno publishes the timetable and the progress of a run in the formats that passenger information systems read: **GTFS** and **NeTEx** for the planned timetable, **GTFS-Realtime** and **SIRI** for positions and actual and expected times. NeTEx follows the Italian profile of the European Passenger Information Profile (EPIP), the one maintained by 5T for the Regional Access Points; the identifiers are those of the profile and are the same in all four formats, so a consumer can join the timetable and the real-time data without tables of correspondence.

The point is not to imitate an operator but to give the simulator an output that existing tools understand. A journey planner, a station departure board or a delay dashboard can be pointed at a run and see trains that brake, wait at a crossing and accumulate delay according to the physics and the signalling, not according to a script. The other way round, the feeds are a check of the simulator: if a run produces a delay, the delay must appear the same in TripUpdates, in SIRI-ET and in the position of the train.

The standards themselves (where they come from, their models, the Italian profiles, the correspondence of concepts and the validators) are discussed in [TIMETABLE_STANDARDS.md](TIMETABLE_STANDARDS.md). Real output of every format is in [examples/feeds/](../examples/feeds/).

## Quick start

```
npm run feeds -- --scenario scenarios/services/crossing.json --speed 10
```

starts the server on `http://localhost:8090/` with the crossing scenario running ten times faster than the clock. The controlled train is driven by the built-in ATO, the service trains by their own driver. Every request returns the feeds at the simulated time of that moment.

```
npm run feeds -- --scenario scenarios/services/crossing.json --at 600 --out feeds/
```

does not serve: it runs to t = 600 s and writes all the feeds in `feeds/` (`gtfs.zip`, `vehicle-positions.pb` and `.json`, `trip-updates.pb` and `.json`, `siri-vm.xml`, `siri-et.xml`, `netex.xml`, `railml.xml`).

Options: `--port`, `--speed` (simulated seconds per second), `--date YYYY-MM-DD` (service day, default 2026-11-05), `--start HH:MM:SS` (local time of t = 0, default 08:00:00 as in the page), `--timezone` (default Europe/Rome), `--region` (NUTS code in the identifiers, default ITF3, Campania), `--codespace` (default `yutreno`), `--vat` (VAT number of the operator, which the Italian profiles put in its identifier).

## Endpoints

| Path | Format | Content |
| :-- | :-- | :-- |
| `/` | JSON | state of the run and list of the endpoints |
| `/gtfs/gtfs.zip` | GTFS | agency, stations and platforms, route, trips, stop times, shapes, calendar of the day |
| `/gtfs-rt/vehicle-positions` | GTFS-Realtime (protobuf; `?format=json`) | position, bearing, speed, odometer, current stop and status of every train running |
| `/gtfs-rt/trip-updates` | GTFS-Realtime (protobuf; `?format=json`) | actual times of the stops made, expected times of the others, current delay |
| `/siri-lite/vehicle-monitoring` | SIRI 2.1 VM (XML) | one `VehicleActivity` per train running, with progress between stops, delay and monitored call |
| `/siri-lite/estimated-timetable` | SIRI 2.1 ET (XML) | every journey of the day: `RecordedCalls` with actual times, `EstimatedCalls` with expected times |
| `/netex/timetable.xml` | NeTEx EPIP, Italian profile | planned timetable |
| `/netex/api/v1/convertedNetex` | JSON | list of the versions, as in the RAP interface |
| `/netex/api/v1/downloadVersion?level=1&agencyCode=yutreno[&gzVersion=false]` | NeTEx gzip or XML | download, as in the RAP interface |
| `/railml/timetable.xml` | railML 3.2 | planned timetable with minimum dwells ([below](#importing-timetables)) |
| `/control-room` | JSON | snapshot of the control room: network, signalling, trains and log ([CONTROL_ROOM.md](CONTROL_ROOM.md); `?log=<n>` events) |

The SIRI endpoints are SIRI Lite: a GET returns the whole delivery, without subscriptions. Paths and filters (`LineRef`, `OperatorRef`, `datasetId`, `maxSize`) are those of the dynamic RAP interface of the Italian SIRI profile (`swagger/RAP_DINAMICO_1_0_0.yaml` in the 5T repository); the earlier `/siri/vehicle-monitoring` and `/siri/estimated-timetable` still answer. The deliveries follow the Italian SIRI profile: NeTEx identifiers, `JourneyPatternRef`, `VehicleRef`, `VisitNumber` and `Order` in the calls. The two `/netex/api/v1/` paths reproduce the interface that the Italian profile publishes for the Regional Access Points (`swagger/RAP_1_0_0.yaml` in the profile repository), so a client written for a RAP can download the YuTreno timetable unchanged; `xsdzip` answers 404 and points to the profile repository. Every response carries `Access-Control-Allow-Origin: *`, so a page can read the feeds directly.

## From the run to the feeds

**The line on the map.** The line has a local plan in metres; `geo` in the line definition places its origin (`lat`, `lon`) and can rotate it (`rotation_deg`). The two built-in lines are placed in Campania, between the Lauro valley and Irpinia; a line without `geo` is placed at the same point. Positions are an equirectangular projection of the plan, more than enough for lines of tens of kilometres.

**Stations, platforms, directions.** Each station is a stop place with two quays, platform 1 for the trains in the direction of the line and platform 2 for the others, as the two-track stations of the 3D view. In GTFS they are a station (`location_type=1`) with its platforms; in NeTEx a `StopPlace` with two `Quay`, two `ScheduledStopPoint` and the `PassengerStopAssignment` that bind them. The GTFS lists only the platforms that have trips.

**Trips.** Every train of the run is a trip: the controlled train with the timetable of the line, as train `R 2001`, and every service with its own id. In NeTEx the number is a `TrainNumber` (`ForAdvertisement`) referenced by the journey. Times are those of the timetable, not of the run, so the GTFS and the NeTEx do not change while the run goes on.

**Real time.** Actual times are those recorded by the simulation (`realised` of each train). The delay is that of the last arrival or departure made; the expected times of the following stops are the planned ones plus the delay, if positive, because a train does not leave before its departure time and an early running is absorbed at the next stop. A train waiting beyond its departure time has an expected departure of "now".

**Decisions of the regulator.** The static timetables (GTFS, NeTEx, railML) are always the plan, and the aimed times and the delays of the real-time feeds are measured against it. What the regulator ([REGULATOR.md](REGULATOR.md)) changes during the run is real-time information:

- **a new time** is a lower bound of the expected one: expected = the later of plan plus delay and the rescheduled time;
- **a skipped stop**, or one removed because the train now ends earlier, is a `StopTimeUpdate` with `schedule_relationship: SKIPPED` and no times in GTFS-Realtime, and an `EstimatedCall` with `<Cancellation>true</Cancellation>` and the aimed times in SIRI-ET;
- **a train cancelled entirely** is a `TripUpdate` with the trip `CANCELED` and no stop time updates, and an `EstimatedVehicleJourney` with `<Cancellation>true</Cancellation>` and every call cancelled;
- **a train that ends early** shows the station where it ends as a recorded call.

The scenario `services/cancellation` produces the second and the last case; `verify-feeds` checks all of them with a scripted regulator, and the SIRI output stays valid against the official schema. Vehicle positions report `STOPPED_AT` when the train is at a stop, `INCOMING_AT` within 400 m of it, `IN_TRANSIT_TO` otherwise; in SIRI-VM `ProgressBetweenStops` gives the length of the link and the percentage covered.

**Networks.** On a network ([design/network.md](design/network.md)) every station of every line is a stop place, a node once. A trip belongs to the line of the feeds made of the lines it runs along: a train on one line to that line, a train from Valle Lauro to Rocca Sabato to the line `valle-lauro+rocca-sabato`; every such line is a GTFS route and a NeTEx `Line` with its routes per direction. The direction of a trip is that of its line, or, across several lines, outbound when it starts on the lower line of the network. Positions and shapes follow the corridor of each trip on the common plan of the network, placed with the `geo` of the main line; the chainages of stops and vehicles are those of the corridor. GTFS has a shape per line, direction and pair of ends.

**Circulations and connections.** The block of a service is the `block_id` of its GTFS trip (the column appears only when some train has a block). A connection is a row of `transfers.txt` with `transfer_type` 1, the departing train waits, and the transfer time; in NeTEx it is a `ServiceJourneyInterchange` with `StandardTransferTime`, and the passage between two services of a block is an interchange with `StaySeated`. The EPIP profile has neither `MaximumWaitTime` nor `Guaranteed`, so the maximum wait is not published. The import reads `block_id` back; connections and networks are not imported yet.

**Time.** The run starts at `--start` of `--date` in `--timezone`. Times of the day count from noon minus twelve hours, as GTFS defines them, so they match the wall clock on the days of the change of time too; times after midnight are written beyond 24:00 in GTFS and with a `DayOffset` in NeTEx. SIRI writes instants with the offset of that moment (`+01:00` in November, `+02:00` in July).

## Identifiers

All identifiers have the form of the Italian profile, `IT:<region>:<type>:<codespace>:<local id>`:

| Object | Example |
| :-- | :-- |
| Operator | `IT:ITF3:Operator:yutreno:yutreno` |
| Line (GTFS `route_id`, SIRI `LineRef`) | `IT:ITF3:Line:yutreno:valle-lauro-monte-clanio` |
| Station (GTFS station, NeTEx `StopPlace`) | `IT:ITF3:StopPlace:yutreno:ponte-sabato` |
| Platform (GTFS `stop_id` of the stop times, NeTEx `Quay`) | `IT:ITF3:Quay:yutreno:ponte-sabato-1` |
| Stop point (NeTEx, SIRI `StopPointRef`) | `IT:ITF3:ScheduledStopPoint:yutreno:ponte-sabato-2` |
| Journey (GTFS `trip_id`, NeTEx `ServiceJourney`, SIRI `DatedVehicleJourneyRef`) | `IT:ITF3:ServiceJourney:yutreno:r-2101` |
| Vehicle | `IT:ITF3:Vehicle:yutreno:r-2101` |

They depend only on the line, the names and the options, so two runs of the same scenario have the same identifiers.

## Conformance

`npm run verify` includes `verify-feeds`, which decodes the GTFS-Realtime protobuf with the official bindings (`gtfs-realtime-bindings`) and checks referential integrity, agreement between formats and with the simulation, calendar (CET, CEST, day of the change, times after midnight) and determinism. Validation with the official tools needs Java, xmllint and the schemas, so it is a separate script:

```
git clone --depth 1 https://github.com/5Tsrl/netex-italian-profile ext/netex-italian-profile
git clone --depth 1 https://github.com/SIRI-CEN/SIRI ext/SIRI
npx tsx scripts/feeds-validate.ts --netex ext/netex-italian-profile --siri ext/SIRI --gtfs-validator gtfs-validator-7.1.0-cli.jar
```

It writes the feeds of every service scenario at t = 0, 300, 600 s and at the end in `results/feeds/` and validates them. The result at the time of writing:

| Check | Result |
| :-- | :-- |
| NeTEx against `xsd/NeTEx_publication_EPIP.xsd` of the Italian profile | 8/8 valid |
| SIRI VM and ET against `xsd/siri.xsd` (SIRI 2.1) | 16/16 valid |
| GTFS with the MobilityData validator 7.1.0 | 0 errors; warnings `feed_expiration_date7_days` and `trip_coverage_not_active_for_next7_days` |

The two GTFS warnings are expected: the feed describes one service day, while the validator expects a published feed to cover at least the following week.

## Importing timetables

The way back is as important as the way out. A timetable written elsewhere — the GTFS of a regional operator, the NeTEx published by a Regional Access Point, the railML of an infrastructure manager — can become the service trains of a scenario, and a timetable built in YuTreno can be taken to other tools and brought back unchanged.

```
npm run import -- orario.zip --line valle-lauro --date 2026-11-05 --output scenarios/services/imported.json
npm run import -- netex.xml --scenario scenarios/services/crossing.json
```

The format is recognised from the content: a ZIP is GTFS, a `PublicationDelivery` is NeTEx, a `railML` (3.x) or `railml` (2.x) root is railML. The same import is in the page: the *Timetable* tab has a button to import a file and three to download the timetable in use as GTFS, NeTEx or railML.

**What is read.** Every format has its way of saying the same four things, and the import looks for them where producers put them.
- *Stops.* In GTFS a platform takes the name of its station (`parent_station`). In NeTEx the stop point takes the name of the stop place or quay assigned to it, and the order comes from the journey pattern. In railML 3 the name comes from the operational point of each base itinerary point, and points marked `pass` are skipped. In railML 2 it comes from the `ocp` of each `ocpTT`, ordered by `sequence`.
- *Times.* GTFS times can go beyond 24:00. NeTEx uses day offsets; when a file leaves them out and the times go back, the import reads the following day and says so. railML 3 uses times with `dayOffset` and the offsets of ranges and train variants; railML 2 uses `arrivalDay` and `departureDay`. The commercial or scheduled scope is preferred.
- *Train numbers.* GTFS uses `trip_short_name`, then `trip_id`. NeTEx uses the `ForAdvertisement` of the `TrainNumber`, then the codes and the identifier. railML 3 uses the `OperationalTrainNumber` identifier; railML 2 uses the number of the `trainPart` or of the `train` that contains it.
- *Service day.* With `--date`, only the trips running that day are imported. In GTFS that means `calendar.txt` with the exceptions of `calendar_dates.txt`. In NeTEx it means day type assignments by date, operating day or operating period (with `ValidDayBits` or the days of the week). In railML it means bitmask validities and operating periods.

**Matching to the line.** Stops are matched to the stations of the line by name, ignoring case, accents and punctuation; stops that are not on the line are dropped, and a trip that keeps fewer than two is dropped. Times become seconds from the start of the run (`--start`, 08:00:00 by default); a trip departing earlier is dropped. The trip with exactly the timetable of the line is the controlled train and is not imported as a service, unless `--keep-controlled` is given. Every drop is reported, on stderr or in the page, so that nothing disappears silently.

**What the formats do not carry.** The train type and the driver are not in GTFS, NeTEx or railML as YuTreno uses them. Minimum dwells are only in railML (`minDwellTime`, `minStopTime`). When the services replace those of a scenario (`--scenario`), these fields are kept from the service with the same number.

**Round trip.** `verify-imports` exports every service scenario and a timetable of 25 trains running in both directions until after midnight, then imports it again. The services come back identical from GTFS and NeTEx, and from railML with the minimum dwells too. It also reads files written the way other producers write them: a deflated ZIP with a folder, weekly calendars, NeTEx with prefixes and operating periods, railML 3 with shared itineraries and offsets, and railML 2 with train parts.

**railML 3.2 export.** The download and `/railml/timetable.xml` contain the stations as operational points. Each train has a base itinerary with commercial times and minimum dwells, an itinerary, a bitmask validity for the service day, and an operational train with its operational train number. The structure follows the railML 3.2 data model on the railML wiki. It has not yet been validated against the XSD, which railML.org distributes to registered users and which could not be reached from the environment where this was written. `scripts/feeds-validate.ts --railml <folder with railml3.xsd>` validates it as soon as the schema is available.

## Passengers

With passengers in the scenario ([PASSENGERS.md](PASSENGERS.md)) SIRI-ET carries, at every call already left, a `RecordedDepartureOccupancy` with the occupancy level, the percentage of the seats taken and the counts of alighting, boarding and on board passengers, and the GTFS-Realtime vehicle positions carry `occupancy_status` and `occupancy_percentage`.

## Limits

- One service day per run; timetables of a network are produced but imported only line by line; no fares, no accessibility, no vehicle types (EPIP level 1 without the optional parts).
- The server drives the services with the built-in ATO: services with `"driver": "agent"` are refused (they need the agent environment, [AGENTS.md](AGENTS.md)).
- Cancellations exist only as decisions of a regulator; changes of platform are not published (the track of a train in a station is not a quay of the timetable).
- SIRI is served as SIRI Lite (GET of the whole delivery), without subscriptions or SIRI-SX situations.
- The page downloads the static timetables (GTFS, NeTEx, railML) but not the real-time feeds, which need the run to follow the clock: those come from `npm run feeds`.
