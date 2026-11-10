# Architettura del codice

> Copia italiana. Il documento di riferimento è la versione inglese [ARCHITECTURE.md](../ARCHITECTURE.md): nomi di file, comandi e formati seguono quella; i nomi italiani della versione 0.x (campi JSON, opzioni come `--linea` o `--bordo`) restano accettati.

Questa guida è per chi modifica YuTreno. Spiega come sono divise le parti, come scorrono i dati durante una corsa e dove mettere le mani per le modifiche più comuni. Per usare il simulatore basta la [guida d'uso](GUIDA.md); per scrivere un controllore c'è l'[API](API.md). Ogni componente ha il suo documento di progetto in [progetto/](progetto/LEGGIMI.md).

## Un nucleo, tre modi di farlo girare

Il codice è diviso in strati. Il confine fra loro è la regola più importante del progetto.

`src/core/` contiene tutta la simulazione: la compilazione della linea, i treni predefiniti, il segnalamento con la supervisione di bordo, la dinamica, il bordo di riferimento, il piazzale della terra con apparato, gli scenari e il verdetto. Non importa nulla dal browser né da Node. Per questo la stessa classe `Simulation` gira in tre posti senza modifiche: nella pagina, dentro il Web Worker che ospita un controllore JavaScript e nel processo Node delle corse senza grafica.

Dalla fase 8 la classe `Simulation` (`simulation.ts`) è il direttore d'orchestra della corsa: tiene lo stato (`run-state.ts`) e l'ordine delle operazioni di un passo, e affida ogni parte del lavoro a un modulo che riceve la corsa come primo argomento:

| Modulo | Che cosa fa |
| :-- | :-- |
| `trains.ts` | crea il treno comandato e i treni di servizio, su una linea o su una rete |
| `dynamics.ts` | i modelli a punto materiale e multimassa, il modello esterno, i comandi che arrivano a trazione e freni; `FIXED_DT` |
| `onboard-bridge.ts`, `trackside-bridge.ts`, `regulator-bridge.ts` | gli scambi con il bordo ETCS, la terra con apparato e il regolatore |
| `commands.ts` | gli eventi dello scenario, i guasti, le decisioni del regolatore e i comandi del dirigente |
| `traffic.ts` | autorizzazioni dai segnali e, con `spacing: 'moving_block'`, dalla coda confermata del treno davanti (`movingAuthority`), orientamento del binario unico, itinerari di nodo, comparsa dei servizi, coincidenze |
| `leader.ts` | il treno che precede: il `freight` della linea come treno merci di servizio, le sue fermate, il suo orario per l'apparato |
| `boarding.ts` | i passeggeri alle fermate dei treni |
| `outputs.ts`, `control-room.ts` | osservazione, CSV, risultati, verdetto, orario realizzato, riepilogo, istantanea della sala di controllo |

I metodi pubblici di `Simulation` non sono cambiati. I moduli importano dalla classe solo i tipi, quindi fra loro non ci sono cicli, e ogni passo dello spostamento ha lasciato le 234 corse del golden master identiche byte per byte.

`src/trackside/` contiene la terra con apparato: apparato, RBC e Tabella delle Condizioni. Non importa nulla dal motore (solo i tipi e lo strato di compatibilità), ed è il motore a importarla.

`src/web/` è l'interfaccia. Legge lo stato della simulazione per disegnarlo e le manda comandi, ma non decide niente di fisico o di segnalamento. Se un comportamento del treno dipende da una riga di `src/web/`, è nel posto sbagliato.

`src/feeds/` trasforma una corsa in dati aperti (GTFS, GTFS-Realtime, SIRI, NeTEx profilo italiano, railML) e importa orari GTFS, NeTEx e railML come treni di servizio. Come il nucleo non importa nulla dal browser né da Node, e si limita a leggere la simulazione ([progetto/dati-aperti.md](progetto/dati-aperti.md)).

`src/infra/` importa l'infrastruttura reale: una linea da un estratto Overpass di OpenStreetMap e da un risultato di un'interrogazione RINF, con la provenienza di ogni dato e un rapporto dell'importazione ([IMPORTAZIONE_INFRA.md](IMPORTAZIONE_INFRA.md)). Come i flussi non importa nulla dal browser né da Node; `src/server/import-infra.ts` è la sua riga di comando (`npm run import-infra`).

`src/server/` contiene gli strumenti Node: `headless.ts`, che esegue corse e campagne di scenari con un controllore JavaScript o esterno, `bridge.ts`, che porta la pagina verso programmi esterni su TCP o come processi, `agent-env.ts` per gli agenti esterni e `feeds-server.ts`, che serve in HTTP i flussi di dati aperti di una corsa.

Accanto a questi, `src/docs/` genera la pagina che descrive il modello dinamico. I suoi grafici e il laboratorio chiamano il nucleo, quindi vanno ricontrollati quando il modello cambia.

## Nomi e compatibilità

Fino alla versione 0.1 ogni nome di YuTreno era italiano; dalla versione 0.2 codice, formati e protocolli sono in inglese, con i nomi degli standard dove uno standard esiste (variabili del Subset-026, telegrammi EULYNX). `src/core/legacy.ts` mantiene in funzione la versione 0.x:

- `toEnglish(x)` traduce chiavi e valori di qualunque ingresso (scenari, linee, treni, comandi, risposte dei programmi esterni, configurazioni salvate nel browser) con il glossario `KEYS_IT_EN` e le mappe dei valori `VALUES_IT_EN`. Si applica dove gli ingressi entrano nel nucleo: `validateScenario`, `resolveScenario`, `applyCommand`, `dynamicsResponse`, `onboardResponse`, `tracksideResponse`, `ReferenceEvc.step`, `Trackside.step`.
- `toLegacy(x, kind)` produce il formato italiano della versione 0.x per le osservazioni (versioni 1 e 2) e per le richieste della dinamica, del bordo e della terra (protocollo versione 1), conservando l'ordine delle chiavi.

I nomi nuovi entrano nel glossario solo se un formato della versione 0.x usava quello italiano: un campo nato in inglese non ha bisogno di niente.

## La corsa: passo fisso e determinismo

Una corsa nasce da quattro ingredienti: la definizione della linea, i parametri del treno, le condizioni (segnalamento, ora del giorno, meteo, aderenza, bordo, terra) e, facoltativo, uno scenario. `compileLine()` trasforma la linea JSON in una `CompiledLine` campionata ogni 10 m, con curvatura, direzione, quote, limiti contigui, stazioni, gallerie e segnali generati dalle stazioni e dal passo del blocco. Il costruttore di `Simulation` prepara poi la composizione (multimassa o punto materiale), il treno che precede e lo stato iniziale.

Il tempo avanza solo con `step(FIXED_DT)`, a passi di 5 ms. A ogni passo, in ordine:

1. si applicano gli eventi dello scenario che scattano;
2. il blocco aggiorna aspetti dei segnali e autorizzazione al movimento (con più treni, fra cui il treno che precede, dall'occupazione di tutti);
3. la supervisione di bordo calcola curve e stato;
4. la dinamica integra le forze;
5. si controllano superamenti, interventi della protezione, vigilanza, fermate e fine corsa.

Dopo ogni passo chi guida il ciclo chiama `sample()`, che ogni mezzo secondo aggiunge una riga al registro della corsa (il CSV).

Nessuna parte del nucleo usa l'orologio di sistema o numeri casuali non ripetibili, quindi con gli stessi ingredienti e gli stessi comandi due corse producono dati identici byte per byte. `verify-ato` e `verify-scenarios` lo controllano confrontando le impronte dei CSV. Una modifica che rompe il determinismo è un errore anche se il treno sembra comportarsi bene.

## Comandi e controllori

Il macchinista e i controllori parlano con la simulazione nello stesso modo. `observe(period)` restituisce un oggetto di sola lettura con ciò che si vede in cabina: velocità, posizione, DMI, segnale, eventi annunciati. `applyCommand(command)` imposta trazione, freno, vigilanza o urgenza. Gli eventi non annunciati di uno scenario, come le foglie o un freno degradato, non compaiono mai nell'osservazione.

L'osservazione ha tre versioni ([API.md](API.md#versioni)). La versione 3, predefinita, ha i nomi inglesi e contiene `etcs_ato`: i dati che il bordo passa all'ATO secondo il Subset-130 (`EtcsAtoData` in `types.ts`). `Simulation.etcsAto()` li prende da `atoData()` in `signalling.ts` con la supervisione interna, oppure dal campo `dmi.ato` della risposta con un bordo a messaggi, convertendo le letture dell'odometro in progressive di linea. Il calcolo avviene solo quando un controllore chiede l'osservazione, quindi non costa niente alle corse senza controllore. Il bordo di riferimento li calcola invece a ogni ciclo, come farebbe un EVC vero.

I controllori vanno al passo con la simulazione. Ogni `period` secondi di tempo simulato la simulazione si ferma, manda l'osservazione e riprende solo quando arriva il comando. Così il risultato non dipende né dalla velocità del computer né dalla latenza della rete. Nel nucleo questo ciclo è `runLockstep()` in `controller.ts`, usato dalle corse senza grafica. Nella pagina lo stesso schema è nel ciclo di `main.ts`, che aspetta la risposta del Worker o del WebSocket fino a 1,5 s e ferma il controllore dopo tre attese a vuoto.

## Dinamica esterna

Con `model: 'external'` la dinamica non la calcola il nucleo ma un programma esterno, in co-simulazione. `Simulation` tiene uno stato `ext` con l'intervallo di accoppiamento e l'ultima risposta. Chi guida il ciclo chiede `dynamicsDue()` prima di ogni passo. Quando è vero, manda `dynamicsRequest()` al modello e passa la risposta a `dynamicsResponse()`; poi i passi di 5 ms interpolano fra lo stato di partenza e quello ricevuto. `step()` si rifiuta di avanzare se la risposta manca, così un ciclo scritto male si accorge subito dell'errore invece di produrre dati sbagliati.

I cicli sono tre, come per i controllori: `runLockstep()` con l'opzione `dynamics` per le corse senza grafica, `dynStep()` in `src/web/dynamics.ts` per la pagina, e i trasporti in `src/server/headless.ts` (`connectDynamics` per TCP a righe JSON e WebSocket, `spawnDynamics` per un processo figlio su stdin/stdout, `loadJsDynamics` per un modello JavaScript). `src/server/bridge.ts` è un server WebSocket minimo che porta le richieste della pagina a un modello su TCP o a un processo. Il protocollo è in [DINAMICA_ESTERNA.md](DINAMICA_ESTERNA.md).

## Bordo ETCS a messaggi

Con `onboard: 'reference'` o `'external'` nelle condizioni ETCS, la supervisione non è più `supervise()` di `signalling.ts`. `Simulation` tiene uno stato `ob` con i gruppi di boe (`buildBaliseGroups` in `simple-rbc.ts`), il RBC a messaggi (`Rbc`), le boe lette, i messaggi in attesa e l'ultima risposta del bordo. A ogni passo il RBC decide se parlare, i messaggi passano solo con la radio funzionante, e le boe passate dalla testa si accodano con la lettura dell'odometro. A ogni ciclo del bordo `onboardRequest()` impacchetta tutto e `onboardResponse()` applica comandi, messaggi per il RBC e la supervisione da mostrare.

Il bordo di riferimento (`ReferenceEvc` in `evc.ts`) si chiama dentro `step()`. Quello esterno lo serve chi guida il ciclo, con `onboardDue()`, esattamente come la dinamica esterna. `evc.ts` non importa nulla dal motore: dipende solo dai tipi del protocollo e dallo strato di compatibilità, e questo garantisce che un EVC esterno possa fare tutto quello che fa lui. Il protocollo è in [BORDO_ETCS.md](BORDO_ETCS.md).

## Terra con apparato e RBC

Con `trackside: 'interlocking'` o `'external'` (solo ETCS con un bordo a messaggi) l'autorizzazione non viene più dal RBC di `simple-rbc.ts`. Il motore tiene uno stato `tr` con il piazzale (`Field` in `field.ts`: deviatoi, circuiti di binario e rami presi dai treni), i messaggi del bordo e i comandi del posto centrale in attesa e l'ultimo quadro. A ogni ciclo della terra `tracksideRequest()` impacchetta i telegrammi EULYNX del piazzale, i messaggi radio e i comandi; `tracksideResponse()` applica i comandi agli enti, passa i messaggi radio al bordo e conserva il quadro. Dopo la dinamica `field.step()` aggiorna movimenti, rami e occupazioni.

La logica sta in `src/trackside/`: l'apparato (`interlocking.ts`), il RBC (`rbc.ts`), la Tabella delle Condizioni con il traduttore (`control-table.ts`) e la classe `Trackside` (`index.ts`) che li espone dietro il protocollo. Come `evc.ts`, `src/trackside/` non importa nulla dal motore, che invece importa `../trackside`. La terra nel processo si chiama dentro `step()`, dopo il bordo nel processo; quella esterna la serve chi guida il ciclo, con `tracksideDue()`, e `tracksideRequest()` fa scambiare prima il bordo nel processo, così l'ordine è sempre bordo poi terra. Il protocollo e le semplificazioni sono in [TERRA.md](TERRA.md).

Con `rbc_borders_m` nello scenario, `Simulation.rbcAreas()` trasforma i confini nel campo `rbcs` della configurazione della terra e `Trackside` fa girare un `TracksideRbc` per area: i messaggi fra RBC restano dentro la terra, consegnati un ciclo dopo. Dal lato del motore cambiano solo `NID_RBC` sui messaggi radio, che il ponte del bordo e quello della terra usano per tagliare la radio di un solo RBC (`FaultState.radioRbc`), e i superamenti contati solo sui messaggi dell'RBC di supervisione (il `NID_RBC` dell'autorizzazione del quadro).

## Rete

Con `network` nello scenario il motore compila una rete (`src/core/network.ts`): linee che si incontrano nelle stazioni in comune, la prima delle quali è la linea principale `L`. Ogni servizio ha un itinerario, compilato in un corridoio: una linea compilata come `L`, così il treno avanza in una dimensione come su una linea sola, con le tratte che dicono da quale linea e in quale verso viene ogni pezzo. Un corridoio su una sola linea è quella linea (o quella ribaltata), lo stesso oggetto. A ogni passo il motore calcola gli aspetti dei segnali di ogni linea e verso in uso, dai treni su quella linea (`onLine`), li copia sui corridoi di più linee e applica gli itinerari di nodo, che danno la stazione di un nodo a un treno alla volta dove i treni entrano in una linea da un'altra. Con la terra con apparato ogni linea ha il suo apparato e il suo piazzale, e gli itinerari di nodo del motore sono sostituiti dagli itinerari degli apparati attraverso i nodi. Senza rete la rete è `L` da sola e non cambia niente. Vedi [progetto/rete.md](progetto/rete.md).

## Sala di controllo

`Simulation.controlRoom()` (`src/core/control-room.ts`) restituisce un'istantanea della circolazione: linee con stazioni, segnali e aspetti, sezioni di blocco e loro occupazione, orientamenti del binario unico, itinerari di nodo e, con l'apparato, sezioni, deviatoi e itinerari; i treni con la posizione su ogni linea, il ritardo, la prossima fermata e lo stato; il registro. Legge soltanto la corsa. La scheda *Control room* la disegna (`src/web/control-room.ts`), con lo schema disposto dalla topologia della rete, e il server dei dati aperti la serve su `/control-room`. È un formato pubblico e versionato che cresce solo con campi facoltativi. Vedi [SALA_CONTROLLO.md](SALA_CONTROLLO.md).

## Regolatore della circolazione

Con `regulator: 'reference'` o `'external'` il motore tiene uno stato `reg` e, a ogni ciclo del regolatore (5 s se non indicato), manda una `RegulatorRequest` con ogni treno (piano, orario corrente, tempi realizzati, posizione, guasti, priorità), i disservizi in corso e, con l'apparato, lo stato degli itinerari. `regulatorResponse()` applica le decisioni: `retime` cambia gli orari di una fermata in `run.stations` (l'orario originale resta in `run.plan`), `skip_stop` toglie una fermata, `track` e `priority` impostano il binario e la priorità di un treno, `operator` passa un comando del posto centrale all'apparato. Con l'apparato ogni cambio di orario o di priorità gli arriva come comando del posto centrale (`timetable`, `priority`). Il regolatore nel processo si chiama in `step()` prima della terra; quello esterno lo serve chi guida il ciclo, con `regulatorDue()`, prima dello scambio con la terra, quindi l'ordine è lo stesso. Il regolatore di riferimento sta in `src/regulator/` e, come la terra, importa solo i tipi. Vedi [REGOLATORE.md](REGOLATORE.md).

