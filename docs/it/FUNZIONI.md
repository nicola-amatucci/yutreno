# Che cosa si può fare con YuTreno

*Copia italiana di [FEATURES.md](../FEATURES.md).*

YuTreno è un simulatore di guida del treno e di esercizio ferroviario per la ricerca e la didattica. Questo documento elenca tutto quello che sa fare, per categoria, con il punto in cui ogni funzione è descritta nei dettagli. Chiude con quello che YuTreno non fa, un riassunto della sua struttura, una mappa della documentazione e i riferimenti da cui attinge. È pensato per tre lettori: chi usa il simulatore, chi lo sviluppa e chi ne scrive.

Stato all'8 novembre 2026. I numeri che seguono (linee, scenari, verifiche) sono quelli del repository a quella data.

## In breve

| Categoria | In una frase |
| :-- | :-- |
| [Guida e cabina](#1-guida-e-cabina) | Una cabina 3D nel browser, con DMI, manipolatore, vigilanza ed emergenza, guidata a mano o da un programma. |
| [Linee, treni e dinamica](#2-linee-treni-e-dinamica) | Linee disegnate o importate, treni come catene di veicoli con organi di aggancio, oppure come punto materiale. |
| [Segnalamento e protezione](#3-segnalamento-e-protezione-della-marcia) | ETCS livello 2 con tre tipi di bordo e il blocco mobile come opzione, il blocco automatico con SCMT e una terra con apparato e telegrammi EULYNX. |
| [Guida automatica](#4-guida-automatica) | Controllori in qualsiasi linguaggio, due ATO di riferimento, i dati del Subset-130, agenti e un ambiente per l'apprendimento per rinforzo. |
| [Scenari, guasti e verdetto](#5-scenari-guasti-e-verdetto) | Sedici tipi di evento, annunciati o nascosti, e un verdetto con criteri. |
| [Circolazione](#6-circolazione) | Treni di servizio con orario nei due sensi, reti, un regolatore della circolazione, un dirigente e una sala di controllo. |
| [Passeggeri](#7-passeggeri) | Domanda origine–destinazione, salite e discese, sosta, capienza e massa a bordo. |
| [Infrastruttura e orari reali](#8-infrastruttura-e-orari-reali) | Linee importate da OpenStreetMap, RINF e un modello del terreno; orari importati da GTFS, NeTEx e railML. |
| [Dati aperti](#9-dati-aperti) | Una corsa pubblicata come GTFS, GTFS-Realtime, SIRI, NeTEx (profilo italiano) e railML. |
| [Programmi esterni](#10-programmi-esterni-e-co-simulazione) | Dinamica, bordo, terra, regolatore, controllore e agenti come programmi esterni, su protocolli pubblici. |
| [Misura e riproducibilità](#11-misura-e-riproducibilità) | Determinismo bit per bit, campagne di misura con impronte, golden master, 23 verifiche e una matrice dei requisiti. |
| [Didattica](#12-didattica) | Una pagina che spiega il modello della dinamica con equazioni, verifiche e un laboratorio. |
| [Modi di eseguirlo](#13-modi-di-eseguirlo) | Nel browser, senza grafica, da TypeScript, dietro un ponte o in Docker. |

## 1. Guida e cabina

La vista è dalla cabina, in 3D, costruita dalla linea: curve, pendenze, gallerie con imbocchi, stazioni con marciapiedi, pensiline e passerella, catenaria, cippi chilometrici, segnali o tabelle di arresto, i treni della corsa. Luce, nebbia e pioggia cambiano con l'ora e il tempo. Resta disponibile una vista 2D più leggera, anche senza WebGL.

- **Comandi.** Un manipolatore con dieci gradini di trazione, neutro, sette gradini di frenatura di servizio ed emergenza; vigilanza ogni 55 s con 5 s per riconoscere; porte trattenute in stazione fino alla partenza in orario. Tastiera, gamepad, manipolatore USB con calibrazione, pulsanti a sfioramento. [GUIDA.md](GUIDA.md)
- **DMI e strumenti.** Il DMI con velocità consentita, distanza dal punto obiettivo e curve di supervisione; manometri di condotta generale e cilindro freno; spie di vigilanza, porte, slittamento ed emergenza.
- **Viaggiare su un altro treno.** La telecamera può salire nella cabina di qualsiasi treno della corsa, su qualsiasi linea di una rete, anche in marcia inversa.
- **Dati della corsa.** Fermate con il loro errore, registro degli eventi, un CSV con una riga ogni mezzo secondo (posizione, velocità, curve, comandi, forze, aderenza, energia, organi di aggancio, modo del bordo), il resoconto finale con il verdetto.
- **Accessibilità.** Il movimento ridotto è rispettato; tre qualità grafiche.

## 2. Linee, treni e dinamica

- **Linee incluse.** Valle Lauro – Monte Clanio (15,3 km, quattro stazioni), il valico dell'Appennino (18,5 km, fino al 25 ‰), la diramazione San Felice Scalo – Rocca Sabato (9,6 km) e il raccordo Ponte Sabato – Pietrarsa; due reti incluse fatte con esse. Ogni linea ha un treno merci che precede, da accendere o spegnere.
- **Editor della linea.** Pianta trascinando i vertici, profilo altimetrico, stazioni e orario, limiti di velocità, gallerie; libreria nel browser, esportazione e importazione in JSON. [GUIDA.md](GUIDA.md#linee-e-treni), [API.md](API.md#formato-delle-linee)
- **Segnalamento generato.** Segnali di partenza, di protezione e intermedi dalle stazioni e dalla lunghezza delle sezioni di blocco; gruppi di boe per l'ETCS; a binario unico, un binario per ogni senso in ogni stazione. [MODELLO.md](MODELLO.md)
- **Treni inclusi.** Un elettrotreno regionale di quattro casse, un treno alta velocità di otto casse e un merci pesante, tutti modificabili: masse, sforzo e potenza, resistenza di Davis, freni, composizione e organi di aggancio. [GUIDA.md](GUIDA.md#linee-e-treni)
- **Modello a più masse.** Ogni veicolo e ogni organo di aggancio, con molla, smorzatore e gioco; trazione ripartita sui veicoli motori e limitata dall'aderenza che cala con la velocità; resistenza di Davis distribuita lungo il treno, resistenza in curva, pendenza sotto ogni veicolo, fattore di galleria; freno pneumatico che si propaga lungo il treno o elettropneumatico; frenatura elettrica con recupero; slittamento e antipattinaggio. [MODELLO.md](MODELLO.md), [progetto/dinamica.md](progetto/dinamica.md)
- **Punto materiale.** Le stesse forze su una sola massa, per la didattica.
- **Aderenza e tempo.** Asciutto, bagnato o foglie, dal tempo o scelto; zone di aderenza ridotta negli scenari.
- **Energia.** Energia di trazione e recuperata per ogni treno; energia per passeggero-km con i passeggeri.

## 3. Segnalamento e protezione della marcia

La stessa linea va con l'ERTMS/ETCS livello 2 o con il blocco automatico italiano protetto dall'SCMT, così i due sistemi si possono confrontare.

- **ETCS livello 2, supervisione interna semplificata.** La supervisione originale di YuTreno: autorizzazione al movimento dal blocco, curve di velocità massima e di frenatura con indicazione, avviso, frenatura di servizio ed emergenza. [MODELLO.md](MODELLO.md#segnalamento)
- **ETCS livello 2, bordo di riferimento.** Un calcolatore di bordo (EVC) che conosce il mondo solo attraverso boe e messaggi del Subset-026: localizzazione sull'ultimo gruppo di boe, rapporti di posizione, autorizzazione al movimento, profilo statico di velocità, pendenze e rallentamenti temporanei, curve del §3.13 (EBD, SBD, EBI, SBI, avviso, consentita, indicazione, velocità di rilascio), trip e post trip, arresto di emergenza, supervisione del contatto radio, i dati per l'ATO del Subset-130. [BORDO_ETCS.md](BORDO_ETCS.md), [progetto/bordo-riferimento.md](progetto/bordo-riferimento.md)
- **ETCS livello 2, bordo esterno.** Qualsiasi EVC che parli lo stesso protocollo JSON, come processo, su TCP o WebSocket; la guida va da un bordo minimo in Python all'integrazione di openETCS. [GUIDA_EVC.md](GUIDA_EVC.md), [BORDI_INDIPENDENTI.md](BORDI_INDIPENDENTI.md)
- **RBC semplice a messaggi.** Una sessione per treno, messaggi 3, 15, 16 e 24 con i pacchetti 15, 21, 27, 65, la fermata come messaggio 16; treni nei due sensi con `Q_DIR`. [progetto/rbc-semplice.md](progetto/rbc-semplice.md)
- **Terra con apparato.** Un apparato che muove i deviatoi e legge i circuiti di binario con telegrammi EULYNX (SCI-P, SCI-TDS), forma gli itinerari da una tabella delle condizioni in stile RFI con il traduttore, formazione automatica degli itinerari per orario o per primo arrivato, consenso di blocco a binario unico, punti protetti e liberazione elastica, guasti di deviatoi e circuiti di binario, un posto centrale con itinerari, interruttore dell'ARS e arresto di emergenza; un RBC che costruisce l'autorizzazione dagli itinerari formati; su una linea, più RBC con il passaggio del Subset-026 §3.15.1 e del Subset-039 (preannuncio, informazioni di itinerario, presa di responsabilità, segnale di vita) e un bordo con due sessioni. Un apparato per linea su una rete, con itinerari di nodo e confini fra apparati. [TERRA.md](TERRA.md), [progetto/terra-apparato.md](progetto/terra-apparato.md)
- **Blocco mobile.** ETCS livello 2 con blocco mobile, con l'RBC semplice e un bordo a messaggi su ogni treno: l'autorizzazione di un treno che segue finisce un margine dietro la coda confermata che il treno davanti ha riportato per ultima con l'integrità confermata (`Q_INTEGRITY`, `L_TRAININT`); periodo dei rapporti con il pacchetto 58 e un ritardo della radio come parametri; coda congelata quando si perde l'integrità o la radio del treno davanti. [BLOCCO_MOBILE.md](BLOCCO_MOBILE.md)
- **Blocco automatico e SCMT.** Segnali a tre aspetti, rosso dietro ogni sezione occupata; l'SCMT come supervisione semplificata verso il segnale rosso e le riduzioni di velocità. [MODELLO.md](MODELLO.md), [STANDARD.md](STANDARD.md#scmt)
- **Validazione delle curve.** Casi e strumenti per confrontare il bordo di riferimento con lo strumento delle curve di frenatura dell'ERA. [VALIDAZIONE_CURVE.md](VALIDAZIONE_CURVE.md)

## 4. Guida automatica

- **Controllori.** Un programma riceve un'osservazione (velocità, posizione, supervisione, autorizzazione o segnale, profili, prossima fermata, eventi, dati del Subset-130) e risponde con un comando (trazione, freno o manipolatore, vigilanza, emergenza). Nel browser in JavaScript, senza grafica in JavaScript, o in qualsiasi linguaggio su WebSocket; la simulazione aspetta ogni risposta. [API.md](API.md)
- **Due ATO di riferimento.** `examples/ato.js` segue la velocità consentita; `examples/ato_s130.js` pianifica la frenatura sui dati che il bordo passa all'ATO secondo il Subset-130 (`N_LOC_EBI`, `A_BRAKE_SAFE`, MRSP, pendenze, tempi di reazione). Fermate, vigilanza e regolatore sono gli stessi, così il confronto misura solo l'uso di quei dati. [CAMPAGNA.md](CAMPAGNA.md#i-due-ato)
- **Dati del Subset-130.** Ogni bordo (interno, di riferimento, esterno) li fornisce; si verifica che `N_LOC_EBI` sia il punto dove la protezione interviene davvero. [API.md](API.md#dati-del-bordo-per-lato-subset-130)
- **Agenti.** I treni di servizio possono essere guidati da un agente esterno, uno per treno o uno per tutti; un ambiente che parla righe JSON e un involucro Python/Gymnasium per l'apprendimento per rinforzo. [AGENTI.md](AGENTI.md)
- **Un modello di macchinista umano.** `examples/driver_model.js` guida fra una curva bassa sotto la velocità consentita e la velocità consentita, risponde in ritardo con un tasso che cresce col tempo e usa una quota di trazione e freno, in tre profili (prudente, medio, aggressivo) con un seme; una campagna dei macchinisti li confronta con l'ATO sugli scenari ETCS. [MODELLO_MACCHINISTA.md](MODELLO_MACCHINISTA.md)
- **Macchinista incluso.** I treni di servizio e il merci che precede sono guidati da un ATO dentro il nucleo, con la logica di `examples/ato.js`.

## 5. Scenari, guasti e verdetto

Uno scenario è un file JSON che prepara una corsa (linea, treno, segnalamento, bordo, terra, tempo, ora, regolatore, servizi, rete, passeggeri) e programma eventi a un tempo, a una posizione o a entrambi. [SCENARI.md](SCENARI.md), [GUIDA_SCENARI.md](GUIDA_SCENARI.md)

- **Sedici tipi di evento.** Perdita della radio, perdita dell'integrità del treno, deriva dell'odometria, rallentamento temporaneo, aderenza ridotta, freno degradato, trazione ridotta, treno che precede fermo, arresto di emergenza dell'RBC, messaggio al macchinista, guasto di un deviatoio, guasto di un circuito di binario, comando del posto centrale, un treno guasto, una tratta di linea bloccata, un comando del dirigente.
- **Annunciati o nascosti.** Un evento si vede in cabina e dai controllori, oppure resta solo nel registro e si scopre dai suoi effetti (le foglie, un freno degradato).
- **Verdetto.** Criteri su arrivo, ritardo, errore di fermata, fermate mancate, interventi, superamenti, vigilanza, eccesso sul limite, energia, forze negli organi di aggancio e strappi; un verdetto con l'elenco dei controlli.
- **Scenari di esempio.** 26: otto generali (perdita della radio, arresto dell'RBC, foglie, freno degradato, treno che precede fermo con ETCS e con SCMT, rallentamento per cantiere, discesa bagnata), otto con l'apparato (nominale, sorpasso, guasto di un deviatoio, guasto di un circuito di binario, comandi dell'operatore, passaggio fra due RBC, anche con il collegamento fra loro o la radio del secondo persi), dieci con treni di servizio (incrocio, anche con l'apparato, inseguimento, precedenza, guasto, soppressione, diramazione, navetta sulla diramazione, deviazione su un anello, la rete reale intorno a Benevento).
- **Configurazione dello scenario.** Un JSON breve che sceglie la linea e il numero di treni, con servizi generati dalla linea o presi da un orario reale; anche un modulo nella pagina. [CONFIGURAZIONE_SCENARIO.md](CONFIGURAZIONE_SCENARIO.md)

## 6. Circolazione

- **Treni di servizio.** Altri treni con fermate e orari, nei due sensi, guidati dall'ATO incluso o da un agente; orario realizzato e programmato, ritardi; turni del materiale (`block`) e coincidenze fra treni. [SCENARI.md](SCENARI.md#treni-di-servizio)
- **Binario unico.** Ogni stazione ha un binario per ogni senso; fra le stazioni una sezione è data a un senso alla volta (consenso di blocco), con regole di conflitto per orario o per primo arrivato.
- **Il treno che precede.** Un treno merci fra i treni della corsa, con la sua dinamica, i suoi segnali, la sua supervisione e il suo bordo. [MODELLO.md](MODELLO.md#vigilanza-fermate-e-treno-che-precede)
- **Reti.** Linee che si incontrano in stazioni comuni; ogni treno corre lungo un corridoio compilato dal suo itinerario; itinerari di nodo; con l'apparato, un apparato per linea e un solo RBC. [progetto/rete.md](progetto/rete.md)
- **Regolatore della circolazione.** Un programma che riceve lo stato della circolazione e decide priorità, nuovi orari, fermate saltate, soppressioni, binari, deviazioni, coincidenze e comandi del posto centrale; un regolatore di riferimento con sette regole; lo stesso protocollo per uno esterno. [REGOLATORE.md](REGOLATORE.md)
- **Dirigente.** Comandi dati subito dalla pagina o da un programma, rifiutati con il motivo quando non si possono applicare, registrati con il loro tempo e rieseguibili come eventi di scenario. [SALA_CONTROLLO.md](SALA_CONTROLLO.md)
- **Sala di controllo.** Uno schema di tutta la rete con segnali, sezioni occupate, orientamento del binario unico, itinerari e deviatoi, i treni colorati per ritardo, la tabella dei treni e il registro; un'istantanea pubblica e versionata del motore, servita anche su HTTP. [SALA_CONTROLLO.md](SALA_CONTROLLO.md)
- **Perturbazioni.** Un treno guasto, una tratta bloccata, un deviatoio o un circuito di binario guasto, con i loro effetti sui treni che seguono.
- **Capacità della linea.** Il distanziamento minimo misurato con due treni uguali, contro quello calcolato dai tempi di occupazione delle sezioni di blocco (UIC 406 semplificata), anche in un nodo; e il tempo in cui ogni treno è trattenuto dal segnalamento invece che dalla linea, con il distanziamento sotto il quale un treno che segue comincia a essere trattenuto. [CAPACITA.md](CAPACITA.md)

## 7. Passeggeri

Un modello aggregato muove le persone fra marciapiedi e treni. [PASSEGGERI.md](PASSEGGERI.md)

- **Domanda.** Flussi origine–destinazione all'ora con finestre facoltative; arrivi continui o di Poisson con un seme; cambi di treno in una stazione data.
- **Fermate.** Le persone scendono, poi salgono nei limiti di posti a sedere e in piedi; chi non entra aspetta il treno dopo; la sosta segue le persone attraverso le porte e l'affollamento, e trattiene le porte.
- **Massa a bordo.** Ogni persona si aggiunge alla massa del treno e dei suoi veicoli, e arriva alla dinamica esterna.
- **Misure.** Saliti, scesi, in attesa, rimasti a terra, attesa, viaggio, ritardo per passeggero, passeggeri-km, coefficienti di riempimento, energia per passeggero-km, cambi e loro attese; occupazione in SIRI e GTFS-Realtime; persone sui marciapiedi nella vista 3D.

## 8. Infrastruttura e orari reali

- **Importazione della linea.** Una linea da un estratto Overpass di OpenStreetMap, un risultato SPARQL di RINF e un modello del terreno (EU-DEM), con una priorità dichiarata delle fonti, la provenienza di ogni dato (fonte, derivato, generato) e un resoconto con licenze e coerenza fra le fonti; un solo comando scarica le fonti e importa. [IMPORTAZIONE_INFRA.md](IMPORTAZIONE_INFRA.md), [TUTORIAL_LINEA.md](TUTORIAL_LINEA.md)
- **Linee reali nel repository.** Avellino – Benevento (30,5 km, dieci stazioni, da OpenStreetMap ed EU-DEM), Cancello – Benevento (49,3 km, dodici stazioni, anche da RINF), le due come rete a Benevento, e Salerno – Mercato San Severino (18,4 km, nove stazioni) con un estratto del suo orario reale.
- **Infrastruttura railML.** Esportazione e importazione di una linea come railML 3.2.
- **Importazione dell'orario.** Orari GTFS, NeTEx e railML diventano i servizi di uno scenario; esportare e reimportare dà gli stessi servizi. [DATI_APERTI.md](DATI_APERTI.md)
- **Plausibilità.** I tempi di percorrenza di un orario contro quelli simulati, tratta per tratta, entro limiti dichiarati. [IMPORTAZIONE_INFRA.md](IMPORTAZIONE_INFRA.md)

## 9. Dati aperti

Una corsa pubblica il suo orario e il suo andamento nei formati che leggono i sistemi di informazione ai passeggeri. [DATI_APERTI.md](DATI_APERTI.md), [STANDARD_ORARI.md](STANDARD_ORARI.md)

- **Orario programmato.** GTFS, NeTEx (profilo italiano EPIP), railML 3.2.
- **Tempo reale.** GTFS-Realtime (aggiornamenti delle corse, posizioni dei veicoli, occupazione) e SIRI (ET, VM, percorsi Lite del profilo italiano).
- **Server.** `npm run feeds` serve i flussi di una corsa su HTTP mentre va, con la sala di controllo su `/control-room`; oppure li scrive a un tempo dato.
- **Validità.** Gli stessi identificatori in ogni formato; uscita controllata con gli schemi e i validatori ufficiali (NeTEx, SIRI, validatore GTFS).

## 10. Programmi esterni e co-simulazione

Cinque protocolli pubblici permettono ad altri programmi di prendere una parte della corsa. Sono versionati, i campi nuovi sono facoltativi, e il motore aspetta ogni risposta, quindi una corsa con programmi esterni è deterministica quanto una senza. [progetto/protocolli.md](progetto/protocolli.md)

| Protocollo | Chi risponde | Esempi | Documento |
| :-- | :-- | :-- | :-- |
| Controllore (versione 3) | chi guida | JavaScript, Python | [API.md](API.md) |
| Dinamica (versione 2) | un modello della dinamica | JavaScript, Python, Octave, MATLAB/Simulink | [DINAMICA_ESTERNA.md](DINAMICA_ESTERNA.md) |
| Bordo (versione 2) | un calcolatore di bordo ETCS | Python, TypeScript, openETCS | [BORDO_ETCS.md](BORDO_ETCS.md) |
| Terra (versione 2) | apparato e RBC | TypeScript | [TERRA.md](TERRA.md) |
| Regolatore (versione 1) | un regolatore della circolazione | TypeScript, Python | [REGOLATORE.md](REGOLATORE.md) |

- **Trasporti.** Un processo su stdin/stdout, TCP o WebSocket; un ponte porta la pagina verso i programmi esterni.
- **Agenti.** Un sesto canale per i macchinisti dei treni di servizio. [AGENTI.md](AGENTI.md)
- **Compatibilità.** I nomi e i formati italiani della versione 0.x sono accettati in ingresso, e prodotti per i programmi scritti per essi.

## 11. Misura e riproducibilità

- **Determinismo.** Passo fisso di 5 ms, nessun orologio, casualità con seme: la stessa linea, lo stesso treno, lo stesso scenario e gli stessi comandi danno gli stessi dati byte per byte, anche con programmi esterni collegati. [ARCHITETTURA.md](ARCHITETTURA.md#la-corsa-passo-fisso-e-determinismo)
- **Campagna di misura.** Bordo × ATO × scenario, con e senza guasti nascosti, 48 corse con misure, parametri e impronte SHA-256 di ingressi e uscite, e controlli di determinismo anche con il bordo come processo esterno. Separa l'effetto del bordo da quello dell'ATO. [CAMPAGNA.md](CAMPAGNA.md)
- **Campagna del servizio.** Una variazione di linee, numero di treni, distanziamenti, sensi, segnalamento e domanda di passeggeri, con misure di puntualità, passeggeri, energia e segnalamento, e le soglie di distanziamento di un'esplorazione. [CAMPAGNA.md](CAMPAGNA.md#campagna-del-servizio)
- **Campagna dei macchinisti.** Tre profili di guida con cinque semi ciascuno contro l'ATO, con due bordi, sugli scenari ETCS: energia, tempo, avvisi, interventi e la loro dispersione. [MODELLO_MACCHINISTA.md](MODELLO_MACCHINISTA.md#la-campagna-dei-macchinisti)
- **Verifiche.** 22 script (`npm run verify`): fisica in forma chiusa, dinamica a più masse contro la teoria, bordo e Subset-026 clausola per clausola, terra, scenari, servizi, regolatore, capacità, rete, passeggeri, sala di controllo, dati aperti, importazioni, infrastruttura, configurazione degli scenari, ATO, tracciabilità. [README.md](README.md#verifiche)
- **Golden master.** Le impronte di 234 corse (ogni scenario in sei varianti, e le campagne) e di 24 stati della pagina: una modifica che vuole lasciare invariato il comportamento deve lasciarle invariate. [progetto/strumenti.md](progetto/strumenti.md)
- **Tracciabilità dei requisiti.** Una matrice di 383 righe di Subset-026, Subset-130, Subset-039, EULYNX e pratica RFI con il loro stato (implementato, semplificato, divergente, mancante, fuori ambito) e le prove di ogni riga implementata o semplificata. [TRACCIABILITA.md](TRACCIABILITA.md)
- **Tempo reale.** Misure di quanto il motore e i canali esterni possono seguire l'orologio, e di cosa servirebbe a un banco con hardware vero. [TEMPO_REALE.md](TEMPO_REALE.md)

## 12. Didattica

- **La pagina del modello.** `dist/model.html` descrive il modello della dinamica con equazioni, le verifiche e un laboratorio interattivo, calcolati dal nucleo stesso. [MODELLO.md](MODELLO.md)
- **Punto materiale e due sistemi.** Il modello più semplice e il confronto ETCS contro blocco automatico e SCMT sulla stessa linea.
- **Modellino fisico.** Uno studio di fattibilità e una prima bozza di un trenino guidato da YuTreno, con boe NFC e un RBC via radio. [MODELLINO.md](MODELLINO.md)

## 13. Modi di eseguirlo

- **Nel browser.** `npm run dev`, oppure `dist/yutreno.html` con un doppio clic: non servono né server né connessione.
- **Senza grafica.** `npm run headless`: corse, cartelle di scenari con verdetto, controllori, dinamiche, bordi, terra, regolatore e agenti esterni; CSV, eventi, sintesi e orario su disco. Una corsa richiede uno o due secondi.
- **Da TypeScript.** `Simulation` e `runLockstep()` da `src/core`. [API.md](API.md#uso-del-nucleo-da-typescript)
- **Docker.** Un contenitore che esegue una campagna dimostrativa e resta acceso con il simulatore e i ponti. [DOCKER.md](DOCKER.md)

## Che cosa YuTreno non fa

Questi limiti contano per chiunque usi i suoi risultati.

- **Il bordo di riferimento non è validato né certificato.** Il confronto con lo strumento delle curve di frenatura dell'ERA è avviato ma non completo. Delle 231 sezioni dei capitoli 3, 4, 5, 7 e 8 del Subset-026, 3 sono implementate, 77 semplificate, 9 divergenti, 122 mancanti e 20 fuori ambito; non ci sono inizio missione, modi diversi da SB, FS, TR e PT, livelli diversi dal 2, codifica a bit dei messaggi, modello di frenatura lambda. Tre divergenze note nel §3.13 cambiano i numeri. [STANDARD.md](STANDARD.md), [TRACCIABILITA.md](TRACCIABILITA.md)
- **Nessun bordo scritto da altri è ancora collegato.** La strada verso cesarBLG/ETCS e milanredele/etcs-dmi è stimata, non percorsa. [BORDI_INDIPENDENTI.md](BORDI_INDIPENDENTI.md)
- **L'SCMT è una supervisione semplificata**, senza circuiti di binario codificati né specifiche RFI.
- **L'apparato è una ricostruzione** della pratica italiana, un programma per linea, senza protezione di fianco né geometria dei deviatoi; la tabella delle condizioni non è un documento RFI. Il passaggio fra RBC funziona su una linea, non a un nodo della rete, e richiede un bordo con due terminali radio. Il blocco mobile funziona con l'RBC semplice su una linea singola, senza il rilevamento a terra come ripiego né le sezioni virtuali. [TERRA.md](TERRA.md#cosa-è-semplificato)
- **La dinamica è solo longitudinale**; il freno pneumatico ha un puro ritardo di propagazione senza la pressione in condotta generale; l'aderenza è una curva empirica.
- **I passeggeri sono flussi aggregati**, non agenti che scelgono il percorso.
- **Va in lockstep, non contro l'orologio.** Un ciclo agganciato all'orologio esiste solo come prototipo di misura. [TEMPO_REALE.md](TEMPO_REALE.md)
- **Un solo treno controllato**; gli altri treni sono guidati dall'ATO incluso o da agenti. Il DMI non segue l'iconografia dell'ERA.

## Struttura

YuTreno è scritto in TypeScript (circa 28.000 righe con gli script e gli esempi). Il codice è diviso in strati, e il confine fra di essi è la regola più importante del progetto. [ARCHITETTURA.md](ARCHITETTURA.md)

| Cartella | Contenuto | Dipende da |
| :-- | :-- | :-- |
| `src/core/` | la simulazione: linea e rete, treni, dinamica, segnalamento e supervisione, bordo di riferimento, RBC semplice, piazzale dell'apparato, circolazione, passeggeri, scenari e verdetto, osservazione e comandi, istantanea della sala di controllo, compatibilità con la 0.x | niente fuori di sé e di `src/trackside/` |
| `src/trackside/` | apparato, RBC, tabella delle condizioni e traduttore | solo tipi del motore |
| `src/regulator/` | il regolatore della circolazione di riferimento | solo tipi del motore |
| `src/feeds/` | dati aperti in uscita e importazione degli orari | legge la simulazione |
| `src/infra/` | importazione delle linee reali | niente del browser né di Node |
| `src/web/` | la pagina: viste 3D e 2D, DMI, editor, orario, sala di controllo, controllori nel browser | legge il nucleo, non decide nulla di fisico |
| `src/server/` | strumenti Node: esecuzione senza grafica, ponte, ambiente degli agenti, server dei dati aperti, importatori | il nucleo |
| `src/docs/` | la pagina del modello | il nucleo |
| `examples/` | controllori, ATO, bordi esterni, terra e regolatore come programmi, modelli della dinamica, ambiente degli agenti, configurazioni di scenario, linee importate, uscita dei dati aperti | i protocolli |
| `scenarios/`, `campaigns/`, `validation/` | scenari di esempio, configurazioni delle campagne, casi per la validazione delle curve | |
| `scripts/` | build, 23 verifiche, golden master, campagne, tracciabilità, validazione delle curve, misure | |
| `docs/` | guide, API, modello, standard, documenti di progetto, tracciabilità; copie italiane in `docs/it/` | |

Tre regole attraversano tutto: il **determinismo** (nessun componente legge l'orologio o usa casualità non ripetibile), i **confini fra strati** (il nucleo non dipende dal browser né da Node; bordo, terra e regolatore non importano dal motore altro che tipi, così un programma esterno può fare tutto quello che fanno loro) e i **protocolli pubblici** (i campi nuovi sono facoltativi, i nomi seguono gli standard, i formati della 0.x continuano a funzionare). [progetto/LEGGIMI.md](progetto/LEGGIMI.md)

## Mappa della documentazione

**Per chi usa il simulatore.**
- [README](README.md): che cos'è e come cominciare.
- [GUIDA.md](GUIDA.md): la pagina, scheda per scheda.
- [GUIDA_SCENARI.md](GUIDA_SCENARI.md) e [SCENARI.md](SCENARI.md): scrivere ed eseguire scenari.
- [CONFIGURAZIONE_SCENARIO.md](CONFIGURAZIONE_SCENARIO.md): scenari da una configurazione breve.
- [API.md](API.md) e [AGENTI.md](AGENTI.md): scrivere un controllore o un agente; [MODELLO_MACCHINISTA.md](MODELLO_MACCHINISTA.md): il modello di macchinista umano.
- [TUTORIAL_LINEA.md](TUTORIAL_LINEA.md) e [IMPORTAZIONE_INFRA.md](IMPORTAZIONE_INFRA.md): una linea reale da zero.
- [SALA_CONTROLLO.md](SALA_CONTROLLO.md), [PASSEGGERI.md](PASSEGGERI.md), [DATI_APERTI.md](DATI_APERTI.md): circolazione, passeggeri, dati aperti.
- [DOCKER.md](DOCKER.md): la dimostrazione in un contenitore.

**Per chi sviluppa.**
- [ARCHITETTURA.md](ARCHITETTURA.md): strati, flusso dei dati, passo fisso, dove lavorare per le modifiche più frequenti.
- [progetto/](progetto/LEGGIMI.md): un documento per componente (nucleo, dinamica, segnalamento, bordo di riferimento, RBC semplice, terra con apparato, regolatore, rete, protocolli, interfaccia web, dati aperti, strumenti).
- [ROADMAP.md](ROADMAP.md): a che punto è il progetto, le decisioni del proprietario, cosa viene dopo.
- `CLAUDE.md` e `AGENTS.md` nella radice: le regole del repository (commit, verifiche, golden master, documentazione in due lingue).
- I protocolli: [DINAMICA_ESTERNA.md](DINAMICA_ESTERNA.md), [BORDO_ETCS.md](BORDO_ETCS.md), [GUIDA_EVC.md](GUIDA_EVC.md), [TERRA.md](TERRA.md), [REGOLATORE.md](REGOLATORE.md).

**Per la ricerca.**
- [STANDARD.md](STANDARD.md) e [STANDARD_ORARI.md](STANDARD_ORARI.md): che cosa prescrive ogni standard, che cosa ne prende YuTreno e dove si ferma.
- [MODELLO.md](MODELLO.md): il modello fisico e di segnalamento.
- [CAMPAGNA.md](CAMPAGNA.md), [CAPACITA.md](CAPACITA.md), [MODELLO_MACCHINISTA.md](MODELLO_MACCHINISTA.md), [VALIDAZIONE_CURVE.md](VALIDAZIONE_CURVE.md), [TEMPO_REALE.md](TEMPO_REALE.md): le misure e il loro metodo.
- [TRACCIABILITA.md](TRACCIABILITA.md): la matrice dei requisiti.
- [BORDI_INDIPENDENTI.md](BORDI_INDIPENDENTI.md) e [MODELLINO.md](MODELLINO.md): studi di fattibilità.

## Riferimenti

I riferimenti citati nei documenti, raccolti per argomento. Ogni documento dà quelli che usa accanto al punto in cui li usa.

**ERTMS/ETCS e ATO.**
- Agenzia dell'Unione europea per le ferrovie (ERA), ERTMS/ETCS Subset-026 v4.0.0, *System Requirements Specification*.
- ERA, Subset-130 v1.0.0, *ETCS–ATO interface* (pacchetti 6 ETCS_ATO_Dynamic e 11 ETCS_ATO_BRAKE_DECELERATIONS).
- ERA, Subset-034 (interfaccia col treno), Subset-039 (passaggio fra RBC), Subset-076 (specifiche di prova), Subset-094 (requisiti funzionali di un banco di prova di riferimento per il bordo).
- ERA, strumento delle curve di frenatura e la sua guida d'uso.

**Apparato, gestione della circolazione e capacità.**
- EULYNX, Baseline 4 Release 4: Eu.Doc.38 (SCI-P, deviatoi), Eu.Doc.44 (SCI-TDS, rilevamento del treno), Eu.Doc.36; System Definition Eu.Doc.7 v4.2 (SCI-ILS, apparati adiacenti).
- EULYNX ed ERTMS Users Group, RCA.Doc.19, *RCA TMS-PE component specification*, e *RCA SCI_1 specification*.
- Europe's Rail, *Traffic CS system concept*, 2025.
- RFI, *Sistema Controllo Marcia Treno (SCMT)*; la pratica RFI delle Tabelle delle Condizioni, come ricostruita in YuTreno.
- UIC, Code 406, *Capacity*, 2ª edizione, giugno 2013; *Evaluating line capacity with an analytical UIC Code 406 compression method and blocking time stairway*, Energies 13(7) 1853, 2020.
- UIC, IRS 30100 *RailTopoModel*, 1ª edizione, 2016.
- V. Cacchiani et al., *An overview of recovery models and algorithms for real-time railway rescheduling*, Transportation Research Part B 63, 2014.
- F. Corman, L. Meng, *A review of online dynamic models and algorithms for railway traffic management*, IEEE Transactions on Intelligent Transportation Systems 16(3), 2015.
- TU Dresden, *The ON-TIME real-time railway traffic management framework*.
- E. Barbaro, I. La Paglia, F. Bernardini, G. Bucca, R. Corradi, M. Bocciolone, A. Collina, *A modular simulation tool for fixed block and moving block railway signalling systems*, Railway Engineering Science 34(2), 2026, pp. 257–274: il simulatore più vicino a YuTreno, da cui vengono il modello di macchinista umano e il tempo trattenuto dal segnalamento.

**Dinamica del treno e passeggeri.**
- UIC 540 e 544 (freni), e la letteratura sulla dinamica longitudinale del treno: resistenza di Davis, resistenza in curva di Röckl, aderenza di Curtius–Kniffler.
- V. Gîlcă, D. Borcoși, il modello del trenino a due masse (2019); Control Tutorials for MATLAB & Simulink (University of Michigan).
- EN 15663, *Vehicle reference masses*.
- TCRP Report 165, *Transit Capacity and Quality of Service Manual*, capitolo sulla sosta; Weston, tempi di sosta sulla metropolitana di Londra.
- Modelica Association, *Functional Mock-up Interface 2.0* (co-simulazione).

**Orari, informazione ai passeggeri e dati aperti.**
- Direttiva 2010/40/UE e Regolamento delegato (UE) 2017/1926 (MMTIS), con la sua revisione 2024/490; Regolamento di esecuzione (UE) 2026/253 (STI Telematica).
- CEN Transmodel, NeTEx e SIRI 2.1; i profili italiani NeTEx e SIRI (5T) e il Punto di accesso nazionale (CCISS, Ministero delle infrastrutture e dei trasporti).
- GTFS e GTFS-Realtime (Google, MobilityData), e il validatore GTFS di MobilityData.
- railML 3.2 (schemi di orario e infrastruttura, turni del materiale).

**Dati dell'infrastruttura.**
- OpenStreetMap e le etichette di OpenRailwayMap (anche le sue linee guida italiane), Overpass API; licenza ODbL.
- ERA, *Register of Infrastructure* (RINF), le sue condizioni d'uso e il vocabolario dell'ERA; Regolamento di esecuzione (UE) 2019/777 della Commissione.
- Copernicus Land Monitoring Service, EU-DEM v1.1, attraverso OpenTopoData.
- D. H. Douglas, T. K. Peucker, *Algorithms for the reduction of the number of points required to represent a digitized line or its caricature*, The Canadian Cartographer 10(2), 1973.

**Progetti open source collegati.**
- openETCS: deliverable D3.5.4 (API), D3.6.1 (modello funzionale), D3.8 (codice open source) e il codice generato `openETCS/srcAndBinary`.
- cesarBLG/ETCS e milanredele/etcs-dmi, bordi indipendenti candidati.
- TU Dresden, plastico ETCS in scala 1:22,5; le fonti del modellino in [MODELLINO.md](MODELLINO.md#fonti).

I collegamenti a ogni fonte sono nelle sezioni *Fonti* di [STANDARD.md](STANDARD.md#fonti), [STANDARD_ORARI.md](STANDARD_ORARI.md#fonti), [IMPORTAZIONE_INFRA.md](IMPORTAZIONE_INFRA.md#fonti), [GUIDA_EVC.md](GUIDA_EVC.md#fonti), [MODELLINO.md](MODELLINO.md#fonti), [progetto/rete.md](progetto/rete.md#fonti), [CAPACITA.md](CAPACITA.md) e [MODELLO_MACCHINISTA.md](MODELLO_MACCHINISTA.md#fonti).
