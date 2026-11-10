# Interfaccia web

> Copia italiana di [web-interface.md](../../design/web-interface.md). In caso di differenze fa fede il testo inglese.

## Scopo

`src/web/` permette a una persona di guidare, modificare linee e treni, preparare scenari, affidare il treno a un controllore e leggere i dati, in una pagina che funziona senza rete da un solo file HTML. Non contiene fisica né segnalamento: legge lo stato del nucleo e gli manda comandi.

## Moduli

| Modulo | Ruolo |
| :-- | :-- |
| `main.ts` | ciclo dei frame, schede, comandi di guida, tastiera, briefing e resoconto, pannelli e tabelle |
| `state.ts` | stato condiviso: configurazione salvata (tradotta dal 0.x al caricamento), simulazione corrente, stato dell'interfaccia e del controllore, formattazione |
| `render.ts` | canvas 2D: DMI, schema di linea, grafico spazio-velocità, forze negli aggancianti, vista di cabina essenziale |
| `view3d.ts` | vista di cabina 3D con Three.js: renderer, luci e atmosfera, il fotogramma (`render3d`) |
| `view3d-state.ts`, `path3d.ts`, `world3d.ts`, `trains3d.ts`, `cab3d.ts` | le parti della vista 3D: stato condiviso (`v3`), la linea nello spazio, il mondo costruito dalla linea compilata, treni e persone e il treno in cui sta la camera, la cabina |
| `scene-fingerprint.ts` | una descrizione della scena 3D per i controlli (`YuTreno.scene3d()`) |
| `controllers.ts` | controllore nel browser in un Web Worker e controllore esterno via WebSocket, entrambi in lockstep |
| `dynamics.ts`, `onboard.ts` | connessioni WebSocket a un modello di dinamica esterno e a un EVC esterno |
| `panel.ts` | quadro del posto centrale della terra con apparato |
| `editors.ts` | editor di linea (pianta, profilo, tabelle) ed editor di treno (parametri, composizione, diagramma di trazione) |
| `scenarios.ts` | scenari inclusi, editor JSON, eventi e verdetto |
| `timetable.ts` | grafico orario (programmato tratteggiato, realizzato continuo), editor dei treni di servizio con trascinamento nel tempo, controlli dell'orario programmato (`checkTimetable`), importazione di GTFS, NeTEx e railML e scaricamento dell'orario in uso nei tre formati (`src/feeds/`) |
| `audio.ts`, `gamepad.ts` | audio procedurale e dispositivi d'ingresso (controller standard, leva USB calibrata) |
| `control-room.ts` | sala di controllo: schema della rete disposto dalla sua topologia (SVG), tabella dei treni, registro e i comandi esistenti, tutto da `sim.controlRoom()` ([SALA_CONTROLLO.md](../SALA_CONTROLLO.md)) |
| `index.html`, `styles.css` | markup e stile; id delle schede `drive`, `line`, `train`, `scenarios`, `timetable`, `control`, `controller`, `data` |

`src/docs/model.ts` e `model.html` costruiscono la pagina del modello di dinamica con grafici e laboratorio calcolati dal nucleo.

## Ciclo dei frame

Con i treni di servizio il ciclo continua finché tutti i treni hanno finito (`sim.done`); il controllore guida solo il treno comandato. `frame()` accumula il tempo reale moltiplicato per l'accelerazione scelta e fa avanzare la simulazione di quanti passi fissi ci stanno, con un tetto per frame. Prima di un passo serve i canali in lockstep: il controllore (`ctlSend`/`ctlReceive`, con timeout di 1,5 s e rilascio dopo tre timeout), il bordo esterno (`obStep`) e la dinamica esterna (`dynStep`); se una risposta è pendente il ciclo si ferma fino al frame successivo. Poi disegna: prima il DMI, perché il suo canvas è anche la texture del banco 3D, poi la vista 3D o 2D, lo schema di linea, il grafico e gli aggancianti; pannelli e tabelle si aggiornano al massimo ogni 100 ms o quando qualcosa è cambiato.

## Vista 3D

Il mondo è una funzione deterministica della linea compilata e di `hash()`: nastro del terreno, massicciata, rotaie, traversine (una finestra istanziata davanti al treno), catenaria, cippi chilometrici, gallerie con i portali, stazioni, segnali o tabelle di arresto, alberi e case, il treno che precede. `sweep()` estrude sezioni lungo il binario; `placeAt()` colloca oggetti per progressiva, scostamento laterale e quota. La cabina è figlia della telecamera. Ogni stazione ha un secondo binario a destra (`track2At`, collegato alla linea da deviatoi ai due capi), un secondo marciapiede con pensilina, cartelli e tabella di arresto, e un sovrappassaggio con due torri scala; in stazione i pali della catenaria stanno oltre il secondo binario. I treni di servizio si costruiscono per corsa (`buildServices`) e si posizionano a ogni frame (`placeServices`): quelli in senso opposto sul secondo binario in stazione, girati. Si ricostruisce solo quando cambiano linea, segnalamento, treno che precede o qualità. Senza WebGL la pagina resta sulla vista 2D.

## Controllori nel browser

Il codice dell'editor gira in un Web Worker costruito da un Blob: definisce `control(obs, mem)` (osservazione versione 3) o, per il codice 0.x, `controllo(oss, mem)` (versione 2). Il worker dice quale ha trovato nel messaggio `ready`, e `ctlSend` chiede al nucleo la versione di osservazione corrispondente. I comandi passano ad `applyCommand`, che accetta entrambe le lingue.

## Persistenza

`store` avvolge `localStorage` e non lancia mai eccezioni. Chiavi: `yutreno-cfg-v1` (configurazione, tradotta con `toEnglish` al caricamento), `yutreno-ctl-code`, `yutreno-onboard-url`, `yutreno-view`, `yutreno-quality`, `bgf-lines` (biblioteca delle linee), `banco-guida-leva-v1` (calibrazione della leva).

## Invarianti

- Nessuna decisione di fisica o di segnalamento in `src/web/`.
- La pagina deve funzionare come file singolo senza rete; le funzioni di rete (controllore, dinamica, bordo esterni) richiedono la pagina locale.
- Accessibilità: comandi da tastiera, movimento ridotto rispettato (niente oscillazione della telecamera, niente animazione dei tergicristalli).

## Test

`npm run typecheck` copre la configurazione web. I file di `src/web/` seguono lo stile di `.prettierrc.json` (`npx prettier --check src/web/*.ts`; Prettier non è una dipendenza del progetto). `scripts/page-golden.mjs` è il golden master della pagina: in Chrome con Playwright, con l'orologio della pagina sostituito da uno manuale, registra testo e campi di ogni scheda e la descrizione della scena 3D per 24 stati (`golden/page.json`, con le righe della scena in `golden/page-scene.txt` per vedere che cosa è cambiato), e fallisce se uno differisce; un cambiamento voluto della pagina lo riscrive con `--update`. `scripts/page-checks.mjs` controlla le funzioni della fase 7, e la pagina è provata quando si rigenerano le immagini (`scripts/screenshots.mjs`). Il comportamento guidato dalla pagina è quello del nucleo, provato dagli script di verifica.