## Passeggeri

Con `passengers` nello scenario la simulazione possiede un `PassengerModel` (`src/core/passengers.ts`, [PASSEGGERI.md](PASSEGGERI.md)), un modello aggregato puro delle banchine e delle persone a bordo. Il motore lo chiama solo in tre momenti: quando le porte di un treno si aprono (`paxOpen`: discese, salite, sosta necessaria, che va in `S.paxDue` e tiene le porte aperte), quando si chiudono (`paxClose`: ritardatari e passeggeri lasciati a terra) e quando il treno comandato lascia la sua origine. Dopo ogni chiamata `setPayload()` porta la massa delle persone a bordo in `TR.m`, `ME` e, nel modello multimassa, nei veicoli (`MultiState.pay`). Gli arrivi di Poisson si estraggono da un generatore con seme nell'ordine delle chiamate, che il passo fisso rende deterministico. Senza passeggeri `pax` è nullo e niente di tutto questo gira.

## Il ciclo dell'interfaccia

`main.ts` chiama `frame()` a ogni fotogramma del browser. Il tempo reale trascorso, moltiplicato per l'accelerazione scelta, si accumula; la simulazione avanza di quanti passi fissi stanno nell'accumulatore, con un tetto per fotogramma. Poi disegna.

Il disegno sta in due moduli. `render.ts` lavora su canvas 2D: DMI, schema della linea, grafico distanza-velocità, forze negli accoppiatori e la vista essenziale dalla cabina. `view3d.ts` disegna la vista 3D con Three.js. Il DMI si disegna sempre per primo, perché il suo canvas è anche la texture dello schermo sul banco della cabina 3D.

