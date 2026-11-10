#!/usr/bin/env python3
"""A minimal external regulator for YuTreno, in Python (docs/REGULATOR.md).

It reads one JSON request per line from stdin and writes one JSON response per line on stdout. Policy: a train that
is broken down loses priority, and the departure of a train from the last station before a blocked stretch is moved
after the expected reopening. Everything else is left to the interlocking. It is a starting point for a research
regulator; the reference one is src/regulator/index.ts.

    npm run headless -- --scenario scenarios/services/breakdown.json --regulator "exec:python3 examples/regulator/regulator_example.py"
"""
import json
import sys

MARGIN_S = 30
HOLD_S = 120
sent_priority = {}


def decide(req):
    commands, log = [], []
    for tr in req["trains"]:
        if tr["finished"]:
            continue
        prio = -2 if tr["broken"] else 0
        if sent_priority.get(tr["id"], 0) != prio:
            sent_priority[tr["id"]] = prio
            commands.append({"type": "priority", "train": tr["id"], "value": prio})
            log.append(f"{tr['id']}: priority {prio}")
        pending = [s for s in tr["stops"] if not s["skipped"] and s["realised_departure_s"] is None and s["departure_s"] is not None]
        for d in req["disruptions"]:
            if d["type"] != "line_blocked":
                continue
            ahead = tr["s_m"] < d["from_m"] if tr["dir"] > 0 else tr["s_m"] > d["to_m"]
            before = [s for s in pending if (s["s_m"] <= d["from_m"] if tr["dir"] > 0 else s["s_m"] >= d["to_m"])]
            if not ahead or not before:
                continue
            stop = before[-1]
            until = d["until_s"] if d["until_s"] is not None else req["t"] + HOLD_S
            dep = max(stop["planned_departure_s"] or 0, until + MARGIN_S)
            if abs(dep - stop["departure_s"]) > 20:
                commands.append({"type": "retime", "train": tr["id"], "station": stop["station"], "departure_s": dep})
                log.append(f"{tr['id']}: held at {stop['station']} until {dep:.0f} s, line blocked")
    return {"commands": commands, "log": log}


for line in sys.stdin:
    if line.strip():
        sys.stdout.write(json.dumps(decide(json.loads(line))) + "\n")
        sys.stdout.flush()
