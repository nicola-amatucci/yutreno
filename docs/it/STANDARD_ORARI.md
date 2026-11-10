# Standard dell'orario e dell'informazione ai passeggeri

> Copia italiana di [TIMETABLE_STANDARDS.md](../TIMETABLE_STANDARDS.md). In caso di differenze fa fede il testo inglese.

Questo documento spiega gli standard su cui poggiano i dati aperti di YuTreno ([DATI_APERTI.md](DATI_APERTI.md)): da dove viene ciascuno, chi lo mantiene, che cosa modella, come lo usa YuTreno e come si verifica il risultato. Gli esempi sono uscite reali di YuTreno. Stanno in [examples/feeds/](../../examples/feeds/): lo scenario dell'incrocio alle 08:10, dieci minuti dopo l'inizio della corsa, con il treno R 2001 trattenuto all'uscita di San Felice Scalo e l'R 2101 che vi arriva dal senso opposto. `verify-feeds` controlla che gli esempi restino identici a ciò che il codice produce.

Il [documento generale sugli standard](STANDARD.md) tratta ETCS, EULYNX e il lato ferroviario. Questo tratta il lato dei passeggeri e lo scambio degli orari, che seguono un'altra logica.

## Due famiglie, un orario

Un orario ferroviario si può descrivere con due famiglie di standard, nate per persone diverse.

La **famiglia dell'informazione ai passeggeri** è nata per dire ai viaggiatori quando e dove passano i mezzi, qualunque sia il modo di trasporto:
- In Europa poggia su un solo modello concettuale, **Transmodel**. Da esso derivano due formati di scambio: **NeTEx** per i dati programmati e **SIRI** per quelli in tempo reale.
- Accanto a questi, dalla pratica, sono cresciuti **GTFS** e **GTFS-Realtime**. Sono semplici, diffusissimi e non hanno un organismo formale alle spalle.

La **famiglia dell'esercizio ferroviario** descrive l'orario come serve ai gestori dell'infrastruttura e alle imprese ferroviarie: punti operativi, tracce, tempi di percorrenza e di sosta, composizione dei treni. I suoi standard sono:
- **railML**, un linguaggio XML mantenuto da un'associazione del settore;
- le **STI** europee sulla telematica, che regolano lo scambio di dati fra le imprese ferroviarie.

YuTreno sta dove le due famiglie si incontrano. Simula una ferrovia, con segnali, frenature e tempi di sosta, ma i suoi treni portano passeggeri. Per questo lo stesso orario esce dal simulatore in entrambe le lingue. Un calcolatore di percorsi legge GTFS o NeTEx; uno strumento di progettazione dell'orario legge railML. Gli identificativi sono ovunque gli stessi, così i dati programmati e quelli in tempo reale si uniscono senza tabelle di corrispondenza.

## Il quadro normativo

Nell'Unione europea gran parte della famiglia dei passeggeri non è facoltativa.

La **Direttiva ITS 2010/40/UE** (rivista dalla Direttiva (UE) 2023/2661) chiede servizi di informazione sul viaggio multimodale estesi a tutta l'Unione. Il **Regolamento delegato (UE) 2017/1926** (MMTIS) la attua. I suoi obblighi principali:
- Ogni Stato membro deve istituire un **Punto di accesso nazionale (NAP)**, entro il 1° dicembre 2019.
- Autorità, aziende di trasporto e gestori dell'infrastruttura devono pubblicare i loro dati attraverso il NAP.
- I dati statici dei trasporti di linea devono usare **NeTEx (CEN/TS 16614)**, basato su **Transmodel (EN 12896)**, oppure un formato leggibile dalle macchine e pienamente compatibile, per esempio attraverso convertitori.
- I dati dinamici devono usare **SIRI (CEN/TS 15531)** o un formato pienamente compatibile.

Il **Regolamento delegato (UE) 2024/490** modifica il 2017/1926 e rende obbligatori i dati dinamici, con queste scadenze:

| Data | Dati richiesti |
| :-- | :-- |
| 1° dicembre 2025 | ritardi e soppressioni storici e osservati; perturbazioni; orari stimati di partenza e di arrivo; stato dei nodi di accesso |
| 1° dicembre 2026 | tariffe e disponibilità dei parcheggi; mezzi in condivisione |
| 1° dicembre 2028 | estensione completa di queste categorie |

