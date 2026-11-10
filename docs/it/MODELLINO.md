# Un plastico guidato da YuTreno: fattibilità e prima bozza

> Copia italiana di [PHYSICAL_MODEL.md](../PHYSICAL_MODEL.md). In caso di differenze fa fede il testo inglese.

**Stato: idea, non iniziata.** Questo documento verifica se un treno in scala possa correre sotto la protezione di YuTreno, con tag NFC al posto delle balise e un collegamento radio al posto dell'RBC, e propone una prima bozza di architettura, hardware e fasi. Nulla è ancora costruito; i numeri indicati come stime vanno misurati nella prima fase.

## L'idea in un paragrafo

Oggi YuTreno simula tutto: il treno si muove dentro `Simulation`, le balise le genera il motore, l'RBC è una funzione nello stesso processo. In un plastico il treno si muove davvero, quindi il motore smette di essere la fonte del moto e diventa quello che già è per un modello di dinamica esterno: il resto del mondo. Il treno in scala porta una piccola unità di bordo che legge tag NFC incollati fra le traversine (le balise), conta i giri delle proprie ruote (l'odometria) e comanda il proprio motore; l'RBC le parla via WiFi. YuTreno continua a fare quello che sa già fare: linea, autorizzazioni, curve di supervisione, apparato, scenari, verdetto e registrazioni. Gran parte dei pezzi esiste già, perché i protocolli di bordo e di terra sono stati pensati proprio per separare il bordo dal mondo e l'apparato dal piazzale.

## È fattibile?

Sì, in scala H0 e con una scelta attenta dei componenti, e il punto più rischioso si verifica in un giorno. Le cose che devono funzionare sono cinque.

### 1. Scala, velocità e linea

La cinematica si scala in modo pulito se lunghezze, velocità e accelerazioni sono divise per il fattore di scala e il tempo resta reale: uno spazio di frenatura v²/2a scala allora come una lunghezza, e le curve calcolate dal bordo restano valide. In H0 (1:87):

| Reale | Modello H0 |
| :-- | :-- |
| 160 km/h (44,4 m/s) | 0,51 m/s |
| 80 km/h | 0,26 m/s |
| decelerazione di servizio 1,0 m/s² | 11,5 mm/s² |
| 1 km di linea | 11,5 m di binario |
| gruppo di balise, 2 balise a 3 m | due tag a 34 mm |

Una linea YuTreno per il plastico è quindi corta: 1 km con due stazioni sta in un ovale o in un "osso di cane" di 11–12 m di binario, per esempio su un piano di 2,4 × 1,2 m. YuTreno permette già di disegnare una linea così nella scheda *Line*; l'unica aggiunta è un fattore di scala applicato al confine fra motore e modello (metri reali ↔ millimetri del plastico). In N (1:160) tutto è grande la metà e lo spazio è stretto; in G (1:22,5, la scala del plastico ETCS della TU Dresden) c'è posto per tutto ma le velocità arrivano a 2 m/s e il binario costa. H0 è il compromesso consigliato: economico, diffuso, con spazio sufficiente per una carrozza di prova.

### 2. Tag NFC come balise

Le Eurobalise reali sono transponder passivi alimentati dall'antenna sotto il treno, che ne legge il telegramma al passaggio. I tag NFC sono la stessa idea a 13,56 MHz con qualche centimetro di portata, esattamente quello che serve in scala.

- **Tag**: adesivi NTAG213 da 10–25 mm incollati sulle traversine, al centro fra le rotaie. Ogni tag ha un UID unico; la configurazione di terra associa UID → (`NID_C`, `NID_BG`, `N_PIG`), così due tag a 34 mm formano un gruppo e danno il verso di marcia, come nel Subset-026. Volendo, la memoria NDEF può contenere il telegramma stesso.
- **Lettore**: RC522 (MFRC522, SPI, il più economico), PN532 o PN5180 (più portata, interrupt). Montato sotto una carrozza con l'antenna a 5–10 mm dalle traversine.
- **Tempo di lettura**: il numero critico. Con la libreria Arduino più diffusa una chiamata `PICC_IsNewCardPresent()` dell'RC522 costa circa 27 ms. Il tag resta nel campo per 30–40 mm di corsa, cioè 60–80 ms a 0,5 m/s: due o tre letture alla velocità massima in scala, di più a velocità minori. È fattibile ma stretto, e coincide con l'esperienza dei modellisti: in scale grandi e a velocità alte i lettori a 13,56 MHz perdono tag e quelli a 125 kHz con antenna integrata funzionano meglio; in scale piccole e a velocità moderate funzionano. Timeout più corti, guadagno d'antenna massimo o un lettore con interrupt (PN532/PN5180) aumentano il margine. È la prima cosa da misurare (fase 0).
- **Posizione al passaggio**: la lettura dà il valore dell'odometro all'istante del rilevamento, con un errore fino a un ciclo di lettura (≈ 14 mm a 0,5 m/s, ≈ 1,2 m reali). È lo stesso tipo di errore che l'intervallo di confidenza del bordo già modella: basta dare valori realistici ai valori nazionali `odo_error_fixed_m` e `odo_error_relative`.
- **Rotaie e metallo**: le rotaie in alpacca sono conduttive e possono disaccordare un'antenna a 13,56 MHz; il tag va al centro fra le rotaie e l'antenna lontana da parti metalliche della carrozza. Da verificare in fase 0 sul binario vero.

