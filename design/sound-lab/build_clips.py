#!/usr/bin/env python3
"""Cut the sound-lab candidates from design/sfx-library + static/sfx into short mono WAVs.

Each clip starts on its first transient (so it plays exactly when the animation event fires),
is capped, faded, peak-normalised, and measured for pitch (the owner's no-pitch rule).
Run from statisticasino/:  python3 design/sound-lab/build_clips.py
Writes design/sound-lab/clips/*.wav and design/sound-lab/clips.json.
"""
import json, subprocess, os, numpy as np, wave

ROOT = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.join(ROOT, "..", "sfx-library", "audio")
GAME = os.path.join(ROOT, "..", "..", "static", "sfx")
OUT = os.path.join(ROOT, "clips")
SR = 44100

def src(name):
    if name.startswith("game:"):
        return os.path.join(GAME, name[5:] + ".mp3")
    return os.path.join(LIB, name + ".mp3")

def decode(path):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()

def onset(x, start=0.0, thresh_db=-38):
    """First sample (after `start` s) whose 2 ms envelope rises within thresh_db of the clip's peak."""
    i0 = int(start * SR)
    seg = np.abs(x[i0:])
    if not len(seg): return i0
    win = int(0.002 * SR)
    env = np.convolve(seg, np.ones(win) / win, mode="same")
    peak = env.max() or 1
    idx = np.argmax(env > peak * 10 ** (thresh_db / 20))
    return i0 + max(0, idx - int(0.003 * SR))            # keep 3 ms of lead-in

