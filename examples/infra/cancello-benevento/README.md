# Cancello – Benevento

A real line imported from OpenStreetMap, RINF and a digital elevation model (`docs/INFRA_IMPORT.md`).

- `overpass.json`: Overpass extract of OpenStreetMap, 6 November 2026 16:33 UTC. © OpenStreetMap contributors, Open Database License 1.0 (https://www.openstreetmap.org/copyright).
- `rinf.json`: result of the RINF query of `docs/INFRA_IMPORT.md` on the ERA knowledge graph (repository `rinf-plus`), 6 November 2026. RINF, European Union Agency for Railways; ERA terms of use.
- `eudem25m.json`: altitudes every 100 m along the line from EU-DEM v1.1, 25 m, through OpenTopoData. Produced using Copernicus data and information funded by the European Union - EU-DEM layers.
- `line.json`, `report.md`, `railml.xml`: the imported line, its import report and its infrastructure in railML 3.2. As a database derived from OpenStreetMap, the line is under the ODbL too.

RINF registers the section Benevento Rione Libertà – Benevento Appia as 955 km long; OpenStreetMap measures 944 m. The report flags it. The gradients come from the RINF profile; against the ground of EU-DEM the climb differs by up to 12 m a stretch, and the report lists it stretch by stretch. One change of gradient of RINF, at km 132.411 on a line of 49 km, is a data error and is left out. `verify-infra` (INF11) fails if `line.json` is not up to date.
