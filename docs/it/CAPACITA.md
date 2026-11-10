# Capacità della linea: tempi di impegno e distanziamento minimo

> Copia italiana di [docs/CAPACITY.md](../CAPACITY.md). In caso di differenze fa fede il testo inglese.

Quanto vicini possono seguirsi due treni su una linea, e il simulatore è d'accordo con il calcolo da manuale? `scripts/verify-capacity.ts` risponde a entrambe le domande per la linea Valle Lauro e controlla che i due numeri restino vicini. È la versione semplificata del metodo della fiche UIC 406.

## Il metodo

Nella UIC 406 un treno impegna ogni sezione di blocco più a lungo di quanto impieghi a percorrerla. La sezione deve essere libera dal momento in cui un treno che segue dovrebbe cominciare a frenare se non lo fosse, e resta impegnata finché la coda del treno non l'ha liberata e l'itinerario non è stato sciolto. L'edizione 2013 lo chiama tempo di occupazione della sezione, composto da:

- un margine prima che il treno entri, per la formazione dell'itinerario, la visibilità e l'avvicinamento;
- il tempo di percorrenza della sezione;
- il tempo di liberazione, che dipende dalla lunghezza del treno;
- il tempo di scioglimento.

Disegnati per ogni sezione lungo la linea, questi tempi formano la *scala dei tempi di impegno*. Due treni dello stesso tipo possono seguirsi al tempo di impegno più lungo della scala: è il loro distanziamento minimo. Il metodo di compressione della fiche avvicina le tracce di un orario finché le scale non si toccano. Il tempo di occupazione così ottenuto, diviso per il periodo, è il consumo di capacità.

YuTreno calcola la scala dalla corsa di un solo treno regionale (fermate a Ponte Sabato e San Felice Scalo, soste di 30 s), con queste semplificazioni:

- **Avvicinamento.** La sezione deve essere libera dove il treno che segue comincerebbe a frenare per il segnale all'ingresso: distanza di frenatura a 0,5 m/s² più 6 s di reazione e di attuazione del freno, alla velocità che il treno ha in quel punto. Con il blocco automatico l'informazione arriva solo al segnale precedente, con l'aspetto di avviso, quindi l'avvicinamento comincia al più tardi lì.
- **Liberazione.** La sezione si libera quando la coda passa il segnale di uscita; al capolinea, quando il treno arriva e lascia la linea.
- **Cosa manca.** I tempi di formazione e di scioglimento dell'itinerario, i tempi cuscinetto e gli orari con treni diversi.

Il distanziamento misurato viene da due servizi identici, il secondo h secondi dopo il primo. È il più piccolo h per cui il secondo marcia esattamente come il primo, spostato di h: a ogni passo di 5 ms è dove il primo era h secondi prima. È il significato di "non disturbato" nella UIC 406. Il solo orario di arrivo non basta, perché il margine delle soste assorbe ogni rallentamento.

## Risultati

| Segnalamento | Calcolato | Sezione critica | Misurato | Differenza |
| :-- | :-- | :-- | :-- | :-- |
| ETCS, supervisione interna | 250,0 s | segnale 9, 10,000–10,650 km | 244 s | −2,4 % |
| blocco automatico e SCMT | 253,4 s | segnale 10, 10,650–11,967 km | 246 s | −2,9 % |
| ETCS, bordo di riferimento | 250,0 s | segnale 9 | 239 s | −4,4 % |
| ETCS, bordo di riferimento e terra con apparato | 250,0 s | segnale 9 | 252 s | +0,8 % |

La sezione critica è quella che contiene la fermata di San Felice Scalo: il treno la impegna mentre rallenta, durante la sosta e mentre riparte. Per i sistemi di blocco il calcolo è un po' prudente, perché il bordo frena più tardi della curva ipotizzata. Con la terra con apparato il distanziamento misurato è più lungo di 2 s, perché anche formare e sciogliere gli itinerari di ingresso e di partenza richiede tempo, e il calcolo non ne tiene conto.

Con 250 s di distanziamento la linea porta al massimo 14 treni l'ora in un senso. La fiche del 2013 raccomanda tassi di occupazione non oltre il 75 % nell'ora di punta per le linee a traffico misto e ad alta velocità e l'85 % per le linee suburbane dedicate (60 % e 70 % sulla giornata): sono circa 10 treni l'ora su una linea mista. Su una linea a binario unico con incroci il limite reale è più basso, perché i due sensi condividono le sezioni; la verifica riguarda solo treni nello stesso senso.

`verify-capacity` fallisce se calcolo e misura differiscono di più del 5 %. Controlla anche che una corsa con tutto insieme dia gli stessi dati nel processo e con la terra e il regolatore come programmi esterni: treni nei due sensi, linea interrotta, un treno guasto e poi rallentato, il regolatore.

## Il tempo in cui il segnalamento trattiene il treno

