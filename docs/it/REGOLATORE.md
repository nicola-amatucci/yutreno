# Regolatore della circolazione

> Copia italiana di [docs/REGULATOR.md](../REGULATOR.md). In caso di differenze fa fede il testo inglese.

L'apparato forma gli itinerari e il RBC concede le autorizzazioni, ma nessuno dei due decide *quale* treno debba andare per primo quando l'orario non tiene più. L'orario può smettere di tenere perché un treno si guasta, la linea è interrotta o un treno va piano. In un posto centrale vero quella decisione spetta al regolatore della circolazione, una persona o un sistema di gestione del traffico. In YuTreno spetta a un programma che parla il **protocollo del regolatore**. Il protocollo ha la stessa forma degli altri: richieste JSON a periodo fisso, e la corsa si ferma finché non arriva la risposta.

Il regolatore vede la circolazione, non la sicurezza. Non può muovere un deviatoio né allungare un'autorizzazione. Cambia l'orario, le priorità e i binari, e può mandare i comandi del posto centrale che manderebbe il dirigente. L'apparato e il RBC continuano a proteggere i treni qualunque cosa il regolatore decida: un cattivo regolatore peggiora la circolazione, ma non la rende mai pericolosa. È il senso della separazione: il protocollo serve alla ricerca sulla riprogrammazione senza toccare il nucleo.

## Come si sceglie

| `regulator` | Chi decide |
| :-- | :-- |
| `none` | nessuno (predefinito): l'orario resta quello programmato, l'apparato applica la sua regola dei conflitti |
| `reference` | il regolatore di riferimento di `src/regulator/`, nel processo |
| `external` | un programma esterno con il protocollo descritto sotto (`exec:`, TCP, WebSocket) |

In uno scenario: `"regulator": "reference"`, con un `"regulator_period_s"` facoltativo (predefinito 5 s). Dalla riga di comando:

```
npm run headless -- --scenario scenarios/services/breakdown.json
npm run headless -- --scenario scenarios/services/breakdown.json --regulator none
npm run headless -- --scenario scenarios/services/breakdown.json --regulator "exec:npx tsx examples/regulator/regulator_stdio.ts"
npm run headless -- --scenario scenarios/services/breakdown.json --regulator "exec:python3 examples/regulator/regulator_example.py"
```

Il regolatore funziona con ogni segnalamento e ogni terra. Le sue decisioni agiscono attraverso ciò che c'è in ciascuno:

- **partenze riprogrammate**: i segnali di partenza della stazione (blocco automatico ed ETCS interno) e, con la terra con apparato, la formazione automatica degli itinerari;
- **priorità**: l'ordine delle richieste di itinerari inconciliabili nell'apparato e il consenso delle tratte a binario unico fra i due sensi.

Senza regolatore non cambia nulla: le 48 corse della campagna di riferimento conservano la loro impronta.

## Il protocollo

A ogni ciclo (`regulator_period_s`, a partire da t = 0) il motore manda una `RegulatorRequest` e aspetta una `RegulatorResponse`. Il regolatore decide prima del ciclo della terra dello stesso passo, così una decisione arriva subito all'apparato. I tipi sono in `src/core/types.ts`.

### Richiesta

