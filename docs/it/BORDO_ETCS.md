# Bordo ETCS a messaggi e bordo esterno

> Copia italiana. Il documento di riferimento è la versione inglese [ONBOARD_ETCS.md](../ONBOARD_ETCS.md): nomi di file, comandi e formati seguono quella; i nomi italiani della versione 0.x (campi JSON, opzioni come `--linea` o `--bordo`) restano accettati.

Con ERTMS/ETCS livello 2 YuTreno può fare la supervisione di bordo in tre modi, scelti con il campo `onboard` delle condizioni, con l'opzione `--onboard` delle corse senza grafica o con la voce *ETCS onboard* nella pagina.

**Internal** è la supervisione semplificata delle prime versioni, ancora il valore predefinito. Il bordo conosce direttamente l'autorizzazione al movimento e i limiti di linea, senza boe né messaggi, e calcola curve semplificate.

**Reference** fa entrare in gioco il lato terra a messaggi e un calcolatore di bordo (EVC) scritto per conoscere il mondo solo attraverso il protocollo descritto qui. Il RBC parla con i messaggi e i pacchetti del Subset-026, il bordo si localizza sulle boe e costruisce le curve di frenatura secondo l'impostazione del §3.13.

**External** usa lo stesso protocollo, ma il calcolatore di bordo è un programma esterno: un EVC sviluppato altrove, un prototipo di ricerca, domani una centralina vera.

In tutti e tre i casi YuTreno resta il resto del mondo: linea, apparato e blocco, RBC, boe, odometria, dinamica del treno, scenari e verdetto. Il bordo vede solo ciò che vedrebbe un EVC installato su un treno.

## Lato terra

**Boe.** Dalla linea compilata si generano i gruppi di boe:
- uno sotto il treno alla partenza, che fa da posizione memorizzata per l'inizio della missione;
- uno 40 m prima di ogni fermata;
- uno 20 m prima di ogni tabella di arresto (i segnali del blocco, che in livello 2 diventano tabelle);
- altri in linea, perché non restino mai più di 1200 m fra due gruppi.

Ogni gruppo ha due boe a 3 m l'una dall'altra, con `NID_C` = 1 e `NID_BG` progressivo. Il telegramma porta l'intestazione del §8.3 e nessun pacchetto, perché in livello 2 le boe servono alla localizzazione. Il gruppo si identifica con `NID_LRBG = NID_C · 2^14 + NID_BG`.

**RBC.** Tiene una sessione per treno, identificata dal `NID_ENGINE` dei suoi rapporti di posizione (1 per il treno guidato, poi i treni di servizio in ordine); ogni sessione ha il suo LRBG e la sua autorizzazione. Apre la sessione al primo rapporto di posizione del bordo (messaggio 136 con il pacchetto 0). Da quel momento manda il messaggio 3, riferito all'ultimo gruppo di boe che il bordo ha segnalato, con questi pacchetti:

| Pacchetto | Contenuto |
| :-- | :-- |
| 15 | autorizzazione al movimento di livello 2: una sezione fino alla fine dell'autorizzazione (`L_ENDSECTION`), punto di pericolo 50 m oltre (`D_DP`), velocità di rilascio 15 km/h (`V_RELEASEDP` = 3) |
| 27 | profilo statico di velocità (`D_STATIC`, `V_STATIC` in passi da 5 km/h), chiuso da `V_STATIC` = 127 |
| 21 | pendenze in ‰ intere, arrotondate a favore della sicurezza (`Q_GDIR`, `G_A`), chiuse da `G_A` = 255 |
| 5 | collegamento dei gruppi di boe davanti al treno |
| 65 e 66 | limitazioni temporanee degli scenari, emesse e revocate |

Il messaggio parte quando cambia qualcosa (autorizzazione, LRBG, limitazioni) e comunque ogni 5 s, così il bordo può sorvegliare il contatto radio. L'ordine di arresto degli scenari diventa il messaggio 16 (arresto d'emergenza incondizionato). Con la radio guasta i messaggi nei due sensi vanno persi e il RBC non li ripete.

