# Nucleo della simulazione

> Copia italiana di [core.md](../../design/core.md). In caso di differenze fa fede il testo inglese.

## Scopo

`src/core/` è l'intera simulazione, indipendente da dove gira. La stessa classe `Simulation` gira nella pagina, nel Web Worker di un controllore JavaScript e in Node per le corse senza grafica, le campagne e i controlli. Questo documento copre le parti del nucleo che non sono un sottosistema a sé: compilazione della linea, preset, ciclo della corsa, scenari e verdetto, strato di compatibilità. Dinamica, segnalamento, bordo di riferimento e RBC hanno documenti propri.

## Responsabilità

- Compilare la definizione di una linea in una rappresentazione campionata usata da tutte le altre parti.
- Tenere lo stato di una corsa e farla avanzare a passo fisso, con un ordine fisso delle operazioni.
- Applicare gli eventi degli scenari al loro tempo o alla loro posizione e tenere nascosto quello che il macchinista non può vedere.
- Produrre l'osservazione per i controllori, il CSV, il registro eventi, il riepilogo e il verdetto.
- Accettare ingressi scritti con i nomi italiani della versione 0.x.

Non è responsabile del disegno, dei trasporti (socket, processi) né della logica dei programmi esterni.

## Compilazione della linea (`line.ts`)

`compileLine(def)` trasforma una `LineDef` (vertici della pianta, profilo altimetrico, stazioni, limiti, gallerie, lunghezza della sezione di blocco, treno che precede, collocazione facoltativa `geo` sulla carta usata dai flussi di dati aperti) in una `CompiledLine` campionata ogni `STEP` = 10 m: x/y, rotta e curvatura da una spline Catmull-Rom attraverso i vertici, quota e pendenza dal profilo, limiti di velocità contigui, stazioni con il loro orario, gallerie e i segnali generati da `genSignals()` (segnale di partenza 250 m dopo ogni stazione, di protezione 400 m prima, segnali intermedi al passo del blocco). Le funzioni di interrogazione (`gradeOf`, `altOf`, `limitOf`, `tunnelOf`, `xyOf`, `minGrade`) leggono i campioni. Tutto ciò che segue lavora con progressive `s` in metri dall'origine.

## Preset (`presets.ts`)

`LINE_PRESETS` (`valle-lauro`, `appennino`), `TRAIN_PRESETS` (`regional`, `high_speed`, `freight`) con le loro composizioni e i loro aggancianti, `DEFAULT_SCENARIO` e i valori di aderenza per condizione della rotaia. I preset sono dati: cambiarli cambia i valori di riferimento di `verify-ato`.

## La corsa (`simulation.ts`)

`simulation.ts` contiene la classe, l'ordine di un passo e i piccoli metodi pubblici; i tipi dello stato stanno in `run-state.ts`, e il lavoro nei moduli elencati in [ARCHITETTURA.md](../ARCHITETTURA.md). Quel che segue descrive la corsa nel suo insieme, dovunque stia il suo codice.

Il costruttore riceve linea, treno, condizioni (`Scenario`: segnalamento, ora del giorno, meteo, aderenza, bordo, terra, periodi) e una `ScenarioDef` facoltativa. Compila la linea, costruisce la composizione, crea il treno che precede (un treno merci fra i `trains`, subito dopo quello comandato, `leader.ts`) e, secondo le condizioni, lo stato della dinamica esterna (`ext`), del bordo a messaggi (`ob`) e della terra con apparato (`tr`).

