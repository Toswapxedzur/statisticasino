// Dealing & shuffling in the real game — the rules both sides share (no DOM, no Svelte, so the
// server's table.js can import it too).
//
// Owner's decisions (2026-09-25): POKER only for now (the flop games: Hold'em, Omaha, Short
// Deck); the face-down deck lives top-left and the face-up used pile top-right, just below the
// top bar, each ~30% off the screen edge; cards leave the deck face-down one at a time,
// clockwise from the left of the button; your own cards flip once they land; the flop flies
// out and flips together, turn and river singly; folded hands and, at the end of the hand, all
// cards fly to the used pile; then the full shuffle routine plays, every hand — the server
// waits long enough between hands for it.

import { TIMING as ROUTINE } from "./deck-routine.js";

/** The poker variants that get the dealt / shuffled deck (Stud and Draw: not yet). */
export const ANIMATED_VARIANTS = new Set(["holdem", "holdem-pl", "shortdeck", "shortdeck-pl", "plo", "plo5", "omaha-hilo"]);
export const HOLE_COUNT = { holdem: 2, "holdem-pl": 2, shortdeck: 2, "shortdeck-pl": 2, plo: 4, plo5: 5, "omaha-hilo": 4 };

/** Does this table get the animated deck? (Not tournaments / River Sprint — fast-fold.) */
export function animatesTable(view) {
  return !!view && animatesConfig(view.config);
}
export function animatesConfig(config) {
  return !!config && !config.tournament && ANIMATED_VARIANTS.has(config.variant);
}

export const DEAL = {
  every: 110,            // a card leaves the deck every 110 ms …
  flight: 380,           // … and lands 380 ms later
  arc: 14,               // lift at mid-flight (units, a card is 60 wide)
  boardEvery: 90,
  flipAfterLand: 120,    // own cards / board: land face-down, flip this long after
  muckFlight: 420,
  muckEvery: 60,
  showdownHold: 900,     // the result stays readable this long before the cards are collected
  collectEvery: 30,       // … but all launches fit in collectSpan, however many cards
  collectSpan: 700,
  collectFlight: 420
};
/** Spacing between collection launches for n cards (the whole collection launches within 0.7 s). */
export const collectEvery = (n) => (n > 1 ? Math.min(DEAL.collectEvery, DEAL.collectSpan / (n - 1)) : 0);

/** Time from the end of a hand to the deck being ready again: hold + collect + routine. */
export function turnaroundMs(cardsOnTable) {
  const routine = ROUTINE.flyIn + ROUTINE.settle + ROUTINE.cuts * ROUTINE.cutPass + (ROUTINE.cuts - 1) * ROUTINE.cutGap
    + ROUTINE.beforeSplit + ROUTINE.split + ROUTINE.beforeShuffle + 51 * ROUTINE.launchEvery + ROUTINE.flight
    + ROUTINE.beforeReturn + ROUTINE.flyBack;
  // (the leftover deck's packet flies alongside; the table's cards start one beat after it)
  return DEAL.showdownHold + DEAL.collectEvery + Math.max(0, cardsOnTable - 1) * collectEvery(cardsOnTable) + DEAL.collectFlight + 30 + routine;
}
/** Between-hands pause on an animated table: the worst case (a full 10-seat Hold'em table plus
 *  the board, or 9 seats of 5-card Omaha) with slack for network latency. */
export const SHUFFLE_HAND_DELAY_MS = 10_500;

/**
 * Deal order: seats holding cards, clockwise (increasing seat number) starting from the seat
 * after the button. seats = view.seats; returns seat numbers.
 */
export function dealOrder(seats, buttonSeat) {
  const inHand = seats.filter((s) => s.inHand && s.hasCards).map((s) => s.seat).sort((a, b) => a - b);
  if (!inHand.length) return [];
  const i = inHand.findIndex((n) => n > (buttonSeat ?? -1));
  const k = i === -1 ? 0 : i;
  return inHand.slice(k).concat(inHand.slice(0, k));
}

/** The flights of one deal, in launch order: `rounds` passes round the table, one card each. */
export function planDeal(order, rounds) {
  const plan = [];
  for (let r = 0; r < rounds; r++) for (const seat of order) plan.push({ seat, slot: r });
  return plan.map((p, i) => ({ ...p, t0: i * DEAL.every }));
}
