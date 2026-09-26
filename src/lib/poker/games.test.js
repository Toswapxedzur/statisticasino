import { test } from "node:test";
import assert from "node:assert/strict";
import { GAME_MODES, POKER_VARIANTS, OFFERED, LOBBY_MODES, OFFERED_POKER_VARIANTS, isOffered, variantLabel } from "./games.js";
import { PokerHub } from "../server/poker/hub.js";

test("the site offers one game per major type: 8 of the 30", () => {
  assert.deepEqual(LOBBY_MODES.map((m) => m.key), ["poker", "blackjack", "three-card", "baccarat", "roulette", "sic-bo", "slots", "big-two"]);
  assert.deepEqual(OFFERED_POKER_VARIANTS.map((v) => v.key), ["holdem"]);
  const known = new Set([...GAME_MODES.map((m) => m.key), ...POKER_VARIANTS.map((v) => v.key)]);
  for (const k of OFFERED) assert.ok(known.has(k), `${k} is a real game`);
  // hidden games keep their names (replays of them still read properly)
  assert.equal(isOffered("plo"), false);
  assert.equal(variantLabel("plo"), "Pot-Limit Omaha");
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
