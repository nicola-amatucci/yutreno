# Timetable and passenger information standards

This document explains the standards behind the open data of YuTreno ([OPEN_DATA.md](OPEN_DATA.md)): where each one comes from, who maintains it, what it models, how YuTreno uses it, and how to check the result. The examples are real output of YuTreno. They are in [examples/feeds/](../examples/feeds/): the crossing scenario at 08:10, ten minutes into the run, with train R 2001 held at the exit of San Felice Scalo and R 2101 arriving there from the opposite direction. `verify-feeds` keeps the examples identical to what the code produces.

The [general standards document](STANDARDS.md) covers ETCS, EULYNX and the railway side. This one covers the passenger side and timetable exchange, which follow a different logic.

## Two families, one timetable

Two families of standards describe a train timetable, and they were born for different people.

The **passenger information family** was born to tell travellers when and where vehicles run, whatever the mode:
- In Europe it is built on one conceptual model, **Transmodel**. Two exchange formats derive from it: **NeTEx** for planned data and **SIRI** for real-time data.
- In parallel, **GTFS** and **GTFS-Realtime** grew from practice. They are simple, widespread, and have no formal body behind them.

The **railway operations family** describes the timetable as infrastructure managers and railway undertakings need it: operational points, train paths, running and dwell times, train composition. Its standards are:
- **railML**, an XML language maintained by an association of the sector;
- the European **TSI** for telematics, which govern data exchange between railway companies.

YuTreno sits where the two meet. It simulates a railway, with signals, braking and dwell times, but the trains carry passengers. So the same timetable leaves the simulator in both languages. A journey planner reads GTFS or NeTEx; a timetabling tool reads railML. The identifiers are the same everywhere, so the planned and real-time data join without correspondence tables.

## The legal frame

Most of the passenger information family is not optional in the European Union.

The **ITS Directive 2010/40/EU** (revised by Directive (EU) 2023/2661) asks for EU-wide multimodal travel information services. **Delegated Regulation (EU) 2017/1926** (MMTIS) implements it. Its main requirements:
- Every member state must set up a **National Access Point (NAP)**, due by 1 December 2019.
- Transport authorities, operators and infrastructure managers must publish their data through the NAP.
- Static data of scheduled transport must use **NeTEx (CEN/TS 16614)** based on **Transmodel (EN 12896)**, or a machine-readable format that is fully compatible with it, for example through converters.
- Dynamic data must use **SIRI (CEN/TS 15531)** or a fully compatible format.

**Delegated Regulation (EU) 2024/490** amends 2017/1926 and makes dynamic data mandatory, with deadlines:

| Date | Data required |
| :-- | :-- |
| 1 December 2025 | historic and observed delays and cancellations; disruptions; estimated departure and arrival times; status of access nodes |
| 1 December 2026 | parking tariffs and availability; vehicle sharing |
| 1 December 2028 | full extension of these categories |

GTFS is therefore acceptable only through conversion: it is not the reference format at the NAP.

**In Italy**, the NAP for multimodal travel information is run for the Ministry of Infrastructure and Transport through the CCISS portal. Data reach it mostly through **Regional Access Points (RAP)**. Each RAP collects the data of its region in whatever format the producers use (GTFS, GBFS and others), converts them, and delivers them to the NAP in the **Italian profiles** of NeTEx and SIRI. The profiles are maintained by 5T (Turin), which also publishes:
- the compilation guidelines;
- the XSD of the NeTEx profile;
- the examples;
- the OpenAPI specifications of the RAP interfaces.

The suppliers listed by the NAP include Trenitalia, Italo and most regions; Campania, the region of the YuTreno lines, is among them.

For rail specifically, the old TSI for telematic applications for passengers (TAP, Regulation (EU) No 454/2011) and freight (TAF, Regulation (EU) No 1305/2014) have been replaced by the **TSI Telematics, Implementing Regulation (EU) 2026/253** of 6 February 2026. It extends to railways the obligation to publish timetables, real-time positions, train composition and station accessibility through the national access points.

