# Validazione delle curve del bordo di riferimento

> Copia italiana. Il documento di riferimento è la versione inglese [CURVE_VALIDATION.md](../CURVE_VALIDATION.md): nomi di file, comandi e formati seguono quella; i nomi italiani della versione 0.x (campi JSON, opzioni come `--linea` o `--bordo`) restano accettati.

Il bordo di riferimento (`src/core/evc.ts`) calcola le curve di supervisione secondo l'impostazione del Subset-026 §3.13, con semplificazioni dichiarate. Finché nessuno le confronta con un calcolo indipendente, i suoi risultati valgono solo dentro YuTreno. Il calcolo indipendente di riferimento è lo strumento ERA delle curve di frenatura, il foglio di calcolo (XLSM) che l'Agenzia pubblica insieme al suo manuale. Questa pagina descrive come confrontarli caso per caso e a che punto è il lavoro.

**Stato al 5 novembre 2026: avviata.** I casi sono definiti e i punti di YuTreno si generano con un comando. Il modulo per i valori dello strumento ERA è pronto ed è vuoto: va riempito con lo strumento, che dalla rete di lavoro di YuTreno non è raggiungibile. Lo script di confronto calcola già le differenze appena il modulo contiene dei valori.

## I casi

I casi stanno in [`validation/cases.json`](../../validation/cases.json). Sono tutti **a bersaglio singolo**: un solo obiettivo davanti al treno, pendenza costante, profilo statico costante fino all'obiettivo. Così ogni differenza si può attribuire a una sola parte del calcolo.

| Caso | Bersaglio | Pendenza |
| :-- | :-- | :-: |
| `EOA-level` | fine dell'autorizzazione, punto di pericolo 50 m oltre, rilascio 15 km/h | 0 ‰ |
| `EOA-down-10` | come sopra | −10 ‰ |
| `EOA-up-10` | come sopra | +10 ‰ |
| `EOA-down-25` | come sopra | −25 ‰ |
| `V80-level` | riduzione da 160 a 80 km/h | 0 ‰ |
| `V80-down-10` | riduzione da 160 a 80 km/h | −10 ‰ |
| `V40-level` | riduzione da 160 a 40 km/h | 0 ‰ |

Il treno è uno solo, con il modello gamma:
- `A_brake_emergency` = 1,3 m/s² e `A_brake_service` = 1,0 m/s², costanti con la velocità;
- `T_brake_emergency` = 1,6 s, `T_brake_service` = 1,2 s, `T_traction_cut_off` = 0,5 s;
- `M_rotating` = 6%, `L_TRAIN` = 150 m, `V_MAXTRAIN` = 160 km/h.

