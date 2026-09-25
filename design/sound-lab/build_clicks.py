#!/usr/bin/env python3
"""Generic clicks from design/sfx-library (already licensed), each labelled by its source library.
Every click-type clip is cut into single clicks lined up on the MAIN hit (the loudest transient,
backed up to where it rises out of the noise), then measured: pitch share (≤0.40 unpitched), the
number of separate hits, and decay length. Owner, 2026-09-25: "find a generic clicking sound library
and provide me the sound" (not synthesised).
Run from statisticasino/:  python3 design/sound-lab/build_clicks.py → clicks/*.wav + clicks.json
"""
import json, os, re, subprocess, sys, wave, numpy as np
ROOT = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.join(ROOT, "..", "sfx-library")
OUT = os.path.join(ROOT, "clicks")
sys.path.insert(0, ROOT)
from measure import pitch, hits, zipness, env, SR

def decode(p):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", p, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()
def write(path, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())

def clicks_in(x, max_n):
    """Separate click events: regions above −30 dB of the take's peak, gaps ≥ 80 ms; for each, the
    main hit = its loudest 2 ms point; the cut starts where that hit rises out of the noise."""
    e = env(x, 2); pk = e.max() or 1; db = 20 * np.log10(e / pk + 1e-9)
    hop = int(0.002 * SR); a = db[::hop] > -30; regs = []; i = 0
    while i < len(a):
        if a[i]:
            j = i
            while j < len(a) and (a[j] or (j + 40 < len(a) and a[j:j + 40].any())): j += 1
            regs.append((i * hop, j * hop)); i = j
        else: i += 1
    out = []
    for s0, s1 in regs:
        seg = e[s0:s1]
        if not len(seg): continue
        m = s0 + int(np.argmax(seg)); lvl = e[m]
        k = m
        while k > s0 and e[k] > lvl * 0.1 and m - k < int(0.03 * SR): k -= 1       # back to −20 dB of the hit
        out.append((max(0, k - int(0.001 * SR)), s1))
    out.sort(key=lambda r: -e[r[0]:r[1]].max())                                     # loudest first
    return sorted(out[:max_n])

def bright(y):
    """Spectral centroid of the first 30 ms after the hit, in Hz (higher = thinner, snappier)."""
    i = int(np.argmax(env(y, 2))); q = y[i:i + int(0.03 * SR)]
    if len(q) < 256: return 0
    sp = np.abs(np.fft.rfft(q * np.hanning(len(q)))); f = np.fft.rfftfreq(len(q), 1 / SR)
    return int((sp * f).sum() / (sp.sum() or 1))

def main():
    rows = json.load(open(os.path.join(LIB, "rows.json")))
    pick = []
    for r in rows:
        if r["fam"] not in ("ui", "other", "casino-misc"): continue
        kenney = r["lib"] == "Kenney" and re.match(r"kenney-ui-(click|tick|switch|toggle|select|drop|scroll|scratch|back)", r["id"])
        other = r["lib"] != "Kenney" and re.search(r"click|tap|tick|switch|snap|knock|button|press|clack", r["title"], re.I)
        if (kenney or other) and not re.search(r"tone|beep|bubble|sci.?fi|high tone|reverb|retro|robot|pop", r["title"], re.I):
            pick.append(r)
    os.makedirs(OUT, exist_ok=True)
    groups = {}
    for r in pick:
        p = os.path.join(LIB, "audio", r["id"] + ".mp3")
        if not os.path.exists(p): continue
        try: x = decode(p)
        except Exception: print("unreadable, skipped:", r["id"]); continue
        take = len(x) / SR > 1.6                         # a long take of several clicks: up to 3 of them
        for n, (a, b) in enumerate(clicks_in(x, 3 if take else 1)):
            b = min(b + int(0.04 * SR), a + int(0.35 * SR), len(x))
            y = x[a:b].copy()
            if len(y) < int(0.01 * SR): continue
            f = min(len(y) // 3, int(0.02 * SR)); y[-f:] *= np.linspace(1, 0, f)
            y = np.concatenate([y, np.zeros(int(0.05 * SR))]); y *= 10 ** (-3 / 20) / (np.abs(y).max() or 1)
            key = f"{r['id']}" + (f"-{n + 1}" if take else "")
            write(os.path.join(OUT, key + ".wav"), y)
            e = env(y, 2); pk = e.max(); tail = np.where(20 * np.log10(e / pk + 1e-9) > -30)[0]
            item = {"file": f"clicks/{key}.wav", "title": r["title"].replace("Freesound - ", "") + (f" — click {n + 1} of the take" if take else ""),
                    "id": r["id"], "license": r["license"], "pitch": round(pitch(y), 2), "hits": len(hits(y)),
                    "hitAt": round(float(np.argmax(e) / SR * 1000), 1), "decay": round(float((tail[-1] - tail[0]) / SR * 1000)) if len(tail) else 0,
                    "zip": zipness(y), "bright": bright(y)}
            item["clean"] = item["pitch"] <= 0.40 and item["hits"] <= 1 and item["hitAt"] <= 12 and not item["zip"]
            lib = {"Kenney": "Kenney — Interface Sounds (CC0)", "BigSoundBank": "BigSoundBank (CC0)", "Mixkit": "Mixkit (free licence, no credit)", "Freesound": "Freesound — various authors"}[r["lib"]]
            groups.setdefault(lib, []).append(item)
    for g in groups.values(): g.sort(key=lambda i: (not i["clean"], i["pitch"]))
    json.dump(groups, open(os.path.join(ROOT, "clicks.json"), "w"), indent=1)
    for k, g in groups.items(): print(f"{k:38} {len(g):3} clicks, {sum(i['clean'] for i in g):3} clean (unpitched, one hit, hit ≤12 ms)")

main()