### 3. Odometria

Fra due tag il bordo ha bisogno della distanza percorsa. Un magnete su un asse e un sensore di Hall danno un impulso per giro di ruota (una ruota H0 da 11 mm ha 34,5 mm di circonferenza, 3 m reali per impulso): troppo grossolano da solo. Un encoder ottico o magnetico sull'albero motore dà decine di impulsi per giro di ruota, oppure l'asse può portare più magneti. Slittamenti e tolleranza del diametro accumulano un errore che i tag azzerano a ogni gruppo: è proprio il principio ETCS del riposizionamento sulle balise, e il plastico lo rende visibile.

### 4. Radio: l'RBC via WiFi

L'unità di bordo è un ESP32, che ha WiFi e Bluetooth integrati. Due modi per raggiungere YuTreno:

- **WiFi verso il PC**: l'ESP32 si collega a un access point dedicato e tiene una connessione WebSocket o UDP verso un piccolo gateway di YuTreno. I tempi di andata e ritorno tipici sono di pochi millisecondi, con picchi occasionali; il risparmio energetico del WiFi dell'ESP32 va disattivato, perché aggiunge ritardi fino all'intervallo di beacon.
- **ESP-NOW verso un ESP32 gateway** collegato al PC via USB: niente access point, trame corte, andata e ritorno tipicamente intorno al millisecondo. Più robusto in un ambiente radio affollato, al prezzo di una seconda scheda.

Entrambi stanno ampiamente nel budget: il ciclo di bordo di YuTreno è di 100 ms, l'RBC manda il messaggio 3 ogni 5 s o a ogni cambiamento, e [TEMPO_REALE.md](TEMPO_REALE.md) mostra che il motore è centinaia di volte più veloce del tempo reale. Lo scenario di perdita radio diventa fisico spegnendo l'access point.

### 5. Il motore in tempo reale

È l'unico cambiamento vero in YuTreno. Oggi il motore procede in lockstep e aspetta ogni programma esterno; un treno in scala non aspetta. Serve quindi la modalità agganciata all'orologio descritta come livello 1 in [TEMPO_REALE.md](TEMPO_REALE.md): il motore avanza con l'orologio, prende come stato del treno l'ultima posizione e velocità misurate sul plastico (esattamente quello che fornisce un modello di dinamica esterno), usa l'ultimo comando del bordo e registra ogni scambio con il suo istante. Il determinismo si perde e lo sostituiscono registrazione e riesecuzione, cosa da dichiarare in ogni risultato ottenuto sul plastico. Il plastico è un piccolo caso del livello 3 di quella pagina (segnali fisici), con il tempo reale stretto confinato nel microcontrollore: l'ESP32 legge tag e impulsi e comanda il motore localmente, e via radio viaggiano solo messaggi.

## Architettura

```
              PC: YuTreno                                           plastico
 ┌──────────────────────────────────────────┐        WiFi / ESP-NOW        ┌───────────────────────────────┐
 │ linea, scenario, verdetto, log, pagina   │ ◄──── odometria, tag ──────── │ carrozza di prova: ESP32, NFC │
 │ bordo di riferimento (fase 2)            │ ───── trazione, freno ──────► │ encoder, driver motore        │
 │ RBC (semplice o con apparato)            │ ◄──── messaggi 136 ────────── │ (EVC di bordo in fase 4)      │
 │ apparato                                 │ ───── messaggi 3, 16 ───────► │                               │
 │ gateway fisico (nuovo, src/server/)      │                               └───────────────────────────────┘
 │                                          │ ◄──── occupazioni SCI-TDS ─── ┌───────────────────────────────┐
 │                                          │ ───── comandi deviatoi SCI-P► │ object controller: ESP32      │
 └──────────────────────────────────────────┘                               │ deviatoi a servo, occupazioni │
                                                                            └───────────────────────────────┘
```

Come i concetti di YuTreno si traducono sul plastico:

