# Agenti: guidare i treni da fuori, anche con l'apprendimento

> Copia italiana di [AGENTS.md](../AGENTS.md). In caso di differenze fa fede il testo inglese.

Un agente è un programma che guida uno o più treni di una corsa. Riceve la stessa osservazione di un controllore ([API.md](API.md)), con il `train_id` del treno, e risponde con lo stesso comando. I treni dell'agente sono i treni di servizio di uno scenario con `"driver": "agent"` ([SCENARI.md](SCENARI.md)) e, se richiesto, il treno comandato. Tutti gli altri treni sono guidati dall'ATO interno, che segue la stessa logica di `examples/ato.js`.

Le corse restano deterministiche: lo stesso scenario e gli stessi comandi danno la stessa corsa byte per byte. È ciò che rende un agente confrontabile con un altro, e un esperimento di apprendimento ripetibile.

## Tre modi per collegare un agente

**Da TypeScript**, con `runLockstep(sim, controller, { agents })`: `agents` è chiamato con l'osservazione di ogni treno dell'agente al periodo di controllo.

**Senza grafica**, con `--agents`:

```bash
npm run headless -- --scenario my-scenarios/agents.json --agents my-agent.js            # un'istanza del file per treno
npm run headless -- --scenario my-scenarios/agents.json --agents ws://localhost:8770     # un solo WebSocket per tutti i treni
```

Un agente JavaScript definisce `control(obs, mem)` come un controllore; ogni treno ha la sua istanza e la sua `mem`. Via WebSocket il programma riceve le osservazioni di tutti i treni su una sola connessione e le distingue con `train_id`.

**Come ambiente**, per l'apprendimento per rinforzo o per agenti scritti in altri linguaggi: `npm run agent-env` (`src/server/agent-env.ts`) è un processo che parla righe JSON su stdin/stdout:

```text
→ {"cmd": "reset", "scenario": "scenarios/services/following.json", "agents": ["R 2102"], "period": 0.2}
← {"t": 300.2, "observations": {"R 2102": {...}}, "done": false}
→ {"cmd": "step", "actions": {"R 2102": {"traction": 0.6}}}
← {"t": 300.4, "observations": {"R 2102": {...}}, "done": false}
…
← {"t": 1213.4, "observations": {}, "done": true, "info": {"summaries": {...}, "timetable": [...]}}
→ {"cmd": "close"}
```

`agents` elenca i treni dell'agente: i servizi elencati qui sono guidati dall'agente anche se lo scenario dice `ato`, e `train` aggiunge il treno comandato. Ogni `step` applica i comandi e avanza finché un treno dell'agente non ha bisogno di una nuova decisione o la corsa finisce; alla fine `info` contiene il riepilogo di ogni treno e l'orario programmato e realizzato.

## Python e Gymnasium

`examples/agents/yutreno_env.py` avvia l'ambiente e offre due livelli:

- `YuTrenoClient`: il protocollo grezzo, con qualsiasi numero di treni;
- `YuTrenoEnv`: un treno con l'interfaccia di Gymnasium. L'osservazione è un vettore di sette numeri (velocità, velocità consentita, distanza e velocità del bersaglio, distanza dalla prossima fermata, porte, pendenza). L'azione è un numero in [−1, 1], trazione se positivo e freno se negativo. La ricompensa è un esempio da cambiare: avanzamento lungo la linea meno un piccolo costo della trazione a ogni passo, penalità per interventi, superamenti e fermate mancate alla fine. Estende `gymnasium.Env` quando Gymnasium è installato.

```bash
python examples/agents/yutreno_env.py     # un episodio di un agente euristico semplice
```

L'ambiente avanza circa 500 volte più veloce del tempo reale su un portatile, ma ogni decisione è un andata e ritorno fra Python e Node. Per addestramenti lunghi, un periodo più ampio (0,5–1 s) e più ambienti in processi paralleli sono le prime leve.

## Verifiche

`verify-services` controlla che l'ATO interno dato come agente, tramite `runLockstep` e tramite l'ambiente, dia esattamente la stessa corsa dell'ATO interno, e che una corsa con treni dell'agente senza agente collegato si fermi con un errore.
