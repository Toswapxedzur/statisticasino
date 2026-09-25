#!/usr/bin/env python3
"""Measure Sound Lab clips the way the owner's ear would object to: where the main hit is (it should
be within ~12 ms of the start), how many separate hits, pitch (share of energy in the 5 strongest
narrow peaks; ≤0.40 = unpitched) and the "zip" test (loud ≥80 ms + centroid sweeping >3 kHz/s +
noisy). Usage: python3 design/sound-lab/measure.py [option-index ...]   (default: all options)"""
import json, os, sys, wave, numpy as np
ROOT = os.path.dirname(os.path.abspath(__file__)); SR = 44100
def load(p):
    with wave.open(p) as w: return np.frombuffer(w.readframes(w.getnframes()), dtype="<i2").astype(np.float32) / 32767
def env(x, ms): w = int(ms / 1000 * SR); return np.sqrt(np.convolve(x ** 2, np.ones(w) / w, mode="same"))
def pitch(x):
    n = min(len(x), SR // 2)
    if n < 512: return 0.0
    sp = np.abs(np.fft.rfft(x[:n] * np.hanning(n))) ** 2; tot = sp.sum() or 1; s = sp.copy(); sh = 0
    for _ in range(5):
        k = int(np.argmax(s)); lo, hi = max(0, k - 3), k + 4; sh += s[lo:hi].sum(); s[lo:hi] = 0
    return float(sh / tot)
def hits(x):
    e = env(x, 4); pk = e.max() or 1; db = 20 * np.log10(e / pk + 1e-9); h = int(0.0025 * SR); fr = db[::h]; lag = 6; ons = [0.0]
    for i in range(lag, len(fr) - 1):
        r = fr[i] - fr[i - lag]
        if r >= 6 and fr[i] > -24 and r >= fr[i - 1] - fr[i - 1 - lag] and r >= fr[i + 1] - fr[i + 1 - lag]:
            t = i * h / SR
            if t - ons[-1] >= 0.03: ons.append(t)
    return ons
def zipness(x):
    e = env(x, 5); pk = e.max(); n = 1024; ts = []; cs = []; fl = []
    for i in range(0, len(x) - n, int(0.01 * SR)):
        q = x[i:i + n]
        if np.sqrt((q ** 2).mean()) < pk * 0.3: continue
        sp = np.abs(np.fft.rfft(q * np.hanning(n))) + 1e-12; f = np.fft.rfftfreq(n, 1 / SR)
        ts.append(i / SR); cs.append((sp * f).sum() / sp.sum()); fl.append(np.exp(np.log(sp).mean()) / sp.mean())
    db = 20 * np.log10(e / pk + 1e-9); loud = np.where(db > -10)[0]; span = (loud[-1] - loud[0]) / SR if len(loud) else 0
    slope = np.polyfit(ts, cs, 1)[0] if len(ts) > 3 else 0
    return bool(span >= 0.08 and abs(slope) > 3000 and np.mean(fl) > 0.4)
if __name__ == "__main__":
    want = {int(a) for a in sys.argv[1:]} or None
    m = json.load(open(os.path.join(ROOT, "clips.json"))); bad = 0
    for ev, opts in m.items():
        for oi, o in enumerate(opts):
            if want is not None and oi not in want: continue
            for c in o["clips"] + o.get("many", []):
                x = load(os.path.join(ROOT, c["file"])); tpk = np.argmax(env(x, 4)) / SR; p = pitch(x); z = zipness(x); h = hits(x)
                flag = [f"main hit {tpk * 1000:.0f} ms in"] if tpk > 0.012 and ev not in ("riffle", "sweepStart", "collect", "deckSlide") else []
                if p > 0.40: flag.append(f"pitch {p:.2f}")
                if z: flag.append("ZIP")
                bad += bool(flag)
                print(f"{ev:10} {'ABCD'[oi]} {os.path.basename(c['file']):22} hit at {tpk * 1000:5.1f} ms  hits {len(h)}  pitch {p:.2f}  {'<-- ' + ', '.join(flag) if flag else 'ok'}")
    print("flagged:", bad)
