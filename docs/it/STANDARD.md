# Standard

> Copia italiana di [STANDARDS.md](../STANDARDS.md). In caso di differenze fa fede il testo inglese.

YuTreno è un simulatore di ricerca e didattica, non un prodotto ferroviario. Attinge però a diversi standard, perché un simulatore che vuole provare calcolatori di bordo veri, ATO veri o logiche d'apparato vere deve parlarne la lingua e riprodurne le regole dove contano. Questo documento discute ciascuno standard che YuTreno usa: cosa prescrive, cosa YuTreno ne prende, dove si ferma e perché, e come il risultato è controllato. Il dettaglio riga per riga è nella [matrice di tracciabilità](TRACCIABILITA.md); qui il discorso resta al livello del ragionamento.

Prima un'avvertenza generale. Nulla in YuTreno è certificato per la sicurezza, e nulla va letto come conformità a uno standard. Quando questo documento dice "implementato" intende che YuTreno fa ciò che la clausola descrive, nei limiti dei dati che riceve, e che un test lo controlla. La conformità in senso normativo richiederebbe il processo CENELEC (EN 50126, EN 50128, EN 50129), una valutazione indipendente e, per ETCS, le sequenze di prova del Subset-076 sul prodotto. YuTreno usa gli standard come vocabolario preciso e come fonte di regole da riprodurre, perché quello che si misura nel simulatore sia confrontabile con quello che farebbe un sistema vero.

## Panoramica

| Standard | Cosa copre | Cosa prende YuTreno | Dove |
| :-- | :-- | :-- | :-- |
| ERA Subset-026 v4.0.0 (SRS ETCS) | comportamento di bordo e di terra di ETCS, linguaggio dei dati, messaggi | livello 2 in piena supervisione: localizzazione, MA, SSP, pendenze, TSR, curve di frenatura (§3.13), modi SB/FS/TR/PT, pacchetti e messaggi come JSON decodificato | `src/core/evc.ts`, `src/core/simple-rbc.ts`, `src/trackside/rbc.ts` |
| ERA Subset-130 v1.0.0 (ETCS–ATO) | dati che il bordo ETCS dà al bordo ATO | pacchetti 6 e 11, in unità SI e progressive di linea | `EtcsAtoData`, `etcs_ato` nell'osservazione |
| Strumento ERA per le curve di frenatura | calcolo di riferimento delle curve del §3.13 | metodo di confronto e casi | `scripts/curve-validation.ts`, `validation/` |
| EULYNX Baseline 4 R4 (SCI-P, SCI-TDS) | interfacce standard fra apparato ed enti di piazzale | nomi, campi e codici dei telegrammi per deviatoi e rilevamento | `src/core/field.ts`, `src/trackside/interlocking.ts` |
| Pratica RFI per gli apparati a calcolatore | Tabelle delle Condizioni, itinerari, liberazione | un formato ricostruito di tabella e il suo traduttore | `src/trackside/control-table.ts` |
| RFI SCMT e BACC | protezione nazionale italiana e circuiti di binario codificati | una supervisione semplificata verso i segnali rossi e le riduzioni di velocità | `src/core/signalling.ts` |
| UIC 540/544, letteratura sulla dinamica longitudinale | freni e dinamica del treno | propagazione del freno, modelli di aggancio, resistenze | `src/core/dynamics.ts`, `src/core/consist.ts` |
| FMI (co-simulazione) | accoppiamento di unità di simulazione | il ciclo master/slave della dinamica esterna | `dynamicsRequest`/`dynamicsResponse` |
| Transmodel, NeTEx (profilo italiano EPIP), SIRI (profilo italiano), GTFS, GTFS-Realtime, railML 2 e 3 | orari e informazione ai passeggeri | esportazione dell'orario e dello stato in tempo reale di una corsa, importazione di orari | `src/feeds/`, [STANDARD_ORARI.md](STANDARD_ORARI.md) |

## Subset-026: i requisiti di sistema ETCS

### Cosa prescrive