```json
{
  "type": "regulator", "version": 1, "start": false, "t": 405,
  "trains": [
    { "id": "R 5101", "engine": 2, "category": "Regional EMU (4 cars)", "dir": 1, "active": true, "finished": false,
      "s_m": 10402.2, "v_kmh": 0, "at_station": "San Felice Scalo", "next_station": "San Felice Scalo",
      "delay_s": -116.6, "track_now": "I", "broken": true, "broken_until_s": 1000,
      "traction_factor": 1, "brake_factor": 1, "priority": -2,
      "stops": [
        { "station": "Ponte Sabato", "s_m": 5200, "planned_arrival_s": null, "planned_departure_s": 100,
          "arrival_s": null, "departure_s": 100, "min_dwell_s": 20, "track": null, "skipped": false,
          "realised_arrival_s": 40, "realised_departure_s": 101.3 },
        { "station": "San Felice Scalo", "s_m": 10400, "planned_arrival_s": 440, "planned_departure_s": 560,
          "arrival_s": 440, "departure_s": 1030, "min_dwell_s": 20, "track": null, "skipped": false,
          "realised_arrival_s": 323.4, "realised_departure_s": null },
        { "station": "Monte Clanio", "s_m": 15000, "planned_arrival_s": 900, "planned_departure_s": null,
          "arrival_s": 1370, "departure_s": null, "min_dwell_s": 20, "track": null, "skipped": false,
          "realised_arrival_s": null, "realised_departure_s": null }
      ] }
  ],
  "disruptions": [
    { "id": 0, "type": "train_stopped", "train": "R 5101", "since_s": 400, "until_s": 1000,
      "text": "Train R 5101 breaks down and cannot move for 600 s" }
  ],
  "routes": [ { "id": "San Felice Scalo/3", "name": "Departure from San Felice Scalo track I", "state": "free" } ]
}
```

- `trains` elenca tutti i treni della corsa: quello comandato (`"train"`) e i servizi, anche quelli non ancora comparsi (`active: false`) e quelli arrivati (`finished: true`).
- Le posizioni sono progressive della linea, qualunque sia il senso del treno.
- `stops` tiene tre orari affiancati:
  - quello **programmato** (`planned_*`), che non cambia mai ed è il riferimento per i ritardi;
  - quello **corrente** (`arrival_s`, `departure_s`), con le decisioni già prese;
  - quello **realizzato** (`realised_*`).
- `delay_s` è il ritardo all'ultimo evento, un arrivo o una partenza, rispetto all'orario programmato.
- `disruptions` sono i guasti di scenario in corso: treni guasti, interruzioni di linea, freno e trazione degradati, deviatoi e circuiti guasti, rallentamenti. `until_s` è la fine prevista quando l'evento ha una durata, altrimenti `null`: allora il regolatore non sa quando finirà.
- `routes` (solo terra con apparato) è lo stato degli itinerari di stazione dall'ultimo quadro.
- L'esempio è la richiesta a 405 s di `services/breakdown` (sono mostrati solo l'R 5101 e un itinerario): il regolatore di riferimento ha già abbassato la priorità dell'R 5101 e spostato la sua partenza a 1030 s, e l'arrivo a Monte Clanio segue (1370 s).
- La prima richiesta (`start: true`) porta anche `configuration`: la linea, le sue stazioni, il segnalamento, la terra, la regola dei conflitti e, con l'apparato, gli itinerari di stazione con stazione e rami.

Su una rete la configurazione porta `network` (le sue linee, la prima è la principale, con le stazioni), ogni treno il suo `route` e la `position` (la linea su cui sta la testa e la progressiva lì), ogni fermata la sua `line`; `s_m` e `dir` di un treno si riferiscono alla linea principale quando il suo percorso la usa. Con le coincidenze la richiesta porta `connections`, con attesa massima ed esito.

### Risposta

```json
{
  "commands": [
    { "type": "priority", "train": "R 5101", "value": -2 },
    { "type": "retime", "train": "R 5101", "station": "San Felice Scalo", "departure_s": 1030 },
    { "type": "retime", "train": "R 5101", "station": "Monte Clanio", "arrival_s": 1370 }
  ],
  "log": ["R 5101: priority -2 (broken down)", "R 5101: departure from San Felice Scalo moved to 1030 s (0:17:10) (broken down)"]
}
```

È la risposta del regolatore di riferimento a 400 s, quando comincia il guasto. Se l'itinerario di partenza dell'R 5101 fosse già stato formato, avrebbe mandato anche `{ "type": "operator", "command": { "type": "cancel_route", "id": "San Felice Scalo/3" } }`.

