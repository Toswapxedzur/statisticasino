#!/usr/bin/env python3
"""Chip sounds by MATERIAL (owner, 2026-09-25: "I don't like the current chip sound … we downloaded a lot
of ceramic and metal chip sounds"). Same method as find_sounds.py — events measured, CLAP ranks — but
per material, so ceramic and clay chips aren't crowded out by coins:
  ceramic = ArtOrDie "Ceramic Chips" · clay = ArtOrDie "Clay Chips" · poker chips = every other chip
  recording (Kenney casino chips, Freesound) · metal coins.
Slots = the owner's amount steps: 1 · a few (2–4) · a pile (5+) · all-in. Each sound in one slot only.
Run from statisticasino/ with the torch venv:  <venv>/bin/python design/sound-lab/find_chips.py
Writes design/sound-lab/chips/*.wav + chips.json.
"""
import json, os, re, sys, numpy as np, torch
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from find_sounds import decode, events, measure, write, SR, OFF, OTHER, LIB, ROOT
from transformers import ClapModel, ClapProcessor

MATERIALS = [
  ("ceramic", "Ceramic chips (ArtOrDie)", lambda r: r["id"].startswith("aod-ceramic")),
  ("clay", "Clay chips (ArtOrDie)", lambda r: r["id"].startswith("aod-clay")),
  ("poker", "Other poker chips (Kenney, Freesound)", lambda r: not r["id"].startswith("aod-") and re.search(r"chip", r["title"], re.I) and not OFF.search(r["title"])),
  ("metal", "Metal coins", lambda r: re.search(r"coin|money", r["title"], re.I) and not re.search(r"chip", r["title"], re.I) and not OFF.search(r["title"])),
]
SLOTS = [
  ("one", "One chip", lambda f: f["hits"] <= 1 and f["dur"] <= 0.5 and f["pitch"] <= 0.75 and f["hitAt"] <= 20,
   {"chip": ["a single poker chip dropped onto a stack of chips", "one casino chip clicking on a table"],
    "metal": ["a single metal coin dropped onto a table", "one coin landing on a stack of coins"]}),
  ("few", "A few (2–4)", lambda f: 2 <= f["hits"] <= 5 and 0.06 <= f["dur"] <= 0.7 and f["pitch"] <= 0.75 and f["hitAt"] <= 60,
   {"chip": ["a few poker chips tossed onto a pile", "two or three casino chips clicking together"],
    "metal": ["a few metal coins dropped onto a pile of coins", "two or three coins landing on a table"]}),
  ("pile", "A pile (5+)", lambda f: f["hits"] >= 5 and 0.2 <= f["dur"] <= 1.6 and f["pitch"] <= 0.75,
   {"chip": ["a handful of poker chips dropped onto a pile of chips", "a stack of poker chips falling over"],
    "metal": ["a handful of metal coins poured onto a pile of coins", "many coins clattering onto a table"]}),
  ("allin", "All-in", lambda f: f["hits"] >= 6 and 0.5 <= f["dur"] <= 3.0 and f["pitch"] <= 0.75,
   {"chip": ["pushing a huge stack of poker chips into the pot", "a big pile of casino chips pushed across a table"],
    "metal": ["a large pile of coins pushed across a table", "a big heap of coins pouring and clattering"]}),
]
PER = 3   # candidates per slot per material

def taps(y):
    """Single clicks inside a burst: each from its onset (≥6 dB rise in 15 ms) to just before the next, ≤ 0.25 s."""
    from find_sounds import env
    e = env(y, 4); db = 20 * np.log10(e / (e.max() or 1) + 1e-9); h = int(0.0025 * SR); fr = db[::h]; lag = 6; ons = []
    for i in range(lag, len(fr) - 1):
        r = fr[i] - fr[i - lag]
        if r >= 6 and fr[i] > -20 and r >= fr[i - 1] - fr[i - 1 - lag] and r >= fr[i + 1] - fr[i + 1 - lag]:
            t = (i - lag) * h
            if not ons or t - ons[-1] >= int(0.04 * SR): ons.append(t)
    out = []
    for j, a in enumerate(ons):
        b = min(ons[j + 1] - int(0.003 * SR) if j + 1 < len(ons) else len(y), a + int(0.25 * SR))
        if b - a > int(0.03 * SR): out.append((a, b))
    return out

