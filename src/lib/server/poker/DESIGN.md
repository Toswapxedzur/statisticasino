# Live gameplay — design & frozen contract (Phase 4/5)

This is the single source of truth for the real-time table server and the
table UI. Both sides are built against the shapes here; do not diverge.

Engine API (already built, do NOT modify): see
`src/lib/server/poker/engine/README.md`. Cards are 2-char strings
(`"As"`, `"Td"`). `createHand`, `legalActions`, `applyAction` are pure;
bet/raise amounts are the **total target commitment for the street**;
`call`/`allin` menu amounts are chips added. Engine mutates stacks
internally: after a hand completes, `enginePlayer.stack` is the player's
final stack (start − committed + payout).

## 1. LiveTable — authoritative in-memory table

File: `src/lib/server/poker/table.js` (rewrite the skeleton fully; keep
`lobbyRow()` and the watcher plumbing compatible with `hub.js`).

### Dependencies (injectable for testing)

```
new LiveTable(config, hub, deps = {})
deps = {
  wallet,        // default: real ../wallet.js  (buyIn/cashOut/rebuy use it)
  store,         // default: real ./store.js     (persistHand, nextHandNo)
  now,           // default: () => Date.now()
  setTimer,      // default: (fn,ms)=>setTimeout(fn,ms)
  clearTimer,    // default: (t)=>clearTimeout(t)
  rng,           // default: Math.random  (deck shuffle)
  autoStart      // default: true; false lets tests drive hands manually
}
```
Everything time/DB/random goes through deps so the sim test can inject
fakes and play thousands of hands deterministically with no DB or wall
clock.

### Seat model

Seats are keyed by seat number `0..maxSeats-1`. A seat is identified by
`userId` (a user occupies at most one seat per table). Connectivity is
DERIVED from current watchers (any watcher whose `conn.user.id ===
seat.userId`), so multi-tab and reconnect "just work" — never store a
socket on the seat.

```
seat = {
  seat, userId, name,
  stack,                 // chips at the table (buy-in, not wallet)
  sittingOut,            // true = not dealt in
  wantsToLeave,          // set when standing mid-hand; cashed out at hand end
  // hand-scoped (present only while dealt into the current hand):
  inHand, holeCards, status, committedThisStreet, totalCommitted, lastAction
}
```

### Timing constants

```
ACTION_TIMEOUT_MS   = 25_000   // per-decision clock
NEW_HAND_DELAY_MS   = 3_500    // pause after a hand before the next
DISCONNECT_GRACE_MS = 8_000    // a disconnected actor's clock is shortened to this
```

### Eligibility & starting a hand

A seat is **eligible to be dealt** iff: occupied, `!sittingOut`,
`stack >= 1`, and connected. `maybeStartHand()` runs after any change
(sit, stand, sit-out toggle, rebuy, hand end, connection change). If no
hand is running and ≥2 eligible seats exist, schedule `beginHand()` after
`NEW_HAND_DELAY_MS` (immediately on first ever hand is fine too).

`beginHand()`:
1. Advance `buttonSeat` to the next eligible seat clockwise (first hand:
   lowest eligible seat).
2. `players = eligible seats` → engine config `{ players:[{id:seat,
   seat, stack}], buttonSeat, smallBlind, bigBlind, deck }`. **Use the
   seat NUMBER as the engine player id AND seat** so mapping back is
   trivial. `deck = shuffle(standardDeck(), deps.rng)`.
3. `this.hand = createHand(config)`. Record `sbSeat`/`bbSeat` from
   `hand.initialEvents` blindsPosted. Route `initialEvents`:
   `holeCardsDealt` → private to each owner; everything else → public.
4. Copy engine hole cards onto seats; broadcast public state; then
   `promptActor()`.

### Action loop

`promptActor()`: if `hand.street==='complete'` → `finishHand()`. Else set
`actionDeadline = now()+ACTION_TIMEOUT_MS` (or `DISCONNECT_GRACE_MS` if
the actor is disconnected/sitting out), arm a timer that calls
`autoAct()`, broadcast public state, and send `TABLE_TURN`
(legalActions menu) privately to the actor's conns.