Il Subset-026 è la System Requirements Specification di ETCS. Descrive come il bordo si localizza sui gruppi di balise e mantiene un intervallo di confidenza, come riceve e usa autorizzazioni al movimento, profili statici di velocità, pendenze e rallentamenti temporanei, come calcola le curve di frenatura e i limiti di supervisione (§3.13), in quali modi può trovarsi e come passa dall'uno all'altro (capitoli 4 e 5), e il linguaggio usato su balise e radio: variabili, pacchetti e messaggi con il loro formato in bit (capitoli 7 e 8). La versione 4.0.0 è quella della TSI 2023; in Italia è in esercizio la Baseline 3 (v3.6.0).

### Cosa prende YuTreno

YuTreno prende la parte della specifica che serve a un banco di prova di livello 2 in piena supervisione, e la implementa in due posti che devono essere d'accordo fra loro: la terra (gruppi di balise, RBC con i messaggi 3 e 16) e il bordo di riferimento (`ReferenceEvc`).

Il **linguaggio dei dati** è quello della specifica: i pacchetti 0, 5, 15, 21, 27, 65, 66, 255 e i messaggi 3, 16, 136 portano i nomi delle variabili del Subset-026 (`NID_LRBG`, `L_ENDSECTION`, `V_STATIC`, `G_A`…), con le iterazioni nell'ordine della specifica. Viaggiano come JSON decodificato invece che come bit: la codifica in bit dei capitoli 7 e 8 è il primo pezzo mancante per collegare bordi veri (vedi [BORDI_INDIPENDENTI.md](BORDI_INDIPENDENTI.md)).

La **localizzazione** segue il §3.6: il bordo riferisce tutto all'ultimo gruppo di balise rilevante, identificato dalla balise con `N_PIG` = 0, e mantiene un intervallo di confidenza che cresce con la distanza percorsa. I rapporti di posizione (messaggio 136 con pacchetto 0) partono a ogni gruppo di balise, a ogni cambio di modo e periodicamente.

**Autorizzazione al movimento, profilo statico, pendenze e TSR** seguono i §3.8 e §3.11 nella forma di livello 2 a sezione unica: fine autorizzazione, punto pericoloso e velocità di rilascio; il profilo di velocità più restrittivo considerando la lunghezza del treno e la sua velocità massima; le pendenze con la correzione per le masse rotanti.

Le **curve di frenatura** seguono la struttura del §3.13 con il modello gamma: EBD e SBD integrate sul profilo delle pendenze, EBI ricavata dalla EBD con i tempi di taglio trazione e di costruzione del freno, SBI come la più restrittiva fra SBI1 (dalla SBD verso l'EOA) e SBI2 (dalla EBD), velocità di avviso, permessa e di indicazione, margini del tetto interpolati fra i valori nazionali del §A.3.1. I comandi (freno di servizio, freno d'emergenza, taglio trazione) restano attivi fino alla loro condizione di revoca.

I **modi** sono ridotti a quattro dei diciannove: Stand By, Full Supervision, Trip e Post Trip, con il trip alla fine dell'autorizzazione e sull'arresto d'emergenza incondizionato, e la reazione alla perdita del contatto radio (`T_NVCONTACT`, `M_NVCONTACT`).

### Dove si ferma

La matrice conta, su 231 sezioni dei capitoli 3, 4, 5, 7 e 8: 3 implementate, 77 semplificate, 9 divergenti, 122 mancanti, 20 fuori ambito. La parte mancante è grande ma coerente: start of mission e il dialogo con l'RBC che lo accompagna (155, 32, 159, 129, 8, 132), gli altri modi (a vista, responsabilità del personale, manovra…), le transizioni di livello, le autorizzazioni a più sezioni con temporizzatori, l'arresto d'emergenza condizionato e le conferme, il modello di frenatura lambda e la codifica in bit.

Dentro il §3.13 tre divergenze cambiano i numeri e sono discusse nella matrice: la pendenza presa alla testa invece che la peggiore sotto il treno, i tempi dell'emergenza sommati invece che sovrapposti, l'assenza dell'accelerazione stimata e dell'errore di velocità. Sono note, dichiarate e, dove possibile, quantificate. Altre due sono state corrette: i limiti SBI2, W, P e I dei bersagli di riduzione di velocità vengono ora dalla EBD del bersaglio come chiede il testo, e il tempo di indicazione comprende il tempo del macchinista.