Lo stato di un treno sta in un `TrainRun`: parametri, `SimState`, stato multimassa (`mm`), stato della co-simulazione (`ext`) e bordo a messaggi (`ob`). `Simulation.trains` contiene i treni della corsa nell'ordine in cui avanzano: prima il treno comandato, `train` = `trains[0]`, poi i treni di servizio. Le scorciatoie `S`, `TR`, `ME`, `mm`, `ext`, `ob` leggono il treno comandato, per l'interfaccia, gli script e i controllori scritti su di esse. La dinamica (`dynamics(run, dt)` e i tre modelli), i comandi effettivi e gli scambi con il bordo e con la dinamica esterna ricevono il `TrainRun` su cui lavorano; i metodi pubblici usano di default il treno comandato. `step()` tiene la parte globale (scambi, tempo, eventi dello scenario, treno che precede) e chiama `stepTrain(run)` per ogni treno. Con i treni di servizio (`ScenarioDef.services`) i treni in più nascono inattivi, compaiono all'origine (`activate`) quando il binario è libero, sono guidati ogni 0,2 s da `autoDriver` (`auto-driver.ts`) e condividono i segnali: `updateSignals` imposta gli aspetti da tutti gli occupanti e dai segnali di partenza trattenuti da `heldSignals`, e ogni treno riceve `authorityFromSignals` dalla sua posizione. Ogni treno registra l'orario realizzato (`realised`), restituito con quello programmato da `timetable()`. Senza servizi il percorso a un treno è invariato (stesse chiamate, stesso ordine). Un servizio che va verso l'origine ha `dir` −1 e corre su `Lr`, la linea ribaltata da `mirrorLine`, con segnali propri; il suo `S.s` è nelle progressive ribaltate ed `extent()` lo riporta nelle progressive della linea. Con treni nei due sensi `updateOrientation()` assegna ogni sezione a binario unico (`singleTrack()`, fra segnali di partenza opposti) a un verso alla volta, `occupantsFor(dir)` conta i treni dell'altro verso solo sul binario unico, e `heldSignals(dir)` tiene rossi i segnali di partenza verso sezioni non orientate per quel verso. Anche il treno che precede è un `TrainRun`, subito dopo il treno comandato (`Simulation.leader`), costruito da `leader.ts` dal `freight` della linea: un merci a doppia trazione (`freight` vero: niente passeggeri, assente dai flussi) fermo in `s0`, con le fermate di `leaderStops()`, una sosta in linea marcata `halt` quando la sua fermata non è vicina a una stazione, e il guidatore automatico che pianifica le fermate a `LEADER_DRIVER_DECEL`. Con la terra con apparato il suo orario per l'ARS transita in tutte le stazioni, con la partenza dalla stazione in cui si ferma mandata come comando `timetable` quando è pronto (`leaderTick()`), che manda anche il fine missione quando la corsa finisce; ha priorità −1. Con la terra con apparato e più treni (`multi`, attivato anche da un evento `line_blocked`) il piazzale avanza una volta per passo dopo tutti i treni, la terra è temporizzata su `time`, ogni servizio ha il suo orario in `TracksideConfig.trains` (in ordine di marcia, anche per i treni verso l'origine, che fanno aggiungere allo schema gli itinerari inversi), le risposte vanno al treno secondo `NID_ENGINE` e ogni treno decodifica la propria autorizzazione (`tma`); il treno comandato arrivato esce dal piazzale. Con un bordo a messaggi ogni treno ha il suo `ob` (i servizi hanno il bordo di riferimento quando quello del treno guidato è esterno). Dopo aver creato i treni, il costruttore costruisce un solo insieme di gruppi di boe e un solo `Rbc` condiviso da tutti, e numera i treni con `NID_ENGINE` (`ob.engine`). Il motore dà a ogni treno le boe nel suo senso di marcia (`bgRef`), così i bordi dei treni diretti verso l'origine vedono i gruppi al contrario.

`step(dt = FIXED_DT)` avanza di 5 ms in quest'ordine: eventi dello scenario; blocco (aspetti, autorizzazione al movimento); scambi con bordo e terra in processo quando dovuti; supervisione (interna) o applicazione delle uscite del bordo; dinamica (interna, o interpolazione verso l'ultima risposta esterna); aggiornamento del piazzale; controlli di superamenti, interventi, vigilanza, fermate e fine corsa. `sample()` aggiunge una riga al CSV ogni `LOG_DT` = 0,5 s.

I programmi esterni li serve chi guida il ciclo: prima di un passo chiede `dynamicsDue()`, `onboardDue()`, `tracksideDue()` e scambia la richiesta e la risposta corrispondenti. `step()` rifiuta di avanzare se manca una risposta dovuta, così un ciclo sbagliato fallisce in modo evidente invece di produrre dati sbagliati. `runLockstep()` in `controller.ts` è il ciclo di riferimento.