`act(conn, action)`: reject if not the actor's seat. Call
`applyAction(hand, {seat, ...action})` (engine throws on illegal → send
`error` toast, re-prompt same actor). On success: update `hand`, refresh
seats' hand-scoped fields + `lastAction`, route events (streetDealt is
public), clear timer, broadcast, then `promptActor()` again (which
handles auto-advanced streets and completion).

`autoAct()` (timeout): **check if legal, else fold.** Same path as a real
action so completion/side-pots stay correct.

### Finishing a hand

`finishHand()`:
1. Reconcile: for each dealt seat, `seat.stack = enginePlayer.stack`
   (final stack incl. payouts). `net = final − stackAtHandStart`.
2. Persist via `store.persistHand({tableId, handNo, buttonSeat, board,
   potTotal, startedAt, endedAt, stateJson, seats:[{userId, seat,
   displayName, holeCards, net}]})`.
3. Build `result` (winners + revealed hands for showdown; winner only for
   uncontested — no cards) and broadcast it inside the public state so
   clients can show the outcome for ~NEW_HAND_DELAY_MS.
4. Clear hand-scoped seat fields. Cash out any `wantsToLeave` seats
   (`wallet` credit + remove seat). Leave busted (`stack===0`) seats
   seated but ineligible (they can rebuy or stand).
5. `this.hand = null`; `maybeStartHand()`.

### Seating / wallet (atomic)

- `sit(conn, seatNo, buyin)`: validate seat free, `minBuyin<=buyin<=
  maxBuyin`, user not already seated. `await wallet.debit(userId, buyin,
  TABLE_BUYIN, tableId)` (throws INSUFFICIENT_CHIPS → error toast). Then
  create the seat with `stack=buyin`. Broadcast + `maybeStartHand()`.
- `stand(conn)`: if the user is `inHand`, set `wantsToLeave=true`
  (cashed out at hand end). Else `await wallet.credit(userId,
  seat.stack, TABLE_CASHOUT, tableId)`, remove seat, broadcast.
- `rebuy(conn, amount)`: only when NOT in a hand; `stack+amount <=
  maxBuyin`; `wallet.debit`; add to stack.
- `setSitOut(conn, bool)`: toggle; a sitting-out player finishes the
  current hand but isn't dealt the next.
- After any wallet change, send that user a `CHIPS` message with the new
  balance.

### Disconnect

`onConnectionGone(conn)` (called by hub on socket close): if the user has
no remaining watcher conns and it's currently their turn, shorten the
clock (or auto-act now). They keep their seat (chips stay); they're
skipped from `eligible` next hand until reconnected. On reconnect,
`addWatcher` re-sends full state, their private cards, and — if it's
their turn — the `TABLE_TURN` menu.

## 2. Wire protocol (already added to protocol.js)

- C2S: `hello, lobby.sub/unsub, table.join/leave, table.sit {seat,buyin},
  table.stand, table.action {action:{type,amount?}}, table.rebuy
  {amount}, table.sitout {sitOut}, chat {text}, pong`. Every table.* also
  carries `tableId`.
- S2C: `hello.ok, lobby, table.state {tableId, table:<TableView>},
  table.private {tableId, seat, holeCards}, table.turn {tableId,...menu},
  table.left, chips {chips}, chat, toast, error, ping`.

### TableView (S2C `table.state` `.table`) — FROZEN

```
{
  id, config:{id,name,variant,maxSeats,smallBlind,bigBlind,minBuyin,maxBuyin},
  phase: 'waiting'|'running',
  handNo, buttonSeat|null,
  street: 'preflop'|'flop'|'turn'|'river'|'showdown'|'complete'|null,
  board: string[],                 // revealed community cards
  potTotal,                        // sum(pots)+sum(committedThisStreet)
  pots: [{amount, eligibleSeats}], // for side-pot chips (optional to render)
  toActSeat|null, actionDeadline|null,
  seats: [{
    seat, userId, name, stack,
    committed,                     // committedThisStreet
    status: 'active'|'folded'|'allin'|null,
    inHand: bool, hasCards: bool, sittingOut: bool, connected: bool,
    isButton, isSB, isBB, isToAct: bool,
    lastAction: string|null        // "Raise 40" | "Call" | "Check" | "Fold" | "All-in" | "SB" | "BB"
  }],
  result: null | {
    type:'showdown'|'uncontested',
    board: string[],
    winners:[{seat, amount}],
    revealed:[{seat, holeCards, handName}]  // [] for uncontested
  }
}
```

