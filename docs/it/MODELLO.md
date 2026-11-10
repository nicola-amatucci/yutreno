# Modello fisico e di segnalamento

> Copia italiana. Il documento di riferimento è la versione inglese [MODEL.md](../MODEL.md): nomi di file, comandi e formati seguono quella; i nomi italiani della versione 0.x (campi JSON, opzioni come `--linea` o `--bordo`) restano accettati.

## Dinamica del treno

La descrizione completa, con equazioni, grafici e un laboratorio interattivo, è nella pagina generata da `src/docs/` (`npm run build` produce `dist/model.html`). Qui c'è la sintesi.

YuTreno offre due modelli interni, scelti con il campo `model` dei parametri del treno. Un terzo valore, `external`, affida la dinamica a un programma esterno in co-simulazione, per esempio un modello Simulink: è descritto in [DINAMICA_ESTERNA.md](DINAMICA_ESTERNA.md).

**Multi-massa (predefinito).** Il treno è una catena di N veicoli (`consist`), collegati da accoppiatori con molla, smorzatore e gioco (`coupler`). È la generalizzazione del modello a due masse del treno giocattolo (Gîlcă e Borcoși 2019; Control Tutorials for MATLAB & Simulink), come nella letteratura sulla dinamica longitudinale del treno. Per ogni veicolo:

    m_i · k_r · dv_i/dt = Ft_i − Ff_i − R_i(v_i) − m_i · g · i_i − T_i + T_{i−1}

dove `T_i` è la forza nell'accoppiatore fra i veicoli i e i+1, positiva in trazione. L'accoppiatore non trasmette forza entro ±gioco/2 di allungamento; oltre, vale `k·(e ∓ slack/2) + c·de/dt`, senza mai cambiare segno per effetto dello smorzatore.

- **Trazione.** Lo sforzo comandato, limitato da forza di spunto e potenza, si divide fra i veicoli motori in proporzione alla massa. Ciascuno è limitato dall'aderenza μ(v)·m_i·g. L'aderenza cala con la velocità secondo Curtius e Kniffler, `0,161 + 7,5/(44 + v[km/h])`, scalata sul valore della condizione della rotaia.
- **Frenatura.** La forza totale si divide in proporzione alla massa. Ogni veicolo la riceve con un ritardo `x_i / vProp` se il freno è pneumatico (il comando viaggia lungo la condotta, 280 m/s), oppure subito con il freno elettropneumatico. Poi la applica con una risposta del primo ordine. L'antipattinaggio limita la forza al 95% dell'aderenza.
- **Resistenze.** Davis ripartita: A e B in proporzione alla massa, C per il 35% sul veicolo di testa e il resto uniforme. Il termine aerodinamico è moltiplicato per `kTunnel` dentro le gallerie. La resistenza in curva segue Röckl: 650/(R−55) ‰ sopra i 300 m di raggio, 500/(R−30) ‰ sotto. Pendenza e curva sono quelle sotto il baricentro di ciascun veicolo.
- **Integrazione.** Eulero semi-implicito a passo fisso di 5 ms per tutti i veicoli insieme. Un veicolo fermo resta fermo finché la forza che lo spinge non supera freno e resistenza di primo distacco: il treno non arretra.

**Punto materiale (didattico).** Il treno è una sola massa equivalente. Lo sforzo è limitato da forza massima, potenza e aderenza costante sugli assi motori. La frenatura è limitata dall'aderenza su tutti gli assi e segue la risposta del primo ordine, senza propagazione. La pendenza è la media sotto tutta la lunghezza del treno. È il modello delle prime versioni, che `verify-ato` mantiene identico.

In entrambi i modelli il freno elettrico copre la prima parte della forza frenante, fino alla sua forza massima e al limite di potenza, e recupera energia con il suo rendimento. Gli indicatori SLITT e WSP si accendono quando la richiesta supera l'aderenza.

## Segnalamento