| Comando | Campi | Effetto |
| :-- | :-- | :-- |
| `retime` | `train`, `station`, `arrival_s`, `departure_s` | Nuovi tempi a una fermata non ancora lasciata. Un treno fermo alla fermata conserva il suo arrivo; un servizio aspetta la nuova partenza, un segnale di partenza resta rosso fino a quell'ora. Con l'apparato, la formazione automatica riceve il nuovo orario. |
| `skip_stop` | `train`, `station` | Il servizio transita in una stazione in cui era previsto che fermasse. Non per l'origine, la destinazione o il treno comandato, le cui fermate sono quelle della linea. |
| `cancel` | `train`, `from_station` | Soppressione. Senza `from_station` un treno non ancora comparso è soppresso per intero, un treno in linea termina alla stazione successiva; con `from_station`, il treno termina in quella stazione. Le fermate successive si tolgono, e all'arrivo il treno lascia la linea (tolto dal servizio). Non per il treno comandato. |
| `track` | `train`, `station`, `track` (`I`, `II`) | Il binario da usare nella stazione (terra con apparato). |
| `priority` | `train`, `value` | Priorità nei conflitti, predefinita 0, la più alta per prima. Apparato: viene prima della regola dei conflitti, e una partenza aspetta un treno con priorità maggiore che si avvicina alla stazione. Binario unico: decide il consenso prima dell'orario. |
| `operator` | `command` | Un comando del posto centrale per l'apparato (`set_route`, `cancel_route`, `ars`, `emergency_stop`…, vedi [TERRA.md](TERRA.md)). |
| `reroute` | `train`, `route` | Su una rete: un treno non ancora comparso percorre queste linee (id in ordine di marcia). Le fermate che non stanno sul nuovo itinerario vengono saltate; origine e destinazione devono restare. |
| `connection` | `from`, `to`, `station`, `max_wait_s` | Nuova attesa massima di una coincidenza ancora aperta; 0 vuol dire che il treno in partenza non aspetta più. |

Un comando che non si può applicare, come un treno sconosciuto, una fermata già lasciata o un comando al posto centrale senza l'apparato, non è un errore della corsa. Finisce nel registro come avviso (*Regulator: retime ignored, …*) e la corsa continua. Le righe di `log` finiscono nel registro della corsa come *Regulator: …*.

L'orario scritto dalle corse senza grafica (`_timetable.json`) e restituito da `timetable()` conserva l'orario programmato e aggiunge, solo dove ci sono, le decisioni: `rescheduled_arrival_s`, `rescheduled_departure_s`, `skipped` e, per il treno, `cancelled` (`all` o `partial`). I flussi di dati aperti le pubblicano come informazione in tempo reale ([DATI_APERTI.md](DATI_APERTI.md)): nuovi orari previsti, fermate `SKIPPED` e corse `CANCELED` in GTFS-Realtime, chiamate e corse cancellate in SIRI.

## Il regolatore di riferimento

`ReferenceRegulator` (`src/regulator/index.ts`) è volutamente semplice. È un termine di paragone per un regolatore di ricerca, non un buon regolatore. Applica cinque regole, con i parametri di `REGULATOR_PARAMETERS`:

