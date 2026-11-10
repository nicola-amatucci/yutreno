# Guida agli scenari: da zero all'esecuzione

> Copia italiana di [SCENARIO_GUIDE.md](../SCENARIO_GUIDE.md). In caso di differenze fa fede il testo inglese.

Questa guida porta da una cartella vuota a uno scenario proprio, eseguito senza grafica, eseguito nella pagina e, se si vuole, aggiunto a YuTreno come scenario incluso con il suo esito atteso nei controlli. Segue un solo esempio dall'inizio alla fine: pioggia sulla linea Appennino e un rallentamento per cantiere nella discesa dopo il valico. L'esempio è nel repository come `scenarios/wet-descent-worksite.json`, quindi ogni comando qui sotto si può eseguire così com'è. Il riferimento per il formato è [SCENARI.md](SCENARI.md).

## 1. Installare e controllare

Servono Node.js 22 o successivo e git.

```bash
git clone <repository> yutreno
cd yutreno
npm install
npm run verify        # facoltativo: tutti i controlli, qualche minuto
```

`npm run verify` non serve per scrivere scenari, ma dice che l'installazione funziona: finisce con `All 23 checks passed`, con il tempo impiegato.

## 2. Decidere cosa deve provare lo scenario

Uno scenario è un esperimento: deve rispondere a una domanda. Va scritta prima, in una frase. Per l'esempio: *il controllore d'esempio rispetta un rallentamento annunciato con poco preavviso, in discesa, con rotaia bagnata, senza che la protezione intervenga e restando nel suo margine di ritardo?*

Dalla domanda seguono le scelte:

- **linea**: `appennino`, perché ha una lunga salita fino alla stazione di valico di Valico (km 12+650) e una discesa verso Piano Alto (km 18+200);
- **treno**: `regional`;
- **segnalamento e bordo**: ETCS livello 2 con il bordo `reference`, che costruisce le curve del Subset-026 dai messaggi del RBC;
- **condizioni**: `rain`, che con `adhesion: auto` dà rotaia bagnata (μ 0,20);
- **eventi**: un messaggio al macchinista e un rallentamento a 60 km/h fra il km 14+000 e il km 15+500, entrambi attivati quando la testa passa il km 12+900, appena dopo la partenza da Valico;
- **criteri**: al massimo 540 s di ritardo e fermate entro 3 m dalla palina, oltre a quelli predefiniti (arrivo, nessuna fermata saltata, nessun intervento, nessun superamento, nessuna vigilanza mancata). Il margine di ritardo è ampio perché la linea ha un merci che precede, che il regionale segue in salita; per studiare il solo rallentamento si aggiunge `"leader": { "on": false }`.

Per guardare una linea si apre la pagina (`npm run dev`), si va nella scheda *Line* e la si sceglie nel menu: pianta, profilo, stazioni, limiti e gallerie sono tutti lì. Le linee incluse sono definite in `src/core/presets.ts`.

## 3. Scrivere il file

Si crea `my-scenarios/wet-descent.json`:

```json
{
  "name": "Wet rail and a worksite on the descent",
  "description": "Rain on the Appennino line: wet rail all along and, after the summit station of Valico, a 60 km/h worksite restriction on the descent towards Piano Alto, announced to the driver as he leaves Valico.",
  "line": "appennino",
  "train": "regional",
  "signalling": "ETCS",
  "onboard": "reference",
  "weather": "rain",
  "events": [
    { "type": "message", "when": { "pos": 12900 }, "text": "Worksite ahead: 60 km/h from km 14+000 to km 15+500" },
    { "type": "speed_restriction", "from_m": 14000, "to_m": 15500, "v_kmh": 60, "when": { "pos": 12900 } }
  ],
  "criteria": { "delay_max_s": 540, "stop_error_max_m": 3 }
}
```

Le posizioni sono progressive in metri dall'origine della linea, riferite alla testa del treno. Un evento senza `when` è attivo dall'inizio; con `when` si attiva a un tempo (`t`, secondi), a una posizione (`pos`, metri) o quando sono raggiunti entrambi. `duration_s` lo chiude dopo quel tempo. Il formato del 0.x con i nomi italiani (`tipo`, `quando`, `criteri`…) è ancora accettato.

## 4. Validare

Lo si esegue una volta senza grafica. Se il file ha errori, il runner li elenca tutti e si ferma prima di eseguire qualsiasi cosa:

```text
$ npm run headless -- --scenario my-scenarios/broken.json
my-scenarios/broken.json: event 1: from_m and to_m are needed, with to_m > from_m; event 2: unknown type «fog» (available: radio_loss, speed_restriction, low_adhesion, brake_degraded, traction_reduced, leader_stopped, rbc_emergency_stop, message, point_failure, tvps_failure, operator_command, train_stopped, line_blocked, dispatch)
```

La stessa validazione avviene nella pagina quando si applica uno scenario JSON.

## 5. Eseguire senza grafica

```text
$ npm run headless -- --scenario my-scenarios/wet-descent.json --output runs
Wet rail and a worksite on the descent     PASSED  arrival  1570 s, mean stopping error 1.56 m, net energy 206.4 kWh
    train ahead leader       PASSED  arrival 1455.4 s, interventions 0, overruns 0
```

Il controllore predefinito è `examples/ato.js`. La seconda riga è il merci che precede, giudicato solo sulla sicurezza della sua corsa. Con `--output runs` il runner scrive tre file per corsa in `runs/` e, con altri treni, anche il loro orario e un CSV e un riepilogo per ciascuno:

- `wet-descent_001_summary.json`: esito, tempo di arrivo, errori di fermata, energia, avvisi, frenature di servizio, interventi, superamenti e l'elenco dei controlli del verdetto, ciascuno con valore e soglia. Per l'esempio: arrivo con 460 s di ritardo su un limite di 540 s, errore di fermata massimo 2,5 m su 3 m;
- `wet-descent_001_events.json`: il registro degli eventi, con tempo, posizione, tipo e testo. Mostra il messaggio e il rallentamento attivati al km 12+900, 1199 s dopo la partenza, e le tre fermate;
- `wet-descent_001.csv`: una riga ogni 0,5 s di tempo simulato con posizione, velocità, curve di supervisione, comandi, forze, aderenza, energia, modo del bordo e LRBG. Si apre in qualunque foglio di calcolo o in pandas.

Le corse sono deterministiche: eseguendo il comando due volte i CSV sono identici byte per byte.

## 6. Variare l'esperimento

La riga di comando prevale sullo scenario, quindi lo stesso file risponde a più domande:

```bash
npm run headless -- --scenario my-scenarios/wet-descent.json --controller examples/ato_s130.js     # l'ATO che usa i dati del Subset-130
npm run headless -- --scenario my-scenarios/wet-descent.json --onboard internal                     # la supervisione semplificata
npm run headless -- --scenario my-scenarios/wet-descent.json --trackside interlocking               # autorizzazione da un apparato
npm run headless -- --scenario my-scenarios/wet-descent.json --controller ws://localhost:8765       # il proprio controllore in qualsiasi linguaggio
npm run headless -- --scenario my-scenarios                                                         # tutti gli scenari della cartella
```

Per l'esempio anche le prime tre varianti passano; l'ATO Subset-130 arriva 5 s dopo usando 22 kWh in meno, e con l'apparato il regionale supera il merci e arriva 68 s prima.

Per rendere un guasto invisibile al macchinista e ai controllori si aggiunge `"announced": false` all'evento: resta solo nel registro, e il controllore lo scopre dai suoi effetti. I guasti nascosti sono quelli che gli scenari `leaves-ponte-sabato` e `degraded-brake` usano per far fallire il controllore d'esempio.

Con la terra con apparato lo scenario può anche guastare deviatoi e circuiti di binario e mandare comandi del posto centrale (`point_failure`, `tvps_failure`, `operator_command`); gli scenari in `scenarios/trackside/` sono esempi. Treni di servizio con il loro orario, una rete e i passeggeri sono descritti in [SCENARI.md](SCENARI.md#treni-di-servizio) e [PASSEGGERI.md](PASSEGGERI.md).

## 7. Eseguirlo nella pagina

1. Si avvia la pagina con `npm run dev` (o si apre `dist/yutreno.html` dopo `npm run build`).
2. Nella scheda *Scenarios* si incolla il JSON nella casella *JSON definition* e si preme *Apply this JSON and restart*. A sinistra compaiono descrizione, linea, treno e numero di eventi.
3. Nella scheda *Drive* il briefing mostra lo scenario; si preme *Start the service* per guidare, o *Let the controller drive* per affidare il treno al controllore della scheda *Controller and API*.
4. Durante la corsa la scheda *Scenarios* mostra lo stato di ogni evento (in attesa, attivo, concluso) e il verdetto provvisorio; alla fine il resoconto mostra il verdetto finale.

La pagina conserva lo scenario nel browser, quindi alla volta successiva è ancora lì. Per condividerlo si usa *Copy JSON*.

## 8. Farne uno scenario incluso

Se lo scenario merita di restare in YuTreno, tre modifiche lo rendono parte del progetto, e i controlli garantiscono che continui a comportarsi allo stesso modo:

1. si copia il file in `scenarios/` (o in `scenarios/trackside/` se richiede la terra con apparato) con un nome breve in kebab-case, per esempio `scenarios/wet-descent-worksite.json`;
2. lo si aggiunge all'elenco della pagina in `src/web/scenarios.ts`, con un `import` e una voce in `BUILTIN_SCENARIOS`;
3. si registra il suo esito atteso con `examples/ato.js` nella mappa `EXPECTED` di `scripts/verify-scenarios.ts`: `'wet-descent-worksite.json': 'passed'`.

Poi `npm run typecheck` e `npm run verify`. `verify-scenarios` controlla esito e determinismo; `verify-onboard` e `verify-trackside` eseguono anche ogni scenario ETCS con il bordo di riferimento e con la terra con apparato e controllano che il verdetto non cambi. I tre file si committano insieme, per esempio con `feat(scenarios): wet rail and worksite on the Appennino descent`.

L'esito atteso è quello del controllore d'esempio, anche se lo scenario è pensato per farlo fallire: i controlli provano il simulatore, non i controllori.

## 9. Lista di controllo

- Una domanda per scenario, scritta nella descrizione.
- Posizioni in metri dall'origine della linea, riferite alla testa.
- Annunciato o non annunciato: decidere per ogni guasto se il macchinista lo vede.
- Criteri che misurano la domanda, non solo quelli predefiniti.
- Eseguirlo con almeno due controllori o due bordi: uno scenario che ogni combinazione supera allo stesso modo non misura niente.
- Se diventa incluso: file, elenco della pagina, esito atteso, `npm run verify`.