### Come è controllato

`scripts/verify-subset026.ts` guida il bordo di riferimento ciclo per ciclo con telegrammi e messaggi costruiti a mano e controlla ogni gruppo di clausole, in forma chiusa dove la clausola dà una formula: EBD e SBD su pendenze costanti con la correzione per le masse rotanti, EBI spostata di v·(T_traction + T_be), SBI = min(SBI1, SBI2), SBI2, W, P e I di una riduzione di velocità dalla sua EBD, margini del tetto a 80, 160 e 250 km/h, MRSP con lunghezza del treno e V_MAXTRAIN, trip con il fronte sicuro minimo, post trip, arresto d'emergenza, contatto radio. I controlli di sistema (`verify-onboard`, `verify-curve-validation`, `verify-ato-s130`) controllano che lo stesso bordo si comporti in modo sensato su corse complete. Ogni riga implementata o semplificata della matrice è collegata ad almeno uno di questi test, e `verify-traceability` fallisce altrimenti.

Il controllo indipendente è lo strumento ERA per le curve di frenatura: casi e script di confronto sono pronti ([VALIDAZIONE_CURVE.md](VALIDAZIONE_CURVE.md)), i valori dello strumento vanno ancora inseriti.

## Subset-130: l'interfaccia ETCS–ATO

### Cosa prescrive

Il Subset-130 specifica l'interfaccia fra il bordo ETCS e il bordo ATO nell'architettura ATO over ETCS. Ogni 200 ms il bordo ETCS manda il pacchetto 6 (ETCS_ATO_Dynamic): modo, velocità e accelerazione stimate, velocità permessa, MRSP e sue variazioni, posizione dell'intervento del freno d'emergenza (`N_LOC_EBI`), fine autorizzazione e punto sorvegliato, velocità di rilascio, pendenze, tempi di reazione e incertezza di posizione. Il pacchetto 11 porta le decelerazioni di frenatura sicure. Le posizioni sono letture del contatore di posizione del bordo in centimetri, con marche temporali e balise di riferimento.

### Cosa prende YuTreno

Tutte le variabili dei pacchetti 6 e 11 che un bordo di livello 2 in piena supervisione può riempire sono prodotte, con i nomi della specifica, da tutti e tre i bordi (interno, di riferimento, esterno tramite `dmi.ato`) e passate al controllore in `etcs_ato`. Le unità sono SI e le posizioni progressive di linea, una divergenza dichiarata che tiene l'osservazione omogenea con `pos_m`. Il trasporto è l'osservazione in lockstep, non un ciclo di 200 ms con timeout di 1000 ms.

`N_LOC_EBI` è la variabile che conta di più, perché un ATO non può calcolarla da solo: dipende dalle curve e dai tempi del bordo. Due controlli la fissano: in `verify-ato-s130` un macchinista che tiene velocità costante e non frena mai è fermato entro 0,2 m (interno) e 1,3 m (riferimento) dal punto annunciato; in `verify-subset026` coincide con d_EBD(v) − v·T_be in piano.

### Dove si ferma

Mancano i dati statici, gli ingressi del macchinista e i pacchetti specifici dell'ATO (5, 7, 8, 9, 10), `N_LOC_RSM`, `A_MAXREDADH`, `V_DELTA0`, le iterazioni del linking e gli insiemi di informazioni. Non servono alla domanda che YuTreno pone ai dati ATO, cioè se un ATO che pianifica con essi si comporta meglio di uno che segue la curva permessa ([CAMPAGNA.md](CAMPAGNA.md)).

## EULYNX: apparato ed enti di piazzale

### Cosa prescrive

EULYNX standardizza le interfacce del sistema di segnalamento, perché apparati ed enti di piazzale di fornitori diversi possano lavorare insieme. La Baseline 4 Release 4 pubblica, fra gli altri, SCI-P (Eu.Doc.38, apparato–deviatoio) e SCI-TDS (Eu.Doc.44, apparato–rilevamento treno), con telegrammi, parametri, codici, macchine a stati e lo strato di connessione PDI sottostante.

### Cosa prende YuTreno

