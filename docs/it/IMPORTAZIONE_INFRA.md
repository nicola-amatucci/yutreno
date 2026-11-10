# Importazione dell'infrastruttura reale

*Versione inglese: [../INFRA_IMPORT.md](../INFRA_IMPORT.md)*

YuTreno può costruire una linea dai dati di una ferrovia vera. Usa OpenStreetMap, con l'etichettatura di OpenRailwayMap, per la geometria e i dettagli. Usa RINF, il registro dell'infrastruttura dell'Agenzia dell'Unione europea per le ferrovie (ERA), per i valori ufficiali delle sezioni di linea. Il risultato è una linea normale nel formato JSON di YuTreno (`LineDef`), che si usa in uno scenario o in una rete. Insieme alla linea esce un **rapporto dell'importazione**, che dice:
- da dove viene ogni dato;
- quanta parte della linea è reale e quanta ricostruita da YuTreno;
- quali licenze valgono.

L'importazione sta in `src/infra/`. Come il nucleo e i flussi, non dipende né dal DOM né da Node. Il risultato dipende solo dal contenuto delle fonti, non dall'ordine dei loro elementi.

```
npm run import-infra -- --osm estratto.json [--rinf rinf.json] --from "<stazione>" --to "<stazione>" \
  [--id <id>] [--name <nome>] [--output linea.json] [--report rapporto.md | rapporto.json]
```

Per una guida passo per passo, a mano o con un solo comando (`npm run line-from-sources`), vedi [TUTORIAL_LINEA.md](TUTORIAL_LINEA.md). Le interrogazioni stanno in `src/infra/queries.ts`.

`examples/infra/` contiene due esempi completi:
- **Borgo Alto – Ripa Bassa**, una linea inventata su fonti **sintetiche**, scritte con l'etichettatura di OSM, le colonne di RINF e le risposte di un servizio di quote. I suoi dati non sono reali. `scripts/infra-fixture.ts` scrive le fonti, e `verify-infra` controlla l'importazione contro le progressive da cui sono state costruite.
- **Avellino – Benevento** (`examples/infra/avellino-benevento/`), la prima linea reale: un estratto Overpass del 6 novembre 2026 e le quote EU-DEM ogni 100 m, con la linea importata, il suo rapporto e il suo railML. Si rigenera con
  `npm run import-infra -- --osm examples/infra/avellino-benevento/overpass.json --elevation examples/infra/avellino-benevento/eudem25m.json --from Avellino --to Benevento --output examples/infra/avellino-benevento/line.json --report examples/infra/avellino-benevento/report.md --railml-out examples/infra/avellino-benevento/railml.xml`.
  La linea c'è in OpenStreetMap ma non in RINF.
- **Cancello – Benevento** (`examples/infra/cancello-benevento/`), una linea reale che è anche in RINF: estratto Overpass e risultato RINF del 6 novembre 2026, quote EU-DEM. Si rigenera con
  `npm run import-infra -- --osm examples/infra/cancello-benevento/overpass.json --rinf examples/infra/cancello-benevento/rinf.json --elevation examples/infra/cancello-benevento/eudem25m.json --from Cancello --to Benevento --output examples/infra/cancello-benevento/line.json --report examples/infra/cancello-benevento/report.md --railml-out examples/infra/cancello-benevento/railml.xml`.
  Le due linee formano la rete di `scenarios/services/benevento.json` ([SCENARI.md](SCENARI.md)).
  Le due fonti concordano entro l'1 % su dieci tratte su undici. Sull'undicesima, Benevento Rione Libertà – Benevento Appia, RINF registra 955 km per una sezione che OpenStreetMap misura lunga 944 m: evidentemente la lunghezza è stata scritta in metri dove andavano i chilometri. Il rapporto lo segnala, e l'importazione non usa le lunghezze RINF per posizionare le stazioni.
