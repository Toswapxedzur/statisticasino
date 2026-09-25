#!/usr/bin/env python3
"""The whole ArtOrDie "Paper Cards" recording (Freesound 170293, CC BY 4.0), mapped and grouped.

Input: the Freesound HQ preview MP3 (downloaded with the owner's OK, 2026-09-25) — pass its path.
Every sound event (active region, gaps < 150 ms merged) is measured: length, taps (≥6 dB climbs in
15 ms), taps/s, sustain (share of time within 15 dB of the event's peak), level vs the loudest
moment in the recording, brightness. Events are grouped by those shapes; the group NAMES are
guesses from the shapes, not from listening. Up to five examples per group are cut out.
Also finds where the 15 old split clips and the game's current card sounds sit in the recording.
Run from statisticasino/:  python3 design/sound-lab/build_paper_full.py <preview.mp3>
"""
import json, os, subprocess, sys, wave, shutil, numpy as np
ROOT = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(ROOT, "paper-full")
SR = 48000

def decode(p, sr=SR):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", p, "-ac", "1", "-ar", str(sr), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()
def env(x, ms, sr=SR):
    w = max(1, int(ms / 1000 * sr)); return np.sqrt(np.convolve(x ** 2, np.ones(w) / w, mode="same"))
def write(path, x):
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())

def events(x):
    e = env(x, 10); gpk = e.max(); db = 20 * np.log10(e / gpk + 1e-9)
    thr = np.percentile(db, 10) + 10
    hop = int(0.005 * SR); a = (db > thr)[::hop]; regs = []; i = 0
    while i < len(a):
        if a[i]:
            j = i
            while j < len(a) and a[j]: j += 1
            regs.append([i, j]); i = j
        else: i += 1
    merged = []
    for r in regs:
        if merged and (r[0] - merged[-1][1]) * hop / SR < 0.15: merged[-1][1] = r[1]
        else: merged.append(r)
    out = []
    for s, t in merged:
        a0, a1 = s * hop, t * hop; d = (a1 - a0) / SR
        if d < 0.03: continue
        seg = x[a0:a1]; es = env(seg, 4); pk = es.max() or 1; sdb = 20 * np.log10(es / pk + 1e-9)
        h = int(0.0025 * SR); fr = sdb[::h]; lag = 6; ons = []
        for k in range(lag, len(fr) - 1):
            r = fr[k] - fr[k - lag]
            if r >= 6 and fr[k] > -30 and r >= fr[k - 1] - fr[k - 1 - lag] and r >= fr[k + 1] - fr[k + 1 - lag]:
                tt = k * h / SR
                if not ons or tt - ons[-1] >= 0.03: ons.append(tt)
        nfft = 2048; cents = []
        for k in range(0, max(1, len(seg) - nfft), int(0.02 * SR)):
            q = seg[k:k + nfft]
            if len(q) < nfft or np.sqrt((q ** 2).mean()) < pk * 0.2: continue
            sp = np.abs(np.fft.rfft(q * np.hanning(nfft))); f = np.fft.rfftfreq(nfft, 1 / SR); cents.append((sp * f).sum() / (sp.sum() or 1))
        out.append(dict(t0=round(a0 / SR, 3), dur=round(d, 3), taps=len(ons), rate=round(len(ons) / d, 1),
                        sustain=round(float((sdb > -15).mean()), 2), level=round(float(20 * np.log10(pk / gpk)), 1),
                        bright=int(np.mean(cents)) if cents else 0))
    return out

# groups by shape (checked in order); names are guesses from the shape
GROUPS = [
  ("long", "Long loud bursts", "1.2 s or longer, 10+ taps, among the loudest sounds in the recording", "a riffle shuffle, with the cards bridged back together",
     lambda e: e["dur"] >= 1.2 and e["taps"] >= 10 and e["level"] > -12),
  ("run", "Long quiet runs", "0.8 s or longer with many taps, but well below the loud bursts", "an overhand shuffle, or thumbing through the deck",
     lambda e: e["dur"] >= 0.8 and e["taps"] >= 8),
  ("rapid", "Quick loud bursts", "0.35–0.8 s, 12+ taps a second, loud", "a short riffle, or squaring and tapping the deck",
     lambda e: 0.35 <= e["dur"] < 0.8 and e["rate"] >= 12 and e["level"] > -20),
  ("heavy", "Heavy single hits", "one or two taps that are loud and die away almost at once", "the deck set down or knocked on the table, or a card slapped down",
     lambda e: e["taps"] <= 2 and e["level"] > -20 and e["sustain"] < 0.35),
  ("cluster", "Short clusters", "0.1–0.4 s, 2–4 taps, medium level", "a card slid and set down, or a small handful being squared",
     lambda e: 0.1 <= e["dur"] <= 0.4 and 2 <= e["taps"] <= 4 and -32 < e["level"] <= -12),
  ("tap", "Single taps", "one short tap (≤ 0.1 s) at medium level", "one card dealt or flicked onto the table",
     lambda e: e["dur"] <= 0.1 and e["taps"] >= 1 and -34 < e["level"] <= -12),
  ("quiet", "Quiet background", "very quiet (40+ dB below the loudest moment), hissy and continuous", "room noise and hand rustle between actions",
     lambda e: e["level"] <= -38),
]

