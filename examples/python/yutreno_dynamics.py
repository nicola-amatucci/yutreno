"""External dynamics model in Python, listening on TCP: the same point mass as examples/dynamics_point.js.
It shows the protocol a MATLAB/Simulink model will use: one JSON line per request and one JSON line per response.

    python examples/python/yutreno_dynamics.py                 # listening on localhost:5555
    npm run headless -- --dynamics tcp://localhost:5555

With --stdio it reads the requests from stdin and writes the responses to stdout: the engine starts it by itself.

    npm run headless -- --dynamics "exec:python examples/python/yutreno_dynamics.py --stdio"

Standard library only. It serves one run at a time; at the end it listens again.
"""
import json
import math
import socket
import sys

G, H = 9.81, 1 / 200


def step(req, mem):
    """Advances req['dt'] seconds and returns the state of the head of the train."""
    if req["start"]:
        T = req["train"]
        mem.clear()
        mem.update(T=T, ME=T["m"] * T["rot"], s=req["state"]["pos_m"], v=req["state"]["vel_ms"], Ft=0.0, Fb=0.0, Fed=0.0, eT=0.0, eR=0.0)
    T, ME = mem["T"], mem["ME"]
    # passengers on board (optional field payload_kg): they add to the mass and to the equivalent mass
    pay = req.get("payload_kg") or 0.0
    if pay:
        T, ME = {**T, "m": T["m"] + pay}, ME + pay
    c, b, k = req["commands"], req["track"], req["faults"]
    mu, grads = b["adhesion_mu"], b["gradients"]

    def rise(x0, x1):
        return sum((min(z, x1) - max(a, x0)) * i / 1000 for a, z, i in grads if min(z, x1) > max(a, x0))

    def grade_at(x):
        for a, z, i in grads:
            if a <= x < z:
                return i
        return grads[-1][2] if grads else 0.0

    slip = wsp = False
    acc = R = Fg = 0.0
    for _ in range(max(1, round(req["dt"] / H))):
        v = mem["v"]
        fcap = min(T["Fmax"], T["Pw"] / max(v, 1)) * k["traction_factor"]
        muT = mu * T["adh"] * T["m"] * G
        trac = c["traction"] * fcap
        slip = trac > muT and c["traction"] > 0
        if slip:
            trac = muT
        rate = T["Fmax"] * 0.45 * H
        mem["Ft"] += max(-2 * rate, min(rate, trac - mem["Ft"]))
        mem["Ft"] = min(max(mem["Ft"], 0), min(fcap, muT))
        brk = (ME * T["bEm"] if c["emergency"] else ME * T["bSvc"] * min(1, max(0, c["brake"]))) * k["brake_factor"]
        muB = mu * T["m"] * G * 0.95
        wsp = brk > muB and v > 0.5
        brk = min(brk, muB)
        tau = T["tauB"] if brk > mem["Fb"] else T["tauR"]
        mem["Fb"] += (brk - mem["Fb"]) * (1 - math.exp(-H / max(0.05, tau)))
        mem["Fed"] = min(mem["Fb"], T["edMax"], T["Pw"] / max(v, 1)) if v > 1.5 and not c["emergency"] else 0.0
        back = max(0.0, mem["s"] - T["L"])
        i = rise(back, mem["s"]) / (mem["s"] - back) * 1000 if mem["s"] - back > 1 else grade_at(mem["s"])
        Fg = T["m"] * G * i / 1000
        R = T["A"] + T["B"] * v + T["C"] * v * v if v > 0.01 else 0.0
        drive = mem["Ft"] - Fg
        if v < 0.01:
            opp = mem["Fb"] + T["A"]
            if drive > opp:
                acc = (drive - opp) / ME
            else:
                acc, mem["v"] = 0.0, 0.0
        else:
            acc = (drive - mem["Fb"] - R) / ME
        mem["v"] = max(0.0, mem["v"] + acc * H)
        mem["s"] += mem["v"] * H
        mem["eT"] += mem["Ft"] * mem["v"] * H / T["eta"] / 3.6e6
        mem["eR"] += mem["Fed"] * mem["v"] * H * T["etaR"] / 3.6e6
    return {
        "pos_m": mem["s"], "vel_ms": mem["v"], "acc_ms2": acc, "slip": slip, "wsp": wsp,
        "forces_kN": {"traction": mem["Ft"] / 1000, "brake": mem["Fb"] / 1000, "electric_brake": mem["Fed"] / 1000,
                      "resistance": R / 1000, "gradient": Fg / 1000},
        "traction_energy_kWh": mem["eT"], "regenerated_energy_kWh": mem["eR"],
    }


def main(port=5555, once=False):
    srv = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    srv.bind(("127.0.0.1", port))
    srv.listen(1)
    print(f"Dynamics model listening on tcp://localhost:{port}", flush=True)
    while True:
        conn, _ = srv.accept()
        conn.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        mem, buf, n = {}, b"", 0
        with conn:
            while True:
                data = conn.recv(65536)
                if not data:
                    break
                buf += data
                while b"\n" in buf:
                    line, buf = buf.split(b"\n", 1)
                    if line.strip():
                        conn.sendall((json.dumps(step(json.loads(line), mem)) + "\n").encode())
                        n += 1
        print(f"Run finished after {n} exchanges", flush=True)
        if once:
            return


def stdio():
    """One JSON line per request on stdin, one per response on stdout; messages go to stderr."""
    mem = {}
    for line in sys.stdin:
        if line.strip():
            sys.stdout.write(json.dumps(step(json.loads(line), mem)) + "\n")
            sys.stdout.flush()


if __name__ == "__main__" and "--stdio" in sys.argv:
    stdio()
elif __name__ == "__main__":
    main(int(sys.argv[1]) if len(sys.argv) > 1 and sys.argv[1].isdigit() else 5555, "--once" in sys.argv or "--una-volta" in sys.argv)