def pitch_score(x):
    """Share of spectral energy in the 5 strongest narrow peaks (≤0.40 unpitched, ≥0.7 tonal)."""
    n = min(len(x), SR // 2)
    if n < 512: return 0.0
    spec = np.abs(np.fft.rfft(x[:n] * np.hanning(n))) ** 2
    total = spec.sum() or 1
    s = spec.copy(); share = 0.0
    for _ in range(5):
        k = int(np.argmax(s)); lo, hi = max(0, k - 3), k + 4
        share += s[lo:hi].sum(); s[lo:hi] = 0
    return float(share / total)

def write(path, x):
    y = np.clip(x, -1, 1)
    pcm = (y * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())

def cut(name, key, start=0.0, max_len=0.6, fade=0.04, repeat=None):
    x = decode(src(name))
    i = onset(x, start)
    y = x[i:i + int(max_len * SR)].copy()
    f = min(len(y), int(fade * SR))
    if f: y[-f:] *= np.linspace(1, 0, f)
    if repeat:                                             # e.g. a double knock: [(offset_s, gain)]
        base = y.copy(); y = np.zeros(len(base) + int(max(o for o, _ in repeat) * SR))
        for o, g in repeat:
            j = int(o * SR); y[j:j + len(base)] += base * g
    y = np.concatenate([y, np.zeros(int(0.06 * SR))])     # tail pad (decoders clip the last block)
    peak = np.abs(y).max() or 1
    y *= 10 ** (-3 / 20) / peak                            # peak −3 dBFS; the page sets per-event gain
    write(os.path.join(OUT, key + ".wav"), y)
    return {"file": f"clips/{key}.wav", "src": name, "dur": round(len(y) / SR, 3), "pitch": round(pitch_score(y), 2)}

# event → options; each option = label + clip specs (several = played round-robin, like a real
# dealer's hand never sounding twice the same). "many" = the variant for 3+ coins at once.
PLAN = {
  # ---- cards ----
  "cardLand": [
    ("Game now (ArtOrDie paper cards)", [("game:deal-1",), ("game:deal-2",), ("game:deal-3",), ("game:deal-4",)]),
    ("Kenney card place", [(f"kenney-casino-card-place-{i}",) for i in (1, 2, 3, 4)]),
    ("Single deals (Freesound)", [("fs-571577",), ("fs-787405",), ("fs-638697",)]),
  ],
  "flip": [
    ("Card flick (Mixkit)", [("mixkit-2002",)]),
    ("flipCard (Splashdust)", [("fs-84322",)]),
    ("Card sound (memes_hodachy)", [("fs-554208",)]),
  ],
  "pileTap": [
    ("Game now (fold)", [("game:fold-1",), ("game:fold-2",)]),
    ("Kenney card shove", [(f"kenney-casino-card-shove-{i}",) for i in (1, 2, 3, 4)]),
    ("Card contact tap", [("fs-96127",)]),
  ],
  "pileDone": [
    ("Deck hit (Mixkit)", [("mixkit-1994",)]),
    ("Pounding cards", [("fs-466789",)]),
    ("Pack take-out (Kenney)", [("kenney-casino-cards-pack-take-out-1",)]),
  ],
  # ---- shuffle ----
  "deckSlide": [
    ("Kenney card fan", [("kenney-casino-card-fan-1",)]),
    ("Kenney card slide", [("kenney-casino-card-slide-5",)]),
    ("Card slide (BapttX)", [("fs-843344",)]),
  ],
  "cutDrop": [
    ("Card contact tap", [("fs-96127",)]),
    ("Deck hit (Mixkit)", [("mixkit-1994",)]),
    ("Kenney card place", [("kenney-casino-card-place-3",)]),
  ],
  "riffle": [
    ("Riffle — Kodack (one continuous)", [("fs-256508", 2.8)]),
    ("Riffle — ailett (one continuous)", [("fs-445031", 2.8)]),
    ("A tick per card (card contact)", [("fs-96127",)]),
  ],
  "deckLand": [
    ("Deck hit (Mixkit)", [("mixkit-1994",)]),
    ("Pounding cards", [("fs-466789",)]),
    ("Kenney card place", [("kenney-casino-card-place-1",)]),
  ],
  # ---- money ----
  "coinsLand": [
    ("Game now (ArtOrDie ceramic chips)", [("game:bet-1",), ("game:bet-2",), ("game:bet-3",)]),
    ("Kenney chips stack", [(f"kenney-casino-chips-stack-{i}",) for i in (1, 2, 3, 4, 5)]),
    ("Metal coins", [("fs-349283",), ("fs-343462",)], [("fs-223344",)]),
  ],
  "merge": [
    ("Kenney chips collide", [(f"kenney-casino-chips-collide-{i}",) for i in (1, 2, 3, 4)]),
    ("Chip clicks (SilverDubloons)", [("fs-817552",), ("fs-817553",), ("fs-817554",)]),
    ("Chip clack (fartheststar)", [("fs-201808",)]),
  ],
  "break": [
    ("Kenney chips handle", [("kenney-casino-chips-handle-3",), ("kenney-casino-chips-handle-4",)]),
    ("Coins scatter (Anthousai)", [("fs-336571",)]),
    ("5 coins (jalastram)", [("fs-223344",)]),
  ],
  "sweepStart": [
    ("Push chips (Joma86)", [("fs-532860",)]),
    ("Kenney chips handle", [("kenney-casino-chips-handle-1",)]),
    ("Coins slide (Faulkin)", [("fs-336481",)]),
  ],
  "sweepLand": [
    ("Game now (pot)", [("game:pot",)]),
    ("Kenney chips stack", [("kenney-casino-chips-stack-3",)]),
    ("Clinking coins (Mixkit)", [("mixkit-1993",)]),
  ],
  "collect": [
    ("Game now (win chips)", [("game:win-chips",)]),
    ("Push chips (Joma86)", [("fs-532861",)]),
    ("Bag of coins (Mixkit)", [("mixkit-3187",)]),
  ],
  "sink": [
    ("Kenney chip lay", [(f"kenney-casino-chip-lay-{i}",) for i in (1, 2, 3)]),
    ("Coin in cup", [("bsb-0339",)]),
    ("Chip drop (Za-Games)", [("fs-540369",)]),
  ],
  "check": [
    ("Game now (a 7 ms click)", [("game:check",)]),
    ("Double knock (card contact ×2)", [("fs-96127", 0.0, 0.25, [(0, 1.0), (0.11, 0.8)])]),
    ("Double knock (deck hit ×2)", [("mixkit-1994", 0.0, 0.18, [(0, 1.0), (0.12, 0.8)])]),
  ],
}
MAXLEN = {"riffle": 2.8, "collect": 0.9, "sweepStart": 0.7, "sweepLand": 0.8, "pileDone": 0.5, "deckSlide": 0.6}

def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {}
    for event, opts in PLAN.items():
        manifest[event] = []
        for oi, opt in enumerate(opts):
            label, singles = opt[0], opt[1]
            many = opt[2] if len(opt) > 2 else None
            def build(specs, tag):
                out = []
                for ci, spec in enumerate(specs):
                    name = spec[0]
                    max_len = spec[1] if len(spec) > 1 and not isinstance(spec[1], list) and len(spec) == 2 else MAXLEN.get(event, 0.6)
                    start, repeat = 0.0, None
                    if len(spec) == 4: start, max_len, repeat = spec[1], spec[2], spec[3]
                    key = f"{event}-{oi}-{tag}{ci}"
                    out.append(cut(name, key, start=start, max_len=max_len, repeat=repeat))
                return out
            entry = {"label": label, "clips": build(singles, "s")}
            if many: entry["many"] = build(many, "m")
            manifest[event].append(entry)
            print(event, oi, label, [c["pitch"] for c in entry["clips"]])
    json.dump(manifest, open(os.path.join(ROOT, "clips.json"), "w"), indent=1)

main()