Uscite: `observe(period, version)` (vedi [protocolli.md](protocolli.md)), `csv()` con `CSV_HEADER`, il registro `S.events`, `result()`, `summary()`, `verdict()`, `timetable()` e `controlRoom()`. Dalla fase 8 stanno fuori dalla classe, come funzioni della corsa: `outputs.ts` (campioni del CSV, osservazione con i dati ATO del Subset-130, risultati, verdetto, orario realizzato, riepilogo, e gli aiuti di visualizzazione `leverLabel`, `aspectName`, `fmtErr`) e `control-room.ts` (`controlRoomSnapshot`). I metodi di `Simulation` le chiamano, quindi chi li usa non vede differenze. Leggono la corsa e non cambiano nulla, salvo ciò che chiede chi le chiama: `sample()` aggiunge una riga al CSV e `observe()` sposta il cursore degli eventi che restituisce.

## Scenari e verdetto (`scenario.ts`)

Una `ScenarioDef` ha un nome, linea/treno/condizioni facoltativi e un elenco di eventi con un innesco (`when: { t, pos }`), una durata facoltativa e, per i guasti di un treno (`brake_degraded`, `traction_reduced`, `train_stopped`), un `train` facoltativo che indica il servizio interessato. `validateScenario()` restituisce l'elenco degli errori in parole semplici; `resolveScenario()` fonde lo scenario con una configurazione di base. I tipi di evento sono elencati in `FAULT_TYPES`; `ANNOUNCED_BY_DEFAULT` decide quali arrivano in cabina e ai controllori. `applyFault()` in `commands.ts` implementa ciascun effetto (lo stesso modulo fa scattare gli eventi in `scenarioTick()`, dà gli eventi `dispatch` in `dispatchTick()` e applica le decisioni del regolatore e i comandi del dirigente): i fattori di un treno stanno nel suo `TrainRun` (`brakeFactor`, `tractionFactor`, `heldUntil`, ripresi in `faults` per il treno comandato), un tratto interrotto va in `blocks`, che `occupantsFor` aggiunge agli occupanti dei due sensi e che disturba i tratti dell'apparato che tocca. Gli eventi scattano sul tempo della corsa (`time`), che prosegue dopo l'arrivo del treno comandato. `evaluate(result, criteria)` confronta un `RunResult` con i criteri (predefiniti in `DEFAULT_CRITERIA`) e restituisce il verdetto con un controllo per criterio.

## Strato di compatibilità (`legacy.ts`)

Fino alla versione 0.1 ogni formato usava nomi italiani. `toEnglish()` traduce chiavi (glossario `KEYS_IT_EN`) e valori (mappe per chiave `VALUES_IT_EN`, compresi array di stringhe) di qualsiasi ingresso; è applicato dove gli ingressi entrano nel nucleo ed è idempotente sugli ingressi inglesi. `toLegacy(x, kind)` produce il formato italiano della versione 0.x per le osservazioni e per i tre protocolli esterni, mantenendo l'ordine delle chiavi, con l'ambito `parent>key` dove la stessa chiave inglese aveva due nomi italiani. `isItalian()` riconosce un ingresso 0.x. Lo strato è l'unico posto del codice in cui vivono nomi italiani.

## Invarianti

- Niente `Date`, `Math.random` o I/O in `src/core/`.
- L'ordine delle operazioni in `step()` fa parte del comportamento: cambiarlo cambia i dati.
- `observe()` consuma gli eventi dalla chiamata precedente; chiamarla due volte nello stesso passo fa perdere eventi al secondo chiamante.
- Un campo dell'osservazione, di una richiesta o di una risposta non cambia mai nome una volta pubblicato; i campi nuovi sono facoltativi.

## Test

`verify-line` (compilazione), `verify-physics` e `verify-dynamics` (dinamica), `verify-scenarios` (validazione, fusione dei limiti, verdetto, effetto di ogni tipo di evento, esiti attesi, determinismo), `verify-ato` (valori di riferimento e determinismo di corse complete), `verify-ato-s130` (versioni dell'osservazione e loro equivalenza tramite `toLegacy`/`toEnglish`).

## Punti di estensione

Nuovi tipi di evento, nuovi preset, nuovi campi dell'osservazione, nuove colonne del CSV: [ARCHITETTURA.md](../ARCHITETTURA.md) elenca i file da toccare per ciascuno.