## Transmodel: the shared vocabulary

**What it is.** Transmodel, EN 12896, is the European reference data model for public transport. It is published in parts: common concepts, network, timetables, operations monitoring, fares, passenger information and others. Version 6.2 is the current one. It is a conceptual model, not a file format: NeTEx and SIRI are its XML encodings.

**Why it matters.** It fixes the meaning of words that every timetable uses, and YuTreno uses them in the sense of Transmodel:

| Transmodel concept | Meaning | In YuTreno |
| :-- | :-- | :-- |
| Line | a group of routes known to the public by a name | the line of the run |
| Route, direction | an ordered path, outbound or inbound | the two running directions |
| Scheduled stop point | the point where passengers board or alight in a timetable | one per station and direction |
| Stop place, quay | the physical station and its platforms | the station, platform 1 and 2 |
| Journey pattern | the sequence of stop points of a set of journeys | the stops of a service |
| Service journey | one run of a vehicle at given times | a train of the run (the controlled train or a service) |
| Passing time | the time of a journey at a point of its pattern | arrival and departure at a stop |
| Day type, operating day | the days a journey runs | the service day of the run |

## NeTEx: planned timetables

**What it is.** NeTEx (Network Timetable Exchange) is the CEN technical specification 16614, in parts. The main ones:

| Part | Content |
| :-- | :-- |
| 1 | network topology |
| 2 | timetables |
| 3 | fares |
| 4 | European Passenger Information Profile (EPIP), the subset required for MMTIS |
| 5 | alternative modes |
| 6 | accessibility profile |

The XML schema is maintained openly on GitHub, in the TransmodelEcosystem organisation. Version 2 of the schema was published in 2026; the EPIP profile is a restriction of version 1.x.

**Structure.** A NeTEx file is a `PublicationDelivery` containing **frames**. Each frame holds one kind of object, and objects refer to each other by identifier:
- **ResourceFrame:** operators;
- **SiteFrame:** stop places and quays;
- **ServiceFrame:** lines, routes, scheduled stop points, stop assignments and journey patterns;
- **ServiceCalendarFrame:** day types and their assignments to dates;
- **TimetableFrame:** service journeys with their passing times.

An EPIP document wraps them in a `CompositeFrame` of type `EU_PI_LINE_OFFER`.

**The Italian profile** has five levels:
- level 1 is EPIP;
- level 2 adds contracts and journey accounting;
- level 3 adds fares;
- level 4 adds alternative modes;
- level 5 adds accessibility.

The guidelines (version 5.0.1, April 2026) fix the identifiers as `IT:<NUTS region>:<type>:<codespace>:<id>`. For the operator, the identifier carries the VAT number (`IT:ITC1:Operator:<VAT number>:<codespace>:<id>`). Rail operators of local transport take `OrganisationType` `railOperator`, and `PublicationDelivery` carries `version="any"`.

**In YuTreno** the export is a level 1 document of the Italian profile. Here is a journey from `examples/feeds/netex/timetable.xml`, shortened:

```xml
<ServiceJourney id="IT:ITF3:ServiceJourney:yutreno:r-2101" version="1">
  <Name>R 2101 Monte Clanio – Valle Lauro</Name>
  <TransportMode>rail</TransportMode>
  <DepartureTime>08:05:00</DepartureTime>
  <dayTypes><DayTypeRef ref="IT:ITF3:DayType:yutreno:2026-11-05" version="1"/></dayTypes>
  <ServiceJourneyPatternRef ref="IT:ITF3:ServiceJourneyPattern:yutreno:in-monte-clanio_san-felice-scalo_ponte-sabato_valle-lauro" version="1"/>
  <OperatorRef ref="IT:ITF3:Operator:yutreno:yutreno" version="1"/>
  <trainNumbers><TrainNumberRef ref="IT:ITF3:TrainNumber:yutreno:r-2101" version="1"/></trainNumbers>
  <passingTimes>
    <TimetabledPassingTime id="IT:ITF3:TimetabledPassingTime:yutreno:r-2101-2" version="1">
      <StopPointInJourneyPatternRef ref="IT:ITF3:StopPointInJourneyPattern:yutreno:in-…-2" version="1"/>
      <ArrivalTime>08:09:20</ArrivalTime>
      <DepartureTime>08:11:00</DepartureTime>
    </TimetabledPassingTime>
    …
```