1. **Priorità.** Un treno guasto ha −2, un treno con trazione o freno sotto il 70 % ha −1, gli altri 0. Non favorisce le categorie: a priorità uguali decide la regola dei conflitti dell'apparato, come senza regolatore.
2. **Riprogrammazione.** Un ritardo di più di 60 s si riporta sulle fermate successive. L'arrivo diventa quello programmato più il ritardo. La partenza non è prima dell'arrivo più la sosta minima, né prima dell'orario programmato, così i margini dell'orario assorbono il ritardo. I tempi si mandano solo quando differiscono di più di 20 s da quelli correnti.
3. **Guasti.** La partenza di un treno guasto si sposta a 30 s dopo la fine prevista del guasto. Se la fine non è nota, la partenza resta 2 minuti avanti e si sposta a ogni ciclo. Un itinerario di partenza già formato per il treno nella sua stazione si annulla, se un altro treno dello stesso senso è in stazione o si sta avvicinando: l'annullamento è ritardato di 120 s se il RBC ha già concesso l'itinerario. Quando il guasto finisce, un treno fermo in stazione parte subito.
4. **Linea interrotta.** Un treno che finirebbe contro un tratto interrotto si trattiene nell'ultima stazione prima del tratto, fino a 30 s dopo la riapertura prevista (o 2 minuti avanti finché la riapertura non è nota). Il treno non si ferma in piena linea davanti al segnale di protezione.
5. **Soppressione.** Un treno guasto al marciapiede senza una fine prevista del guasto è tolto dal servizio lì dopo 10 minuti: termina in quella stazione, e le sue fermate successive sono soppresse. Nello scenario `services/cancellation` l'R 5101 si guasta a San Felice Scalo senza fine prevista; il treno comandato lo supera sul binario II e arriva a Monte Clanio a 847 s, e dopo dieci minuti l'R 5101 termina lì. Senza regolatore il treno comandato resta dietro, perché la formazione automatica continua a dare la precedenza al treno con orario precedente.
6. **Coincidenze.** Una coincidenza che l'alimentatore non può più fare entro l'attesa massima viene liberata (`connection` con `max_wait_s` 0). L'arrivo più vicino dell'alimentatore è il suo orario più il ritardo, e non prima della fine del guasto quando è nota. In `services/branch-shuttle`, con il treno comandato guasto per 600 s, la navetta parte da San Felice Scalo in orario; senza regolatore aspetta 300 s e perde comunque la coincidenza.
7. **Cambio di percorso.** Su una rete, un treno non ancora comparso il cui percorso passa per una tratta interrotta della linea principale, senza una riapertura prima che ci arrivi, viene mandato sul percorso alternativo più breve che la evita (i percorsi semplici di al più quattro linee attraverso i nodi); le fermate che non ci stanno vengono saltate. In `services/loop-reroute` l'R 3101 va da Ponte Sabato a Pietrarsa sul raccordo, salta San Felice Scalo e arriva a Rocca Sabato a 1788 s; senza regolatore aspetta la riapertura e arriva a 4099 s. La regola 4 trattiene un treno solo se il suo percorso passa per la tratta interrotta.

Tre casi mostrano cosa cambia, con gli stessi dati di `verify-regulator`:

| Situazione | Senza regolatore | Con il regolatore di riferimento |
| :-- | :-- | :-- |
| `services/breakdown`: l'R 5101 si guasta sul binario I di San Felice Scalo per 600 s, il treno comandato arriva sul binario II | l'ARS dà l'uscita all'R 5101 alla sua ora; il treno comandato aspetta la fine del guasto e arriva a Monte Clanio a 1286 s | l'R 5101 perde la priorità e la sua partenza passa a 1030 s; il treno comandato parte per primo e arriva a 847 s. L'R 5101 arriva a 1202 s in entrambi i casi |
| lo stesso guasto un secondo dopo la partenza dell'R 5101, con l'itinerario d'uscita già formato | il treno comandato aspetta la fine del guasto, 1447 s a Monte Clanio | il regolatore annulla l'itinerario, l'ARS trattiene l'R 5101 per il treno con priorità maggiore, il treno comandato arriva a 882 s; l'R 5101 a 1363 s in entrambi i casi |
| linea interrotta da 7,000 a 7,400 km fra t = 200 e 500 s, con blocco automatico, ETCS o terra con apparato | il treno si ferma al segnale di protezione, in piena linea a 6,56 km | il treno aspetta a Ponte Sabato (5,4 km) e parte a 530 s: circa 60 s in più all'arrivo, ma nessun treno bloccato fra due stazioni |

