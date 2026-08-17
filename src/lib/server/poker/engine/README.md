# Texas Hold'em engine

Pure, dependency-free ES modules for deterministic No-Limit Hold'em cash hands.

## Cards and public API

A card is `<rank><suit>`, where ranks are `23456789TJQKA` and suits are `cdhs`.
`standardDeck()` returns `2c..Ac, 2d..Ad, 2h..Ah, 2s..As`; `shuffle(deck, rng)`
returns a Fisher-Yates-shuffled copy. The state machine itself never shuffles.

- `standardDeck() -> string[]`
- `shuffle(deck, rng = Math.random) -> string[]`
- `evaluate7(cards7) -> { category, ranks, name }`
- `compareRank(a, b) -> number`
- `createHand(config) -> HandState`
- `legalActions(state) -> { toActSeat, actions }`
- `applyAction(state, action) -> { state, events }`

`RANKS` and `SUITS` are also exported. Import everything from `index.js`.

## Conventions and invariants

The supplied deck must contain all 52 unique standard cards. Its first element is
the top. Hole cards are dealt in two clockwise passes beginning left of the
button; community cards then come from the top with no simulated burn cards.
The configured button seat must be occupied.

Bet and raise amounts are the player's **total target commitment for that
street**. Call and all-in menu amounts are chips added by that action. Chips are
safe non-negative integers. Antes count only toward `totalCommitted`; blinds
also count toward `committedThisStreet`. A short blind is posted as an all-in,
while preflop `currentBet` and `minRaise` still begin at the configured big blind.

Every reducer call returns new plain JSON data and never mutates its arguments.
`canRaise` records whether action has been reopened for a player. Pots retain a
one-player all-in layer, so three distinct all-in stacks form a main pot and two
side pots; that last layer is deterministically paid back to its only eligible
player. Odd split chips are assigned clockwise beginning left of the button.

`createHand` stores its setup event batch in `state.initialEvents`; later batches
come from `applyAction`. Event shapes are stable plain objects:

- `{ type:"blindsPosted", antes, smallBlind, bigBlind }`
- `{ type:"holeCardsDealt", hands:[{ seat, cards }] }`
- `{ type:"action", seat, action:{ type, amount? }, contributed, allIn }`
- `{ type:"streetDealt", street, cards }`
- `{ type:"uncalledBetReturned", seat, amount }`
- `{ type:"showdown", board, hands }`
- `{ type:"payout", seat, amount }`
- `{ type:"handComplete", result }`

`holeCardsDealt` contains private cards and must be routed privately by an
orchestrator. Showdown results reveal only non-folded hands; an uncontested
result contains no hole cards.
