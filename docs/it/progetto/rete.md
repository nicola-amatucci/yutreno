# Rete

> Copia italiana di [network.md](../../design/network.md). In caso di differenze fa fede il testo inglese.

Codice: `src/core/network.ts`, `createNetworkService` in `src/core/trains.ts`, la circolazione di più treni in `src/core/traffic.ts` (`occupantsFor`, `updateOrientation`, `heldSignals`, gli itinerari di nodo `buildGates`/`updateGates`/`gateAspects`, la comparsa dei servizi `originFree`/`activate`, coincidenze e giri del materiale `waitConnection`/`linkBlocks`), e per la terra con apparato `nodeMoves`, `lineTimetable`, `fieldTrainsOn` in `src/core/trackside-bridge.ts`, la disposizione del nodo in `src/core/field.ts` (`addNodeRoutes`), gli apparati separati in `src/trackside/` (`Trackside`, `Interlocking` con il consenso al confine, `TracksideRbc.computeMaCorridor`), le reti predefinite in `src/core/presets.ts`. Verifiche: `scripts/verify-network.ts`. Righe della matrice: `YT-NET`, `YT-NODE`, `YT-IXL-NET`.

## A che cosa serve

Fino alla fase 3 YuTreno simulava un corridoio: una linea, percorsa nei due sensi. Una rete aggiunge linee che si incontrano nei nodi. Così un treno può passare da una linea all'altra, due treni possono entrare in una linea dallo stesso nodo e, più avanti (fase 4 del piano), diventano possibili le coincidenze, i giri del materiale e i cambi di percorso. Questo documento descrive il passo 4a: il modello di rete, gli itinerari dei treni e la terra del motore (blocco automatico, oppure ETCS con la supervisione interna) su una rete.

## Il modello

Una rete è un insieme di linee, ciascuna con le sue progressive. Corrispondono agli elementi di rete del livello macroscopico del RailTopoModel della UIC (IRS 30100), su cui si basa railML 3. I nodi non si dichiarano: una stazione con lo stesso nome su due linee è lo stesso punto operativo, cioè il nodo in cui un treno può cambiare linea.

La prima linea è la principale. Su di essa corrono il treno comandato e il treno che precede, e lì valgono gli eventi degli scenari che hanno progressive: rallentamenti, bassa aderenza, tratte interrotte.

```json
"network": "valle-lauro-rocca"
"network": { "name": "...", "lines": ["valle-lauro", { "id": "mia-diramazione", "name": "...", "plan": [...], ... }] }
```

Ogni linea conserva il suo tracciato. `compileNetwork` mette le linee in un piano comune: partendo dalla principale, ogni linea collegata a una già posizionata viene traslata finché i due punti del nodo coincidono, mentre l'orientamento resta quello del suo tracciato. Il piano comune serve alla vista e ai dati aperti; dinamica e segnalamento usano solo le progressive.

La rete predefinita `valle-lauro-rocca` unisce a San Felice Scalo la linea di Valle Lauro e la diramazione San Felice Scalo – Rocca Sabato. La diramazione è lunga 9,6 km e ha tre stazioni; come la linea principale, è a binario unico con stazioni a due binari.

## Itinerari e corridoi

Un servizio può dichiarare `route`, cioè le linee che percorre in ordine di marcia. Se non la dichiara, corre sulla linea principale quando questa ha tutte le sue fermate, altrimenti sulla prima linea che le ha tutte. `planItinerary` controlla il percorso:
- due linee consecutive devono avere in comune esattamente una stazione;
- ogni fermata deve stare sulla linea del suo tratto, in ordine di marcia.

Gli errori indicano il treno, la linea e la stazione.

`compileCorridor` compila l'itinerario in un **corridoio**, cioè una linea compilata come quella di una corsa a una linea. In questo modo dinamica, supervisione, guidatore automatico e osservazione restano unidimensionali e non cambiano. I tratti del corridoio sono questi:
- il primo va dall'inizio della sua linea orientata fino al nodo;
- quelli intermedi vanno da nodo a nodo;
- l'ultimo va dal nodo alla fine della sua linea orientata.