def main():
    rows = json.load(open(os.path.join(LIB, "rows.json")))
    pool = []
    for key, label, test in MATERIALS:
        for r in rows:
            if r["fam"] not in ("chips", "coins", "casino-misc") or not test(r): continue
            p = os.path.join(LIB, "audio", r["id"] + ".mp3")
            if not os.path.exists(p): continue
            try: x = decode(p)
            except Exception: continue
            for a, b in events(x, 12):
                a0 = max(0, a - int(0.005 * SR)); y = x[a0:b + int(0.03 * SR)].copy()
                fz = min(len(y) // 4, int(0.02 * SR))
                if fz: y[-fz:] *= np.linspace(1, 0, fz)
                pool.append({"mat": key, "src": r["id"], "title": r["title"].replace("Freesound - ", ""), "lib": r["lib"], "license": r["license"], "at": round(a0 / SR, 3), "y": y, **measure(y)})
                if key in ("ceramic", "clay"):                  # ArtOrDie's clips are bursts: also offer their single clicks
                    for n, (ta, tb) in enumerate(taps(y)):
                        z = y[ta:tb].copy(); f2 = min(len(z) // 4, int(0.01 * SR))
                        if f2: z[-f2:] *= np.linspace(1, 0, f2)
                        pool.append({"mat": key, "src": r["id"] + f"#tap{n + 1}", "title": r["title"] + f" — click {n + 1}", "lib": r["lib"], "license": r["license"],
                                     "at": round((a0 + ta) / SR, 3), "y": z, **measure(z)})
    print("events:", {m: sum(p["mat"] == m for p in pool) for m, _, _ in MATERIALS}, flush=True)
    model = ClapModel.from_pretrained("laion/larger_clap_general").eval(); proc = ClapProcessor.from_pretrained("laion/larger_clap_general")
    vec = lambda o: o if torch.is_tensor(o) else (o.pooler_output if getattr(o, "pooler_output", None) is not None else o[0])
    prompts, owner = [], []
    for k, _, _, say in SLOTS:
        for kind in ("chip", "metal"):
            for s in say[kind]: prompts.append(s); owner.append((k, kind))
    prompts += OTHER; owner += [None] * len(OTHER)
    with torch.no_grad():
        te = vec(model.get_text_features(**proc(text=prompts, return_tensors="pt", padding=True))); te = te / te.norm(dim=-1, keepdim=True)
        embs = []
        for i in range(0, len(pool), 16):
            ae = vec(model.get_audio_features(**proc(audio=[p["y"] for p in pool[i:i + 16]], sampling_rate=SR, return_tensors="pt"))); embs.append(ae / ae.norm(dim=-1, keepdim=True))
        sims = (torch.cat(embs) @ te.T).numpy()
    oth = [i for i, o in enumerate(owner) if o is None]
    for p, sm in zip(pool, sims):
        kind = "metal" if p["mat"] == "metal" else "chip"; worst = float(sm[oth].max())
        p["score"] = {k: float(np.mean([sm[i] for i, o in enumerate(owner) if o == (k, kind)])) - worst for k, _, _, _ in SLOTS}
    out_dir = os.path.join(ROOT, "chips"); os.makedirs(out_dir, exist_ok=True)
    for f in os.listdir(out_dir):
        if f.endswith(".wav"): os.remove(os.path.join(out_dir, f))
    used, result = set(), {"materials": [{"key": m, "name": n} for m, n, _ in MATERIALS], "slots": []}
    for i, p in enumerate(pool): p["idx"] = i
    for k, name, ok, _ in SLOTS:
        slot = {"key": k, "name": name, "by": {}}
        for m, _, _ in MATERIALS:
            cands = sorted((p for p in pool if p["mat"] == m and ok(p) and p["score"][k] > 0 and p["idx"] not in used), key=lambda p: -p["score"][k])
            picked, per_src = [], {}
            for p in cands:
                if per_src.get(p["src"], 0) >= 1: continue          # one per recording: more variety
                per_src[p["src"]] = 1; picked.append(p); used.add(p["idx"])
                if len(picked) == PER: break
            items = []
            for n, p in enumerate(picked):
                y = p["y"] / (np.abs(p["y"]).max() or 1) * 10 ** (-3 / 20)
                fn = f"chips/{k}-{m}-{n + 1}.wav"; write(os.path.join(ROOT, fn), np.concatenate([y, np.zeros(int(0.05 * SR))]))
                items.append({"file": fn, **{q: p[q] for q in ("src", "title", "lib", "license", "at", "dur", "hits", "attack", "bright", "pitch")}, "match": round(p["score"][k], 3)})
            slot["by"][m] = {"eligible": len(cands), "items": items}
            print(f"{k:6} {m:8} {len(cands):4} fit → {[i['title'][:26] for i in items]}", flush=True)
        result["slots"].append(slot)
    json.dump(result, open(os.path.join(ROOT, "chips.json"), "w"), indent=1)

main()
