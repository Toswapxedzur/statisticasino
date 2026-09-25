#!/usr/bin/env python3
"""The owner's picked table sounds → the game: static/sfx/table/<name>.ogg + .mp3, and
src/lib/poker/table-sounds.json with each file's LEAD (ms from the start of the file to its main hit,
measured on the encoded file) so the game's player can start a sound early and land its hit on the
frame. Sources are the Sound Lab picks (build_picks.py) plus "Cards deck hits" @0.2 s for a card
played onto the centre pile (shedding games).
Run from statisticasino/:  python3 design/sound-lab/build_game_sfx.py"""
import json, os, subprocess, tempfile, wave, numpy as np
LAB = os.path.dirname(os.path.abspath(__file__))
APP = os.path.abspath(os.path.join(LAB, "..", ".."))
OUT = os.path.join(APP, "static", "sfx", "table")
SR = 44100

def load(p):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", p, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()
def loud_db(y):   # loudest 50 ms, RMS in dBFS — how loud the sound's main moment is
    w = int(0.05 * SR); e = np.sqrt(np.convolve(y ** 2, np.ones(w) / w, mode="same")); return 20 * np.log10(e.max() + 1e-9)
def lead_ms(y):
    w = int(0.002 * SR); e = np.sqrt(np.convolve(y ** 2, np.ones(w) / w, mode="same")); return round(float(np.argmax(e) / SR * 1000), 1)

# name → source (lab-relative). Sweep and winnings reuse the coin tiers.
SOURCES = {
    "card-deal": "picks/deal.wav",        # Kenney "card slide 3" — a card dealt to a seat / the board
    "card-flip": "picks/flip.wav",        # "Playing cards – Shuffling deck & deal" @0.3 s — cards turn face-up
    "card-pile": "picks/pile.wav",        # "Index Card Flips" @3.7 s — fold, and each card collected
    "card-play": "found/cardPlay-1.wav",  # Mixkit "Cards deck hits" @0.2 s — played onto the centre pile
    "riffle":    "picks/riffle.wav",      # 5ro4 "cards riffle shuffle", first 2.1 s slowed to 2.6 s
    **{f"coin-{tier}-{i}": f"picks/clay-{tier}-{i}.wav" for tier in ("one", "few", "pile") for i in (1, 2, 3)},
    "coin-allin": "picks/clay-allin.wav", # clay clip 33 (13 hits)
}

os.makedirs(OUT, exist_ok=True)
leads = {}
for name, src in SOURCES.items():
    y = load(os.path.join(LAB, src))
    y = np.concatenate([y, np.zeros(int(0.06 * SR), dtype=np.float32)])   # Chrome clips OGG tails: pad 60 ms
    # every file at the same loudness (-20 dB over its loudest 50 ms, like the game's other table
    # sounds), peaks capped at -1 dBFS; the player's per-event gains then set the balance
    k = 10 ** ((-20 - loud_db(y)) / 20)
    y = y * min(k, 10 ** (-1 / 20) / (np.abs(y).max() or 1))
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        with wave.open(tmp.name, "wb") as w:
            w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes((np.clip(y, -1, 1) * 32767).astype("<i2").tobytes())
        subprocess.run(["sox", tmp.name, "-C", "5", os.path.join(OUT, f"{name}.ogg")], check=True)
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", tmp.name, "-c:a", "libmp3lame", "-q:a", "3", os.path.join(OUT, f"{name}.mp3")], check=True)
        os.unlink(tmp.name)
    leads[name] = {ext: lead_ms(load(os.path.join(OUT, f"{name}.{ext}"))) for ext in ("ogg", "mp3")}
    print(f"{name:12} main hit at {leads[name]} ms, loudness {loud_db(load(os.path.join(OUT, name + '.ogg'))):.1f} dB")

json.dump(leads, open(os.path.join(APP, "src", "lib", "poker", "table-sounds.json"), "w"), indent=1)
