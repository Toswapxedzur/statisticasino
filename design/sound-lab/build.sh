#!/bin/sh
# Rebuild the sound lab from the real engines. Run from statisticasino/.
#   python3 design/sound-lab/build_clips.py   (only when the candidates change)
set -e
D=design/sound-lab
mkdir -p $D/deck-parts
cp static/deck-parts/back-sylly-red.svg static/deck-parts/court-*.svg $D/deck-parts/
npx esbuild $D/demo.js --bundle --format=iife --target=es2022 --minify --loader:.json=json --outfile=$D/demo.bundle.js
