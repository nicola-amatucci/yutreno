# Lato terra: apparato e RBC

> Copia italiana. Il documento di riferimento è la versione inglese [TRACKSIDE.md](../TRACKSIDE.md): nomi di file, comandi e formati seguono quella; i nomi italiani della versione 0.x (campi JSON, opzioni come `--linea` o `--bordo`) restano accettati.

Fino a questa versione il lato terra di YuTreno era un RBC semplice dentro il motore. Calcolava l'autorizzazione al movimento dalla posizione del treno che precede e dai segnali di blocco, senza deviatoi, itinerari né circuiti di binario. Bastava a mettere alla prova un bordo, ma non diceva niente di come un'autorizzazione nasce davvero: da itinerari formati da un apparato, su enti che possono guastarsi.

Il componente di terra (`src/trackside/`) aggiunge questo pezzo. È un apparato centrale (ACC) che comanda deviatoi e legge circuiti di binario con i telegrammi EULYNX, più un RBC che costruisce l'autorizzazione dagli itinerari dell'apparato. Il motore simula solo il campo, cioè deviatoi e circuiti, e parla con la terra attraverso un protocollo di richiesta e risposta. La stessa classe gira nel processo oppure come programma esterno, come il bordo ETCS e la dinamica esterna.

Questo documento spiega come è fatto, cosa usa degli standard e cosa invece è inventato o semplificato. L'ultima parte è la più importante, perché dice dove i risultati ottenuti con questa terra non si possono trasferire a un sistema reale.

## Come si sceglie

Il lato terra si sceglie nelle condizioni dello scenario (`trackside`) o con l'opzione `--trackside` delle corse senza grafica:

| Valore | Cosa fa |
|---|---|
| `simple` | il RBC del motore, come prima (predefinito) |
| `interlocking` | il componente di terra nel processo: apparato e RBC |
| `exec:command`, `tcp://`, `ws://` | lo stesso protocollo verso un programma esterno (`trackside: 'external'`) |

La terra con apparato richiede ETCS e un bordo a messaggi, cioè il bordo di riferimento o uno esterno. Con il blocco automatico e SCMT l'opzione viene ignorata, con il bordo interno semplificato il motore rifiuta la configurazione. Nella pagina c'è il menu **Lato terra** accanto a quello del bordo, e con la terra con apparato compare il **quadro del posto centrale**.

```
npm run headless -- --onboard reference --trackside interlocking
npm run headless -- --onboard reference --trackside "exec:npx tsx examples/trackside/trackside_stdio.ts"
npm run headless -- --scenario scenarios/trackside
```

Con la terra semplice nessun numero cambia: le 48 corse della campagna di riferimento danno gli stessi numeri di prima.

## Architettura

Il confine passa fra il campo, che sta nel motore, e la logica, che sta nella terra.

- **Il campo** (`Field` in `src/core/field.ts`) è fisica e basta. I deviatoi si muovono in un tempo di manovra fisso e possono essere bloccati, perdere il controllo della posizione o essere tallonati. I circuiti di binario sono occupati quando un treno ci sta sopra, sul ramo giusto: fra i due deviatoi di una stazione il treno è sul binario I o sul II, secondo la posizione del deviatoio d'ingresso quando la testa l'ha passato. Se il deviatoio d'uscita non è disposto per il ramo da cui arriva il treno, il campo segnala un tallonamento. Il campo sa anche abbassare la velocità ammessa sul ramo deviato.
- **L'apparato** (`Interlocking` in `src/trackside/interlocking.ts`) conosce gli enti solo dai telegrammi. Comanda i deviatoi e gestisce gli itinerari: formazione, controllo, occupazione, liberazione e annullamento.
- **Il RBC** (`TracksideRbc` in `src/trackside/rbc.ts`) riceve i rapporti di posizione del bordo e costruisce l'autorizzazione dagli itinerari che l'apparato considera validi.
- **`Trackside`** (`src/trackside/index.ts`) mette insieme apparato e RBC dietro il protocollo.

A ogni ciclo di terra (0,1 s per impostazione predefinita) succedono queste cose nell'ordine:

1. il motore manda alla terra i telegrammi del campo, i messaggi radio del bordo e i comandi del posto centrale;
2. l'apparato aggiorna lo stato degli enti;
3. il RBC legge i messaggi del bordo;
4. i comandi del posto centrale vanno all'apparato o al RBC;
5. l'apparato fa avanzare gli itinerari e la formazione automatica;
6. il RBC calcola l'autorizzazione.

La risposta porta i comandi per gli enti, i messaggi radio per il bordo, lo stato del quadro e gli eventi da registrare. Il bordo nel processo scambia prima della terra, così la terra riceve i messaggi dello stesso ciclo; con un bordo o una terra esterni l'ordine è lo stesso. La terra esterna via `exec:` produce perciò una corsa identica byte per byte a quella nel processo, e `verify-trackside` lo controlla.

