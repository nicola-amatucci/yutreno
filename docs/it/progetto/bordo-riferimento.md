# Bordo ETCS di riferimento (EVC)

> Copia italiana di [reference-onboard.md](../../design/reference-onboard.md). In caso di differenze fa fede il testo inglese.

## Scopo

`ReferenceEvc` in `src/core/evc.ts` è un calcolatore di bordo ETCS di livello 2 che conosce il mondo solo attraverso il protocollo di bordo: odometria, telegrammi delle balise e messaggi radio in ingresso; comandi al treno, messaggi radio e DMI in uscita. Esiste per due ragioni: rendere possibili le corse ETCS a messaggi senza un EVC esterno, ed essere il riferimento con cui confrontare gli EVC esterni. Il suo comportamento rispetto a Subset-026 e Subset-130 è nella [matrice di tracciabilità](../TRACCIABILITA.md); questo documento descrive come è costruito.

## Responsabilità

- Localizzare il treno sui gruppi di balise e mantenere l'intervallo di confidenza.
- Ricevere e conservare autorizzazione al movimento, profilo statico di velocità, pendenze e rallentamenti temporanei, riferiti all'LRBG.
- Sorvegliare velocità e distanza con le curve di frenatura del §3.13 e comandare il treno.
- Gestire i modi SB, FS, TR, PT e la reazione all'arresto d'emergenza e alla perdita del contatto radio.
- Riportare la propria posizione all'RBC e fornire i dati del Subset-130 all'ATO.

- Con più RBC, tenere due sessioni e passare dall'una all'altra (§3.15.1.3).

Non fa start of mission, transizioni di livello, gli altri modi, autorizzazioni a più sezioni, messaggi condizionati, conferme né codifica in bit.

## Ciclo

`step(req)` è un ciclo di bordo (100 ms di default). Traduce la richiesta con `toEnglish`, si reinizializza su `start` (dati del treno, valori nazionali fusi con `DEFAULT_NATIONAL`, posizione memorizzata come LRBG), memorizza l'odometria, legge le balise (`readBalise`: solo `N_PIG` = 0 fissa il riferimento; se appena prima è passata la `N_PIG` = 1 dello stesso gruppo, il gruppo è stato passato contro il suo verso nominale e il treno è orientato al contrario rispetto a esso, cosa riportata in `Q_DIRLRBG`, `Q_DLRBG` e `Q_DIRTRAIN`) e i messaggi radio (`readRadio`), sorveglia (`supervise`), manda un rapporto di posizione quando dovuto (nuovo LRBG, cambio di modo, ogni 6 s) e restituisce uscite, messaggi, DMI e posizione.

## Dati

Tutti i dati di terra sono convertiti alla ricezione da distanze relative all'LRBG a letture dell'odometro, usando la lettura memorizzata per quel gruppo di balise (`bgOdo`). Un messaggio riferito a un gruppo sconosciuto è scartato, e si usano solo i pacchetti validi per l'orientamento del treno rispetto a quel gruppo (`Q_DIR` uguale a esso, oppure 2). I profili sono memorizzati come segmenti `[da, a, valore]`: `ssp`, `grad`, e `tsr` per `NID_TSR`. Un nuovo messaggio 3 sostituisce interamente autorizzazione, profilo e pendenze (semplificazione dichiarata del §3.7).

## Curve

- `ebdBack(xt, vt, v, a)` è la EBD o SBD verso il bersaglio `(xt, vt)` letta come posizione: il punto in cui la curva vale `v`, risalendo segmento per segmento con la decelerazione `a + g·grad/(1000 + 10·M_rotating)` di ogni tratto di pendenza. Dà il punto dell'EBI per `N_LOC_EBI` ed è esposta come `brakingCurvePoint()` per la validazione delle curve.
- `solve(x, T, xt, vt, a)` trova la velocità `v` più alta il cui punto limite `ebdBack(v) − v·T` non è alle spalle di `x`; dà EBI (`T = T_traction_cut_off + T_brake_emergency`), SBI2 (`+ T_brake_service`), W (`+ T_warning`), P (`+ T_driver`) e I (`+ T_indication`, con `T_indication = max(0,8·T_bs, 5 s) + T_driver`), e SBI1/W/P/I dalla SBD verso l'EOA. Per una riduzione di velocità vengono tutte dalla EBD verso V_target + dV_ebi e nessuna scende sotto i limiti di tetto del bersaglio.
- Il tetto usa l'MRSP sotto l'intero treno (`mrspSegments`, limitato da `V_MAXTRAIN`) con i margini `margin()` interpolati fra i valori nazionali.