I valori nazionali sono quelli predefiniti del bordo (`DEFAULT_NATIONAL`):
- margini di velocità del Subset-026 §A.3.1: `dV_ebi` 7,5–15 km/h, `dV_sbi` 5,5–10 km/h e `dV_warning` 4–5 km/h, fra 110 e 210 km/h (140 km/h per l'avviso);
- `T_driver` = 4 s e `T_warning` = 2 s.

Gli errori di odometria sono azzerati, perché lo strumento ragiona sulla posizione esatta. Le velocità di confronto vanno da 20 a 160 km/h a passi di 10.

## Generare i punti di YuTreno

```bash
npx tsx scripts/curve-validation.ts                 # results/curve-validation/yutreno_points.csv
```

Per ogni caso lo script fa quello che farebbe una corsa vera. Avvia il bordo con la posizione memorizzata e gli manda un messaggio 3 con i pacchetti 15, 27 e 21. Poi, per ogni velocità, cerca la distanza dal bersaglio a cui ciascuna curva vale quella velocità:
- per **EBI, SBI, W e P** usa le velocità che il bordo pubblica sul DMI, cercando la posizione per bisezione;
- per **I** usa l'indicazione;
- per **EBD e SBD** usa una funzione del bordo che risale la curva di frenatura sulla pendenza.

Le distanze sono in metri prima del bersaglio: prima della fine dell'autorizzazione o del punto di riduzione della velocità. La EBD dei casi EOA porta al punto di pericolo, quindi a bassa velocità ha distanze negative, oltre la fine dell'autorizzazione. Una cella vuota vuol dire che la curva non raggiunge quella velocità prima del bersaglio, oppure che il bordo non usa quella curva. È il caso della SBD per le riduzioni di velocità e dell'EBI a 20–30 km/h nei casi EOA, che cade oltre la fine dell'autorizzazione, dove il bordo scatta.

`scripts/verify-curve-validation.ts` controlla lo strumento stesso. In piano EBD, EBI e SBD coincidono entro 5 cm con le formule in forma chiusa, le curve sono nell'ordine atteso e in discesa si allontanano dal bersaglio.

## Riempire i valori dello strumento ERA

```bash
npx tsx scripts/curve-validation.ts --era-template    # crea validation/era/era_points.csv, se non esiste
```

Il modulo ha le stesse righe e colonne dei punti di YuTreno: caso, velocità e distanza dal bersaglio per EBD, SBD, EBI, SBI, W, P e I. Per ogni caso si impostano nello strumento il treno, i valori nazionali e il bersaglio descritti sopra, e si riportano nel modulo le distanze dal bersaglio a cui ciascuna curva vale la velocità della riga. Le grandezze dello strumento hanno i nomi del Subset-026, gli stessi di `validation/cases.json`.

Lo strumento calcola tutto il modello del Subset-026, compreso quello che il bordo di riferimento semplifica. Per ridurre le differenze a quelle che si vogliono misurare conviene impostare:
- fattori di correzione delle decelerazioni neutri: `Kdry_rst` = 1, `Kwet_rst` = 1, `M_NVAVADH` = 0;
- nessuna curva di guida;
- velocità di rilascio fissa a 15 km/h invece che calcolata.

Ciò che lo strumento non permette di neutralizzare va annotato nella colonna o in calce al modulo.

## Confronto

```bash
npx tsx scripts/curve-validation.ts --era validation/era/era_points.csv
```

Lo script scrive `results/curve-validation/differences.csv` con la differenza YuTreno − ERA in metri per ogni curva e velocità. Una differenza positiva vuol dire che YuTreno chiede di frenare prima, cioè è più prudente. Sulla console stampa lo scarto massimo per caso e per curva.

## Differenze attese

Le semplificazioni del bordo di riferimento sono note. Il confronto serve a misurarne l'effetto e a scovare quelle che non lo sono. Ecco cosa ci si aspetta, curva per curva.

**EBD e SBD.** Il bordo usa le decelerazioni del treno senza fattori di correzione. Con decelerazioni costanti e fattori neutri le curve dovrebbero coincidere a meno della correzione di pendenza. Il bordo la calcola come g·pendenza/(1000 + 10·`M_rotating`), cioè con la massa rotante nota. Una differenza che cresce con la pendenza indica una formula diversa.

**EBI.** Il bordo usa un solo tempo morto, `T_traction_cut_off` + `T_brake_emergency`, percorso alla velocità attuale. Il Subset-026 distingue invece il tempo in cui la trazione resta e il tempo di reazione del freno. Durante il primo considera anche l'accelerazione stimata del treno e la compensazione dell'errore di velocità, che qui mancano. Ci si aspetta quindi un EBI più vicino al bersaglio di quello dello strumento, cioè meno prudente, con differenze che crescono con la velocità e con l'accelerazione ipotizzata. Per le riduzioni di velocità il bordo ferma la EBD a V_bersaglio + dV_ebi(V_bersaglio): è un punto da controllare in modo specifico.

**SBI, W, P e I.** Verso la fine dell'autorizzazione:
- la SBI si ricava dalla SBD con `T_brake_service`, oppure dalla EBD con i tempi d'urgenza più quelli di servizio, e vale la più restrittiva delle due;
- W e P aggiungono `T_warning` e `T_driver`;
- I aggiunge un anticipo `T_indication` = max(0,8·`T_brake_service`, 5 s) + `T_driver`.

Verso una riduzione di velocità tutte e quattro vengono dalla EBD del bersaglio, quella che arriva a V_bersaglio + dV_ebi(V_bersaglio): SBI = EBI − V·`T_brake_service`, poi W, P e I come sopra, nessuna sotto i limiti di tetto del bersaglio.

Lo strumento segue la stessa struttura: le differenze dovrebbero ridursi a quelle che le curve ereditano da EBD ed EBI.

**Tetto.** I margini di velocità sono interpolati linearmente fra i valori minimi e massimi, come nel Subset-026 §A.3.1.

## Quando è completa

La validazione è completa quando:
1. copre tutti i casi e tutte le curve;
2. riconduce ogni differenza oltre 1 m a una delle semplificazioni elencate sopra, oppure la corregge nel bordo;
3. riporta, per ogni curva, lo scarto massimo e la sua causa, e registra l'esito nella colonna `validation_judgement` della matrice di tracciabilità per le righe del §3.13.

`validation/era/era_points.csv` riempito va nel repository insieme a questa pagina: è parte dei dati aperti.