Fra l'apparato e il piazzale simulato i telegrammi sono quelli dei documenti, con nomi, campi e codici: `Cd_Move_Point`, `Msg_Point_Position`, `Msg_Movement_Failed`, `Msg_Ability_To_Move_Point` per i deviatoi, `Msg_TVPS_Occupancy_Status` per i tratti di binario. Il piazzale riporta le posizioni non intenzionali dei deviatoi tallonati, i tratti disturbati per i guasti, e la causa di cambiamento di ogni messaggio di stato. Poiché il confine è un'interfaccia standard, lo stesso apparato può parlare oggi con un piazzale simulato e, in linea di principio, domani con object controller veri o fisici (vedi [MODELLINO.md](MODELLINO.md)).

### Dove si ferma

Non ci sono codifica in byte né connessione PDI, quindi né controllo di versione né procedura di inizializzazione; mancano i punti di rilevamento, il force clear, il livello di riempimento e lo stato POM. Le interfacce fra apparato e RBC (SCI-RBC) e fra apparato e posto centrale (SCI-CC) non sono pubblicate nella B4R4: quelle di YuTreno sono sue e dichiarate come tali. `verify-trackside` controlla l'apparato contro il piazzale telegramma per telegramma, senza motore.

## Pratica RFI: Tabelle delle Condizioni e logica degli itinerari

### Cos'è

In Italia la logica di un apparato centrale a calcolatore (ACC) si progetta dal piano schematico della stazione e dalle sue Tabelle delle Condizioni: per ogni itinerario, i deviatoi e le loro posizioni, i circuiti di binario da controllare, l'overlap, gli itinerari incompatibili, la velocità sul ramo deviato e il modo di liberazione. Sono documenti di progetto della pratica RFI più che un singolo standard pubblico.

### Cosa prende YuTreno

YuTreno descrive gli itinerari in un formato di tabella ricostruito da quella pratica (`ControlTable`), lo traduce nella configurazione dell'apparato e ne ricava le incompatibilità che seguono dagli enti condivisi. L'apparato implementa formazione dell'itinerario, controllo, integrità, liberazione elastica, annullamento immediato e ritardato (una forma semplice di bloccamento d'approccio) e formazione automatica da orario, e l'RBC costruisce l'autorizzazione dalla catena degli itinerari formati.

### Dove si ferma

Il formato è una ricostruzione, non un documento RFI, e va validato con progettisti d'apparato, soprattutto per incompatibilità, overlap e liberazione. I tempi (manovra, formazione, ritardo di annullamento) sono valori plausibili, non presi da uno standard. In sessione c'è un solo treno: il treno che precede occupa i tratti ma non chiede itinerari. Tutto questo è elencato in [TERRA.md](TERRA.md).

## SCMT

### Cosa fa il sistema reale

L'SCMT (Sistema Controllo Marcia Treno) è la protezione nazionale italiana, sviluppata da RFI dal 2000, certificata fino a 250 km/h e attiva su più di 13.000 km di rete. Ha un sottosistema di terra (SST) e uno di bordo (SSB). L'SST trasmette, tramite boe della stessa tecnologia usata da ERTMS (i *punti informativi*, posti presso i segnali, le riduzioni di velocità e altri punti rilevanti), l'aspetto del segnale successivo e le caratteristiche della linea. L'SSB calcola tetti e curve di frenatura da questi dati e dai dati del treno inseriti all'avvio (percentuale di massa frenata, velocità massima, lunghezza), e sulle linee con blocco automatico a correnti codificate (BACC) legge anche i codici della ripetizione continua in rotaia (75, 120, 180, 270 al minuto e, con la versione a 9 codici, i codici aggiuntivi a 178 Hz). Sorveglia la velocità con continuità, protegge i segnali rossi e le riduzioni di velocità, comanda la frenatura di servizio o d'emergenza, e ha comandi propri per il macchinista (riconoscimento degli aspetti restrittivi entro pochi secondi, rilascio dopo una fermata, modalità per superare un segnale rosso, manovra). Esiste da solo, integrato con l'SSC, o come modulo di sistema nazionale dentro un bordo ETCS.

### A che punto è YuTreno

