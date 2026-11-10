# Scenari di eventi e guasti

> Copia italiana. Il documento di riferimento è la versione inglese [SCENARIOS.md](../SCENARIOS.md): nomi di file, comandi e formati seguono quella; i nomi italiani della versione 0.x (campi JSON, opzioni come `--linea` o `--bordo`) restano accettati.

Uno scenario è un file JSON che prepara una corsa e programma ciò che accadrà durante il viaggio. Sceglie linea, treno e condizioni, e fissa eventi che scattano a un certo tempo o quando la testa del treno raggiunge una posizione. Alla fine della corsa i suoi criteri producono un verdetto oggettivo, superato o fallito. Lo stesso scenario si gioca a mano nell'interfaccia oppure si fa guidare a un controllore, anche in serie e senza grafica. La simulazione resta deterministica, quindi due controllori si confrontano sulle stesse identiche condizioni.

Gli scenari di esempio sono nella cartella `scenarios/`, quelli del lato terra con apparato e RBC in `scenarios/trackside/`, e compaiono anche nella scheda *Scenari* della pagina.

## Struttura

```json
{
  "name": "Worksite speed restriction",
  "description": "Text shown in the briefing and in the Scenarios tab.",
  "line": "valle-lauro",
  "train": "regional",
  "signalling": "ETCS",
  "weather": "clear",
  "adhesion": "auto",
  "events": [
    { "type": "speed_restriction", "from_m": 6500, "to_m": 8000, "v_kmh": 50 },
    { "type": "radio_loss", "when": { "pos": 11500 }, "duration_s": 90, "timeout_s": 20 }
  ],
  "criteria": { "delay_max_s": 240 }
}
```

Solo `name` è obbligatorio. Ecco cosa contengono gli altri campi:

- `line` è l'id di una linea predefinita (`valle-lauro`, `appennino`) oppure una linea completa nel formato JSON della scheda *Line*.
- `train` è l'id di un treno predefinito (`regional`, `high_speed`, `freight`) oppure i suoi parametri completi.
- `signalling` vale `ETCS` o `BACC`.
- `weather` (`clear`, `rain`, `fog`), `time_of_day` (`day`, `dusk`, `night`) e `adhesion` (`auto`, `dry`, `wet`, `leaves`) hanno gli stessi valori dell'interfaccia.
- `onboard` (solo ETCS) vale `internal`, `reference` o `external`; `trackside` vale `simple`, `interlocking` o `external` e con un valore diverso da `simple` richiede un bordo a messaggi (vedi [TERRA.md](TERRA.md)).
- `leader` modifica il treno che precede della linea, per esempio `{ "stopAt": 5420, "wait": 400 }` per farlo fermare in una stazione. Il treno che precede è un merci fra i treni della corsa: è fermo in `s0` quando la corsa parte, segue segnali e supervisione come i treni di servizio, cede loro il passo nei conflitti e finisce la corsa all'ultima stazione ([MODELLO.md](MODELLO.md#vigilanza-fermate-e-treno-che-precede)).
- `regulator` vale `none` (predefinito), `reference` o `external`, con un `regulator_period_s` facoltativo (predefinito 5 s): il regolatore della circolazione, che riprogramma i treni, cambia le priorità e annulla gli itinerari quando qualcosa va storto ([REGOLATORE.md](REGOLATORE.md)). Esempio: `scenarios/services/breakdown.json`.
- `passengers`: domanda origine–destinazione, con salite e discese alle fermate, sosta dalle persone attraverso le porte, capacità, massa a bordo e misure ([PASSEGGERI.md](PASSEGGERI.md)). Esempio: `examples/scenario-config/valle-lauro-passengers.json`.
- `spacing` (`fixed_block` o `moving_block`) e `moving_block` (`margin_m`, `report_period_s`, `radio_delay_s`): ETCS livello 2 con blocco mobile, con un bordo a messaggi e la terra semplice su una linea singola ([BLOCCO_MOBILE.md](BLOCCO_MOBILE.md)). Esempi: `scenarios/moving-block*.json`.
- `rbc_borders_m` (solo terra con apparato, linea singola): le progressive dei confini fra le aree degli RBC, per esempio `[7600]`. Ogni confine va sul segnale principale più vicino, e il treno passa da un RBC al successivo con l'handover del Subset-026 e del Subset-039 ([TERRA.md](TERRA.md#più-rbc-e-il-passaggio-fra-rbc)). Esempio: `scenarios/trackside/handover.json`.
- `conflict_rule` (solo terra con apparato) vale `timetable` (predefinito) o `first_come`: come la formazione automatica sceglie fra due treni che vogliono itinerari inconciliabili (vedi [TERRA.md](TERRA.md)).

