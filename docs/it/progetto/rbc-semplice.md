# RBC semplice a messaggi e gruppi di balise

> Copia italiana di [simple-rbc.md](../../design/simple-rbc.md). In caso di differenze fa fede il testo inglese.

## Scopo

`src/core/simple-rbc.ts` è la terra delle corse ETCS a messaggi quando non si sceglie l'apparato: dispone i gruppi di balise lungo la linea e fa girare un RBC che trasforma l'autorizzazione del blocco in messaggi del Subset-026. È piccolo di proposito: dà a un bordo tutto ciò che gli serve per il livello 2 in piena supervisione, con l'autorizzazione calcolata come nella supervisione interna, così che l'unica differenza fra corse interne e di riferimento sia il bordo.

## Gruppi di balise

`buildBaliseGroups(L, reverseStarts)` mette un gruppo sotto il treno alla partenza (posizione memorizzata), uno 40 m prima di ogni fermata, uno 20 m prima di ogni tabella di arresto e altri in modo che nessun intervallo superi 1200 m. Ogni gruppo ha due balise a 3 m (`BALISE_SPACING`), `NID_C` = 1 e un `NID_BG` progressivo; `nidLrbg()` dà `NID_C·2^14 + NID_BG`. `baliseTelegram(bg, nPig)` costruisce il telegramma: intestazione (`Q_UPDOWN`, `M_VERSION`, `N_PIG`, `N_TOTAL`, `M_DUP`, `M_MCOUNT`, `NID_C`, `NID_BG`, `Q_LINK`) e solo il pacchetto 255. Il motore mette in coda un telegramma per ogni balise superata dalla testa, con la lettura dell'odometro, nell'ordine in cui il treno le incontra: un treno contro il verso nominale legge `N_PIG` 1 prima di 0. `reverseStarts` aggiunge un gruppo appena oltre ogni stazione da cui un treno parte al contrario, numerato dopo gli altri perché gli identificativi della linea non cambino.

## RBC

`Rbc` tiene una `RbcSession` per treno, per `NID_ENGINE`: ultimo rapporto di posizione con l'orientamento del treno rispetto al suo LRBG, stato dei TSR e dell'arresto d'emergenza. Tutti i treni di una corsa condividono un solo `Rbc`; `stopOrder` e `open` si riferiscono al treno guidato (engine 1).

- `receive(m)`: un rapporto di posizione (136, o 132) apre la sessione del suo `NID_ENGINE` e aggiorna LRBG, distanza e orientamento (`Q_DIRLRBG`).
- `tick({ t, ma, baseLim, tsr, engine })`: per la sessione di `engine`, a sessione aperta e quando qualcosa è cambiato (autorizzazione, LRBG, TSR) o ogni `refresh` = 5 s, manda il messaggio 3 riferito all'ultimo LRBG riportato, con i pacchetti 15 (una sezione fino all'EOA, punto pericoloso, velocità di rilascio), 27 (profilo statico dai limiti di linea), 21 (pendenze intere arrotondate dal lato della sicurezza), 5 (linking dei gruppi più avanti), 65/66 (TSR emessi e revocati). Quando è impostato `stopOrder` manda una volta il messaggio 16.

Tutte le distanze sono in metri (`Q_SCALE` = 1). Per un treno orientato come l'LRBG i pacchetti hanno `Q_DIR` = 1; per un treno che va al contrario `Q_DIR` = 0, e posizioni, profili e gruppi da collegare sono quelli della linea vista dal suo senso (`mirrorLine`), con autorizzazione, limiti e TSR dati dal motore nelle progressive di quel senso. Le iterazioni stanno in `elements` dopo il primo elemento, come nel Subset-026.


**Blocco mobile.** `receive` tiene anche, da ogni rapporto con l'integrità confermata (`Q_INTEGRITY` o `Q_LENGTH` 1 o 2, con `L_TRAININT`), la coda confermata del treno in progressive nominali con il suo istante (`RbcSession.rears`, le ultime 64); `confirmedRear(engine, t, delay)` dà l'ultima arrivata all'RBC `delay` secondi prima di `t`. Con `spacing: 'moving_block'` il motore ne ricava l'autorizzazione (`traffic.ts`, `movingAuthority`, [BLOCCO_MOBILE.md](../BLOCCO_MOBILE.md)) e `tick` aggiunge il pacchetto 58 con `T_CYCLOC` (`tCycloc`) a ogni messaggio 3.
## Interfacce

Ingresso: la linea compilata, l'autorizzazione del blocco (`MovementAuthority`), i limiti di base, i TSR degli scenari, i messaggi del bordo. Uscita: messaggi radio. Il motore li passa al bordo solo mentre la radio funziona; con `radio_loss` si perdono entrambe le direzioni.

## Invarianti

- Il messaggio 3 è sempre riferito a un gruppo che il bordo ha riportato: un bordo che non si riporta mai non riceve mai un'autorizzazione.
- L'EOA trasmessa non sta mai oltre l'autorizzazione del blocco.
- Cambiare il contenuto dei messaggi cambia le corse di riferimento della campagna: va fatto di proposito e documentato.

## Test

`verify-moving-block` (coda confermata, pacchetto 58, coda congelata) e `verify-onboard` (posizione dei gruppi, sessione, una sessione per treno con treni nei due sensi, contenuto del messaggio 3 con `L_ENDSECTION` pari alla distanza dall'LRBG all'EOA, TSR come pacchetto 65, arresto come messaggio 16) e `verify-subset026` (struttura del telegramma).

## Estensioni

Dialogo di start of mission (155, 32, 159, 129, 8, 132) e conferme, pacchetto 3 con i valori nazionali, autorizzazioni a più sezioni. La terra con apparato ([terra-apparato.md](terra-apparato.md)) sostituisce già il calcolo dell'autorizzazione con gli itinerari.
