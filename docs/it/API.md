# API del controllore (versione 3)

> Copia italiana. Il documento di riferimento è la versione inglese [API.md](../API.md): nomi di file, comandi e formati seguono quella; i nomi italiani della versione 0.x (campi JSON, opzioni come `--linea` o `--bordo`) restano accettati.

## Funzionamento al passo

Simulatore e controllore vanno al passo. A ogni periodo di controllo il simulatore invia un'osservazione e si ferma finché non riceve il comando. Il periodo va da 0,1 a 1 s di tempo simulato; quello predefinito è 0,2 s. I risultati non dipendono dai tempi di risposta: lo stesso controllore sulla stessa linea produce gli stessi dati nel browser, in Node e via WebSocket.

Il controllore si può collegare in tre modi:

- **Nel browser.** Codice JavaScript che definisce `function control(obs, mem)` e gira in un Web Worker. `mem` è un oggetto che persiste fra un passo e l'altro.
- **Senza grafica.** `npm run headless -- --controller file.js` carica lo stesso formato in un contesto `vm` di Node.
- **Esterno, via WebSocket.** Il controllore fa da server e il simulatore si collega come client, che sia la pagina aperta in locale o `npm run headless -- --controller ws://host:port`. A ogni periodo il simulatore invia un messaggio JSON di osservazione e attende un messaggio JSON di comando. Nella pagina pubblicata come artifact la rete è bloccata: per il WebSocket va usata la pagina locale.

Nell'interfaccia il controllore si sgancia alla terza risposta che manca per più di 1,5 s (ogni volta resta l'ultimo comando), oppure se il macchinista tocca il manipolatore.

## Versioni

| Versione | Nomi | Contenuto | Come ottenerla |
| :-- | :-- | :-- | :-- |
| 3 (predefinita) | inglesi | tutto quello che segue, compreso `etcs_ato` | predefinita |
| 2 | italiani (0.x) | lo stesso contenuto della versione 3 con i nomi italiani della versione 0.x | controllori JavaScript che definiscono `controllo` invece di `control`; `--api 2`; `observe(period, 2)` |
| 1 | italiani (0.x) | la versione 2 senza `etcs_ato` | `--api 1`; `observe(period, 1)`; `runLockstep(..., { api: 1 })` |

Le versioni 2 e 3 hanno gli stessi campi nello stesso ordine: la versione 2 è la versione 3 passata per `toLegacy(obs, 'observation')`, e `toEnglish` restituisce la versione 3 (`scripts/verify-ato-s130.ts` controlla i due versi). I comandi si accettano con i nomi delle due lingue: `{ "trazione": 1 }` e `{ "traction": 1 }` sono lo stesso comando. Il glossario dei nomi è in `src/core/legacy.ts`.

## Osservazione

Le grandezze sono nel Sistema Internazionale; le posizioni sono progressive dall'origine della linea e si riferiscono alla testa del treno. Il tipo completo è `Observation` in `src/core/types.ts`.

| Campo | Contenuto |
| :-- | :-- |
| `version` | 3 |
| `train_id` | identificativo del treno osservato, presente solo quando lo scenario ha treni di servizio (`train` per quello comandato) |
| `t`, `dt` | tempo simulato e periodo di controllo (s) |
| `pos_m`, `vel_ms`, `acc_ms2` | posizione, velocità, accelerazione |
| `traction`, `brake`, `lever` | comandi attuali (0–1) e posizione equivalente del manipolatore (−8…10) |
| `forces_kN` | `traction`, `brake`, `electric_brake`, `resistance`, `gradient` |
| `signalling` | `ETCS` oppure `BACC` (blocco automatico con SCMT) |
| `supervision` | `state` (NOR, IND, OVS, WAR, SBI, INT), `v_permitted_ms`, `v_warning_ms`, `v_intervention_ms`, `v_mrsp_ms`, `target` {`distance_m`, `speed_ms`, `type`} |
| `ma` | solo ETCS: `eoa_m`, `svl_m`, `v_release_ms`, `reason` |
| `signal` | solo blocco automatico: prossimo segnale {`id`, `pos_m`, `aspect` green/yellow/red} |
| `speed_profile` | `[from_m, to_m, v_ms]` per i prossimi 8 km |
| `gradient_profile` | `[from_m, to_m, permille]` per i prossimi 8 km |
| `current_gradient_permille` | pendenza media sotto il treno |
| `next_stop` | {`name`, `pos_m`, `arrival_s`, `departure_s`} oppure `null` |
| `doors_open`, `emergency`, `vigilance_alarm` | stati di bordo |
| `slip`, `wsp` | la trazione o la frenatura richiesta supera l'aderenza |
| `radio_ok` | collegamento radio con il RBC (sempre `true` con il blocco automatico) |
| `speed_restrictions` | rallentamenti attivi: `[from_m, to_m, v_ms]`, già compresi in `speed_profile` |
| `adhesion_mu` | aderenza nominale della rotaia; le zone di aderenza ridotta degli scenari non sono note a bordo |
| `model` | modello di dinamica: `multimass`, `point` o `external` |
| `onboard` | supervisione ETCS in uso (`type`: `internal`, `reference`, `external`); con un bordo a messaggi anche il modo (`FS`, `SB`, `TR`, `PT`) e il gruppo di boe di riferimento (`lrbg`) |
| `tail_speed_ms`, `jerk_ms3` | velocità dell'ultimo veicolo e strappo in testa, filtrato |
| `coupler_forces_kN` | forze negli accoppiatori dalla testa alla coda, positive in trazione; vuoto con il punto materiale |
| `line`, `train` | nome e lunghezza della linea; parametri del modello del treno |
| `events` | eventi annunciati accaduti dall'ultimo passo: {`t`, `type`, `text`}; `type` vale INFO, WARN, EMG, VIG, STOP, SIG, CTL o FAULT |
| `etcs_ato` | dati del bordo per l'ATO, vedi sotto; `null` con il blocco automatico e fuori dalla supervisione completa |