In YuTreno l'SCMT è **una supervisione semplificata**, scritta per rendere protette in modo riconoscibile le corse con blocco automatico, non un modello del sistema reale. Quando il segnalamento è il blocco automatico (`BACC`):

- i segnali sono quelli di un blocco a tre aspetti generato dalle stazioni e dalla lunghezza della sezione, con il rosso dietro il treno che precede e il giallo prima;
- il bordo sorveglia una sola curva di frenatura verso il primo segnale rosso e verso ogni riduzione di velocità entro 5 km, con decelerazione costante di 0,55 m/s²;
- verso un segnale rosso la velocità permessa non scende mai sotto un rilascio di 30 km/h;
- l'avviso scatta a +3 km/h sopra la curva permessa e il freno d'emergenza a +7 km/h; non c'è intervento del freno di servizio;
- superare un segnale rosso porta al freno d'emergenza e conta come superamento.

Manca gran parte di quello che fa l'SCMT:

- **nessuna informazione puntuale**: non ci sono boe SCMT; il bordo conosce l'aspetto di ogni segnale direttamente dal motore, una conoscenza continua e perfetta che l'SSB reale non ha fra due punti informativi;
- **nessun circuito di binario codificato**: i codici BACC 75/120/180/270 e il loro significato (e i codici RS9) non sono simulati, quindi non esistono né la ripetizione continua né i tetti legati al codice;
- **nessuna curva dipendente dal treno**: la decelerazione è un valore fisso, non ricavato da percentuale di massa frenata, lunghezza e pendenza come fa l'SSB;
- **nessuna procedura del macchinista**: niente riconoscimento degli aspetti restrittivi, niente tasto di rilascio dopo una fermata, niente modalità per superare un rosso, niente manovra, niente gestione particolare dei paraurti;
- **nessuna integrazione con l'SSC** e nessun modulo di sistema nazionale dentro il bordo ETCS.

Nella matrice l'SCMT non ha righe, perché non è una specifica ERA e le sue specifiche funzionali sono documenti RFI non coperti qui. Negli scenari l'SCMT serve a confrontare il comportamento dello stesso controllore sotto ETCS e sotto blocco automatico (per esempio `leader-stopped-scmt.json`).

### Cosa servirebbe per un SCMT vero

Un modello credibile di SCMT seguirebbe lo stesso schema del bordo ETCS di riferimento: un modulo di bordo separato che conosce il mondo solo attraverso ciò che riceve l'SSB reale. In concreto:

1. **Terra**: punti informativi SCMT sulla linea, generati accanto ai segnali e alle riduzioni di velocità come i gruppi di balise ETCS, con l'aspetto e i dati di linea nel pacchetto nazionale; e, sulle linee BACC, la corrente codificata di ogni sezione di blocco calcolata dagli aspetti.
2. **Bordo**: un `ScmtSsb` che legge punti informativi e codici, conserva l'ultimo aspetto noto fra due punti, calcola tetti e curve di frenatura dai dati del treno e implementa le procedure del macchinista (temporizzatori di riconoscimento, rilascio, modalità di superamento).
3. **Protocollo**: la stessa forma richiesta/risposta del bordo ETCS, così da poter collegare anche un SSB esterno.
4. **Fonti**: le specifiche funzionali RFI di SCMT e BACC, da procurare e leggere prima di scrivere il modello; è l'incertezza principale.
5. **Test**: un `verify-scmt.ts` con la stessa struttura di `verify-subset026.ts`, e righe nella matrice per le clausole effettivamente implementate.

Fino ad allora, i risultati ottenuti con il blocco automatico in YuTreno descrivono "un semplice blocco a tre aspetti con una supervisione di velocità essenziale", non l'SCMT.

## Riferimenti per frenatura e dinamica

La dinamica del treno non segue un singolo standard, ma parametri e leggi vengono da riferimenti consolidati: la resistenza di Davis, la resistenza in curva di Röckl, la legge di aderenza di Curtius–Kniffler, le velocità di propagazione e i tempi di riempimento del freno della UIC 540, i modelli di aggancio della letteratura sulla dinamica longitudinale (Cole et al., Yadav e Vyas). La pagina del modello (`dist/model.html`) cita ogni fonte e `verify-dynamics` controlla il modello contro risultati in forma chiusa.

