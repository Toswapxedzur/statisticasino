#!/usr/bin/env python3
"""Find table sounds for the owner's brief (2026-09-25) in our licensed library.

Claude can't hear, so: every card / chip / coin recording is split into single sound EVENTS, each
event is MEASURED (hits, timing, attack = sharp vs smooth, brightness, pitch share, zip test) and
scored by CLAP (LAION larger_clap_general, run locally) against written descriptions of each slot.
Events that break the brief are filtered out; the rest are ranked by CLAP and cut into clips for
the owner to judge by ear. CLAP pre-sorts only — its blind test was 11/19 top-1, 17/19 top-3, and
weakest on single card landings.

Brief: COINS = clicky but metallic (a light natural ring allowed), 3 amount steps (1 · 2–4 · 5+)
plus ALL-IN; CARDS = smooth, not sharp: dealt · played onto the pile · turned face-up · thrown
away (fold) · collected into the pile.

Needs a Python with torch + transformers (the session venv). Run from statisticasino/:
  <venv>/bin/python design/sound-lab/find_sounds.py [extra-recording.mp3 ...]
Writes design/sound-lab/found/*.wav + found.json.
"""
import json, os, re, subprocess, sys, wave, numpy as np, torch
from transformers import ClapModel, ClapProcessor

ROOT = os.path.dirname(os.path.abspath(__file__))
LIB = os.path.join(ROOT, "..", "sfx-library")
OUT = os.path.join(ROOT, "found")
SR = 48000

# ---------------------------------------------------------------- the slots
SLOTS = {
  "coin1":   {"group": "Coins", "name": "One coin", "when": "a single coin lands on a pile or the table",
              "say": ["a single metal coin dropped onto a table", "one coin landing on a stack of coins", "a metal coin clinking against another coin"],
              "ok": lambda f: f["hits"] <= 1 and f["dur"] <= 0.5 and f["pitch"] <= 0.75 and f["hitAt"] <= 20},
  "coinFew": {"group": "Coins", "name": "A few coins (2–4)", "when": "a small bet lands on a pile",
              "say": ["a few metal coins dropped onto a pile of coins", "a small handful of coins clinking together", "two or three coins landing on a table"],
              "ok": lambda f: 2 <= f["hits"] <= 5 and 0.06 <= f["dur"] <= 0.7 and f["pitch"] <= 0.75 and f["hitAt"] <= 60},
  "coinPile": {"group": "Coins", "name": "A pile of coins (5+)", "when": "a big bet or the pot's coins land",
              "say": ["a handful of metal coins poured onto a pile of coins", "many coins clattering onto a table", "a stack of coins falling onto other coins"],
              "ok": lambda f: f["hits"] >= 5 and 0.2 <= f["dur"] <= 1.6 and f["pitch"] <= 0.75},
  "allIn":   {"group": "Coins", "name": "All-in", "when": "a player pushes every coin into the pot — the special one",
              "say": ["a large pile of coins pushed across a table", "a big heap of coins pouring and clattering", "pushing a huge stack of casino chips into the pot"],
              "ok": lambda f: f["hits"] >= 6 and 0.5 <= f["dur"] <= 3.0 and f["pitch"] <= 0.75},
  "cardDeal": {"group": "Cards", "name": "Card dealt to a player", "when": "a card slides from the deck to a seat",
              "say": ["a playing card sliding across a felt table", "a card being dealt to a player", "a single playing card slid across a table"],
              "ok": lambda f: f["card_smooth"] and 0.15 <= f["dur"] <= 0.5 and f["hits"] <= 2 and f["attack"] >= 8},
  "cardPlay": {"group": "Cards", "name": "Card played onto the pile", "when": "a player puts a card down in the middle",
              "say": ["a playing card placed down gently on a pile of cards", "putting a playing card down on a table", "a card laid softly on top of other cards"],
              "ok": lambda f: f["card_smooth"] and 0.06 <= f["dur"] <= 0.3 and f["hits"] == 1},
  "cardFlip": {"group": "Cards", "name": "Card turned face-up", "when": "a player's cards (or the board) turn over",
              "say": ["a playing card being flipped over", "turning a playing card face up", "flipping a card over on a table"],
              "ok": lambda f: f["card_smooth"] and 0.08 <= f["dur"] <= 0.35 and f["hits"] <= 2},
  "cardFold": {"group": "Cards", "name": "Cards thrown away (fold)", "when": "a player folds and their cards leave the hand",
              "say": ["a few playing cards tossed onto a table", "throwing playing cards away onto the table", "cards dropped face down onto a table"],
              "ok": lambda f: f["card_smooth"] and 0.2 <= f["dur"] <= 0.8 and 2 <= f["hits"] <= 4},
  "cardCollect": {"group": "Cards", "name": "Cards collected into the pile", "when": "the table's cards are gathered at the end of a hand",
              "say": ["playing cards being gathered and squared into a pile", "sweeping cards together into a stack", "a stack of cards being tidied together"],
              "ok": lambda f: f["card_smooth"] and 0.4 <= f["dur"] <= 1.6 and f["hits"] >= 3},
}
# only on-topic recordings feed each group (the library's "chips" family also has potato chips…)
COIN_OK = re.compile(r"coin|chip|money|casino|clink", re.I)
CARD_OK = re.compile(r"card|deal|shuffle|flip|paper", re.I)
OFF = re.compile(r"potato|eating|crunch|pack of chips|grocery|supermarket|market|register|cashier|slot machine|walla|ambien|room|"
                 r"machine|dice|die |metal bar|spinning|atm|bag|can\b|purse|glass|grass|concrete|arcade|game coin|prize|win|alarm|"
                 r"notification|bonus|achievement|level|video game|toy|door|folder|footstep|crowd|tape|reel|psychedelic|buzz|parade", re.I)
