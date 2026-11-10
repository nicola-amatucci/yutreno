# Tutorial: a real line from scratch

*Italian version: [it/TUTORIAL_LINEA.md](it/TUTORIAL_LINEA.md)*

This tutorial takes a real railway line from the public data sources to a line that YuTreno can run: the cab, the headless runs, the scenarios, a network with other lines. It covers both routes:
- **automatic**: one command downloads everything and imports it (step 2);
- **manual**: every source downloaded by hand, then imported (step 3). Use it when a server refuses automated requests, when you want to look at the data before importing, or to understand what the script does.

The reference of the import, with its rules and its report, is [INFRA_IMPORT.md](INFRA_IMPORT.md). The worked examples are in `examples/infra/`: Cancello – Benevento (OpenStreetMap, RINF and altitudes) and Avellino – Benevento (no RINF).

## What you need

- Node.js 20 or later and the repository with `npm install` done.
- Internet access to three public services, all free and without an account:

| Source | What it gives | Service | Licence |
| :-- | :-- | :-- | :-- |
| OpenStreetMap | track geometry, stations, speeds, tunnels, electrification, protection, signals | Overpass API (`overpass-api.de` and mirrors) | ODbL 1.0 |
| RINF, register of infrastructure of the ERA | official sections of line: lengths, maximum speeds, protection, contact line | ERA knowledge graph, `graph.data.era.europa.eu`, repository `rinf-plus` | ERA terms of use |
| EU-DEM 25 m | altitudes of the ground, for the gradients | OpenTopoData, `api.opentopodata.org` (1 request per second, 1000 per day) | Copernicus, free with attribution |

- Optionally, a real timetable of the line, to check the running times (step 6): the Italian national access point, **CCISS NAP** (`www.cciss.it/nap/mmtis/public/catalog/Dataset`), publishes NeTEx of Trenitalia, Italo and every region, downloadable without login.

## Italian lines: the National Access Point

For lines in Italy the timetables, and the stops with their positions, come from the **Italian National Access Point** for multimodal travel information (NAP, EU Regulation 2017/1926), run by the Ministry of Infrastructure and Transport through the CCISS:

- **Catalogue**: [www.cciss.it/nap/mmtis/public/catalog/Dataset](https://www.cciss.it/nap/mmtis/public/catalog/Dataset). Search by operator or region (`?query=campania`, `?query=trenitalia`). No login is needed to download.
- **What it has for railways** (November 2026): *OAP Trenitalia – NeTEx Livello 1*, the whole national timetable of Trenitalia (an `.xml.gz` of about 440 MB uncompressed); *OAP Italo* (NeTEx levels 1 and 2); and for every region a *RAP <region>* dataset with one NeTEx file per operator, for example in Campania `IT-ITF3-TRENITALIA`, `IT-ITF3-EAV_FERRO`, `IT-ITF3-EAV_GOMMA`. The data follow the Italian profile of NeTEx (levels 1 to 4).
- **Downloading**: on the page of a dataset, every file has *Ultima risorsa importata → Download* (the file as published) and *Ultima risorsa validata → Download* (the file after the validation of the NAP). The links have the form `https://www.cciss.it/nap/mmtis/public/api/v1/download/blob/Asset/<number>/resource`.
- **What to look for**: the stop places of the line by name (`<StopPlace>` with `<Name>`, in capitals in the files of Trenitalia), then the journeys that call at them. Check the mode: a stop place of type `bus…` (for example `busTRENITALIA`) means that the operator serves the line with buses, whose times are not those of a train.

The older catalogue of the Ministry at [nap.mit.gov.it](https://nap.mit.gov.it/api) has a CKAN interface (`/catalog/api/3/action/package_search?q=…`), but in November 2026 it listed only 26 datasets, mostly of 2022 (Trenitalia for Sardinia and Tuscany, Ferrotramviaria in Apulia).

The NAP gives timetables, not infrastructure: the track, speeds and gradients still come from OpenStreetMap, RINF and the DEM.

## 1. Choose the line and its two terminal stations

A line goes from one station to another along the running tracks. Look it up on [OpenRailwayMap](https://www.openrailwaymap.org) or on openstreetmap.org and write down:
- the **names of the two terminal stations exactly as in OpenStreetMap** (click the station: tag `name`). Accents and case do not matter, the words do: `Benevento`, not `Benevento Centrale`, if that is the mapped name;
- roughly where the line runs, if it is long or curved: the script computes a bounding box from the two stations with a margin, which may cut a line that makes a wide detour. In that case give the box yourself (south, west, north, east in degrees), for example with [bboxfinder.com](http://bboxfinder.com).

A single-track line between two stations, 20–60 km long, is the best first case.

## 2. The automatic route

```bash
npm run line-from-sources -- --from "Cancello" --to "Benevento" --out lines/cancello-benevento
```

The script (`src/server/line-from-sources.ts`) does the four steps of the manual route in order and prints what it does:
1. **Overpass**: finds the two stations, builds the bounding box with a margin and downloads the railway in it. It tries the public servers in turn and retries with growing waits; an empty answer, which a busy or broken server can give, counts as a failure. → `overpass.json`
2. **RINF**: looks for the national line that has both terminal stations (also under the shortened RINF names, such as `S.MARIA A VICO`) and downloads its sections. If no line has both, it says so and goes on without RINF. → `rinf.json`
3. **EU-DEM**: imports the line once without altitudes, takes a point every 100 m and asks OpenTopoData for their altitudes, 100 points per request, one request per second. → `dem.json`
4. **Import**: the same as `npm run import-infra`. → `line.json`, `report.md`, `railml.xml`

Every download stays in the output folder and is reused on the next run. If a server stops answering, run the same command again later: it starts from the first missing file. `--refresh` downloads everything again.

| Option | Use |
| :-- | :-- |
| `--bbox s,w,n,e` | bounding box of the line, when the automatic one cuts it or the stations are hard to find |
| `--rinf-line <label>` | the national line of RINF, when several have both stations (the script lists them) |
| `--rinf-line none` | no RINF: lines that are not in the register, or to compare with and without |
| `--no-dem` | no altitudes: the line is level where OpenStreetMap has no `ele` |
| `--id`, `--name` | id and name of the line (default from the stations) |

Then read the report (step 4).

## 3. The manual route

Make a folder for the line, for example `lines/my-line/`, and save every file there.

### 3.1 OpenStreetMap

1. Open [overpass-turbo.eu](https://overpass-turbo.eu).
2. Paste this query, with the bounding box of the line (south, west, north, east) in the three places:

```
[out:json][timeout:180];
(
  way["railway"~"^(rail|narrow_gauge)$"](40.98,14.38,41.17,14.82);
  node["railway"~"^(station|halt|stop|signal)$"](40.98,14.38,41.17,14.82);
  node["public_transport"~"^(station|stop_position)$"]["train"="yes"](40.98,14.38,41.17,14.82);
);
out body;
>;
out skel qt;
```

3. **Run**, then **Export → raw data directly from Overpass API**, and save as `overpass.json`.
4. Check the file: `"timestamp_osm_base"` must be a date (`2026-11-06T16:33:58Z`) and `"elements"` must hold thousands of entries. An empty `elements` with a timestamp that is not a date means the server answered without data: choose another one in **Settings → General → Server** (for example `overpass.kumi.systems` or `maps.mail.ru/osm/tools/overpass`) and run again.

### 3.2 RINF (optional)

1. Open [graph.data.era.europa.eu](https://graph.data.era.europa.eu/), choose the repository **rinf-plus** and the SPARQL editor.
2. Find the national line from a word of a station name (in lower case):

```sparql
PREFIX era: <http://data.europa.eu/949/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT DISTINCT ?line ?name WHERE {
  ?op a era:OperationalPoint ; era:opName ?name . FILTER (CONTAINS(LCASE(STR(?name)), "cancello"))
  { ?sol era:opStart ?op } UNION { ?sol era:opEnd ?op }
  ?sol era:nationalLine/rdfs:label ?line .
}
```

   Take the `line` that also appears for the other terminal. No result for one of the stations means the line is not in RINF: go on without it.
3. Run the query of the sections with that label in place of `CANCELLO-BENEVENTO` ([INFRA_IMPORT.md](INFRA_IMPORT.md#rinf-the-sparql-query) has it, and `rinfSectionsQuery` in `src/infra/queries.ts` writes it).
4. Download the result as **JSON** (SPARQL results JSON) and save it as `rinf.json`. Several dozen rows are normal: one per track of each section.

### 3.3 Altitudes (optional)

1. Import once without altitudes and write the points of the line:

```bash
npm run import-infra -- --osm lines/my-line/overpass.json [--rinf lines/my-line/rinf.json] --from "A" --to "B" --output lines/my-line/line.json --elevation-points lines/my-line/points.json
```

2. Every 100 points of `points.json` make one request (latitude,longitude separated by `|`):

```
https://api.opentopodata.org/v1/eudem25m?locations=40.992289,14.418826|40.993165,14.419097|...
```

   Open each URL in the browser, one per second at most, and save the answers.
3. Put the answers in a list in `dem.json`: `[ {answer 1}, {answer 2}, ... ]`. A list of `{"lat": …, "lon": …, "elevation": …}` works too.

### 3.4 Import

```bash
npm run import-infra -- --osm lines/my-line/overpass.json --rinf lines/my-line/rinf.json --elevation lines/my-line/dem.json \
  --from "A" --to "B" --output lines/my-line/line.json --report lines/my-line/report.md --railml-out lines/my-line/railml.xml
```

Leave out `--rinf` or `--elevation` for the sources you do not have.

## 4. Read the report

`report.md` says how much of the line comes from the sources, and what to check. In order:
- **Stations**: are they all there, in order, at plausible kilometres? A missing station is usually more than 300 m from the track, or named differently from the terminal you gave.
- **How much of the line is real**: the share of every property taken from a source, derived or generated. A speed generated on most of the line means that OpenStreetMap has no `maxspeed` and RINF is missing.
- **Consistency of the sources**: OSM and RINF lengths between stations. Differences of 1 % are normal; a large one is an error of one of the two (on Cancello – Benevento RINF registers 955 km for a 944 m section), or a station matched to the wrong operational point.
- **Warnings**:

| Warning | Meaning and remedy |
| :-- | :-- |
| minimum radius below 150 m | coarse mapping or a path through station tracks; look at that kilometre on the map. Above 100 m it is usually acceptable |
| maximum gradient above 35 ‰ | altitudes of the ground taken for the track (an untagged cutting or embankment); check the area, or import with `--no-dem` |
| straight track added | the mapped track ends near a terminal station; harmless |
| station far from the track | the station node is more than 300 m away; check its name and position in OSM |
| RINF: no operational point named … | the names differ beyond the abbreviations YuTreno recognises; the stretch has no RINF data |

If the path takes a wrong branch, narrow the bounding box (`--bbox`) so that the other branch is outside it.

## 5. Use the line

- **Headless**: `npm run headless -- --line lines/my-line/line.json --controller examples/ato.js` runs the example driver along the timetable that the import generated (the running time at the speed limits, plus margins).
- **Page**: in the *Line* editor, *Import from the box*, paste the content of `line.json`, then use it.
- **Scenario**: in a scenario, `"line"` takes the whole line instead of an id ([SCENARIOS.md](SCENARIOS.md)).
- **Several trains**: a scenario configuration chooses the line and the number of trains, `{"line": "line.json", "trains": {"count": 4, "headway_s": 900, "directions": "both"}}`, and runs with `npm run headless -- --scenario config.json`; with a real timetable extract the trains are those of the timetable ([SCENARIO_CONFIG.md](SCENARIO_CONFIG.md)).
- **Network**: lines meet at stations with the same name. `scripts/real-network.ts` writes `scenarios/services/benevento.json`, the network of the two example lines with a connection and a crossing: copy it as a template.
- **railML 3.2**: `railml.xml` is the infrastructure of the line, for other tools; `npm run import-infra -- --railml railml.xml` reads it back.

## 6. Check the running times against a real timetable

1. On the NAP (see [Italian lines: the National Access Point](#italian-lines-the-national-access-point)) find the NeTEx of the operator (Trenitalia national, or the regional ones, *RAP <region>*), and download it: the link *Ultima risorsa importata → Download* gives an `.xml.gz` file. The regional files are much smaller than the national one.
2. Import the trips of your line as services: `npm run import -- timetable.xml --line lines/my-line/line.json --output lines/my-line/timetable.json` (unzip the `.gz` first). The stops are matched to the stations by name.
3. Compare: `npm run plausibility -- --line lines/my-line/line.json --scenario lines/my-line/timetable.json`. Every stretch must lie between 0.98 and 1.35 times the simulated time plus 120 s ([INFRA_IMPORT.md](INFRA_IMPORT.md#plausibility-against-a-real-timetable)).

`examples/infra/salerno-mercato-s-severino/` is a complete example: the line, the extract of its 21 daily trips from the NeTEx of the Campania region (`timetable.json`) and the result of the comparison in its `README.md`. On that line the comparison found the one stretch where OpenStreetMap is slower than the timetable allows (30 km/h in a tunnel where RINF gives 60 km/h); that is why the import keeps the RINF speed where RINF covers the line.

Not every line has trains in the timetables: in November 2026 Avellino – Benevento was served by buses (stops `busTRENITALIA` in the NeTEx of Trenitalia) and Cancello – Benevento had no trips at all.

## 7. Keep it in the repository

To keep a line as an example checked by `verify-infra`, as for `examples/infra/cancello-benevento/`:
- put the sources (`overpass.json` compacted, `rinf.json`, the altitudes) and the results in `examples/infra/<line>/`, with a `README.md` and a `LEGGIMI.md` that give the date of the data and the attributions;
- add to `scripts/verify-infra.ts` a check like `INF11` (the committed line is up to date, stations, plausible radii and gradients, a run with `examples/ato.js`);
- keep the attributions: the line is a database derived from OpenStreetMap, so it is under the ODbL too, and its `attribution` field carries the sources.

## Troubleshooting

| Problem | What to do |
| :-- | :-- |
| Overpass answers «at capacity», 429 or 504 | wait and run again; the script already tries three servers |
| `elements` empty | the server has no data: another server |
| «station not found in the extract» | the name is not the one in OSM, or the station is outside the box |
| «no railway path» | the line is broken in OSM (two ways not joined) or leaves the box: a larger `--bbox` |
| the RINF query returns nothing | the line is not in RINF, or the station word does not occur in the RINF name (try another word of the name) |
| OpenTopoData refuses | 1000 requests a day per address: run again the next day, the script resumes |
| gradients implausible | `--no-dem`, or check the area for unmapped tunnels and bridges |
