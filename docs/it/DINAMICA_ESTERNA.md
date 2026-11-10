# Dinamica del treno da un modello esterno

> Copia italiana. Il documento di riferimento è la versione inglese [EXTERNAL_DYNAMICS.md](../EXTERNAL_DYNAMICS.md): nomi di file, comandi e formati seguono quella; i nomi italiani della versione 0.x (campi JSON, opzioni come `--linea` o `--bordo`) restano accettati.

YuTreno può affidare la dinamica del treno a un programma esterno: un modello MATLAB/Simulink, uno script Python, qualsiasi cosa sappia leggere e scrivere JSON. Il motore continua a occuparsi del resto, cioè linea, segnalamento, supervisione ETCS o SCMT, treno che precede, scenari con i loro guasti, fermate, vigilanza e verdetto. Al modello esterno chiede soltanto dove si trova il treno e a che velocità va.

È una co-simulazione. Il tempo è diviso in intervalli di accoppiamento, per esempio 50 ms. All'inizio di ogni intervallo il motore manda al modello una richiesta con i comandi e il tratto di linea attorno al treno. Il modello integra le sue equazioni fino alla fine dell'intervallo e risponde con lo stato raggiunto. Il motore attraversa poi l'intervallo a passi di 5 ms, interpolando fra lo stato di partenza e quello ricevuto. A ogni passo controlla segnali, curve di supervisione, fermate e superamenti, come con i modelli interni.

## Perché funziona così

Il motore è il *master* della co-simulazione e il modello è lo *slave*, nella terminologia di FMI. Questa scelta ha tre conseguenze.