| YuTreno | Plastico |
| :-- | :-- |
| progressiva di linea (m) | posizione lungo il binario (mm) × scala |
| gruppo di balise, `NID_BG`, `N_PIG` | due tag NTAG213, UID → identificativi nella configurazione di terra |
| `odometry` della richiesta di bordo | impulsi dell'encoder × circonferenza della ruota |
| risposta della dinamica esterna (`pos_m`, `vel_ms`) | posizione e velocità misurate della carrozza di prova |
| comandi del treno (`traction`, `brake`, `emergency`) | duty PWM e rampa di frenatura del driver motore |
| messaggi RBC | JSON su WebSocket o trame ESP-NOW |
| SCI-P (`Cd_Move_Point`, `Msg_Point_Position`) | deviatoio a servo con microinterruttore di fine corsa |
| SCI-TDS (`Msg_TVPS_Occupancy_Status`) | rilevamento di corrente su tratti isolati, o sensori IR |
| scenario `radio_loss` | access point spento per un po' |

La parte di terra è la più elegante: l'apparato parla già telegrammi EULYNX a un piazzale simulato, quindi un piazzale fisico è un insieme di piccoli "object controller" che parlano gli stessi telegrammi JSON. L'apparato non ha bisogno di sapere se i deviatoi sono simulati o veri.

## Dove gira il calcolatore di bordo

Due stadi, per tenere semplice il primo.

**Stadio A — EVC sul PC.** La carrozza di prova è un "carrello intelligente": misura e attua, nient'altro. Manda odometria e letture dei tag ogni 50–100 ms e applica i comandi di trazione e frenatura che riceve. Sul PC il gateway li trasforma nella richiesta di bordo del bordo di riferimento (odometria, balise con l'odometro al passaggio) e nella risposta di dinamica esterna (posizione e velocità), e trasforma le uscite del bordo in comandi al motore. L'RBC è nello stesso processo. È la strada più corta per un treno che si ferma da solo prima della fine dell'autorizzazione.

**Stadio B — EVC sull'ESP32.** La supervisione si sposta sul treno, come nella realtà: l'ESP32 esegue un bordo derivato da `examples/onboard/minimal_onboard.py` (riscritto in C++), legge i tag e comanda il motore localmente, e parla con l'RBC sul PC solo con i messaggi radio 136, 3 e 16. È la divisione "RBC via WiFi" del livello 2 reale, ed è qui che il plastico diventa un dimostratore didattico di dove vive ogni funzione. Il bordo di riferimento sul PC resta come termine di confronto.

## Bozza della distinta materiali

Prezzi indicativi, per una carrozza di prova e un plastico piccolo; da verificare al momento dell'acquisto.

| Componente | Quantità | Costo indicativo |
| :-- | :-: | --: |
| binario H0 per un anello di 11–12 m con due stazioni e due deviatoi | 1 | 150–300 € |
| locomotiva H0 con motore a corrente continua e una carrozza o un carro come carrozza di prova | 1 + 1 | 80–200 € |
| scheda ESP32 (formato piccolo per la carrozza, per esempio ESP32-C3 o S3 mini) | 1 | 5–10 € |
| lettore NFC RC522 (o PN532 / PN5180 per più margine) | 1 | 3–15 € |
| adesivi NTAG213 | 40–60 | 10–20 € |
| driver motore (DRV8833 o TB6612) | 1 | 3–5 € |
| encoder (magnetico o ottico) o sensore di Hall e magneti | 1 | 3–10 € |
| alimentazione: continua costante sui binari con regolazione a bordo e supercondensatore, o piccola LiPo | 1 | 10–20 € |
| servo per deviatoi (SG90 o a moto lento) con fine corsa | 2 | 10–30 € |
| rilevamento occupazione (sensori di corrente o IR) | 4–8 tratti | 10–40 € |
| schede ESP32 per gli object controller | 2 | 10–20 € |
| access point WiFi dedicato (o ESP32 gateway per ESP-NOW) | 1 | 0–30 € |

Una prima fase minima (una carrozza, un rettilineo o un anello, tag, lettore, ESP32, PC) costa meno di 100 € se la locomotiva c'è già.

## Fasi

| Fase | Obiettivo | Cosa si costruisce | Impegno stimato |
| :-- | :-- | :-- | :-: |
| 0 | misurare i numeri rischiosi | lettore su una carrozza spinta a mano e dalla locomotiva a velocità note; tag sul binario vero; tasso di lettura in funzione della velocità, errore di posizione, effetto delle rotaie | 1–2 giorni |
| 1 | vedere il treno in YuTreno | la carrozza manda tag e impulsi via WiFi; un gateway mostra la posizione misurata sullo schema di linea della pagina; nessun comando | 3–5 giorni |
| 2 | anello chiuso, EVC sul PC | modalità del motore agganciata all'orologio; fornitore di dinamica "fisico"; comandi al motore dal bordo di riferimento; il treno si ferma prima dell'EOA e in stazione | 1–2 settimane |
| 3 | piazzale fisico | object controller per due deviatoi e quattro–otto tratti, che parlano SCI-P e SCI-TDS in JSON con l'apparato; scenario di precedenza sul plastico | 1–2 settimane |
| 4 | EVC sul treno | bordo in C++ sull'ESP32, RBC via WiFi; perdita radio e arresto d'emergenza sul plastico; confronto con il bordo di riferimento sulle stesse corse | 2–4 settimane |