I campi omessi restano quelli già in uso. Nelle corse senza grafica le opzioni esplicite sulla riga di comando prevalgono sullo scenario.

Gli scenari scritti con i nomi italiani della versione 0.x (`nome`, `linea`, `eventi`, `rallentamento`, `radio_perso`…) sono ancora accettati: li traduce in ingresso `toEnglish` in `src/core/legacy.ts`.

## Treni di servizio

Uno scenario può aggiungere altri treni con il loro orario in `services`. Il treno della corsa (quello in cabina o guidato dal controllore) mantiene l'orario della linea; ogni servizio è un altro treno con dinamica, supervisione e fermate proprie, guidato dall'ATO interno, che segue la stessa logica di `examples/ato.js`, oppure con `"driver": "agent"` da un agente esterno ([AGENTI.md](AGENTI.md)).

```json
"services": [
  { "id": "R 2102", "train": "regional", "stops": [
    { "station": "Valle Lauro", "departure_s": 360 },
    { "station": "Ponte Sabato", "arrival_s": 620, "departure_s": 650, "min_dwell_s": 30 },
    { "station": "Monte Clanio", "arrival_s": 1240 } ] }
]
```

- `id` è il numero del treno, unico nella corsa. `train` è un treno incluso o i suoi parametri; senza, il servizio usa il treno della corsa.
- `stops` elenca le stazioni servite nell'ordine di marcia, per nome; la prima richiede `departure_s`. I tempi sono secondi dall'inizio della corsa. Una stazione della linea non elencata si attraversa senza fermarsi. L'ordine delle fermate dà il verso di marcia: verso la fine della linea, oppure indietro verso l'origine.
- Una fermata può avere `"track": "I"` o `"II"`: con la terra con apparato la formazione automatica manda il treno solo su quel binario, ed è così che un orario programma una precedenza. Le altre terre lo ignorano.
- Il servizio compare all'origine 60 s prima della partenza, se il binario è libero, con le porte aperte. Parte all'ora di partenza, sosta a ogni fermata almeno `min_dwell_s` (predefinito 20 s) e non prima della partenza in orario, e lascia la linea dopo l'ultima fermata.
- Segnali e autorizzazioni tengono conto di tutti i treni: il blocco li distanzia e un ritardo si propaga ai treni che seguono. Il segnale di partenza di una stazione resta rosso fino all'ora di partenza del treno fermo lì.
- I servizi girano con la supervisione interna, con il blocco automatico o con un bordo a messaggi e l'RBC semplice. Con `onboard: "reference"` ogni treno ha un bordo di riferimento e l'RBC tiene una sessione per ciascuno. Con `onboard: "external"` il bordo esterno sta sul treno guidato e i servizi hanno quello di riferimento. Con la terra con apparato ogni treno ha la sua sessione e il suo orario per la formazione automatica; in entrambi i sensi: l'apparato aggiunge gli itinerari inversi e dà ogni tratta a binario unico a un senso alla volta. Esempi: `scenarios/services/precedence.json`, una precedenza decisa dalla regola dei conflitti, e `scenarios/services/crossing-interlocking.json`, l'incrocio con la terra con apparato.

**Due sensi.** La linea fra le stazioni è a binario unico e ogni stazione ha un binario per verso. Un treno che torna verso l'origine vede la linea ribaltata (`mirrorLine` in `src/core/line.ts`): progressive dall'altro capo, pendenze di segno opposto, segnali propri alle stesse distanze dalle stazioni. Le sezioni a binario unico vanno dal segnale di partenza di una stazione al segnale di partenza della successiva nell'altro verso, e funzionano come un blocco di linea con consenso: un verso ottiene la sezione quando un suo treno vuole entrarvi e nessun treno dell'altro verso la occupa, la tiene finché i suoi treni la occupano o vogliono entrarvi, e la rilascia altrimenti; con due richieste insieme vince la partenza in orario più vicina. I treni dell'altro verso contano come occupazione solo sul binario unico, quindi due treni si incrociano in stazione, ciascuno sul suo binario. Il treno che precede della linea è un treno come gli altri, quindi corre anche con treni nei due sensi. La regola non dà priorità e non evita ogni stallo degli orari fitti: la regolazione arriva con il regolatore della fase 3. Esempio: `scenarios/services/crossing.json`.

