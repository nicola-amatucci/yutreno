# Flussi di dati aperti

> Copia italiana di [feeds.md](../../design/feeds.md). In caso di differenze fa fede il testo inglese.

## Scopo

`src/feeds/` trasforma una corsa nei formati dell'informazione ai passeggeri e dello scambio degli orari: GTFS, NeTEx (profilo italiano EPIP) e railML 3.2 per l'orario programmato, GTFS-Realtime e SIRI 2.1 per posizioni e orari effettivi e previsti. `src/server/feeds-server.ts` li serve in HTTP mentre la corsa segue l'orologio. Nel verso opposto, importa orari GTFS, NeTEx e railML come treni di servizio (`src/server/import-timetable.ts`, scheda *Timetable*). La documentazione per l'utente è [DATI_APERTI.md](../DATI_APERTI.md).

Il componente legge la simulazione e non la scrive mai: i flussi sono funzioni pure di `Simulation`, quindi leggerli non cambia la corsa, e la stessa corsa dà gli stessi byte.

## Struttura

| File | Contenuto |
| :-- | :-- |
| `model.ts` | `FeedOptions`, georeferenziazione (`wgs84`, `bearing`), `ServiceCalendar`, identificativi (`Ids`), corse programmate (`trips`) e stato in tempo reale (`tripState`) |
| `gtfs.ts` | `gtfsFiles()`: i file di testo del flusso GTFS |
| `zip.ts` | `zip()`: archivio con voci non compresse e data fissa, senza dipendenze |
| `gtfs-rt.ts` | `gtfsRealtime()`: FeedMessage di VehiclePositions o TripUpdates con i nomi dei campi di `gtfs-realtime.proto`; `encodeFeed()`: scrittore protobuf che segue i numeri di campo della specifica |
| `siri.ts` | `siriVehicleMonitoring()`, `siriEstimatedTimetable()`: XML nell'ordine degli elementi dello schema SIRI 2.1 |
| `netex.ts` | `netexTimetable()`: PublicationDelivery con un CompositeFrame `EU_PI_LINE_OFFER` e i frame di calendario, risorse, luoghi, servizio e orario; numeri di treno come `TrainNumber` |
| `railml.ts` | `railmlTimetable()`: railML 3.2 (punti operativi, itinerari base con orari e soste minime, itinerari, validità, treni operativi); `importRailml()` per railML 3.x e 2.x |
| `xml.ts` | `parseXml()`: lettore XML minimo (nomi locali, attributi, testo) per le importazioni |
| `import.ts` | `ImportOptions`, `toServices()` (abbinamento alla linea, orari dall'inizio della corsa, scarti con avvisi), `normalService()`, `detectFormat()` |
| `import-gtfs.ts`, `import-netex.ts` | `importGtfs()` (con `parseCsv()`), `importNetex()` |
| `import-any.ts` | `importTimetable()`: riconosce il formato, decomprime il GTFS (`unzip()` in `zip.ts`, con la funzione di decompressione della piattaforma) |

Come il nucleo, `src/feeds/` non usa né il DOM né Node (il server aggiunge HTTP e gzip), così la pagina può produrre gli stessi file.

## Modello

**Corse.** `trips(sim)` elenca i treni della corsa con le fermate programmate nelle progressive della linea: per un treno che va contro il senso della linea la progressiva della stazione è specchiata (`L.len − s`). La prima fermata non ha arrivo e l'ultima non ha partenza, come in tutti e quattro i formati. Il treno guidato prende il numero `CONTROLLED_NUMBER` (`R 2001`); i servizi usano il loro id. Su una rete le progressive sono quelle del corridoio del treno, e ogni corsa porta la sua linea dei flussi (`line`), le funzioni di posizione e direzione (`pos`, `heading`, nel piano comune della rete) e il suo giro; `feedStations(sim)` dà ogni stazione una volta. Su una linea sola `pos` è `wgs84(L, s)` e l'uscita è identica a prima.

**Stato.** `tripState(sim, trip)` legge la testa del treno, la velocità, l'indice della prossima stazione (`S.nextSt`) e il registro `realised`. Il ritardo è quello dell'ultimo evento fatto (arrivo o partenza); gli orari previsti sono quelli programmati più il ritardo, solo se positivo. Ogni formato decide poi come presentarlo: GTFS-RT dà `delay` e `time` per ogni evento di fermata, SIRI-ET separa le `RecordedCalls` (fermate lasciate) dalle `EstimatedCalls`, SIRI-VM riporta la fermata monitorata, cioè la prossima.

**Calendario.** `ServiceCalendar` porta il tempo simulato a ora locale e a istanti: `originUtc` è il mezzogiorno locale meno dodici ore del giorno di servizio (la definizione GTFS), così gli orari dopo un cambio d'ora restano uguali all'orologio; gli scostamenti vengono da `Intl.DateTimeFormat` con il fuso IANA, arrotondati al minuto.

**Identificativi.** `Ids` costruisce `IT:<regione>:<tipo>:<codespace>:<slug>` per ogni oggetto; GTFS e SIRI usano gli identificativi NeTEx così come sono. Gli slug tolgono accenti e punteggiatura, quindi gli identificativi dipendono solo da nomi e opzioni.

**Geografia.** `wgs84(L, s)` ruota la pianta locale di `geo.rotation_deg` e la colloca in `geo.lat`, `geo.lon` con una proiezione equirettangolare; `bearing` prende la direzione fra due punti distanti 10 m e la gira di 180° per i treni contro il senso della linea.

## Invarianti

- I flussi non cambiano la corsa; le impronte di determinismo della campagna non dipendono da loro.
- Gli identificativi sono gli stessi in tutti i formati e in tutte le corse di uno scenario.
- I flussi statici (GTFS, NeTEx) dipendono dall'orario, non dall'avanzamento della corsa.
- Ogni riferimento NeTEx si risolve dentro la consegna, tranne i tipi di frame EPIP.
- Esportare e reimportare restituisce gli stessi servizi (forma normale; railML anche le soste minime).
- Le importazioni non scartano mai in silenzio: ogni fermata, corsa o giorno escluso finisce in `warnings`.
- L'uscita è valida contro gli schemi ufficiali: NeTEx contro `NeTEx_publication_EPIP.xsd` del profilo italiano, SIRI contro `siri.xsd`; il GTFS non ha errori nel validatore MobilityData.

## Prove

`scripts/verify-feeds.ts` (in `npm run verify`): calendario con ora solare, ora legale e giorno del cambio; integrità del GTFS (decompresso e letto), coordinate uguali a quelle della linea, indipendenza dall'avanzamento della corsa; GTFS-RT decodificato con `gtfs-realtime-bindings` e confrontato con l'oggetto di partenza e con la simulazione; identificativi SIRI presenti in NeTEx, fermate registrate uguali alle partenze fatte, ritardi uguali a GTFS-RT; riferimenti NeTEx e forma degli identificativi; determinismo. `scripts/verify-imports.ts` (in `npm run verify`): andata e ritorno di ogni scenario con servizi e di un orario di 25 treni attraverso GTFS, NeTEx e railML, file di altri produttori in ogni formato, lettori CSV e XML. `scripts/feeds-validate.ts` esegue i validatori ufficiali; i risultati sono in [DATI_APERTI.md](../DATI_APERTI.md#conformità).

## Estensioni

- **Un nuovo formato** (per esempio SIRI-SX o GTFS-Fares) va in un nuovo file di `src/feeds/` che usa `trips`, `tripState`, `ServiceCalendar` e `Ids`, con un endpoint nel server e controlli in `verify-feeds`.
- **Soppressioni e cambi di binario** richiedono prima che la simulazione li abbia; poi `tripState` li porta e i formati li traducono (`schedule_relationship`, `Cancellation`, `ArrivalPlatformName`).
- **Un nuovo formato da importare** produce `RawTrip[]` e li passa a `toServices`, che fa l'abbinamento; `detectFormat` e `importTimetable` lo riconoscono.
- **L'infrastruttura da railML** (punti operativi con posizioni, binari) permetterebbe a un orario importato di portarsi la propria linea; oggi le fermate si abbinano a una linea che esiste già.
