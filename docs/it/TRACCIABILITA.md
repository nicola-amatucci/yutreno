# Tracciabilità

> Copia italiana. Il documento di riferimento è [traceability/README.md](../traceability/README.md).

La cartella `docs/traceability/` contiene due file:

- `matrix.csv` confronta YuTreno con il Subset-026 v4.0.0 (ERTMS/ETCS System Requirements Specification), con il Subset-130 v1.0.0 (interfaccia fra bordo ETCS e ATO), con il Subset-039 v4.0.0 (passaggio fra RBC) e, per il blocco mobile, con quattro requisiti della Moving Block Specification di X2Rail-5 (`X2R5-MB-*`), che non è un documento della TSI. In fondo ci sono anche le righe del lato terra con apparato: i telegrammi EULYNX usati fra apparato ed enti, le interfacce apparato–RBC e apparato–posto centrale, che EULYNX non pubblica e YuTreno inventa, e la Tabella delle Condizioni ricostruita (vedi [TERRA.md](TERRA.md)). Le ultime righe registrano le fonti dei modelli di esercizio: topologia della rete, capacità (UIC 406), cambio di percorso, giri del materiale e coincidenze, importazione dell'infrastruttura, configurazione degli scenari e modello dei passeggeri. Serve a sapere cosa del codice vale rispetto allo standard, cosa è semplificato e cosa manca, prima di scrivere qualsiasi affermazione che lo usi.
- `tests.csv` elenca, per ogni requisito, i test che lo controllano: una riga per coppia requisito–test, con lo script e il titolo del test. Lo genera `scripts/traceability.ts` dai marcatori `@test` degli script di verifica e non va modificato a mano.

Il testo di riferimento sono i PDF ufficiali ERA della v4.0.0, quella della TSI 2023. In Italia è in esercizio la Baseline 3 (v3.6.0). Nelle parti che contano qui le differenze più visibili riguardano i tempi di frenatura, che nella v4.0.0 separano la reazione (`T_be_react`) dalla costruzione e introducono la riduzione per bersaglio (A.3.12). Per un confronto con la v3.6.0 quelle righe vanno riviste. Il rapporto fra YuTreno e ciascuno standard è discusso in [STANDARD.md](STANDARD.md).

## Come è fatta la matrice

La matrice ha due livelli, per non diventare ingovernabile.

**Per sezione**: i capitoli 3, 4, 5, 7 e 8, una riga per ogni sezione fino al terzo livello di numerazione, presa dai titoli della specifica. Basta a vedere a colpo d'occhio cosa c'è e cosa manca.

**Clausola per clausola**: solo il §3.13, nelle parti che il bordo di riferimento dichiara di implementare (curve di frenatura, limiti di supervisione, comandi), e le variabili dei pacchetti 6 e 11 del Subset-130. È lì che si decide la validità delle affermazioni sul bordo.

Ogni riga ha queste colonne:

| Colonna | Contenuto |
| :-- | :-- |
| `id` | identificativo della riga, usato dai marcatori dei test (per esempio `S026-3.13.8.3.2-c` per una clausola, `S130-Packet-6-N_LOC_EBI` per una variabile) |
| `specification`, `level`, `reference`, `title` | da dove viene il requisito |
| `component` | lato terra, bordo di riferimento, protocollo o motore |
| `status` | lo stato, vedi sotto |
| `code_location` | dove si trova nel codice |
| `tests` | i test che la controllano (generata; `via sub-clauses` per una sezione coperta attraverso le sue clausole) |
| `deviation` | lo scostamento rispetto al testo |
| `relevant_for_results` | se la riga influisce sui numeri prodotti dal bordo di riferimento e dalla campagna |
| `validation_judgement` | colonna vuota per la validazione della riga sul testo della specifica da parte di un esperto del dominio |

Gli stati sono cinque:
- **implemented** (implementato): fa quello che chiede la clausola, nei limiti dei dati che riceve;
- **simplified** (semplificato): c'è, ma con scostamenti dichiarati che non dovrebbero cambiare la sostanza;
- **divergent** (divergente): c'è, ma fa una cosa diversa dal testo, in un modo che cambia i numeri;
- **missing** (mancante): non c'è;
- **out of scope** (fuori ambito): non riguarda un banco di livello 2 in supervisione completa (Euroloop, infill, sistemi nazionali, registrazione giuridica, DMI).

## Test e tracciabilità

Ogni blocco di test che controlla un requisito porta un marcatore nel suo script:

```ts
// @test S16: EBI position before the EBD by the reaction time, N_LOC_EBI [S026-3.13.9.3.2.12-c, S026-3.13.6.2.2.3-c, S130-Packet-6-N_LOC_EBI]
```

