# design/sound-lab

The Table Sound Lab (2026-09-25): every table animation with its sounds, fired at the exact moment
of motion, to choose which sound goes with which moment. Nothing here ships with the app.

- `index.html` — three real animations (dealing a hand, the shuffle routine, a money hand), each
  with the moments that make a sound listed underneath: 2–3 candidates + Off per moment, a ▶ to hear
  one alone, pan / speed / volume, "Copy my picks". Published as a private artifact.
- `demo.js` → `demo.bundle.js` (`sh design/sound-lab/build.sh` from `statisticasino/`): runs the real
  engines (`deck3d.js`, `deck-routine.js`, `coin-motion.js` — whose `CUES` are these moments) and
  schedules each sound on the Web Audio clock with a look-ahead, so it starts on the frame.
- `build_clips.py` → `clips/*.wav` + `clips.json`: cuts the candidates from `design/sfx-library/`
  and `static/sfx/` — each clip starts on its transient, capped, faded, tail-padded, peak −3 dBFS,
  and measured for pitch (owner's no-pitch rule; anything over 0.45 is marked "rings a little").
- `paper-cards.html` + `paper/` + `paper.json` (`build_paper.py`) — the ArtOrDie "paper cards"
  recordings: all 15 clips, every tap marked on the waveform and cut out on its own, measured
  (loudness, time to full loudness, brightness), and which of the game's current sounds each
  clip became. Published as its own private artifact.
- `paper-full.html` + `paper-full/` + `paper-full.json` (`build_paper_full.py <preview.mp3>`) — the
  WHOLE ArtOrDie "Paper Cards" recording (Freesound 170293, 69.7 s; the HQ preview MP3, downloaded
  with the owner's OK 2026-09-25): clickable timeline of every event coloured by shape group, up to
  five examples per group (names are guesses from measured shape, not from listening), and where the
  old split clips / the game's current card sounds were cut from.
- `clicks.html` + `clicks/` + `clicks.json` (`build_clicks.py`) — generic clicks from the licensed
  library (Kenney Interface Sounds, BigSoundBank, Freesound, Mixkit), each labelled by its source;
  long takes cut into single clicks aligned on the main hit; "clean" = unpitched, one hit, hit ≤12 ms.
- `measure.py` — the shared checks (main-hit time, hit count, pitch share, zip test).
- `synth.py` — synthesised candidates; the owner declined synthesis ("don't synthesize sound
  yourself"), so they are NOT in the lab and their clips are not committed.
- `found.html` + `found/` + `found.json` (`find_sounds.py`, needs a torch+transformers venv) — the
  owner's brief (coins: 1 · 2–4 · 5+ · all-in, metallic, light ring OK; cards: smooth — dealt, played,
  turned, folded, collected): every card/chip/coin recording split into events, measured, coins ranked
  by CLAP margin vs unrelated sounds, cards chosen by SHAPE (CLAP can't tell card actions apart),
  each sound in one slot only.
- `chips.html` + `chips/` + `chips.json` (`find_chips.py`) — chip sounds by material (ArtOrDie ceramic,
  ArtOrDie clay incl. single clicks cut from their bursts, other poker chips, metal coins) × amount
  (one · a few · a pile · all-in). Owner's card picks are recorded in the project memory (table-sfx).