`state.ts` raccoglie lo stato condiviso dell'interfaccia: la configurazione salvata nel browser, la simulazione corrente in `app.sim`, i riferimenti abbreviati `S`, `L`, `TR`, `F` e le funzioni di formattazione. `store` avvolge `localStorage`, così una pagina con la memoria bloccata funziona lo stesso.

## La vista 3D

`view3d.ts` (con le sue parti `world3d.ts`, `path3d.ts`, `trains3d.ts`, `cab3d.ts` e lo stato condiviso `view3d-state.ts`) costruisce il mondo una volta per corsa, a partire dalla linea compilata, e lo ricostruisce solo se cambiano linea, segnalamento, treno che precede o qualità. Tutto è funzione deterministica della progressiva `s` e di `hash()`, quindi la stessa linea produce sempre lo stesso paesaggio.

Le coordinate seguono il binario: l'asse x di Three.js è la x della planimetria, l'asse z è la y con il segno cambiato, l'altezza è la quota meno quella di partenza. `frame(s)` dà posizione, direzione di marcia e destra in ogni punto. `sweep()` estrude una sezione lungo il binario, e da lì vengono massicciata, rotaie, banchine, pensiline e volta delle gallerie. Le sezioni vanno descritte in senso antiorario guardando nel verso di marcia, con la destra verso le x positive, perché le normali puntino verso l'esterno. Il terreno è un nastro largo tre chilometri. Vicino al binario è basso, sale in rilevati sopra le gallerie e lontano diventa collina; all'imbocco di una galleria si apre in una trincea davanti al portale.

