#!/usr/bin/env python3
"""The owner's picked sounds (2026-09-25) → Sound Lab option D "Your pick", each with its LEAD: the ms
from the clip's start to its main hit, so the lab can start it early and land the hit on the frame.
Cards: deal = Kenney card slide 3 · flip = Vrymaa @0.3 s · pile taps (fold + collection) = Index Card
Flips @3.7 s · shuffle = 5ro4 riffle (its first 2.1 s continuous riffle, slowed to fill 2.6 s, no pitch
change) · Coins (clay, all in rotation): one / few / pile tiers by coin count · all-in = clay clip 33.
Run from statisticasino/:  python3 design/sound-lab/build_picks.py"""
import json, os, subprocess, wave, numpy as np
ROOT = os.path.dirname(os.path.abspath(__file__)); SR = 44100
def load(p):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", p, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()
def lead_ms(y):
    w = int(0.002 * SR); e = np.sqrt(np.convolve(y ** 2, np.ones(w) / w, mode="same")); return round(float(np.argmax(e) / SR * 1000), 1)
def save(name, y):
    y = np.concatenate([y, np.zeros(int(0.05 * SR))]); y = y * (10 ** (-3 / 20) / (np.abs(y).max() or 1))
    with wave.open(os.path.join(ROOT, "picks", name), "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(y, -1, 1) * 32767).astype("<i2").tobytes())
    return {"file": f"picks/{name}", "lead": lead_ms(y), "src": "owner pick", "pitch": 0}
def pick(src, name): return save(name, load(os.path.join(ROOT, src)))

opts = {
  "cardLand": {"label": "Your pick — Kenney “card slide 3”", "clips": [pick("found/cardDeal-3.wav", "deal.wav")]},
  "flip":     {"label": "Your pick — “Shuffling deck & deal” @ 0.3 s", "clips": [pick("found/cardFlip-2.wav", "flip.wav")]},
  "pileTap":  {"label": "Your pick — “Index Card Flips” @ 3.7 s", "clips": [pick("found/cardFold-5.wav", "pile.wav")]},
  "coinsLand": {"label": "Your pick — clay chips (1 · 2–4 · 5+)", "clips": [], "tiers": {
      "one": [pick(f"chips/one-clay-{i}.wav", f"clay-one-{i}.wav") for i in (1, 2, 3)],
      "few": [pick(f"chips/few-clay-{i}.wav", f"clay-few-{i}.wav") for i in (1, 2, 3)],
      "pile": [pick("chips/pile-clay-1.wav", "clay-pile-1.wav"), pick("chips/pile-clay-3.wav", "clay-pile-2.wav"), pick("chips/allin-clay-1.wav", "clay-pile-3.wav")]}},
  "sweepLand": {"label": "Your pick — clay chips, a pile", "clips": [pick("chips/pile-clay-1.wav", "clay-sweep-1.wav"), pick("chips/pile-clay-3.wav", "clay-sweep-2.wav"), pick("chips/allin-clay-1.wav", "clay-sweep-3.wav")]},
}
# the riffle: 0–2.15 s of the same recording is one continuous riffle; slow it (atempo keeps pitch) to 2.62 s
src = os.path.join(ROOT, "..", "sfx-library", "audio", "fs-611107.mp3")
raw = subprocess.run(["ffmpeg", "-v", "error", "-ss", "0", "-t", "2.15", "-i", src, "-af", f"atempo={2.15 / 2.62:.4f}", "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
r = np.frombuffer(raw, dtype=np.float32).copy(); f = int(0.15 * SR); r[-f:] *= np.linspace(1, 0, f)
opts["riffle"] = {"label": "Your pick — “cards riffle shuffle” (5ro4)", "clips": [save("riffle.wav", r)]}
allin = {"label": "Your pick — clay chips clip 33 (13 hits)", "clips": [pick("chips/pile-clay-2.wav", "clay-allin.wav")]}

m = json.load(open(os.path.join(ROOT, "clips.json")))
m["riffle"][2]["ticks"] = True                            # option C = a tick per card
for ev, o in opts.items():
    m[ev] = [x for x in m[ev] if not x.get("pick")][:3] + [{**o, "pick": True}]
m["allIn"] = [{**allin, "pick": True}]
json.dump(m, open(os.path.join(ROOT, "clips.json"), "w"), indent=1)
for ev, o in {**opts, "allIn": allin}.items():
    cl = o["clips"] or [c for t in o.get("tiers", {}).values() for c in t]
    print(f"{ev:10} {len(cl)} clip(s), main hit at", [c["lead"] for c in cl], "ms")