La linea orientata è la linea stessa oppure, per chi la percorre al contrario, la linea ribaltata. Curvatura, profilo, limiti, stazioni, gallerie e segnali vengono dalle linee orientate e sono riportati nelle progressive del corridoio. Il piano è quello comune, e la direzione di un tratto prosegue quella del precedente.

Due proprietà lasciano invariate le corse a una linea. La prima: un corridoio su una sola linea **è** la linea orientata, lo stesso oggetto (`L`, o la linea ribaltata costruita una sola volta), quindi i treni di una linea condividono segnali e limiti esattamente come prima.

La seconda: ogni tratto dice da dove viene (`CorridorLeg`: linea, verso, origine nel corridoio e nella linea orientata, estremi). `onLine` restituisce dove si trova un treno su una linea, nelle progressive della linea orientata e ritagliato ai tratti su quella linea. Per un corridoio di una sola linea restituisce testa e lunghezza invariate, con le stesse operazioni in virgola mobile del codice di prima. Per questo le tracce di tutti gli scenari con servizi delle fasi 2 e 3 sono identiche byte per byte.

I segnali di un corridoio di più linee sono copie, e `sigRef` dice da quale segnale di quale linea viene ciascuna. A ogni passo il motore calcola gli aspetti di ogni linea e di ogni verso in uso, poi li copia sui corridoi (`copyAspects`). I rallentamenti ricostruiscono i limiti di questi corridoi (`refreshCorridorLimits`).

## Il segnalamento sulla rete

Su ogni linea valgono le regole della linea singola:
- i treni di un verso occupano le sezioni di blocco di quel verso su quella linea, per la parte di loro che è sulla linea;
- i treni dell'altro verso contano solo per la parte che sta sul binario unico, perché in stazione ogni verso ha il suo binario;
- ogni sezione a binario unico di una linea è orientata verso un verso alla volta, con la regola della fase 2: il treno che vuole entrare, la partenza in orario più vicina, la priorità del regolatore;
- un segnale di partenza resta rosso fino all'orario di partenza del treno più vicino dietro di esso.

Un treno che si avvicina a un nodo da un'altra linea è già visto dai segnali della linea in cui entrerà. `headOn` dà la sua testa nelle progressive di quella linea anche prima che ci arrivi, e così l'orientamento della prima sezione a binario unico dopo il nodo viene chiesto in tempo.

### Itinerario di nodo

Il blocco da solo non protegge un nodo. Un treno che dalla diramazione va verso Valle Lauro entra nella stazione di San Felice Scalo sul binario della linea principale diretto verso Valle Lauro, ma il suo ultimo segnale appartiene alla diramazione e vede solo i treni della diramazione. Un treno che scende lungo la linea principale vede quello della diramazione solo quando è già entrato in stazione. Senza un'altra regola i due treni possono finire sullo stesso binario: la verifica `NET-4` fallisce se la regola viene spenta.

La regola è un **itinerario di nodo** per ogni linea e verso in cui qualche treno entra da un'altra linea passando per un nodo. La stazione del nodo su quella linea va a un treno alla volta:
- possono entrarvi i treni che arrivano da un'altra linea, quelli che percorrono la linea attraverso il nodo e quelli che partono dal nodo;
- un treno chiede l'itinerario quando è a meno di 3000 m dal segnale davanti al nodo;
- un itinerario libero va prima al treno più vicino fra quelli a meno di 1500 m da quel segnale, poi a quello con l'orario più vicino al nodo, poi nell'ordine dei treni;
- chi ha l'itinerario lo tiene finché la sua coda supera il segnale di partenza dopo il nodo, oppure finché non termina lì la corsa;
- mentre un altro treno tiene l'itinerario, il segnale davanti al nodo è rosso: sul corridoio di un treno che arriva da un'altra linea (il segnale precedente diventa giallo), e sulla linea stessa per i treni che la percorrono;
- un treno che parte dal nodo compare solo quando l'itinerario è libero, e lo prende.