Gli oggetti ripetuti sono istanziati: traverse, pali, alberi, case, luci delle gallerie. Le traverse sono le sole che si muovono: una finestra di istanze davanti al treno si ricolloca quando il treno avanza di 30 cm.

I treni della corsa, compreso quello guidato, si costruiscono una volta come gruppi di carrozze (`buildServices()`) e si collocano a ogni fotogramma sulla linea che il mondo disegna (`placeServices()`). La camera sta nella cabina di `viewTrain()`: il treno guidato, oppure il treno scelto in *Ride in* mentre è in corsa. Il mondo si costruisce da una linea della rete (`lineIdx`): la linea principale, o la linea su cui sta la testa del treno in cui si viaggia, quindi si ricostruisce quando quel treno passa su un'altra linea, e le carrozze sulle altre linee sono nascoste; resta una funzione deterministica di quella linea compilata. Per un treno in senso opposto la camera guarda verso l'origine dal secondo binario nelle stazioni; il modello della cabina si mostra solo nel treno guidato, e il treno in cui sta la camera non si disegna. Le persone in attesa sulle banchine sono due mesh istanziate con i posti fissati quando si costruisce il mondo (`buildPeople()`); a ogni fotogramma `placePeople()` ne mostra tante quante `PassengerModel.waitingTo()` ne dà per ogni banchina, una lettura pura della corsa.

