# Import of the real infrastructure

*Italian version: [it/IMPORTAZIONE_INFRA.md](it/IMPORTAZIONE_INFRA.md)*

YuTreno can build a line from the data of a real railway: OpenStreetMap (with the OpenRailwayMap tagging) for the geometry and the details, and RINF, the register of infrastructure of the European Union Agency for Railways (ERA), for the official values of the sections of line. The result is an ordinary line in the JSON format of YuTreno (`LineDef`), usable in a scenario or in a network, plus an **import report**. The report tells where every datum comes from, how much of the line is real and how much YuTreno reconstructed, and which licences apply.

The import lives in `src/infra/`. Like the core and the feeds, it depends neither on the DOM nor on Node, and the result depends only on the content of the sources, not on the order of their elements.

```
npm run import-infra -- --osm extract.json [--rinf rinf.json] --from "<station>" --to "<station>" \
  [--id <id>] [--name <name>] [--output line.json] [--report report.md | report.json]
```

For a step-by-step guide, by hand or with one command (`npm run line-from-sources`), see [LINE_TUTORIAL.md](LINE_TUTORIAL.md). The queries are in `src/infra/queries.ts`.

`examples/infra/` holds two worked examples:
- **Borgo Alto – Ripa Bassa**, an invented line on **synthetic** sources, written with the OSM tagging, the RINF columns and the answers of a DEM service. Its data are not real. `scripts/infra-fixture.ts` writes the sources, and `verify-infra` checks the import against the chainages they were built from.
- **Avellino – Benevento** (`examples/infra/avellino-benevento/`), the first real line: an Overpass extract of 6 November 2026 and the EU-DEM altitudes every 100 m, with the imported line, its report and its railML. It is regenerated with
  `npm run import-infra -- --osm examples/infra/avellino-benevento/overpass.json --elevation examples/infra/avellino-benevento/eudem25m.json --from Avellino --to Benevento --output examples/infra/avellino-benevento/line.json --report examples/infra/avellino-benevento/report.md --railml-out examples/infra/avellino-benevento/railml.xml`.
  The line is in OpenStreetMap but not in RINF.
- **Cancello – Benevento** (`examples/infra/cancello-benevento/`), a real line that is also in RINF: Overpass extract and RINF result of 6 November 2026, EU-DEM altitudes. It is regenerated with
  `npm run import-infra -- --osm examples/infra/cancello-benevento/overpass.json --rinf examples/infra/cancello-benevento/rinf.json --elevation examples/infra/cancello-benevento/eudem25m.json --from Cancello --to Benevento --output examples/infra/cancello-benevento/line.json --report examples/infra/cancello-benevento/report.md --railml-out examples/infra/cancello-benevento/railml.xml`.
  The two lines form the network of `scenarios/services/benevento.json` ([SCENARIOS.md](SCENARIOS.md)).
  The two sources agree within 1 % on ten stretches out of eleven. On the eleventh, Benevento Rione Libertà – Benevento Appia, RINF registers 955 km for a section that OpenStreetMap measures 944 m long: the length was evidently entered in metres where kilometres were expected. The report flags it, and the import does not use RINF lengths for the positions of the stations.
- **Salerno – Mercato San Severino** (`examples/infra/salerno-mercato-s-severino/`), a real line with real trains: Overpass extract, RINF result and EU-DEM altitudes of 6 November 2026, and the 21 daily Trenitalia trips from the NeTEx of the Campania region on the National Access Point (`timetable.json`). It is regenerated with
  `npm run import-infra -- --osm examples/infra/salerno-mercato-s-severino/overpass.json --rinf examples/infra/salerno-mercato-s-severino/rinf.json --elevation examples/infra/salerno-mercato-s-severino/eudem25m.json --from Salerno --to "Mercato San Severino" --id salerno-mercato-s-severino --output examples/infra/salerno-mercato-s-severino/line.json --report examples/infra/salerno-mercato-s-severino/report.md --railml-out examples/infra/salerno-mercato-s-severino/railml.xml`.
  OpenStreetMap and RINF agree within 1.2 % on every stretch. It is the first line checked against the timetable its trains run: no stretch of the eleven trips towards Mercato San Severino is faster than the simulated train; 63 of the 80 stretches are within the upper bound, the others have margins of several minutes. In the tunnel after Salerno OpenStreetMap gives 30 km/h and RINF 60 km/h: with the lower of the two one trip was faster than the train could run, so the timetable shows that RINF is right, and since 7 November RINF is kept where it covers the line (see the declared priority). The gradients come from the RINF profile, and the climb of every stretch agrees with the DEM within 4 m.