for k in ("coin1", "coinFew", "coinPile", "allIn"): SLOTS[k]["pool"] = "coins"
for k in ("cardDeal", "cardPlay", "cardFlip", "cardFold", "cardCollect"): SLOTS[k]["pool"] = "cards"

SHAPES = {  # the card slots are chosen by shape (CLAP only vouches that it's a card sound)
  "cardDeal": "a short slide: 0.15–0.5 s, one or two soft hits, ≥ 8 ms to full loudness",
  "cardPlay": "one soft hit, 0.06–0.3 s",
  "cardFlip": "a quick soft flick: 0.08–0.35 s, one or two hits",
  "cardFold": "two to four soft hits, 0.2–0.8 s",
  "cardCollect": "a longer run of three or more soft hits, 0.4–1.6 s",
}

OTHER = ["a ballpoint pen click", "a computer mouse click", "keyboard typing", "paper being crumpled", "glass breaking",
         "a door slamming", "a riffle shuffle of playing cards", "dice rolling on a table", "a stapler", "hands clapping",
         "a zipper", "a whoosh", "a bell ringing", "speech"]

# ---------------------------------------------------------------- audio + measurements
def decode(p):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", p, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, dtype=np.float32).copy()
def env(x, ms):
    w = max(1, int(ms / 1000 * SR)); return np.sqrt(np.convolve(x ** 2, np.ones(w) / w, mode="same"))

def events(x, cap=12):
    """Single sound events: regions > floor + 12 dB, gaps ≥ 120 ms split them; 30 ms – 3 s long."""
    if not len(x): return []
    e = env(x, 5); pk = e.max() or 1; db = 20 * np.log10(e / pk + 1e-9)
    thr = max(np.percentile(db, 15) + 12, -45)
    hop = int(0.005 * SR); a = (db > thr)[::hop]; regs = []; i = 0
    while i < len(a):
        if a[i]:
            j = i
            while j < len(a) and a[j]: j += 1
            regs.append([i, j]); i = j
        else: i += 1
    merged = []
    for r in regs:
        if merged and (r[0] - merged[-1][1]) * hop / SR < 0.12: merged[-1][1] = r[1]
        else: merged.append(r)
    out = [(s * hop, t * hop) for s, t in merged if 0.03 <= (t - s) * hop / SR <= 3.0]
    out.sort(key=lambda r: -e[r[0]:r[1]].max())
    return sorted(out[:cap])

