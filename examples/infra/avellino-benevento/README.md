# Avellino – Benevento

The first real line imported in YuTreno (`docs/INFRA_IMPORT.md`).

- `overpass.json`: Overpass extract of OpenStreetMap, 6 November 2026 15:55 UTC. © OpenStreetMap contributors, Open Database License 1.0 (https://www.openstreetmap.org/copyright).
- `eudem25m.json`: altitudes every 100 m along the line from EU-DEM v1.1, 25 m, through OpenTopoData. Produced using Copernicus data and information funded by the European Union - EU-DEM layers.
- `line.json`, `report.md`, `railml.xml`: the imported line, its import report and its infrastructure in railML 3.2. As a database derived from OpenStreetMap, the line is under the ODbL too.

The line is not in RINF. Regenerate with the command in `docs/INFRA_IMPORT.md`; `verify-infra` (INF10) fails if `line.json` is not up to date.
