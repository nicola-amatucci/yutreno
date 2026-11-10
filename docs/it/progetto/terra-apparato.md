# Terra con apparato

> Copia italiana di [interlocking-trackside.md](../../design/interlocking-trackside.md). In caso di differenze fa fede il testo inglese.

## Scopo

Far nascere l'autorizzazione al movimento da itinerari formati da un apparato su enti che possono guastarsi, come in un impianto reale, tenendo il motore libero dalla logica d'apparato. Il componente è diviso lungo il confine EULYNX: il motore simula il piazzale, la terra (`src/trackside/`) contiene la logica e parla con il motore con un protocollo pubblico, così che possa girare in processo o come programma esterno. La descrizione per l'utente è in [TERRA.md](../TERRA.md).

## Parti

| Parte | Codice | Ruolo |
| :-- | :-- | :-- |
| Generatore del piano | `generateLayout()` in `src/core/field.ts` | Tabelle delle Condizioni delle linee d'esempio: stazioni a due binari con deviatoi d'ingresso e d'uscita, sezioni di blocco in linea |
| Traduttore delle tabelle | `translateControlTables()` in `control-table.ts` | controlla le tabelle, ricava le incompatibilità, produce la configurazione dell'apparato |
| Lato del motore | `src/core/trackside-bridge.ts` | il piazzale di ogni linea fatto avanzare con i treni che ci sono, la configurazione del primo scambio (corridoi, movimenti nei nodi, orari per la formazione automatica degli itinerari), richiesta e risposta, messaggi radio smistati secondo `NID_ENGINE` |
| Piazzale | `Field` in `src/core/field.ts` | deviatoi (tempo di manovra, guasti, tallonamento), tratti di binario (occupazione per ramo, disturbo), telegrammi EULYNX |
| Apparato | `Interlocking` in `interlocking.ts` | stato degli enti dai telegrammi, formazione degli itinerari, integrità, liberazione elastica, annullamento, formazione automatica |
| RBC | `TracksideRbc` in `rbc.ts` | posizione dai rapporti, autorizzazione dalla catena degli itinerari formati, messaggi 3 e 16 |
| Facciata | `Trackside` in `index.ts` | un ciclo del protocollo: telegrammi, radio, comandi in ingresso; telegrammi, radio, quadro, eventi in uscita |

## Ciclo

`Trackside.step(req)` (ogni 100 ms di default): `toEnglish`; su `start`, costruzione di apparato e RBC dalla `configuration`; l'apparato legge i telegrammi del piazzale; l'RBC legge i messaggi del bordo; i comandi dell'operatore vanno all'apparato o all'RBC; l'apparato fa avanzare itinerari e formazione automatica e produce i comandi per gli enti; l'RBC calcola autorizzazione e messaggi; si compone il quadro. Il bordo in processo scambia prima della terra, così l'ordine è lo stesso in processo ed esterno.

## Due sensi di marcia

Con un servizio verso l'origine, `generateLayout(L, { reverse: true })` (`addReverse` in `field.ts`) aggiunge gli itinerari inversi sugli stessi enti: ingressi dal lato opposto e partenze verso l'origine nelle stazioni intermedie, la partenza dal capolinea, l'arrivo all'origine e il blocco di linea dalla fine verso l'origine. I loro punti di arresto stanno ai confini delle sezioni, con `dir: -1`. I riferimenti fra impianti `Impianto/nome` permettono a un itinerario di blocco inverso di usare la prima sezione che appartiene alla partenza di una stazione. Gli itinerari portano `dir` e, per partenze e blocco, la tratta (`segment`) in cui entrano.

Ogni tratta ha un consenso di blocco (`segDir`: +1 tenuto dalla stazione dal lato dell'origine, −1 dall'altra, 0 in viaggio), +1 all'inizio. Una partenza dal capo che non lo tiene manda una richiesta (`send`) e aspetta; `consentCycle` consegna i messaggi del ciclo precedente: chi tiene il consenso lo concede solo con la tratta vuota (`segmentEmpty`: nessuna partenza attiva, tutte le sezioni libere), liberando i suoi blocchi automatici inattivi, altrimenti rifiuta e il richiedente riprova dopo 2 s. Un solo gettone, tenuto al più da un capo, tiene fuori dalla tratta i treni opposti. I blocchi automatici si chiedono solo nel senso del consenso.