È la regola più semplice che renda esclusivo l'unico binario di stazione di ogni verso. Non è un apparato: non ci sono deviatoi, né protezione di fianco, né conflitti fra i versi dentro il nodo. Sulla terra con apparato la regola è spenta e la sostituiscono gli itinerari degli apparati separati (più sotto).

## Coincidenze e giri del materiale (passi 4c e 4d)

Sono regole del motore e funzionano sia su una linea sia su una rete.

**Giri del materiale.** `linkBlocks` concatena i servizi di ogni giro nell'ordine delle partenze e controlla che ognuno parta dove è finito il precedente. Il servizio successivo compare all'origine solo quando il precedente è arrivato (`after`), e chiude le porte non prima di quell'arrivo più il tempo minimo di inversione. Il veicolo non viene spostato fra i binari, né agganciato o sganciato: il treno che arriva sparisce e il servizio successivo compare con gli stessi parametri. Il ritardo si propaga in forma chiusa, partenza = max(orario, arrivo del servizio precedente + inversione), e `NET-6` lo controlla a 0,01 s.

**Coincidenze.** `waitConnection` tiene aperte le porte del treno in partenza finché l'alimentatore non è arrivato e non è passato il tempo di trasbordo, ma non oltre la partenza più l'attesa massima. L'esito (tenuta o persa) e l'attesa si registrano alla chiusura delle porte, in `connections` e nell'orario realizzato. La decisione è una regola fissa della stazione; con il regolatore sulla rete (passo 4e) diventerà una decisione del regolatore. `NET-7` controlla i tre casi: alimentatore in orario, in ritardo entro l'attesa massima (attesa = arrivo + trasbordo − partenza), in ritardo oltre (persa dopo l'attesa massima).

## Il regolatore sulla rete (passo 4e)

Su una rete il protocollo del regolatore ha campi facoltativi in più: le linee e le stazioni nella configurazione, `route` e `position` di ogni treno, la linea di ogni fermata. Ha anche due comandi nuovi:
- `reroute` dà un nuovo itinerario a un treno non ancora comparso;
- `connection` cambia l'attesa massima di una coincidenza.

Un cambio di percorso ricompila il corridoio, toglie le fermate che non stanno sul nuovo itinerario e ricostruisce gli itinerari di nodo, conservando chi li tiene. Il regolatore di riferimento li usa nelle regole 6 e 7 ([REGOLATORE.md](../REGOLATORE.md)).

La rete `valle-lauro-anello` aggiunge il raccordo Ponte Sabato – Pietrarsa (9,6 km, con Casale Sabato), che chiude un anello: è il percorso alternativo di `services/loop-reroute`. Il suo tracciato è una retta disegnata in modo che i due estremi cadano sulle loro stazioni.

## Apparati separati (passo 4b)

Con ETCS, un bordo a messaggi e `trackside: 'interlocking'` (oppure `'external'`) ogni linea della rete ha il suo apparato, con le sue tabelle delle condizioni, il suo campo e la sua formazione automatica degli itinerari; un solo RBC costruisce le autorizzazioni per tutti.

**Un apparato per linea.** Il motore genera le tabelle delle condizioni di ogni linea come su una linea sola (`generateLayout`, con gli itinerari del senso inverso dove qualche treno percorre la linea contro il suo verso). I siti delle altre linee hanno il prefisso dell'id della linea (`rocca-sabato:Pietrarsa/1`), così enti, itinerari e rami hanno identificativi unici in tutta la rete; la linea principale tiene quelli di prima. La configurazione della terra è quella della linea principale, come prima, con il campo facoltativo `network`: gli altri apparati (`InterlockingConfig`, uno per linea, con gli orari dei treni che la percorrono), i confini fra apparati ai nodi e i corridoi dei treni che corrono fuori dalla linea principale. Il motore simula un campo per linea; un treno è sul campo di ogni linea su cui si trova, per la parte che vi si trova (`fieldTrainsOn`, da `onLine`). I telegrammi hanno identificativi unici, quindi il motore li manda tutti in una lista, come su una linea, e ogni apparato prende i suoi.

**Il nodo.** Un nodo unisce la linea A, dove la sua stazione è intermedia (binari I e II fra i deviatoi 1 e 2), e la linea B, che vi comincia o vi finisce. Nelle reti predefinite San Felice Scalo è intermedia sulla Valle Lauro e origine della diramazione; Ponte Sabato è intermedia sulla Valle Lauro e origine del raccordo; Pietrarsa è intermedia sulla diramazione e capolinea del raccordo. La stazione del nodo appartiene all'apparato di A, che riceve (`addNodeRoutes`):

- due deviatoi di nodo al punto di fermata della stazione, `J1` sul binario I e `J2` sul binario II, che in rovescio portano verso B; ogni itinerario di A sul binario I blocca `J1` in normale, ogni itinerario sul binario II blocca `J2` in normale, quindi un itinerario di nodo e uno di corretto tracciato sullo stesso binario sono incompatibili sul deviatoio oltre che sul binario;
- marker di nodo sui binari I e II, al deviatoio, nei versi usati dai treni;
- per un movimento da A verso B, un itinerario d'arrivo dal segnale di protezione al marker di nodo del binario I o II, con il deviatoio 1 (o 2 nel senso inverso) e quello di nodo di quel binario in rovescio, con la velocità deviata sul binario II; per un movimento da B verso A, un itinerario dal marker di nodo del binario I o II al marker di partenza di quel binario.

L'apparato di B finisce al nodo: riceve un itinerario dal nodo al suo primo marker (verso B) o dal suo ultimo marker al nodo (da B), sul binario della sua stazione di estremità. I movimenti generati sono quelli degli itinerari dei treni (`nodeMoves`); un nodo che non sia una stazione a due binari su una linea e l'estremità dell'altra viene rifiutato con un messaggio.

**Il consenso al confine.** Un treno attraversa un nodo con un itinerario in uscita da un apparato e uno in entrata nell'altro. Gli itinerari in uscita richiedono il consenso del nodo, un gettone che un solo apparato tiene alla volta (A all'inizio); quelli in entrata richiedono che lo tenga l'altro. Un apparato che vuole un itinerario in uscita senza il consenso lo chiede; chi lo tiene lo cede solo quando nessuno dei suoi itinerari in uscita verso il nodo è attivo, e un itinerario in uscita tiene la sua ultima sezione finché il treno non l'ha lasciata oltre il nodo. Richieste, concessioni e rifiuti viaggiano fra i due apparati con un ciclo di ritardo, come il consenso di blocco fra le due estremità di una tratta a binario unico, ma qui fra componenti distinti (`BoundaryMessage`, consegnati da `Trackside`). I telegrammi sono di YuTreno: EULYNX SCI-ILS porta il blocco di linea fra apparati adiacenti, ma i suoi telegrammi per questo caso non sono pubblicati.

