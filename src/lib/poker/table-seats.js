// What every table UI (PokerTable, BankedTable, BetGameTable, ShedTable) reads off the view the same
// way: who sits where, which seat is mine, the one card size, and each seat's round outcome.

/** One card size for the whole table: 82 px up to 6 seats, smaller when the ring is crowded. */
export function cardWidth(seatCount) { return seatCount <= 6 ? 82 : seatCount <= 8 ? 70 : 60; }

/** The stage keeps every seat's hand space from the start: the card height (60:78). */
export function handSpace(cardW) { return Math.round((cardW * 78) / 60); }

/** The seat map of a table view, for `me` (null when watching). */
export function tableSeats(view, me, defaultSeats = 6) {
  const seats = view?.seats || [];
  const seatByNo = new Map(seats.map((s) => [s.seat, s]));
  const mySeatNo = me ? seats.find((s) => s.userId === me.id)?.seat ?? null : null;
  const seatNos = Array.from({ length: view?.config?.maxSeats ?? defaultSeats }, (_, i) => i);
  const cardW = cardWidth(seatNos.length);
  const bankerSeat = view?.bankerSeat ?? null;
  return {
    seatByNo, mySeatNo, seatNos, cardW, handSpace: handSpace(cardW),
    iAmSeated: mySeatNo != null,
    bankerSeat,
    // the House's badge: the banker's seat under the House name, or a stand-in before one sits
    house: bankerSeat != null && seatByNo.has(bankerSeat)
      ? { ...seatByNo.get(bankerSeat), name: "House" }
      : { userId: "house", name: "House", stack: 0, connected: true }
  };
}

/** A seat's entry in the round's results ({ seat, outcome, delta }), or null. */
export function outcomeOf(results, seatNo) { return results?.find((r) => r.seat === seatNo) || null; }

export const fmt = (n) => (typeof n === "number" ? n.toLocaleString() : n);
/** A win/loss amount with its sign: +1,200 / -300 / 0. */
export const signed = (n) => (n > 0 ? "+" : "") + fmt(n);
/** The badge colour for a result. */
export const deltaKind = (n) => (n > 0 ? "win" : n < 0 ? "lose" : "push");