- **Salerno – Mercato San Severino** (`examples/infra/salerno-mercato-s-severino/`), una linea reale con treni reali: estratto Overpass, risultato RINF e quote EU-DEM del 6 novembre 2026, e le 21 corse giornaliere Trenitalia dal NeTEx della Regione Campania sul Punto di Accesso Nazionale (`timetable.json`). Si rigenera con
  `npm run import-infra -- --osm examples/infra/salerno-mercato-s-severino/overpass.json --rinf examples/infra/salerno-mercato-s-severino/rinf.json --elevation examples/infra/salerno-mercato-s-severino/eudem25m.json --from Salerno --to "Mercato San Severino" --id salerno-mercato-s-severino --output examples/infra/salerno-mercato-s-severino/line.json --report examples/infra/salerno-mercato-s-severino/report.md --railml-out examples/infra/salerno-mercato-s-severino/railml.xml`.
  OpenStreetMap e RINF concordano entro l'1,2 % su ogni tratta. È la prima linea verificata contro l'orario che i suoi treni fanno: nessuna tratta delle undici corse verso Mercato San Severino è più veloce del treno simulato; 63 tratte su 80 stanno entro il limite superiore, le altre hanno margini di diversi minuti. Nella galleria dopo Salerno OpenStreetMap dà 30 km/h e RINF 60 km/h: prendendo il più basso una corsa risultava più veloce di quanto il treno potesse andare, quindi l'orario dice che ha ragione RINF, e dal 7 novembre RINF si tiene dove copre la linea (vedi la priorità dichiarata). Le pendenze vengono dal profilo di RINF, e la salita di ogni tratta concorda con il modello del terreno entro 4 m.

## Le fonti