### TABLE_TURN (S2C, only to the acting user's conns) — FROZEN

```
{ tableId, seat, deadline, callAmount, currentBet, minRaise, potTotal,
  actions:[ {type:'fold'},
            {type:'check'} | {type:'call', amount},
            {type:'bet', min, max} | {type:'raise', min, max},
            {type:'allin', amount} ] }   // subset present as legal
```
Client sends `table.action {action:{type, amount?}}` where `amount` is the
TOTAL street target for bet/raise (echo engine semantics).

## 3. UI (Svelte 5 runes). Files under `src/routes/table/[id]/` and
`src/lib/poker/components/`.

Read `src/lib/poker/client.svelte.js` for the reactive singleton `poker`
(fields: `connected, me, tables[id], privates[id], turns[id], chat[id],
toast`; methods: `joinTable/leaveTable/sit/stand/act/rebuy/sitOut/
sendChat`). Match the site look (dark; classes in `src/app.css`;
`.card`, `.btn`, `.muted`, `--hero`, `--text`, `--muted`, `--border`).

Components (each its own file, disjoint):
- `Card.svelte` — props `{card?: string, faceDown?: bool, size?: 'sm'|'md'}`.
  Render rank + suit glyph (♥♦ red `#e0555f`, ♠♣ near-white on dark); back
  uses `/replay-engine/assets/X.png`. Rounded, crisp, legible small.
- `Seat.svelte` — props `{seat, me, isMine, canSit, onSit}`. Empty seat →
  "Sit here" button (calls onSit). Occupied → name, stack, dealer/SB/BB
  badge, face-down or (mine/revealed) face-up cards, bet-chip amount in
  front, folded (dim) / all-in / sitting-out states, and a countdown ring
  when `isToAct` (use `actionDeadline`).
- `CommunityBoard.svelte` — props `{board, potTotal, street, result}`.
  5 board slots + central pot pill.
- `ActionBar.svelte` — props `{turn, config, potTotal, myStack, onAct}`.
  Only shown when it's my turn (`poker.turns[id]`). Buttons: Fold,
  Check/Call (show call amount), and a raise control: slider + numeric
  input between `min` and `max` (TOTAL), quick chips (½ pot, ¾ pot, pot,
  all-in) computed from `potTotal`+`callAmount`, min-raise enforced.
  Emits `onAct({type, amount})`.
- `BuyInModal.svelte` — props `{config, walletChips, seat, onConfirm,
  onCancel}`. Slider between `minBuyin` and `min(maxBuyin, walletChips)`;
  confirm → `onConfirm(amount)`.
- `TableChat.svelte` — props `{messages, onSend}`.
- `PokerTable.svelte` — the felt; positions `maxSeats` seats elliptically
  (rotate so MY seat is bottom-center when seated), places `CommunityBoard`
  in the middle, renders each `Seat`. Props `{view, me, privates, onSit}`.
- `+page.svelte` — orchestrates: `poker.joinTable(id)` on mount /
  `leaveTable` on destroy; renders `PokerTable` + `ActionBar` +
  `TableChat`; opens `BuyInModal` on empty-seat click; Stand/Sit-out/
  Rebuy controls; shows toasts; requires sign-in to sit (link to
  `/account/login`). Keep the felt visuals from the current stub as a
  starting point.

### UX rules (poker-room conventions)
- Only show `ActionBar` for the seat the signed-in user occupies, when
  `isToAct`. Pre-select Check/Fold sensibly.
- Show each seat's `committed` chips in front; total `potTotal` in center.
- Dealer button chip near the button seat; "SB"/"BB" tags preflop.
- Countdown ring/urgency color as `actionDeadline` approaches.
- On `result`, highlight winners and reveal `revealed` hands for the
  post-hand pause.
- Face-down opponent cards use the card back; only the owner sees
  `privates[id].holeCards`; at showdown, `result.revealed` shows others'.
```