## Co-simulazione: FMI

Il protocollo della dinamica esterna segue lo schema master/slave della co-simulazione FMI 2.0: il motore è il master, il modello avanza di `dt` su richiesta con ingressi tenuti costanti (mantenimento di ordine zero) e restituisce il suo stato. Non è un'implementazione FMI: una FMU non si carica direttamente, ma il protocollo corrisponde uno a uno a `doStep`, il che rende un involucro FMU un'estensione naturale ([DINAMICA_ESTERNA.md](DINAMICA_ESTERNA.md)).

## Standard di prova e di processo

Il **Subset-076** (specifiche di prova ETCS) e il **Subset-094** (requisiti funzionali di un banco di prova di riferimento per il bordo) descrivono come si prova in laboratorio un bordo ETCS reale. Il protocollo in lockstep di YuTreno ha la stessa forma dell'architettura del Subset-094 (odometria, balise e radio in ingresso, comandi al treno e DMI in uscita), ed è per questo che può ospitare bordi esterni; non esegue le sequenze del Subset-076. Le **EN 50126/50128/50129** regolano il ciclo di vita della sicurezza dei sistemi ferroviari; YuTreno non le segue e non va usato dove si applicano.

## Gestione del traffico, capacità e rete

**Gestione del traffico.** Nell'architettura di riferimento del comando e controllo europeo (RCA, dei consorzi EULYNX ed EUG), decidere il piano e riprogrammarlo spetta al sistema di gestione del traffico (TMS). Questo consegna il piano operativo all'esecuzione del piano (Plan Execution) attraverso l'interfaccia SCI_1, e l'esecuzione chiede allo strato di sicurezza di assegnare gli enti. Il regolatore di YuTreno ([REGOLATORE.md](REGOLATORE.md)) segue la stessa divisione con un protocollo molto più piccolo: le decisioni su orari, priorità, binari e soppressioni vanno in un senso, lo stato della circolazione torna indietro, e la sicurezza resta all'apparato e al RBC. I metodi di riprogrammazione della letteratura (nuovi orari, nuovi ordini, nuovi percorsi, soppressioni, rassegnati da Cacchiani e altri e da Corman e Meng) sono ciò che un regolatore di ricerca inserirebbe; il regolatore di riferimento è solo un termine di paragone.

**Apparati adiacenti.** La definizione di sistema EULYNX affida lo scambio con un apparato adiacente, blocco di linea compreso, all'interfaccia SCI-ILS: comandi e stati nei due sensi. Non fissa i telegrammi del consenso di blocco, quindi il consenso di YuTreno fra i capi di una tratta a binario unico (richiesta, concessione, rifiuto, un ciclo di ritardo) usa messaggi propri ([TERRA.md](TERRA.md)).