How to read it:
- The journey does not name its stations. It points to a journey pattern, whose points refer to scheduled stop points, which a stop assignment binds to a station and a platform.
- The train number shown to passengers lives in a `TrainNumber` (`ForAdvertisement`).
- Times after midnight carry a `DayOffset`.

The import follows the same chain backwards, and also reads files whose producers leave the day offset out.

**Validation.** The XSD of the Italian profile, `xsd/NeTEx_publication_EPIP.xsd` in the 5T repository, can be checked with `xmllint`. `scripts/feeds-validate.ts` does it on every service scenario at four moments of the run: 24 of 24 documents are valid. The schema checks the structure; the guidelines add rules that no schema can express, such as the form of identifiers and the mandatory fields.

## SIRI: real-time information

**What it is.** SIRI (Service Interface for Real-time Information) has been a European standard since 2006. Parts 1 to 3 (framework, communications, functional services) are EN 15531:2022 and 2023. Parts 4 to 7 are technical specifications:
- part 4: facility monitoring;
- part 5: situation exchange;
- part 6: control actions;
- part 7: the European real-time passenger information profile.

The schema is on GitHub, at version 2.3 (October 2026); documents declare the version of SIRI they follow, and the Italian profile asks for `version="2.1"`.

**Services.** SIRI is a set of services that share one envelope (`Siri/ServiceDelivery`):

| Service | Content |
| :-- | :-- |
| VM (Vehicle Monitoring) | where vehicles are |
| ET (Estimated Timetable) | actual and expected times of whole journeys |
| SM (Stop Monitoring) | departures at a stop |
| SX (Situation Exchange) | disruptions |
| FM (Facility Monitoring) | lifts, parking and the like |
| PT (Production Timetable) | the timetable of the day |

The full protocol works by subscription (publish/subscribe). **SIRI Lite** is a simplified HTTP GET that returns the whole delivery.

**The Italian profile** (guidelines version 2.0.0, 5 November 2025) defines the SIRI flows between RAP and NAP: VM, ET, SX, FM and PT. Its main rules:
- SIRI must always be correlated with the latest NeTEx, with the same identifiers.
- Journeys are referenced by `FramedVehicleJourneyRef` (date and NeTEx journey).
- `JourneyPatternRef`, `OperatorRef` and `VehicleRef` are required.
- Calls carry `VisitNumber` and `Order`.

The OpenAPI specification of the dynamic RAP interface (version 1.1, July 2024) adds:
- `/siri/subscribe` for the NAP;
- SIRI Lite endpoints for the national MaaS platform: `/siri-lite/estimated-timetable`, `/siri-lite/vehicle-monitoring` and others, with the filters `LineRef`, `OperatorRef`, `datasetId` and `maxSize`.

**In YuTreno** the feeds server answers on those SIRI Lite paths with the same filters. With `--vat`, the operator identifier takes the form of the profile. The estimated timetable of R 2101 at 08:10, from `examples/feeds/siri/estimated-timetable.xml`:

