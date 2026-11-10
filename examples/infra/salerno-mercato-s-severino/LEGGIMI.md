# Salerno – Mercato San Severino

Una linea reale importata da OpenStreetMap, RINF e un modello digitale del terreno (`docs/it/IMPORTAZIONE_INFRA.md`), con il suo orario reale. È la prima linea di YuTreno di cui l'infrastruttura importata è confrontata con l'orario che i treni fanno davvero.

- `overpass.json`: estratto Overpass di OpenStreetMap, 6 novembre 2026 19:22 UTC (riquadro 40.66,14.70,40.80,14.84). © OpenStreetMap contributors, Open Database License 1.0 (https://www.openstreetmap.org/copyright).
- `rinf.json`: risultato della query RINF di `docs/it/IMPORTAZIONE_INFRA.md` per la linea nazionale C148 sul knowledge graph dell'ERA (repository `rinf-plus`), 6 novembre 2026. RINF, Agenzia dell'Unione europea per le ferrovie; condizioni d'uso ERA.
- `eudem25m.json`: quote ogni 100 m lungo la linea da EU-DEM v1.1, 25 m, tramite OpenTopoData. Produced using Copernicus data and information funded by the European Union - EU-DEM layers.
- `timetable.json`: le 21 corse giornaliere di Trenitalia tra Salerno e Mercato S. Severino, prese dal file NeTEx della Regione Campania pubblicato sul Punto di Accesso Nazionale (CCISS, dataset «RAP Campania - NeTEx Livello 1», file `IT-ITF3-TRENITALIA_L1.xml.gz`), valido dal 23 maggio al 12 dicembre 2026. Formato `yutreno-timetable-extract`, descritto in `docs/it/CONFIGURAZIONE_SCENARIO.md`.
- `line.json`, `report.md`, `railml.xml`: la linea importata, il suo resoconto di importazione e la sua infrastruttura in railML 3.2. Come base di dati derivata da OpenStreetMap, anche la linea è sotto ODbL.

Comando usato:

```
npm run import-infra -- --osm overpass.json --rinf rinf.json --elevation eudem25m.json \
  --from Salerno --to "Mercato San Severino" --id salerno-mercato-s-severino \
  --output line.json --report report.md --railml-out railml.xml
```

OpenStreetMap e RINF concordano entro l'1,2 % su ogni tratta. Le corse verso Mercato San Severino sono state confrontate con i tempi di percorrenza simulati (`npm run plausibility`): nessuna tratta è percorsa più in fretta di quanto il treno simulato consenta. Salerno – Salerno Irno lo era, nella corsa 5018 (3 minuti in orario, 204 s simulati), quando l'importazione prendeva la più bassa delle due velocità: OpenStreetMap dà 30 km/h in galleria e RINF 60 km/h. L'orario ha mostrato che ha ragione RINF, e ora l'importazione tiene RINF dove copre la linea; i 30 km/h di OpenStreetMap sono elencati nel rapporto come messi da parte. Le pendenze vengono dal profilo di RINF e concordano con il terreno di EU-DEM entro 4 m su ogni tratta. Altrove i treni in orario hanno margini ampi (fino a 5 minuti per gli 1,7 km tra Baronissi e Fisciano). `verify-infra` (INF13) controlla tutto questo e fallisce se `line.json` non è aggiornato.

Lo scenario `examples/scenario-config/salerno-real-timetable.json` fa correre le corse del mattino di questo orario.