Il protocollo è un'interfaccia pubblica, come quello del bordo. I tipi sono in `src/trackside/types.ts` (`TracksideRequest`, `TracksideResponse`). La prima richiesta ha `start: true` e contiene la `configuration` completa, cioè enti, itinerari, boe, linea e orario. Le successive contengono solo i cambiamenti:

```json
{ "type": "trackside", "version": 2, "start": false, "t": 12.3, "dt": 0.1,
  "field": [ { "interface": "SCI-TDS", "message": "Msg_TVPS_Occupancy_Status", "sender": "Line/B3", "receiver": "IXL", "Occupancy_Status": 2, "Change_Trigger": 1 } ],
  "radio": [ { "NID_MESSAGE": 136, "...": "..." } ],
  "commands": [ { "type": "set_route", "id": "Ponte Sabato/2" } ] }
```

```json
{ "field": [ { "interface": "SCI-P", "message": "Cd_Move_Point", "sender": "IXL", "receiver": "Ponte Sabato/1", "Commanded_Point_Position": 2 } ],
  "radio": [ { "NID_MESSAGE": 3, "...": "..." } ],
  "panel": { "ars": true, "routes": [], "points": [], "tvps": [], "ma": null, "speed_restrictions": [] } }
```

**Su una rete** ([progetto/rete.md](progetto/rete.md)) la configurazione è quella della linea principale con il campo facoltativo `network`, e una terra che non deve gestire reti può ignorare tutto ciò che segue. `network.interlockings` ha una voce per ogni altra linea (enti, itinerari, marker, stazioni e orari dei treni che la percorrono, nelle sue progressive; i siti hanno il prefisso dell'id della linea); `network.boundaries` elenca i nodi fra due apparati con quello che tiene il consenso all'inizio; `network.corridors` dà, per ogni treno che corre fuori dalla linea principale, i suoi gruppi di balise e i tratti del suo corridoio (linea, verso, origine nel corridoio e sulla linea, limiti, `null` se illimitati). Alcuni campi compaiono solo su una rete: deviatoi di tipo `junction` con la linea verso cui portano, itinerari con `link` (`line`, `side` `out` oppure `in`, `boundary`), marker con `node`, voci d'orario con `from_line` e `to_line`, la `line` di un comando `timetable`, il comando `corridor` (il nuovo corridoio di un treno a cui il percorso è cambiato prima che compaia), e nel quadro sessioni con `frame: "corridor"` quando l'autorizzazione è nelle progressive del corridoio. Le sessioni del quadro elencano anche gli itinerari (`routes`) su cui corre la loro autorizzazione, su una rete e su una linea sola. La terra di riferimento ha un apparato per linea e un solo RBC; il consenso al confine viaggia fra gli apparati con un ciclo di ritardo e, sulla linea che finisce al nodo, va insieme al consenso di blocco della tratta vicina.

`examples/trackside/trackside_stdio.ts` è la traccia per scrivere una terra in un altro linguaggio, oppure per collegare un simulatore di apparato vero: una riga di JSON per messaggio, su stdin e stdout. Una terra scritta per la versione 0.x parla il protocollo versione 1 con i nomi italiani (`tipo: "terra"`, `campo`, `comandi`, `quadro`) e si collega con `--protocol 1`.

## Cosa viene da EULYNX

Fra apparato e campo i telegrammi sono quelli di EULYNX Baseline 4 Release 4. Nomi dei messaggi, nomi dei campi e codici sono quelli dei documenti; manca la codifica a byte. Sono usati:

- **SCI-P** (Eu.Doc.38, deviatoio):
  - `Cd_Move_Point`, con Commanded_Point_Position 0x01 destra e 0x02 sinistra;
  - `Msg_Point_Position`, con Reported_Point_Position 0x01 fine corsa destra, 0x02 sinistra, 0x03 nessuna fine corsa, 0x04 posizione non voluta;
  - `Msg_Movement_Failed`;
  - `Msg_Ability_To_Move_Point`, con 0x01 manovrabile e 0x02 non manovrabile.
- **SCI-TDS** (Eu.Doc.44, rilevamento treno): `Msg_TVPS_Occupancy_Status`, con Occupancy_Status 0x01 libera, 0x02 occupata, 0x03 disturbata e Change_Trigger 0x01 passaggio, 0x04 guasto, 0x05 stato iniziale.

La posizione normale di un deviatoio, destra o sinistra, è un dato di progetto della Tabella delle Condizioni. L'apparato la usa per tradurre normale e rovescio nei comandi destra e sinistra di EULYNX.

Le interfacce fra apparato e RBC (SCI-RBC) e fra apparato e posto centrale (SCI-CC) non sono pubblicate nella Baseline 4 Release 4: quelle di YuTreno sono proprie. Il RBC legge dall'apparato gli itinerari e lo stato degli enti. In cambio gli comunica la posizione del treno e gli itinerari già compresi in un'autorizzazione, che servono all'annullamento ritardato. Il posto centrale manda comandi (`OperatorCommand`) e riceve il quadro (`PanelState`).

## La Tabella delle Condizioni

Gli itinerari non si scrivono a mano nella configurazione dell'apparato. Si descrivono in una **Tabella delle Condizioni** in stile RFI (`ControlTable` in `src/trackside/control-table.ts`), una per impianto, e `translateControlTables()` la converte.

Per ogni impianto la tabella elenca gli enti:

- deviatoi, con progressiva, posizione normale, ramo del rovescio, tipo e tempo di manovra;
- circuiti di binario, con il binario su cui si trovano;
- segnali o tabelle di arresto ETCS.

Per ogni itinerario dà:

- origine e fine;
- i deviatoi con la posizione richiesta, nella notazione `1N` e `2R`;
- i circuiti da controllare liberi, nell'ordine;
- il percorso di uscita oltre la fine, con lunghezza e circuiti;
- la velocità in deviata;
- gli itinerari inconciliabili;
- il modo di liberazione.

Il traduttore controlla che ogni ente citato sia dichiarato e raccoglie gli avvisi. Completa poi le inconciliabilità dichiarate con quelle che discendono dagli enti: due itinerari sono inconciliabili se usano lo stesso deviatoio in posizioni diverse o hanno un circuito in comune.

Il formato è una **ricostruzione** della pratica italiana fatta per YuTreno, non un documento RFI. I nomi e la struttura seguono quello che si trova nei piani schematici e nelle tabelle delle condizioni di un ACC. È però da validare con chi progetta apparati, soprattutto per inconciliabilità, percorsi di uscita e liberazione.

Per le linee di esempio le tabelle le genera `generateLayout()` (`src/core/field.ts`). Ogni stazione intermedia ha:

- un binario di corsa I e un binario di precedenza II;
- un deviatoio d'ingresso a 300 m prima del fabbricato e uno d'uscita a 310 m dopo;
- quattro itinerari: ingresso su I e su II, partenza da I e da II, con la deviata a 60 km/h;
- una prima sezione di blocco dopo la stazione, che appartiene agli itinerari di partenza.

L'origine ha solo la partenza e il capolinea solo l'arrivo. La linea è un impianto a sé, con un itinerario automatico per ogni sezione di blocco.

**Due sensi di marcia.** Quando qualche servizio va verso l'origine, `generateLayout(L, { reverse: true })` aggiunge gli itinerari del senso inverso sugli stessi enti:

- in ogni stazione intermedia, gli ingressi dal lato opposto su I (deviatoio 2 in normale) e su II (deviatoio 2 in rovescio, 60 km/h), con la zona deviatoi del lato vicino come percorso di uscita, e le partenze da I e da II verso l'origine;
- la partenza dal capolinea e l'arrivo all'origine;
- il blocco di linea percorso dalla fine verso l'origine, un itinerario per ogni sezione di blocco.

Gli itinerari inversi hanno i propri punti di arresto (`RH`, `RP_I`, `RP_II`, `REND` nelle stazioni, `Line/RB…` ai confini delle sezioni). Con ETCS livello 2 sono tabelle di arresto, quindi non serve un segnale laterale. Gli itinerari dei due sensi che condividono una sezione, o in cui il percorso di uscita dell'uno è il percorso dell'altro, sono inconciliabili. Senza treni verso l'origine le tabelle restano quelle del solo senso nominale, byte per byte.

## L'apparato

Un itinerario passa per questi stati:

1. **libero**;
2. **in formazione**: la richiesta è accettata se nessun itinerario inconciliabile è attivo, se le sezioni del percorso e dell'uscita sono libere e se i deviatoi non sono bloccati da altri itinerari e si possono manovrare. Sezioni e deviatoi vengono bloccati e i deviatoi comandati;
3. **formato**: tutti i deviatoi sono controllati nella posizione richiesta. Se non succede entro 20 s l'itinerario fallisce e si libera;
4. **occupato**: il treno è entrato;
5. di nuovo **libero**, con la liberazione elastica. Ogni sezione si libera quando il treno l'ha occupata e poi lasciata, e i deviatoi che contiene si sbloccano con lei (e tornano in normale). L'itinerario si libera quando le sezioni prima della destinazione sono liberate e il treno occupa la destinazione.

Un itinerario formato che perde l'integrità non vale più per le autorizzazioni, finché non torna integro o non viene annullato. Succede se un deviatoio perde il controllo o se una sezione è disturbata.

L'annullamento di un itinerario formato è immediato, ma diventa **ritardato** (120 s) se il RBC ha già concesso un'autorizzazione che lo comprende. È la versione semplice del bloccamento d'approccio: un treno che ha già ricevuto l'autorizzazione potrebbe non riuscire più a fermarsi prima del deviatoio. Un itinerario occupato non si annulla e si libera al passaggio.

Le sezioni di blocco in linea si formano sempre da sole, appena sono libere. Con itinerari nei due sensi ogni tratta a binario unico fra due stazioni ha un **consenso di blocco**, tenuto da una delle due stazioni ai suoi capi, e solo quella stazione può mandare treni nella tratta. All'inizio lo tiene la stazione dal lato dell'origine. Il blocco automatico della tratta funziona nel senso del consenso.

Una partenza dall'altro capo lo chiede. La stazione che tiene il consenso lo cede solo se la tratta è vuota: nessuna partenza verso la tratta è attiva e tutte le sue sezioni sono libere. Allora libera gli itinerari di blocco inattivi del suo senso e manda il consenso. Altrimenti rifiuta, e l'altro capo richiede dopo 2 s. Nel frattempo la partenza aspetta (*waiting for the block consent from …*).

Ogni messaggio arriva all'altro capo un ciclo dopo, come fra due apparati adiacenti. Mentre il consenso viaggia nessuno dei due capi lo tiene, quindi i due capi non possono mai tenerlo insieme, nemmeno se lo chiedono nello stesso ciclo. EULYNX affida il blocco di linea fra apparati adiacenti all'interfaccia SCI-ILS, senza fissarne i telegrammi; i messaggi qui (richiesta, concessione, rifiuto) sono di YuTreno. Ogni passaggio finisce nel registro (*Block consent Ponte Sabato–San Felice Scalo given to San Felice Scalo*), e il quadro mostra chi tiene ogni consenso (`consents`). Gli itinerari di stazione li forma la **formazione automatica** (ARS) per ogni treno in sessione, il treno comandato e i treni di servizio, ciascuno secondo il proprio orario (`configuration.trains`, una voce per `NID_ENGINE`), e il posto centrale la può escludere:

- **ingresso**: quando il treno ha lasciato la stazione precedente ed è a meno di 3500 m dalla protezione. Si sceglie il binario I. Il binario II si usa solo se il treno è a meno di 1500 m e il I è ancora occupato. Così un treno che precede e sta per liberare il binario di corsa non manda il regionale in deviata senza motivo;
- **partenza**: all'ora di partenza, dal binario su cui il treno è entrato. L'apparato lo sa dall'itinerario d'ingresso che si è liberato con il treno sulla destinazione; all'origine è il binario I. Una stazione in cui l'orario non prevede fermata è un **transito**: la partenza si chiede insieme all'ingresso, entro la stessa distanza di avvicinamento, dal binario dell'ingresso concesso, così un treno che passa trova l'uscita già formata. Per la regola dei conflitti l'ordine di un transito è la sua partenza dalla stazione precedente, la stessa chiave con cui lo vedono gli altri treni.

Una fermata dell'orario può chiedere un binario (`"track": "II"` nello scenario): l'ARS usa allora solo quello. È così che un orario programma una precedenza, con il treno lento in attesa sul II mentre il più veloce passa sul I.

Quando due treni vogliono itinerari inconciliabili, di solito la stessa uscita di una stazione, decide chi chiede per primo la **regola dei conflitti** (`parameters.conflict_rule`, dal campo di scenario `conflict_rule`):

- `timetable` (predefinita): una partenza aspetta finché un treno con orario precedente nella stessa stazione si sta avvicinando (entro la finestra d'ingresso) o vi è fermo sull'altro binario. L'apparato registra *ARS: departure from … held for a train timetabled earlier*. Un treno in ritardo conserva così la sua traccia, come deciderebbe un regolatore che segue l'orario;
- `first_come`: le richieste si fanno nell'ordine in cui i treni sono pronti, senza guardare l'orario.

Nessuna delle due regole riprogramma, dà priorità o cancella una traccia che un treno guasto non può usare: è il mestiere del regolatore ([REGOLATORE.md](REGOLATORE.md)). Il regolatore parla all'apparato con due comandi del posto centrale in più: `{ "type": "priority", "engine": 2, "value": -2 }` dà a un treno una priorità (predefinita 0) che viene prima della regola dei conflitti, così che una partenza aspetti anche un treno con priorità maggiore che si avvicina alla stazione; `{ "type": "timetable", "engine": 2, "timetable": [...] }` sostituisce l'orario che la formazione automatica segue per quel treno. Lo scenario `services/precedence` mostra la differenza: con `timetable` il treno comandato, in ritardo dopo un guasto, lascia comunque San Felice Scalo prima del R 5101 e arriva a Monte Clanio a 939 s; con `first_come` parte prima il R 5101 che, rallentato da un guasto di trazione, tiene dietro di sé il treno comandato fino a 983 s.

## Il RBC

Il RBC prende la posizione del treno dal rapporto 136: gruppo di boe di riferimento, distanza percorsa e incertezza. Costruisce l'autorizzazione come una catena di itinerari consecutivi sul ramo del treno:

1. il primo è l'itinerario che contiene la testa, o in cui sta entrando;
2. si aggiungono gli itinerari che cominciano dove finisce il precedente, sullo stesso ramo, formati, integri e con le sezioni libere;
3. un itinerario già compreso nell'autorizzazione precedente resta valido anche quando è occupato. Il RBC conosce il treno solo dall'ultimo rapporto, e senza questa regola tratterebbe come un altro treno il treno stesso appena entrato nell'itinerario.

Un treno che va verso l'origine riporta `Q_DIRLRBG` = 0. Per lui il RBC ragiona nelle progressive che il treno vede, quelle della linea specchiata: usa gli itinerari e i punti di arresto inversi e manda pacchetti con `Q_DIR` = 0, distanze contate dall'LRBG nel senso di marcia e profili specchiati, con le pendenze di segno opposto. È la stessa regola del RBC semplice.

Il RBC tiene **una sessione per treno**, distinta dal `NID_ENGINE` dei rapporti. Con più sessioni il primo itinerario della catena deve essere uno già concesso a quel treno: il binario II ha le stesse progressive del I, e un treno fermo sul I sembrerebbe altrimenti dentro l'ingresso sul II formato per un altro treno. I messaggi al treno comandato (motore 1) escono come prima; quelli agli altri treni portano `NID_ENGINE`, che il motore usa per consegnarli e poi toglie. L'apparato riceve dal RBC le posizioni di tutti i treni in sessione (`RbcInfo.trains`) e l'unione degli itinerari coperti dalle loro autorizzazioni. L'arresto d'emergenza del posto centrale vale per un treno (`engine`) o, senza, per tutti; il quadro elenca le sessioni quando sono più di una.

L'EOA è la fine dell'ultimo itinerario della catena. Lo SvL è la fine del suo percorso di uscita, se le sezioni dell'uscita sono libere; altrimenti coincide con l'EOA. All'arrivo al capolinea l'autorizzazione arriva a fine linea. Le distanze del pacchetto 15 sono arrotondate per difetto, perché l'EOA trasmessa non cada mai oltre quella dell'apparato.

Il messaggio 3 contiene:

- il pacchetto 15;
- il profilo statico (27), con le velocità in deviata degli itinerari sovrapposte ai limiti di linea;
- le pendenze (21);
- i collegamenti alle boe (5);
- le limitazioni temporanee (65 e 66).

Viene mandato a ogni cambiamento e comunque ogni 5 s. L'arresto d'emergenza del posto centrale manda il messaggio 16 e trattiene ogni nuova autorizzazione finché il posto centrale non lo revoca. L'evento di scenario `rbc_emergency_stop` resta invece l'ordine singolo di prima: arresto e revoca al ciclo successivo, poi il treno riparte da fermo alla prima autorizzazione.

## Più RBC e il passaggio fra RBC

Una linea vera è divisa fra più RBC, e un treno che attraversa il confine fra due di essi passa dall'uno all'altro senza che il macchinista faccia nulla: è l'handover RBC/RBC del Subset-026 (§3.15.1 e §5.15), con il dialogo fra i due RBC del Subset-039. Dalla fase 10 il lato terra con apparato lo fa su una linea singola.

**Come si dichiara.** Lo scenario dà le progressive dei confini, `"rbc_borders_m": [7600]`. Il motore mette ogni confine sul segnale principale più vicino (7725 m sulla linea Valle Lauro) e prende come gruppo di boe di confine il gruppo entro 100 m prima di esso, poi passa al lato terra il campo facoltativo `rbcs` della configurazione: le aree (`NID_RBC`, `from_m`, `to_m`, numerate da 1 a partire dall'origine), i confini (progressiva, `NID_BG` e posizione del gruppo di confine, gli RBC ai due lati) e, facoltativi, il periodo del segnale di vita e il tempo dopo il quale il collegamento fra due RBC si considera perso (`life_sign_s`, 10 s, e `link_timeout_s`, 30 s). L'apparato resta uno per la linea; ogni RBC vede solo gli itinerari e i marker della sua area. Senza `rbcs` c'è un solo RBC come prima, e nessuna corsa cambia. Con il lato terra semplice il campo è ignorato; su una rete il motore lo rifiuta, perché i confini a un nodo non sono ancora fatti.

**Messaggi radio.** Con più RBC ogni messaggio di un RBC porta `NID_RBC`, l'RBC che lo manda, e ogni messaggio del bordo `NID_RBC`, l'RBC a cui è indirizzato. Il lato terra instrada i messaggi del bordo con questo campo (senza, all'RBC che ha il treno in sessione, altrimenti all'area della sua LRBG); un messaggio per un RBC che non esiste è scartato con un avviso negli eventi. Il campo è facoltativo: con un solo RBC manca.

**La procedura**, vista dall'RBC che cede (HOV) e da quello che accetta (ACC), come nelle tabelle di stato del Subset-039 §4.6:

1. quando l'autorizzazione dell'HOV arriva al confine, l'HOV manda all'ACC il **preannuncio** (201) con il mezzo, il gruppo di confine, il modo e il senso, e aggiunge al suo messaggio 3 il **pacchetto 131**, l'ordine di transizione, con la distanza dal confine e l'identità dell'ACC;
2. l'ACC **conferma** (205) e l'HOV **chiede le informazioni di itinerario** (202);
3. il bordo apre la seconda sessione, con l'ACC, e da allora manda i rapporti di posizione a entrambi. Quando ha il treno in sessione, l'ACC manda le **informazioni di itinerario** (221) con i pacchetti 15, 21 e 27 riferiti al gruppo di confine: l'autorizzazione che darebbe oltre il confine, con velocità e pendenze. Ne manda una nuova ogni volta che quell'autorizzazione cambia. L'HOV le conferma una per una e ci prolunga la sua autorizzazione: oltre il confine manda al bordo solo ciò che l'ACC ha mandato (§3.15.1.2.4);
4. quando la testa del treno, con l'incertezza dell'odometria, passa il confine, l'HOV manda l'**annuncio** (203) e il bordo, al rapporto successivo verso l'ACC con la testa oltre il confine, passa la supervisione all'ACC, usando i messaggi dell'ACC che aveva conservato. L'ACC risponde con la **presa di responsabilità** (222);
5. da allora l'HOV non manda più autorizzazioni. Quando un rapporto mette la coda minima sicura oltre il confine (la coda confermata: la testa riportata meno la lunghezza confermata `L_TRAININT`, dall'ultimo rapporto con l'integrità confermata, `Q_INTEGRITY` 1 o 2), ordina al bordo di **chiudere la sessione** (messaggio 24 con il pacchetto 42, `Q_RBC` = 0); il bordo manda il messaggio 156 e l'HOV chiude la sessione con il messaggio 39. Se l'ordine non arriva, il bordo ripete il rapporto della coda tre volte ogni 15 s e poi chiude da solo (§3.15.1.3.9, Appendice A.3.1);
6. l'HOV manda un **annullamento** (204) se il treno finisce la missione durante la transazione; l'ACC allora ordina al bordo di chiudere la sessione che aveva aperto.

Ogni RBC manda ai vicini un **segnale di vita** (223) ogni 10 s. Se per 30 s non arriva nulla, o il posto centrale taglia il collegamento, la transazione si interrompe (Subset-039 §4.4): l'HOV tiene la sua autorizzazione al confine e ricomincia quando il collegamento torna.

I messaggi fra RBC sono oggetti JSON con i nomi del Subset-039 (`NID_NRBCMESSAGE`, `NID_C`, `NID_RBC`, `NID_ENGINE`, `NID_BG`, `T_RBC`, `M_ACK`, `T_RBC_ACK`, `M_MODE`, `Q_DIR`, `packets`; tipo `NrbcMessage` in `types.ts`). Restano dentro il lato terra e sono consegnati con un ciclo di ritardo, così l'ordine in cui girano gli RBC non conta e la corsa è deterministica. Il quadro elenca, per ogni RBC, i treni in sessione e i passaggi in corso con il ruolo e il passo (`rbcs`), e lo stato del collegamento (`rbc_link`); l'autorizzazione e le sessioni portano il `NID_RBC` che le dà.

**Una scelta di implementazione.** L'ACC manda le informazioni di itinerario solo quando ha in sessione anche il treno, e usa l'autorizzazione che dà a quel treno. Il Subset-039 gli permette di mandarle appena richieste; ma allora un treno la cui radio non raggiunge l'ACC riceverebbe dall'HOV un'autorizzazione oltre il confine, ed entrerebbe in un'area il cui RBC non lo conosce. Così un treno che non raggiunge l'ACC si ferma alla fine dell'autorizzazione dell'HOV, come chiede il §5.15.4.2.

**Guasti.** Due eventi di scenario agiscono sul passaggio: `{ "type": "radio_loss", "rbc": 2, ... }` taglia la radio di un solo RBC, nei due sensi, e il comando del posto centrale `{ "type": "operator_command", "command": { "type": "rbc_link", "up": false }, "duration_s": 300 }` taglia il collegamento fra gli RBC per la durata data. In tutti e due i casi il treno si ferma prima del confine e riparte quando il guasto finisce.

**Cosa il passaggio non fa.** Il bordo ha bisogno di due terminali radio: il caso degradato con una sola sessione GSM-R (§3.15.1.3.2 e §5.15.3) viene dopo la fase (decisione 14). Il gruppo di boe di confine non porta il pacchetto 131, quindi l'annuncio viene solo dall'RBC e il bordo passa al confine annunciato (§5.15.1.4). Il DMI non mostra un testo proprio per il passaggio, perché il Subset-026 non ne prescrive; il quadro mostra il passo di ogni passaggio. Dati treno (207), numero del treno (208), conferma di un'autorizzazione accorciata (206, 224) e manovra (209) non si scambiano; i passaggi in successione, con un RBC che accetta e cede lo stesso treno insieme, sono fuori ambito. Le distanze delle informazioni di itinerario sono arrotondate per difetto al metro dal gruppo di confine, e quelle del messaggio 3 di nuovo dall'ultimo gruppo del treno: la fine dell'autorizzazione oltre il confine può quindi essere 1 m più corta che con un solo RBC, e arriva fino a 2 s più tardi, dopo la formazione dell'itinerario. Il moto del treno non cambia: nella corsa nominale, nell'incrocio e nel sorpasso ogni altra colonna dei dati è identica alla corsa con un solo RBC.

## Scenari e guasti

Tre tipi di evento negli scenari valgono solo con la terra con apparato:

- `point_failure`, con `element` (per esempio `"Ponte Sabato/1"`), `mode` `blocked` o `no_detection` e una durata facoltativa;
- `tvps_failure`, con `element` (per esempio `"Line/B3"`): il circuito risulta disturbato;
- `operator_command`, con `command`: un comando del posto centrale a un certo tempo o a una certa posizione.

Valgono qui anche i disservizi comuni a tutte le terre: `line_blocked` disturba i circuiti del tratto, così nessun itinerario lo attraversa finché non si riapre; `train_stopped`, `brake_degraded` e `traction_reduced` con `train` colpiscono un treno di servizio, che l'ARS e la regola dei conflitti vedono come un treno in ritardo ([SCENARI.md](SCENARI.md)).

Gli scenari di esempio in `scenarios/trackside/` usano tutti la Valle Lauro con il bordo di riferimento:

| Scenario | Cosa succede | Esito con `ato.js` |
|---|---|---|
| `nominal` | la corsa normale con tutto il lato terra | superato, 1001 s |
| `point-failure` | il deviatoio d'ingresso di Ponte Sabato perde il controllo: l'ingresso non si forma, il treno si ferma prima della protezione e riparte quando il guasto finisce | superato |
| `tvps-failure` | una sezione di blocco disturbata ferma il treno finché il circuito non torna | superato, 1302 s |
| `overtaking` | un merci si ferma sul binario I di Ponte Sabato: l'ARS manda il regionale sul II in deviata, il regionale riparte dal II e supera il merci | superato, 1167 s |
| `operator-commands` | il regolatore esclude l'ARS, comanda a mano l'ingresso sul II e la riattiva; più avanti ferma il treno con l'arresto d'emergenza e lo revoca un minuto dopo | superato, 1059 s |
| `handover` | la corsa nominale con la linea divisa fra due RBC a 7725 m: il merci e poi il treno comandato passano dall'RBC 1 all'RBC 2 | superato, 1001 s, come con un solo RBC |
| `handover-link-loss` | senza il merci; il collegamento fra i due RBC si perde da 200 a 500 s: il treno si ferma prima del confine a 7687 m e riparte quando il collegamento torna | superato, 867 s |
| `handover-radio-loss` | senza il merci; la radio dell'RBC 2 si perde da 200 a 500 s: il treno non riesce ad aprire la sessione con l'RBC 2 e si ferma prima del confine | superato, 867 s |

Dal 7 novembre 2026 il treno che precede è un merci di servizio (decisione 12), e il treno comandato lo segue: i tempi qui sopra sono cresciuti da 867, 880, 841 e 974 s. Gli scenari generali con la terra con apparato danno lo stesso esito e gli stessi conteggi che con la terra semplice. Fino ad allora c'era una differenza nei conteggi, con il freno degradato: con la terra con apparato il bordo contava 2 superamenti della fine autorizzazione che con la terra semplice non comparivano. Non era un difetto della nuova terra. In entrambi i casi il treno arrivava sull'EOA a più di 30 km/h, perché il bordo calcola le curve con il freno nominale. Il RBC semplice però ricalcola l'autorizzazione dalla posizione della testa: appena la testa passa il segnale, l'EOA salta alla sezione successiva e il superamento sparisce. L'ACC tiene ferma l'autorizzazione finché l'itinerario non si libera, e il superamento si vedeva. Dietro il merci più lento il treno comandato non arriva più su quell'EOA in velocità.

## Cosa è semplificato

Ecco l'elenco onesto, in ordine di importanza per chi usa i risultati.

1. **Un solo apparato per tutta la linea, e il treno che precede.** Il treno comandato, i treni di servizio dei due sensi e il treno che precede (`leader`) hanno ciascuno una sessione e un orario per l'ARS. Dal 7 novembre 2026 il treno che precede è un merci con il suo bordo di riferimento, come i servizi: riporta la posizione e riceve l'autorizzazione dal RBC, e il suo bordo lo supervisiona, quindi in `point-failure` e `tvps-failure` non supera più un'autorizzazione accorciata sotto le ruote. Il suo orario transita in tutte le stazioni, e dove si ferma la partenza resta indecisa finché non è pronto a ripartire; ha priorità −1, quindi cede il passo ai treni con orario. Quando la sua corsa finisce all'ultima stazione il motore manda per lui il fine missione (messaggio 150) e il RBC chiude la sessione; i servizi tengono la loro. Prima del 6 novembre il treno che precede ignorava itinerari e segnali, e in `operator-commands` tallonava il deviatoio d'uscita di Ponte Sabato; fino al 7 novembre era un treno cinematico di cui il motore riportava la posizione, senza supervisione di bordo. Il consenso di blocco si scambia fra le stazioni ai capi di ogni tratta, ma l'apparato resta un unico programma per tutta la linea: itinerari, deviatoi e sezioni non sono divisi fra apparati separati.
2. **Nessun dialogo di inizio missione.** La sessione si apre al primo rapporto di posizione; non ci sono i messaggi 155, 32, 159, 129 e 8.
3. **Accorciamento dell'autorizzazione con un nuovo messaggio 3**, senza la procedura cooperativa del §3.8.6. Il bordo di riferimento accetta l'autorizzazione più corta per sostituzione.
4. **Revoca dell'arresto senza messaggio 18.** Il RBC smette di trattenere le autorizzazioni e il bordo riparte alla prima autorizzazione da fermo.
5. **Il binario II ha le stesse progressive del I.** La geometria della deviata non c'è: c'è solo il limite di velocità sul ramo.
6. **Nessuna codifica a byte e nessuna connessione PDI** verso gli enti, quindi niente verifica di versione e niente procedure di inizializzazione EULYNX.
7. **Parametri fissi**: tempi di manovra (6 s), tempo massimo di formazione (20 s), ritardo d'annullamento (120 s), finestre dell'ARS (3500 e 1500 m), percorso di uscita (50 m). Sono plausibili, non presi da una norma.
8. **La Tabella delle Condizioni è una ricostruzione**, da validare.

La matrice di tracciabilità (`docs/traceability/matrix.csv`) ha una riga per ciascun telegramma EULYNX usato e per le interfacce non pubblicate. Le righe del Subset-026 sulla sessione, sull'autorizzazione e sui messaggi d'emergenza ora citano anche la terra con apparato.

## Verifica

`scripts/verify-trackside.ts` controlla:

1. **la traduzione**: le tabelle delle due linee si traducono senza avvisi, ogni itinerario è seguito da un altro sullo stesso ramo e i due ingressi della stessa stazione risultano inconciliabili;
2. **l'apparato da solo contro il campo**, senza motore: formazione, inconciliabilità, annullamento immediato e ritardato con riporto in normale, deviatoio non manovrabile o senza controllo, liberazione elastica prima della fine dell'itinerario, tallonamento;
3. **le corse nominali** delle due linee con la terra con apparato: complete, senza interventi né superamenti, deterministiche;
4. **gli scenari generali**: lo stesso esito con la terra semplice e con la terra con apparato;
5. **la terra esterna** via `exec:`: una corsa identica a quella nel processo, anche con due treni in sessione (`services/precedence`) e con treni nei due sensi (`services/crossing-interlocking`), senza deviatoi tallonati;
6. **la precedenza**: il treno passa davvero sul binario II;
7. **lo schema inverso**: sulle due linee, traduzione senza avvisi, itinerari nominali invariati, catena continua di itinerari nel senso inverso, ingressi opposti inconciliabili;
8. **il consenso di blocco**: una tratta data alla prima partenza, rifiutata a quella opposta, invertita quando è vuota;
9. **il passaggio fra RBC** (HO1–HO7): la corsa con due RBC è la stessa che con uno, con i messaggi del Subset-039 nell'ordine della procedura e la sessione con l'RBC 1 chiusa; con il collegamento fra gli RBC o la radio dell'RBC 2 persi il treno aspetta prima del confine durante il guasto, senza superamenti né interventi; nei due sensi (`services/crossing-interlocking`) e con due treni (`overtaking`) ogni treno passa e corre come con un solo RBC; il lato terra esterno via `exec:` dà la stessa corsa, deterministica; senza l'ordine di chiusura il bordo chiude da solo la sessione 60 s dopo; un fine missione durante la transazione fa annullare (204) all'RBC 1 e l'RBC 2 ordina al bordo di chiudere la sessione aperta con lui; un messaggio per un RBC che non esiste è scartato con un avviso.

`verify-services` fa girare anche l'incrocio con la terra con apparato: mai due treni opposti sulla stessa tratta a binario unico, e un treno opposto in ritardo che trattiene quello comandato.

Gli scenari di `scenarios/trackside/` hanno l'esito atteso registrato in `verify-scenarios.ts`. Ogni blocco porta le righe della matrice che copre.