## The sources

| Source | What YuTreno takes | Licence |
| :-- | :-- | :-- |
| OpenStreetMap (Overpass extract) | path of the running tracks, stations and stop positions, `maxspeed`, tunnels, bridges, electrification, protection systems, gauge, main signals, `ele` altitudes | Open Database License 1.0: attribution, and share-alike for derived databases, which include the imported line |
| RINF (SPARQL query of the ERA knowledge graph) | sections of line between operational points: length, maximum speed, ETCS level, national protection system, contact line system, mean gradient where the query provides it | ERA terms of use of the RINF data |

The imported line carries the attribution of its sources in the field `attribution`. A line imported from OSM is a derived database under the ODbL: whoever publishes it must publish it under the same licence and keep the attribution.

### OpenStreetMap: the Overpass query

Run it on an Overpass instance (for example `https://overpass-api.de/api/interpreter`), with a bounding box (south, west, north, east) that contains the whole line, and save the JSON output.

```
[out:json][timeout:180];
(
  way["railway"~"^(rail|narrow_gauge)$"]({{bbox}});
  node["railway"~"^(station|halt|stop|signal)$"]({{bbox}});
  node["public_transport"~"^(station|stop_position)$"]["train"="yes"]({{bbox}});
);
out body;
>;
out skel qt;
```

The ways tagged `railway=rail` or `narrow_gauge` form a graph on their nodes. Ways with `service=siding|yard|spur|crossover` are left out, unless `--service-tracks` is given. The terminal stations are found by name with accents and case ignored. The line is the shortest path that a train can run between them: at every node the path turns by at most 45°, so it cannot reverse through the points of a station (without this rule the path from Cancello zigzagged through the station tracks), and it may start from any track node within 300 m of the first station, each start costing three times its distance from the station, and end at the first track node within 150 m of the last. Where the mapped track continues, the path is extended up to 400 m beyond each terminal along the straightest continuation. Where it does not, YuTreno adds straight track so that the line starts 150 m before the first stop marker and ends 300 m after the last, as the built-in lines do. The added track is reported as generated.

A station is any `railway=station|halt` node, or `public_transport=station` with `train=yes`, within 300 m of the path. Its stop marker is the `railway=stop` node of the same name on the track (provenance *source*), or else the projection of the station node on the path (*derived*).

Every way of the path gives its tags to its stretch of line:
- `maxspeed`, or `maxspeed:forward` / `maxspeed:backward` according to the direction in which the line runs along the way;
- `tunnel` (except `culvert`) and `bridge`;
- `electrified` with `voltage` and `frequency`;
- `railway:etcs`, `railway:scmt`, `railway:ssc`, `railway:bacc` and the other national systems;
- `gauge`.

### RINF: the SPARQL query

The query runs on the ERA knowledge graph, at **https://graph.data.era.europa.eu/** (GraphDB, repository `rinf-plus`). First find the national line of a station:

```sparql
PREFIX era: <http://data.europa.eu/949/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT DISTINCT ?line ?a ?b WHERE {
  ?op a era:OperationalPoint ; era:opName ?n . FILTER (CONTAINS(LCASE(STR(?n)), "benevento"))
  { ?sol era:opStart ?op } UNION { ?sol era:opEnd ?op }
  ?sol era:opStart/era:opName ?a ; era:opEnd/era:opName ?b ; era:nationalLine/rdfs:label ?line .
}
```

Then the sections of that line, one row per track of a section. The columns are YuTreno's own names, which `src/infra/rinf.ts` reads:

```sparql
PREFIX era: <http://data.europa.eu/949/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
SELECT ?sol ?opStart ?opEnd ?opStartName ?opEndName ?length ?maxSpeed ?etcsLevel ?protection ?contactLine ?lineId WHERE {
  ?sol a era:SectionOfLine ; era:opStart ?opStart ; era:opEnd ?opEnd ; era:nationalLine ?nl .
  ?nl rdfs:label ?lineLabel . BIND (STR(?lineLabel) AS ?lineId) FILTER (?lineId = "CANCELLO-BENEVENTO")
  ?opStart era:opName ?opStartName . ?opEnd era:opName ?opEndName .
  OPTIONAL { ?sol era:lengthOfSectionOfLine ?km } BIND (?km * 1000 AS ?length)
  OPTIONAL { ?sol era:hasPart ?track . ?track a era:RunningTrack .
    OPTIONAL { ?track era:maximumPermittedSpeed ?maxSpeed }
    OPTIONAL { ?track era:etcs/era:etcsLevelType/skos:prefLabel ?etcsLevel }
    OPTIONAL { ?track era:protectionLegacySystem/skos:prefLabel ?protection }
    OPTIONAL { ?track era:contactLineSystem/era:energySupplySystem/skos:prefLabel ?contactLine } }
}
```

