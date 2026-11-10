# Dati aperti: orario e flussi in tempo reale

> Copia italiana di [OPEN_DATA.md](../OPEN_DATA.md). In caso di differenze fa fede il testo inglese.

YuTreno pubblica l'orario e l'andamento di una corsa nei formati che leggono i sistemi di informazione ai passeggeri: **GTFS** e **NeTEx** per l'orario programmato, **GTFS-Realtime** e **SIRI** per posizioni e orari effettivi e previsti. NeTEx segue il profilo italiano dell'European Passenger Information Profile (EPIP), quello mantenuto da 5T per i Regional Access Point; gli identificativi sono quelli del profilo e sono gli stessi nei quattro formati, così chi consuma i dati può unire orario e tempo reale senza tabelle di corrispondenza.

Lo scopo non è imitare un'impresa ferroviaria ma dare al simulatore un'uscita che gli strumenti esistenti capiscono. Un calcolatore di percorsi, un tabellone di stazione o un cruscotto dei ritardi possono essere puntati su una corsa e vedere treni che frenano, aspettano a un incrocio e accumulano ritardo secondo la fisica e il segnalamento, non secondo un copione. Al contrario, i flussi sono anche una verifica del simulatore: se una corsa produce un ritardo, quel ritardo deve comparire uguale nei TripUpdates, in SIRI-ET e nella posizione del treno.

Gli standard in sé (da dove vengono, i loro modelli, i profili italiani, la corrispondenza dei concetti e i validatori) sono discussi in [STANDARD_ORARI.md](STANDARD_ORARI.md). Esempi reali di ogni formato sono in [examples/feeds/](../../examples/feeds/).

## Per cominciare

```
npm run feeds -- --scenario scenarios/services/crossing.json --speed 10
```

avvia il server su `http://localhost:8090/` con lo scenario dell'incrocio, dieci volte più veloce dell'orologio. Il treno della corsa è guidato dall'ATO interno, i treni di servizio dal loro conducente. Ogni richiesta restituisce i flussi all'istante simulato di quel momento.

```
npm run feeds -- --scenario scenarios/services/crossing.json --at 600 --out feeds/
```

non serve nulla: porta la corsa a t = 600 s e scrive tutti i flussi in `feeds/` (`gtfs.zip`, `vehicle-positions.pb` e `.json`, `trip-updates.pb` e `.json`, `siri-vm.xml`, `siri-et.xml`, `netex.xml`, `railml.xml`).

