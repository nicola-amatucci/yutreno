# Campagna di misura

> Copia italiana. Il documento di riferimento è la versione inglese [CAMPAIGN.md](../CAMPAIGN.md): nomi di file, comandi e formati seguono quella; i nomi italiani della versione 0.x (campi JSON, opzioni come `--linea` o `--bordo`) restano accettati.

Con il bordo ETCS di riferimento l'ATO di esempio consuma il 13–22% di energia in più che con la supervisione semplificata, e con il freno degradato provoca tre interventi della protezione. Da quei numeri non si capisce di chi sia il merito o la colpa. Può essere il bordo, che calcola curve diverse. Può anche essere l'ATO semplice, che insegue la velocità consentita del bordo e ne eredita la forma delle curve. La campagna serve a separare le due cause. Ripete le stesse corse incrociando due bordi, due ATO e gli scenari, con e senza i guasti nascosti, e per ogni corsa registra misure, parametri e un'impronta dei dati.

```bash
npm run campaign                                  # circa un minuto, risultati in results/campaign-reference/
npm run campaign -- --details                     # salva anche CSV ed eventi di ogni corsa
npm run campaign -- --config mia.json --output cartella
```

## La matrice

La configurazione è in [`campaigns/reference.json`](../../campaigns/reference.json):
- **bordi**: `internal`, cioè la supervisione semplificata, e `reference`, cioè l'EVC a messaggi del nucleo ([BORDO_ETCS.md](BORDO_ETCS.md));
- **ATO**: `simple` ([`examples/ato.js`](../../examples/ato.js)) e `s130` ([`examples/ato_s130.js`](../../examples/ato_s130.js)), descritti sotto;
- **scenari**: i sei scenari ETCS di `scenarios/`;
- **guasti**: ogni scenario due volte, con i suoi eventi e senza (`events: []`), così ogni corsa con guasti ha la sua gemella nominale sulla stessa linea con lo stesso treno;
- **parametri**: uno o più insiemi di valori nazionali e il modello di frenatura del treno.

In tutto ci sono 6 scenari × 2 × 2 × 2 = 48 corse per ogni insieme di parametri. Le gemelle nominali degli scenari sulla stessa linea sono la stessa corsa e devono avere lo stesso hash: è un primo controllo gratuito.

## I due ATO

L'**ATO semplice** usa solo le velocità della supervisione. Tiene la velocità consentita meno 2 m/s, si ferma 25 m prima della fine dell'autorizzazione e ferma la testa sulla palina con 0,45 m/s².

L'**ATO Subset-130** usa i dati che il bordo mette a disposizione dell'ATO nell'osservazione del controllore ([API.md](API.md#dati-del-bordo-per-lato-subset-130)). Non insegue la curva consentita, ma pianifica da sé su tre livelli:
- **una curva di frenatura propria** verso ogni riduzione dell'MRSP e verso la fine dell'autorizzazione, con la stessa decelerazione di progetto dell'ATO semplice. La curva è corretta per la pendenza peggiore, valutata con 2 s di anticipo e mai oltre metà di `A_BRAKE_SAFE`;
- **una curva di intervento ricostruita** con i soli dati del Subset-130 (`A_BRAKE_SAFE`, `GRADIENT`, `T_BE_REACT`, `T_TRACTION`) più 7 s di guardia. Il treno non la supera mai. Quando la differenza di velocità è piccola sono i tempi di reazione, non la decelerazione, a decidere dove frenare, e qui la curva propria da sola arriverebbe tardi;
- **una guardia** sul limite annunciato dal bordo: se alla velocità attuale il treno raggiungerebbe `N_LOC_EBI` entro i tempi di reazione più 3 s, frena a fondo con il freno di servizio. Entro altri 4 s toglie soltanto la trazione.

Fermate, vigilanza e regolatore di velocità sono gli stessi dell'ATO semplice, così la differenza fra i due misura solo l'effetto dei dati del Subset-130. Senza quei dati, cioè col blocco automatico, con l'API versione 1 o con un bordo che non li fornisce, l'ATO Subset-130 si comporta come l'ATO semplice.

## Uscite

Tutti i file sono deterministici, tranne `metadata.json`:

| File | Contenuto |
| :-- | :-- |
| `runs.csv` | una riga per corsa: caso, linea, guasti, bordo, ATO, parametri, esito; tempo di percorrenza e ritardo; energia di trazione, recuperata e netta; fermate valide e mancate, errore medio, massimo e finale di fermata; avvisi (W), frenature di servizio (SBI), interventi (EBI), frenature per radio, urgenze, superamenti della fine dell'autorizzazione, guardie dell'ATO; massimo superamento del limite e strappo massimo; decelerazioni del treno e pendenze della linea; impronte dei valori nazionali, degli ingressi e dell'uscita |
| `summary.csv` | totali per parametri × guasti × bordo × ATO |
| `determinism.csv` | prove di ripetibilità, vedi sotto |
| `parameters.json` | la configurazione e, per ogni combinazione, valori nazionali completi, dati del treno e pendenze della linea |
| `metadata.json` | commit del codice e presenza di modifiche non registrate, versione di Node, durata reale, impronta di `runs.csv` |

L'**impronta dell'uscita** (`hash_output`) è lo SHA-256 del CSV della corsa (`Simulation.csv()`, un campione ogni 0,5 s con 34 grandezze) seguito dal registro degli eventi in JSON. Due corse con la stessa impronta hanno prodotto gli stessi dati, campione per campione. L'**impronta degli ingressi** (`hash_inputs`) riassume linea, treno, condizioni, scenario, codice del controllore e periodo di controllo. Insieme permettono a chiunque di rifare una corsa e confrontare l'esito con quello pubblicato senza scambiarsi i dati grezzi.

Le impronte contengono anche testi (nomi di linee e treni, messaggi degli eventi): la traduzione di YuTreno in inglese nella versione 0.2 le ha cambiate senza cambiare alcun numero. Il confronto con le corse della versione 0.1 è stato fatto riga per riga sulle colonne numeriche del CSV, che sono identiche.

## Determinismo

Dopo la matrice la campagna ripete una corsa: freno degradato, bordo di riferimento, ATO Subset-130. La ripete in quattro modi:
1. una seconda volta nello stesso processo;
2. in un processo nuovo, per escludere stato condiviso nella memoria;
3. con lo stesso bordo di riferimento come **processo esterno** collegato via `exec:` (`examples/onboard/onboard_stdio.ts`), che scambia con il motore richieste e risposte JSON su stdin/stdout a ogni ciclo di 100 ms;
4. una seconda volta con il bordo esterno.

Le prime tre e la quarta devono dare la stessa impronta, altrimenti il comando esce con errore. In questa versione danno tutte la stessa impronta anche della corsa con il bordo nel nucleo. Il canale esterno non introduce quindi nessuna differenza, nemmeno di arrotondamento: i numeri JSON si rileggono identici in doppia precisione.

## Parametri

Ogni insieme di parametri ha un nome, un modello di frenatura e valori nazionali che sostituiscono quelli predefiniti (`DEFAULT_NATIONAL` in `src/core/evc.ts`, con i margini di velocità del Subset-026 §A.3.1). Per esempio:

```json
{ "name": "maximum-margins", "braking_model": "gamma",
  "national_values": { "dV_ebi_min": 15, "dV_sbi_min": 10, "dV_warning_min": 5, "T_driver": 6 } }
```

I valori nazionali arrivano al bordo nella prima richiesta, quindi valgono per il bordo di riferimento e per i bordi esterni. La supervisione interna ha margini propri e non li usa: nelle sue righe `hash_national_values` è vuoto.

Il treno del bordo di riferimento ha decelerazioni costanti, cioè il **modello gamma** del Subset-026 §3.13. Il modello lambda, con la percentuale di peso frenato convertita in decelerazioni, non è implementato e la campagna rifiuta un insieme che lo chieda. Le pendenze non sono un parametro della campagna ma della linea. Per ogni corsa `runs.csv` riporta la salita massima, la discesa massima e la pendenza media in valore assoluto, e `parameters.json` contiene il profilo completo attraverso la linea dello scenario.

## Risultati

Con l'insieme `base`, la campagna dà questi totali sulle sei corse di ogni cella:

| Guasti | Bordo | ATO | Energia netta (kWh) | W | SBI | EBI | Superate |
| :-- | :-- | :-- | --: | --: | --: | --: | :-: |
| no | interno | semplice | 838,2 | 0 | 0 | 0 | 6/6 |
| no | riferimento | semplice | 987,8 | 0 | 0 | 0 | 6/6 |
| no | interno | Subset-130 | 825,3 | 0 | 0 | 0 | 6/6 |
| no | riferimento | Subset-130 | 833,4 | 0 | 0 | 0 | 6/6 |
| sì | interno | semplice | 848,6 | 3 | 0 | 0 | 4/6 |
| sì | riferimento | semplice | 1001,5 | 4 | 5 | 3 | 4/6 |
| sì | interno | Subset-130 | 827,4 | 1 | 0 | 0 | 4/6 |
| sì | riferimento | Subset-130 | 836,0 | 0 | 0 | 0 | 4/6 |

