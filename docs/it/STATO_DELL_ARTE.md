# YuTreno: stato dell'arte e come riprendere

> Copia italiana di [STATE_OF_THE_ART.md](../STATE_OF_THE_ART.md). In caso di differenze fa fede il testo inglese.

Scritto il 9 novembre 2026, quando lo sviluppo si è fermato. È la versione breve per chi riprende il progetto: che cosa sa fare YuTreno oggi, quanto sono solide le prove, come rimettersi al lavoro in mezz'ora e che cosa viene dopo, in ordine. La storia completa di ogni passo e di ogni decisione sta in [ROADMAP.md](ROADMAP.md); le regole per lavorare nel repository stanno in `CLAUDE.md` (e in `AGENTS.md` per gli altri agenti).

## A che punto è il progetto

Il piano nato il 5 novembre 2026 ("più treni con orari, passeggeri") è completo, insieme alle fasi aggiunte strada facendo. Tutto il lavoro sta su `main`; non ci sono altri rami né decisioni aperte (ne sono state prese sedici, elencate nella roadmap).

| Fase | Contenuto |
| :-- | :-- |
| 1–3 | più treni, orari e treni di servizio nei due sensi; ETCS con una sessione per treno, apparato con consenso di blocco, guasti, regolatore della circolazione con protocollo pubblico, capacità UIC 406 |
| 4 | rete simulata: linee che si incontrano in stazioni condivise, corridoi, coincidenze, giri del materiale, itinerari di nodo e un apparato per linea |
| 5 | importazione di linee reali da OpenStreetMap, RINF ed EU-DEM con provenienza e rapporto; Avellino – Benevento, Cancello – Benevento (come rete con Benevento), Salerno – Mercato San Severino confrontata con il suo orario reale |
| 6 | passeggeri aggregati: domanda, salite e sosta, capacità, massa a bordo, cambi, occupazione nei dati aperti |
| 7 | strumenti della pagina: editor dell'orario, sala di controllo, modulo degli scenari, cabina di un altro treno, dirigente, persone sulle banchine |
| 8 | refactoring a numeri invariati: golden master, `Simulation` divisa in undici moduli, verifiche più veloci |
| 9 | il treno che precede è un vero merci della corsa |
| 10 | passaggio fra RBC su una linea (Subset-026 §3.15.1 e §5.15, Subset-039), con la terra con apparato |
| 11 | ETCS livello 2 con blocco mobile, dalla coda confermata e dall'integrità del treno |
| richieste della ricerca | modello di macchinista umano, tempo trattenuto dal segnalamento, deriva dell'odometria, integrità del treno |
| 9 novembre | un segnale superato a via impedita viene contato e trattiene il treno; due treni sullo stesso tratto di linea vengono segnalati (decisione 16) |

In numeri: circa 21.700 righe di TypeScript in `src/`, 31 scenari (`scenarios/`, `scenarios/trackside/`, `scenarios/services/`), tre linee reali, dati aperti in sei formati validi contro gli schemi ufficiali, programmi esterni per controllore, dinamica, bordo, terra e regolatore, ciascuno con un esempio e una verifica che la corsa esterna sia uguale a quella interna.

## Quanto sono solide le prove

- **23 verifiche** (`npm run verify`, circa quindici minuti su due core) coprono motore, protocolli, formati, linee reali, rete, passeggeri, capacità, blocco mobile e passaggio fra RBC. Ogni regola nuova ha una verifica che fallisce se la regola viene spenta.
- **Il golden master** (`npm run golden`, 282 corse, 15–28 minuti) prende l'impronta di ogni parte di ogni scenario in sei varianti di segnalamento, bordo, terra e regolatore, più le due campagne. La pagina ha il suo golden master (24 stati). Una modifica che non deve cambiare il comportamento deve lasciarli entrambi invariati.
- **Tracciabilità**: `docs/traceability/matrix.csv` ha 395 righe di requisiti del Subset-026, del Subset-039, del Subset-130, di EULYNX e della tabella di controllo: 62 implementate, 143 semplificate, 16 divergenti, 153 mancanti, 21 fuori ambito, e ogni riga implementata o semplificata ha un test con il tag.
- **Le campagne** sono deterministiche e con impronta: bordo × ATO × scenario (`a41b59b99b29cfae`), servizio, modello di macchinista, blocco fisso contro blocco mobile.
- **Che cosa non è validato**: le curve del bordo di riferimento non sono state confrontate con lo strumento dell'ERA per le curve di frenatura ([VALIDAZIONE_CURVE.md](VALIDAZIONE_CURVE.md)); lo SCMT è una supervisione semplificata, perché le specifiche RFI non sono pubbliche; il blocco mobile segue X2Rail-5 nei principi, non è un'implementazione certificata.

## I limiti che contano di più

Sono quelli da tenere presenti leggendo i risultati; l'elenco completo sta nella roadmap.

