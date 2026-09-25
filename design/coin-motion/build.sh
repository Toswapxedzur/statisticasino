#!/bin/sh
# Rebuild the coin-motion demo bundle from the real engine. Run from statisticasino/.
set -e
D=design/coin-motion
mkdir -p $D/sfx
for f in bet-1 bet-2 bet-3 pot win-chips check; do cp static/sfx/$f.ogg $D/sfx/; done
npx esbuild $D/demo.js --bundle --format=iife --target=es2022 --minify --outfile=$D/demo.bundle.js