## Due RBC

`sup` è l'RBC di supervisione (il primo `NID_RBC` sentito); con messaggi senza `NID_RBC` resta `null` e quanto segue non si applica. Il pacchetto 131 crea `hand` (RBC che accetta, confine come lettura dell'odometro, sessione aperta, rapporto della testa mandato, messaggi conservati). In `readRadio` i messaggi dell'ACC si conservano, quelli del vecchio HOV (`old`) si leggono solo per l'ordine di chiusura (`terminates()`), quelli di ogni altro RBC si scartano. `positionReport()` indirizza il rapporto a `sup` e ne manda copia all'ACC o al vecchio HOV; a un rapporto con la testa massima sicura oltre il confine cambia `sup`, tiene il vecchio RBC in `old` e riapplica i messaggi conservati. `handoverStep()` manda una volta il rapporto della testa e, per la vecchia sessione, quello della coda minima sicura, ripetuto fino a 3 volte ogni 15 s prima che `terminate()` mandi da solo il messaggio 156.

## Integrità del treno

`integrityLost` segue `train.integrity` della richiesta; il suo passaggio a persa imposta `reportPending` (§3.6.5.1.4 d). `positionReport()` scrive `Q_INTEGRITY` 1 con `L_TRAININT` = lunghezza del treno + l'incertezza per difetto, come se la fonte esterna confermasse l'integrità subito prima di ogni rapporto, oppure `Q_INTEGRITY` 3 senza lunghezza.

## Comandi e modi

Freno d'emergenza sopra la EBI fino all'arresto; freno di servizio sopra la SBI fino al ritorno sotto P; taglio trazione con l'uno o l'altro e in SB/PT. Trip quando il fronte sicuro minimo supera l'EOA (salvo che l'autorizzazione arrivi alla fine della linea), sul messaggio 16 e, con `M_NVCONTACT` = 0, sulla perdita del contatto radio; con `M_NVCONTACT` = 1 la perdita del contatto comanda il freno di servizio. TR diventa PT a treno fermo; una nuova autorizzazione a treno fermo porta SB o PT in FS.

## Invarianti

- Nessuna importazione dal motore oltre ai tipi del protocollo e a `legacy.ts`: tutto quello che fa, un EVC esterno può farlo attraverso il protocollo.
- Lo stesso bordo eseguito in processo e come processo esterno (`examples/onboard/onboard_stdio.ts`) dà dati identici.
- `brakingCurvePoint()` e le velocità del DMI vengono dalle stesse funzioni, così la validazione delle curve misura il bordo stesso.

## Test

`verify-subset026` (25 blocchi a livello di requisito, in forma chiusa dove possibile), `verify-curve-validation` (EBD, EBI, SBD in forma chiusa in piano), `verify-onboard` (corse complete, scenari, macchinista che non frena mai, processo esterno), `verify-ato-s130` (`N_LOC_EBI` entro 1,3 m dall'intervento reale, stessi dati ATO in processo ed esterni).

## Divergenze note e passi successivi

Le tre divergenze del §3.13 elencate nella matrice: pendenza alla testa, tempi d'urgenza sommati, niente accelerazione stimata né errore di velocità. Passi successivi: completare il confronto con lo strumento ERA, correggere la sovrapposizione dei tempi d'urgenza, aggiungere il dialogo di start of mission insieme all'RBC, poi la codifica in bit.