Dal lato di YuTreno il codice nuovo è: un fattore di scala nella configurazione di linea, il ciclo agganciato all'orologio (utile anche oltre il plastico), un fornitore di dinamica "fisico" e un gateway in `src/server/` che parla con gli ESP32, e un file di configurazione che associa UID dei tag e object controller a gruppi di balise, deviatoi e tratti. I protocolli non cambiano.

## Rischi e come gestirli

- **Tag persi in velocità.** Si misura in fase 0; le mitigazioni in ordine: velocità massima più bassa, timeout di lettura più corti, PN532/PN5180 con interrupt, due lettori in fila, tag più grandi. Un tag perso è anche un caso di prova legittimo: una balise non letta, che un bordo reale deve gestire con il linking.
- **Spazio nella locomotiva.** In H0 l'elettronica va in una carrozza di prova dietro la locomotiva, collegata con un cavo sottile o con una radio propria; in N è difficile, in 0 o G facile.
- **Interruzioni di alimentazione su binario sporco.** Riavviano l'ESP32: supercondensatore o piccola batteria a bordo, e pulizia del binario.
- **Deriva dell'odometria.** Attesa e utile: il riposizionamento sui tag è parte di ciò che il plastico deve mostrare; valori nazionali realistici per l'errore odometrico rendono onesto l'intervallo di confidenza.
- **Picchi radio.** Risparmio energetico disattivato, access point dedicato o ESP-NOW; ogni scambio con il suo istante, così ogni corsa dichiara la qualità della propria temporizzazione.
- **Sicurezza del plastico.** La protezione agisce su un modello, ma un treno fuori controllo cade comunque dal piano: un arresto hardware indipendente (sensore IR prima dei paraurti che toglie alimentazione al motore) costa poco e vale la pena.

## Cosa mostrerebbe

Un plastico rende visibile quello che il simulatore tiene astratto: il treno si localizza solo quando passa su una balise, l'intervallo di confidenza cresce fra una balise e l'altra e si richiude alla successiva, l'RBC estende l'autorizzazione man mano che l'apparato forma gli itinerari, un messaggio perso o un access point spento fanno frenare il bordo, un deviatoio che non arriva in controllo tiene corta l'autorizzazione. Per la didattica è uno strumento forte; per la ricerca è un piccolo banco hardware-in-the-loop su cui ripetere gli stessi scenari del simulatore con tempi veri, errori odometrici veri e radio vera.

## Fonti

- TU Dresden, [plastico ETCS in scala 1:22,5](https://tu-dresden.de/bu/verkehr/ibv/vst/die-professur/sil/etcs-versuchsanlage): ETCS livello 2 e Level 1 Limited Supervision su modello, con balise programmabili e posizionabili liberamente e collegamenti senza fili al calcolatore del laboratorio.
- [MRR-RFID-ESP32](https://github.com/jerryg2003/MRR-RFID-ESP32): firmware ESP32 per lettori RFID di fermodellismo (MFRC522, PN532, PN5180) via WiFi verso JMRI.
- RMweb, [Simulating ETCS using DCC](https://www.rmweb.co.uk/topic/178645-simulating-etcs-using-dcc/): progetto di un modellista per una protezione simile a ETCS con RFID nelle posizioni delle balise e curve di frenatura DCC.
- G Scale Central, [Location detection using RFID](https://www.gscalecentral.net/threads/location-detection-using-rfid.312384): esperienze con lettori su treni in movimento; RC522 a 13,56 MHz con portata insufficiente in scala grande, meglio lettori a 125 kHz con antenna integrata.
- O Gauge Railroading forum, [RFID position sensors and automatic train running](https://www.ogrforum.com/topic/rfid-position-sensors-and-automatic-train-running): tag a 13,56 MHz sui carrelli e lettori sotto il binario per la marcia automatica.
- Arduino forum, [RC522 PICC_IsNewCardPresent delay](https://forum.arduino.cc/t/rfid-rc522-picc_isnewcardpresent-command-delay-is-27/625691): circa 27 ms per lettura con la libreria comune.
- Hackaday, [Benchmarking latency across common wireless links for MCUs](https://hackaday.com/2024/02/11/benchmarking-latency-across-common-wireless-links-for-mcus): confronto delle latenze di ESP-NOW, WiFi e BLE sui microcontrollori.
