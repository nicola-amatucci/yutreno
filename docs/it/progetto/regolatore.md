# Regolatore della circolazione

> Copia italiana di [docs/design/regulator.md](../../design/regulator.md). In caso di differenze fa fede il testo inglese.

## Scopo

Decidere quale treno va per primo, e quando, una volta che l'orario non tiene più: dopo un guasto, una linea interrotta, un treno lento. Il regolatore lavora sul piano (orari, priorità, binari, itinerari) e mai sulla sicurezza, che resta all'apparato, al RBC e al bordo. Il suo protocollo permette di provare un regolatore di ricerca (euristica, modello di ottimizzazione, agente) sugli stessi disservizi di quello di riferimento. Documentazione per l'utente: [REGOLATORE.md](../REGOLATORE.md).

## Parti

- **`ReferenceRegulator`** (`src/regulator/index.ts`): il termine di paragone, con quattro regole (priorità dai guasti, ritardo riportato sulle fermate successive, partenza di un treno guasto spostata e suo itinerario annullato, treni trattenuti prima di un tratto interrotto) e i parametri di `REGULATOR_PARAMETERS`.
- **Lato motore**: richiesta e risposta in `src/core/regulator-bridge.ts`, chiamate dai metodi `regulatorDue()`, `regulatorRequest()` e `regulatorResponse()` di `Simulation`; lo stato `reg` di `Simulation`, di tipo `RegulatorState` in `src/core/run-state.ts`, e `regulatorCommand()`, che applica una decisione ed è condiviso con il dirigente, in `src/core/commands.ts`. Su ogni treno: `plan`, l'orario originale conservato per ritardi e uscite, e `priority`.
- **Ciclo** (`controller.ts`): `exchangeRegulator()` e l'opzione `regulator` di `runLockstep`; `--regulator` nel runner senza grafica.
- **Esempi**: `examples/regulator/regulator_stdio.ts` (il regolatore di riferimento come processo) e `regulator_example.py` (uno minimo in Python).

## Ciclo

A t = 0 e poi ogni `regulator_period_s` (predefinito 5 s, multiplo di 5 ms) il motore costruisce la richiesta dai treni (orario programmato, corrente e realizzato, posizione in progressive di linea, binario in stazione, guasti, priorità), dagli eventi di scenario attivi e, con l'apparato, dagli itinerari dell'ultimo quadro. La prima richiesta porta la configurazione. Il regolatore in processo è chiamato all'inizio di `step()`, dopo gli scambi dei bordi e prima della terra; quello esterno prima dello scambio con la terra nel ciclo. Le decisioni si applicano subito:

- `retime` cambia `stations[i].arr/dep`; un servizio fermo alla fermata riceve un nuovo `doorDue`, uno non ancora comparso un nuovo `appear`;
- `skip_stop` toglie la fermata da `stations` e `dwells`;
- `cancel` imposta `cancelled`: un servizio non ancora comparso termina prima di comparire, uno in linea perde le fermate dopo la stazione indicata e termina arrivandoci (subito, se vi è fermo);
- `track` e `priority` impostano `tracks` e `priority`;
- `operator` va in `tr.pendingCmd`.

Con l'apparato, ogni cambio di orario o di binario manda il comando `timetable` per quel motore, e ogni priorità il comando `priority`. Senza apparato gli effetti passano dai segnali di partenza tenuti rossi fino all'ora di partenza (`heldSignals`), da `wanting` e dalla priorità, che decide il consenso delle tratte a binario unico prima dell'orario (`updateOrientation`).

## Su una rete

`regulatorNet()` descrive un treno su una rete con questi dati:
- il suo `route` e la sua `position`;
- la linea di ogni fermata;
- `s_m` e `dir` sulla linea principale, quando il percorso la usa.

In questo modo le regole scritte per una linea continuano a funzionare, dato che le tratte interrotte sono sulla linea principale.

`reroute()` dà un nuovo itinerario a un treno non ancora comparso. Ricompila il corridoio, toglie le fermate che non vi stanno e ricostruisce gli itinerari di nodo mantenendone i titolari.

Il regolatore di riferimento aggiunge due regole:
- la regola 6 libera una coincidenza che l'alimentatore non può più fare;
- la regola 7 cambia il percorso per aggirare una tratta interrotta, scegliendo il più breve fra gli altri percorsi di linee, trovati dalle stazioni che la configurazione fornisce.

La regola 4, inoltre, trattiene un treno solo se il suo percorso passa per la tratta interrotta.

Le verifiche `RG6`–`RG8` di `verify-regulator` controllano tutto questo; l'ultima usa il regolatore come programma esterno.

## Invarianti

- `src/regulator/` importa dal motore solo tipi.
- Senza regolatore non cambia nulla: la richiesta non si costruisce mai, `plan` coincide con `stations` e `timetable()` non aggiunge campi.
- Il regolatore di riferimento esterno dà una corsa identica a quella nel processo.
- Una decisione che non si può applicare si registra e si salta, non lancia un'eccezione: un regolatore in prova non deve fermare la corsa.

## Verifiche

`verify-regulator`:
- validazione e protocollo con un regolatore scritto a mano (ciclo, skip_stop, retime, priority, decisioni non valide registrate, orario programmato conservato);
- guasto in stazione e alla partenza con l'apparato;
- linea interrotta con blocco automatico, ETCS e apparato;
- il regolatore esterno via `exec:`;
- determinismo.

## Limiti noti ed estensioni

- La soppressione fa terminare un treno in una stazione e lo toglie dalla linea: niente ritorno come treno di ritorno, niente coincidenze fra treni.
- Nessun nuovo instradamento oltre la scelta del binario.
- Il regolatore di riferimento non ottimizza nulla.
- I treni nei due sensi con l'apparato (fase 3b-2) darebbero al regolatore degli incroci da scegliere.
