# Salerno – Mercato San Severino

A real line imported from OpenStreetMap, RINF and a digital elevation model (`docs/INFRA_IMPORT.md`), with its real timetable. It is the first line of YuTreno whose imported infrastructure is checked against the timetable that trains actually run.

- `overpass.json`: Overpass extract of OpenStreetMap, 6 November 2026 19:22 UTC (bounding box 40.66,14.70,40.80,14.84). © OpenStreetMap contributors, Open Database License 1.0 (https://www.openstreetmap.org/copyright).
- `rinf.json`: result of the RINF query of `docs/INFRA_IMPORT.md` for the national line C148 on the ERA knowledge graph (repository `rinf-plus`), 6 November 2026. RINF, European Union Agency for Railways; ERA terms of use.
- `eudem25m.json`: altitudes every 100 m along the line from EU-DEM v1.1, 25 m, through OpenTopoData. Produced using Copernicus data and information funded by the European Union - EU-DEM layers.
- `timetable.json`: the 21 daily trips of Trenitalia between Salerno and Mercato S. Severino, taken from the NeTEx file of the Campania region published on the Italian National Access Point (CCISS, dataset «RAP Campania - NeTEx Livello 1», file `IT-ITF3-TRENITALIA_L1.xml.gz`), valid from 23 May to 12 December 2026. Format `yutreno-timetable-extract`, described in `docs/SCENARIO_CONFIG.md`.
- `line.json`, `report.md`, `railml.xml`: the imported line, its import report and its infrastructure in railML 3.2. As a database derived from OpenStreetMap, the line is under the ODbL too.

Command used:

```
npm run import-infra -- --osm overpass.json --rinf rinf.json --elevation eudem25m.json \
  --from Salerno --to "Mercato San Severino" --id salerno-mercato-s-severino \
  --output line.json --report report.md --railml-out railml.xml
```

OpenStreetMap and RINF agree within 1.2 % on every stretch. The trips towards Mercato San Severino were compared with the simulated running times (`npm run plausibility`): no stretch is run faster than the simulated train allows. Salerno – Salerno Irno was, in trip 5018 (3 minutes in the timetable, 204 s simulated), when the import took the lower of the two speeds: OpenStreetMap gives 30 km/h in the tunnel and RINF 60 km/h. The timetable showed that RINF is right, and now the import keeps RINF where it covers the line; the 30 km/h of OpenStreetMap is listed in the report as set aside. The gradients come from the RINF profile and agree with the ground of EU-DEM within 4 m on every stretch. Trains in the timetable have generous margins elsewhere (up to 5 minutes for the 1.7 km between Baronissi and Fisciano). `verify-infra` (INF13) checks all of this and fails if `line.json` is not up to date.

The scenario `examples/scenario-config/salerno-real-timetable.json` runs the morning trips of this timetable.