def pitch(x):
    n = min(len(x), SR // 2)
    if n < 512: return 0.0
    sp = np.abs(np.fft.rfft(x[:n] * np.hanning(n))) ** 2; tot = sp.sum() or 1; s = sp.copy(); sh = 0
    for _ in range(5):
        k = int(np.argmax(s)); lo, hi = max(0, k - 3), k + 4; sh += s[lo:hi].sum(); s[lo:hi] = 0
    return float(sh / tot)

def measure(y):
    e1 = env(y, 1); pk = e1.max() or 1; m = int(np.argmax(e1))
    k = m
    while k > 0 and e1[k] > pk * 0.1: k -= 1
    attack = (m - k) / SR * 1000                                    # 10 % → peak of the main hit
    e4 = env(y, 4); db = 20 * np.log10(e4 / (e4.max() or 1) + 1e-9); h = int(0.0025 * SR); fr = db[::h]; lag = 6; ons = [0.0]
    for i in range(lag, len(fr) - 1):
        r = fr[i] - fr[i - lag]
        if r >= 6 and fr[i] > -24 and r >= fr[i - 1] - fr[i - 1 - lag] and r >= fr[i + 1] - fr[i + 1 - lag]:
            t = i * h / SR
            if t - ons[-1] >= 0.03: ons.append(t)
    q = y[m:m + int(0.05 * SR)]
    if len(q) >= 256:
        sp = np.abs(np.fft.rfft(q * np.hanning(len(q)))); f = np.fft.rfftfreq(len(q), 1 / SR); cen = float((sp * f).sum() / (sp.sum() or 1))
    else: cen = 0.0
    n = 1024; ts = []; cs = []; fl = []
    for i in range(0, max(0, len(y) - n), int(0.01 * SR)):
        w = y[i:i + n]
        if np.sqrt((w ** 2).mean()) < pk * 0.3: continue
        sp = np.abs(np.fft.rfft(w * np.hanning(n))) + 1e-12; f = np.fft.rfftfreq(n, 1 / SR)
        ts.append(i / SR); cs.append((sp * f).sum() / sp.sum()); fl.append(np.exp(np.log(sp).mean()) / sp.mean())
    loud = np.where(db > -10)[0]; span = (loud[-1] - loud[0]) * 1 / SR if len(loud) else 0
    slope = np.polyfit(ts, cs, 1)[0] if len(ts) > 3 else 0
    zipp = bool(span >= 0.08 and abs(slope) > 3000 and (np.mean(fl) if fl else 0) > 0.4)
    f = {"dur": round(len(y) / SR, 3), "hits": len(ons), "attack": round(attack, 1), "hitAt": round(m / SR * 1000, 1),
         "bright": int(cen), "pitch": round(pitch(y), 2), "zip": zipp}
    # smooth, not sharp: the main hit takes ≥ 6 ms to rise, isn't bright-and-snappy, and isn't a zip
    f["card_smooth"] = f["attack"] >= 6 and f["bright"] <= 5500 and not zipp and f["pitch"] <= 0.45   # cards stay unpitched
    return f

def write(path, y):
    pcm = (np.clip(y, -1, 1) * 32767).astype("<i2")
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR); w.writeframes(pcm.tobytes())