def locate(clip, x):
    """Where a short clip occurs in the recording (normalised cross-correlation of 2 ms envelopes, at 8 kHz)."""
    sr = 8000; ce = env(clip, 2, sr); xe = env(x, 2, sr)
    ce = ce - ce.mean(); n = len(ce)
    c = np.correlate(xe - xe.mean(), ce, mode="valid")
    local = np.sqrt(np.convolve((xe - xe.mean()) ** 2, np.ones(n), mode="valid") * (ce ** 2).sum()) + 1e-12
    r = c / local; k = int(np.argmax(r)); return round(k / sr, 3), round(float(r[k]), 3)

def main(src):
    os.makedirs(OUT, exist_ok=True)
    x = decode(src); gpk = np.abs(x).max()
    evs = events(x)
    for e in evs:
        e["group"] = next((g[0] for g in GROUPS if g[4](e)), "other")
    groups = []
    for key, name, shape, guess, _ in GROUPS + [("other", "Everything else", "didn't fit a group above", "", None)]:
        mem = [e for e in evs if e["group"] == key]
        # five examples spread across the recording, loudest-first within that spread
        picks = sorted(mem, key=lambda e: -e["level"])[:5] if len(mem) > 5 else mem
        picks = sorted(picks, key=lambda e: e["t0"])
        ex = []
        for j, e in enumerate(picks):
            a = max(0, int((e["t0"] - 0.03) * SR)); b = min(len(x), int((e["t0"] + e["dur"] + 0.08) * SR))
            y = x[a:b].copy(); f = int(0.03 * SR); y[-f:] *= np.linspace(1, 0, f); y[:int(0.005 * SR)] *= np.linspace(0, 1, int(0.005 * SR))
            gain = min(10 ** (24 / 20), 10 ** (-3 / 20) / (np.abs(y).max() or 1))    # bring up to −3 dB, at most +24 dB
            key_ = f"{key}-{j + 1}"
            write(os.path.join(OUT, key_ + ".wav"), np.concatenate([y * gain, np.zeros(int(0.05 * SR))]))
            ex.append({**e, "file": f"paper-full/{key_}.wav", "boost": round(float(20 * np.log10(gain)), 1)})
        groups.append({"key": key, "name": name, "shape": shape, "guess": guess, "count": len(mem), "examples": ex})
    # where the old split clips and the game's current card sounds came from
    marks = []
    seg_dir = os.path.join(ROOT, "..", "sfx-review", "segments")
    for f in sorted(os.listdir(seg_dir)):
        if f.startswith("paper-cards"):
            at, r = locate(decode(os.path.join(seg_dir, f), 8000), decode(src, 8000))
            marks.append({"what": f"old clip {f[12:14]}", "at": at, "r": r, "kind": "old"})
    for g in ["deal-1", "deal-2", "deal-3", "deal-4", "board-1", "board-2", "board-3", "board-4", "fold-1", "fold-2", "shuffle", "showdown"]:
        p = os.path.join(ROOT, "..", "..", "static", "sfx", g + ".mp3")
        at, r = locate(decode(p, 8000), decode(src, 8000))
        if r > 0.8: marks.append({"what": g, "at": at, "r": r, "kind": "game"})
    # whole-recording waveform (1200 columns) + the recording itself for the timeline player
    e2 = env(x, 5); cols = 1200; n = len(e2); w = [float(e2[int(i * n / cols):int((i + 1) * n / cols)].max() / (e2.max() or 1)) for i in range(cols)]
    shutil.copy(src, os.path.join(OUT, "paper-cards-full.mp3"))
    json.dump({"duration": round(len(x) / SR, 3), "wave": [round(v, 3) for v in w], "events": evs, "groups": groups, "marks": marks},
              open(os.path.join(ROOT, "paper-full.json"), "w"))
    for g in groups: print(f"{g['name']:20} {g['count']:3} events → {len(g['examples'])} examples at", [e["t0"] for e in g["examples"]])
    print("marks:", [(m["what"], m["at"], m["r"]) for m in marks])

main(sys.argv[1])