La cabina è un gruppo figlio della camera. Contiene il banco inclinato, il DMI, i manometri della condotta generale e dei cilindri del freno, il manipolatore, i pulsanti di vigilanza e urgenza, le spie e il tergicristallo. I manometri sono indicativi: la pressione nella condotta non è simulata, quindi l'ago segue il comando di frenatura.

Le tre qualità cambiano densità dei pixel, ombre, distanza di vista, numero di traverse e densità degli alberi. Se WebGL non è disponibile `init3d()` restituisce false e la pagina resta sulla vista 2D.

## Build e verifiche

`scripts/build.mjs` impacchetta l'interfaccia con esbuild in `dist/app.js` e produce anche `dist/yutreno.html`, un file unico che si apre con un doppio clic, e `dist/artifact.html`, lo stesso contenuto senza intestazione per la pubblicazione. A parte genera la pagina del modello `dist/model.html`. I controllori di esempio `examples/ato.js` ed `examples/ato_s130.js` entrano nel pacchetto come testo, perché la pagina li mostra nell'editor.

Le immagini in `docs/img/` si rigenerano con `scripts/screenshots.mjs`, che apre la build con Playwright; le istruzioni sono in cima al file.

`npm run verify` esegue tutti gli `scripts/verify-*.ts`, più d'uno alla volta. Le verifiche provano il simulatore, non i controllori. `npm run golden` conserva le impronte di 234 corse (`golden/fingerprints.json`): una modifica che non deve cambiare il comportamento le deve lasciare tutte invariate, e una che lo cambia di proposito le aggiorna nello stesso commit ([progetto/strumenti.md](progetto/strumenti.md)). Se una modifica cambia di proposito la fisica, i valori di riferimento in `verify-ato.ts` si aggiornano nello stesso commit; `PRINT_REF=1` li stampa.