**Reti.** Con `"network"` (l'id di una rete predefinita, o una rete completa con le sue `lines`) la corsa ha più linee che si incontrano nelle stazioni in comune; la linea principale è la prima, quella del treno comandato, del treno che precede e degli eventi con progressive. Un servizio può indicare `"route"`: le linee che percorre, per id e in ordine di marcia, per esempio `["valle-lauro", "rocca-sabato"]` da Valle Lauro a Rocca Sabato passando per San Felice Scalo. Senza percorso corre sulla linea principale, o sulla prima linea che ha tutte le sue fermate. Le regole del blocco e del binario unico valgono su ogni linea; dove dei treni entrano in una linea da un'altra, la stazione del nodo su quella linea va a un treno alla volta (itinerario di nodo). Per ora una rete funziona con il blocco automatico o con ETCS e la supervisione interna; regolatore e dati aperti funzionano; l’interfaccia mostra la linea principale. Vedi [progetto/rete.md](progetto/rete.md). Esempio: `scenarios/services/branch.json`. Una rete può essere fatta anche di linee complete, per esempio le linee reali importate in [IMPORTAZIONE_INFRA.md](IMPORTAZIONE_INFRA.md): `scenarios/services/benevento.json` (scritto da `npx tsx scripts/real-network.ts`) unisce Cancello – Benevento e Avellino – Benevento a Benevento, con una coincidenza e un incrocio sul binario unico.

**Giri del materiale.** I servizi con lo stesso `"block"` sono fatti dallo stesso treno, nell'ordine delle partenze: ognuno parte dalla stazione dove è finito il precedente, compare solo quando quello è arrivato e parte non prima del suo arrivo più `"min_turnaround_s"` (dello scenario, 300 s se non indicato), così un ritardo passa da un servizio al successivo. Un servizio di un giro senza `"train"` prende quello del giro. È il `block_id` di GTFS e un `block` della turnazione dei veicoli di railML 3.

**Coincidenze.** `"connections"` elenca le coincidenze fra treni: in `"station"` il servizio `"to_service"` aspetta `"from_service"` (`"train"` è il treno comandato) e parte non prima del suo arrivo più `"transfer_s"` (120 s se non indicato), ma mai oltre la sua partenza più `"max_wait_s"` (300 s se non indicato); oltre parte e la coincidenza è persa. L'orario realizzato registra per ogni coincidenza se è stata tenuta e quanto il treno ha atteso. È una `ServiceJourneyInterchange` di NeTEx. Esempio di entrambi: `scenarios/services/branch-shuttle.json`.

Con il regolatore di riferimento una rete permette di cambiare percorso: `scenarios/services/loop-reroute.json`, sulla rete `valle-lauro-anello`, interrompe la linea principale fra Ponte Sabato e San Felice Scalo e il regolatore manda l'R 3101 sul raccordo Ponte Sabato – Pietrarsa ([REGOLATORE.md](REGOLATORE.md)).

I campi corrispondono agli standard dell'orario: un servizio è un `operationalTrain` con il suo `OperationalTrainNumber` in railML 3 (un `trainPart` in railML 2), un `ServiceJourney` in NeTEx e un trip in GTFS; una fermata è un `baseItineraryPoint` con i suoi `times` e `stop` (un `ocpTT` in railML 2), un `TimetabledPassingTime` e una riga di `stop_times.txt`. I servizi si possono importare da questi formati ed esportare verso di essi ([DATI_APERTI.md](DATI_APERTI.md#importare-un-orario)).

Con i servizi la corsa termina quando tutti i treni hanno finito. Le corse senza grafica con `--output` scrivono, oltre ai file del treno comandato, `_timetable.json` con l'orario programmato e realizzato di ogni treno (arrivo, partenza e ritardi a ogni fermata) e, per ogni servizio, il suo CSV e il suo riepilogo. L'osservazione di una corsa con servizi contiene `train_id`. La pagina li esegue e li disegna (schema di linea, vista 3D, scheda *Timetable* con il grafico orario e l'editor). Un esempio è `scenarios/services/following.json`; `verify-services` controlla partenze, distanza fra i treni, propagazione di un ritardo con entrambi i segnalamenti, i disservizi (`line_blocked` con le tre terre, un servizio fermo o rallentato senza effetto sugli altri), la precedenza e le due regole dei conflitti con la terra con apparato, e il determinismo.

## Quando scatta un evento

`when` può contenere `t` (secondi dall'inizio della corsa), `pos` (metri, posizione della testa) o entrambi; con entrambi servono tutte e due le condizioni. Senza `when` l'evento è attivo fin dalla partenza. `duration_s` chiude l'evento dopo quel tempo; senza durata l'effetto resta fino alla fine della corsa.

## Tipi di evento

| Tipo | Campi | Effetto | Annunciato |
| :-- | :-- | :-- | :-- |
| `speed_restriction` | `from_m`, `to_m`, `v_kmh` | Limitazione temporanea di velocità: entra nel profilo di velocità, nelle curve di supervisione, nel DMI e nelle osservazioni (`speed_restrictions`). | sì |
| `radio_loss` | `timeout_s` (predefinito 20) | Solo ETCS: l'autorizzazione al movimento resta quella ricevuta prima del guasto. Dopo `timeout_s` senza messaggi il bordo comanda la frenatura di servizio, rilasciata quando il collegamento torna. Con un bordo a messaggi i messaggi nei due sensi vanno persi e `timeout_s` diventa il valore nazionale `T_NVCONTACT`. Con il blocco automatico non ha effetto sulla marcia. Con più RBC (`rbc_borders_m`), `rbc` limita la perdita alla radio di un solo RBC; con un bordo a messaggi, `train` (l'id di un servizio o `leader`) alla radio di un solo treno. | sì |
| `odometry_drift` | `slope` (errore per metro percorso, per esempio −0,05), `train`, `duration_s` | Solo con il bordo ETCS a messaggi: l'odometria che il motore manda al bordo (distanza, velocità, letture dell'odometro alle boe) segna `slope` metri in più (positivo) o in meno (negativo) per ogni metro che il treno percorre, dall'inizio dell'evento; alla fine la deriva si ferma e l'errore accumulato resta. La posizione vera del treno non cambia ([BORDO_ETCS.md](BORDO_ETCS.md)). | no |
| `integrity_loss` | `train` (id del servizio o `leader`, predefinito il treno comandato) | Solo con il bordo ETCS a messaggi: l'interfaccia del treno dice al bordo che l'integrità del treno è persa; il bordo lo riporta subito e in ogni rapporto di posizione (`Q_INTEGRITY` 3, senza `L_TRAININT`) fino alla fine dell'evento, poi di nuovo confermata. Con il blocco fisso non ha effetto sulla marcia; con il blocco mobile l'RBC tiene l'ultima coda confermata di quel treno. | no |
| `low_adhesion` | `from_m`, `to_m`, `mu` | Zona di aderenza ridotta. La fisica usa l'aderenza più bassa sotto il treno; il bordo continua a calcolare le curve con quella nominale. | no |
| `brake_degraded` | `factor` (0–1), `train` | La forza frenante, di servizio e d'urgenza, è moltiplicata per il fattore. Il bordo non lo sa. | no |
| `traction_reduced` | `factor` (0–1), `train` | Lo sforzo di trazione disponibile è moltiplicato per il fattore. | no |
| `train_stopped` | `train`, `duration_s` | Il treno si guasta: frena e non si può muovere, qualunque cosa comandi chi lo guida, fino alla fine della durata (senza durata, fino alla fine della corsa). I treni dietro aspettano ai segnali. | sì |
| `line_blocked` | `from_m`, `to_m`, `duration_s` | Il tratto è interrotto (un ostacolo, una frana, un cantiere non sgomberato): segnali e autorizzazioni lo proteggono come se ci fosse un treno, nei due sensi, e con la terra con apparato i suoi circuiti risultano disturbati. | sì |
| `dispatch` | `dispatch` (un comando di `Simulation.dispatch`), `when.t` | Un comando del dirigente, dato all'istante come dalla sala di controllo ([SALA_CONTROLLO.md](SALA_CONTROLLO.md)): una decisione del protocollo del regolatore o un rallentamento. Scatta alla fine del passo che raggiunge il suo istante, dove cade un comando dato dal vivo, quindi uno scenario scritto con *Write into the scenario* ripete la corsa. Solo a un istante, non a una posizione. | sì |
| `leader_stopped` | `duration_s` (predefinito 120) | Il treno che precede frena con il freno di servizio pieno, come un treno guasto, e riparte dopo la durata: le sezioni dietro di lui restano occupate. | no |
| `rbc_emergency_stop` | — | Ordine di arresto d'emergenza (dal RBC in ETCS, dal dirigente con il blocco automatico). Con un bordo a messaggi diventa il messaggio 16 del RBC e frena il bordo; con la terra con apparato è un arresto dal posto centrale revocato al ciclo successivo, quindi il treno riparte da fermo. Non conta come intervento della protezione. | sì |
| `message` | `text` | Comunicazione al macchinista, per esempio una prescrizione. | sì |
| `point_failure` | `element`, `mode` (`blocked` o `no_detection`), `duration_s` | Solo con la terra con apparato: il deviatoio (per esempio `"Ponte Sabato/1"`) non si manovra più, oppure perde il controllo della posizione. Gli itinerari che lo usano non si formano o non valgono più per le autorizzazioni. Vedi [TERRA.md](TERRA.md). | no |
| `tvps_failure` | `element`, `duration_s` | Solo con la terra con apparato: il circuito di binario (per esempio `"Line/B3"`) risulta disturbato e gli itinerari che lo attraversano non si formano. | no |
| `operator_command` | `command` | Solo con la terra con apparato: un comando del posto centrale, come `{ "type": "set_route", "id": "Ponte Sabato/2" }`, `{ "type": "cancel_route", "id": "…" }`, `{ "type": "ars", "active": false }`, `{ "type": "emergency_stop" }` e `{ "type": "revoke_emergency_stop" }`, questi ultimi due con un `engine` facoltativo per un solo treno; `{ "type": "rbc_link", "up": false }` con più RBC taglia il collegamento fra loro, ripristinato dopo `duration_s` se dato. | sì |

`train` indica il treno di servizio a cui l'evento si riferisce (il suo `id`, o `leader` per il merci davanti), per `brake_degraded`, `traction_reduced`, `train_stopped`, `integrity_loss`, `odometry_drift` e `radio_loss`; senza, l'evento riguarda il treno comandato. Nelle corse con servizi `brake_degraded` e `traction_reduced` agivano su tutti i treni; ora agiscono solo sul treno interessato. Una `pos` in `when` si riferisce alla testa di quel treno.

Un evento **annunciato** compare nel messaggio in cabina e negli `events` dell'osservazione inviata ai controllori. Un evento **non annunciato** resta solo nel registro della corsa, segnato come tale, perché il macchinista lo scopre dai suoi effetti: slittamenti, frenate più lunghe, sezioni che non si liberano. Il campo `announced: true|false` cambia il comportamento predefinito.

## Criteri e verdetto

| Criterio | Predefinito | Controllo |
| :-- | :-- | :-- |
| `complete` | `true` | il treno arriva al capolinea fermandosi alla palina |
| `stop_error_max_m` | 5 | errore massimo, in valore assoluto, fra le fermate effettuate |
| `missed_stops_max` | 0 | fermate mancate |
| `interventions_max` | 0 | interventi della protezione (urgenza per curva superata) |
| `overruns_max` | 0 | segnali rossi o fine autorizzazione superati |
| `missed_vigilance_max` | 0 | vigilanze non confermate |
| `arrival_max_s` | — | tempo di arrivo |
| `delay_max_s` | — | ritardo all'arrivo rispetto all'orario |
| `over_limit_max_kmh` | — | massimo superamento del limite di linea, compresi i rallentamenti |
| `energy_max_kWh` | — | energia netta (trazione meno recupero) |
| `tension_force_max_kN` | — | massima trazione negli accoppiatori (modello multi-massa) |
| `compression_force_max_kN` | — | massima compressione negli accoppiatori |
| `jerk_max_ms3` | — | strappo massimo in testa al treno, indice di comfort |

I criteri dello scenario si aggiungono ai valori predefiniti o li sostituiscono. Anche una corsa senza scenario riceve un verdetto, con i soli criteri predefiniti.

## Uso

Nella pagina, la scheda *Scenari* permette di scegliere uno scenario, leggerne la descrizione e modificarne il JSON. Mostra anche lo stato degli eventi durante la corsa e il verdetto, provvisorio finché la corsa non finisce. Il verdetto compare anche nel resoconto di fine corsa.

Senza grafica:

```bash
npm run headless -- --scenario scenarios/radio-loss.json
npm run headless -- --scenario scenarios --controller examples/ato.js --output runs     # campagna su tutti gli scenari
npm run headless -- --scenario scenarios --controller ws://localhost:8765               # con un controllore esterno
```

Con una cartella vengono eseguiti tutti gli scenari in ordine alfabetico. Alla fine compare il riepilogo dei superati, e in `--output` si trovano CSV, eventi e riepilogo JSON di ogni corsa, con l'elenco dei controlli.

## Esiti del controllore di esempio

`scripts/verify-scenarios.ts` fissa gli esiti attesi con `examples/ato.js`. Due scenari sono pensati per farlo fallire:

- **foglie in avvicinamento a Ponte Sabato**: frena con la decelerazione di progetto, slitta e supera la palina di 60 m;
- **freno degradato in discesa**: manca la fermata finale di 33 m.

Sono i primi casi su cui misurare un controllore migliore. Se un controllore nuovo li supera, l'esito atteso nelle verifiche resta quello del controllore di esempio: le verifiche controllano il simulatore, non i controllori.