Dalle stazioni e dalla lunghezza delle sezioni di blocco si generano tre tipi di segnale: di partenza 250 m dopo ogni stazione, di protezione 400 m prima della stazione successiva e intermedi a passo regolare. Una sezione occupata dal treno che precede rende rosso il suo segnale d'ingresso e giallo quello precedente; i segnali di partenza restano rossi fino all'orario di partenza.

**ERTMS/ETCS livello 2, semplificato.** Non ci sono segnali luminosi. Il RBC concede l'autorizzazione al movimento (MA) fino all'inizio della prima sezione che il blocco renderebbe rossa, con il punto di pericolo (SvL) 50 m oltre. Il calcolatore di bordo considera come obiettivi la fine dell'autorizzazione (EoA) e ogni riduzione del profilo statico di velocità, e costruisce per ciascuno le curve in tabella.

| Curva | Decelerazione | Tempo morto |
| :-- | :-- | :-- |
| Consentita (P) | servizio | Tbs + reazione del macchinista (1,5 + 4 s) |
| Avviso (W) | servizio | Tbs + 2 s |
| Frenatura di servizio (SBI) | servizio | Tbs |
| Intervento (EBI) | urgenza, verso l'SvL | Tbe (2 s) |

La decelerazione è ridotta per l'aderenza e per la discesa più ripida fino all'obiettivo. Lo stato della supervisione è uno di questi:

- normale;
- indicazione, 5 s prima della curva consentita;
- sovravelocità;
- avviso;
- frenatura di servizio comandata;
- intervento con frenatura d'urgenza.

Superare la fine dell'autorizzazione porta all'urgenza (trip). La velocità di rilascio è 15 km/h.

Queste curve **non** sono i modelli del Subset-026: ne riproducono il comportamento qualitativo per la didattica e la ricerca sui controllori. Le curve del Subset-026 sono quelle del bordo di riferimento ([BORDO_ETCS.md](BORDO_ETCS.md), [progetto/bordo-riferimento.md](progetto/bordo-riferimento.md)), controllate clausola per clausola in `scripts/verify-subset026.ts`.

**SCMT, semplificato.** C'è una curva unica verso il segnale rosso, con decelerazione 0,55 m/s² e rilascio a 30 km/h. L'avviso scatta a +3 km/h e l'intervento a +7 km/h. Superare un segnale rosso porta all'urgenza. Che cosa fa lo SCMT vero e che cosa manca è discusso in [STANDARD.md](STANDARD.md#scmt).

## Vigilanza, fermate e treno che precede

**Vigilanza.** Ha un ciclo fisso di 55 s di marcia e lascia 5 s per confermare; se la conferma non arriva, scatta l'urgenza. I tempi di reazione vengono registrati.

**Fermate.** Una fermata è valida se il treno si arresta con la testa entro 20 m dalla palina. Le porte restano aperte almeno 20 s e fino all'orario di partenza, e la trazione è inibita finché sono aperte.

**Treno che precede.** È un treno merci fra i treni della corsa, con la stessa dinamica, gli stessi segnali, la stessa supervisione e lo stesso guidatore automatico dei treni di servizio. Di base ha due locomotive e tanti carri carichi quanti ne entrano nella sua lunghezza (`len`), e corre al massimo a `vmax`. È fermo in `s0` e parte quando parte la corsa, transita nelle stazioni, fa la sua sosta di `wait` secondi (nella stazione entro 400 m da `stopAt`, oppure in linea) e finisce la corsa all'ultima stazione della linea. Il suo guidatore pianifica le fermate a 0,25 m/s², perché il freno pneumatico di un treno lungo entra in azione lentamente. Non porta passeggeri e non compare nei dati aperti. Fino al 7 novembre 2026 era un modello cinematico che correva senza segnali; [ROADMAP.md](ROADMAP.md) spiega il cambiamento (decisione 12).

## Semplificazioni note

Gli organi di trazione non hanno isteresi per attrito; l'aderenza è una curva empirica e non un modello di contatto con lo scorrimento; il freno pneumatico ha un ritardo di propagazione puro senza calcolo della pressione in condotta; il modello è solo longitudinale. Mancano inoltre i segnali di avviso separati, il quarto aspetto, i passaggi a livello e più treni comandati sulla stessa linea.