GTFS è quindi ammesso solo attraverso una conversione: non è il formato di riferimento al NAP.

**In Italia** il NAP per l'informazione multimodale è gestito per il Ministero delle Infrastrutture e dei Trasporti attraverso il portale CCISS. I dati vi arrivano soprattutto dai **Regional Access Point (RAP)**. Ogni RAP raccoglie i dati della sua regione nel formato in cui i produttori li hanno (GTFS, GBFS e altri), li converte e li consegna al NAP nei **profili italiani** di NeTEx e SIRI. I profili li mantiene 5T (Torino), che pubblica anche:
- le linee guida di compilazione;
- l'XSD del profilo NeTEx;
- gli esempi;
- le specifiche OpenAPI delle interfacce dei RAP.

Fra i fornitori elencati dal NAP ci sono Trenitalia, Italo e gran parte delle regioni, compresa la Campania, dove stanno le linee di YuTreno.

Per la ferrovia in particolare, le vecchie STI per le applicazioni telematiche dei passeggeri (TAP, Regolamento (UE) n. 454/2011) e delle merci (TAF, Regolamento (UE) n. 1305/2014) sono state sostituite dalla **STI Telematica, Regolamento di esecuzione (UE) 2026/253** del 6 febbraio 2026. Estende alla ferrovia l'obbligo di pubblicare orari, posizioni in tempo reale, composizione dei treni e accessibilità delle stazioni attraverso i punti di accesso nazionali.

## Transmodel: il vocabolario comune

**Che cos'è.** Transmodel, EN 12896, è il modello dei dati di riferimento europeo per il trasporto pubblico. È pubblicato in parti: concetti comuni, rete, orari, monitoraggio dell'esercizio, tariffe, informazione ai passeggeri e altre. La versione corrente è la 6.2. È un modello concettuale, non un formato di file: NeTEx e SIRI sono le sue codifiche XML.

**Perché conta.** Fissa il significato delle parole che ogni orario usa, e YuTreno le usa nel senso di Transmodel:

| Concetto Transmodel | Significato | In YuTreno |
| :-- | :-- | :-- |
| Linea | un insieme di percorsi noto al pubblico con un nome | la linea della corsa |
| Percorso, direzione | un tragitto ordinato, di andata o di ritorno | i due sensi di marcia |
| Punto di fermata programmato | il punto in cui, in un orario, si sale e si scende | uno per stazione e senso |
| Luogo di fermata, marciapiede | la stazione fisica e i suoi binari | la stazione, binario 1 e 2 |
| Schema di corsa | la successione dei punti di fermata di un gruppo di corse | le fermate di un servizio |
| Corsa | un viaggio di un mezzo a orari dati | un treno della corsa (quello guidato o un servizio) |
| Orario di passaggio | l'ora di una corsa in un punto del suo schema | arrivo e partenza a una fermata |
| Tipo di giorno, giorno operativo | i giorni in cui una corsa si effettua | il giorno di servizio della corsa |

## NeTEx: l'orario programmato

**Che cos'è.** NeTEx (Network Timetable Exchange) è la specifica tecnica CEN 16614, in parti. Le principali:

| Parte | Contenuto |
| :-- | :-- |
| 1 | topologia della rete |
| 2 | orari |
| 3 | tariffe |
| 4 | European Passenger Information Profile (EPIP), il sottoinsieme richiesto dal MMTIS |
| 5 | modi alternativi |
| 6 | profilo di accessibilità |

Lo schema XML è mantenuto apertamente su GitHub, nell'organizzazione TransmodelEcosystem. La versione 2 dello schema è uscita nel 2026; il profilo EPIP è una restrizione della versione 1.x.

**Struttura.** Un file NeTEx è una `PublicationDelivery` che contiene dei **frame**. Ogni frame raccoglie un tipo di oggetti, e gli oggetti si richiamano l'un l'altro per identificativo:
- **ResourceFrame:** le aziende;
- **SiteFrame:** luoghi di fermata e marciapiedi;
- **ServiceFrame:** linee, percorsi, punti di fermata, assegnazioni e schemi di corsa;
- **ServiceCalendarFrame:** tipi di giorno e loro assegnazione alle date;
- **TimetableFrame:** le corse con i loro orari di passaggio.

