#!/usr/bin/env python3
"""ArtOrDie "paper cards" audition: every segment, every tap in it cut out alone, and which of
the game's current sounds (static/sfx) each one became. Measured, not listened to: taps = onsets
(a ≥12 dB rise within 20 ms, above −30 dB of the segment's peak).
Run from statisticasino/:  python3 design/sound-lab/build_paper.py → design/sound-lab/paper/ + paper.json
"""
import json, os, subprocess, wave, numpy as np
ROOT = os.path.dirname(os.path.abspath(__file__))
SEG = os.path.join(ROOT, "..", "sfx-review", "segments")
GAME = os.path.join(ROOT, "..", "..", "static", "sfx")
OUT = os.path.join(ROOT, "paper")
SR = 44100

def decode(p):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", p, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()

def write(path, x):
    x = np.concatenate([x, np.zeros(int(0.05 * SR))])
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())

def envelope(x, ms=5):
    win = max(1, int(ms / 1000 * SR))
    return np.sqrt(np.convolve(x ** 2, np.ones(win) / win, mode="same"))

def onsets(x):
    """Taps = peaks in the rate the (log) loudness rises: a ≥6 dB climb within 15 ms, above −32 dB of
    the clip's peak, at least 35 ms after the previous tap; each placed where its climb begins."""
    env = envelope(x, 4); peak = env.max() or 1
    db = 20 * np.log10(env / peak + 1e-9)
    hop = int(0.0025 * SR); fr = db[::hop]; lag = 6          # 6 hops = 15 ms
    rise = np.full(len(fr), -99.0); rise[lag:] = fr[lag:] - fr[:-lag]
    out = []
    for i in range(lag, len(fr) - 1):
        if rise[i] >= 6 and fr[i] > -32 and rise[i] >= rise[i - 1] and rise[i] >= rise[i + 1]:
            t = (i - lag) * hop / SR
            # start of the climb: step back while the level keeps falling
            j = i
            while j > 0 and fr[j - 1] < fr[j] - 0.5 and (i - j) < lag * 2: j -= 1
            t = j * hop / SR
            if not out or t - out[-1] >= 0.035: out.append(t)
            elif rise[i] > 0: pass
    first = np.argmax(db > -32) * 1.0 / SR
    if not out or out[0] - first > 0.03: out.insert(0, first)
    return out

def centroid(x):
    n = min(len(x), 2048)
    if n < 256: return 0
    sp = np.abs(np.fft.rfft(x[:n] * np.hanning(n))); f = np.fft.rfftfreq(n, 1 / SR)
    return float((sp * f).sum() / (sp.sum() or 1))

def svg_path(x, w=600, h=60):
    env = envelope(x, 3); peak = env.max() or 1
    n = len(env); pts = []
    for i in range(w):
        a, b = int(i * n / w), int((i + 1) * n / w)
        v = env[a:max(b, a + 1)].max() / peak
        pts.append(v)
    top = " ".join(f"{i},{h / 2 - v * h / 2:.1f}" for i, v in enumerate(pts))
    bot = " ".join(f"{i},{h / 2 + v * h / 2:.1f}" for i, v in reversed(list(enumerate(pts))))
    return f"M{top.replace(' ', ' L')} L{bot.replace(' ', ' L')} Z"

def best_match(clip, segs):
    # where in which segment the game clip came from: normalised cross-correlation of envelopes
    ce = envelope(clip, 2); best = (0, None, 0)
    for name, s in segs.items():
        se = envelope(s, 2)
        if len(se) < len(ce): continue
        c = np.correlate(se - se.mean(), ce - ce.mean(), mode="valid")
        norm = np.sqrt(np.convolve((se - se.mean()) ** 2, np.ones(len(ce)), mode="valid") * ((ce - ce.mean()) ** 2).sum()) + 1e-12
        r = c / norm; k = int(np.argmax(r))
        if r[k] > best[0]: best = (float(r[k]), name, k / SR)
    return best

def main():
    os.makedirs(OUT, exist_ok=True)
    names = sorted(f[:-4] for f in os.listdir(SEG) if f.startswith("paper-cards"))
    segs = {n: decode(os.path.join(SEG, n + ".mp3")) for n in names}
    game = {}
    for g in ["deal-1", "deal-2", "deal-3", "deal-4", "board-1", "board-2", "board-3", "board-4", "fold-1", "fold-2", "shuffle", "showdown", "join", "leave"]:
        p = os.path.join(GAME, g + ".mp3")
        if not os.path.exists(p): continue
        r, n, at = best_match(decode(p), segs)
        if r > 0.9: game.setdefault(n, []).append({"sound": g, "at": round(at, 3), "r": round(r, 3)})
    out = []
    for n in names:
        x = segs[n]; peak = np.abs(x).max() or 1
        ons = onsets(x)
        write(os.path.join(OUT, n + ".wav"), x / peak * 0.7)
        hits = []
        for i, t in enumerate(ons):
            a = max(0, int((t - 0.003) * SR)); b = int((ons[i + 1] - 0.003) * SR) if i + 1 < len(ons) else len(x)
            b = min(b, a + int(0.35 * SR))
            h = x[a:b].copy(); f = min(len(h), int(0.015 * SR)); h[-f:] *= np.linspace(1, 0, f)
            lvl = 20 * np.log10((np.abs(h).max() or 1e-9) / peak)
            key = f"{n}-hit{i + 1}"
            write(os.path.join(OUT, key + ".wav"), h / peak * 0.7)               # keeps its level relative to the segment
            env = envelope(h); pk = int(np.argmax(env)) / SR
            hits.append({"file": f"paper/{key}.wav", "at": round(t, 3), "len": round(len(h) / SR, 3), "level": round(float(lvl), 1), "peakAt": round(pk * 1000), "bright": round(centroid(h))})
        out.append({"id": n, "file": f"paper/{n}.wav", "dur": round(len(x) / SR, 3), "hits": hits, "path": svg_path(x), "game": game.get(n, [])})
        print(n, f"{len(x)/SR:.2f}s", len(hits), "taps at", [h["at"] for h in hits], "game:", game.get(n, []))
    json.dump(out, open(os.path.join(ROOT, "paper.json"), "w"), indent=1)

main()