```xml
<RecordedCalls>
  <RecordedCall>
    <StopPointRef>IT:ITF3:ScheduledStopPoint:yutreno:monte-clanio-2</StopPointRef>
    <VisitNumber>1</VisitNumber><Order>1</Order><StopPointName>Monte Clanio</StopPointName>
    <AimedDepartureTime>2026-11-05T08:05:00+01:00</AimedDepartureTime>
    <ActualDepartureTime>2026-11-05T08:05:01+01:00</ActualDepartureTime>
  </RecordedCall>
</RecordedCalls>
<EstimatedCalls>
  <EstimatedCall>
    <StopPointRef>IT:ITF3:ScheduledStopPoint:yutreno:san-felice-scalo-2</StopPointRef>
    <VisitNumber>1</VisitNumber><Order>2</Order><StopPointName>San Felice Scalo</StopPointName>
    <AimedArrivalTime>2026-11-05T08:09:20+01:00</AimedArrivalTime>
    <ExpectedArrivalTime>2026-11-05T08:08:26+01:00</ExpectedArrivalTime>
    <AimedDepartureTime>2026-11-05T08:11:00+01:00</AimedDepartureTime>
    <ExpectedDepartureTime>2026-11-05T08:11:00+01:00</ExpectedDepartureTime>
  </EstimatedCall>
  …
```

The example tells a small story:
- The train left Monte Clanio one second late.
- It reached San Felice Scalo 54 seconds early, at 08:08:26: the arrival is made but the stop is not yet left, so it stays an `EstimatedCall` with that time.
- It will not leave before its timetabled 08:11:00, because the crossing with R 2001 is planned there.

**Validation.** All VM and ET documents are checked against `xsd/siri.xsd` of the official repository: 48 of 48 are valid, including those of `services/cancellation`, with a cancelled call. The examples of the Italian profile validate against the same schema, because the profile has no XSD of its own.

## GTFS and GTFS-Realtime

**What it is.**
- **Origin:** GTFS was born in 2005 from the collaboration between TriMet (Portland) and Google for Google Transit. It was first called the Google Transit Feed Specification, then renamed General Transit Feed Specification.
- **Maintenance:** the specification lives on GitHub (`google/transit`) and is documented at gtfs.org. MobilityData leads its evolution, and changes are adopted by public votes among producers and consumers.
- **Format:** a ZIP of CSV files.
- **GTFS-Realtime:** it adds three kinds of entity in Protocol Buffers: TripUpdates, VehiclePositions and Alerts. It is defined by `gtfs-realtime.proto`, version 2.0.

**Model.** GTFS is a flattened Transmodel:
- `routes.txt` lists the lines;
- `trips.txt` lists the journeys;
- `stop_times.txt` gives the passing times;
- `stops.txt` lists stops, with stations (`location_type=1`) and platforms (`parent_station`);
- `calendar.txt` and `calendar_dates.txt` give the service days;
- `shapes.txt` gives the geometry.

Times count from "noon minus 12 hours" of the service day, so they can exceed 24:00 and they stay equal to the wall clock on the days of the change of time.

**In YuTreno**, from `examples/feeds/gtfs/stop_times.txt`:

```
trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled
IT:ITF3:ServiceJourney:yutreno:r-2001,08:00:00,08:00:00,IT:ITF3:Quay:yutreno:valle-lauro-1,1,0.0
IT:ITF3:ServiceJourney:yutreno:r-2001,08:04:20,08:04:50,IT:ITF3:Quay:yutreno:ponte-sabato-1,2,5050.0
```

The identifiers are those of NeTEx, so a consumer can go from a GTFS trip to the NeTEx journey and to SIRI without lookup tables. The trip update of R 2101 (`examples/feeds/gtfs-rt/trip-updates.json`, the decoded form of the protobuf) carries the same arrival 54 s early (`"delay": -54`) and the departure on time.

**Validation.**
- **Static feed:** the canonical validator of MobilityData (7.1.0) finds no errors in the feed. It gives two warnings, expected for a feed of one day: `feed_expiration_date7_days` and `trip_coverage_not_active_for_next7_days`.
- **Real-time feed:** the protobuf is decoded with the official bindings (`gtfs-realtime-bindings`) in `verify-feeds`.

## railML

**What it is.**
- **Origin and maintenance:** railML was born in 2002 as an initiative of German and Swiss railway research. It is maintained by railML.org e.V., an association of infrastructure managers, railway undertakings, industry and universities.
- **Content:** it is an XML language for exchanging railway data between applications: infrastructure, rolling stock, timetables and, from version 3, interlocking.
- **Versions in use:** two lines coexist.
  - **railML 2.x** is the one most timetabling tools exchange today; version 2.5 dates from 2021.
  - **railML 3.x** is the redesign on the RailTopoModel topology; 3.2 was released in April 2022 and 3.3 in November 2024.