L'ARS, l'attesa di `heldByTimetable` e l'assegnazione del binario di un treno dopo un ingresso ragionano nelle progressive di ciascun treno (`u()`), specchiate per i treni verso l'origine, che il RBC segnala (`TrainPos.dir`). Treni opposti non si trattengono a vicenda le partenze: si incontrano nel consenso.

Il RBC prende il senso di una sessione da `Q_DIRLRBG` e calcola l'autorizzazione nel riferimento del treno: itinerari e punti di arresto del suo senso, pacchetti con `Q_DIR` = 0 e profili specchiati. Il piazzale (`Field`) conosce il senso di ogni treno: prende il ramo dal primo deviatoio che incontra e occupa dalla testa all'indietro.

## Macchina a stati dell'itinerario

libero → in formazione (nessun incompatibile attivo, tratti liberi, deviatoi non bloccati da altri e manovrabili; bloccamento e comando) → formato (tutti i deviatoi in controllo entro 20 s, altrimenti liberato) → occupato (il treno è entrato) → di nuovo libero per liberazione elastica (ogni tratto liberato dopo essere stato occupato e lasciato, i suoi deviatoi sbloccati e riportati in normale; l'itinerario liberato quando il treno occupa la destinazione). Un itinerario formato che perde integrità (deviatoio senza controllo, tratto disturbato) non vale per le autorizzazioni. L'annullamento è immediato, o ritardato di 120 s se l'itinerario è coperto da un'autorizzazione (`RbcInfo.covered`).

## Autorizzazione

L'RBC parte dall'itinerario che contiene la testa (o in cui sta entrando), sul ramo del treno, e accoda gli itinerari consecutivi formati, integri e con tratti liberi; un itinerario già nella precedente autorizzazione resta valido se occupato dal treno stesso. EOA alla fine dell'ultimo itinerario, SvL alla fine del suo overlap se libero; distanze arrotondate per difetto. Il messaggio 3 porta i pacchetti 15, 27 (limiti di linea con le velocità in deviata), 21, 5, 65/66. L'arresto d'emergenza dal posto centrale manda il messaggio 16 e trattiene le autorizzazioni fino alla revoca, per un motore o per tutti. L'RBC tiene una `RbcSession` per `NID_ENGINE`; con più di una sessione il primo itinerario della catena deve essere uno già concesso a quel treno (`ses.ma.routes`), perché il binario II condivide le progressive del I. I messaggi ai motori diversi da 1 portano `NID_ENGINE`, con cui il motore li instrada.

## Formazione automatica con più treni

`TracksideConfig.trains` dà un orario per motore (`TimetableEntry`: stazione, arrivo, partenza, progressiva, binario facoltativo). `automaticRouteSetting` raccoglie i desideri di ogni treno (ingressi dentro la finestra, partenze dovute, transiti appena il treno è entrato), rispetta il binario chiesto, li ordina secondo la regola dei conflitti e chiede gli itinerari in quell'ordine. Le priorità del posto centrale o del regolatore (comando `priority`, predefinita 0) vengono prima nell'ordine e nell'attesa: una partenza aspetta anche un treno con priorità maggiore. Un comando `timetable` sostituisce l'orario di un motore. Con `conflict_rule: 'timetable'` e priorità uguali `heldByTimetable` trattiene una partenza finché un treno con orario precedente nella stessa stazione si avvicina o è fermo sull'altro binario; con `first_come` l'ordine è quello in cui i treni sono pronti. Il binario di ogni treno in ogni stazione (`trainTrack`) lo fissa la liberazione elastica per il treno più vicino oltre l'inizio dell'itinerario.

## Interfacce

Il protocollo motore–terra (`TracksideRequest`/`TracksideResponse` in `types.ts`, vedi [protocolli.md](protocolli.md)); i telegrammi EULYNX SCI-P e SCI-TDS fra piazzale e apparato; `OperatorCommand` e `PanelState` verso il posto centrale (quadro della pagina o eventi degli scenari).

## Invarianti

- `src/trackside/` non importa nulla dal motore oltre ai tipi e a `legacy.ts`.
- La terra esterna (`examples/trackside/trackside_stdio.ts`) dà una corsa identica a quella in processo.
- Con `trackside: 'simple'` nei risultati non cambia nulla.

## Test

`verify-trackside` (traduzione, apparato contro il piazzale senza motore, liberazione elastica, deviatoio tallonato, corse nominali, scenari con entrambe le terre, terra esterna con uno e con due treni in sessione, precedenza sul binario II, passaggio fra due RBC), `verify-services` (precedenza fra due treni, le due regole dei conflitti, linea interrotta) e gli esiti attesi di `scenarios/trackside/` in `verify-scenarios`.

## Su una rete

Con una rete (`configuration.network`) `Trackside` fa girare un `Interlocking` per linea, ciascuno con i suoi itinerari, i suoi enti e la sua formazione automatica, e un solo `TracksideRbc` per tutti. I telegrammi vanno a ogni apparato, che prende quelli dei suoi enti; i comandi di formazione e annullamento vanno all'apparato che ha l'itinerario, gli orari a quello della loro `line`. A un nodo gli itinerari in uscita da un apparato richiedono il consenso al confine, che gli apparati si scambiano con un ciclo di ritardo (`BoundaryMessage`); un treno non ancora su una linea viene posto, per la formazione automatica, dove sarebbe oltre il nodo (`onCorridorLine`). L'RBC costruisce l'autorizzazione di un treno fuori dalla linea principale lungo il suo corridoio, oltre il confine (`computeMaCorridor`). Vedi [rete.md](rete.md).

## Più RBC

Con `configuration.rbcs` (aree e confini, costruiti dal motore da `rbc_borders_m` dello scenario) `Trackside` fa girare un `TracksideRbc` per area (`RbcArea`) sullo stesso apparato. `route(m)` consegna un messaggio del bordo secondo il suo `NID_RBC`, altrimenti all'RBC che ha il mezzo in sessione, altrimenti all'area della sua LRBG; un messaggio per un RBC sconosciuto non ha RBC e diventa un avviso negli eventi della risposta. Ogni RBC filtra itinerari e marker alla sua area (`areaU`) e aggiunge `NID_RBC` a ogni messaggio. Il passaggio è una piccola macchina a stati da ciascun lato: `RbcSession.hov` (`HovState`: confine, ACC, marca temporale del 201, confermato, annunciato, l'RRI decodificata, presa in carico) sull'RBC che cede, mossa da `handover()` dentro `cycleSession`; `accT` (`AccState`) sull'RBC che accetta, mossa da `receiveNrbc()` e `accCycle()`. I messaggi fra RBC (`NrbcMessage`) si raccolgono da ogni RBC dopo il suo ciclo (`nrbcOut`) e si consegnano all'inizio del successivo se il collegamento c'è: un ciclo di ritardo, indipendente dall'ordine degli RBC. Segnali di vita (223) ogni `life_sign_s` e `linkUp()` con `link_timeout_s` danno la supervisione della comunicazione. L'ACC manda l'RRI (221) solo per un treno in sessione con lui, costruita dalla sua autorizzazione con `message3()` tenendo i pacchetti 15, 21 e 27 riferiti al gruppo di confine; l'HOV la fonde (`ma.beyond`) quando la sua autorizzazione finisce al confine e l'RRI va oltre, oppure quando la testa l'ha passato. Dopo la presa in carico (222) l'HOV tace e ordina la chiusura della sessione quando la coda minima sicura (`rear()`) è oltre il confine. La vista da cui si costruisce il quadro (`supervising()`) prende, per ogni mezzo, la sessione dell'RBC che lo supervisiona. Progetto e ragioni sono in [TERRA.md](../TERRA.md#più-rbc-e-il-passaggio-fra-rbc); `verify-trackside` HO1–HO7 lo prova.

## Limiti noti ed estensioni

I servizi tengono la sessione dopo la fine della corsa (solo il treno che precede manda il fine missione), consenso di blocco scambiato fra i capi di una tratta ma un solo programma d'apparato per tutta la linea, niente start of mission, accorciamento per sostituzione, niente messaggio 18, niente geometria della deviata, niente PDI, tempi fissi, Tabelle delle Condizioni ricostruite (tutto elencato in [TERRA.md](../TERRA.md)). Estensioni: un apparato per stazione invece che per linea, protezione di fianco, passaggi a livello, object controller fisici che parlano gli stessi telegrammi ([MODELLINO.md](../MODELLINO.md)).