Due regole impediscono a due treni di versi opposti di aspettarsi a vicenda a un nodo. La prima: sulla linea B il consenso del nodo va insieme al consenso di blocco della tratta a binario unico vicina al nodo. L'apparato di B cede quella tratta verso il nodo solo mentre tiene il consenso del nodo (e altrimenti lo chiede), e cede il consenso del nodo solo con quella tratta libera e tenuta dal lato del nodo (richiamandola dall'altra estremità quando è libera). Così un treno sul binario unico verso il nodo e un treno nel nodo verso quel binario unico non possono essere autorizzati entrambi; all'inizio il consenso è di A quando B comincia al nodo e di B quando vi finisce, cioè del lato verso cui la tratta è aperta. La seconda: un itinerario che entra in un apparato da un nodo libera il suo tratto oltre il segnale quando il treno che lo percorre è fermo da 30 s (liberazione temporizzata). Un treno uscito dalla diramazione che aspetta al marker di partenza il binario unico della linea principale non blocca più l'ingresso del treno opposto che sta aspettando. `NET-12` crea entrambe le situazioni e fallisce se si spegne una delle due regole.

**Formazione automatica degli itinerari.** L'orario di un treno per l'apparato di una linea ha le stazioni di quella linea da dove il treno vi entra a dove la lascia, con `from_line` sulla prima e `to_line` sull'ultima quando il treno viene da un'altra linea o prosegue su un'altra (`lineTimetable`). In quelle stazioni la formazione automatica sceglie fra gli itinerari di nodo di quella linea, e solo lì; altrove li ignora. Un treno non ancora su una linea viene posto dove sarebbe se la linea proseguisse oltre il nodo da cui entrerà (`onCorridorLine`, segnato `ahead`), così l'itinerario verso il nodo viene chiesto in tempo.