I test che controllano un requisito portano un'etichetta `// @test <id>: <title> [<requirement ids>]`. `scripts/traceability.ts` le raccoglie in `docs/traceability/tests.csv` e riempie la colonna `tests` della matrice; `verify-traceability` fallisce se un requisito implementato o semplificato non ha test o se i file non sono aggiornati.

## Modifiche frequenti

**Un nuovo tipo di evento negli scenari.** Si aggiunge il tipo in `FaultType` e `FAULT_TYPES` (`scenario.ts`), la validazione e la descrizione nello stesso file e l'effetto in `applyFault()` (`commands.ts`). Se l'evento si vede a bordo va in `ANNOUNCED_BY_DEFAULT`. Se la versione 0.x aveva un nome italiano per esso, lo si aggiunge alla mappa dei valori di `legacy.ts`. Infine un test in `verify-scenarios.ts` e una riga nella tabella di [SCENARI.md](SCENARI.md).

**Un nuovo scenario.** Il file va in `scenarios/` e nell'elenco di `src/web/scenarios.ts`, e il suo esito con `examples/ato.js` in `verify-scenarios.ts`. La procedura passo per passo è in [GUIDA_SCENARI.md](GUIDA_SCENARI.md).

**Una nuova linea o un nuovo treno predefiniti.** Si aggiungono in `presets.ts`. Diverse verifiche fanno girare il controllore di esempio su ogni linea predefinita: servono i riferimenti in `verify-ato.ts` e la lunghezza in `verify-line.ts`.