Save the result as SPARQL JSON (`application/sparql-results+json`). The graph gives the length of a section in kilometres, so the query multiplies it. The query also reads the gradient profile of the tracks (`era:gradientProfile`, for example `+3.5(46.463)`: 3.5 ‰ from kilometre 46.463 of the line onwards) and the kilometre of the two operational points (`era:netReference/era:hasLrsCoordinate`, for example `C148 | 9+456`); an optional `gradient` column (‰, positive from `opStart` to `opEnd`) is read when there is no profile.

The query was checked on 6 November 2026 on the line Cancello – Benevento. Not every line is in RINF: Avellino – Benevento, for example, is not, and for such a line the import uses OpenStreetMap alone.

The sections are laid on the line between its stations. An operational point is matched to a station by any of its names (Benevento is both `BENEVENTO` and `BENEVENTO CENTRALE`); where no name is equal, a shortened RINF name matches a whole part of the OSM name between hyphens, a one-letter word standing for any word with that initial and spaces allowed to be missing (`S.MARIA A VICO` for Santa Maria a Vico, `TUFARA VALLE` for Tufara Valle - Arpaise - Ceppaloni, `BENEVENTO PONTE CORVO` for Benevento Pontecorvo - Castelpoto). Between two consecutive stations, YuTreno takes the shortest chain of sections through operational points that are not stations of the line, such as junctions and block posts. A chain of several sections is laid proportionally to their RINF lengths (provenance *derived*); a single section is laid as it is (*source*). Several tracks of the same section give the highest maximum speed.

### Gradients from the RINF profile

The changes of gradient of RINF are at kilometres of the national line, not at chainages of the imported line. The stations are the bridge: each has its kilometre on the line (the label of the operational point for the `lineId` of the section), and between two stations a kilometre becomes a chainage linearly. The direction of the kilometres comes from the first and the last station, so a line whose kilometres decrease from its first station gets the signs turned. A station whose kilometre disagrees with both neighbours (a station shared by several lines can carry the kilometre of another one, as Salerno does) is left out with a warning; beyond the last station the kilometres follow the chainage. A gradient holds from its kilometre to the next change towards the increasing kilometres, across the stations and the sections, because the profile of a track does not stop at the end of a section; the changes of all the tracks of the line form one profile. A change whose kilometre falls outside the line is a data error and is left out with a warning (on Cancello – Benevento, one at km 132.411 on a line of 49 km). Before the first change of the profile the line has no RINF gradient and takes the next source.

Where the DEM is also given, the report compares, stretch by stretch, the climb with the RINF gradients against the climb of the ground (`gradient_check`), and warns when they differ by more than 15 m. On Salerno – Mercato San Severino they agree within 4 m on every stretch. On Cancello – Benevento the stretches differ by up to 12 m and the whole line by about 34 m: either the profile of RINF is incomplete or the ground follows the line less closely there (cuttings, viaducts), and the report shows where.

### Altitudes: a digital elevation model

Where neither RINF nor OpenStreetMap give gradients, they come from a digital elevation model. `--elevation-points points.json` writes the points of the line every 100 m; their altitudes, asked for example to OpenTopoData with the EU-DEM 25 m dataset (`https://api.opentopodata.org/v1/eudem25m?locations=lat,lon|lat,lon|…`, up to 100 points per request), come back with `--elevation dem.json`. The file can be the answers of OpenTopoData or a list of `{lat, lon, elevation}`.

A DEM gives the altitude of the ground: on a bridge it is the valley below and over a tunnel the hill above. The points within tunnels and bridges, with 30 m around their ends, are therefore left out and the track is taken as straight between the ends. Cuttings and embankments are rarely tagged, so the rest goes through a running median over 1 km, which removes the hills the track cuts through and the valleys it crosses on an embankment, and a moving average over 1 km, because a railway does not follow the undulations of the ground; then it is and reduced to the changes of gradient that move the altitude by more than 0.5 m. The gradients are *derived*, from the source `dem`; the attribution of the Copernicus data goes in the line and in the report.

## The declared priority