Un documento EPIP li avvolge in un `CompositeFrame` di tipo `EU_PI_LINE_OFFER`.

**Il profilo italiano** ha cinque livelli:
- il livello 1 è l'EPIP;
- il livello 2 aggiunge contratti e consuntivazione delle corse;
- il livello 3 aggiunge le tariffe;
- il livello 4 aggiunge i modi alternativi;
- il livello 5 aggiunge l'accessibilità.

Le linee guida (versione 5.0.1, aprile 2026) fissano gli identificativi nella forma `IT:<regione NUTS>:<tipo>:<codespace>:<id>`. Per l'azienda l'identificativo porta la partita IVA (`IT:ITC1:Operator:<partita IVA>:<codespace>:<id>`). Le aziende ferroviarie del trasporto locale hanno `OrganisationType` `railOperator`, e la `PublicationDelivery` porta `version="any"`.

**In YuTreno** l'esportazione è un documento di livello 1 del profilo italiano. Ecco una corsa da `examples/feeds/netex/timetable.xml`, accorciata:

```xml
<ServiceJourney id="IT:ITF3:ServiceJourney:yutreno:r-2101" version="1">
  <Name>R 2101 Monte Clanio – Valle Lauro</Name>
  <TransportMode>rail</TransportMode>
  <DepartureTime>08:05:00</DepartureTime>
  <dayTypes><DayTypeRef ref="IT:ITF3:DayType:yutreno:2026-11-05" version="1"/></dayTypes>
  <ServiceJourneyPatternRef ref="IT:ITF3:ServiceJourneyPattern:yutreno:in-monte-clanio_san-felice-scalo_ponte-sabato_valle-lauro" version="1"/>
  <OperatorRef ref="IT:ITF3:Operator:yutreno:yutreno" version="1"/>
  <trainNumbers><TrainNumberRef ref="IT:ITF3:TrainNumber:yutreno:r-2101" version="1"/></trainNumbers>
  <passingTimes>
    <TimetabledPassingTime id="IT:ITF3:TimetabledPassingTime:yutreno:r-2101-2" version="1">
      <StopPointInJourneyPatternRef ref="IT:ITF3:StopPointInJourneyPattern:yutreno:in-…-2" version="1"/>
      <ArrivalTime>08:09:20</ArrivalTime>
      <DepartureTime>08:11:00</DepartureTime>
    </TimetabledPassingTime>
    …
```

Come si legge:
- La corsa non nomina le sue stazioni. Rimanda a uno schema di corsa, i cui punti rimandano a punti di fermata programmati, che un'assegnazione lega a una stazione e a un marciapiede.
- Il numero del treno mostrato ai passeggeri sta in un `TrainNumber` (`ForAdvertisement`).
- Gli orari dopo mezzanotte portano un `DayOffset`.

L'importazione percorre la stessa catena all'indietro, e legge anche i file i cui produttori omettono lo scostamento di giorno.

**Validazione.** L'XSD del profilo italiano, `xsd/NeTEx_publication_EPIP.xsd` nel repository di 5T, si controlla con `xmllint`. `scripts/feeds-validate.ts` lo fa su ogni scenario con servizi in quattro momenti della corsa: 24 documenti su 24 sono validi. Lo schema controlla la struttura; le linee guida aggiungono regole che nessuno schema può esprimere, come la forma degli identificativi e i campi obbligatori.

## SIRI: il tempo reale

**Che cos'è.** SIRI (Service Interface for Real-time Information) è standard europeo dal 2006. Le parti da 1 a 3 (quadro, comunicazioni, servizi funzionali) sono EN 15531:2022 e 2023. Le parti da 4 a 7 sono specifiche tecniche:
- parte 4: monitoraggio degli impianti;
- parte 5: scambio delle situazioni;
- parte 6: azioni di controllo;
- parte 7: il profilo europeo per l'informazione in tempo reale ai passeggeri.

Lo schema è su GitHub, alla versione 2.3 (ottobre 2026); i documenti dichiarano la versione di SIRI che seguono, e il profilo italiano chiede `version="2.1"`.