**Una nuova rete predefinita.** Va in `NETWORK_PRESETS` (`presets.ts`), con le sue linee fra le linee predefinite; i nodi sono le stazioni con lo stesso nome. Uno scenario su di essa va in `scenarios/services/`, in `src/web/scenarios.ts` e in `verify-network.ts`.

**Un nuovo campo nella richiesta o nella risposta della dinamica esterna.** Si aggiunge in `DynamicsRequest` o `DynamicsResponse` (`types.ts`) e in `dynamicsRequest()` o `dynamicsExternal()`, poi negli esempi (`examples/dynamics_point.js`, `python/yutreno_dynamics.py`, `matlab/`) e in [DINAMICA_ESTERNA.md](DINAMICA_ESTERNA.md). I campi nuovi della risposta devono essere facoltativi, perché i modelli esistenti non li mandano.

**Un nuovo pacchetto o messaggio ETCS.** Lo produce il RBC in `Rbc.tick()` (`simple-rbc.ts`) e, con la terra con apparato, in `TracksideRbc.cycle()` (`trackside/rbc.ts`), con i nomi delle variabili del Subset-026 e le iterazioni in `elements`. Il bordo di riferimento lo legge in `ReferenceEvc.readRadio()`. Va documentato in [BORDO_ETCS.md](BORDO_ETCS.md), coperto in `verify-onboard.ts` e in `verify-subset026.ts`, e va aggiornata la riga della matrice.

**Un nuovo campo nell'osservazione.** Si aggiunge in `Observation` (`types.ts`) e in `observe()` (`outputs.ts`), poi in [API.md](API.md). I campi esistenti non cambiano nome, perché i controllori esterni ne dipendono. Le versioni 1 e 2 (`observe(period, 1|2)`) derivano dalla versione 3 con `toLegacy`: un campo nuovo entra nella versione 3; se deve comparire anche nella versione 2 con un nome italiano, si aggiunge il nome al glossario.

**Una nuova decisione del regolatore.** Va in `RegulatorCommand` (`types.ts`) come variante facoltativa, in `regulatorCommand()` di `commands.ts` con un motivo chiaro quando non si può applicare, in [REGOLATORE.md](REGOLATORE.md) e in `verify-regulator.ts`; `examples/regulator/regulator_stdio.ts` deve continuare a dare la stessa corsa del regolatore nel processo.

**Un nuovo ente o una nuova regola della terra.** Il piazzale sta in `field.ts` (fisica degli enti e telegrammi EULYNX), le regole in `src/trackside/interlocking.ts` e `rbc.ts`. Un nuovo telegramma va nei tipi di `src/trackside/types.ts` con i nomi e i codici del documento EULYNX, nella matrice di tracciabilità e in [TERRA.md](TERRA.md); un nuovo test in `verify-trackside.ts`. I campi nuovi del protocollo della terra devono essere facoltativi, e `examples/trackside/trackside_stdio.ts` deve continuare a dare la stessa corsa della terra nel processo.

**Una nuova misura nella campagna.** Si aggiunge come colonna in `runOne()` di `scripts/campaign.ts`, ed eventualmente nella sintesi, poi in [CAMPAGNA.md](CAMPAGNA.md). Le colonne di `runs.csv` devono restare deterministiche: niente tempi reali né percorsi del disco, che vanno in `metadata.json`.

**Un nuovo oggetto nel mondo 3D.** Va in `buildWorld()`, collocato con `placeAt(object, s, d, h)`: progressiva, distanza laterale (positiva a destra) e altezza sul piano del ferro. Se si ripete conviene una `InstancedMesh`.

## Regole di commit

Ogni commit contiene un solo blocco logico, con i file aggiunti uno per uno, e un messaggio nella forma `type(scope): summary`. Prima di committare devono passare `npm run typecheck` e `npm run verify`. Le regole complete sono in `CLAUDE.md`.
