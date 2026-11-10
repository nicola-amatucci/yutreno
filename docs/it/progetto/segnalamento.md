# Blocco, supervisione ETCS interna e SCMT

> Copia italiana di [signalling.md](../../design/signalling.md). In caso di differenze fa fede il testo inglese.

## Scopo

`src/core/signalling.ts` fornisce il segnalamento che ogni corsa ha a meno che si scelga un bordo a messaggi: un blocco automatico a tre aspetti, la logica RBC semplice che trasforma il blocco in un'autorizzazione al movimento ETCS, e due supervisioni di bordo semplificate, una per ETCS livello 2 e una che sta per l'SCMT. È il segnalamento originale di YuTreno e resta il predefinito perché è veloce, robusto e coincide con i valori di riferimento dei controlli.

## Blocco e treno che precede

Il treno che precede è un treno merci fra i treni della corsa (`leader.ts`, [MODELLO.md](../MODELLO.md#vigilanza-fermate-e-treno-che-precede)), quindi con lui una corsa ha sempre più treni: `updateSignals()` imposta ogni segnale dall'occupazione delle sezioni di blocco da parte di tutti (`blockOccupiedBy()`): rosso se la sezione che protegge è occupata, giallo prima di un rosso, verde altrimenti; i segnali di partenza restano rossi fino all'ora di partenza. Un treno da solo sulla linea usa `updateInterlocking()`, la stessa regola senza occupazione. Con ETCS la stessa logica dà l'autorizzazione al movimento: fino all'inizio della prima sezione che il blocco renderebbe rossa, con il punto pericoloso `ETCS.overlap` = 50 m oltre.

### Superamenti e autorizzazione ricalcolata dalla posizione

Con più treni ogni treno riceve di nuovo la sua autorizzazione a ogni passo dalla propria posizione (`authority()`, `movingAuthority()`): il primo segnale rosso *davanti alla testa*. Quando la testa ha passato un segnale a via impedita, quel segnale le sta dietro e l'autorizzazione successiva va oltre, fino al rosso seguente, anche se la sezione che il segnale protegge è ancora occupata. Il controllo della fine dell'autorizzazione (testa oltre di più di 0,5 m) vede quindi un superamento solo se avviene in un solo passo. Per questo il motore conta anche, una volta, la testa che va 0,5 m oltre un segnale ancora a via impedita per quel treno (`atDangerFor()` in `traffic.ts`: trattenuto per la sua partenza o per l'orientamento del binario unico, oppure a protezione di una sezione occupata da un altro treno o di un tratto interrotto; con il blocco mobile solo da un treno dell'altro verso o da un tratto interrotto), con un evento `EMG` *The head of the train has passed signal … at danger*. Non lo conta con il blocco automatico, che ha un suo controllo dei segnali rossi, con la terra con apparato, le cui autorizzazioni vengono dalla terra, né su una rete.

Con ETCS il segnale resta poi la fine dell'autorizzazione di quel treno finché è a via impedita per lui (`TrainRun.passedAtDanger`, motivo `signal passed at danger`): la fine dell'autorizzazione sta dietro la testa, la supervisione o il bordo intervengono, e il treno riparte solo quando il segnale si libera, cioè quando la sezione che protegge è libera e nulla lo trattiene. Il superamento non si conta di nuovo mentre il treno è trattenuto, ma il bordo interviene di nuovo ogni volta che il treno si muove. Lo ha scelto la decisione 16 ([ROADMAP.md](../ROADMAP.md)). Lo mostrano due casi: un odometro che segna il 10 % in meno (`verify-onboard` O10), e un macchinista che non frena mai con il bordo di riferimento (O6), fermo 3 cm oltre il segnale che protegge il merci davanti e poi ancora in trazione: trattenuto, resta ad almeno 566 m dal merci; senza la ritenuta gli finiva addosso.

Un segnale che torna a via impedita davanti a un treno non ha bisogno di una regola sua. Il caso che la suggeriva, il merci di `radio-loss` con il bordo di riferimento bloccato dietro un segnale di partenza, è comparso con una prima versione del controllo che leggeva la ritenuta di partenza del treno dietro (`heldSignals` guarda il treno più vicino prima del segnale); `atDangerFor` legge quella del treno stesso, e con questa quella corsa non cambia affatto.

### Due treni sullo stesso tratto

Nel motore niente impedisce a due treni di finirsi addosso: deve tenerli separati il segnalamento. Con più treni il motore controlla a ogni passo se due treni stanno sullo stesso tratto di linea fra due stazioni, dove la linea ha un solo binario (`traffic.sameStretch`), e quando succede scrive un evento `EMG` per ciascuno, *On the same stretch of line as train … between … and …*. Le stazioni sono escluse, perché lì ogni verso ha il suo binario. L'evento si limita a segnalare: i treni non vengono fermati. O6 controlla che compaia quando la ritenuta è spenta.

## Supervisione ETCS interna

`supervise(cx, pos, v)` calcola la supervisione della testa in `pos` con velocità `v`:

- il **tetto** è il limite di linea più restrittivo sotto il treno (`lineLimitTrain`), con margini di avviso e d'intervento (`dWar`, `dEbi`) modellati su quelli del Subset-026;
- i **bersagli** sono le riduzioni del limite di linea entro l'orizzonte e la fine dell'autorizzazione; per ciascuno `vForDist(d, vt, a, T)` dà la velocità da cui una decelerazione `a` dopo un tempo morto `T` raggiunge `vt` entro `d`;
- le curve sono P (decelerazione di servizio, `Tbs + Tdrv`), W (`Tbs + 2 s`), SBI (`Tbs`) ed EBI (decelerazione d'emergenza verso il SvL, `Tbe`); verso la fine dell'autorizzazione nessuna scende sotto il rilascio di 15 km/h;
- le decelerazioni sono ridotte per l'aderenza e per la discesa più ripida fino al bersaglio (`decels`);
- lo stato è NOR, IND (5 s prima di P), OVS, WAR, SBI o INT, e il motore applica la frenatura di servizio sopra la SBI e il freno d'emergenza sopra la EBI.

Queste curve non sono di proposito i modelli del Subset-026: ne riproducono il comportamento qualitativo con pochi parametri. `atoData()` produce i dati del Subset-130 dalle stesse curve, così che un ATO possa essere provato anche con la supervisione interna.

## SCMT (semplificato)

Con `signalling: 'BACC'` la supervisione è una sola curva di frenatura verso il primo segnale rosso e verso ogni riduzione di velocità entro 5 km, con decelerazione costante di 0,55 m/s², rilascio di 30 km/h verso un segnale rosso, avviso a +3 km/h e freno d'emergenza a +7 km/h, senza intervento del freno di servizio. Superare un rosso porta al freno d'emergenza. Gli aspetti sono noti direttamente dal motore. Cosa manca rispetto all'SCMT reale (punti informativi, circuiti codificati, curve dipendenti dal treno, procedure del macchinista) e cosa servirebbe per un modello vero è discusso in [STANDARD.md](../STANDARD.md#scmt).

## Interfacce

- Ingresso: la linea compilata, i parametri del treno, gli aspetti dei segnali, i guasti dello scenario (stato della radio, TSR), posizione e velocità correnti.
- Uscita: una `Supervision` (stato, P/W/SBI/EBI, MRSP, bersaglio, indicazione) usata da motore, DMI, osservazione e CSV; i dati del Subset-130 su richiesta.

## Invarianti

- La supervisione interna deve mantenere i valori di riferimento di `verify-ato` per il controllore d'esempio su tutte le linee.
- Le costanti ETCS in `ETCS` e i valori SCMT sono condivisi da supervisione e `atoData()`: cambiarne uno senza l'altro rompe il controllo su `N_LOC_EBI`.

## Test

`verify-ato` (corse complete senza interventi, valori di riferimento), `verify-scenarios` (perdita radio, TSR, treno che precede fermo con ETCS e SCMT), `verify-ato-s130` (`N_LOC_EBI` entro 0,2 m dall'intervento reale con la supervisione interna).

## Estensioni

Blocco a quattro aspetti, segnali di avviso separati, passaggi a livello, più treni comandati. Un SCMT vero si costruisce meglio come modulo di bordo separato con un protocollo proprio, sul modello del bordo ETCS di riferimento (vedi [STANDARD.md](../STANDARD.md#cosa-servirebbe-per-un-scmt-vero)).
