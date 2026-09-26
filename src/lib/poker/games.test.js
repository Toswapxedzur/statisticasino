import { test } from "node:test";
import assert from "node:assert/strict";
import { GAME_MODES, POKER_VARIANTS, OFFERED, LOBBY_MODES, OFFERED_POKER_VARIANTS, isOffered, variantLabel, gameIcon } from "./games.js";
import { existsSync } from "node:fs";
import { PokerHub } from "../server/poker/hub.js";

test("the site offers one game per major type: 8 of the 30", () => {
  // lobby order: player-vs-player first, then the house games
  assert.deepEqual(LOBBY_MODES.map((m) => m.key), ["poker", "big-two", "blackjack", "baccarat", "three-card", "roulette", "sic-bo", "slots"]);
  assert.deepEqual(LOBBY_MODES.map((m) => m.tab), ["Hold'em", "Big Two", "Blackjack", "Baccarat", "Three Card", "Roulette", "Sic Bo", "Slots"]);
  assert.deepEqual(OFFERED_POKER_VARIANTS.map((v) => v.key), ["holdem"]);
  const known = new Set([...GAME_MODES.map((m) => m.key), ...POKER_VARIANTS.map((v) => v.key)]);
  for (const k of OFFERED) assert.ok(known.has(k), `${k} is a real game`);
  // hidden games keep their names (replays of them still read properly)
  assert.equal(isOffered("plo"), false);
  assert.equal(variantLabel("plo"), "Pot-Limit Omaha");
});

test("every offered game has its icon file; poker variants share the chips", () => {
  for (const m of LOBBY_MODES) {
    const src = gameIcon(m.key);
    assert.ok(src && existsSync(new URL(`../../../static${src}`, import.meta.url)), `${m.key} → ${src}`);
  }
  assert.equal(gameIcon("holdem"), "/games/holdem.svg");
  assert.equal(gameIcon("plo"), "/games/holdem.svg");
  assert.equal(gameIcon("dragon-tiger"), null);
});

test("the server refuses tables for hidden games, and makes offered ones", () => {
  const hub = new PokerHub();
  const poker = { smallBlind: 1, bigBlind: 2, maxSeats: 6, minBuyin: 40, maxBuyin: 200, buyin: 100 };
  assert.match(hub._validateTableCfg({ ...poker, variant: "plo" }).error, /isn't offered/);
  assert.match(hub._validateTableCfg({ ...poker, variant: "dragon-tiger" }).error, /isn't offered/);
  assert.match(hub._validateTableCfg({ ...poker, variant: "crazy-eights" }).error, /isn't offered/);
  assert.equal(hub._validateTableCfg({ ...poker, variant: "holdem" }).variant, "holdem");
  assert.equal(hub._validateTableCfg(poker).variant, "holdem", "no variant = Hold'em");
  assert.ok(!hub._validateTableCfg({ ...poker, variant: "big-two" }).error?.includes("offered"));
});