Il distanziamento minimo dice quanto vicini possono correre due treni; non dice quanto costa un distanziamento più corto a chi viaggia sul secondo treno. YuTreno misura questo costo direttamente, come fa il modello di Barbaro et al. (2026) con il suo *signalling activation time*: il tempo in cui un treno è trattenuto dal segnalamento invece che dalla linea. È `signalling_constrained_s` nel riepilogo di ogni treno, e `signalling_constrained_s` (tutti i treni) e `signalling_constrained_max_s` (il treno trattenuto più a lungo) nella campagna del servizio.

Un treno è trattenuto dal segnalamento in un passo quando valgono entrambe le condizioni:

- l'obiettivo che fissa la sua velocità consentita è del segnalamento: una fine dell'autorizzazione o un segnale a via impedita, cioè un obiettivo a velocità 0 che non è la fine della linea;
- la sua velocità consentita è più bassa di almeno 1 km/h di quella che la linea e la prossima fermata permetterebbero. La linea permette la velocità consentita della stessa supervisione senza autorizzazione e senza segnali, quindi con le stesse curve verso i limiti più bassi davanti. La fermata permette la velocità da cui il treno si ferma al picchetto con la sua decelerazione di servizio, e 0 mentre vi sta fermo con le porte aperte, o all'origine prima dell'ora di partenza.

La regola legge solo la supervisione che il treno riceve, quindi è la stessa per la supervisione interna, il bordo di riferimento, un bordo esterno e il blocco automatico. Misura la protezione, non il macchinista: un macchinista che frena per un obiettivo prima che la supervisione abbassi la velocità consentita viene rallentato senza essere trattenuto.

`verify-capacity` (CAP4) fa correre i due servizi della tabella qui sopra a distanziamenti intorno a quello misurato:

| Segnalamento | Trattenuto al distanziamento misurato | 20 s in meno | 60 s in meno | Non più trattenuto da | Distanziamento misurato |
| :-- | :-- | :-- | :-- | :-- | :-- |
| ETCS, supervisione interna | 0 s | 19,7 s | 59,7 s | 244 s | 244 s |
| blocco automatico e SCMT | 0 s | 19,8 s | 59,8 s | 245 s | 246 s |
| ETCS, bordo di riferimento | 0 s | 20 s | 60 s | 223 s | 239 s |
| ETCS, bordo di riferimento e apparato | 0,4 s | 6,3 s | 6,3 s | 252 s | 252 s |

Un treno da solo non è mai trattenuto, salvo 0,4 s con l'apparato, i cicli radio alle sue partenze. Sotto la soglia il secondo treno perde circa un secondo per ogni secondo di distanziamento tolto: aspetta davanti al segnale che il primo treno liberi la sezione. Con la supervisione interna e con il blocco automatico la soglia è il distanziamento misurato entro 1 s: il secondo treno viene rallentato esattamente quando il segnalamento lo trattiene. Con il bordo di riferimento è più bassa di 16 s, perché fra 223 e 239 s il macchinista del secondo treno frena per la fine dell'autorizzazione prima di quanto chieda la velocità consentita del bordo, quindi il treno è rallentato ma non trattenuto. Con l'apparato il tempo trattenuto cresce a gradini: davanti al segnale di partenza di San Felice Scalo il secondo treno aspetta che l'itinerario sia formato di nuovo dopo che il primo è passato, 6 s qualunque sia il distanziamento fino a circa 190 s.

La campagna del servizio trova la stessa soglia con servizi generati dall'orario della linea (`npm run service-campaign -- --config campaigns/headway-sweep.json`, file `thresholds.csv`): con il blocco automatico e con l'ETCS il secondo treno è trattenuto per 4,8 e 3,7 s a 240 s e non più da 245 s. Nelle stesse corse il ritardo all'arrivo non si muove, perché il margine dell'orario assorbe l'attesa: il tempo trattenuto dal segnalamento mostra un costo che la sola puntualità nasconde.

## Blocco mobile

Con il blocco mobile ([BLOCCO_MOBILE.md](BLOCCO_MOBILE.md)) non ci sono sezioni di blocco, quindi nemmeno tempi di occupazione delle sezioni. `verify-capacity` (CAP5) calcola il distanziamento dalla corsa del primo treno da solo: in ogni istante il secondo treno, h secondi dietro, in x con velocità w, ha bisogno che la fine della sua autorizzazione stia oltre x della distanza di frenatura della sua curva consentita, che l'ATO segue (la decelerazione di servizio del treno dopo `T_brake_service` + `T_driver`, senza pendenze), e la fine dell'autorizzazione sta il margine dietro la coda confermata che l'RBC ha per il primo treno. Il distanziamento minimo è la differenza più grande fra l'istante in cui quella coda raggiunge il punto necessario e l'istante in cui il secondo treno è lì.

| Distanziamento, bordo di riferimento | Calcolato | Punto critico | Misurato | Differenza |
| :-- | :-- | :-- | :-- | :-- |
| blocco fisso | 250,0 s | segnale 9, 10,000–10,650 km | 239 s | −4,4 % |
| blocco mobile, margine 50 m, rapporti ogni 6 s | 193,2 s | 10,035 km | 199 s | +3,0 % |