- **Access:** the schemas are distributed under restricted Creative Commons licences (no derivatives) to registered users.

**Structure of a timetable.** The two versions think about the timetable differently:
- **railML 2:** a `trainPart` carries a list of `ocpTT` (timetable operational control points) with `times` and `stopDescription`. `train` elements group train parts under a train number, and `operatingPeriod` elements give the days as a bitmask.
- **railML 3:** it separates the route in space from the trains that use it. A `baseItinerary` is a sequence of `baseItineraryPoint`, each with `times` (commercial or operational scope), a `stop` (with `minDwellTime`) or a `pass`. An `itinerary` takes ranges of base itineraries, possibly shifted in time. An `operationalTrain` refers to an itinerary and a `validity` (bitmask) and carries its `OperationalTrainNumber`.

One base itinerary can serve a whole clock-face timetable through offsets: this is the clearest difference from the passenger standards, which list every journey.

**In YuTreno**, from `examples/feeds/railml/timetable.xml`:

```xml
<baseItinerary id="bi-r-2101">
  <baseItineraryPoint id="bip-r-2101-2" locationRef="op-san-felice-scalo">
    <times scope="commercial"><arrival time="08:09:20"/><departure time="08:11:00"/></times>
    <stop minDwellTime="PT20S"/>
  </baseItineraryPoint>
  …
<operationalTrain id="ot-r-2101">
  <operationalTrainVariant id="otv-r-2101" itineraryRef="it-r-2101" validityRef="va-1">
    <identifiers><identifier number="R 2101" type="OperationalTrainNumber"/></identifiers>
```

railML is the only one of the three formats that carries the **minimum dwell time**, which YuTreno uses to decide when a service may leave. That is why the round trip through railML gives back the services with their dwells too.

**Status.** The railML export follows the railML 3.2 data model as published on the railML wiki. It has **not been validated against the XSD**, which could not be downloaded from the environment where it was written. `scripts/feeds-validate.ts --railml <folder with railml3.xsd>` validates it as soon as the schema is available.

## When the plan changes: cancellations and new times

A regulator ([REGULATOR.md](REGULATOR.md)) can move times, skip stops and cancel trains during a run. The standards agree on one principle: the published timetable stays the plan, and the changes are real-time information.

| Change | GTFS-Realtime | SIRI-ET | Static timetables |
| :-- | :-- | :-- | :-- |
| new time | `StopTimeUpdate` with the expected time; `delay` against the plan | `Expected…Time` next to the unchanged `Aimed…Time` | unchanged |
| stop skipped, or removed because the train now ends earlier | `StopTimeUpdate.schedule_relationship = SKIPPED`, no times | `EstimatedCall` with `<Cancellation>true</Cancellation>` and the aimed times | unchanged |
| train cancelled entirely | `TripDescriptor.schedule_relationship = CANCELED`, no stop time updates | `EstimatedVehicleJourney` with `<Cancellation>true</Cancellation>`, every call cancelled | unchanged |
| train that ends early | the station where it ends is its last stop with times | that station is a `RecordedCall` | unchanged |

The places of the elements follow the schema: in SIRI the cancellation of a journey comes right after `FramedVehicleJourneyRef` (the `EstimatedTimetableAlterationGroup`), the one of a call right after `StopPointName`. `verify-feeds` checks the four cases with a scripted regulator. Two things are not published yet: the reason of a change (SIRI-SX situations, GTFS-Realtime Alerts) and changes of platform.