**Servizi.** SIRI è un insieme di servizi che condividono una sola busta (`Siri/ServiceDelivery`):

| Servizio | Contenuto |
| :-- | :-- |
| VM (Vehicle Monitoring) | dove sono i mezzi |
| ET (Estimated Timetable) | orari effettivi e previsti di corse intere |
| SM (Stop Monitoring) | le partenze a una fermata |
| SX (Situation Exchange) | le perturbazioni |
| FM (Facility Monitoring) | ascensori, parcheggi e simili |
| PT (Production Timetable) | l'orario del giorno |

Il protocollo completo funziona per sottoscrizione (publish/subscribe). **SIRI Lite** è una GET HTTP semplificata che restituisce l'intera consegna.

**Il profilo italiano** (linee guida versione 2.0.0, 5 novembre 2025) definisce i flussi SIRI fra RAP e NAP: VM, ET, SX, FM e PT. Le sue regole principali:
- SIRI deve essere sempre correlato al NeTEx più recente, con gli stessi identificativi.
- Le corse si richiamano con `FramedVehicleJourneyRef` (data e corsa NeTEx).
- `JourneyPatternRef`, `OperatorRef` e `VehicleRef` sono richiesti.
- Le fermate portano `VisitNumber` e `Order`.

La specifica OpenAPI dell'interfaccia del RAP dinamico (versione 1.1, luglio 2024) aggiunge:
- `/siri/subscribe` per il NAP;
- gli endpoint SIRI Lite per la piattaforma nazionale MaaS: `/siri-lite/estimated-timetable`, `/siri-lite/vehicle-monitoring` e altri, con i filtri `LineRef`, `OperatorRef`, `datasetId` e `maxSize`.

**In YuTreno** il server dei flussi risponde su quei percorsi SIRI Lite, con gli stessi filtri. Con `--vat` l'identificativo dell'azienda prende la forma del profilo. Ecco l'orario stimato dell'R 2101 alle 08:10, da `examples/feeds/siri/estimated-timetable.xml`:

```xml
<RecordedCalls>
  <RecordedCall>
    <StopPointRef>IT:ITF3:ScheduledStopPoint:yutreno:monte-clanio-2</StopPointRef>
    <VisitNumber>1</VisitNumber><Order>1</Order><StopPointName>Monte Clanio</StopPointName>
    <AimedDepartureTime>2026-11-05T08:05:00+01:00</AimedDepartureTime>
    <ActualDepartureTime>2026-11-05T08:05:01+01:00</ActualDepartureTime>
  </RecordedCall>
</RecordedCalls>
<EstimatedCalls>
  <EstimatedCall>
    <StopPointRef>IT:ITF3:ScheduledStopPoint:yutreno:san-felice-scalo-2</StopPointRef>
    <VisitNumber>1</VisitNumber><Order>2</Order><StopPointName>San Felice Scalo</StopPointName>
    <AimedArrivalTime>2026-11-05T08:09:20+01:00</AimedArrivalTime>
    <ExpectedArrivalTime>2026-11-05T08:08:26+01:00</ExpectedArrivalTime>
    <AimedDepartureTime>2026-11-05T08:11:00+01:00</AimedDepartureTime>
    <ExpectedDepartureTime>2026-11-05T08:11:00+01:00</ExpectedDepartureTime>
  </EstimatedCall>
  …
```

L'esempio racconta una piccola storia:
- Il treno è partito da Monte Clanio con un secondo di ritardo.
- È arrivato a San Felice Scalo con 54 secondi di anticipo, alle 08:08:26. L'arrivo è fatto ma la fermata non è ancora lasciata, quindi resta una `EstimatedCall` con quell'orario.
- Non ripartirà prima delle 08:11:00 dell'orario, perché lì è programmato l'incrocio con l'R 2001.

**Validazione.** Tutti i documenti VM ed ET sono controllati contro `xsd/siri.xsd` del repository ufficiale: 48 su 48 sono validi, compresi quelli di `services/cancellation`, con una fermata cancellata. Gli esempi del profilo italiano si validano contro lo stesso schema, perché il profilo non ha un XSD proprio.