Il punto critico è di nuovo l'avvicinamento a San Felice Scalo, dove il primo treno rallenta per fermarsi; lì il blocco mobile fa risparmiare 40 s (−17 %), perché il secondo treno segue la coda del primo invece di aspettare che liberi la sezione di 650 m intorno alla fermata. Il calcolo è leggermente ottimista: l'ATO resta 2 m/s sotto la velocità consentita e i rapporti arrivano al più ogni 6 s, quindi il secondo treno vede la coda un po' più tardi di quanto si assume.

La campagna di confronto dei blocchi ripete l'esplorazione del tempo trattenuto dal segnalamento con i due distanziamenti (`npm run service-campaign -- --config campaigns/block-comparison.json`, file `thresholds.csv`): con l'ETCS e il bordo di riferimento il secondo treno non è più trattenuto da 230 s con il blocco fisso e da 200 s con il blocco mobile; a 180 s è trattenuto 43,2 s con il blocco fisso e 31,5 s con il blocco mobile, a 120 s 136,4 s e 115,5 s. Il ritardo all'arrivo non si muove in nessuno dei due casi, e l'energia netta dei due treni è leggermente più bassa con il blocco mobile sotto la soglia (232,7 kWh contro 233,0 kWh a 180 s), perché il secondo treno frena meno.

## Capacità di un nodo

Su una rete con la terra con apparato ([progetto/rete.md](progetto/rete.md)) la stessa domanda si pone al nodo di San Felice Scalo, dove due treni diversi condividono solo una parte del loro percorso. Il metodo è quello generale della UIC 406 per due tipi di treno: il distanziamento minimo fra le loro partenze è la differenza più grande, sulle sezioni che condividono, fra il momento in cui il primo treno libera una sezione e il momento in cui al secondo serve.

- **Quando il primo treno libera una sezione.** L'ultimo istante in cui il campo lo vede sulla sezione, in una corsa di quel treno da solo.
- **Quando la sezione serve al secondo.** A un nodo l'autorizzazione è fatta di itinerari, e un itinerario si forma solo con tutte le sue sezioni e il suo tratto oltre il segnale liberi. La sezione serve quindi dal momento in cui il secondo treno comincerebbe a frenare (0,5 m/s² e 6 s, come sopra) per l'inizio del primo itinerario della sua autorizzazione che la contiene, nel percorso o nel tratto oltre il segnale. Gli itinerari sono quelli delle sue autorizzazioni in una corsa da solo.
- **I binari di una stazione.** I binari I e II sono sezioni distinte. Il secondo treno può prendere quello libero, ma sul binario II corre alla velocità deviata, e già questo lo rallenta: non è più indisturbato.

Il distanziamento misurato è il più piccolo per cui il secondo treno corre, passo per passo, esattamente come da solo.

| Movimenti | Calcolato | Sezione critica | Misurato | Differenza |
| :-- | :-- | :-- | :-- | :-- |
| un treno da Valle Lauro verso la diramazione, poi uno da Valle Lauro dritto fino a Monte Clanio | 247,1 s | binario I di San Felice Scalo | 254 s | +2,8 % |
| un treno dalla diramazione verso Valle Lauro, poi uno da Monte Clanio che entra sulla stessa linea al nodo | 537,0 s | zona deviatoi di Ponte Sabato | 534 s | −0,6 % |

Nel primo caso la sezione critica è il binario del nodo: il treno per la diramazione vi sosta e poi lo lascia attraverso il deviatoio di nodo, e il treno che segue deve trovarlo libero quando gli viene scelto il binario, altrimenti va sul binario II. Nel secondo caso i tempi si contano fra partenze da due origini diverse, quindi il distanziamento comprende la corsa del primo treno fino al nodo; la sezione critica è la prima stazione che entrambi attraversano dopo il nodo.

`verify-capacity` controlla che il distanziamento misurato stia entro il 5 % di quello calcolato (il secondo treno disturbato al 5 % sotto, indisturbato al 5 % sopra). La misura al secondo richiede una corsa per passo e si fa solo con `CAPACITY_SEARCH=1`; la tabella qui sopra è stata fatta così. I movimenti opposti che si incrociano non sono un distanziamento: sul binario unico li regolano il consenso di blocco e l'incrocio in stazione.

Fonti:
- E. Barbaro, I. La Paglia, F. Bernardini, G. Bucca, R. Corradi, M. Bocciolone, A. Collina, *A modular simulation tool for fixed block and moving block railway signalling systems*, Railway Engineering Science 34(2), 2026, pp. 257–274
- [UIC Code 406, Capacity, 2ª edizione, giugno 2013](https://tamannaei.iut.ac.ir/sites/tamannaei.iut.ac.ir/files/files_course/uic406_2013.pdf)
- [Evaluating line capacity with an analytical UIC Code 406 compression method and blocking time stairway, Energies 13(7) 1853, 2020](https://www2.mdpi.com/1996-1073/13/7/1853)
