"""Example external controller for YuTreno.

Usage:
    pip install websockets
    python example_controller.py            # listens on ws://localhost:8765

Then open yutreno.html in the browser, tab "Controller and API", press "External controller", go back to the
Drive tab and start the service. Headless: npm run headless -- --controller ws://localhost:8765

Simulator and controller run in lockstep: at every control period the simulator sends a JSON observation and waits
for the answer before going on. The command is a JSON object with the optional fields:
    traction (0..1), brake (0..1), lever (-8..10), vigilance, emergency, note
All quantities are in SI units (m, s, m/s). The observation is the English format, API version 3 (docs/API.md).

The script also records every observation in a CSV file, useful for analysis.
"""
import asyncio
import csv
import json
import math
import time

import websockets

MARGIN = 2.0       # m/s below the permitted speed
DECEL = 0.45       # m/s², design deceleration for stops
KP, KI = 0.55, 0.08


class Controller:
    """Simplified ATO: follows the permitted speed and stops the train in the stations."""

    def __init__(self):
        self.integral = 0.0

    def step(self, o):
        cmd = {}
        if o["vigilance_alarm"]:
            cmd["vigilance"] = True
        if o["emergency"] or o["doors_open"]:
            self.integral = 0.0
            cmd.update(traction=0, brake=0.5)
            return cmd

        sup = o["supervision"]
        v_target = sup["v_permitted_ms"] - MARGIN

        # end of movement authority or red signal: stop 25 m before
        tg = sup.get("target")
        if tg and tg["speed_ms"] == 0:
            d = tg["distance_m"] - 25
            v_target = min(v_target, math.sqrt(2 * DECEL * max(0.0, d)))
            if d < 1:
                cmd.update(traction=0, brake=1)
                return cmd

        # station stop with the head on the stop marker
        st = o.get("next_stop")
        if st:
            d = st["pos_m"] - o["pos_m"]
            if d < 600:
                v_target = min(v_target, max(0.8 if d > 2 else 0.0, math.sqrt(2 * DECEL * max(0.0, d - 0.5))))
            if d < 0.6:
                cmd.update(traction=0, brake=1)
                return cmd

        e = v_target - o["vel_ms"]
        self.integral = max(-3.0, min(3.0, self.integral + e * o["dt"]))
        u = KP * e + KI * self.integral
        if u >= 0:
            cmd.update(traction=min(1.0, u), brake=0)
        else:
            cmd.update(traction=0, brake=min(1.0, -u * 0.8))
        return cmd


async def handle(ws):
    c = Controller()
    name = time.strftime("run_%Y%m%d_%H%M%S.csv")
    print("Simulator connected, recording to", name)
    with open(name, "w", newline="", encoding="utf-8") as fh:
        w = csv.writer(fh)
        w.writerow(["t", "pos_m", "vel_ms", "v_permitted_ms", "state", "traction", "brake"])
        async for message in ws:
            o = json.loads(message)
            cmd = c.step(o)
            w.writerow([o["t"], round(o["pos_m"], 2), round(o["vel_ms"], 3),
                        round(o["supervision"]["v_permitted_ms"], 3), o["supervision"]["state"],
                        cmd.get("traction", ""), cmd.get("brake", "")])
            for ev in o.get("events", []):
                print(f'{ev["t"]:8.1f} s  {ev["type"]:5}  {ev["text"]}')
            await ws.send(json.dumps(cmd))
    print("Simulator disconnected")


async def main():
    async with websockets.serve(handle, "localhost", 8765):
        print("Controller listening on ws://localhost:8765")
        await asyncio.Future()


if __name__ == "__main__":
    asyncio.run(main())