# ---------------------------------------------------------------- run
def main(extra):
    rows = json.load(open(os.path.join(LIB, "rows.json")))
    sources = [(r["id"], os.path.join(LIB, "audio", r["id"] + ".mp3"), r["title"].replace("Freesound - ", ""), r["lib"], r["license"])
               for r in rows if r["fam"] in ("cards", "chips", "coins", "casino-misc")]
    for p in extra:
        sources.append((os.path.splitext(os.path.basename(p))[0], p, "ArtOrDie — Paper Cards (full recording)", "ArtOrDie", "CC BY 4.0"))
    pool = []
    for sid, path, title, lib, lic in sources:
        if not os.path.exists(path): continue
        try: x = decode(path)
        except Exception: continue
        for n, (a, b) in enumerate(events(x, 40 if sid in [os.path.splitext(os.path.basename(p))[0] for p in extra] else 12)):
            a0 = max(0, a - int(0.005 * SR)); y = x[a0:b + int(0.03 * SR)].copy()
            fz = min(len(y) // 4, int(0.02 * SR))
            if fz: y[-fz:] *= np.linspace(1, 0, fz)
            kind = "cards" if CARD_OK.search(title) and not re.search(r"coin|chip", title, re.I) else "coins" if COIN_OK.search(title) else None
            if OFF.search(title) or kind is None: continue
            pool.append({"src": sid, "title": title, "lib": lib, "license": lic, "kind": kind, "at": round(a0 / SR, 3), "y": y, **measure(y)})
    print("events:", len(pool), "from", len(sources), "recordings", flush=True)

    model = ClapModel.from_pretrained("laion/larger_clap_general").eval(); proc = ClapProcessor.from_pretrained("laion/larger_clap_general")
    vec = lambda o: o if torch.is_tensor(o) else (o.pooler_output if getattr(o, "pooler_output", None) is not None else o[0])
    prompts = [s for k in SLOTS for s in SLOTS[k]["say"]] + OTHER
    owner = [k for k in SLOTS for _ in SLOTS[k]["say"]] + [None] * len(OTHER)
    with torch.no_grad():
        te = vec(model.get_text_features(**proc(text=prompts, return_tensors="pt", padding=True))); te = te / te.norm(dim=-1, keepdim=True)
        embs = []
        for i in range(0, len(pool), 16):
            batch = [p["y"] for p in pool[i:i + 16]]
            ae = vec(model.get_audio_features(**proc(audio=batch, sampling_rate=SR, return_tensors="pt"))); embs.append(ae / ae.norm(dim=-1, keepdim=True))
            if i % 320 == 0: print("  clap", i, "/", len(pool), flush=True)
        ae = torch.cat(embs)
        sims = (ae @ te.T).numpy()
    other_idx = [i for i, o in enumerate(owner) if o is None]
    for p, sm in zip(pool, sims):
        worst = float(sm[other_idx].max())                          # its best match among unrelated sounds
        p["score"] = {k: float(np.mean([sm[i] for i, o in enumerate(owner) if o == k])) - worst for k in SLOTS}

    os.makedirs(OUT, exist_ok=True)
    for f in os.listdir(OUT):
        if f.endswith(".wav"): os.remove(os.path.join(OUT, f))
    result = {}
    # CLAP can't tell card ACTIONS apart (it calls nearly every card sound "flipped"), so for cards it only
    # vouches that a sound IS a card sound (its best card-slot margin); the slot's SHAPE rule picks the action,
    # and each card event serves one slot only (the owner wants distinct sounds). Scarcest slots choose first.
    card_slots = [k for k in SLOTS if SLOTS[k]["pool"] == "cards"]
    for i, p in enumerate(pool):
        p["idx"] = i
        if p["kind"] == "cards": p["cardness"] = max(p["score"][k] for k in card_slots)
    used = set()
    fits = {k: [p for p in pool if p["kind"] == SLOTS[k]["pool"] and SLOTS[k]["ok"](p)] for k in SLOTS}
    order = [k for k in SLOTS if SLOTS[k]["pool"] == "coins"] + sorted(card_slots, key=lambda k: len(fits[k]))
    for k in order:
        slot = SLOTS[k]
        if slot["pool"] == "cards":
            cands = sorted((p for p in fits[k] if p["cardness"] > 0 and p["idx"] not in used), key=lambda p: -p["cardness"])
        else:
            cands = sorted((p for p in fits[k] if p["score"][k] > 0 and p["idx"] not in used), key=lambda p: -p["score"][k])
        picked, per_src = [], {}
        for p in cands:
            if per_src.get(p["src"], 0) >= 2: continue
            per_src[p["src"]] = per_src.get(p["src"], 0) + 1; picked.append(p)
            used.add(p["idx"])                                  # every sound serves one slot only
            if len(picked) == 6: break
        items = []
        for n, p in enumerate(picked):
            y = p["y"] / (np.abs(p["y"]).max() or 1) * 10 ** (-3 / 20)
            fn = f"found/{k}-{n + 1}.wav"; write(os.path.join(ROOT, fn), np.concatenate([y, np.zeros(int(0.05 * SR))]))
            items.append({"file": fn, **{q: p[q] for q in ("src", "title", "lib", "license", "at", "dur", "hits", "attack", "hitAt", "bright", "pitch")},
                          "match": round(p["cardness"] if slot["pool"] == "cards" else p["score"][k], 3), "eligible": len(cands)})
        result[k] = {**{q: slot[q] for q in ("group", "name", "when")}, "say": slot["say"], "shape": SHAPES.get(k), "eligible": len(cands), "items": items}
        print(f"{k:12} {len(cands):4} eligible → {[ (i['title'][:28], i['match']) for i in items[:3]]}", flush=True)
    result = {k: result[k] for k in SLOTS}                      # back in the page's order
    json.dump(result, open(os.path.join(ROOT, "found.json"), "w"), indent=1)

if __name__ == "__main__": main(sys.argv[1:])
