# Un modello di macchinista umano

*Copia italiana di [DRIVER_MODEL.md](../DRIVER_MODEL.md).*

I due ATO di YuTreno guidano ogni volta allo stesso modo e non sbagliano mai. `examples/driver_model.js` è un macchinista che invece sbaglia: ogni seme dà un macchinista un po' diverso, che risponde in ritardo a un eccesso di velocità, tiene un suo margine sotto la velocità consentita e usa una quota della trazione e del freno che dipende dal suo stile. Con esso si possono confrontare stili di guida con l'ATO a parità di tutto il resto, vedere come la protezione di bordo coglie la lentezza di una persona e, nella didattica, confrontare la guida di uno studente con quella di un modello.

Il modello parte da quello di Barbaro et al. (2026, §3.2.3), costruito al Politecnico di Milano per il loro simulatore a blocco fisso e mobile. È un controllore come gli altri ([API.md](API.md)): non tocca il nucleo e gira nella pagina, senza grafica e nelle campagne.

## Il modello

Il macchinista guarda la velocità del treno e due curve sue.

- **La curva bassa** sta sotto la velocità consentita di un margine. Il margine si estrae una volta, all'inizio della corsa, da una gaussiana con media e deviazione standard del profilo, e non è mai negativo. Sotto la curva bassa il macchinista applica la trazione.
- **La curva alta** è la velocità consentita. Sopra di essa il macchinista frena, ma non subito: a ogni passo di controllo risponde con probabilità 1 − exp(−λ·Δt), dove il tasso λ = λ₀ + g·τ parte da un valore di base λ₀ e cresce di g per ogni secondo τ passato sopra la curva. Finché non risponde resta il comando di prima. Quando ha risposto frena finché la velocità non è tornata alla consentita.
- **Fra le due curve** procede per inerzia.
- **Lo stile** viene da due coefficienti di utilizzo che scalano trazione e freno: il macchinista comanda la trazione k_T e il freno k_B, non il valore pieno.
- **Verso una fine dell'autorizzazione o un segnale a via impedita** il macchinista frena fino all'arresto quando è più vicino di una distanza minima. Fino a lì lavorano le curve, perché la velocità consentita scende verso l'obiettivo.

Vigilanza, porte e fermate in stazione sono quelle di `examples/ato.js`: il macchinista riconosce subito la vigilanza, tiene il freno mentre le porte sono aperte e, entro 600 m dal picchetto di fermata, usa la curva di arresto e il regolatore dell'ATO. Un confronto con l'ATO misura quindi solo lo stile di guida fra le stazioni.

### In che cosa si discosta dal modello di Milano

- **La curva alta.** Nel modello di Milano il macchinista frena sopra la curva di avviso. In YuTreno la curva di avviso dell'ETCS sta solo pochi km/h sopra la velocità consentita, e la curva d'intervento del freno di servizio la segue da vicino. Frenando solo sopra la curva di avviso, con un qualsiasi tempo di risposta, il macchinista medio prendeva fino a cinque interventi del freno di servizio per corsa nello scenario del cantiere, e non è così che si comporta un macchinista formato. Per questo, in modo predefinito, il macchinista frena sopra la velocità consentita, l'eccesso di velocità che il DMI mostra. `brake_above: "warning"` dà la regola di Milano.
- **Frenare fino alla velocità consentita.** Nel modello di Milano il macchinista smette di frenare appena la velocità è sotto la curva alta. Qui continua a frenare finché non è tornato alla velocità consentita, altrimenti freno e inerzia si alternerebbero a ogni passo intorno alla curva.
- **La risposta come tasso.** Il testo di Milano descrive una probabilità che parte da un valore di base e cresce col tempo. Qui è un tasso al secondo, così la distribuzione del tempo di risposta non dipende dal periodo di controllo.

## Parametri

I valori dell'articolo di Milano non sono nel testo (la loro tabella 1 non è leggibile nella versione aperta), quindi i valori qui sono scelti e dichiarati.

