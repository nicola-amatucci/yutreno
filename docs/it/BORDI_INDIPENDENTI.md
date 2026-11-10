# Bordi indipendenti: nota di fattibilità

> Copia italiana. Il documento di riferimento è la versione inglese [INDEPENDENT_ONBOARDS.md](../INDEPENDENT_ONBOARDS.md): nomi di file, comandi e formati seguono quella; i nomi italiani della versione 0.x (campi JSON, opzioni come `--linea` o `--bordo`) restano accettati.

Il confronto differenziale fra bordi ETCS ha senso solo se almeno un bordo è stato scritto da altri, senza conoscere YuTreno. Il bordo di riferimento del nucleo non basta: è scritto insieme al lato terra che deve mettere alla prova. Questa nota valuta i due candidati aperti più promettenti, [cesarBLG/ETCS](https://github.com/cesarBLG/ETCS) e [milanredele/etcs-dmi](https://github.com/milanredele/etcs-dmi), e stima lo sforzo per collegarli al protocollo del bordo esterno ([BORDO_ETCS.md](BORDO_ETCS.md)).

Entrambi i repository sono stati letti il 5 novembre 2026, senza eseguirne il codice:
- cesarBLG/ETCS al commit `0ca9cee` del 22 ottobre 2026;
- milanredele/etcs-dmi al commit `cf85cea` del 30 ottobre 2026.

## Cosa deve fare un bordo per entrare nella campagna

Il protocollo di YuTreno è a ciclo chiuso e al passo. A ogni ciclo il motore manda odometria, boe lette e messaggi radio, e aspetta comandi verso il treno, messaggi per il RBC e DMI. Un bordo vero non sa di essere fermato fra un ciclo e l'altro, quindi un adattatore deve fargli credere che il tempo scorra solo quando lo dice il motore. Servono quattro cose:
1. il tempo del bordo deve venire dal motore;
2. i dati vanno tradotti fra il JSON decodificato di YuTreno e il formato del bordo, che per entrambi i candidati è la codifica a bit del Subset-026 §7–8;
3. il bordo va portato in supervisione completa senza un macchinista, cioè con un inizio missione automatico;
4. le uscite vanno lette: urgenza, frenatura di servizio, taglio della trazione e velocità del DMI, più, per l'ATO Subset-130, la posizione dell'EBI.

## cesarBLG/ETCS

È un bordo in C++, circa 25 000 righe nella parte EVC, con licenza **MPL-2.0**. Copre livello 1 e livello 2, con Euroradio su TCP, e nasce per OpenRails e SimRail, dove è usato davvero.

**Tempo.** Tutto il tempo del bordo passa da `platform->get_timer()`, e il ciclo principale (`update()` in `evc.cpp`, ogni 50 ms) si riprogramma con `platform->delay()`. Il codice ha già più piattaforme intercambiabili (`platform/`: console, SDL, SimRail). Una piattaforma «YuTreno» che restituisce il tempo simulato ed esegue le attese quando il motore avanza rende il bordo al passo. Gli unici due punti non ripetibili sono due `std::random_device`, uno per l'identificativo del treno e uno nella connessione sicura della radio. Vanno sostituiti da un seme fisso, ed è una modifica di due righe.

**Ingressi e uscite.** Il bordo parla con il simulatore attraverso un bus di parametri testuali in stile OpenRails (`OR_interface/interface.cpp`):
- `distance`, `speed` e `acceleration` per l'odometria;
- `etcs::telegram` per i telegrammi, come stringa di bit;
- `etcs::emergency`, `etcs::fullbrake` e `etcs::tractioncutoff` per i comandi;
- `etcs::vperm`, `etcs::vsbi`, `etcs::vtarget`, `etcs::dtarget` e `etcs::supervision` per il DMI.

I messaggi radio passano invece da Euroradio. Le classi dei pacchetti (`Packets/`) hanno i nomi delle variabili del Subset-026 e sanno leggersi e scriversi a bit. L'adattatore può quindi costruire i pacchetti dal JSON di YuTreno e farli codificare al bordo stesso.

**Inizio missione.** Al livello 2 il bordo apre la sessione con il RBC e svolge il dialogo di inizio missione: 155, 32, 159, 129, 8, 146, poi la richiesta di autorizzazione. Il RBC di YuTreno oggi apre la sessione al primo rapporto di posizione e va esteso. L'opzione `bot_driver` toglie le conferme del macchinista. Gli ingressi del DMI (identificativo, livello, dati del treno, avvio) vanno comunque simulati sul bus del DMI.

**Dati per l'ATO.** Il bus non espone la posizione dell'EBI. L'adattatore la può ricavare dagli obiettivi della supervisione (`Supervision/`), oppure l'ATO Subset-130 ripiega sul comportamento semplice.

## milanredele/etcs-dmi

È un DMI completo e, da settembre 2026, un bordo che implementa il Subset-026 v4.0.0 in SPARK/Ada, con prova di assenza di errori a run-time, per microcontrollori TI Hercules. Il repository conta circa 54 000 righe nella parte `evc/`, ha licenza **GPL-3.0** ed è molto attivo.

**Tempo.** È il candidato più adatto al passo a passo. Il nucleo (`EVC_Core`) espone `Handle_Input (Port, Payload)`, `Tick (Dt_Ms)` e `Take_Outputs`, non usa thread, allocazione dinamica o virgola mobile, e fa tutto in interi con arrotondamento a favore della sicurezza. Un ciclo è una chiamata, e il determinismo è nel progetto, non va ottenuto con un adattatore.

**Ingressi e uscite.** Le porte sono documentate byte per byte in `evc/evc_ports.ads`:
- BTM: un telegramma di 210 o 830 bit, con il timbro dell'odometro;
- RTM: un messaggio radio del capitolo 8;
- odometro: 22 byte;
- TIU: urgenza, frenatura di servizio, taglio della trazione e motivi;
- DMI: il protocollo dei frame del DMI;
- JRU.

Il codificatore a bit è generato da un catalogo dei pacchetti, e `sim/` contiene già un lato terra, un macchinista automatico e un ATO di prova.

**Due correzioni rispetto a quanto ci aspettavamo.** La prima: la **porta ATO esiste ma non ha ancora un formato**, e il bordo rifiuta ogni ingresso su di essa (`evc_ports.ads`: «no payload is defined»). I dati del Subset-130 quindi oggi non escono. La seconda: il bordo è **guidabile solo al livello 1**. Il piano del repository (`doc/EVC-PLAN.md`) dà le fasi E0–E3 chiuse e la E4, modi e procedure del livello 1, integrata. La prossima è la E5, cioè radio, sessioni e livello 2. Le condizioni di transizione che riguardano il livello 2 oggi rispondono falso.

**Inizio missione.** Al livello 1 passa dai frame del DMI: identificativo del macchinista, livello, dati del treno, avvio. Il macchinista automatico di `sim/` lo fa già e si può riusare.

**Conseguenza per YuTreno.** Finché manca la E5, il bordo si può provare solo con un lato terra di livello 1, cioè con boe che portano l'autorizzazione nel pacchetto 12, collegate ai segnali. YuTreno oggi genera il livello 2 e per il livello 1 avrebbe bisogno di un lato terra nuovo.

## Stima dello sforzo

Le stime sono in giorni di lavoro concentrato e comprendono prove e documentazione. C'è un lavoro comune ai due candidati: un **codificatore e decodificatore a bit** dei telegrammi e dei messaggi del Subset-026 §7–8 nel nucleo di YuTreno, per i pacchetti e i messaggi che il lato terra già produce. Era già fra i passi previsti per il banco ([BORDO_ETCS.md](BORDO_ETCS.md#verso-lhardware)) e mette alla prova anche il decodificatore del bordo. Per cesarBLG si potrebbe evitare usando le classi del bordo, ma tenerlo nel nucleo rende la traduzione indipendente dal bordo provato.

| Lavoro | cesarBLG, livello 2 | milanredele, livello 1 |
| :-- | :-: | :-: |
| Codificatore e decodificatore a bit nel nucleo (comune) | 5–7 | 5–7 |
| Tempo dal motore: piattaforma YuTreno o chiamata a `Tick` | 3–5 | 1–2 |
| Adattatore di processo: protocollo del bordo esterno su stdin/stdout | 2–3 | 3–4 (ospite Ada, compilazione con Alire) |
| Inizio missione: dialogo RBC (cesarBLG) o frame DMI (milanredele) | 3–5 | 2–3 |
| Lato terra di livello 1 con pacchetto 12 ai segnali | — | 4–6 |
| Uscite, DMI e posizione dell'EBI per l'ATO | 2–3 | 2–4 (ricavata dall'interno, la porta ATO non la dà) |
| Determinismo, campagna e Docker | 2–3 | 2–3 |
| **Totale** | **17–26** | **19–29** |

## Rischi

**cesarBLG.**
- Il ciclo da 50 ms e quello di YuTreno, da 100 ms, vanno allineati: il motore deve concedere due cicli del bordo per ogni ciclo del protocollo, oppure il protocollo deve scendere a 50 ms.
- Il codice è scritto per l'uso in un simulatore di guida, e qualche comportamento può dipendere da quell'ambiente: OpenRails o SimRail, cabina, configurazione dei treni in `config.json`.
- La licenza MPL-2.0 vale per file: i file del bordo modificati restano MPL, l'adattatore può avere la licenza che si preferisce. Pubblicare tutto non pone problemi.

**milanredele.**
- Il livello 2 dipende dai tempi di un progetto altrui.
- Il confronto al livello 1 richiede scenari diversi da quelli di oggi, quindi non sarebbe un confronto sugli stessi scenari del bordo di riferimento finché anche quello non supporta il livello 1.
- La licenza GPL-3.0 si estende a un adattatore che si collega al codice. Un adattatore separato che parla con il bordo come processo esterno è invece un programma a sé. In ogni caso la pubblicazione dei dati e degli scenari non è toccata.

## Raccomandazione

Come bordo indipendente conviene **cesarBLG al livello 2** come bordo indipendente. Lavora sugli stessi scenari del bordo di riferimento, la licenza non crea vincoli e il suo tempo si può sostituire senza toccare la logica. L'ordine di lavoro proposto:
1. il codificatore a bit, che serve comunque;
2. la piattaforma deterministica con la prova di ripetibilità della campagna, cioè due corse con lo stesso hash;
3. l'inizio missione;
4. l'ingresso nella matrice di `campaigns/reference.json` come terzo bordo.

milanredele resta il candidato migliore per la ripetibilità e per la qualità del codice rispetto alla specifica. Conviene seguirne la fase E5 e, nel frattempo, proporre all'autore un formato per la porta ATO con i dati del Subset-130 (pacchetti 6 e 11). Quella porta è oggi definita ma vuota, e il progetto dichiara di accogliere decisioni scritte dove la specifica tace. Quando arriverà il livello 2, il costo di collegarlo scende a circa 10–14 giorni, perché il codificatore comune e la campagna saranno già pronti.
