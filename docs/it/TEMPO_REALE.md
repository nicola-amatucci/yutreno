# Quanto può essere in tempo reale

> Copia italiana. Il documento di riferimento è la versione inglese [REAL_TIME.md](../REAL_TIME.md): nomi di file, comandi e formati seguono quella; i nomi italiani della versione 0.x (campi JSON, opzioni come `--linea` o `--bordo`) restano accettati.

YuTreno oggi va al passo: il motore si ferma finché controllore, dinamica e bordo esterni non rispondono, e per questo ogni corsa è ripetibile bit per bit. Un calcolatore di bordo vero non aspetta. Ha il suo orologio, legge l'odometria e le boe quando arrivano e comanda i freni quando decide lui. Per collegarlo, il motore dovrebbe seguire l'orologio. Questa pagina misura quanto ne è lontano, senza ancora cambiare nulla del motore.

```bash
npx tsx scripts/measure-realtime.ts            # circa 90 s; risultati in results/realtime/measures.json
npx tsx scripts/measure-realtime.ts --rapide   # prove brevi
```

## Le misure

Le misure vengono da due macchine, il 5 novembre 2026, sulla linea dell'Appennino con l'ATO semplice:
- **A**: la macchina virtuale Linux sulla macchina di sviluppo, con 2 nuclei di uno Xeon W-2223 a 3,6 GHz;
- **B**: un contenitore cloud con 2 nuclei Xeon a 2,1 GHz.

Entrambe usano Node 22. Le durate sono in millisecondi.

**Calcolo del motore.** Una corsa di 1161 s simulati richiede meno di 2 s di calcolo.

| Prova | Tempo reale (A / B) | Passo p50 | Passo p99,9 | Passo massimo |
| :-- | --: | --: | --: | --: |
| punto materiale, supervisione interna | 1409× / 1174× | 0,002 | 0,05 / 0,07 | 6,2 / 8,2 |
| multimassa, supervisione interna | 1546× / 1268× | 0,002 | 0,03 / 0,04 | 2,2 / 8,1 |
| multimassa, bordo di riferimento | 676× / 654× | 0,002 | 0,32 / 0,33 | 2,1 / 7,9 |

Dal 7 novembre la linea dell'Appennino ha un merci che precede che è un treno della corsa, con il suo modello multimassa e, con il bordo di riferimento, il suo bordo (decisione 12 di [ROADMAP.md](ROADMAP.md)): il motore calcola due treni, e la corsa dura 1356 s. Ripetute quel giorno sulla macchina B, le tre prove danno 674×, 787× e 539× il tempo reale (2,0, 1,7 e 2,5 s di calcolo), gli scambi con i programmi esterni all'incirca le stesse latenze riportate sotto, e il ciclo agganciato all'orologio nessun passo in ritardo su 12.000.

Il ciclo del bordo di riferimento costa 0,07 ms in mediana e al massimo 2–8 ms. Il suo budget è di 100 ms. I picchi del passo coincidono con le pause del garbage collector di V8: da 53 a 298 pause per corsa, la più lunga di 6–9 ms.

**Scambi con programmi esterni.** Andata e ritorno, primo scambio escluso.

| Canale | Ciclo | p50 | p99,9 | Massimo | Primo scambio |
| :-- | :-: | --: | --: | --: | --: |
| bordo via `exec:` (Node) | 100 ms | 0,24 / 0,17 | 4,0 / 6,7 | 8,7 / 10,2 | 746 / 493 |
| dinamica via `exec:` (Python) | 50 ms | 0,21 / 0,17 | 1,3 / 2,2 | 2,5 / 8,7 | 39 / 27 |
| dinamica via TCP (Python) | 50 ms | 0,22 / 0,19 | 0,8 / 1,2 | 3,0 / 1,8 | 1,5 / 0,5 |
| dinamica via WebSocket (ponte) | 50 ms | 0,12 / 0,08 | 1,4 / 1,3 | 4,3 / 7,6 | 7 / 3 |

Il primo scambio comprende l'avvio del programma esterno: quasi un secondo per un processo Node che compila TypeScript all'avvio.