| Parametro | Prudente | Medio | Aggressivo | Significato |
| :-- | :-- | :-- | :-- | :-- |
| `margin_mean_kmh` | 10 | 5 | 2 | margine medio della curva bassa sotto la velocità consentita |
| `margin_sd_kmh` | 2,0 | 1,5 | 1,0 | la sua deviazione standard |
| `k_traction` | 0,6 | 0,8 | 1,0 | quota della trazione usata |
| `k_brake` | 0,8 | 0,8 | 1,0 | quota del freno di servizio usata |
| `eoa_distance_m` | 150 | 100 | 60 | distanza da una fine dell'autorizzazione a cui il macchinista frena fino all'arresto |
| `response_base_per_s` | 0,3 | 0,3 | 0,3 | tasso di base della risposta, λ₀ (1/s) |
| `response_growth_per_s2` | 0,3 | 0,3 | 0,3 | crescita del tasso, g (1/s²) |
| `brake_above` | permitted | permitted | permitted | curva alta: `permitted` o `warning` |

Perché questi valori:

- **La risposta è la stessa per i tre profili**, perché nel modello di Milano lo stile viene dal margine e dai due coefficienti, e tenere la risposta a parte permette di studiarla da sola. Con λ₀ = 0,3/s e g = 0,3/s² il tempo medio di risposta è 1,5 s, e il 2,7 % delle risposte supera i 4 s. Quattro secondi sono il tempo di reazione del macchinista T_driver che le curve dell'ETCS lasciano fra la velocità consentita e l'intervento del freno di servizio (il valore nazionale del bordo di riferimento), quindi un macchinista medio raramente lascia che la protezione freni al posto suo.
- **I margini** vanno da 10 km/h, un macchinista che si tiene ben lontano dalla velocità consentita, a 2 km/h, uno che le sta vicino. Le deviazioni standard tengono separati i margini di semi diversi senza renderli negativi.
- **I coefficienti.** Il macchinista prudente usa meno trazione ma frena deciso come il medio: un freno debole lo renderebbe il macchinista colto più spesso dalla protezione, perché la velocità consentita scende verso un obiettivo con la decelerazione di servizio e chi frena alla metà resta indietro. Il macchinista aggressivo usa trazione e freno pieni.
- **La distanza dalla fine dell'autorizzazione** cresce con la prudenza, da 60 a 150 m.

Ogni parametro si può cambiare da solo.

## Come si esegue

```bash
npm run headless -- --scenario scenarios/radio-loss.json --controller examples/driver_model.js --controller-params '{"profile":"aggressive","seed":2}'
npm run driver-campaign                      # campaigns/drivers.json, uscita in results/driver-campaign-drivers/
```

`--controller-params` passa al controllore un oggetto JSON come variabile globale `PARAMS`: `profile`, `seed` e qualsiasi parametro della tabella. Senza, il macchinista è `medium` con seme 1, ed è quello che usa la pagina. La casualità viene da un piccolo generatore con seme scritto nell'esempio (mulberry32), non da `Math.random`: due corse con lo stesso seme sono identiche byte per byte, in Node e nel browser.

## Verifiche

`verify-ato` controlla il modello con due prove.

- **DRV1.** Su Valle Lauro ogni profilo con seme 1 dà due volte la stessa corsa, con seme 2 una diversa, e i tre profili danno tre corse diverse.
- **DRV2.** Un macchinista ideale (risposta immediata, nessuna dispersione del margine) sul valico dell'Appennino e su Valle Lauro non si avvicina mai a meno di 4 km/h dalla curva di avviso e non prende avvisi, frenature di servizio né interventi. Un macchinista lento (λ₀ = 0,02/s, g = 0,005/s², una risposta media di diversi secondi) prende avvisi e frenature di servizio dalla protezione su entrambe le linee, e su Valle Lauro un intervento.

## La campagna dei macchinisti

`npm run driver-campaign` esegue i tre profili con cinque semi ciascuno e l'ATO di `examples/ato.js` una volta, con la supervisione interna e con il bordo di riferimento, sui sei scenari ETCS della campagna di riferimento così come sono scritti, guasti compresi: 192 corse in circa 8 minuti. È una campagna a parte, così la campagna di riferimento conserva la sua impronta. `runs.csv` ha una riga per corsa con la sua impronta, `summary.csv` media e deviazione standard su scenari e semi, `determinism.csv` lo stesso seme ripetuto e un altro seme.