La prima riguarda gli ingressi: restano costanti nell'intervallo (*zero-order hold*). Se a metà intervallo la protezione comanda l'urgenza, il modello la riceve all'inizio dell'intervallo successivo. Con 50 ms il ritardo massimo è più piccolo del tempo morto del freno (2 s per la curva d'intervento ETCS), quindi non conta per la supervisione. Si può comunque ridurre l'intervallo fino a 5 ms.

La seconda riguarda il determinismo. La simulazione si ferma a ogni scambio e riparte solo con la risposta, quindi il risultato non dipende dalla velocità del modello né dalla rete. Se il modello è deterministico, due corse uguali danno dati identici.

La terza è che il modello esterno è l'unica fonte dello stato del treno. Il motore non corregge la posizione né la velocità ricevute: le usa e basta.

## Richiesta

A ogni intervallo il motore invia un oggetto JSON come questo (i numeri sono di esempio):

```json
{
  "type": "dynamics", "version": 2, "start": false,
  "t": 12.35, "dt": 0.05,
  "state": { "pos_m": 412.7, "vel_ms": 9.81 },
  "commands": { "traction": 0.6, "brake": 0, "emergency": false, "doors_open": false },
  "track": {
    "from_m": 252.7, "to_m": 912.7, "adhesion_mu": 0.3,
    "gradients": [[252.7, 1800, 0], [1800, 912.7, 6.4]],
    "curves": [[600, 830, 1210]],
    "tunnels": []
  },
  "faults": { "brake_factor": 1, "traction_factor": 1 }
}
```

`start` è vero solo alla prima richiesta della corsa. In quella richiesta c'è anche `train`, con tutti i parametri del treno della scheda *Train*: massa, Davis, potenza, freni e, se c'è, la composizione con gli accoppiatori. Il modello deve azzerarsi e partire da `state`.

`t` e `dt` sono l'inizio e la durata dell'intervallo. `state` è lo stato restituito dalla risposta precedente e serve solo come controllo: il modello tiene il proprio.

`commands` contiene ciò che arriva davvero agli organi del treno, dopo la protezione. In urgenza la trazione è zero, il freno è 1 e `emergency` è vero. Con la frenatura comandata da ETCS o con le porte aperte la trazione è già azzerata.

`track` descrive la linea da `from_m`, 50 m dietro la coda, ad `to_m`, 500 m davanti alla testa (l'orizzonte si cambia con `external.horizon_m`). Le pendenze sono in per mille, positive in salita. Le curve sono i tratti con raggio sotto i 20 km, arrotondato a 10 m; i rettifili non compaiono. `adhesion_mu` è l'aderenza reale sotto il treno, comprese le zone di aderenza ridotta degli scenari, che il macchinista non conosce.

`faults` porta i fattori dei guasti degli scenari (freno degradato, trazione ridotta). Il modello li applica alle forze; se li ignora, quegli scenari non hanno effetto.

Con i passeggeri nello scenario ([PASSEGGERI.md](PASSEGGERI.md)) ogni richiesta porta anche `payload_kg`, la massa delle persone a bordo, che cambia a ogni fermata; `train.m` è allora la massa senza passeggeri. Il modello aggiunge `payload_kg` alla massa e alla massa equivalente (le persone non ruotano); i modelli d'esempio lo fanno. Senza passeggeri il campo manca.

Un modello scritto per la versione 0.x si aspetta la richiesta con i nomi italiani (`tipo`, `versione: 1`, `stato`, `comandi`, `binario`…): la riceve con `--protocol 1` nelle corse senza grafica e nel ponte. La sua risposta può usare i nomi di entrambe le lingue.

## Risposta

Il modello risponde con lo stato della testa del treno alla fine dell'intervallo:

```json
{
  "pos_m": 413.2, "vel_ms": 9.83,
  "acc_ms2": 0.31,
  "forces_kN": { "traction": 98.1, "brake": 0, "electric_brake": 0, "resistance": 5.6, "gradient": 0 },
  "slip": false, "wsp": false,
  "tail_speed_ms": 9.80,
  "coupler_forces_kN": [12.1, 8.3, 4.0],
  "traction_energy_kWh": 1.42, "regenerated_energy_kWh": 0,
  "note": "optional text for the log"
}
```

Solo `pos_m` e `vel_ms` sono obbligatori. Gli altri campi alimentano il DMI, il pannello delle forze, il CSV, gli indicatori di slittamento e i criteri degli scenari sulle forze negli accoppiatori e sullo strappo. Le energie sono cumulative dall'inizio della corsa; se mancano, il motore le stima dalle forze. Una risposta senza posizione o velocità numeriche ferma la corsa con un errore.

## Collegare un modello

**Corse senza grafica.** È il modo più veloce e quello adatto alle campagne di prove:

```bash
npm run headless -- --dynamics tcp://localhost:5555 --coupling 0.05
npm run headless -- --dynamics ws://localhost:8766
npm run headless -- --dynamics examples/dynamics_point.js        # modello JavaScript nello stesso processo
npm run headless -- --dynamics "exec:octave-cli -q examples/octave/yutreno_dynamics.m"     # il motore avvia Octave
npm run headless -- --dynamics "exec:python examples/python/yutreno_dynamics.py --stdio"   # il motore avvia Python
npm run headless -- --scenario scenarios --dynamics tcp://localhost:5555   # tutti gli scenari con il tuo modello
```

`--dynamics` porta il treno sul modello `external`; tutte le altre opzioni restano valide, compresi controllori e scenari. Con `tcp://` ogni messaggio è una riga di JSON terminata da un a capo, il formato più semplice per MATLAB. Il motore è il client e il modello deve essere già in ascolto.

**Nella pagina.** Nella scheda *Train* si sceglie il modello di calcolo *External via API*, l'indirizzo WebSocket e l'intervallo di accoppiamento, poi *Apply and restart*. Il browser parla solo WebSocket, quindi per un modello su TCP serve il ponte:

```bash
npm run bridge -- --tcp localhost:5555                   # pagina → ws://localhost:8766 → MATLAB su TCP
npm run bridge -- --model examples/dynamics_point.js   # il ponte risponde con un modello JavaScript
npm run bridge -- --exec "octave-cli -q examples/octave/yutreno_dynamics.m"   # un processo Octave per ogni corsa
```

La pagina va aperta in locale (`npm run dev` o `dist/yutreno.html`), perché quella pubblicata blocca le connessioni di rete. Lo stato del collegamento compare sopra la vista dalla cabina. La pagina fa al massimo uno scambio per fotogramma, cioè circa 60 al secondo, quindi un accoppiamento di 50 ms tiene il tempo reale fino a circa tre volte la velocità normale.

## Processo avviato dal motore

Con `exec:` non serve nessun server. Il motore avvia il comando indicato e gli parla sui flussi standard: scrive ogni richiesta su stdin come una riga di JSON e legge ogni risposta da stdout, sempre una riga. Quando la corsa finisce chiude stdin, e il modello termina alla prima lettura vuota. Lo stderr del modello compare sulla console del motore: è il canale per i messaggi e la diagnostica. stdout invece è riservato al protocollo, e una stampa qualsiasi lo interromperebbe.

È il collegamento più semplice per i linguaggi interpretati, perché basta un ciclo di lettura e scrittura e non servono librerie di rete. Funziona allo stesso modo su Windows, macOS e Linux, purché il comando sia raggiungibile dal terminale.

## Python

`examples/python/yutreno_dynamics.py` contiene il punto materiale di YuTreno scritto in Python con la sola libreria standard. La funzione `step(req, mem)` è quella da sostituire con il proprio modello, per esempio con un integratore di SciPy o con una rete neurale. Lo script si collega in due modi:

```bash
npm run headless -- --dynamics "exec:python examples/python/yutreno_dynamics.py --stdio"   # avviato dal motore
python examples/python/yutreno_dynamics.py 5555                                            # server TCP, poi:
npm run headless -- --dynamics tcp://localhost:5555
```

Il server TCP serve quando il modello deve restare acceso fra una corsa e l'altra, o girare su un'altra macchina.

## Octave

`examples/octave/yutreno_dynamics.m` è lo script per GNU Octave, dalla versione 7, che ha `jsondecode` e `jsonencode` senza pacchetti aggiuntivi. Legge le richieste da stdin e usa la stessa funzione di passo della versione MATLAB (`examples/matlab/yutreno_step_point.m`), quindi un modello scritto per uno funziona anche con l'altro. Per usare il proprio basta cambiare la riga `step = @yutreno_step_point;`.

```bash
npm run headless -- --dynamics "exec:octave-cli -q examples/octave/yutreno_dynamics.m"
npm run bridge -- --exec "octave-cli -q examples/octave/yutreno_dynamics.m"     # per la pagina
```

Su Windows `octave-cli` si trova nella cartella `bin` dell'installazione di Octave; se non è nel PATH, si scrive il percorso completo dentro le virgolette. Con il punto materiale di esempio, la corsa di prova (quasi un quarto d'ora simulato, 17 500 scambi) dura circa mezzo minuto e dà gli stessi risultati del modello JavaScript. Octave interpreta i cicli più lentamente di Python: con un modello più pesante conviene un accoppiamento più largo, per esempio `--coupling 0.1`, oppure scrivere il modello in forma vettoriale.

Un dettaglio tecnico, utile per chi scrive il proprio script: su una pipe `fgetl(stdin)` di Octave aspetta la riga successiva prima di restituire quella corrente, e lo scambio al passo si bloccherebbe. Lo script usa perciò `input('', 's')`, che restituisce la riga appena arriva.

## MATLAB e Simulink

In `examples/matlab/` ci sono tre file.

`yutreno_dynamics_server.m` mette MATLAB in ascolto su TCP con `tcpserver`, da R2021a in poi. Per ogni riga ricevuta la decodifica con `jsondecode`, chiama la funzione di passo e risponde con `jsonencode`:

```matlab
yutreno_dynamics_server(5555)                              % punto materiale di esempio
yutreno_dynamics_server(5555, @yutreno_step_simulink)     % il tuo modello Simulink
```

`yutreno_step_point.m` è il punto materiale di YuTreno riscritto in MATLAB. È la funzione da sostituire: riceve la richiesta e lo stato del modello e restituisce risposta e stato aggiornato.

`yutreno_step_simulink.m` è lo schema per un modello Simulink esistente. Ogni intervallo è una chiamata a `sim` da `t` a `t + dt`, che riparte dall'*operating point* salvato alla fine di quella precedente. Gli ingressi passano come variabili del workspace e le uscite tornano con blocchi *To Workspace*. È il collegamento più semplice, ma ogni chiamata a `sim` ha un costo fisso anche con Fast Restart, e una corsa di un quarto d'ora a 50 ms fa circa 17 500 scambi. Per lavorare comodi conviene un accoppiamento di 0,1–0,2 s, oppure una delle strade più veloci:

- tradurre il modello in una funzione MATLAB (o generarne il codice) e chiamarla direttamente dalla funzione di passo, senza `sim`;
- far girare il modello Simulink per tutta la corsa, con blocchi di comunicazione TCP che si sincronizzano con YuTreno a ogni passo di accoppiamento;
- esportare il modello come FMU per la co-simulazione (FMI 2.0). Leggere le FMU direttamente nel motore è uno sviluppo possibile per YuTreno: il protocollo descritto qui ricalca già il ciclo `doStep` di FMI.

Il server MATLAB non è stato provato in MATLAB, perché qui non è disponibile. La funzione di passo `yutreno_step_point.m` è però la stessa che usa l'esempio Octave, provato su corse complete. Il protocollo TCP è provato con l'esempio Python e nelle verifiche.

## Verifiche

`scripts/verify-external-dynamics.ts` controlla che il punto materiale riscritto come modello esterno (`examples/dynamics_point.js`) riproduca il modello interno su tutte le linee e i segnalamenti. Con accoppiamento di 5 ms i risultati coincidono ai centesimi: tempi di arrivo, energia ed errori di fermata. Con 50 ms l'arrivo si sposta di qualche centesimo di secondo e l'energia di meno dello 0,1%. La verifica controlla anche il determinismo, il rifiuto di avanzare senza risposta e il contenuto delle richieste. Prova infine i due trasporti a righe di JSON, TCP e processo su stdin/stdout, che devono dare gli stessi dati della chiamata diretta.

Il punto materiale esterno è anche il miglior punto di partenza per un modello nuovo. Si cambia una parte alla volta e si confronta la corsa con quella del modello interno, con gli stessi scenari e lo stesso controllore.
