# Avellino – Benevento

La prima linea reale importata in YuTreno (`docs/it/IMPORTAZIONE_INFRA.md`).

- `overpass.json`: estratto Overpass di OpenStreetMap, 6 novembre 2026 alle 15:55 UTC. © contributori di OpenStreetMap, Open Database License 1.0 (https://www.openstreetmap.org/copyright).
- `eudem25m.json`: quote ogni 100 m lungo la linea dal modello EU-DEM v1.1 a 25 m, tramite OpenTopoData. Prodotto con dati e informazioni Copernicus finanziati dall'Unione europea - strati EU-DEM.
- `line.json`, `report.md`, `railml.xml`: la linea importata, il suo rapporto dell'importazione e la sua infrastruttura in railML 3.2. Come banca dati derivata da OpenStreetMap, anche la linea è sotto ODbL.

La linea non c'è in RINF. Si rigenera con il comando di `docs/it/IMPORTAZIONE_INFRA.md`; `verify-infra` (INF10) fallisce se `line.json` non è aggiornato.