Dal 6 novembre 2026 il treno comandato tiene le porte aperte fino all'orario di partenza, come i treni di servizio; prima si chiudevano dopo la sosta minima di 20 s e il treno partiva in anticipo. Tutti i totali sono scesi di 2,7–5,1 kWh, con ogni probabilità perché il treno, partendo all'orario, si avvicina meno al merci che lo precede e frena meno. Tempi di percorrenza, interventi ed esiti non sono cambiati, e nemmeno l'impronta della verifica di determinismo, calcolata su una corsa che la modifica non tocca.

Dal 7 novembre 2026 il merci che precede sulle due linee degli scenari è un treno della corsa come i treni di servizio, con la sua dinamica, i segnali, la supervisione e il guidatore automatico, fermo sulla linea quando la corsa parte (decisione 12, [MODELLO.md](MODELLO.md#vigilanza-fermate-e-treno-che-precede)); prima era un treno cinematico che correva senza segnali. È più lento, e il treno comandato lo segue: ogni cella impiega 820–900 s in più sulle sue sei corse e consuma da 11,8 a 35,2 kWh in più. Con i guasti il bordo di riferimento con l'ATO semplice ha ora cinque avvisi, due frenature di servizio e due interventi invece di quattro, tre e tre: frenature e interventi tutti nel freno degradato, un avviso nelle foglie. Gli esiti, le due percentuali qui sotto e le conclusioni non sono cambiati; l'impronta della verifica di determinismo sì (`a41b59b99b29cfae` invece di `06d2b24225a458fd`), perché quella corsa ha un treno che precede. Dall'8 novembre il motore conta anche un segnale superato a via impedita ([segnalamento.md](progetto/segnalamento.md#superamenti-e-autorizzazione-ricalcolata-dalla-posizione)): nel freno degradato il bordo di riferimento con l'ATO semplice passa i segnali 12 e 13 dietro il merci, ora due superamenti della fine dell'autorizzazione in `runs.csv`. Dal 9 novembre il motore trattiene anche un treno al segnale che ha superato a via impedita finché il segnale non si libera (decisione 16): in quella corsa il treno si ferma dietro i segnali 12 e 13 e aspetta che il merci li liberi, quindi arriva 70 s più tardi (1374,7 s invece di 1304,3 s) e la sua cella ha 1001,5 kWh, quattro avvisi, cinque frenature di servizio e tre interventi invece di 989,9 kWh, cinque, due e due. Ogni altra corsa e l'impronta della verifica di determinismo non sono cambiate.

Senza guasti, con l'ATO semplice il bordo di riferimento costa il 17,9% in più della supervisione interna. Con l'ATO Subset-130 costa l'1,0% in più. Circa il 95% della differenza (141,5 su 149,6 kWh) dipende quindi dall'ATO che insegue la curva consentita, non dal bordo. Con i guasti, i tre interventi e le cinque frenature di servizio del bordo di riferimento spariscono con l'ATO Subset-130, che con quel bordo non riceve nemmeno avvisi. In entrambi i casi i tempi di percorrenza restano entro pochi secondi.

Le due corse fallite di ogni cella con guasti sono le stesse per tutti gli abbinamenti: le foglie e il freno degradato portano a una fermata mancata. Sono guasti che a bordo non si vedono e che nessuno dei due ATO prova a stimare.

I numeri valgono per questo ATO e per questo bordo di riferimento, che non è validato contro lo strumento ERA ([VALIDAZIONE_CURVE.md](VALIDAZIONE_CURVE.md)). Non vanno letti come una proprietà degli ATO o dei bordi in generale.

## Campagna del servizio

La campagna di riferimento confronta bordi e ATO su un treno. La campagna del servizio pone invece le domande di un orario: come cambiano puntualità, attese, affollamento ed energia con il numero di treni, il distanziamento e la domanda di passeggeri.

```
npm run service-campaign -- [--config campaigns/services.json] [--output <cartella>]
```

`campaigns/services.json` elenca `lines` (id predefiniti o percorsi di un `line.json`, relativi al file), `trains`, `headways_s`, `directions`, `signalling` e `demand_per_station_per_hour` (persone all'ora in partenza da ogni stazione, distribuite in parti uguali sulle altre, 0 per nessun passeggero), con `arrivals`, `seed` e `on_time_s` (predefinito 180 s). Ogni combinazione è una configurazione di scenario ([CONFIGURAZIONE_SCENARIO.md](CONFIGURAZIONE_SCENARIO.md)) con il treno comandato e i treni di servizio guidati da `examples/ato.js`. L'esempio esplora Valle Lauro e la linea reale Salerno – Mercato San Severino con 2 e 4 treni ogni 10 e 15 minuti nei due versi e 0, 600 e 1200 passeggeri all'ora per stazione: 24 corse in circa quattro minuti.

`runs.csv` ha una riga per corsa: i parametri; treni arrivati, interventi e superamenti; ritardo medio e massimo dei servizi all'ultima fermata e quota in orario; passeggeri saliti, lasciati a terra, attesa media e massima, viaggio, ritardo per passeggero, coefficiente di riempimento più alto, passeggeri-km; il tempo trattenuto dal segnalamento di tutti i treni e del treno trattenuto più a lungo ([CAPACITA.md](CAPACITA.md#il-tempo-in-cui-il-segnalamento-trattiene-il-treno)); energia netta ed energia per passeggero-km; la fine della corsa e un'impronta della corsa. `determinism.csv` ripete la prima corsa. Quando le corse differiscono solo per il distanziamento, `thresholds.csv` dà per ogni gruppo il distanziamento più piccolo dell'esplorazione da cui nessun treno è più trattenuto dal segnalamento. La domanda dura per tutta la corsa, quindi le persone arrivate dopo l'ultimo treno restano in banchina e non entrano nelle misure di chi è salito.

Nell'esempio, su Valle Lauro il ritardo cresce solo con 1200 passeggeri all'ora e treni ogni 15 minuti, quando le soste si allungano e qualcuno resta a terra; su Salerno – Mercato San Severino, con nove stazioni, la stessa domanda riempie i treni e i servizi con 4 treni ogni 10 minuti arrivano in media con un minuto di ritardo. Questi numeri dipendono dai valori predefiniti dichiarati del modello dei passeggeri ([PASSEGGERI.md](PASSEGGERI.md)) e sono un esempio d'uso, non un risultato su quelle linee.

`campaigns/headway-sweep.json` è un'esplorazione di questo tipo: due treni nello stesso senso su Valle Lauro, il secondo da 180 a 300 s dopo il primo, con il blocco automatico e con l'ETCS. Il secondo treno è trattenuto dal segnalamento per 66 s a 180 s con il blocco automatico e 64 s con l'ETCS, circa un secondo in meno per ogni secondo di distanziamento in più, e non più da 245 s in entrambi i casi; il ritardo all'arrivo è lo stesso in ogni corsa, perché il margine dell'orario assorbe l'attesa (20 corse in circa 25 s).

Due campi facoltativi confrontano il distanziamento dei treni: `onboard` (il bordo ETCS di ogni treno) e `spacing` (una lista di `fixed_block` e `moving_block`, [BLOCCO_MOBILE.md](BLOCCO_MOBILE.md)); con loro `runs.csv` e `thresholds.csv` hanno le colonne `onboard` e `spacing`, senza le corse e le colonne sono quelle di prima. `campaigns/block-comparison.json` esplora gli stessi due treni da 120 a 300 s con il bordo di riferimento e i due distanziamenti: il secondo treno non è più trattenuto da 230 s con il blocco fisso e da 200 s con il blocco mobile (24 corse in circa 70 s; [CAPACITA.md](CAPACITA.md#blocco-mobile)).

`verify-scenario-config` (`SCF5`) esegue una piccola esplorazione e ne controlla misure e determinismo.

## Verifiche

`scripts/verify-ato-s130.ts` controlla:
- che le versioni dell'osservazione mantengano il loro contenuto (la 1 senza `etcs_ato`, la 2 uguale alla 3 con i nomi italiani);
- che `N_LOC_EBI` sia il punto in cui interviene davvero la protezione. Un macchinista che tiene la velocità costante e non frena mai, con un freno quasi inefficace perché la frenatura di servizio non lo rallenti, viene fermato entro 0,2 m dal punto annunciato con la supervisione interna ed entro 1,3 m con il bordo di riferimento;
- che il bordo esterno fornisca gli stessi dati per l'ATO di quello del nucleo;
- che l'ATO Subset-130 guidi senza interventi su tutte le linee e che il suo consumo dipenda dal bordo meno di un terzo di quello dell'ATO semplice.
