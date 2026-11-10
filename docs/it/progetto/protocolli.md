# Protocolli

> Copia italiana di [protocols.md](../../design/protocols.md). In caso di differenze fa fede il testo inglese.

## Scopo

YuTreno parla con cinque tipi di programma che non controlla: controllori (chi guida), modelli di dinamica (come si muove il treno), calcolatori di bordo (come è protetto), terre (da dove viene l'autorizzazione) e regolatori (quale treno va prima quando l'orario non tiene più). Ciascuno ha un protocollo con la stessa forma: il motore manda una richiesta JSON a periodo fisso e si ferma finché non arriva la risposta JSON. Questo documento descrive ciò che hanno in comune; i dettagli sono in [API.md](../API.md), [DINAMICA_ESTERNA.md](../DINAMICA_ESTERNA.md), [BORDO_ETCS.md](../BORDO_ETCS.md), [TERRA.md](../TERRA.md) e [REGOLATORE.md](../REGOLATORE.md).

## Panoramica

| Canale | Richiesta | Risposta | Periodo | Versione | Fornitori |
| :-- | :-- | :-- | :-- | :-- | :-- |
| Controllore | `Observation` | `Command` | 0,1–1 s (predefinito 0,2) | 3 (2 e 1 in italiano) | JS `control(obs, mem)`, server WebSocket |
| Dinamica | `DynamicsRequest` | `DynamicsResponse` | `external.period_s` (predefinito 0,05) | 2 (1 in italiano) | JS `dynamics(req, mem)`, `exec:`, TCP, WebSocket |
| Bordo | `OnboardRequest` | `OnboardResponse` | `onboard_period_s` (predefinito 0,1) | 2 (1 in italiano) | `ReferenceEvc` in processo, JS `onboard(req, mem)`, `exec:`, TCP, WebSocket |
| Terra | `TracksideRequest` | `TracksideResponse` | `trackside_period_s` (predefinito 0,1) | 2 (1 in italiano) | `Trackside` in processo, `exec:`, TCP, WebSocket |
| Regolatore | `RegulatorRequest` | `RegulatorResponse` | `regulator_period_s` (predefinito 5) | 1 | `ReferenceRegulator` in processo, `exec:`, TCP, WebSocket |

Dal lato del motore ogni canale ha il suo modulo dalla fase 8: la dinamica in `src/core/dynamics.ts`, il bordo in `src/core/onboard-bridge.ts` (richiesta, risposta, il bordo di riferimento in processo e i rallentamenti nelle progressive di un corridoio), la terra in `src/core/trackside-bridge.ts`, il regolatore in `src/core/regulator-bridge.ts`. `Simulation` tiene i metodi `…Due`, `…Request` e `…Response` di ogni canale, che chiamano questi moduli.

Tutti i tipi sono in `src/core/types.ts` (`src/trackside/types.ts` per la terra). I campi aggiunti per più treni sono facoltativi, come vuole la regola: `configuration.trains` della terra (orari per `NID_ENGINE`) e `parameters.conflict_rule`, `NID_ENGINE` sui messaggi radio ai treni diversi dal comandato, `engine` sui comandi d'arresto d'emergenza, `sessions` nel quadro. Una terra che li ignora serve comunque un treno solo. Lo stesso vale per più RBC: `configuration.rbcs`, `NID_RBC` sui messaggi radio nei due sensi, il comando `rbc_link`, `rbcs` e `rbc_link` nel quadro e `NID_RBC` sulla sua autorizzazione e sulle sessioni; una terra con un solo RBC li ignora, e un bordo che non riceve `NID_RBC` funziona come prima. `train.integrity` nella richiesta al bordo si manda solo dopo un evento `integrity_loss`, quindi le richieste di ogni altra corsa non cambiano; allo stesso modo l'odometria porta un errore solo dopo un evento `odometry_drift` (`odometerReading` in `onboard-bridge.ts`).

## Regole comuni

- **Lockstep.** Il motore si ferma a ogni scambio e riprende solo con la risposta; `*Due()` dice quando uno scambio è dovuto, `step()` rifiuta di avanzare senza. I risultati non dipendono dai tempi.
- **Prima richiesta.** `start: true` porta i dati statici (parametri del treno, dati del treno e valori nazionali, configurazione di terra); le richieste successive portano solo ciò che cambia.
- **Nomi.** Inglesi, con i nomi degli standard dove esistono: variabili del Subset-026 in pacchetti e messaggi, nomi del Subset-130 in `etcs_ato`, nomi EULYNX nei telegrammi.
- **Compatibilità.** Le risposte passano per `toEnglish`, quindi un programma della versione 0.x può rispondere con i nomi italiani. Con `--protocol 1` (o `legacyProvider(call, kind)`) le richieste sono mandate nel formato italiano della versione 0.x tramite `toLegacy`. L'osservazione del controllore ha le versioni 1 e 2 con i nomi italiani; un controllore JavaScript che definisce `controllo` riceve la versione 2.
- **Evoluzione.** I campi non si rinominano mai; i campi nuovi sono facoltativi, e i campi nuovi delle risposte devono poter mancare senza che il motore se ne accorga.
- **Errori.** Una risposta senza i campi obbligatori ferma la corsa con un errore che indica il tempo e i campi mancanti.

## Trasporti

`openChannel(spec)` in `src/server/headless.ts` restituisce un `Channel` per `exec:comando` (una riga JSON per messaggio su stdin/stdout; stderr va sulla console; stdin si chiude alla fine della corsa), `tcp://host:porta` (righe JSON, il programma è in ascolto) e `ws://host:porta` (un messaggio JSON per frame, il programma è in ascolto). `loadJsController`, `loadJsDynamics`, `loadJsOnboard` caricano file JavaScript in un contesto `vm`. Nel browser esiste solo WebSocket: `src/server/bridge.ts` porta la pagina verso TCP o un processo.

## Ordine dentro un passo

Quando più canali sono dovuti nello stesso passo l'ordine è: controllore (al suo periodo, prima del passo), regolatore, terra dopo il bordo in processo (così la terra vede i messaggi dello stesso ciclo), bordo, dinamica. `runLockstep()` in `controller.ts` lo implementa; `exchangeTrackside`, `exchangeOnboard` ed `exchangeDynamics` servono per costruire altri cicli.

## Test

L'equivalenza fra fornitori in processo ed esterni è controllata per ogni canale: `verify-external-dynamics` (JS, TCP, processo), `verify-onboard` e `verify-ato-s130` (bordo come processo), `verify-trackside` (terra come processo) e la sezione di determinismo della campagna. `scripts/verify-ato-s130.ts` controlla l'equivalenza delle versioni dell'osservazione tramite `toLegacy` e `toEnglish`.
