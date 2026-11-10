"""Minimal ETCS onboard in Python, a template for connecting your own EVC to YuTreno.

It speaks the external onboard protocol on stdin/stdout, one JSON line per message:

    npm run headless -- --onboard "exec:python examples/onboard/minimal_onboard.py"

It does the bare minimum, in a deliberately simple way:
  - it locates itself on the last balise group read (LRBG) and reports it to the RBC with message 136;
  - it reads from message 3 the authority (packet 15), the static profile (27) and the temporary restrictions (65, 66);
  - it computes a simple braking curve towards the end of authority and the speed reductions, and commands
    service and emergency brake;
  - it reacts to the emergency stop order (message 16).
It does not use gradients, brake build-up times or national margins: for those there is the reference onboard of the
core (src/core/evc.ts). Service messages go to stderr: stdout is reserved for the protocol.
"""
import json
import math
import sys

KMH = 1 / 3.6


class Onboard:
    def __init__(self, req):
        self.T = req["train_data"]
        self.N = req.get("national_values") or {}
        self.bg = {}             # NID_LRBG -> odometer at passage
        self.lrbg = None
        p = req.get("stored_position")
        if p:
            self.bg[p["NID_LRBG"]] = req["odometry"]["distance_m"] - p["D_LRBG"]
            self.lrbg = p["NID_LRBG"]
        self.eoa = None          # in odometer coordinates
        self.ssp = []            # [from, to, km/h]
        self.tsr = {}
        self.eb = self.sb = False
        self.reason = ""
        self.last_report = -1e9
        self.last_rbc = req["t"]

    def read(self, req):
        to_report = False
        for b in req["balises"]:
            tg = b["telegram"]
            if tg["N_PIG"] == 0:
                nid = tg["NID_C"] * 16384 + tg["NID_BG"]
                self.bg[nid], self.lrbg, to_report = b["odometer_m"], nid, True
        for m in req["radio"]:
            self.last_rbc = req["t"]
            if m["NID_MESSAGE"] == 16:
                self.eb, self.reason = True, "emergency_stop"
            if m["NID_MESSAGE"] != 3 or m["NID_LRBG"] not in self.bg:
                continue
            base = self.bg[m["NID_LRBG"]]
            for p in m.get("packets", []):
                if p["NID_PACKET"] == 15:
                    self.eoa = base + p["L_ENDSECTION"]
                elif p["NID_PACKET"] == 27:
                    self.ssp, x = [], base
                    el = [p] + p.get("elements", [])
                    for i, e in enumerate(el):
                        x += e["D_STATIC"]
                        if e["V_STATIC"] == 127:
                            break
                        end = x + el[i + 1]["D_STATIC"] if i + 1 < len(el) else x
                        self.ssp.append((x, end, e["V_STATIC"] * 5))
                elif p["NID_PACKET"] == 65:
                    a = base + p["D_TSR"]
                    self.tsr[p["NID_TSR"]] = (a, a + p["L_TSR"], p["V_TSR"] * 5)
                elif p["NID_PACKET"] == 66:
                    self.tsr.pop(p["NID_TSR"], None)
        return to_report

    def step(self, req):
        odo, v, t = req["odometry"]["distance_m"], req["odometry"]["speed_ms"], req["t"]
        to_report = self.read(req)
        T, L = self.T, self.T["L_TRAIN"]
        # maximum speed under the train and braking towards the end of authority
        lim = T["V_MAXTRAIN"]
        for a, b, vk in self.ssp + list(self.tsr.values()):
            if b > odo - L and a <= odo:
                lim = min(lim, vk)
        mrsp = lim * KMH if self.ssp else 0.0
        a = 0.7 * T["A_brake_service"]
        permitted = mrsp
        target = None
        # speed reductions ahead of the head: same curve, towards the lower speed
        for x0, x1, vk in self.ssp + list(self.tsr.values()):
            vt = vk * KMH
            if x0 > odo and vt < mrsp:
                curve = math.sqrt(vt * vt + 2 * a * max(0.0, x0 - odo - v * 3))
                if curve < permitted:
                    permitted, target = curve, {"distance_m": x0 - odo, "speed_ms": vt, "type": f"limit {vk} km/h"}
        if self.eoa is not None:
            d = self.eoa - odo
            curve = math.sqrt(2 * a * max(0.0, d - v * 3)) if d > 0 else 0.0
            curve = max(curve, 15 * KMH if d > 0 else 0.0)
            if curve < permitted:
                permitted, target = curve, {"distance_m": d, "speed_ms": 0, "type": "end of authority"}
        else:
            permitted = 0.0
        if v > permitted + 15 * KMH and not self.eb:
            self.eb, self.reason = True, "intervention"
        if self.eb and v < 0.01:
            self.eb = False
        if v > permitted + 7.5 * KMH:
            self.sb = True
        elif v <= permitted:
            self.sb = False
        if t - self.last_rbc > self.N.get("T_NVCONTACT", 20):
            self.sb = True
        radio = []
        if self.lrbg is not None and (to_report or t - self.last_report >= 5):
            radio.append({"NID_MESSAGE": 136, "T_TRAIN": round(t * 100), "packets": [{
                "NID_PACKET": 0, "Q_SCALE": 1, "NID_LRBG": self.lrbg, "D_LRBG": round(odo - self.bg[self.lrbg]),
                "Q_DIRLRBG": 1, "V_TRAIN": int(v * 3.6 / 5), "M_MODE": 0, "M_LEVEL": 3}]})
            self.last_report = t
        state = "INT" if self.eb else "SBI" if self.sb else "OVS" if v > permitted else "NOR"
        r = {"outputs": {"service_brake": self.sb, "emergency": self.eb, "traction_cut_off": self.eb or self.sb or self.eoa is None},
             "radio": radio,
             "dmi": {"mode": "FS" if self.eoa is not None else "SB", "state": state, "v_mrsp_ms": mrsp, "v_permitted_ms": permitted,
                     "v_warning_ms": permitted + 4 * KMH, "v_sbi_ms": permitted + 7.5 * KMH, "v_intervention_ms": permitted + 15 * KMH,
                     "target": target}}
        if self.eb:
            r["emergency_reason"] = self.reason
        return r


def main():
    onboard, n = None, 0
    for line in sys.stdin:
        if not line.strip():
            continue
        req = json.loads(line)
        if req["start"]:
            onboard = Onboard(req)
        sys.stdout.write(json.dumps(onboard.step(req)) + "\n")
        sys.stdout.flush()
        n += 1
    print(f"Minimal onboard: run finished after {n} cycles", file=sys.stderr)


if __name__ == "__main__":
    main()
