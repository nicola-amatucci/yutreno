# Tutorial: una linea reale partendo da zero

*Versione inglese: [../LINE_TUTORIAL.md](../LINE_TUTORIAL.md)*

Questo tutorial porta una linea ferroviaria reale dalle fonti di dati pubbliche fino a una linea che YuTreno sa percorrere: la cabina, le corse senza grafica, gli scenari, una rete con altre linee. Le strade sono due:
- **automatica**: un solo comando scarica tutto e lo importa (passo 2);
- **manuale**: ogni fonte si scarica a mano, poi si importa (passo 3). Serve quando un server rifiuta le richieste automatiche, quando si vogliono guardare i dati prima di importarli, o per capire che cosa fa lo script.

Il riferimento dell'importazione, con le sue regole e il suo rapporto, è [IMPORTAZIONE_INFRA.md](IMPORTAZIONE_INFRA.md). Gli esempi completi sono in `examples/infra/`: Cancello – Benevento (OpenStreetMap, RINF e quote) e Avellino – Benevento (senza RINF).

## Che cosa serve

- Node.js 20 o successivo e il repository con `npm install` già fatto.
- L'accesso a internet verso tre servizi pubblici, tutti gratuiti e senza registrazione:

| Fonte | Che cosa dà | Servizio | Licenza |
| :-- | :-- | :-- | :-- |
| OpenStreetMap | tracciato, stazioni, velocità, gallerie, elettrificazione, protezione, segnali | Overpass API (`overpass-api.de` e copie) | ODbL 1.0 |
| RINF, registro dell'infrastruttura dell'ERA | sezioni di linea ufficiali: lunghezze, velocità massime, protezione, linea di contatto | grafo di conoscenza dell'ERA, `graph.data.era.europa.eu`, archivio `rinf-plus` | condizioni d'uso dell'ERA |
| EU-DEM 25 m | quote del terreno, per le pendenze | OpenTopoData, `api.opentopodata.org` (1 richiesta al secondo, 1000 al giorno) | Copernicus, libero con attribuzione |

- Se c'è, un orario reale della linea, per verificare i tempi di percorrenza (passo 6): il punto di accesso nazionale italiano, **CCISS NAP** (`www.cciss.it/nap/mmtis/public/catalog/Dataset`), pubblica i NeTEx di Trenitalia, Italo e di ogni regione, scaricabili senza login.

## Linee italiane: il Punto di Accesso Nazionale

Per le linee in Italia gli orari, e le fermate con la loro posizione, vengono dal **Punto di Accesso Nazionale** italiano per le informazioni sul viaggio multimodale (NAP, Regolamento UE 2017/1926), gestito dal Ministero delle Infrastrutture e dei Trasporti tramite il CCISS:

- **Catalogo**: [www.cciss.it/nap/mmtis/public/catalog/Dataset](https://www.cciss.it/nap/mmtis/public/catalog/Dataset). Si cerca per operatore o regione (`?query=campania`, `?query=trenitalia`). Per scaricare non serve il login.
- **Che cosa c'è per le ferrovie** (novembre 2026): *OAP Trenitalia – NeTEx Livello 1*, tutto l'orario nazionale di Trenitalia (un `.xml.gz` di circa 440 MB decompresso); *OAP Italo* (NeTEx livelli 1 e 2); e per ogni regione un dataset *RAP <regione>* con un file NeTEx per operatore, per esempio in Campania `IT-ITF3-TRENITALIA`, `IT-ITF3-EAV_FERRO`, `IT-ITF3-EAV_GOMMA`. I dati seguono il profilo italiano di NeTEx (livelli da 1 a 4).
- **Scaricare**: nella pagina di un dataset ogni file ha *Ultima risorsa importata → Download* (il file com'è stato pubblicato) e *Ultima risorsa validata → Download* (il file dopo la validazione del NAP). I collegamenti hanno la forma `https://www.cciss.it/nap/mmtis/public/api/v1/download/blob/Asset/<numero>/resource`.
- **Che cosa cercare**: le fermate della linea per nome (`<StopPlace>` con `<Name>`, in maiuscolo nei file di Trenitalia), poi le corse che vi fermano. Controlla il modo: una fermata di tipo `bus…` (per esempio `busTRENITALIA`) vuol dire che l'operatore serve la linea con autobus, i cui tempi non sono quelli di un treno.

Il catalogo precedente del Ministero, [nap.mit.gov.it](https://nap.mit.gov.it/api), ha un'interfaccia CKAN (`/catalog/api/3/action/package_search?q=…`), ma a novembre 2026 elencava solo 26 dataset, per lo più del 2022 (Trenitalia per Sardegna e Toscana, Ferrotramviaria in Puglia).

Il NAP dà gli orari, non l'infrastruttura: binario, velocità e pendenze vengono comunque da OpenStreetMap, RINF e dal modello del terreno.

## 1. Scegliere la linea e le due stazioni estreme

Una linea va da una stazione a un'altra lungo i binari di corsa. Cercala su [OpenRailwayMap](https://www.openrailwaymap.org) o su openstreetmap.org e annota:
- i **nomi delle due stazioni estreme esattamente come in OpenStreetMap** (clic sulla stazione: etichetta `name`). Accenti e maiuscole non contano, le parole sì: `Benevento`, non `Benevento Centrale`, se il nome mappato è quello;
- dove passa la linea, se è lunga o curva: lo script calcola un riquadro dalle due stazioni con un margine, che può tagliare una linea che fa un giro largo. In quel caso dai tu il riquadro (sud, ovest, nord, est in gradi), per esempio con [bboxfinder.com](http://bboxfinder.com).

Una linea a binario unico fra due stazioni, lunga 20–60 km, è il primo caso migliore.

## 2. La strada automatica

```bash
npm run line-from-sources -- --from "Cancello" --to "Benevento" --out lines/cancello-benevento
```

Lo script (`src/server/line-from-sources.ts`) fa nell'ordine i quattro passi della strada manuale e scrive che cosa sta facendo:
1. **Overpass**: trova le due stazioni, costruisce il riquadro con un margine e scarica la ferrovia che contiene. Prova i server pubblici uno dopo l'altro e riprova con attese crescenti; una risposta vuota, che un server occupato o guasto può dare, conta come errore. → `overpass.json`
2. **RINF**: cerca la linea nazionale che ha entrambe le stazioni estreme (anche con i nomi abbreviati di RINF, come `S.MARIA A VICO`) e ne scarica le sezioni. Se nessuna linea le ha entrambe lo dice e prosegue senza RINF. → `rinf.json`
3. **EU-DEM**: importa la linea una volta senza quote, prende un punto ogni 100 m e chiede le quote a OpenTopoData, 100 punti per richiesta, una richiesta al secondo. → `dem.json`
4. **Importazione**: la stessa di `npm run import-infra`. → `line.json`, `report.md`, `railml.xml`

Ogni file scaricato resta nella cartella di uscita e viene riusato alla volta successiva. Se un server smette di rispondere, rilancia lo stesso comando più tardi: riparte dal primo file mancante. `--refresh` scarica tutto di nuovo.

| Opzione | A che cosa serve |
| :-- | :-- |
| `--bbox s,o,n,e` | riquadro della linea, quando quello automatico la taglia o le stazioni sono difficili da trovare |
| `--rinf-line <etichetta>` | la linea nazionale di RINF, quando più linee hanno entrambe le stazioni (lo script le elenca) |
| `--rinf-line none` | senza RINF: linee che non sono nel registro, o per confrontare con e senza |
| `--no-dem` | senza quote: la linea è in piano dove OpenStreetMap non ha `ele` |
| `--id`, `--name` | id e nome della linea (predefiniti dalle stazioni) |

Poi leggi il rapporto (passo 4).

## 3. La strada manuale

Crea una cartella per la linea, per esempio `lines/mia-linea/`, e salva lì ogni file.

### 3.1 OpenStreetMap

1. Apri [overpass-turbo.eu](https://overpass-turbo.eu).
2. Incolla questa interrogazione, con il riquadro della linea (sud, ovest, nord, est) nei tre punti:

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

3. **Esegui**, poi **Esporta → dati grezzi da Overpass API**, e salva come `overpass.json`.
4. Controlla il file: `"timestamp_osm_base"` deve essere una data (`2026-11-06T16:33:58Z`) ed `"elements"` deve contenere migliaia di voci. Un `elements` vuoto con un timestamp che non è una data vuol dire che il server ha risposto senza dati: scegline un altro in **Impostazioni → Generale → Server** (per esempio `overpass.kumi.systems` o `maps.mail.ru/osm/tools/overpass`) ed esegui di nuovo.

### 3.2 RINF (facoltativo)

1. Apri [graph.data.era.europa.eu](https://graph.data.era.europa.eu/), scegli l'archivio **rinf-plus** e l'editor SPARQL.
2. Trova la linea nazionale da una parola del nome di una stazione (in minuscolo):

```sparql
PREFIX era: <http://data.europa.eu/949/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT DISTINCT ?line ?name WHERE {
  ?op a era:OperationalPoint ; era:opName ?name . FILTER (CONTAINS(LCASE(STR(?name)), "cancello"))
  { ?sol era:opStart ?op } UNION { ?sol era:opEnd ?op }
  ?sol era:nationalLine/rdfs:label ?line .
}
```

   Prendi la `line` che compare anche per l'altra stazione estrema. Nessun risultato per una delle due vuol dire che la linea non è in RINF: prosegui senza.
3. Esegui l'interrogazione delle sezioni con quell'etichetta al posto di `CANCELLO-BENEVENTO` (sta in [IMPORTAZIONE_INFRA.md](IMPORTAZIONE_INFRA.md#rinf-linterrogazione-sparql), e `rinfSectionsQuery` in `src/infra/queries.ts` la scrive).
4. Scarica il risultato come **JSON** (SPARQL results JSON) e salvalo come `rinf.json`. Qualche decina di righe è normale: una per binario di ogni sezione.

### 3.3 Quote (facoltativo)

1. Importa una volta senza quote e scrivi i punti della linea:

```bash
npm run import-infra -- --osm lines/mia-linea/overpass.json [--rinf lines/mia-linea/rinf.json] --from "A" --to "B" --output lines/mia-linea/line.json --elevation-points lines/mia-linea/points.json
```

2. Ogni 100 punti di `points.json` fai una richiesta (latitudine,longitudine separate da `|`):

```
https://api.opentopodata.org/v1/eudem25m?locations=40.992289,14.418826|40.993165,14.419097|...
```

   Apri ogni indirizzo nel browser, al massimo uno al secondo, e salva le risposte.
3. Metti le risposte in un elenco in `dem.json`: `[ {risposta 1}, {risposta 2}, ... ]`. Va bene anche un elenco di `{"lat": …, "lon": …, "elevation": …}`.

### 3.4 Importazione

```bash
npm run import-infra -- --osm lines/mia-linea/overpass.json --rinf lines/mia-linea/rinf.json --elevation lines/mia-linea/dem.json \
  --from "A" --to "B" --output lines/mia-linea/line.json --report lines/mia-linea/report.md --railml-out lines/mia-linea/railml.xml
```

Togli `--rinf` o `--elevation` per le fonti che non hai.

## 4. Leggere il rapporto

`report.md` dice quanta parte della linea viene dalle fonti, e che cosa controllare. Nell'ordine:
- **Stazioni**: ci sono tutte, in ordine, a progressive plausibili? Una stazione che manca di solito è a più di 300 m dal binario, o ha un nome diverso da quello dato per l'estremo.
- **Quanta parte della linea è reale**: per ogni proprietà, la quota presa da una fonte, derivata o generata. Una velocità generata su gran parte della linea vuol dire che OpenStreetMap non ha `maxspeed` e RINF manca.
- **Coerenza delle fonti**: lunghezze OSM e RINF fra le stazioni. Differenze dell'1 % sono normali; una grande è un errore di una delle due (su Cancello – Benevento RINF registra 955 km per una sezione di 944 m), o una stazione collegata al punto operativo sbagliato.
- **Avvisi**:

| Avviso | Significato e rimedio |
| :-- | :-- |
| raggio minimo sotto 150 m | mappatura grossolana o un percorso sui binari di stazione; guarda quel chilometro sulla mappa. Sopra 100 m di solito va bene |
| pendenza massima oltre 35 ‰ | quote del terreno prese per il binario (trincea o rilevato non mappati); controlla la zona, o importa con `--no-dem` |
| binario diritto aggiunto | il binario mappato finisce vicino a una stazione estrema; innocuo |
| stazione lontana dal binario | il nodo della stazione è a più di 300 m; controlla nome e posizione in OSM |
| RINF: nessun punto operativo chiamato … | i nomi differiscono oltre le abbreviazioni che YuTreno riconosce; la tratta resta senza dati RINF |

Se il percorso prende un ramo sbagliato, restringi il riquadro (`--bbox`) in modo che l'altro ramo resti fuori.

## 5. Usare la linea

- **Senza grafica**: `npm run headless -- --line lines/mia-linea/line.json --controller examples/ato.js` fa percorrere la linea al guidatore d'esempio, con l'orario che l'importazione ha generato (tempo di percorrenza ai limiti di velocità, più i margini).
- **Pagina**: nell'editor *Line*, *Import from the box*, incolla il contenuto di `line.json`, poi usala.
- **Scenario**: in uno scenario, `"line"` accetta la linea intera al posto di un id ([SCENARI.md](SCENARI.md)).
- **Più treni**: una configurazione di scenario sceglie la linea e il numero di treni, `{"line": "line.json", "trains": {"count": 4, "headway_s": 900, "directions": "both"}}`, e gira con `npm run headless -- --scenario config.json`; con un estratto di orario reale i treni sono quelli dell'orario ([CONFIGURAZIONE_SCENARIO.md](CONFIGURAZIONE_SCENARIO.md)).
- **Rete**: le linee si incontrano nelle stazioni con lo stesso nome. `scripts/real-network.ts` scrive `scenarios/services/benevento.json`, la rete delle due linee d'esempio con una coincidenza e un incrocio: copialo come modello.
- **railML 3.2**: `railml.xml` è l'infrastruttura della linea, per altri strumenti; `npm run import-infra -- --railml railml.xml` la rilegge.

## 6. Verificare i tempi di percorrenza contro un orario reale

1. Sul NAP (vedi [Linee italiane: il Punto di Accesso Nazionale](#linee-italiane-il-punto-di-accesso-nazionale)) trova il NeTEx dell'operatore (Trenitalia nazionale, o quelli regionali, *RAP <regione>*) e scaricalo: il collegamento *Ultima risorsa importata → Download* dà un file `.xml.gz`. I file regionali sono molto più piccoli di quello nazionale.
2. Importa le corse della tua linea come servizi: `npm run import -- orario.xml --line lines/mia-linea/line.json --output lines/mia-linea/orario.json` (prima decomprimi il `.gz`). Le fermate si collegano alle stazioni per nome.
3. Confronta: `npm run plausibility -- --line lines/mia-linea/line.json --scenario lines/mia-linea/orario.json`. Ogni tratta deve stare fra 0,98 e 1,35 volte il tempo simulato più 120 s ([IMPORTAZIONE_INFRA.md](IMPORTAZIONE_INFRA.md#plausibilità-contro-un-orario-reale)).

`examples/infra/salerno-mercato-s-severino/` è un esempio completo: la linea, l'estratto delle sue 21 corse giornaliere dal NeTEx della Regione Campania (`timetable.json`) e il risultato del confronto nel suo `LEGGIMI.md`. Su quella linea il confronto ha trovato l'unica tratta in cui OpenStreetMap è più lento di quanto l'orario consenta (30 km/h in una galleria dove RINF dà 60 km/h); per questo l'importazione tiene la velocità di RINF dove RINF copre la linea.

Non tutte le linee hanno treni negli orari: a novembre 2026 Avellino – Benevento era servita da autobus (fermate `busTRENITALIA` nel NeTEx di Trenitalia) e Cancello – Benevento non aveva nessuna corsa.

## 7. Tenerla nel repository

Per tenere una linea come esempio verificato da `verify-infra`, come `examples/infra/cancello-benevento/`:
- metti le fonti (`overpass.json` compattato, `rinf.json`, le quote) e i risultati in `examples/infra/<linea>/`, con un `README.md` e un `LEGGIMI.md` che dicono la data dei dati e le attribuzioni;
- aggiungi a `scripts/verify-infra.ts` una verifica come `INF11` (la linea salvata è aggiornata, stazioni, raggi e pendenze plausibili, una corsa con `examples/ato.js`);
- conserva le attribuzioni: la linea è una banca dati derivata da OpenStreetMap, quindi è anche lei sotto ODbL, e il suo campo `attribution` riporta le fonti.

## Problemi frequenti

| Problema | Che cosa fare |
| :-- | :-- |
| Overpass risponde «at capacity», 429 o 504 | aspetta e rilancia; lo script prova già tre server |
| `elements` vuoto | il server non ha i dati: un altro server |
| «station not found in the extract» | il nome non è quello di OSM, o la stazione è fuori dal riquadro |
| «no railway path» | la linea è interrotta in OSM (due vie non unite) o esce dal riquadro: un `--bbox` più largo |
| l'interrogazione RINF non restituisce nulla | la linea non è in RINF, o la parola non compare nel nome RINF della stazione (prova un'altra parola del nome) |
| OpenTopoData rifiuta | 1000 richieste al giorno per indirizzo: rilancia il giorno dopo, lo script riprende |
| pendenze non plausibili | `--no-dem`, oppure controlla la zona per gallerie e ponti non mappati |