Tutte le distanze sono in metri (`Q_SCALE` = 1). I gruppi di boe hanno un verso nominale, quello della linea. Un treno che va nel senso opposto (un servizio verso l'origine) legge `N_PIG` = 1 prima di `N_PIG` = 0. Il bordo capisce così di aver passato il gruppo al contrario e lo dice nei rapporti di posizione (`Q_DIRLRBG`, `Q_DLRBG`, `Q_DIRTRAIN` = 0). L'RBC gli manda allora pacchetti con `Q_DIR` = 0, con le distanze contate dall'LRBG nel suo senso di marcia, e il bordo tiene solo i pacchetti validi per il suo orientamento (`Q_DIR` uguale a esso, oppure 2). I treni nel verso nominale ricevono `Q_DIR` = 1, come prima. Appena oltre le stazioni da cui partono treni al contrario si aggiunge un gruppo, perché anche loro abbiano una posizione memorizzata alle spalle; è numerato dopo i gruppi della linea, che conservano i loro identificativi. Le iterazioni di un pacchetto stanno nel campo `elements`, dopo i valori del primo elemento, che restano al livello del pacchetto. È il modo in cui il Subset-026 li ordina, con `N_ITER` che dice quanti elementi seguono.

Con `--trackside interlocking` l'autorizzazione viene invece dagli itinerari di un apparato: vedi [TERRA.md](TERRA.md).

## Protocollo del bordo

A ogni ciclo del bordo, ogni 100 ms salvo diversa indicazione (`onboard_period_s`, `--onboard-cycle`), il motore si ferma e manda al bordo una richiesta JSON:

```json
{
  "type": "onboard", "version": 2, "start": false, "t": 61.3, "dt": 0.1,
  "odometry": { "distance_m": 1802.4, "speed_ms": 27.1, "acceleration_ms2": 0.12 },
  "balises": [ { "odometer_m": 1801.9, "telegram": { "N_PIG": 0, "NID_C": 1, "NID_BG": 4, "...": "..." } } ],
  "radio": [ { "NID_MESSAGE": 3, "T_TRAIN": 6125, "NID_LRBG": 16388, "packets": [ "..." ] } ],
  "train": { "doors_open": false, "emergency_applied": false, "traction": 0.6, "brake": 0 }
}
```

`odometry` dà la distanza percorsa dalla partenza, esatta salvo un evento `odometry_drift` nello scenario: allora la distanza, la velocità e le letture dell'odometro alle boe segnano più o meno di quanto il treno percorre, di `slope` metri per metro, dall'inizio dell'evento (vedi sotto). `balises` elenca le boe lette nel ciclo, ciascuna con la lettura dell'odometro al passaggio. `radio` contiene i messaggi del RBC arrivati nel ciclo. Alla prima richiesta (`start`) ci sono anche:
- `train_data`: lunghezza, velocità massima, decelerazioni d'urgenza e di servizio, tempi di frenatura e di taglio della trazione, masse rotanti;
- `national_values`: margini di velocità, tempi del macchinista e dell'avviso, `T_NVCONTACT` e `M_NVCONTACT`, errore dell'odometria;
- `stored_position`: il gruppo di boe sotto il treno e la distanza della testa da esso.

`train.integrity` (facoltativo, `"confirmed"` o `"lost"`) è l'integrità del treno data da una fonte esterna attraverso l'interfaccia del treno (Subset-026 §3.6.5.2): il motore la manda solo dopo che è scattato un evento `integrity_loss`, e senza il bordo considera l'integrità confermata. Il bordo di riferimento la riporta nel pacchetto 0 con i nomi della Baseline 4: `Q_INTEGRITY` 1 e la lunghezza confermata `L_TRAININT` (lunghezza del treno più `L_DOUBTUNDER`, perché la conferma si rinnova prima di ogni rapporto), oppure `Q_INTEGRITY` 3 senza lunghezza, in ogni rapporto dalla perdita, che a sua volta fa partire un rapporto.

Il bordo risponde con i comandi verso il treno, i messaggi per il RBC e ciò che il DMI deve mostrare:

```json
{
  "outputs": { "service_brake": false, "emergency": false, "traction_cut_off": false },
  "emergency_reason": "intervention",
  "radio": [ { "NID_MESSAGE": 136, "T_TRAIN": 6130, "packets": [ { "NID_PACKET": 0, "NID_LRBG": 16388, "D_LRBG": 1, "...": "..." } ] } ],
  "dmi": { "mode": "FS", "state": "NOR", "v_mrsp_ms": 38.9, "v_permitted_ms": 38.9, "v_warning_ms": 40.0,
           "v_sbi_ms": 40.4, "v_intervention_ms": 41.0, "target": { "distance_m": 812, "speed_ms": 25, "type": "limit 90 km/h" } }
}
```

Il DMI può contenere anche il campo facoltativo `ato`, con i dati che il bordo mette a disposizione dell'ATO sul modello del Subset-130. Sono gli stessi campi di `etcs_ato` nell'osservazione del controllore ([API.md](API.md#dati-del-bordo-per-lato-subset-130)), ma con le posizioni (`N_LOC_EBI`, `N_LOC_EOALOA`, `N_LOC_SVL`, `MRSP`, `GRADIENT`) in letture dell'odometro del bordo. Il motore le converte in progressive di linea prima di passarle al controllore. Un bordo che non fornisce `ato` funziona lo stesso, ma un ATO che pianifica rispetto all'EBI non ha i dati per farlo.

I comandi valgono fino alla risposta successiva. Il motore li applica come farebbe l'interfaccia treno (TIU): l'urgenza toglie la trazione e frena a fondo, la frenatura di servizio frena al massimo di servizio, il taglio della trazione la toglie e basta. `emergency_reason` serve al verdetto. Solo `intervention` conta come intervento della protezione; `trip`, `emergency_stop` e `radio_contact` restano nel registro. Il superamento della fine dell'autorizzazione lo conta il motore, che sa dove si trova davvero il treno, e non frena al posto del bordo: un bordo che non frena è proprio ciò che una prova deve scoprire. Conta sia la testa oltre la fine dell'autorizzazione di più di 0,5 m sia la testa che passa un segnale ancora a via impedita per il treno, perché l'autorizzazione che il motore ricalcola dalla posizione va oltre un segnale appena la testa lo ha passato ([segnalamento.md](progetto/segnalamento.md#superamenti-e-autorizzazione-ricalcolata-dalla-posizione)).

Con più RBC i messaggi radio portano `NID_RBC` (facoltativo): in un messaggio al bordo l'RBC che lo manda, in un messaggio del bordo l'RBC a cui è destinato. Un bordo esterno che deve attraversare un confine fra RBC deve leggerlo e indirizzare con esso i suoi messaggi; con un solo RBC manca.

Un EVC scritto per la versione 0.x parla il protocollo versione 1, con i nomi italiani (`tipo: "bordo"`, `odometria`, `boe`, `uscite`…): si collega con `--protocol 1`, e le sue risposte si accettano con i nomi di entrambe le lingue.

## Bordo di riferimento

`src/core/evc.ts` è il calcolatore di bordo del nucleo. Si localizza sull'ultimo gruppo di boe letto e tiene un intervallo di confidenza che cresce con la distanza dal gruppo. Converte autorizzazione, profilo statico, pendenze e limitazioni temporanee dalle coordinate del LRBG a quelle dell'odometro.

Per ogni obiettivo, cioè ogni riduzione di velocità, la fine dell'autorizzazione e il punto di pericolo, calcola le curve di frenatura:
- la curva d'urgenza (EBD) e quella di servizio (SBD), integrando la decelerazione sulla pendenza tratto per tratto, con la correzione per le masse rotanti;
- da quelle, con i tempi di taglio della trazione, di frenatura e del macchinista, le velocità di intervento (EBI), di frenatura di servizio (SBI), di avviso (W), consentita (P) e di indicazione (I).

La supervisione di tetto usa i margini di velocità del Subset-026, interpolati con la velocità fra i valori minimi e massimi. Il bordo comanda l'urgenza oltre l'intervento e la frenatura di servizio oltre la SBI, finché la velocità non torna sotto la consentita. Scatta se la testa, nella sua posizione più arretrata possibile, supera la fine dell'autorizzazione. Frena se non riceve messaggi dal RBC per più di `T_NVCONTACT` e risponde all'ordine di arresto. Manda un rapporto di posizione a ogni gruppo di boe, a ogni cambio di modo e ogni 6 s.

Fornisce anche i dati per l'ATO. In particolare la posizione del limite di intervento più vicino (`N_LOC_EBI`) si ricava risalendo la curva EBD dall'obiettivo fino alla velocità attuale, tratto di pendenza per tratto di pendenza, e sottraendo la distanza percorsa nei tempi di taglio della trazione e di frenatura.

È dichiaratamente parziale. Mancano tra l'altro:
- la dipendenza delle decelerazioni dalla velocità e la compensazione dell'accelerazione stimata;
- i modi on sight e staff responsible e le transizioni di livello;
- le autorizzazioni a più sezioni con temporizzatori, i messaggi condizionali e i riconoscimenti del macchinista.

Dopo uno scatto o un ordine di arresto, fermo il treno, il bordo torna in supervisione completa alla prima autorizzazione, senza chiedere il riconoscimento.

**Due RBC.** Con la terra con apparato e i confini fra RBC (`rbc_borders_m`, [TERRA.md](TERRA.md#più-rbc-e-il-passaggio-fra-rbc)) il bordo ha due terminali radio e può tenere due sessioni. Il primo `NID_RBC` che sente è il suo RBC di supervisione. Il pacchetto 131 in un'autorizzazione gli indica l'RBC che accetta e la distanza dal confine: da allora manda i rapporti di posizione a entrambi, conserva quello che l'RBC che accetta gli manda e non ne usa ancora nulla. Al primo rapporto verso l'RBC che accetta con la testa massima sicura oltre il confine passa a lui la supervisione e applica i messaggi conservati; dal vecchio RBC accetta poi solo l'ordine di chiudere la sessione (pacchetto 42, `Q_RBC` = 0), a cui risponde con il messaggio 156. Quando la coda minima sicura passa il confine fa un altro rapporto; senza l'ordine ripete il rapporto tre volte ogni 15 s e poi chiude da solo. I messaggi di ogni altro RBC sono ignorati. Senza `NID_RBC` nei messaggi si comporta esattamente come prima. Il bordo con un solo terminale radio, che deve chiudere la prima sessione prima di aprire la seconda, non è ancora fatto.

Il controllore di esempio guida con questo bordo su tutte le linee senza interventi. Gli scenari hanno gli stessi verdetti della supervisione interna. Le corse sono più tese, cioè frenature più tardive e qualche kWh in più, perché la supervisione interna usa decelerazioni ridotte prudenzialmente per l'aderenza mentre il bordo di riferimento usa quelle dei dati del treno.


**Deriva dell'odometria.** Il bordo di riferimento localizza il treno dal suo ultimo gruppo di boe: la distanza dal gruppo è la differenza di due letture dell'odometro, quindi un odometro che deriva dà un errore che riparte da zero a ogni gruppo e cresce con la distanza da esso, di quanto deriva. Il suo intervallo di confidenza è 2 m + 1 % di quella distanza (`odo_error_fixed_m`, `odo_error_relative`) e non controlla la precisione dell'odometro (Subset-026 §3.6.8, mancante), quindi una deriva oltre l'1 % porta l'errore fuori dall'intervallo senza che il bordo lo sappia. `verify-onboard` O10 lo misura su Valle Lauro dietro il merci, con gruppi a non più di 1200 m:

| Deriva | Errore massimo | Fuori dall'intervallo di | Arresto prima della fine dell'autorizzazione |
| :-- | :-- | :-- | :-- |
| nessuna | 0 m | — | 37,4 m |
| −1 % | 11,4 m | — (dentro) | 26,1 m |
| −5 % (`scenarios/odometry-drift.json`) | 56,9 m | 44,1 m | 2,0 m |
| +5 % | 56,8 m | 42,9 m | 90,7 m |
| −10 % | 113,7 m | 101,5 m | segnale 6 superato a via impedita |

Un odometro che segna meno di quanto il treno percorre è il caso pericoloso: il bordo crede il treno più indietro, e a −10 % il treno supera il segnale che protegge il merci davanti; il motore lo conta come superamento e trattiene lì il treno finché il segnale non si libera ([segnalamento.md](progetto/segnalamento.md#superamenti-e-autorizzazione-ricalcolata-dalla-posizione)). Un odometro che segna di più sta dalla parte della sicurezza e costa solo distanza. Le fermate ai marciapiedi non cambiano, perché `examples/ato.js` legge la distanza dalla fermata dall'osservazione del motore, non dal bordo.

## Collegare un EVC esterno

Il bordo esterno usa gli stessi canali della dinamica esterna:

```bash
npm run headless -- --onboard "exec:python examples/onboard/minimal_onboard.py"     # processo su stdin/stdout
npm run headless -- --onboard tcp://localhost:6000                              # EVC già in ascolto, righe di JSON
npm run headless -- --onboard ws://localhost:8767                               # EVC come server WebSocket
npm run headless -- --onboard examples/my_onboard.js                             # function bordo(req, mem) in JavaScript
npm run headless -- --scenario scenarios --onboard "exec:..."                   # tutti gli scenari con il tuo EVC
```

Nella pagina si sceglie *External via API* nella barra delle condizioni e si indica l'indirizzo WebSocket. Il ponte porta la pagina all'EVC:

```bash
npm run bridge -- --port 8767 --exec "python examples/onboard/minimal_onboard.py"
```

Si possono usare insieme un bordo esterno e una dinamica esterna, ciascuno sul suo canale.

Ci sono due esempi.
- `examples/onboard/minimal_onboard.py` è un bordo minimo in Python, scritto apposta come traccia. Si localizza, legge i pacchetti 15, 27, 65 e 66, calcola una curva semplice verso gli obiettivi e manda i rapporti di posizione. Guida il controllore di esempio fino al capolinea su entrambe le linee.
- `examples/onboard/onboard_stdio.ts` fa girare il bordo di riferimento del nucleo come processo esterno. Le verifiche controllano che dia esattamente gli stessi dati della versione interna.

Per un percorso passo passo, compresa l'integrazione di openETCS, vedi [GUIDA_EVC.md](GUIDA_EVC.md).

## Verifiche

`scripts/verify-onboard.ts` controlla:
- la disposizione delle boe;
- l'apertura della sessione e il contenuto del messaggio 3, con la distanza dalla boa di riferimento alla fine dell'autorizzazione;
- le limitazioni temporanee come pacchetto 65 e l'arresto come messaggio 16;
- le corse complete senza interventi e deterministiche;
- gli stessi verdetti della supervisione interna su tutti gli scenari ETCS;
- un macchinista che non frena mai e viene fermato dal bordo prima della fine dell'autorizzazione;
- l'equivalenza fra bordo interno ed esterno.

`scripts/verify-subset026.ts` prova il bordo di riferimento clausola per clausola, guidandolo ciclo per ciclo con telegrammi e messaggi costruiti a mano: localizzazione, rapporti di posizione, autorizzazione e suo aggiornamento, SSP, TSR, restrizioni legate al treno, MRSP con la lunghezza del treno, margini e stati della supervisione a soffitto, correzione per pendenza e masse rotanti, EBD/SBD/EBI/SBI in forma chiusa, velocità di rilascio, scatto e post scatto, arresto d'emergenza, perdita del contatto radio e i dati del Subset-130. Ogni blocco è collegato alle righe della matrice che copre ([TRACCIABILITA.md](TRACCIABILITA.md)).

## Verso l'hardware

Il protocollo è già quello che servirebbe a un banco di prova: odometria, boe e radio in ingresso, comandi verso il treno e DMI in uscita, come nell'architettura di prova del Subset-094. Restano due passi.

Il primo è una modalità a tempo reale del motore, agganciata all'orologio invece che al passo, perché un EVC vero non aspetta. Il secondo sono gli adattatori fisici: impulsi dell'odometria, telegrammi verso un'antenna o un simulatore di BTM, Euroradio verso il RBC, linee del treno verso la TIU.

Prima ancora conviene la codifica a bit di telegrammi e messaggi secondo il Subset-026 §7–8, così da mettere alla prova anche il decodificatore del bordo.