| Property | Rule |
| :-- | :-- |
| Alignment, stations, tunnels, mapped signals | OpenStreetMap |
| Speed | RINF where it covers the line, the official register of the infrastructure manager; OSM elsewhere. Where the two differ, the report lists the stretch among the speed conflicts with the source kept: an OSM limit above RINF, and an OSM limit below RINF, set aside (owner's decision of 7 November 2026, after the tunnel of Salerno). `--speed-policy lower` keeps the lower of the two instead, as before. Where neither gives one, 80 km/h (`--default-speed`), generated |
| Gradient | RINF (the profile placed by the station kilometres, or the mean gradient of a section); elsewhere the DEM (derived); elsewhere the slope between the `ele` altitudes of the OSM nodes and stations (derived); elsewhere level (generated) |
| Protection system and electrification | RINF; elsewhere OSM |
| Block length | median spacing of the mapped main signals between 400 m and 4 km (derived), with at least two such gaps; else 1300 m (`--block`, generated). The signals of the simulation are generated with that length by the rules of today: real signal positions are counted in the report but not placed |
| Timetable of the stations | generated: running time at the speed limits divided by 0.9 plus 60 s, rounded up to 10 s, dwell 30 s. A real timetable comes from `npm run import` (GTFS, NeTEx, railML) |

The plan of the line is the OSM path in a local plane: x east and y north from the first point, with the formula the open data feeds use to go back to WGS84. A station of the imported line is therefore published in GTFS, NeTEx and SIRI at the coordinates of the sources (within 3 m in `verify-infra`). The path is simplified (Douglas–Peucker, 1 m, vertices at least 15 m apart), so that the spline of the plan has no noise from densely mapped stretches, and then resampled every 25 m: the spline is a uniform Catmull-Rom, which makes small loops where a short segment follows a long one (on Avellino – Benevento they gave curves of 22 m radius). All chainages are then scaled to the length of the compiled line.

## The report

`--report report.md` writes the report for people, `--report report.json` the same content as data (`InfraReport`, format `yutreno-infra-report` version 1). It contains:
- the sources with their licences, attributions, number of elements and date of the extract;
- **how much of the line is real**: for every property, the metres of line taken from a source, derived and generated; for the stations, how many;
- the stations with the OSM element of their position;
- the speed stretches with provenance and source elements, and the speed conflicts with the source kept;
- the climb of every stretch with the RINF gradients against the DEM, where both are given;
- the **consistency** of the two sources: for every pair of consecutive stations, the RINF length of the sections against the OSM chainage. A difference above 5 % becomes a warning;
- protection systems and electrification, with the suggested signalling of the scenario (ETCS if ETCS level 2 or 3 covers at least 95 % of the line, otherwise automatic block);
- the warnings: stubs added, stations far from the track, minimum radius below 150 m, gradients above 35 ‰, sections without a match, station kilometres and changes of gradient left out.

## railML 3.2

`--railml-out infra.xml` also writes the infrastructure of the imported line in railML 3.2, and `npm run import-infra -- --railml infra.xml --output line.json` reads one back (`src/infra/railml.ts`). Any YuTreno line can be exported, the built-in ones included. The document has:
- one `netElement` for the whole line, with a linear positioning system in metres;
- the vertices of the plan as `geometryPoint`s, with WGS84 longitude, latitude and altitude for a georeferenced line, or a local plane in metres otherwise;
- the stations as `operationalPoint`s;
- the speed limits as `speedSection`s of the basic static speed profile;
- the gradients as constant `gradientCurve`s;
- the tunnels as `overCrossing`s of type tunnel.

Every location has both the intrinsic coordinate (0 to 1) and the linear coordinate in metres. Name, georeferencing, plan, profile, stations, speed limits and tunnels survive the round trip within 5 cm. The timetable of the stations, the block length and the leading freight train are not infrastructure: on import they get defaults, and a railML timetable is imported with `npm run import`. The provenance of the data stays in the import report, because railML has no place for it. Like the timetable export, the structure follows the railML 3.2 data model on the railML wiki and has not been validated against the XSD, which railML.org distributes to registered users.

## Plausibility against a real timetable

`npm run plausibility -- --line line.json --scenario scenario.json [--service <id>]` compares, stretch by stretch, the running time of a timetable with the one simulated on the line (`src/server/plausibility.ts`). The timetable is a service of a scenario, for example one imported with `npm run import` from GTFS or NeTEx; without `--scenario` it is the timetable of the stations of the line. The service must run in the direction of the line.

The simulated train is the controlled train with `examples/ato.js`, stopping at every stop of the timetable and always late, so it never waits nor coasts to keep time; the leading freight train is switched off. A timetable is not expected to match the simulation, because it contains running time supplements and recovery margins. It is **plausible** when, on every stretch,

  0.98 × simulated ≤ timetable ≤ 1.35 × simulated + 120 s.

The lower bound says that a timetable cannot be faster than the train can run, with 2 % for the model; the upper bound leaves room for supplements, recovery margins and the time to start and stop. The bounds are YuTreno's own and can be changed with `--lower`, `--upper` and `--slack`. A stretch outside them points to an error in the import (a missing speed restriction, a station in the wrong place) or to a timetable that includes something else, such as a crossing or a long stop.

## Checks

`verify-infra` runs on the synthetic sources:
- **INF1**: length of the line and georeferencing back to the coordinates of the sources;
- **INF2**: stations and stop positions, siding and branch left out, stub after the last station;
- **INF3**: speed with the declared priority (RINF over a lower OSM limit, the lower with `speedPolicy: 'lower'`), tunnel, block length from the signals, gradient from the altitudes and from RINF, provenance shares that add up to the length;
- **INF4**: RINF laid through a block post, consistency of the lengths, the import without RINF, licences in the report;
- **INF5**: determinism and independence from the order of the elements; `examples/infra/` up to date;
- **INF6**: the imported line runs with `examples/ato.js` with automatic block and with ETCS, without interventions and with accurate stops;
- **INF7**: railML 3.2 export and import give back the imported line and every built-in line, and a second round trip gives the same document;
- **INF8**: the generated timetable of the imported line is plausible; one 30 % faster and one three times slower are not;
- **INF9**: gradients from a DEM: the altitudes of the stations within 3 m, the hill over the tunnel left out, RINF before the DEM;
- **INF10**: Avellino – Benevento from `examples/infra/avellino-benevento/`: the committed line is up to date, ten stations, length, radii and gradients plausible, and the line runs with `examples/ato.js`;
- **INF11**: Cancello – Benevento from `examples/infra/cancello-benevento/`: the committed line is up to date, every pair of stations matched to RINF (abbreviated names included), the two sources within 1.5 % except the RINF error above, which is reported, speeds from RINF, and the line runs with `examples/ato.js`;
- **INF13**: Salerno – Mercato San Severino from `examples/infra/salerno-mercato-s-severino/`: the committed line is up to date, OSM and RINF within 1.5 % on every stretch, and the trips of the real timetable in the direction of the line, compared with `plausibility`, never faster than the simulated train, RINF 60 km/h kept in the tunnel with the 30 km/h of OSM reported, and the RINF gradients within 6 m of the DEM on every stretch;
- **INF14**: the RINF gradient profile on the synthetic line, with kilometres decreasing along it: the signs turned, a gradient holding up to the next change across the stations, a station kilometre of another line and a change outside the line left out with warnings.

## Limits and next steps

- The development environment cannot reach Overpass, OpenStreetMap, Geofabrik or the ERA endpoints: the extracts come from the owner's browser.
- On Avellino – Benevento the speeds, the stations and the protection (SSC, SCMT) come from OpenStreetMap and the gradients from the DEM; there are no tagged signals beyond six, so the block sections are generated, and the timetable of the stations is generated. No real timetable has been imported for it yet, so its plausibility is still to be checked.
- One line between two stations. A network is made of several imported lines, joined by the station names as usual.
- Single path of running tracks: no station tracks, points or real signal positions in the simulation.
- No real timetable of trains exists for the two lines in November 2026: in the NeTEx of the Italian access point (CCISS) Trenitalia serves Avellino – Benevento with buses (stops `busTRENITALIA`), and EAV publishes no trips on Napoli – Benevento, neither in NeTEx nor in GTFS. Still to do in phase 5: the plausibility against a real timetable, on a line that has one; reading `era:gradientProfile`; several imported lines as a network.

## Sources

- OpenStreetMap wiki, [OpenRailwayMap tagging](https://wiki.openstreetmap.org/wiki/OpenRailwayMap/Tagging) and [tagging in Italy](https://wiki.openstreetmap.org/wiki/OpenRailwayMap/Tagging_in_Italy); [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API); [copyright and licence](https://www.openstreetmap.org/copyright)
- ERA, [RINF](https://www.era.europa.eu/domains/registers/rinf_en); [terms of use](https://www.era.europa.eu/system/files/2022-11/rinf_terms_of_use_en.pdf); [ERA vocabulary](https://github.com/Interoperable-data/ERA_vocabulary); [example SPARQL queries of the ERA](https://www.era.europa.eu/system/files/2024-03/tentqueries.sparqlbook.txt)
- OpenTopoData, [EU-DEM dataset](https://www.opentopodata.org/datasets/eudem/); Copernicus Land Monitoring Service, EU-DEM v1.1
- D. H. Douglas, T. K. Peucker, *Algorithms for the reduction of the number of points required to represent a digitized line or its caricature*, The Canadian Cartographer 10(2), 1973
