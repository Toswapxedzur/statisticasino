import { test } from "node:test";
import assert from "node:assert/strict";
import { LOBBY_MODES, isBanked, isShedding, tableLayout, modeOf, variantLabel, gameIcon } from "./games.js";
import { existsSync } from "node:fs";
import { PokerHub } from "../server/poker/hub.js";

test("the eight games, one per major type, in lobby order", () => {
  // player-vs-player first, then the house games
  assert.deepEqual(LOBBY_MODES.map((m) => m.key), ["poker", "big-two", "blackjack", "baccarat", "three-card", "roulette", "sic-bo", "slots"]);
  assert.deepEqual(LOBBY_MODES.map((m) => m.tab), ["Hold'em", "Big Two", "Blackjack", "Baccarat", "Three Card", "Roulette", "Sic Bo", "Slots"]);
  assert.deepEqual(["blackjack", "baccarat", "three-card", "roulette", "sic-bo", "slots"].map(isBanked), [true, true, true, true, true, true]);
  assert.ok(isShedding("big-two") && !isBanked("big-two") && !isBanked("holdem"));
  assert.deepEqual(["holdem", "big-two", "blackjack", "roulette"].map(tableLayout), ["poker", "shed", "banked", "bet"]);
  assert.equal(modeOf("holdem"), "poker");
  assert.equal(variantLabel("three-card"), "Three Card Poker");
});

test("every game has its icon file", () => {
  for (const m of LOBBY_MODES) {
    const src = gameIcon(m.key);
    assert.ok(src && existsSync(new URL(`../../../static${src}`, import.meta.url)), `${m.key} → ${src}`);
  }
  assert.equal(gameIcon("holdem"), "/games/holdem.svg");
  assert.equal(gameIcon("dragon-tiger"), null);
});

test("the server refuses tables for games that don't exist, and makes the real ones", () => {
  const hub = new PokerHub();
  const poker = { smallBlind: 1, bigBlind: 2, maxSeats: 6, minBuyin: 40, maxBuyin: 200, buyin: 100 };
  assert.ok(hub._validateTableCfg({ ...poker, variant: "plo" }).error);
  assert.ok(hub._validateTableCfg({ ...poker, variant: "dragon-tiger" }).error);
  assert.equal(hub._validateTableCfg({ ...poker, variant: "holdem" }).variant, "holdem");
  assert.equal(hub._validateTableCfg(poker).variant, "holdem", "no variant = Hold'em");
  assert.ok(!hub._validateTableCfg({ ...poker, variant: "big-two" }).error?.includes("Unknown"));
});