| Fonte | Che cosa prende YuTreno | Licenza |
| :-- | :-- | :-- |
| OpenStreetMap (estratto Overpass) | percorso dei binari di corsa, stazioni e punti di fermata, `maxspeed`, gallerie, ponti, elettrificazione, sistemi di protezione, scartamento, segnali principali, quote `ele` | Open Database License 1.0: attribuzione, e condivisione allo stesso modo per le banche dati derivate, fra cui la linea importata |
| RINF (interrogazione SPARQL del grafo di conoscenza dell'ERA) | sezioni di linea fra punti operativi: lunghezza, velocità massima, livello ETCS, sistema di protezione nazionale, sistema della linea di contatto, pendenza media dove l'interrogazione la dà | condizioni d'uso dei dati RINF dell'ERA |

La linea importata porta l'attribuzione delle sue fonti nel campo `attribution`. Una linea importata da OSM è una banca dati derivata secondo la ODbL: chi la pubblica deve pubblicarla con la stessa licenza e mantenere l'attribuzione.

### OpenStreetMap: l'interrogazione Overpass

Si esegue su un'istanza Overpass, per esempio `https://overpass-api.de/api/interpreter`. Il riquadro (sud, ovest, nord, est) deve contenere tutta la linea; l'uscita JSON va salvata in un file.

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

Le vie con `railway=rail` o `narrow_gauge` formano un grafo sui loro nodi. Le vie con `service=siding|yard|spur|crossover` restano fuori, a meno di `--service-tracks`. Le stazioni estreme si trovano per nome senza badare ad accenti e maiuscole. La linea è il percorso più breve che un treno può fare fra di esse: a ogni nodo il percorso gira al massimo di 45°, quindi non può fare marcia indietro sugli scambi di una stazione (senza questa regola il percorso da Cancello andava a zig-zag sui binari di stazione); può partire da qualunque nodo di binario entro 300 m dalla prima stazione, e ogni partenza costa tre volte la sua distanza dalla stazione, e finisce al primo nodo di binario entro 150 m dall'ultima. Dove il binario mappato continua, il percorso si allunga fino a 400 m oltre ogni capolinea, lungo la prosecuzione più diritta. Dove non continua, YuTreno aggiunge binario diritto: la linea comincia 150 m prima del primo punto di fermata e finisce 300 m dopo l'ultimo, come le linee predefinite. Il binario aggiunto è segnato come generato.

Una stazione è ogni nodo `railway=station|halt`, o `public_transport=station` con `train=yes`, entro 300 m dal percorso. Il suo punto di fermata è il nodo `railway=stop` con lo stesso nome sul binario (provenienza *fonte*), altrimenti la proiezione del nodo della stazione sul percorso (*derivato*).

Ogni via del percorso dà le sue etichette al suo tratto di linea:
- `maxspeed`, oppure `maxspeed:forward` / `maxspeed:backward` secondo il verso in cui la linea percorre la via;
- `tunnel` (tranne `culvert`) e `bridge`;
- `electrified` con `voltage` e `frequency`;
- `railway:etcs`, `railway:scmt`, `railway:ssc`, `railway:bacc` e gli altri sistemi nazionali;
- `gauge`.

### RINF: l'interrogazione SPARQL

L'interrogazione gira sul grafo di conoscenza dell'ERA, all'indirizzo **https://graph.data.era.europa.eu/** (GraphDB, archivio `rinf-plus`). Prima si trova la linea nazionale di una stazione:

```sparql
PREFIX era: <http://data.europa.eu/949/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
SELECT DISTINCT ?line ?a ?b WHERE {
  ?op a era:OperationalPoint ; era:opName ?n . FILTER (CONTAINS(LCASE(STR(?n)), "benevento"))
  { ?sol era:opStart ?op } UNION { ?sol era:opEnd ?op }
  ?sol era:opStart/era:opName ?a ; era:opEnd/era:opName ?b ; era:nationalLine/rdfs:label ?line .
}
```

Poi le sezioni di quella linea, una riga per binario di una sezione. Le colonne hanno nomi scelti da YuTreno, che `src/infra/rinf.ts` legge:

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

Il risultato si salva come SPARQL JSON (`application/sparql-results+json`). Il grafo dà la lunghezza di una sezione in chilometri, quindi l'interrogazione la moltiplica. L'interrogazione legge anche il profilo di pendenza dei binari (`era:gradientProfile`, per esempio `+3.5(46.463)`: 3,5 ‰ dal chilometro 46,463 della linea in avanti) e il chilometro dei due punti operativi (`era:netReference/era:hasLrsCoordinate`, per esempio `C148 | 9+456`); una colonna facoltativa `gradient` (‰, positiva da `opStart` a `opEnd`) viene letta quando non c'è il profilo.

L'interrogazione è stata provata il 6 novembre 2026 sulla linea Cancello – Benevento. Non tutte le linee sono in RINF: Avellino – Benevento, per esempio, non c'è, e per una linea così l'importazione usa solo OpenStreetMap.

Le sezioni si posano sulla linea fra le sue stazioni. Un punto operativo corrisponde a una stazione per uno qualunque dei suoi nomi (Benevento è sia `BENEVENTO` sia `BENEVENTO CENTRALE`); dove nessun nome è uguale, un nome RINF abbreviato corrisponde a una parte intera del nome OSM fra i trattini, con una parola di una lettera che sta per qualunque parola con quell'iniziale e gli spazi che possono mancare (`S.MARIA A VICO` per Santa Maria a Vico, `TUFARA VALLE` per Tufara Valle - Arpaise - Ceppaloni, `BENEVENTO PONTE CORVO` per Benevento Pontecorvo - Castelpoto). Fra due stazioni consecutive YuTreno prende la catena più breve di sezioni che passa per punti operativi che non sono stazioni della linea, come bivi e posti di movimento. Una catena di più sezioni si posa in proporzione alle lunghezze RINF (provenienza *derivato*); una sezione sola si posa così com'è (*fonte*). Più binari della stessa sezione danno la velocità massima più alta.

### Pendenze dal profilo di RINF

I cambi di pendenza di RINF sono a chilometri della linea nazionale, non a progressive della linea importata. Il ponte sono le stazioni: ognuna ha il suo chilometro sulla linea (l'etichetta del punto operativo per il `lineId` della sezione), e fra due stazioni un chilometro diventa una progressiva in modo lineare. Il verso dei chilometri viene dalla prima e dall'ultima stazione, così una linea i cui chilometri scendono dalla prima stazione ha i segni girati. Una stazione il cui chilometro non concorda con nessuna delle vicine (una stazione comune a più linee può portare il chilometro di un'altra, come Salerno) è lasciata fuori con un avviso; oltre l'ultima stazione i chilometri seguono la progressiva. Una pendenza vale dal suo chilometro fino al cambio successivo verso i chilometri crescenti, attraverso stazioni e sezioni, perché il profilo di un binario non si ferma alla fine di una sezione; i cambi di tutti i binari della linea formano un solo profilo. Un cambio il cui chilometro cade fuori dalla linea è un errore dei dati ed è lasciato fuori con un avviso (su Cancello – Benevento, uno al km 132,411 su una linea di 49 km). Prima del primo cambio del profilo la linea non ha pendenza RINF e prende la fonte successiva.

Dove c'è anche il modello del terreno, il rapporto confronta tratta per tratta la salita con le pendenze di RINF e quella del terreno (`gradient_check`), e avvisa quando differiscono di più di 15 m. Su Salerno – Mercato San Severino concordano entro 4 m su ogni tratta. Su Cancello – Benevento le tratte differiscono fino a 12 m e l'intera linea di circa 34 m: o il profilo di RINF è incompleto o lì il terreno segue meno la linea (trincee, viadotti), e il rapporto mostra dove.

### Quote: un modello digitale del terreno

Dove né RINF né OpenStreetMap danno le pendenze, queste vengono da un modello digitale del terreno. `--elevation-points punti.json` scrive i punti della linea ogni 100 m; le loro quote, chieste per esempio a OpenTopoData con il modello EU-DEM a 25 m (`https://api.opentopodata.org/v1/eudem25m?locations=lat,lon|lat,lon|…`, fino a 100 punti per richiesta), tornano con `--elevation dem.json`. Il file può contenere le risposte di OpenTopoData o un elenco di `{lat, lon, elevation}`.

Un modello del terreno dà la quota del suolo: su un ponte è la valle sotto, sopra una galleria la collina sopra. I punti dentro gallerie e ponti, con 30 m attorno agli estremi, vengono quindi esclusi e il binario si considera diritto fra gli estremi. Trincee e rilevati sono raramente mappati, quindi il resto passa per una mediana mobile su 1 km, che toglie le colline che il binario attraversa in trincea e le valli che supera su rilevato, e per una media mobile su 1 km, perché una ferrovia non segue le ondulazioni del terreno; poi viene e ridotto ai cambi di pendenza che spostano la quota di più di 0,5 m. Le pendenze sono *derivate*, dalla fonte `dem`; l'attribuzione dei dati Copernicus va nella linea e nel rapporto.

## La priorità dichiarata

| Proprietà | Regola |
| :-- | :-- |
| Tracciato, stazioni, gallerie, segnali mappati | OpenStreetMap |
| Velocità | RINF dove copre la linea, il registro ufficiale del gestore; OSM altrove. Dove le due differiscono, il rapporto elenca il tratto fra i conflitti di velocità con la fonte tenuta: un limite OSM sopra RINF, e un limite OSM sotto RINF, messo da parte (decisione del proprietario del 7 novembre 2026, dopo la galleria di Salerno). `--speed-policy lower` tiene invece la più bassa delle due, come prima. Dove nessuna la dà, 80 km/h (`--default-speed`), generata |
| Pendenza | RINF (il profilo posto con i chilometri delle stazioni, o la pendenza media di una sezione); altrove il modello del terreno (derivata); altrove la pendenza fra le quote `ele` dei nodi e delle stazioni di OSM (derivata); altrove piano (generata) |
| Sistema di protezione ed elettrificazione | RINF; altrove OSM |
| Lunghezza della sezione di blocco | mediana della distanza fra i segnali principali mappati, fra 400 m e 4 km (derivata), con almeno due distanze di questo tipo; altrimenti 1300 m (`--block`, generata). I segnali della simulazione si generano con quella lunghezza secondo le regole di oggi: le posizioni dei segnali veri sono contate nel rapporto ma non posate |
| Orario delle stazioni | generato: tempo di percorrenza ai limiti di velocità diviso 0,9 più 60 s, arrotondato per eccesso a 10 s, sosta 30 s. Un orario vero viene da `npm run import` (GTFS, NeTEx, railML) |

Il piano della linea è il percorso OSM in un piano locale: x verso est e y verso nord dal primo punto, con la formula che i flussi dei dati aperti usano per tornare a WGS84. Una stazione della linea importata è quindi pubblicata in GTFS, NeTEx e SIRI alle coordinate delle fonti (entro 3 m in `verify-infra`). Il percorso viene semplificato con l'algoritmo di Douglas–Peucker (1 m, vertici distanti almeno 15 m), perché la spline del piano non prenda il rumore dei tratti mappati fitti, e poi ricampionato ogni 25 m: la spline è una Catmull-Rom uniforme, che fa piccoli cappi dove un segmento corto segue uno lungo (su Avellino – Benevento davano curve di 22 m di raggio). Poi tutte le progressive vengono scalate sulla lunghezza della linea compilata.

## Il rapporto

`--report rapporto.md` scrive il rapporto per le persone, `--report rapporto.json` lo stesso contenuto come dati (`InfraReport`, formato `yutreno-infra-report` versione 1). Contiene:
- le fonti con licenze, attribuzioni, numero di elementi e data dell'estratto;
- **quanta parte della linea è reale**: per ogni proprietà, i metri di linea presi da una fonte, derivati e generati; per le stazioni, quante;
- le stazioni con l'elemento OSM della loro posizione;
- i tratti di velocità con provenienza ed elementi di origine, e i conflitti di velocità con la fonte tenuta;
- la salita di ogni tratta con le pendenze di RINF contro il modello del terreno, dove ci sono entrambi;
- la **coerenza** delle due fonti: per ogni coppia di stazioni consecutive, la lunghezza RINF delle sezioni contro la progressiva OSM. Una differenza oltre il 5 % diventa un avviso;
- sistemi di protezione ed elettrificazione, con il segnalamento consigliato per lo scenario: ETCS se il livello 2 o 3 copre almeno il 95 % della linea, altrimenti blocco automatico;
- gli avvisi: binario aggiunto, stazioni lontane dal binario, raggio minimo sotto 150 m, pendenze oltre 35 ‰, sezioni senza corrispondenza, chilometri di stazioni e cambi di pendenza lasciati fuori.

## railML 3.2

`--railml-out infra.xml` scrive anche l'infrastruttura della linea importata in railML 3.2, e `npm run import-infra -- --railml infra.xml --output linea.json` ne rilegge una (`src/infra/railml.ts`). Si può esportare qualunque linea di YuTreno, comprese quelle predefinite. Il documento contiene:
- un solo `netElement` per tutta la linea, con un sistema di posizionamento lineare in metri;
- i vertici del piano come `geometryPoint`, con longitudine, latitudine WGS84 e quota per una linea georeferenziata, altrimenti in un piano locale in metri;
- le stazioni come `operationalPoint`;
- i limiti di velocità come `speedSection` del profilo statico di velocità di base;
- le pendenze come `gradientCurve` costanti;
- le gallerie come `overCrossing` di tipo galleria.

Ogni posizione ha sia la coordinata intrinseca (da 0 a 1) sia quella lineare in metri. Nome, georeferenziazione, piano, profilo, stazioni, limiti di velocità e gallerie superano l'andata e ritorno entro 5 cm. L'orario delle stazioni, la lunghezza del blocco e il treno merci che precede non sono infrastruttura: all'importazione prendono valori predefiniti, e un orario railML si importa con `npm run import`. La provenienza dei dati resta nel rapporto dell'importazione, perché railML non ha un posto per essa. Come l'esportazione dell'orario, la struttura segue il modello dati di railML 3.2 pubblicato sul wiki di railML e non è stata validata contro lo XSD, che railML.org distribuisce agli utenti registrati.

## Plausibilità contro un orario reale

`npm run plausibility -- --line linea.json --scenario scenario.json [--service <id>]` confronta, tratta per tratta, il tempo di percorrenza di un orario con quello simulato sulla linea (`src/server/plausibility.ts`). L'orario è un servizio di uno scenario, per esempio importato con `npm run import` da GTFS o NeTEx; senza `--scenario` è l'orario delle stazioni della linea. Il servizio deve percorrere la linea nel suo verso.

Il treno simulato è il treno comandato con `examples/ato.js`, che ferma in ogni fermata dell'orario ed è sempre in ritardo, quindi non aspetta mai e non va in deriva per rispettare l'orario; il treno merci che precede è spento. Non ci si aspetta che un orario coincida con la simulazione, perché contiene i margini di percorrenza e di regolarità. È **plausibile** quando, su ogni tratta,

  0,98 × simulato ≤ orario ≤ 1,35 × simulato + 120 s.

Il limite inferiore dice che un orario non può essere più veloce di quanto il treno possa andare, con il 2 % per il modello; quello superiore lascia spazio ai margini e al tempo per partire e fermarsi. I limiti sono scelti da YuTreno e si cambiano con `--lower`, `--upper` e `--slack`. Una tratta fuori dai limiti indica un errore dell'importazione (una riduzione di velocità mancante, una stazione nel posto sbagliato) oppure un orario che contiene altro, come un incrocio o una sosta lunga.

## Verifiche

`verify-infra` gira sulle fonti sintetiche:
- **INF1**: lunghezza della linea e georeferenziazione che torna alle coordinate delle fonti;
- **INF2**: stazioni e punti di fermata, binario secondario e diramazione esclusi, binario aggiunto dopo l'ultima stazione;
- **INF3**: velocità con la priorità dichiarata (RINF sopra un limite OSM più basso, il più basso con `speedPolicy: 'lower'`), galleria, lunghezza del blocco dai segnali, pendenza dalle quote e da RINF, quote di provenienza che sommano alla lunghezza;
- **INF4**: RINF posato attraverso un posto di movimento, coerenza delle lunghezze, importazione senza RINF, licenze nel rapporto;
- **INF5**: determinismo e indipendenza dall'ordine degli elementi; `examples/infra/` aggiornato;
- **INF6**: la linea importata si percorre con `examples/ato.js`, con blocco automatico e con ETCS, senza interventi e con fermate precise;
- **INF7**: esportazione e importazione in railML 3.2 restituiscono la linea importata e ogni linea predefinita, e una seconda andata e ritorno dà lo stesso documento;
- **INF8**: l'orario generato della linea importata è plausibile; uno più veloce del 30 % e uno tre volte più lento no;
- **INF9**: pendenze da un modello del terreno: quote delle stazioni entro 3 m, collina sopra la galleria esclusa, RINF prima del modello;
- **INF10**: Avellino – Benevento da `examples/infra/avellino-benevento/`: la linea salvata è aggiornata, dieci stazioni, lunghezza, raggi e pendenze plausibili, e la linea si percorre con `examples/ato.js`;
- **INF11**: Cancello – Benevento da `examples/infra/cancello-benevento/`: la linea salvata è aggiornata, ogni coppia di stazioni collegata a RINF (nomi abbreviati compresi), le due fonti entro l'1,5 % tranne l'errore RINF qui sopra, che viene segnalato, velocità da RINF, e la linea si percorre con `examples/ato.js`;
- **INF13**: Salerno – Mercato San Severino da `examples/infra/salerno-mercato-s-severino/`: la linea salvata è aggiornata, OSM e RINF entro l'1,5 % su ogni tratta, e le corse dell'orario reale nella direzione della linea, confrontate con `plausibility`, mai più veloci del treno simulato, RINF 60 km/h tenuto in galleria con i 30 km/h di OSM nel rapporto, e le pendenze di RINF entro 6 m dal modello del terreno su ogni tratta;
- **INF14**: il profilo di pendenza di RINF sulla linea sintetica, con chilometri che scendono lungo la linea: segni girati, una pendenza che vale fino al cambio successivo attraverso le stazioni, un chilometro di stazione di un'altra linea e un cambio fuori dalla linea lasciati fuori con avvisi.

## Limiti e passi successivi

- L'ambiente di sviluppo non raggiunge Overpass, OpenStreetMap, Geofabrik né i servizi dell'ERA: gli estratti vengono dal browser del proprietario.
- Su Avellino – Benevento velocità, stazioni e protezione (SSC, SCMT) vengono da OpenStreetMap e le pendenze dal modello del terreno; i segnali mappati sono solo sei, quindi le sezioni di blocco sono generate, e l'orario delle stazioni è generato. Non è ancora stato importato un suo orario reale, quindi la sua plausibilità resta da verificare.
- Una linea fra due stazioni. Una rete si fa con più linee importate, unite come sempre dai nomi delle stazioni.
- Un solo percorso di binari di corsa: niente binari di stazione, deviatoi o posizioni vere dei segnali nella simulazione.
- A novembre 2026 non esiste un orario di treni per le due linee: nei NeTEx del punto di accesso nazionale (CCISS) Trenitalia serve Avellino – Benevento con autobus (fermate `busTRENITALIA`), ed EAV non pubblica corse sulla Napoli – Benevento, né in NeTEx né in GTFS. Ancora da fare nella fase 5: la plausibilità contro un orario reale, su una linea che ne abbia uno; la lettura di `era:gradientProfile`; più linee importate come rete.

## Fonti

- Wiki di OpenStreetMap, [etichettatura di OpenRailwayMap](https://wiki.openstreetmap.org/wiki/OpenRailwayMap/Tagging) ed [etichettatura in Italia](https://wiki.openstreetmap.org/wiki/OpenRailwayMap/Tagging_in_Italy); [Overpass API](https://wiki.openstreetmap.org/wiki/Overpass_API); [diritti d'autore e licenza](https://www.openstreetmap.org/copyright)
- ERA, [RINF](https://www.era.europa.eu/domains/registers/rinf_en); [condizioni d'uso](https://www.era.europa.eu/system/files/2022-11/rinf_terms_of_use_en.pdf); [vocabolario dell'ERA](https://github.com/Interoperable-data/ERA_vocabulary); [interrogazioni SPARQL d'esempio dell'ERA](https://www.era.europa.eu/system/files/2024-03/tentqueries.sparqlbook.txt)
- OpenTopoData, [dataset EU-DEM](https://www.opentopodata.org/datasets/eudem/); Copernicus Land Monitoring Service, EU-DEM v1.1
- D. H. Douglas, T. K. Peucker, *Algorithms for the reduction of the number of points required to represent a digitized line or its caricature*, The Canadian Cartographer 10(2), 1973
