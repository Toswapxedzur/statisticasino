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
