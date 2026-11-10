# Strumenti

> Copia italiana di [tools.md](../../design/tools.md). In caso di differenze fa fede il testo inglese.

## Runner senza grafica (`src/server/headless.ts`)

Esegue una o più corse senza grafica, con un controllore JavaScript o WebSocket, scenari facoltativi (un file o una cartella) e qualsiasi combinazione di dinamica esterna, bordo e terra. Le opzioni sono lette da `parseArgs()`, che accetta i nomi inglesi e quelli italiani della versione 0.x (`OPTION_ALIASES`, `VALUE_ALIASES`). Con `--output` scrive per ogni corsa il CSV, gli eventi (`_events.json`) e il riepilogo (`_summary.json`), più `summary.json` per l'insieme. `--controller-params` passa a un controllore JavaScript un oggetto JSON come variabile globale `PARAMS` (`loadJsController(file, globals)`), come `examples/driver_model.js` legge profilo e seme. Esporta i caricatori e i trasporti usati dagli script: `loadScenarios`, `loadLine`, `loadTrain`, `loadJsController`, `connectWsController`, `loadJsDynamics`, `loadJsOnboard`, `openChannel`, `spawnDynamics`, `connectDynamics`.

## Ambiente per agenti (`src/server/agent-env.ts`)

`AgentEnv` prepara una corsa con i treni di un agente (`reset`) e la fa avanzare decisione per decisione (`step`), guidando gli altri treni con l'ATO interno; eseguito come processo (`npm run agent-env`) parla righe JSON su stdin/stdout. `examples/agents/yutreno_env.py` lo avvolge come ambiente Gymnasium. Vedi [AGENTI.md](../AGENTI.md).

## Server dei flussi (`src/server/feeds-server.ts`)

`FeedRun` fa avanzare uno scenario con l'ATO interno sul treno guidato; `feedFiles()` restituisce tutti i flussi all'istante corrente. Eseguito come processo (`npm run feeds`) serve GTFS, GTFS-Realtime, SIRI e NeTEx in HTTP mentre la corsa segue l'orologio (`--speed`), oppure con `--at` e `--out` scrive i file a un istante dato. `scripts/feeds-validate.ts` valida l'uscita con gli schemi ufficiali e con il validatore GTFS di MobilityData. Vedi [dati-aperti.md](dati-aperti.md) e [DATI_APERTI.md](../DATI_APERTI.md).

## Importazione degli orari (`src/server/import-timetable.ts`)