**Connections and vehicles.** The network phase of the plan adds connections between trains and the same train continuing as another service. The standards already have the place for them:
- in NeTEx, `ServiceJourneyInterchange`, which in the EPIP profile carries `StaySeated`, `CrossBorder` and `StandardTransferTime`; the full NeTEx adds `Guaranteed` and `MaximumWaitTime`;
- in SIRI-ET, the monitored interchange with `Guaranteed`, `MaximumWaitTime`, `WillWait` and `ConnectionMonitoring`;
- in GTFS, `transfers.txt` for connections and `block_id` for trips run by the same vehicle;
- in railML 3, `vehicleRostering` with `block` and `blockConnection` for the circulation of the rolling stock.

## The same journey in five formats

| Concept | Transmodel | NeTEx | SIRI | GTFS / GTFS-RT | railML 3 | railML 2 | YuTreno |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| a train | service journey | `ServiceJourney` | `DatedVehicleJourneyRef` | trip, `trip_id` | `operationalTrain` | `trainPart` / `train` | service, `ServiceDef` |
| its number | train number | `TrainNumber/ForAdvertisement` | `VehicleJourneyName` | `trip_short_name` | `identifier` `OperationalTrainNumber` | `trainNumber` | `id` |
| a station | stop place | `StopPlace` | — | `stop` with `location_type=1` | `operationalPoint` | `ocp` | station of the line |
| where it stops | scheduled stop point, quay | `ScheduledStopPoint`, `Quay` | `StopPointRef` | `stop_id` (platform) | `locationRef` | `ocpRef` | station and direction |
| the order of stops | journey pattern | `ServiceJourneyPattern` | `JourneyPatternRef`, `Order` | `stop_sequence` | `baseItinerary` | `sequence` | order of `stops` |
| a time | passing time | `TimetabledPassingTime` | `Aimed…Time` | `stop_times.txt` | `times/arrival`, `departure` | `times@arrival` | `arrival_s`, `departure_s` |
| after midnight | day offset | `DayOffset` | full date-time | hours beyond 24 | `dayOffset` | `arrivalDay` | seconds beyond 86400 |
| the days | day type, operating period | `DayTypeAssignment` | `DataFrameRef` | `calendar*.txt` | `validity/bitmaskValidity` | `operatingPeriod@bitMask` | service day |
| minimum dwell | — | — | — | — | `stop@minDwellTime` | `stopDescription` | `min_dwell_s` |
| what happened | recorded call | — | `Actual…Time`, `RecordedCall` | `StopTimeUpdate` | — | — | `realised` |

## Validation tools

| Format | Tool | How YuTreno uses it | Result |
| :-- | :-- | :-- | :-- |
| NeTEx | XSD of the Italian profile (5T) with `xmllint` | `scripts/feeds-validate.ts --netex` | 24/24 valid |
| SIRI | official XSD (`siri.xsd`, release 2.3) with `xmllint` | `scripts/feeds-validate.ts --siri` | 48/48 valid |
| GTFS | MobilityData validator 7.1.0 | `scripts/feeds-validate.ts --gtfs-validator` | 0 errors, 2 expected warnings |
| GTFS-RT | `gtfs-realtime-bindings` | `verify-feeds` | decoded and compared with the source |
| railML 3.2 | XSD from railML.org (registration) | `scripts/feeds-validate.ts --railml` | not yet run |
| all | export → import round trip | `verify-imports` | identical services |

## Where YuTreno differs from the Italian profiles

The feeds are close to the profiles but not identical, for reasons that are mostly in the nature of a simulator:
- **Operator:** the operator has no VAT number unless `--vat` is given. Without it, the identifier keeps the general form of the profile.
- **Push flows:** YuTreno serves SIRI Lite on request; it does not push data to a subscriber. So the fields of the RAP-to-NAP push (`SubscriberRef`, `SubscriptionRef`, `ResponseMessageIdentifier`, `ItemIdentifier`) are absent, and there is no `/siri/subscribe`.
- **Missing flows and fields:** there are no SX, FM or PT flows, and no `Occupancy`, `VehicleStatus` or `ConfidenceLevel`. The simulation has no disruptions announced to passengers and no load yet. The ET of the Italian profile can carry boarding and alighting counts (`RecordedDepartureOccupancy`), which the passenger phase of the plan could fill.
- **Display text:** `PublishedLineName` is the name of the line, because a simulated line has no public code.