Medie sui sei scenari e sui cinque semi (l'ATO guida ogni scenario una volta):

| Macchinista | Bordo | Superati | Tempo | Energia netta | Avvisi | Frenature di servizio | Interventi | Trattenuto dal segnalamento |
| :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- | :-- |
| ATO | interno | 4/6 | 1195 s | 141,4 kWh | 0,5 | 0,0 | 0,0 | 452 s |
| prudente | interno | 17/30 | 1208 s | 133,0 kWh | 3,2 | 0,7 | 0,5 | 348 s |
| medio | interno | 20/30 | 1187 s | 148,0 kWh | 3,9 | 0,7 | 0,3 | 413 s |
| aggressivo | interno | 20/30 | 1179 s | 167,5 kWh | 5,1 | 0,9 | 0,3 | 458 s |
| ATO | riferimento | 4/6 | 1188 s | 165,0 kWh | 0,8 | 0,3 | 0,3 | 386 s |
| prudente | riferimento | 13/30 | 1206 s | 146,4 kWh | 6,1 | 3,0 | 0,7 | 302 s |
| medio | riferimento | 20/30 | 1190 s | 165,4 kWh | 7,1 | 3,7 | 0,5 | 363 s |
| aggressivo | riferimento | 20/30 | 1183 s | 190,1 kWh | 7,0 | 1,7 | 0,5 | 403 s |

Che cosa mostra la campagna:

- **Lo stile sposta l'energia molto più del tempo.** Dal prudente all'aggressivo l'energia netta cresce del 26 % con la supervisione interna e del 30 % con il bordo di riferimento, mentre il tempo della corsa scende di circa il 2 %, perché gran parte della corsa si passa dietro il merci che precede o nelle stazioni. L'ATO usa meno energia del macchinista medio con la supervisione interna e altrettanta con il bordo di riferimento, e impiega più o meno lo stesso tempo del macchinista medio.
- **Il bordo di riferimento coglie le persone più spesso.** Con la supervisione interna un macchinista umano prende un intervento del freno di servizio meno di una volta per corsa; con il bordo di riferimento da tre a quattro volte il prudente e il medio. Le curve del §3.13 mettono l'intervento del freno di servizio 4 s di marcia oltre la velocità consentita, e un macchinista che risponde in circa 1,5 s e poi aspetta che il freno pneumatico entri in azione consuma gran parte di quel margine; la supervisione interna lo mette più lontano. L'ATO, che non supera mai la velocità consentita, quasi non viene toccato né dall'una né dall'altra.
- **I guasti nascosti sono dove la protezione interviene.** Il freno degradato e le foglie fanno fallire ogni macchinista, ATO compreso, come nella campagna di riferimento; con il freno degradato i macchinisti umani prendono due o tre interventi per corsa e l'ATO con la supervisione interna nessuno: l'umano frena solo una volta sopra la velocità consentita e, con meno freno di quanto si aspetta, non riesce a rientrare sotto le curve in tempo.
- **Il macchinista prudente fallisce sul tempo.** Supera meno scenari degli altri, soprattutto il rallentamento per cantiere (2 e 1 su 5), perché arriva più tardi di quanto lo scenario ammette; è il più lento ma non il più sicuro, perché con il bordo di riferimento prende quasi tante frenature di servizio quante il medio.
- **Il tempo trattenuto dal segnalamento dipende dal macchinista.** L'aggressivo raggiunge il merci che precede e gli aspetta dietro più a lungo del prudente (458 contro 348 s con la supervisione interna), quindi la misura di [CAPACITA.md](CAPACITA.md#il-tempo-in-cui-il-segnalamento-trattiene-il-treno) descrive la protezione vista da un macchinista, non una proprietà della sola linea.

Questi numeri dipendono dai parametri dichiarati, che non sono tarati su macchinisti veri: sono un esempio di ciò che il modello può mostrare, non un risultato sui macchinisti.

## Che cosa il modello non fa

- **Non è tarato su macchinisti veri.** I parametri sono ipotesi dichiarate; non sono stati usati dati di macchinisti reali.
- **Un'estrazione per corsa.** Il margine della curva bassa si estrae una volta; non c'è stanchezza, né distrazione che va e viene, né cambio di stile lungo la corsa.
- **Il resto è perfetto.** Il macchinista riconosce subito la vigilanza, legge il DMI senza ritardo e si ferma in stazione come l'ATO.

## Fonti

- E. Barbaro, I. La Paglia, F. Bernardini, G. Bucca, R. Corradi, M. Bocciolone, A. Collina, *A modular simulation tool for fixed block and moving block railway signalling systems*, Railway Engineering Science 34(2), 2026, pp. 257–274, §3.2.3.
- ERA, Subset-026 v4.0.0, §3.13.9.3 (la velocità consentita e l'intervento del freno di servizio, separati da T_driver).
- T. Ettinger, mulberry32, un generatore pseudocasuale a 32 bit.