`npm run import` legge un archivio GTFS, un documento NeTEx o un orario railML e scrive uno scenario con i suoi servizi, abbinati alle stazioni della linea, oppure sostituisce i servizi di uno scenario esistente conservando treno, conducente e soste minime di quelli con lo stesso numero. Vedi [DATI_APERTI.md](../DATI_APERTI.md#importare-un-orario).

## Ponte (`src/server/bridge.ts`)

Un server WebSocket minimo per la pagina, che sa parlare solo WebSocket: ogni connessione è inoltrata a un server TCP (`--tcp`), a un processo avviato per connessione (`--exec`) o servita da un modello JavaScript (`--model`). `--protocol 1` traduce le richieste della pagina nel formato italiano per i programmi della versione 0.x. `npm run ponte` e le opzioni italiane restano come alias.

## Campagna di misura (`scripts/campaign.ts`)

Esegue la matrice bordo × ATO × scenario × guasti × parametri di una configurazione (`campaigns/reference.json`), calcola le misure di ogni corsa, le impronte di ingressi e uscite, il riepilogo per cella, e ripete una corsa nello stesso processo, in un processo nuovo e con il bordo come processo esterno per controllare il determinismo. Uscite in `results/campaign-<nome>/`; `--run` esegue un caso solo, `--details` conserva CSV ed eventi. Vedi [CAMPAGNA.md](../CAMPAGNA.md).

## Campagna del servizio (`scripts/service-campaign.ts`)

Esplora linee, numero di treni, distanziamenti, sensi, segnalamento e domanda di passeggeri di `campaigns/services.json`, ogni corsa una configurazione di scenario; `runs.csv` con misure di puntualità, passeggeri, energia e segnalamento e un'impronta per corsa, `thresholds.csv` con il distanziamento da cui nessun treno è trattenuto dal segnalamento quando le corse differiscono solo per il distanziamento (`campaigns/headway-sweep.json`), `determinism.csv`. Vedi [CAMPAGNA.md](../CAMPAGNA.md#campagna-del-servizio).

## Campagna dei macchinisti (`scripts/driver-campaign.ts`)

Esegue i profili di `examples/driver_model.js` con più semi e i controllori di riferimento di `campaigns/drivers.json` sui suoi scenari e bordi; `runs.csv`, `summary.csv` con media e deviazione standard per macchinista e bordo, `determinism.csv` (lo stesso seme di nuovo, un altro seme). Vedi [MODELLO_MACCHINISTA.md](../MODELLO_MACCHINISTA.md#la-campagna-dei-macchinisti).

## Validazione delle curve (`scripts/curve-validation.ts`)

Genera, per i casi a bersaglio singolo di `validation/cases.json`, le distanze a cui ogni curva del bordo di riferimento vale un insieme di velocità; crea il modulo per lo strumento ERA; confronta i due. Vedi [VALIDAZIONE_CURVE.md](../VALIDAZIONE_CURVE.md).

## Misure di tempo reale (`scripts/measure-realtime.ts`)

Misura il costo del passo, del ciclo di bordo, degli scambi di andata e ritorno con programmi esterni, le pause del garbage collector e un ciclo agganciato all'orologio. I risultati dipendono dalla macchina e vanno in `results/realtime/`. Vedi [TEMPO_REALE.md](../TEMPO_REALE.md).

## Tracciabilità (`scripts/traceability.ts`)

Raccoglie i tag `// @test <id>: <titolo> [<requisiti>]` degli script di verifica, scrive `docs/traceability/tests.csv`, riempie la colonna `tests` di `docs/traceability/matrix.csv` e controlla la copertura: ogni requisito citato esiste, ogni riga implementata o semplificata ha un test su sé stessa o su una sottoclausola. `--check` controlla soltanto; `verify-traceability` esegue lo stesso controllo dentro `npm run verify`.

## Controlli (`scripts/verify-*.ts`, `scripts/run-verify.mjs`)

`npm run verify` esegue tutti gli script di verifica, tanti insieme quanti sono i processori, i più lunghi per primi, e stampa l'uscita di ciascuno quando finisce; fallisce se uno fallisce. `--jobs 1` li esegue uno dopo l'altro con l'uscita mentre arriva, e `node scripts/run-verify.mjs <nome> ...` ne esegue alcuni. Ogni verifica è un processo a sé, quindi eseguirle insieme non cambia i loro dati. Le verifiche condividono il ciclo del guidatore automatico (`scripts/lib/drive.ts`).

## Golden master (`scripts/golden.ts`, `golden/fingerprints.json`)

`npm run golden` esegue ogni scenario di `scenarios/` e ogni configurazione di `examples/scenario-config/` con `examples/ato.js`, così come sono scritti e con ETCS, blocco automatico, bordo di riferimento, terra con apparato e regolatore di riferimento, più la campagna di riferimento e quella del servizio: 234 corse, circa dieci minuti su due core. `--quick` esegue solo gli scenari e le configurazioni così come sono scritti (27 corse, circa un minuto), e `npm run verify -- --quick` solo le verifiche brevi (13, circa 40 s): per il lavoro di tutti i giorni, mentre l'insieme completo resta obbligatorio prima di un commit. Di ogni corsa tiene un'impronta per parte (campioni di ogni treno, eventi, orario realizzato, passeggeri, riepiloghi e verdetti, comandi del dirigente, un'istantanea della sala di controllo ogni 60 s), così una differenza nomina la corsa e la parte. Una variante uguale allo scenario com'è scritto è registrata come `same_as`, e una che il motore rifiuta con il suo errore. È la rete di sicurezza del refactoring della fase 8: ogni passo deve lasciare il file invariato. Un cambiamento di comportamento voluto lo riscrive con `--update`, nello stesso commit. L'elenco e cosa controlla ciascuno sono nel [README](../README.md). Gli script di verifica provano il simulatore, non i controllori.

## Build e immagini (`scripts/build.mjs`, `scripts/screenshots.mjs`)

esbuild impacchetta l'interfaccia e la pagina del modello; la build scrive `dist/index.html`, `dist/yutreno.html`, `dist/artifact.html`, `dist/model.html` e `dist/model-artifact.html`. Lo script delle immagini guida la pagina costruita con Playwright per rigenerare `docs/img/`.

## Docker (`docker/`)

Un ambiente di prova completo: Node, Python, Octave e il codice openETCS compilato; all'avvio `demo.sh` esegue una campagna su tutti i modi di collegare programmi esterni e `report.mjs` scrive un resoconto HTML; poi `start.sh` serve il simulatore e avvia i due ponti. Vedi [DOCKER.md](../DOCKER.md).