## GTFS e GTFS-Realtime

**Che cos'è.**
- **Origine:** GTFS nasce nel 2005 dalla collaborazione fra TriMet (Portland) e Google per Google Transit. All'inizio si chiamava Google Transit Feed Specification; poi è diventato General Transit Feed Specification.
- **Manutenzione:** la specifica vive su GitHub (`google/transit`) ed è documentata su gtfs.org. MobilityData ne guida l'evoluzione, e le modifiche si adottano con votazioni pubbliche fra produttori e utilizzatori.
- **Formato:** uno ZIP di file CSV.
- **GTFS-Realtime:** aggiunge tre tipi di entità in Protocol Buffers, cioè TripUpdates, VehiclePositions e Alerts. Lo definisce `gtfs-realtime.proto`, versione 2.0.

**Modello.** GTFS è un Transmodel appiattito:
- `routes.txt` elenca le linee;
- `trips.txt` elenca le corse;
- `stop_times.txt` dà gli orari di passaggio;
- `stops.txt` elenca le fermate, con stazioni (`location_type=1`) e marciapiedi (`parent_station`);
- `calendar.txt` e `calendar_dates.txt` danno i giorni di servizio;
- `shapes.txt` dà la geometria.

Gli orari si contano da "mezzogiorno meno 12 ore" del giorno di servizio. Per questo possono superare le 24:00, e restano uguali all'orologio anche nei giorni del cambio d'ora.

**In YuTreno**, da `examples/feeds/gtfs/stop_times.txt`:

```
trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled
IT:ITF3:ServiceJourney:yutreno:r-2001,08:00:00,08:00:00,IT:ITF3:Quay:yutreno:valle-lauro-1,1,0.0
IT:ITF3:ServiceJourney:yutreno:r-2001,08:04:20,08:04:50,IT:ITF3:Quay:yutreno:ponte-sabato-1,2,5050.0
```

Gli identificativi sono quelli di NeTEx, così chi consuma i dati passa da una corsa GTFS alla corsa NeTEx e a SIRI senza tabelle. L'aggiornamento della corsa R 2101 (`examples/feeds/gtfs-rt/trip-updates.json`, la forma decodificata del protobuf) porta lo stesso arrivo con 54 s di anticipo (`"delay": -54`) e la partenza in orario.

**Validazione.**
- **Flusso statico:** il validatore canonico di MobilityData (7.1.0) non trova errori. Dà due avvisi, attesi per un flusso di un solo giorno: `feed_expiration_date7_days` e `trip_coverage_not_active_for_next7_days`.
- **Flusso in tempo reale:** il protobuf si decodifica con le librerie ufficiali (`gtfs-realtime-bindings`) in `verify-feeds`.

## railML

**Che cos'è.**
- **Origine e manutenzione:** railML nasce nel 2002 da un'iniziativa della ricerca ferroviaria tedesca e svizzera. Lo mantiene railML.org e.V., un'associazione di gestori dell'infrastruttura, imprese ferroviarie, industria e università.
- **Contenuto:** è un linguaggio XML per scambiare dati ferroviari fra applicazioni: infrastruttura, materiale rotabile, orari e, dalla versione 3, apparati.
- **Versioni in uso:** convivono due linee.
  - **railML 2.x** è quella che oggi la maggior parte degli strumenti per l'orario si scambia; la versione 2.5 è del 2021.
  - **railML 3.x** è la riprogettazione sulla topologia RailTopoModel; la 3.2 è dell'aprile 2022, la 3.3 del novembre 2024.
- **Accesso:** gli schemi sono distribuiti agli utenti registrati, con licenze Creative Commons ristrette (senza opere derivate).

