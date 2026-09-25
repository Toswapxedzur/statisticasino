# design/coin-motion

Interactive demo of money in motion at the poker table (2026-09-25). Nothing here ships with the
app; it runs the real engine (`src/lib/poker/coin-motion.js`, tests `coin-motion.test.js`) and the
real coin art (`chips.js` `coinSvg`, CoinStack's pile layout), with the game's own sounds.

- `index.html` — the demo: two scripted hands (hand 1: raise, calls, sweep, a flop raise, an
  uncalled turn bet returned, the win; hand 2: a checked-through street, a showdown split pot),
  Play / speed / scrubber, a sound toggle. Published as a private artifact.
- `demo.js` — the demo script; `demo.bundle.js` is its esbuild bundle (`sh design/coin-motion/build.sh`
  from `statisticasino/`), which also copies the sounds it plays into `sfx/`.

Owner's spec: a bet streams from the badge one denomination column at a time onto a pile in front
of the seat; when the street ends every pile sweeps into the pot together; an uncalled bet slides
back; the pot flies to the winner (split: one share each), sinks into the badge and the stack
counts up. Sounds fire when coins land; a check moves nothing.