L'ultimo caso è un vero compromesso e mostra a cosa serve un regolatore: la regola costa un minuto e in cambio tiene un treno al marciapiede invece che in trincea. Se ne valga la pena è una scelta di esercizio, ed è proprio quella che un regolatore di ricerca cambierebbe.

## Scrivere un regolatore

`examples/regulator/regulator_stdio.ts` è il regolatore di riferimento come processo (una riga JSON in ingresso, una in uscita). `examples/regulator/regulator_example.py` è un regolatore minimo in Python: abbassa la priorità dei treni guasti e trattiene i treni prima di un tratto interrotto. Sono entrambi modelli da cui partire.

Qualche indicazione:

- **Rispondere a ogni richiesta**, anche con `{"commands": []}`: la corsa aspetta.
- **Mandare le decisioni quando cambiano**, non a ogni ciclo. I comandi sono idempotenti, ma ogni nuovo orario di un treno fermo ricalcola la sua partenza.
- **Usare l'orario programmato per i ritardi e quello corrente per le decisioni.** Gli `stops` li mostrano entrambi.
- **Non contare sulla sicurezza.** Un regolatore che manda due treni uno contro l'altro ottiene solo itinerari rifiutati e segnali rossi: l'apparato e il RBC stanno sotto di lui.

Il regolatore è deterministico finché lo è il programma: `verify-regulator` controlla che il regolatore di riferimento via `exec:` dia una corsa identica a quella nel processo.

## A cosa corrisponde

Il protocollo del regolatore è di YuTreno. Segue la stessa divisione del lavoro delle architetture di riferimento del comando e controllo europeo:

- Nell'architettura RCA del consorzio EULYNX ed EUG, pianificazione e riprogrammazione spettano al sistema di gestione del traffico (TMS-PAS).
- TMS-PE esegue il piano operativo chiedendo allo strato di sicurezza di assegnare gli enti, senza essere responsabile della sicurezza.
- L'interfaccia fra i due (SCI_1) porta, per ogni corsa, il percorso preciso, l'ordine d'uso dei binari, i vincoli di tempo nei punti della rete e le limitazioni di capacità programmate. Indietro porta lo stato di esecuzione, compresa la capacità persa per guasti.

Richieste e risposte di YuTreno sono molto più piccole:

- le stazioni prendono il posto dei punti della rete;
- i binari I e II prendono il posto del percorso preciso;
- le priorità prendono il posto dell'ordine d'uso.

L'idea è la stessa: le decisioni sul piano vanno in un senso, lo stato di esecuzione torna indietro.

La riprogrammazione in tempo reale è un campo di ricerca a sé: nuovi orari, nuovi ordini, nuovi percorsi e soppressioni, con euristiche o modelli di ottimizzazione. Progetti come ON-TIME hanno provato metodi di questo tipo con traffico simulato. YuTreno non li implementa; offre un banco di prova deterministico in cui confrontarli sugli stessi disservizi, con la protezione sempre nel ciclo.

Fonti:
- [RCA TMS-PE component specification, RCA.Doc.19 v0.0.7, EULYNX ed ERTMS Users Group, 2019](https://public.3.basecamp.com/p/DCGx8enamwvLtQBYnCcn2Eee/upload/download/RCA_TMS-PE_specification.pdf)
- [RCA SCI_1 specification (TMS-PAS – TMS-PE)](https://public.3.basecamp.com/p/ofsxC3P8zyZRKXJn7nqbS6rJ/upload/download/RCA_SCI_1_specification.pdf)
- [Europe's Rail, Traffic CS system concept](https://rail-research.europa.eu/wp-content/uploads/2025/03/Traffic_CS_System_Concept.pdf)
- [The ON-TIME real-time railway traffic management framework, TU Dresden](https://fis.tu-dresden.de/portal/de/publications/the-ontime-realtime-railway-traffic-management-framework(9a932df1-ff25-4bc4-94cc-fe29a390bc1d).html)