**Capacità.** La fiche UIC 406 (2ª edizione, 2013) definisce il tempo di occupazione di una sezione di blocco e il metodo di compressione, e raccomanda i tassi di occupazione (75 % nell'ora di punta sulle linee a traffico misto). `verify-capacity` confronta il distanziamento minimo calcolato dai tempi di impegno con quello misurato, entro il 5 % ([CAPACITA.md](CAPACITA.md)).

**Blocco mobile.** Dalla TSI CCS del 2023 (Regolamento (UE) 2023/1695) il livello 3 non è più un livello: il blocco mobile è "ETCS livello 2 con blocco mobile". Il Subset-026 v4.0.0 dà il lato del bordo, l'integrità del treno nel rapporto di posizione (`Q_INTEGRITY`, `L_TRAININT`, §3.6.5.2) e i parametri dei rapporti (pacchetto 58); la logica dell'RBC non è un'interfaccia fra costruttori ed è descritta dalla specifica di sistema di Shift2Rail X2Rail-5 (coda confermata, "margine L3", treni senza integrità o che non comunicano). YuTreno li implementa entrambi in forma semplificata ([BLOCCO_MOBILE.md](BLOCCO_MOBILE.md)).

**Topologia della rete.** La UIC IRS 30100 (RailTopoModel, 2016) descrive la rete ferroviaria come un grafo di elementi di rete e relazioni a più livelli di dettaglio (micro, meso, macro), ed è la base di railML 3. Le linee di YuTreno sono ancora corridoi singoli nel loro formato; una rete di linee che si incontrano nei nodi è il prossimo passo del piano.

## Orari e informazione ai passeggeri

Gli standard del lato passeggeri (Transmodel, NeTEx, SIRI, GTFS) e dello scambio dell'orario fra applicazioni ferroviarie (railML) hanno un documento a parte, [STANDARD_ORARI.md](STANDARD_ORARI.md). Vi si trovano:
- il quadro normativo: regolamento MMTIS, punto di accesso nazionale e Regional Access Point italiani, STI Telematica;
- il modello di ciascuno standard, con esempi commentati prodotti da YuTreno;
- la corrispondenza dei concetti fra i formati e gli strumenti di validazione;
- le differenze rispetto ai profili italiani.

## Fonti

- ERA, ERTMS/ETCS Subset-026 v4.0.0 System Requirements Specification; Subset-130 v1.0.0 interfaccia ETCS–ATO; Subset-076; Subset-094; strumento per le curve di frenatura e sua guida. Agenzia dell'Unione europea per le ferrovie.
- EULYNX, Baseline 4 Release 4, Eu.Doc.38 (SCI-P) ed Eu.Doc.44 (SCI-TDS).
- RFI, [Sistema Controllo Marcia Treno (SCMT)](https://www.rfi.it/it/Sicurezza-e-tecnologie/tecnologie/ccs/Controllo-Marcia-Treno/Sistema-Controllo-Marcia-Treno--SCMT.html).
- [Sistema Controllo Marcia Treno](https://en.wikipedia.org/wiki/Sistema_Controllo_Marcia_Treno) e [Blocco automatico a correnti codificate](https://en.wikipedia.org/wiki/Blocco_automatico_a_correnti_codificate), Wikipedia.
- Modelica Association, Functional Mock-up Interface 2.0.
- EULYNX ed ERTMS Users Group, [RCA TMS-PE component specification, RCA.Doc.19](https://public.3.basecamp.com/p/DCGx8enamwvLtQBYnCcn2Eee/upload/download/RCA_TMS-PE_specification.pdf) e [RCA SCI_1 specification](https://public.3.basecamp.com/p/ofsxC3P8zyZRKXJn7nqbS6rJ/upload/download/RCA_SCI_1_specification.pdf).
- EULYNX, [System Definition Eu.Doc.7 v4.2](https://eulynx.eu/storage/simple-file-list/General-Documents/Baseline-set-4-Release-3/20240618-EULYNX-System-Definition-Eu_Doc_7-v4_2-2_A.pdf) (SCI-ILS, apparato adiacente).
- Europe's Rail, [Traffic CS system concept](https://rail-research.europa.eu/wp-content/uploads/2025/03/Traffic_CS_System_Concept.pdf).
- UIC, [Code 406, Capacity, 2ª edizione, giugno 2013](https://tamannaei.iut.ac.ir/sites/tamannaei.iut.ac.ir/files/files_course/uic406_2013.pdf); [un metodo di compressione UIC 406 analitico con la scala dei tempi di impegno](https://www2.mdpi.com/1996-1073/13/7/1853), Energies 13(7), 2020.
- UIC, [IRS 30100 RailTopoModel](https://www.railtopomodel.org/files/download/RailTopoModel/180416_uic_irs30100.pdf), 2016.
- V. Cacchiani e altri, [An overview of recovery models and algorithms for real-time railway rescheduling](https://repub.eur.nl/pub/50112), Transportation Research Part B 63, 2014.
- F. Corman, L. Meng, [A review of online dynamic models and algorithms for railway traffic management](https://repository.tudelft.nl/record/uuid:f3f50b0d-6e00-4b06-9d14-2e126c8ec1f6), IEEE Transactions on Intelligent Transportation Systems 16(3), 2015.
- [The ON-TIME real-time railway traffic management framework](https://fis.tu-dresden.de/portal/de/publications/the-ontime-realtime-railway-traffic-management-framework(9a932df1-ff25-4bc4-94cc-fe29a390bc1d).html), TU Dresden.
