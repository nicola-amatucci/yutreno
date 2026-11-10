# Agents: driving trains from outside, also with learning

An agent is a program that drives one or more trains of a run. It receives the same observation as a controller ([API.md](API.md)), with the `train_id` of the train, and answers with the same command. The trains of the agent are the service trains of a scenario with `"driver": "agent"` ([SCENARIOS.md](SCENARIOS.md#service-trains)) and, if asked, the controlled train. Every other train is driven by the built-in ATO, which follows the same logic as `examples/ato.js`.

Runs stay deterministic: the same scenario and the same commands give the same run byte by byte. This is what makes an agent comparable with another, and a learning experiment repeatable.

## Three ways to connect an agent

**From TypeScript**, with `runLockstep(sim, controller, { agents })`: `agents` is called with the observation of every train of the agent at the control period.

**Headless**, with `--agents`:

```bash
npm run headless -- --scenario my-scenarios/agents.json --agents my-agent.js            # one instance of the file per train
npm run headless -- --scenario my-scenarios/agents.json --agents ws://localhost:8770     # one WebSocket for all the trains
```

A JavaScript agent defines `control(obs, mem)` like a controller; every train gets its own instance and its own `mem`. Over WebSocket the program receives the observations of all the trains on one connection and tells them apart by `train_id`.

**As an environment**, for reinforcement learning or for agents written in other languages: `npm run agent-env` (`src/server/agent-env.ts`) is a process that speaks JSON lines on stdin/stdout:

```text
→ {"cmd": "reset", "scenario": "scenarios/services/following.json", "agents": ["R 2102"], "period": 0.2}
← {"t": 300.2, "observations": {"R 2102": {...}}, "done": false}
→ {"cmd": "step", "actions": {"R 2102": {"traction": 0.6}}}
← {"t": 300.4, "observations": {"R 2102": {...}}, "done": false}
…
← {"t": 1213.4, "observations": {}, "done": true, "info": {"summaries": {...}, "timetable": [...]}}
→ {"cmd": "close"}
```

`agents` lists the trains of the agent: services listed here are driven by the agent even if the scenario says `ato`, and `train` adds the controlled train. Every `step` applies the commands and advances until some train of the agent needs a new decision or the run ends; at the end `info` has the summary of every train and the planned and realised timetable.

## Python and Gymnasium

`examples/agents/yutreno_env.py` starts the environment and offers two levels:

- `YuTrenoClient`: the raw protocol, any number of trains;
- `YuTrenoEnv`: one train with the Gymnasium interface. The observation is a vector of seven numbers (speed, permitted speed, distance and speed of the target, distance to the next stop, doors, gradient). The action is one number in [−1, 1], traction when positive and brake when negative. The reward is an example to change: progress along the line minus a small cost of traction at every step, penalties for interventions, overruns and missed stops at the end. It subclasses `gymnasium.Env` when Gymnasium is installed.

```bash
python examples/agents/yutreno_env.py     # one episode of a simple heuristic agent
```

The environment advances about 500 times faster than real time on a laptop, but every decision is a round trip between Python and Node. For long trainings, a coarser period (0.5–1 s) and several environments in parallel processes are the first levers.

## Checks

`verify-services` checks that the built-in ATO given as an agent, through `runLockstep` and through the environment, gives exactly the same run as the built-in ATO, and that a run with agent trains and no agent connected stops with an error.
