# Cancello – Benevento

Una linea reale importata da OpenStreetMap, RINF e un modello digitale del terreno (`docs/it/IMPORTAZIONE_INFRA.md`).

- `overpass.json`: estratto Overpass di OpenStreetMap, 6 novembre 2026 alle 16:33 UTC. © contributori di OpenStreetMap, Open Database License 1.0 (https://www.openstreetmap.org/copyright).
- `rinf.json`: risultato dell'interrogazione RINF di `docs/it/IMPORTAZIONE_INFRA.md` sul grafo di conoscenza dell'ERA (archivio `rinf-plus`), 6 novembre 2026. RINF, Agenzia dell'Unione europea per le ferrovie; condizioni d'uso dell'ERA.
- `eudem25m.json`: quote ogni 100 m lungo la linea dal modello EU-DEM v1.1 a 25 m, tramite OpenTopoData. Prodotto con dati e informazioni Copernicus finanziati dall'Unione europea - strati EU-DEM.
- `line.json`, `report.md`, `railml.xml`: la linea importata, il suo rapporto dell'importazione e la sua infrastruttura in railML 3.2. Come banca dati derivata da OpenStreetMap, anche la linea è sotto ODbL.

RINF registra la sezione Benevento Rione Libertà – Benevento Appia come lunga 955 km; OpenStreetMap la misura 944 m. Il rapporto lo segnala. Le pendenze vengono dal profilo di RINF; rispetto al terreno di EU-DEM la salita differisce fino a 12 m per tratta, e il rapporto lo elenca tratta per tratta. Un cambio di pendenza di RINF, al km 132,411 su una linea di 49 km, è un errore dei dati ed è lasciato fuori. `verify-infra` (INF11) fallisce se `line.json` non è aggiornato.