**Struttura di un orario.** Le due versioni pensano l'orario in modo diverso:
- **railML 2:** un `trainPart` porta una lista di `ocpTT` (punti operativi dell'orario) con `times` e `stopDescription`. Gli elementi `train` raccolgono le parti sotto un numero di treno, e gli `operatingPeriod` danno i giorni come maschera di bit.
- **railML 3:** separa il percorso nello spazio dai treni che lo usano. Un `baseItinerary` è una successione di `baseItineraryPoint`, ciascuno con i suoi `times` (commerciali od operativi), uno `stop` (con `minDwellTime`) o un `pass`. Un `itinerary` prende intervalli di itinerari base, eventualmente spostati nel tempo. Un `operationalTrain` rimanda a un itinerario e a una `validity` (maschera di bit) e porta il suo `OperationalTrainNumber`.

Un solo itinerario base può servire un intero orario cadenzato attraverso gli scostamenti: è la differenza più netta rispetto agli standard dei passeggeri, che elencano ogni corsa.

**In YuTreno**, da `examples/feeds/railml/timetable.xml`:

```xml
<baseItinerary id="bi-r-2101">
  <baseItineraryPoint id="bip-r-2101-2" locationRef="op-san-felice-scalo">
    <times scope="commercial"><arrival time="08:09:20"/><departure time="08:11:00"/></times>
    <stop minDwellTime="PT20S"/>
  </baseItineraryPoint>
  …
<operationalTrain id="ot-r-2101">
  <operationalTrainVariant id="otv-r-2101" itineraryRef="it-r-2101" validityRef="va-1">
    <identifiers><identifier number="R 2101" type="OperationalTrainNumber"/></identifiers>
```

railML è l'unico dei tre formati che porta la **sosta minima**, quella che YuTreno usa per decidere quando un servizio può partire. Per questo l'andata e ritorno attraverso railML restituisce i servizi anche con le soste.

**Stato.** L'esportazione railML segue il modello dei dati railML 3.2 come è pubblicato sul wiki di railML. **Non è stata validata contro l'XSD**, che non si poteva scaricare dall'ambiente in cui è stata scritta. `scripts/feeds-validate.ts --railml <cartella con railml3.xsd>` la valida appena lo schema è disponibile.

## Quando il piano cambia: soppressioni e nuovi orari

Un regolatore ([REGOLATORE.md](REGOLATORE.md)) può spostare orari, saltare fermate e sopprimere treni durante la corsa. Gli standard concordano su un principio: l'orario pubblicato resta quello programmato, e i cambiamenti sono informazione in tempo reale.

| Cambiamento | GTFS-Realtime | SIRI-ET | Orari statici |
| :-- | :-- | :-- | :-- |
| nuovo orario | `StopTimeUpdate` con l'orario previsto; `delay` rispetto al programmato | `Expected…Time` accanto all'`Aimed…Time` invariato | invariati |
| fermata saltata, o tolta perché ora il treno termina prima | `StopTimeUpdate.schedule_relationship = SKIPPED`, senza orari | `EstimatedCall` con `<Cancellation>true</Cancellation>` e gli orari programmati | invariati |
| treno soppresso per intero | `TripDescriptor.schedule_relationship = CANCELED`, senza aggiornamenti di fermata | `EstimatedVehicleJourney` con `<Cancellation>true</Cancellation>`, tutte le chiamate cancellate | invariati |
| treno che termina prima | la stazione dove termina è la sua ultima fermata con orari | quella stazione è una `RecordedCall` | invariati |

La posizione degli elementi segue lo schema: in SIRI la soppressione di una corsa viene subito dopo `FramedVehicleJourneyRef` (l'`EstimatedTimetableAlterationGroup`), quella di una chiamata subito dopo `StopPointName`. `verify-feeds` controlla i quattro casi con un regolatore scritto a mano. Due cose non si pubblicano ancora: il motivo di un cambiamento (situazioni SIRI-SX, Alerts di GTFS-Realtime) e i cambi di binario.

**Coincidenze e veicoli.** La fase della rete nel piano aggiunge le coincidenze fra treni e lo stesso treno che prosegue come un altro servizio. Gli standard hanno già il posto per entrambe:
- in NeTEx, `ServiceJourneyInterchange`, che nel profilo EPIP porta `StaySeated`, `CrossBorder` e `StandardTransferTime`; il NeTEx completo aggiunge `Guaranteed` e `MaximumWaitTime`;
- in SIRI-ET, la coincidenza monitorata con `Guaranteed`, `MaximumWaitTime`, `WillWait` e `ConnectionMonitoring`;
- in GTFS, `transfers.txt` per le coincidenze e `block_id` per le corse fatte dallo stesso veicolo;
- in railML 3, `vehicleRostering` con `block` e `blockConnection` per i giri del materiale.

## La stessa corsa in cinque formati

| Concetto | Transmodel | NeTEx | SIRI | GTFS / GTFS-RT | railML 3 | railML 2 | YuTreno |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| un treno | corsa | `ServiceJourney` | `DatedVehicleJourneyRef` | trip, `trip_id` | `operationalTrain` | `trainPart` / `train` | servizio, `ServiceDef` |
| il suo numero | numero di treno | `TrainNumber/ForAdvertisement` | `VehicleJourneyName` | `trip_short_name` | `identifier` `OperationalTrainNumber` | `trainNumber` | `id` |
| una stazione | luogo di fermata | `StopPlace` | — | `stop` con `location_type=1` | `operationalPoint` | `ocp` | stazione della linea |
| dove ferma | punto di fermata, marciapiede | `ScheduledStopPoint`, `Quay` | `StopPointRef` | `stop_id` (marciapiede) | `locationRef` | `ocpRef` | stazione e senso |
| l'ordine delle fermate | schema di corsa | `ServiceJourneyPattern` | `JourneyPatternRef`, `Order` | `stop_sequence` | `baseItinerary` | `sequence` | ordine di `stops` |
| un orario | orario di passaggio | `TimetabledPassingTime` | `Aimed…Time` | `stop_times.txt` | `times/arrival`, `departure` | `times@arrival` | `arrival_s`, `departure_s` |
| dopo mezzanotte | scostamento di giorno | `DayOffset` | data e ora complete | ore oltre le 24 | `dayOffset` | `arrivalDay` | secondi oltre 86400 |
| i giorni | tipo di giorno, periodo | `DayTypeAssignment` | `DataFrameRef` | `calendar*.txt` | `validity/bitmaskValidity` | `operatingPeriod@bitMask` | giorno di servizio |
| sosta minima | — | — | — | — | `stop@minDwellTime` | `stopDescription` | `min_dwell_s` |
| che cosa è successo | fermata registrata | — | `Actual…Time`, `RecordedCall` | `StopTimeUpdate` | — | — | `realised` |

## Strumenti di validazione

| Formato | Strumento | Come lo usa YuTreno | Esito |
| :-- | :-- | :-- | :-- |
| NeTEx | XSD del profilo italiano (5T) con `xmllint` | `scripts/feeds-validate.ts --netex` | 24/24 validi |
| SIRI | XSD ufficiale (`siri.xsd`, release 2.3) con `xmllint` | `scripts/feeds-validate.ts --siri` | 48/48 validi |
| GTFS | validatore MobilityData 7.1.0 | `scripts/feeds-validate.ts --gtfs-validator` | 0 errori, 2 avvisi attesi |
| GTFS-RT | `gtfs-realtime-bindings` | `verify-feeds` | decodificato e confrontato con l'origine |
| railML 3.2 | XSD da railML.org (registrazione) | `scripts/feeds-validate.ts --railml` | non ancora eseguito |
| tutti | andata e ritorno esportazione → importazione | `verify-imports` | servizi identici |

## Dove YuTreno si discosta dai profili italiani

I flussi sono vicini ai profili ma non identici, per ragioni che stanno soprattutto nella natura di un simulatore:
- **Azienda:** l'azienda non ha partita IVA, a meno di passare `--vat`. Senza, l'identificativo resta nella forma generale del profilo.
- **Flussi in push:** YuTreno serve SIRI Lite su richiesta; non spinge i dati verso un sottoscrittore. Mancano quindi i campi dell'invio dal RAP al NAP (`SubscriberRef`, `SubscriptionRef`, `ResponseMessageIdentifier`, `ItemIdentifier`), e non c'è `/siri/subscribe`.
- **Flussi e campi assenti:** non ci sono i flussi SX, FM e PT, né `Occupancy`, `VehicleStatus` o `ConfidenceLevel`. La simulazione non ha ancora perturbazioni annunciate ai passeggeri né carico. L'ET del profilo italiano può portare il numero di saliti e scesi (`RecordedDepartureOccupancy`), che la fase dei passeggeri del piano potrebbe riempire.
- **Testo esposto:** `PublishedLineName` è il nome della linea, perché una linea simulata non ha un codice pubblico.

## Fonti

**Normativa**
- [Direttiva 2010/40/UE e Regolamento delegato (UE) 2017/1926, testo consolidato](https://eur-lex.europa.eu/eli/reg_del/2017/1926/2024-03-04) (EUR-Lex)
- [Informazione multimodale: la revisione 2024/490](https://transport.ec.europa.eu/transport-themes/smart-mobility/road/its-directive-and-action-plan/multimodal-travel-information_en) (Commissione europea)
- [Il contesto normativo europeo di Transmodel, NeTEx e SIRI](https://transmodel-cen.eu/index.php/legal-context/) (transmodel-cen.eu)
- [DG MOVE, il regolamento MMTIS rivisto](https://www.ttsitalia.it/wp-content/uploads/2024/11/Petra-Soderqvist_DG_MOVE.pdf), TTS Italia, novembre 2024
- [Regolamento di esecuzione (UE) 2026/253, STI Telematica](https://eur-lex.europa.eu/eli/reg_impl/2026/253/oj) (EUR-Lex); [scheda in italiano](https://www.certifico.com/trasporto/trasporto-ferroviario/regolamento-di-esecuzione-ue-2026-253)

**Italia**
- [Punto di accesso nazionale per l'informazione multimodale](https://www.cciss.it/nap/mmtis/public/en/static/multimodal) (CCISS, Ministero delle Infrastrutture e dei Trasporti)
- [Profilo italiano di NeTEx](https://netex-cen.eu/?p=710) (netex-cen.eu) e [repository con XSD, linee guida e interfaccia RAP](https://github.com/5Tsrl/netex-italian-profile) (5T)
- [Profilo italiano di SIRI: linee guida, esempi, interfaccia del RAP dinamico](https://github.com/5Tsrl/siri-italian-profile) (5T)
- [5T, i profili italiani NeTEx e SIRI e i RAP](https://www.ttsitalia.it/wp-content/uploads/2024/11/Fabrizio-Arneodo_5T.pdf), TTS Italia, novembre 2024

**Transmodel, NeTEx, SIRI**
- [Schema NeTEx](https://github.com/NeTEx-CEN/NeTEx), [release di SIRI](https://github.com/TransmodelEcosystem/SIRI/releases) (TransmodelEcosystem) e [schema SIRI del CEN](https://github.com/SIRI-CEN/SIRI)
- [PTI, aggiornamento sugli standard europei, giugno 2026](https://pti.org.uk/system/files/meeting_files/papers/20260604%20European%20update.pdf)

**GTFS**
- [Riferimento GTFS-Realtime](https://github.com/google/transit/blob/master/gtfs-realtime/spec/en/reference.md) e [gtfs-realtime.proto](https://www.github.com/MobilityData/gtfs-realtime-bindings/blob/master/gtfs-realtime.proto)
- [Pioneering open data standards: the GTFS story](https://beyondtransparency.org/part-2/pioneering-open-data-standards-the-gtfs-story/)
- [Validatore GTFS di MobilityData](https://github.com/MobilityData/gtfs-validator)
- [Trasbordo a bordo: corse fatte dallo stesso veicolo](https://developers.google.com/transit/gtfs/examples/block-transfer-example) (Google Transit)

**railML**
- [Cronologia delle versioni di railML](https://railML.org/en/version-timeline.html)
- [Modello dei dati dell'orario railML 3.2](https://wiki3.railml.org/DataModel/3.2/TT/EARoot/EA77.htm)
- [Guida alla modellazione dei giri del materiale in railML 3](https://wiki3.railml.org/wiki/Dev:Guide_on_modelling_of_rollingstock_circulations_in_railML_3)
- Pagine del wiki railML 3 su [operationalTrain](https://wiki3.railml.org/wiki/TT:operationalTrain), [itinerary](https://wiki3.railml.org/wiki/TT:itinerary), [baseItineraryPoint](https://wiki3.railml.org/wiki/TT:baseItineraryPoint), [bitmaskValidity](https://wiki3.railml.org/wiki/Generic:bitmaskValidity) e [operationalPoint](https://wiki3.railml.org/wiki/IS:operationalPoint)