`npx tsx scripts/traceability.ts` raccoglie i marcatori di tutti gli `scripts/verify-*.ts`, scrive `tests.csv` e riempie la colonna `tests` della matrice. Controlla anche che:
- ogni requisito citato in un marcatore esista nella matrice;
- ogni riga **implementata** o **semplificata** abbia almeno un test, sulla riga stessa oppure, per una sezione, su una delle sue clausole.

`npm run verify` comprende `verify-traceability`, che fallisce se una di queste condizioni non vale o se i due file non sono aggiornati. Una modifica che aggiunge una funzione senza test, o un test che cita un requisito sbagliato, non passa le verifiche.

La maggior parte dei test di requisito è in `scripts/verify-subset026.ts`: 25 blocchi che guidano il bordo di riferimento ciclo per ciclo con telegrammi e messaggi costruiti a mano, e confrontano il suo comportamento con la clausola, in forma chiusa dove la clausola dà una formula (EBD e SBD con la correzione per pendenza e masse rotanti, EBI con il tempo di costruzione della frenatura, SBI1/SBI2, margini di tetto). Gli altri sono negli script di sistema (`verify-onboard`, `verify-trackside`, `verify-ato-s130`, `verify-scenarios`, `verify-curve-validation`), marcati con le righe che coprono. Oggi 132 test marcati in 18 script coprono tutte le 205 righe implementate o semplificate.

Un test mostra che YuTreno fa ciò che YuTreno dichiara, con le semplificazioni della matrice. Non mostra la conformità alla specifica: servirebbero le sequenze di prova del Subset-076 su un prodotto, fuori dall'ambito di un simulatore di ricerca.

## Cosa dice

Su 231 sezioni dei capitoli 3, 4, 5, 7 e 8: 3 implementate, 77 semplificate, 9 divergenti, 122 mancanti, 20 fuori ambito. È il ritratto onesto di un bordo che copre la supervisione completa al livello 2 e quasi nient'altro: non ha inizio missione, modi oltre a SB, FS, TR e PT, gestione delle versioni, codifica a bit dei messaggi, né funzioni speciali.

Nel dettaglio del §3.13, su 57 clausole: 20 implementate, 19 semplificate, 3 divergenti, 15 mancanti. Le divergenti, e le mancanti che cambiano le curve, sono quelle da guardare per prime, perché toccano i risultati.

1. **Pendenza e lunghezza del treno (3.13.4.2.1, divergente).** La specifica prende la pendenza più sfavorevole sotto tutto il treno fittizio. Il bordo usa la pendenza nel punto della testa. In una discesa che comincia dopo un tratto in piano il bordo è **meno prudente**.
2. **Tempi d'urgenza (3.13.9.3.2.3 e .6, divergenti).** La specifica divide il tempo fra trazione ancora presente e frenatura che si costruisce, e i due tempi si sovrappongono. Il bordo li somma. Il tempo morto è più lungo, quindi il bordo è **più prudente**.
3. **Accelerazione stimata e errore di velocità (3.13.9.3.2.1, .8, .9, mancanti).** Quando il treno accelera verso un bersaglio il bordo è **meno prudente**.

Due divergenze sono state corrette. I limiti SBI2, W, P e I di una riduzione di velocità (3.13.9.3.3.2, 3.13.9.3.4.1, 3.13.9.3.5.1, 3.13.9.3.6.1) venivano da curve verso V_target + dV_sbi, V_target + dV_warning e V_target, e la velocità consentita risultava più bassa e anticipata del testo; ora vengono dalla EBD del bersaglio, verso V_target + dV_ebi, spostata dei tempi, come per la fine dell'autorizzazione. Il tempo di indicazione (3.13.9.3.6.2) ora comprende T_driver. Il test S25 di `verify-subset026` controlla entrambe le cose in forma chiusa.

La correzione riguarda direttamente la campagna di misura, perché l'ATO semplice insegue la velocità consentita del bordo. I numeri sono in [CAMPAGNA.md](CAMPAGNA.md): con il bordo di riferimento l'ATO semplice ora consuma un po' di più (una curva consentita più alta e più tarda prima di ogni riduzione), mentre l'ATO Subset-130, che pianifica sull'EBI, non cambia. La conclusione della campagna resta la stessa. I risultati valgono comunque **per questo bordo**, che non è ancora validato con lo strumento ERA.

## Come controllarla

La matrice è un'interpretazione, scritta leggendo il codice e il testo: va controllata. L'ordine consigliato parte dalle righe con `relevant_for_results = yes` e stato divergente, poi semplificato. Per ciascuna:
1. leggere la clausola nel PDF della specifica;
2. leggere il punto del codice indicato in `code_location` e i test in `tests`;
3. scrivere in `validation_judgement` se lo stato è giusto, oppure cosa cambiare.

Il CSV si apre con qualsiasi foglio di calcolo. Se una riga cambia stato, va cambiata nella matrice e nel codice nello stesso commit, e va rieseguito `npx tsx scripts/traceability.ts`.