**L'RBC.** C'è un solo RBC per tutta la rete (la decisione del piano). Un treno fuori dalla linea principale ha i suoi gruppi di balise lungo il corridoio, come con l'RBC semplice, e la configurazione dà all'RBC quei gruppi e i tratti del corridoio. Per un treno così l'RBC lavora nelle progressive del corridoio: sposta sul corridoio gli itinerari di ogni apparato dove il corridoio percorre la loro linea nel loro verso, usa un itinerario di nodo solo dove il corridoio cambia davvero linea lì, e fa seguire a un itinerario in uscita da un apparato quello in entrata nel successivo, oltre il confine (`computeMaCorridor`). Autorizzazione, profilo statico con le velocità degli itinerari, pendenze e collegamenti sono quelli del corridoio. I treni che restano sulla linea principale sono serviti esattamente come su una linea; per loro gli itinerari e i marker di nodo non esistono.

**Cambi di percorso.** Con un regolatore il motore genera gli itinerari di nodo di ogni movimento che le tabelle delle condizioni permettono in ogni nodo, non solo quelli degli itinerari dei treni, così un cambio di percorso deciso dal regolatore trova i suoi itinerari. Il cambio di percorso di un treno non ancora comparso manda alla terra il nuovo corridoio (comando `corridor`) e i suoi orari per ogni linea (vuoti sulle linee che non percorre più); un cambio che richiederebbe itinerari che gli apparati non hanno (una linea percorsa contro il suo verso dove all'inizio nessun treno lo faceva) viene rifiutato con un messaggio.

**Capacità.** Il distanziamento al nodo si calcola dai tempi di blocco degli itinerari che due treni diversi condividono e si misura in `verify-capacity` (`CAP3`, [CAPACITA.md](../CAPACITA.md)).

**Rimandato.** Più RBC su una rete: il passaggio del Subset-039 funziona su una linea singola dalla fase 10 ([TERRA.md](../TERRA.md#più-rbc-e-il-passaggio-fra-rbc)), un confine a un nodo non è fatto; un apparato per stazione invece che per linea; nodi interni a una stazione di entrambe le linee; geometria del deviatoio di nodo e protezione di fianco.

## Che cosa non è ancora supportato

Una rete funziona con ogni tipo di terra: blocco automatico con SCMT, ETCS con la supervisione interna, ETCS con un bordo a messaggi e l'RBC semplice, oppure la terra con apparato della sezione precedente.

Con l'RBC semplice i treni che percorrono soltanto la linea principale condividono i suoi gruppi di balise e il suo RBC, come prima. Ogni altro treno ha gruppi di balise e un RBC posati lungo il proprio corridoio (`own` nello stato del bordo), che percorre sempre in avanti. Rapporti di posizione, autorizzazioni, profili e collegamenti sono quindi nelle progressive del corridoio; dopo un cambio di percorso vengono posati di nuovo. L'autorizzazione è quella che il motore calcola dal blocco, come su una linea. `NET-9` esegue i tre scenari di rete con il bordo di riferimento.

I dati aperti funzionano su una rete ([DATI_APERTI.md](../DATI_APERTI.md)); l'importazione degli orari abbina ancora le fermate a una linea sola.

Ci sono poi altri limiti:
- una linea si usa al più una volta per itinerario: un’inversione è un nuovo servizio dello stesso giro (passo 4d);
- il treno comandato corre sulla linea principale;
- l'interfaccia disegna la linea principale e i treni che vi si trovano, e non mostra i treni mentre sono su altre linee.

## Invarianti

- Senza `network` nello scenario la rete è la sola linea principale, e ogni corsa è identica a prima: lo confermano l'impronta della campagna e le verifiche.
- Con una rete ogni corsa è deterministica: i treni avanzano in un ordine fisso, e gli itinerari di nodo si assegnano con un ordine totale (distanza, orario, indice del treno).
- Due treni dello stesso verso non condividono mai il binario su una linea, e due treni di versi opposti non condividono mai una sezione a binario unico. `verify-network` lo controlla a ogni passo.
- Con la terra con apparato nessuna sezione di nessuna linea è mai occupata da due treni, e una corsa su una linea sola è identica a prima: la configurazione della terra non ha il campo `network` e gli itinerari di nodo non esistono.

## Verifiche

`scripts/verify-network.ts` contiene queste prove.
- `NET-1`: il nodo cade nello stesso punto del piano; i corridoi su una linea sono le linee stesse; i corridoi di due linee hanno stazioni, limiti, pendenze, curvatura, piano e segnali delle loro linee; le progressive passano dal corridoio alle linee e ritorno.
- `NET-2`: itinerari attraverso il nodo, fermate in ordine di marcia, errori.
- `NET-3`: lo scenario `scenarios/services/branch.json` con ETCS e con il blocco automatico. Tutti i treni sono in orario e senza interventi, l'incrocio avviene a Pietrarsa, con il treno opposto in ritardo l'incrocio resta lì, nessun binario condiviso, determinismo.
- `NET-4`: un treno dalla diramazione e uno da Monte Clanio entrano a San Felice Scalo sulla linea principale verso Valle Lauro uno alla volta.
- `NET-5`: ciò che non è supportato viene rifiutato (un cambio di percorso che richiederebbe itinerari che gli apparati non hanno).
- `NET-8`: dati aperti della rete, stazioni, posizioni lungo i corridoi, block_id, trasbordi e interscambi NeTEx.
- `NET-9`: bordo di riferimento a messaggi sui tre scenari di rete.
- `NET-6`: giro del materiale, ritardo trasmesso in forma chiusa.
- `NET-7`: coincidenza tenuta, tenuta dopo un'attesa, persa.
- `NET-10`: la terra con apparato su cinque scenari (diramazione, navetta, un treno da Monte Clanio che entra sulla linea principale dove esce il treno della diramazione, due treni di versi opposti lungo tre linee dell'anello, e il cambio di percorso di `loop-reroute` attorno alla linea principale interrotta). Tutti i treni in orario senza interventi, nessun deviatoio tallonato, nessuna sezione di nessuna linea occupata da due treni in nessun passo, la velocità deviata sul binario II di un nodo, il determinismo, il consenso di San Felice Scalo che passa alla diramazione per il treno che ne esce.
- `NET-11`: gli apparati della rete come programma esterno (`examples/trackside/trackside_stdio.ts`) danno la stessa corsa che nel processo, anche con il cambio di percorso.
- `NET-12`: un treno verso la diramazione in ritardo di 300 s e di 600 s incontra al nodo il treno che ne esce: nessun blocco reciproco, nessuna sezione condivisa.

## Dove estenderlo

- Più RBC su una rete, con un confine a un nodo (su una linea singola è fatto); un apparato per stazione; nodi interni a una stazione di entrambe le linee.
- Passo 4c: le coincidenze fra treni in un nodo.
- Passo 4d: giri del materiale e inversioni, cioè una linea percorsa due volte dallo stesso veicolo.
- Passo 4e: cambi di percorso decisi dal regolatore, che richiedono itinerari alternativi.
- Fase 5: reti importate da RINF e OpenStreetMap, scritte nello stesso formato.

## Fonti

- UIC, IRS 30100 RailTopoModel, 1ª edizione, 2016.
- railML 3, schemi dell'infrastruttura e dell'orario (elementi di rete, punti operativi, `baseItineraryPoint`).
