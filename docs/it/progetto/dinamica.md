# Dinamica del treno

> Copia italiana di [dynamics.md](../../design/dynamics.md). In caso di differenze fa fede il testo inglese.

## Scopo

Calcolare come si muove il treno sotto la trazione e la frenatura comandate, le resistenze al moto, la pendenza e le curve, con fedeltà sufficiente a misurare ciò che conta per la guida automatica e il comfort: tempi di arrivo, energia, precisione di fermata, forze negli aggancianti e jerk. La derivazione completa, con grafici e un laboratorio interattivo, è nella pagina del modello (`dist/model.html`); la sintesi è in [MODELLO.md](../MODELLO.md).

## Codice

`src/core/dynamics.ts` contiene i due modelli interni (`dynamicsPoint`, `dynamicsMulti`), la co-simulazione con un modello esterno (`dynamicsDue`, `dynamicsRequest`, `dynamicsResponse` e l'interpolazione di `dynamicsExternal`) ed `effectiveCommands`, i comandi che arrivano a trazione e freni dopo emergenza, protezione, uscite del bordo, porte e guasto. `Simulation` chiama `advanceDynamics` per ogni treno a ogni passo e tiene le tre funzioni di scambio come suoi metodi pubblici. Qui è definito `FIXED_DT`, il passo di 5 ms. La composizione (veicoli, masse, organi di aggancio, coefficienti di Davis, Röckl) la costruisce `consist.ts`.

## Modelli

| `model` | Cosa simula | Quando usarlo |
| :-- | :-- | :-- |
| `multimass` (predefinito) | una catena di veicoli uniti da aggancianti con gioco, rigidezza e smorzamento | ricerca, comfort, treni merci |
| `point` | una sola massa equivalente | didattica, valori di riferimento delle prime versioni |
| `external` | nulla: lo stato viene da un programma esterno in co-simulazione | MATLAB/Simulink o altri modelli |

## Modello multimassa

Ogni veicolo i ha massa m_i, lunghezza L_i e un indicatore di motorizzazione (`consist`). Lo stato è posizione e velocità di ogni veicolo (`MultiState`: posizioni, velocità, forze negli aggancianti T). A ogni passo:

1. **Trazione**: lo sforzo comandato, limitato dallo sforzo di spunto e dalla potenza alla ruota, è diviso fra i veicoli motori in proporzione alla massa e limitato su ciascuno dall'aderenza μ(v)·m_i·g, con il fattore di velocità di Curtius–Kniffler e la condizione della rotaia. Superarla accende l'indicatore di slittamento e taglia lo sforzo.
2. **Frenatura**: la decelerazione comandata per la massa equivalente dà la forza totale, divisa per massa. Ogni veicolo riceve il comando dopo x_i/v_prop (freno pneumatico) o subito (elettropneumatico) e lo applica con una risposta del primo ordine (costanti di tempo di applicazione e di rilascio). Il freno elettrico copre la prima parte della forza e recupera energia; l'antipattinamento limita la forza al 95% dell'aderenza.
3. **Resistenze**: Davis A e B per massa, C per il 35% sul primo veicolo e il resto uniforme, moltiplicata per `kTunnel` in galleria; resistenza in curva di Röckl; pendenza sotto il baricentro di ogni veicolo.
4. **Aggancianti**: `couplerForce(e, de, coupler)` è nulla entro ±gioco/2 e molla più smorzatore oltre, senza mai cambiare segno per effetto dello smorzatore.
5. **Integrazione**: Eulero semi-implicito per tutti i veicoli insieme, con il passo fisso di 5 ms. Un veicolo fermo resta fermo finché la forza che lo spinge non supera freno e resistenza al distacco.

Velocità e posizione della testa sono quelle del primo veicolo; velocità della coda, trazione e compressione massime negli aggancianti e jerk in testa sono registrati per l'osservazione, il CSV e i criteri.

## Punto materiale

Una sola massa con il fattore delle masse rotanti, sforzo limitato da forza, potenza e aderenza costante sulla quota motrice, frenatura limitata dall'aderenza su tutti gli assi con la risposta del primo ordine, pendenza mediata sotto l'intero treno. È tenuto identico alla prima versione del nucleo: `verify-ato` ne conserva i valori di riferimento.

## Dinamica esterna

Con `external` il motore non integra niente. A ogni intervallo di accoppiamento (`external.period_s`, predefinito 50 ms, multiplo di 5 ms) manda `dynamicsRequest()`: i comandi come arrivano al treno dopo la protezione, il binario intorno al treno (pendenze, curve, gallerie, aderenza reale), i fattori dei guasti e, all'avvio, tutti i parametri del treno. La risposta dà lo stato della testa alla fine dell'intervallo; il motore interpola sui passi da 5 ms. Il modello è l'unica fonte dello stato del treno. Vedi [DINAMICA_ESTERNA.md](../DINAMICA_ESTERNA.md) e [protocolli.md](protocolli.md).

## Invarianti

- Il passo d'integrazione è fisso; dimezzarlo non deve cambiare lo spazio di frenatura di più dello 0,5% (controllato).
- I risultati del punto materiale non devono cambiare se non di proposito, con i valori di riferimento aggiornati nello stesso commit.
- `examples/dynamics_point.js` deve riprodurre il punto materiale interno quando accoppiato ogni 5 ms.

## Test

`verify-physics` (spazio di frenatura in forma chiusa, velocità di equilibrio, avviamento sul 25 ‰, frenatura limitata dall'aderenza, entrambi i modelli), `verify-dynamics` (treno giocattolo di Gîlcă e Borcoși contro la teoria, frequenza propria, equilibrio statico, compressione con freno pneumatico ed elettropneumatico, convergenza del passo, multimassa contro punto materiale, Röckl e Curtius–Kniffler), `verify-external-dynamics` (punto materiale esterno equivalente all'interno, trasporti, determinismo).

## Limiti noti ed estensioni

Niente isteresi d'attrito negli organi di trazione e repulsione, niente modello di contatto basato sul creep (Polach), niente calcolo della pressione in condotta, solo moto longitudinale. Estensioni naturali: organi a attrito, aderenza di Polach, modello pneumatico della condotta, importazione di FMU per i modelli esterni.
