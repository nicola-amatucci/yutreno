"""
YuTreno environment for agents, for example with reinforcement learning.

It starts the agent environment of YuTreno (src/server/agent-env.ts) as a child process and talks to it with one
JSON line per message. Two levels:

- YuTrenoClient: the raw protocol, any number of trains, observations and commands as dictionaries;
- YuTrenoEnv: a single-train environment with the Gymnasium interface (reset/step, observation vector, continuous
  action in [-1, 1]: positive is traction, negative is brake). It subclasses gymnasium.Env when Gymnasium is
  installed, and works without it otherwise.

Runs are deterministic: the same scenario and the same actions give the same episode.

    python examples/agents/yutreno_env.py            # one episode of a simple heuristic agent
"""
import json
import os
import shutil
import subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

try:
    import gymnasium as gym
    import numpy as np
    from gymnasium import spaces
    BASE = gym.Env
except ImportError:  # the environment also works without Gymnasium
    gym = None
    np = None
    BASE = object


class YuTrenoClient:
    """Raw protocol of src/server/agent-env.ts."""

    def __init__(self):
        npx = shutil.which("npx") or "npx"
        self.proc = subprocess.Popen([npx, "tsx", "src/server/agent-env.ts"], cwd=ROOT, stdin=subprocess.PIPE,
                                     stdout=subprocess.PIPE, text=True, bufsize=1)

    def call(self, msg):
        self.proc.stdin.write(json.dumps(msg) + "\n")
        self.proc.stdin.flush()
        out = json.loads(self.proc.stdout.readline())
        if "error" in out:
            raise RuntimeError(out["error"])
        return out

    def reset(self, scenario, agents, period=0.2):
        return self.call({"cmd": "reset", "scenario": scenario, "agents": agents, "period": period})

    def step(self, actions):
        return self.call({"cmd": "step", "actions": actions})

    def close(self):
        if self.proc.poll() is None:
            self.proc.stdin.write(json.dumps({"cmd": "close"}) + "\n")
            self.proc.stdin.close()
            self.proc.wait(timeout=10)


def features(obs):
    """Observation vector: speed, permitted speed, distance and speed of the target, distance to the next stop, doors, gradient."""
    sup = obs["supervision"]
    tgt = sup.get("target") or {}
    stop = obs.get("next_stop")
    return [
        obs["vel_ms"], sup["v_permitted_ms"],
        min(tgt.get("distance_m", 5000.0), 5000.0), tgt.get("speed_ms", sup["v_mrsp_ms"]),
        min(stop["pos_m"] - obs["pos_m"], 5000.0) if stop else 5000.0,
        1.0 if obs["doors_open"] else 0.0, obs["current_gradient_permille"],
    ]


class YuTrenoEnv(BASE):
    """Single-train environment: the agent drives `train_id`; every other train is driven by the built-in ATO."""

    def __init__(self, scenario="scenarios/services/following.json", train_id="R 2102", period=0.2):
        self.scenario, self.train_id, self.period = scenario, train_id, period
        self.client = YuTrenoClient()
        self.last = None
        if gym is not None:
            self.observation_space = spaces.Box(low=-1e4, high=1e4, shape=(7,), dtype=np.float32)
            self.action_space = spaces.Box(low=-1.0, high=1.0, shape=(1,), dtype=np.float32)

    def _vec(self, obs):
        v = features(obs)
        return np.asarray(v, dtype=np.float32) if np is not None else v

    def reset(self, seed=None, options=None):
        st = self.client.reset(self.scenario, [self.train_id], self.period)
        self.last = st["observations"][self.train_id]
        return self._vec(self.last), {}

    def step(self, action):
        a = float(action[0] if hasattr(action, "__len__") else action)
        cmd = {"traction": max(0.0, a), "brake": max(0.0, -a), "vigilance": True}
        st = self.client.step({self.train_id: cmd})
        if st["done"]:
            summary = st["info"]["summaries"][self.train_id]
            # end of episode: penalty for every protection intervention, overrun and missed stop
            reward = -100.0 * (summary["interventions"] + summary["overruns"]) - 50.0 * sum(1 for s in summary["stops"] if s["err"] is None)
            return self._vec(self.last), reward, True, False, st["info"]
        obs = st["observations"][self.train_id]
        # step reward: progress along the line, minus a small cost for traction energy
        reward = (obs["pos_m"] - self.last["pos_m"]) / 100.0 - 0.01 * obs["traction"]
        self.last = obs
        return self._vec(obs), reward, False, False, {}

    def close(self):
        self.client.close()


if __name__ == "__main__":
    env = YuTrenoEnv()
    x, _ = env.reset()
    total, steps, done, info = 0.0, 0, False, {}
    while not done:
        v, vp, dt, vt, ds = x[0], x[1], x[2], x[3], x[4]
        # heuristic agent: stay 2 m/s below the permitted speed, brake for the target and the stop
        want = min(vp - 2.0, (2 * 0.45 * max(0.0, dt - 25)) ** 0.5 if vt == 0 else vp, (2 * 0.45 * max(0.0, ds - 0.5)) ** 0.5)
        a = max(-1.0, min(1.0, 0.5 * (want - v)))
        x, r, done, _, info = env.step([a])
        total += r
        steps += 1
    env.close()
    s = info["summaries"][env.train_id]
    print(f"episode of {steps} decisions, reward {total:.1f}, outcome {s['outcome']}, "
          f"interventions {s['interventions']}, overruns {s['overruns']}, arrival {s['t_s']} s")