Opzioni: `--port`, `--speed` (secondi simulati per secondo), `--date AAAA-MM-GG` (giorno di servizio, predefinito 2026-11-05), `--start HH:MM:SS` (ora locale di t = 0, predefinita 08:00:00 come nella pagina), `--timezone` (predefinito Europe/Rome), `--region` (codice NUTS negli identificativi, predefinito ITF3, Campania), `--codespace` (predefinito `yutreno`), `--vat` (partita IVA dell'azienda, che i profili italiani mettono nel suo identificativo).

## Endpoint

| Percorso | Formato | Contenuto |
| :-- | :-- | :-- |
| `/` | JSON | stato della corsa ed elenco degli endpoint |
| `/gtfs/gtfs.zip` | GTFS | azienda, stazioni e marciapiedi, linea, corse, orari alle fermate, tracciati, calendario del giorno |
| `/gtfs-rt/vehicle-positions` | GTFS-Realtime (protobuf; `?format=json`) | posizione, direzione, velocità, odometro, fermata corrente e stato di ogni treno in marcia |
| `/gtfs-rt/trip-updates` | GTFS-Realtime (protobuf; `?format=json`) | orari effettivi delle fermate fatte, previsti delle altre, ritardo attuale |
| `/siri-lite/vehicle-monitoring` | SIRI 2.1 VM (XML) | una `VehicleActivity` per treno in marcia, con avanzamento fra le fermate, ritardo e fermata monitorata |
| `/siri-lite/estimated-timetable` | SIRI 2.1 ET (XML) | tutte le corse del giorno: `RecordedCalls` con gli orari effettivi, `EstimatedCalls` con quelli previsti |
| `/netex/timetable.xml` | NeTEx EPIP, profilo italiano | orario programmato |
| `/netex/api/v1/convertedNetex` | JSON | elenco delle versioni, come nell'interfaccia RAP |
| `/netex/api/v1/downloadVersion?level=1&agencyCode=yutreno[&gzVersion=false]` | NeTEx gzip o XML | scaricamento, come nell'interfaccia RAP |
| `/railml/timetable.xml` | railML 3.2 | orario programmato con le soste minime ([più sotto](#importare-un-orario)) |
| `/control-room` | JSON | istantanea della sala di controllo: rete, segnalamento, treni e registro ([SALA_CONTROLLO.md](SALA_CONTROLLO.md); `?log=<n>` eventi) |

Gli endpoint SIRI sono SIRI Lite: una GET restituisce l'intera consegna, senza sottoscrizioni. Percorsi e filtri (`LineRef`, `OperatorRef`, `datasetId`, `maxSize`) sono quelli dell'interfaccia del RAP dinamico del profilo italiano di SIRI (`swagger/RAP_DINAMICO_1_0_0.yaml` nel repository di 5T); rispondono ancora anche i precedenti `/siri/vehicle-monitoring` e `/siri/estimated-timetable`. Le consegne seguono il profilo italiano di SIRI: identificativi NeTEx, `JourneyPatternRef`, `VehicleRef`, `VisitNumber` e `Order` nelle fermate. I due percorsi `/netex/api/v1/` riproducono l'interfaccia che il profilo italiano pubblica per i Regional Access Point (`swagger/RAP_1_0_0.yaml` nel repository del profilo), quindi un client scritto per un RAP scarica l'orario di YuTreno senza modifiche; `xsdzip` risponde 404 e rimanda al repository del profilo. Ogni risposta porta `Access-Control-Allow-Origin: *`, così una pagina può leggere i flussi direttamente.

## Dalla corsa ai flussi

**La linea sulla carta.** La linea ha una pianta locale in metri; `geo` nella definizione della linea ne colloca l'origine (`lat`, `lon`) e può ruotarla (`rotation_deg`). Le due linee predefinite stanno in Campania, fra il Vallo di Lauro e l'Irpinia; una linea senza `geo` è collocata nello stesso punto. Le posizioni sono una proiezione equirettangolare della pianta, più che sufficiente per linee di qualche decina di chilometri.

**Stazioni, marciapiedi, sensi di marcia.** Ogni stazione è un luogo di fermata con due marciapiedi, il binario 1 per i treni nel senso della linea e il binario 2 per gli altri, come le stazioni a due binari della vista 3D. In GTFS sono una stazione (`location_type=1`) con i suoi marciapiedi; in NeTEx uno `StopPlace` con due `Quay`, due `ScheduledStopPoint` e le `PassengerStopAssignment` che li legano. Il GTFS elenca solo i marciapiedi che hanno corse.

**Corse.** Ogni treno della corsa è una corsa: il treno guidato con l'orario della linea, come treno `R 2001`, e ogni servizio con il proprio id. In NeTEx il numero è un `TrainNumber` (`ForAdvertisement`) a cui la corsa rimanda. Gli orari sono quelli programmati, non quelli della corsa, quindi GTFS e NeTEx non cambiano mentre la corsa va avanti.

**Tempo reale.** Gli orari effettivi sono quelli registrati dalla simulazione (`realised` di ogni treno). Il ritardo è quello dell'ultimo arrivo o partenza fatti; gli orari previsti delle fermate successive sono quelli programmati più il ritardo, se positivo, perché un treno non parte prima dell'orario e un anticipo si riassorbe alla fermata dopo. Un treno che aspetta oltre l'orario di partenza ha come partenza prevista "adesso".

**Decisioni del regolatore.** Gli orari statici (GTFS, NeTEx, railML) sono sempre quelli programmati, e gli orari "aimed" e i ritardi dei flussi in tempo reale si misurano rispetto a quelli. Quello che il regolatore ([REGOLATORE.md](REGOLATORE.md)) cambia durante la corsa è informazione in tempo reale:

- **un nuovo orario** è un limite inferiore di quello previsto: previsto = il più tardo fra programmato più ritardo e orario riprogrammato;
- **una fermata saltata**, o tolta perché ora il treno termina prima, è uno `StopTimeUpdate` con `schedule_relationship: SKIPPED` e senza orari in GTFS-Realtime, e una `EstimatedCall` con `<Cancellation>true</Cancellation>` e gli orari programmati in SIRI-ET;
- **un treno soppresso per intero** è un `TripUpdate` con la corsa `CANCELED` e senza aggiornamenti di fermata, e una `EstimatedVehicleJourney` con `<Cancellation>true</Cancellation>` e tutte le chiamate cancellate;
- **un treno che termina prima** mostra la stazione in cui termina come fermata effettuata.

Lo scenario `services/cancellation` produce il secondo e l'ultimo caso; `verify-feeds` li controlla tutti con un regolatore scritto a mano, e l'uscita SIRI resta valida contro lo schema ufficiale. Le posizioni dicono `STOPPED_AT` quando il treno è in fermata, `INCOMING_AT` entro 400 m, `IN_TRANSIT_TO` altrimenti; in SIRI-VM `ProgressBetweenStops` dà la lunghezza della tratta e la percentuale percorsa.

**Reti.** Su una rete ([progetto/rete.md](progetto/rete.md)) ogni stazione di ogni linea è un luogo di fermata, un nodo una volta sola. Una corsa appartiene alla linea dei flussi fatta delle linee che percorre: un treno su una linea a quella linea, un treno da Valle Lauro a Rocca Sabato alla linea `valle-lauro+rocca-sabato`; ognuna di queste linee è una route GTFS e una `Line` NeTEx con i suoi percorsi per verso. Il verso di una corsa è quello della sua linea o, su più linee, di andata quando parte dalla linea più bassa della rete. Posizioni e tracciati seguono il corridoio di ogni corsa nel piano comune della rete, collocato con il `geo` della linea principale; le progressive di fermate e veicoli sono quelle del corridoio. GTFS ha un tracciato per linea, verso e coppia di estremi.

**Giri e coincidenze.** Il giro di un servizio è il `block_id` della sua corsa GTFS (la colonna compare solo se qualche treno ha un giro). Una coincidenza è una riga di `transfers.txt` con `transfer_type` 1, il treno in partenza aspetta, e il tempo di trasbordo; in NeTEx è una `ServiceJourneyInterchange` con `StandardTransferTime`, e il passaggio fra due servizi dello stesso giro è un interscambio con `StaySeated`. Il profilo EPIP non ha `MaximumWaitTime` né `Guaranteed`, quindi l'attesa massima non viene pubblicata. L'importazione rilegge `block_id`; coincidenze e reti non si importano ancora.

**Tempo.** La corsa comincia alle `--start` del `--date` nel fuso `--timezone`. Gli orari del giorno contano da mezzogiorno meno dodici ore, come li definisce GTFS, così coincidono con l'orologio anche nei giorni del cambio d'ora; gli orari dopo mezzanotte sono scritti oltre le 24:00 in GTFS e con un `DayOffset` in NeTEx. SIRI scrive gli istanti con lo scostamento di quel momento (`+01:00` a novembre, `+02:00` a luglio).

## Identificativi

Tutti gli identificativi hanno la forma del profilo italiano, `IT:<regione>:<tipo>:<codespace>:<id locale>`:

| Oggetto | Esempio |
| :-- | :-- |
| Impresa | `IT:ITF3:Operator:yutreno:yutreno` |
| Linea (GTFS `route_id`, SIRI `LineRef`) | `IT:ITF3:Line:yutreno:valle-lauro-monte-clanio` |
| Stazione (stazione GTFS, NeTEx `StopPlace`) | `IT:ITF3:StopPlace:yutreno:ponte-sabato` |
| Marciapiede (`stop_id` degli orari GTFS, NeTEx `Quay`) | `IT:ITF3:Quay:yutreno:ponte-sabato-1` |
| Punto di fermata (NeTEx, SIRI `StopPointRef`) | `IT:ITF3:ScheduledStopPoint:yutreno:ponte-sabato-2` |
| Corsa (GTFS `trip_id`, NeTEx `ServiceJourney`, SIRI `DatedVehicleJourneyRef`) | `IT:ITF3:ServiceJourney:yutreno:r-2101` |
| Veicolo | `IT:ITF3:Vehicle:yutreno:r-2101` |

Dipendono solo dalla linea, dai nomi e dalle opzioni, quindi due corse dello stesso scenario hanno gli stessi identificativi.

## Conformità

`npm run verify` comprende `verify-feeds`, che decodifica il protobuf di GTFS-Realtime con le librerie ufficiali (`gtfs-realtime-bindings`) e controlla integrità dei riferimenti, accordo fra i formati e con la simulazione, calendario (ora solare, ora legale, giorno del cambio, orari dopo mezzanotte) e determinismo. La validazione con gli strumenti ufficiali richiede Java, xmllint e gli schemi, quindi è uno script a parte:

```
git clone --depth 1 https://github.com/5Tsrl/netex-italian-profile ext/netex-italian-profile
git clone --depth 1 https://github.com/SIRI-CEN/SIRI ext/SIRI
npx tsx scripts/feeds-validate.ts --netex ext/netex-italian-profile --siri ext/SIRI --gtfs-validator gtfs-validator-7.1.0-cli.jar
```

Scrive in `results/feeds/` i flussi di ogni scenario con servizi a t = 0, 300, 600 s e alla fine, e li valida. Il risultato al momento della scrittura:

| Controllo | Risultato |
| :-- | :-- |
| NeTEx contro `xsd/NeTEx_publication_EPIP.xsd` del profilo italiano | 8/8 validi |
| SIRI VM ed ET contro `xsd/siri.xsd` (SIRI 2.1) | 16/16 validi |
| GTFS con il validatore MobilityData 7.1.0 | 0 errori; avvisi `feed_expiration_date7_days` e `trip_coverage_not_active_for_next7_days` |

I due avvisi GTFS sono attesi: il flusso descrive un solo giorno di servizio, mentre il validatore si aspetta che un flusso pubblicato copra almeno la settimana seguente.

## Importare un orario

La via del ritorno conta quanto quella dell'andata. Un orario scritto altrove può diventare i treni di servizio di uno scenario: il GTFS di un'azienda regionale, il NeTEx pubblicato da un Regional Access Point, il railML di un gestore dell'infrastruttura. E un orario costruito in YuTreno può andare in altri strumenti e tornare indietro senza cambiare.

```
npm run import -- orario.zip --line valle-lauro --date 2026-11-05 --output scenarios/services/importato.json
npm run import -- netex.xml --scenario scenarios/services/crossing.json
```

Il formato si riconosce dal contenuto: uno ZIP è GTFS, una `PublicationDelivery` è NeTEx, una radice `railML` (3.x) o `railml` (2.x) è railML. La stessa importazione è nella pagina: la scheda *Timetable* ha un pulsante per importare un file e tre per scaricare l'orario in uso in GTFS, NeTEx o railML.

**Che cosa si legge.** Ogni formato ha il suo modo di dire le stesse quattro cose, e l'importazione le cerca dove i produttori le mettono.
- *Fermate.* In GTFS un marciapiede prende il nome della sua stazione (`parent_station`). In NeTEx il punto di fermata prende il nome del luogo o del marciapiede assegnato, e l'ordine viene dallo schema di corsa. In railML 3 il nome viene dal punto operativo di ogni punto dell'itinerario base, e i punti di solo transito (`pass`) si saltano. In railML 2 viene dall'`ocp` di ogni `ocpTT`, in ordine di `sequence`.
- *Orari.* In GTFS gli orari possono andare oltre le 24:00. NeTEx usa gli scostamenti di giorno; se un file li omette e gli orari tornano indietro, l'importazione legge il giorno dopo e lo segnala. railML 3 usa orari con `dayOffset` e gli scostamenti di intervalli e varianti; railML 2 usa `arrivalDay` e `departureDay`. Si preferisce l'orario commerciale o programmato.
- *Numeri di treno.* In GTFS si usa `trip_short_name`, poi `trip_id`. In NeTEx si usa il `ForAdvertisement` del `TrainNumber`, poi i codici e l'identificativo. In railML 3 si usa l'identificativo `OperationalTrainNumber`; in railML 2 il numero del `trainPart` o del `train` che lo contiene.
- *Giorno di servizio.* Con `--date` si importano solo le corse di quel giorno. In GTFS valgono `calendar.txt` con le eccezioni di `calendar_dates.txt`. In NeTEx valgono le assegnazioni dei tipi di giorno per data, giorno operativo o periodo operativo (con `ValidDayBits` o i giorni della settimana). In railML valgono le validità a maschera di bit e i periodi operativi.

**Abbinamento alla linea.** Le fermate si abbinano alle stazioni della linea per nome, senza badare a maiuscole, accenti e punteggiatura. Le fermate fuori linea si tolgono, e una corsa che ne conserva meno di due si scarta. Gli orari diventano secondi dall'inizio della corsa (`--start`, predefinito 08:00:00); una corsa che parte prima si scarta. La corsa con esattamente l'orario della linea è il treno guidato e non si importa come servizio, a meno di `--keep-controlled`. Ogni scarto viene segnalato, su stderr o nella pagina, così niente sparisce in silenzio.

**Che cosa i formati non portano.** Il tipo di treno e il conducente non stanno in GTFS, NeTEx o railML nel senso in cui li usa YuTreno. Le soste minime stanno solo in railML (`minDwellTime`, `minStopTime`). Quando i servizi sostituiscono quelli di uno scenario (`--scenario`), questi campi si conservano dal servizio con lo stesso numero.

**Andata e ritorno.** `verify-imports` esporta ogni scenario con servizi e un orario di 25 treni nei due sensi fino a dopo mezzanotte, poi li reimporta. I servizi tornano identici da GTFS e da NeTEx, e da railML anche con le soste minime. Legge anche file scritti come li scrivono altri produttori: uno ZIP compresso con una cartella, calendari settimanali, NeTEx con prefissi e periodi operativi, railML 3 con itinerari condivisi e scostamenti, e railML 2 con train part.

**Esportazione railML 3.2.** Lo scaricamento e `/railml/timetable.xml` contengono le stazioni come punti operativi. Ogni treno ha un itinerario base con orari commerciali e soste minime, un itinerario, una validità a maschera di bit per il giorno di servizio e un treno operativo con il suo numero. La struttura segue il modello dei dati railML 3.2 pubblicato sul wiki di railML. Non è ancora stata validata contro l'XSD, che railML.org distribuisce agli utenti registrati e che non era raggiungibile dall'ambiente in cui è stata scritta. `scripts/feeds-validate.ts --railml <cartella con railml3.xsd>` la valida appena lo schema è disponibile.

## Passeggeri

Con i passeggeri nello scenario ([PASSEGGERI.md](PASSEGGERI.md)) SIRI-ET porta, a ogni fermata già lasciata, un `RecordedDepartureOccupancy` con il livello di occupazione, la percentuale dei posti a sedere occupati e i conteggi di scesi, saliti e passeggeri a bordo, e le posizioni dei veicoli di GTFS-Realtime portano `occupancy_status` e `occupancy_percentage`.

## Limiti

- Un giorno di servizio per corsa; gli orari di una rete si producono ma si importano solo linea per linea; niente tariffe, accessibilità o tipi di veicolo (EPIP livello 1 senza le parti facoltative).
- Il server guida i servizi con l'ATO interno: i servizi con `"driver": "agent"` sono rifiutati (servono l'ambiente per agenti, [AGENTI.md](AGENTI.md)).
- Le soppressioni esistono solo come decisioni di un regolatore; i cambi di binario non si pubblicano (il binario di un treno in stazione non è una banchina dell'orario).
- SIRI è servito come SIRI Lite (GET dell'intera consegna), senza sottoscrizioni né situazioni SIRI-SX.
- La pagina scarica gli orari statici (GTFS, NeTEx, railML) ma non i flussi in tempo reale, che richiedono una corsa che segue l'orologio: quelli vengono da `npm run feeds`.