- Con più treni e la terra del motore l'autorizzazione si ricalcola dalla posizione a ogni passo. Un segnale superato a via impedita resta la fine dell'autorizzazione solo con ETCS, fuori dalla terra con apparato e dalle reti; due treni sullo stesso tratto sono segnalati, non fermati.
- Il passaggio fra RBC funziona solo su una linea, non a un nodo della rete; la rete ha un solo RBC.
- Il blocco mobile richiede l'RBC semplice e un bordo a messaggi su ogni treno, su una linea; altrove torna al blocco fisso con un avviso.
- Con la terra del motore gli itinerari di nodo sono una regola semplice, senza deviatoi né protezione di fianco.
- I passeggeri sono un modello aggregato: non scelgono il percorso né cambiano piano quando perdono una coincidenza.
- La demo Docker è stata eseguita fuori dal container l'8 novembre (83 corse, nessun fallimento imprevisto); l'immagine, con Octave e openETCS, non è stata costruita da quando la demo è stata aggiornata.

## Riprendere in mezz'ora

1. Clonare, `npm ci`, poi `npm run typecheck`, `npm run verify -- --quick` e `npm run golden -- --quick` (circa un minuto e mezzo insieme). Se qualcosa è rosso, si parte da lì.
2. Leggere `CLAUDE.md`, poi [ROADMAP.md](ROADMAP.md) (stato, decisioni, limiti) e [ARCHITETTURA.md](ARCHITETTURA.md) (flusso dei dati e punti da toccare per le modifiche frequenti).
3. Il progetto Claude del proprietario "Progetto Videogioco Treni" contiene i documenti di pianificazione (`sviluppo/`, con la copia italiana della roadmap come `passaggio-consegne.md` e questo documento come `stato-dell-arte.md`) e quelli di ricerca (`ricerca/`, con il piano dell'articolo e il confronto con Barbaro et al.).
4. Prima di ogni commit che tocca `src/` o `scripts/`: `npm run verify` completo e, per una modifica che non deve cambiare il comportamento, `npm run golden` completo. I commit sono atomici, in forma Conventional Commits, con i file aggiunti uno per uno, e vanno su `main` con il push.

## La roadmap da qui

In ordine di priorità. Niente di questo è ancora deciso: ogni passo comincia con un breve piano per il proprietario.

### 1. Consolidamento (piccolo, prima delle funzioni nuove)

- **Il repository pubblico**: le licenze ci sono (EUPL-1.2 per il codice, CC BY 4.0 per la documentazione, i dati con le licenze delle loro fonti, [NOTICE.md](../../NOTICE.md)); l'estratto dell'orario Trenitalia viene da pubbliche amministrazioni che lo pubblicano senza licenza, quindi è un dato aperto per impostazione predefinita (articolo 52 del Codice dell'amministrazione digitale). Il repository pubblico (github.com/nicola-amatucci/yutreno) parte da un unico commit; lo sviluppo prosegue in quello privato (yutreno-dev), da cui si aggiorna il pubblico.
- **Costruire ed eseguire l'immagine Docker** su una macchina con Docker: `docker build -f docker/Dockerfile -t yutreno-demo .` e `docker run --rm -p 8000:8000 -p 8766:8766 -p 8767:8767 yutreno-demo`. È l'unico modo di provare nella demo la dinamica in Octave e il bordo openETCS.
- **L'ATO di esempio aspetta quando la sua fine dell'autorizzazione gli sta dietro.** Oggi, trattenuto a un segnale superato a via impedita, rimette trazione e il bordo interviene ogni 5 s: innocuo per i risultati, rumoroso negli eventi.
- **Ritenuta e segnalazione dei due treni ovunque**: estendere la ritenuta al segnale superato a via impedita alla terra con apparato e alle reti, e decidere se due treni sullo stesso tratto debbano fermare la corsa.

### 2. Per l'articolo (ricerca)

- **La bozza dell'articolo** sul confronto con Barbaro et al. (Railway Engineering Science, 2026): la campagna blocco fisso contro blocco mobile, la campagna del modello di macchinista, CAP4 e CAP5 danno già i numeri.
- **H7 della fase 10**: il distanziamento minimo attraverso un confine fra RBC contro quello dai tempi di occupazione, e aree e confini degli RBC nell'istantanea della sala di controllo.
- **La coda confermata nella sala di controllo** per il blocco mobile.
- **La validazione delle curve del bordo** con lo strumento dell'ERA sui casi di `validation/cases.json`: il pezzo che manca perché i risultati del bordo si possano citare come qualcosa di più di un'implementazione di riferimento.
- **Una seconda linea reale contro il suo orario reale**, perché per Benevento non ne è pubblicato nessuno.

### 3. Estensioni del segnalamento (medio)

- Passaggio fra RBC a un nodo della rete, e più RBC su una rete.
- Un apparato per stazione invece che per linea, i deviatoi di nodo dentro una stazione, la geometria del deviatoio di nodo e la protezione di fianco.
- Blocco mobile con la terra con apparato, il rilevamento del treno a terra come ripiego e le sottosezioni virtuali (livello ibrido / VSS).
- Lunghezza del blocco ricavata dalla velocità massima per le linee importate (richiesta 5 della ricerca), come opzione, con 1.300 m che resta il valore predefinito.

### 4. Oltre il piano attuale (lungo)

- Passeggeri come agenti che scelgono il percorso e reagiscono a una coincidenza persa.
- Istantanee e riproduzione per l'istruttore, sessioni con più utenti.
- Iconografia del DMI conforme alle specifiche ERA.
- Un plastico guidato da YuTreno ([MODELLINO.md](MODELLINO.md)).
- Un vero modello SCMT, se le specifiche RFI diventano disponibili.