**Ciclo agganciato all'orologio.** È un prototipo dentro lo script di misura, non nel motore. Esegue un passo ogni 5 ms reali, per 60 s, con il bordo di riferimento, e misura il ritardo di ogni passo rispetto al momento in cui era dovuto.

| Macchina | Ritardo p50 | p99 | p99,9 | Massimo | Passi in ritardo oltre 5 ms |
| :-- | --: | --: | --: | --: | --: |
| A | 0,0002 | 0,001 | 0,02 | 0,3 | 0 su 12 000 |
| B | 0,0002 | 0,5 | 2,7 | 9,6 | 2 su 12 000 |

## Cosa vogliono dire

**La potenza di calcolo non è il problema.** Il motore è da 500 a 1500 volte più veloce del tempo reale, e lo resta anche con un bordo e una dinamica esterni. Un passo costa qualche microsecondo su un budget di 5 ms. Anche il ciclo del bordo e gli scambi con i programmi esterni stanno sotto il millisecondo in mediana.

**Il problema sono le code della distribuzione.** In Node le pause del garbage collector e la pianificazione del sistema operativo producono ritardi rari di qualche millisecondo. Sulla macchina di sviluppo il ciclo agganciato all'orologio non ne ha avuti in 60 s. Sul contenitore cloud due passi su 12 000 sono arrivati con più di 5 ms di ritardo, il peggiore con 9,6 ms. Un ritardo così non fa perdere passi, perché il ciclo li recupera subito, ma sposta nel tempo ciò che il bordo vede.

**Quanto pesa un ritardo dipende dalla velocità.** A 300 km/h il treno percorre 8,3 cm in un millisecondo. Un ritardo di 10 ms sposta quindi di circa 80 cm il momento in cui il bordo vede una boa o un nuovo valore dell'odometria. Per una supervisione con cicli di 100 ms e intervalli di confidenza di metri è poco. Per prove sulla precisione della localizzazione o sull'odometria a impulsi non lo è.

**Queste misure non sono garanzie.** Sono distribuzioni osservate in 60 s su macchine condivise, una delle quali virtuale. Un sistema in tempo reale stretto richiede un limite superiore dimostrato, e Node su un sistema operativo generico non lo dà.

## Cosa se ne ricava

Ci sono tre livelli, in ordine di difficoltà.

1. **Tempo reale morbido, con un EVC simulato o software.** Bastano cicli di 50–100 ms e una precisione di decine di centimetri. Node è sufficiente, come mostrano le misure. Serve una modalità del motore agganciata all'orologio, in cui il motore non aspetta più le risposte: usa l'ultima uscita ricevuta, come farebbe l'interfaccia treno, e registra a che tempo è arrivata.
2. **Banco con hardware vero (HIL) a livello di messaggi.** Il collegamento passa da rete o seriale, con cicli dell'ordine delle decine di millisecondi. È ancora fattibile in Node, a patto di un computer dedicato e non virtualizzato, e di misurare il ritardo di ogni scambio nella corsa stessa, così che ogni prova dichiari la propria precisione temporale.
3. **Banco con segnali fisici:** impulsi dell'odometro, telegrammi verso un'antenna, linee della TIU. Servono tempi garantiti nell'ordine dei microsecondi. Non va fatto in Node: ci vuole un processo dedicato, in C o Rust su un kernel PREEMPT_RT o su un microcontrollore, che generi i segnali, con il motore che gli passa lo stato a qualche millisecondo di distanza.

Il punto più importante per il metodo è un altro. **Il tempo reale e il determinismo non stanno insieme.** Se il motore non aspetta le risposte, il risultato dipende da quando arrivano, e due corse non sono più identiche bit per bit. In tempo reale la ripetibilità va recuperata in un altro modo: registrando ingressi e uscite con i loro tempi, così da poter rigiocare la corsa al passo e confrontarla. Sono due esperimenti diversi, e vanno dichiarati come tali.

## Limiti delle misure

- Le macchine erano entrambe a 2 nuclei, e la A è una macchina virtuale.
- La pagina web non è stata misurata: lì il ciclo è legato ai fotogrammi, e ogni programma esterno riceve al massimo uno scambio per fotogramma.
- Il ciclo agganciato all'orologio è un prototipo di misura con un'attesa attiva nell'ultimo millisecondo, che occupa un nucleo.