## Dati del bordo per l'ATO (Subset-130)

Nell'architettura ATO over ETCS il bordo ETCS passa all'ATO di bordo, ogni 200 ms, ciò che sta sorvegliando: il Subset-130 lo definisce nei pacchetti 6 (ETCS_ATO_Dynamic) e 11 (ETCS_ATO_BRAKE_DECELERATIONS). `etcs_ato` riporta quei dati con i nomi della specifica. Le unità sono quelle del SI invece di cm, cm/s e mm/s², e le posizioni sono progressive di linea come `pos_m` invece di letture del contatore di posizione del bordo. Come nella specifica, i dati ci sono solo in supervisione completa (FS).

| Campo | Contenuto |
| :-- | :-- |
| `M_MODE` | modo ETCS (`FS`) |
| `V_EST`, `A_EST` | velocità e accelerazione stimate |
| `V_PERMITTED` | velocità consentita nel punto attuale (la stessa di `supervision.v_permitted_ms`) |
| `V_MRSP`, `MRSP` | MRSP attuale e sue variazioni davanti al treno, `[N_LOC_MRSP, V_MRSP]`; un aumento vale da quando la coda ha liberato il tratto |
| `N_LOC_EBI` | posizione stimata della testa in cui, mantenendo la velocità attuale, interverrebbe la frenatura d'urgenza; `null` se nessun limite di intervento è sorvegliato, per esempio da fermo |
| `N_LOC_EOALOA`, `V_EOALOA`, `N_LOC_SVL` | fine dell'autorizzazione, velocità ammessa lì (0) e punto di pericolo |
| `V_RELEASE_ATO` | velocità di rilascio sorvegliata; `null` se l'autorizzazione arriva alla fine della linea |
| `A_BRAKE_SAFE` | decelerazione sicura del freno d'urgenza, senza il contributo della pendenza (m/s²) |
| `GRADIENT` | decelerazione dovuta alla pendenza, positiva in salita: `[N_LOC_GRADCHANGE, A_GRADIENT]` |
| `T_TRACTION`, `T_BE_REACT` | tempo in cui la trazione resta dopo il comando d'urgenza e tempo di reazione del freno d'urgenza (s) |
| `L_UNCERTAINTY_OVERREADING`, `L_UNCERTAINTY_UNDERREADING` | incertezza della localizzazione (m) |

Tutti e tre i bordi forniscono questi dati, ciascuno dai propri calcoli:
- **la supervisione interna** li ricava dalle sue curve semplificate;
- **il bordo di riferimento** risolve la curva EBD all'indietro sulla pendenza fino alla velocità attuale e ne sottrae la distanza percorsa durante i tempi di reazione;
- **un bordo esterno** li fornisce nel campo facoltativo `dmi.ato` della risposta ([BORDO_ETCS.md](BORDO_ETCS.md)). Se non li fornisce, `etcs_ato` contiene solo le velocità e `N_LOC_EBI` e `A_BRAKE_SAFE` valgono `null`.

`N_LOC_EBI` è il dato che un ATO non può ricavare da sé. `scripts/verify-ato-s130.ts` controlla che sia davvero il punto in cui interviene la protezione: un treno a velocità costante che non frena viene fermato entro 1,3 m dal punto annunciato. `scripts/verify-subset026.ts` lo controlla contro la forma chiusa d_EBD(v) − v·T_be in piano.

