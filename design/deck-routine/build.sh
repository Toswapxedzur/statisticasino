#!/bin/sh
# Rebuild the deck-routine demo bundle from the real engine. Run from statisticasino/.
set -e
D=design/deck-routine
cp static/deck-parts/back-sylly-red.svg static/deck-parts/court-*.svg $D/deck-parts/
npx esbuild $D/demo.js --bundle --format=iife --target=es2022 --minify --outfile=$D/demo.bundle.js