## Sources

**Regulation**
- [Directive 2010/40/EU and Delegated Regulation (EU) 2017/1926, consolidated text](https://eur-lex.europa.eu/eli/reg_del/2017/1926/2024-03-04) (EUR-Lex)
- [Multimodal travel information: the revision 2024/490](https://transport.ec.europa.eu/transport-themes/smart-mobility/road/its-directive-and-action-plan/multimodal-travel-information_en) (European Commission)
- [The EU legal context of Transmodel, NeTEx and SIRI](https://transmodel-cen.eu/index.php/legal-context/) (transmodel-cen.eu)
- [DG MOVE, the revised MMTIS regulation](https://www.ttsitalia.it/wp-content/uploads/2024/11/Petra-Soderqvist_DG_MOVE.pdf), TTS Italia, November 2024
- [Implementing Regulation (EU) 2026/253, TSI Telematics](https://eur-lex.europa.eu/eli/reg_impl/2026/253/oj) (EUR-Lex); [summary in Italian](https://www.certifico.com/trasporto/trasporto-ferroviario/regolamento-di-esecuzione-ue-2026-253)

**Italy**
- [National Access Point for multimodal travel information](https://www.cciss.it/nap/mmtis/public/en/static/multimodal) (CCISS, Ministry of Infrastructure and Transport)
- [Italian NeTEx profile](https://netex-cen.eu/?p=710) (netex-cen.eu) and [repository with XSD, guidelines and RAP interface](https://github.com/5Tsrl/netex-italian-profile) (5T)
- [Italian SIRI profile: guidelines, examples, dynamic RAP interface](https://github.com/5Tsrl/siri-italian-profile) (5T)
- [5T, the Italian NeTEx and SIRI profiles and the RAP](https://www.ttsitalia.it/wp-content/uploads/2024/11/Fabrizio-Arneodo_5T.pdf), TTS Italia, November 2024

**Transmodel, NeTEx, SIRI**
- [NeTEx schema](https://github.com/NeTEx-CEN/NeTEx), [SIRI releases](https://github.com/TransmodelEcosystem/SIRI/releases) (TransmodelEcosystem) and [SIRI schema of CEN](https://github.com/SIRI-CEN/SIRI)
- [PTI, European standards update, June 2026](https://pti.org.uk/system/files/meeting_files/papers/20260604%20European%20update.pdf)

**GTFS**
- [GTFS-Realtime reference](https://github.com/google/transit/blob/master/gtfs-realtime/spec/en/reference.md) and [gtfs-realtime.proto](https://www.github.com/MobilityData/gtfs-realtime-bindings/blob/master/gtfs-realtime.proto)
- [Pioneering open data standards: the GTFS story](https://beyondtransparency.org/part-2/pioneering-open-data-standards-the-gtfs-story/)
- [MobilityData GTFS validator](https://github.com/MobilityData/gtfs-validator)
- [Block transfers: trips run by the same vehicle](https://developers.google.com/transit/gtfs/examples/block-transfer-example) (Google Transit)

**railML**
- [Guide on modelling rolling stock circulations in railML 3](https://wiki3.railml.org/wiki/Dev:Guide_on_modelling_of_rollingstock_circulations_in_railML_3)
- [railML version timeline](https://railML.org/en/version-timeline.html)
- [railML 3.2 timetable data model](https://wiki3.railml.org/DataModel/3.2/TT/EARoot/EA77.htm)
- railML 3 wiki pages for [operationalTrain](https://wiki3.railml.org/wiki/TT:operationalTrain), [itinerary](https://wiki3.railml.org/wiki/TT:itinerary), [baseItineraryPoint](https://wiki3.railml.org/wiki/TT:baseItineraryPoint), [bitmaskValidity](https://wiki3.railml.org/wiki/Generic:bitmaskValidity) and [operationalPoint](https://wiki3.railml.org/wiki/IS:operationalPoint)
