# Documenti di progetto

> Copia italiana di [docs/design/README.md](../../design/README.md). In caso di differenze fa fede il testo inglese.

Un documento per ogni componente di YuTreno. Ciascuno dice a cosa serve il componente, di cosa è responsabile e di cosa no, le sue interfacce, le principali strutture dati e algoritmi, le invarianti che deve mantenere, come è provato e dove si presta a essere esteso. Completano [ARCHITETTURA.md](../ARCHITETTURA.md), che segue i dati attraverso una corsa, e [STANDARD.md](../STANDARD.md), che discute gli standard dietro i componenti.

| Componente | Codice | Documento |
| :-- | :-- | :-- |
| Nucleo della simulazione: linea, preset, ciclo della corsa, scenari, verdetto, strato di compatibilità | `src/core/simulation.ts`, `run-state.ts`, `trains.ts`, `outputs.ts`, `commands.ts`, `leader.ts`, `boarding.ts`, `line.ts`, `presets.ts`, `scenario.ts`, `legacy.ts` | [nucleo.md](nucleo.md) |
| Dinamica del treno: multimassa e punto materiale | `src/core/dynamics.ts`, `consist.ts` | [dinamica.md](dinamica.md) |
| Blocco, supervisione ETCS interna e SCMT | `src/core/signalling.ts` | [segnalamento.md](segnalamento.md) |
| Bordo ETCS di riferimento (EVC) e i suoi scambi con il motore | `src/core/evc.ts`, `onboard-bridge.ts` | [bordo-riferimento.md](bordo-riferimento.md) |
| RBC semplice a messaggi e gruppi di balise | `src/core/simple-rbc.ts` | [rbc-semplice.md](rbc-semplice.md) |
| Terra con apparato: piazzale, apparato, RBC, Tabelle delle Condizioni | `src/core/field.ts`, `trackside-bridge.ts`, `src/trackside/` | [terra-apparato.md](terra-apparato.md) |
| Regolatore della circolazione: regolatore di riferimento e suo protocollo | `src/regulator/`, `src/core/regulator-bridge.ts` | [regolatore.md](regolatore.md) |
| Rete: linee che si incontrano nei nodi, itinerari compilati in corridoi, itinerari di nodo | `src/core/network.ts`, `traffic.ts` | [rete.md](rete.md) |
| Protocolli: API del controllore, dinamica esterna, bordo, terra, regolatore, versioni | `src/core/types.ts`, `controller.ts`, `legacy.ts` | [protocolli.md](protocolli.md) |
| Interfaccia web e vista 3D | `src/web/`, `src/docs/` | [interfaccia-web.md](interfaccia-web.md) |
| Flussi di dati aperti: GTFS, GTFS-Realtime, SIRI, NeTEx profilo italiano | `src/feeds/`, `src/server/feeds-server.ts` | [dati-aperti.md](dati-aperti.md) |
| Passeggeri: domanda, salite, sosta, capacità, massa a bordo | `src/core/passengers.ts`, `boarding.ts` | [PASSEGGERI.md](../PASSEGGERI.md) |
| Istantanea della sala di controllo | `src/core/control-room.ts`, `src/web/control-room.ts` | [SALA_CONTROLLO.md](../SALA_CONTROLLO.md) |
| Importazione dell'infrastruttura reale: OpenStreetMap, RINF, modello del terreno | `src/infra/`, `src/server/import-infra.ts` | [IMPORTAZIONE_INFRA.md](../IMPORTAZIONE_INFRA.md) |
| Strumenti: runner senza grafica, ponte, campagna, validazione delle curve, tracciabilità, Docker | `src/server/`, `scripts/`, `docker/` | [strumenti.md](strumenti.md) |

Tre regole li attraversano tutti.

1. **Determinismo.** Con la stessa linea, lo stesso treno, lo stesso scenario e gli stessi comandi una corsa produce gli stessi dati byte per byte. Nessun componente legge l'orologio o usa casualità non ripetibile; i programmi esterni sono accoppiati in lockstep.
2. **Confini fra gli strati.** Il nucleo non dipende né dal browser né da Node; l'interfaccia non contiene fisica né segnalamento; il bordo di riferimento, la terra e il regolatore non importano nulla dal motore oltre ai tipi del protocollo e allo strato di compatibilità, così che un programma esterno possa fare tutto quello che fanno loro.
3. **Protocolli pubblici.** I cinque protocolli (controllore, dinamica, bordo, terra, regolatore) sono interfacce su cui altri programmano: i campi nuovi sono facoltativi, i nomi seguono gli standard dove esistono, e i formati italiani della versione 0.x continuano a funzionare.