`examples/ato_s130.js` è un ATO che usa questi dati. Pianifica la frenatura con una curva propria e con la curva di intervento ricostruita da `A_BRAKE_SAFE`, `GRADIENT` e dai tempi di reazione, e frena a fondo se si avvicina troppo a `N_LOC_EBI`. Nella pagina si carica con il pulsante *Subset-130 example* della scheda dei controllori. Il confronto con l'ATO semplice è in [CAMPAGNA.md](CAMPAGNA.md).

## Comando

| Campo | Effetto |
| :-- | :-- |
| `traction` | 0–1, frazione dello sforzo disponibile |
| `brake` | 0–1, frazione della frenatura di servizio; sopra 0,01 taglia la trazione |
| `lever` | in alternativa ai due precedenti: −8 urgenza, −7…−1 frenatura, 0 neutro, 1…10 trazione |
| `vigilance` | `true` per confermare la vigilanza (ciclo di 55 s, 5 s per rispondere) |
| `emergency` | `true` per la frenatura d'urgenza |
| `note` | testo da scrivere nel registro eventi |

I campi omessi lasciano invariato il comando precedente.

## Dinamica esterna

Questa API è quella dei controllori, cioè di chi guida il treno. La dinamica del treno si può invece sostituire con un modello esterno, per esempio in MATLAB/Simulink, attraverso un secondo canale con un protocollo suo: è descritto in [DINAMICA_ESTERNA.md](DINAMICA_ESTERNA.md). I due canali si usano anche insieme, con un controllore che guida un treno la cui dinamica è calcolata fuori dal motore.

## Bordo ETCS esterno

Anche la supervisione ETCS di bordo si può affidare a un calcolatore esterno, con boe e messaggi del Subset-026. Il protocollo è in [BORDO_ETCS.md](BORDO_ETCS.md). Un controllore che guida un treno con un bordo esterno vede nell'osservazione la supervisione calcolata da quel bordo.

## Uso del nucleo da TypeScript

```ts
import { DEFAULT_SCENARIO, LINE_PRESETS, TRAIN_PRESETS, Simulation, clone, runLockstep } from './src/core';

const sim = new Simulation(clone(LINE_PRESETS['valle-lauro']), clone(TRAIN_PRESETS.regional), { ...DEFAULT_SCENARIO, sig: 'ETCS' });
await runLockstep(sim, obs => ({ traction: obs.vel_ms < 20 ? 1 : 0 }), { period: 0.2 });
console.log(sim.summary());   // contiene anche esito e controlli del verdetto
console.log(sim.csv());
```

## Scenari

Il costruttore accetta come quarto argomento uno scenario (`ScenarioDef`, vedi [SCENARI.md](SCENARI.md)); `resolveScenario(def)` ricava linea, treno e condizioni, `sim.verdict()` restituisce esito e controlli. Con i treni di servizio, `sim.trains` elenca ogni treno (`TrainRun`, il comandato per primo), `sim.done` è vero quando tutti hanno finito, `sim.timetable()` dà l'orario programmato e realizzato, e `observe`, `summary`, `csv` e `verdict` accettano il treno come ultimo argomento. L'intestazione del CSV è `CSV_HEADER` in `src/core/simulation.ts`: oltre a posizione, velocità, curve di supervisione, comandi, forze, aderenza (`mu`, quella effettiva sotto il treno), quota ed energia ha le colonne `radio`, `tail_speed_kmh`, `max_coupler_tension_kN`, `max_coupler_compression_kN`, `jerk_ms3`, `onboard_mode` e `lrbg`.

## Formato delle linee

Il JSON di una linea (`LineDef` in `src/core/types.ts`) contiene:

- `plan`: vertici [x, y] in metri, raccordati con una spline;
- `profile`: vertici [progressiva, quota];
- `stations`: oggetti {`name`, `s`, `arr`, `dep`};
- `limits`: terne [da, a, km/h];
- `tunnels`: coppie [da, a];
- `block`: lunghezza delle sezioni di blocco;
- `geo` (facoltativo): posizione WGS84 dell'origine della planimetria e rotazione del suo asse x, per i dati aperti;
- `attribution` (facoltativo, linee importate): l'attribuzione che le fonti dei dati richiedono, per esempio l'ODbL di OpenStreetMap;
- `fitLen` (linee predefinite): la lunghezza su cui si scala il tracciato;
- `freight`: il treno che precede, un merci fermo sulla linea quando la corsa parte: `on`, posizione della testa `s0`, velocità massima `vmax` (km/h), sosta `stopAt` (m, 0 = nessuna) di `wait` secondi, lunghezza `len` e, facoltativo, `train`, l'id di un treno predefinito o i suoi parametri ([MODELLO.md](MODELLO.md#vigilanza-fermate-e-treno-che-precede)).

Si esporta e si importa dalla scheda *Line* e si passa all'esecuzione senza grafica con `--line file.json`.
