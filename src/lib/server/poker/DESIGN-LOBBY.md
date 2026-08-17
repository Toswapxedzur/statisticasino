# PlayOK-style lobby — design & frozen contract

Extends DESIGN.md (gameplay). This covers the dynamic, player-created
lobby. The gameplay layer (LiveTable, engine, wallet, gateway auth,
op-lock, hand history, table UI, /table/[id]) is UNCHANGED and reused.

Decisions (owner, 2026-08-16): pure ephemeral tables (no fixed/house
tables); full social layer (online players + lobby chat + invites +
leaderboard); Quick Play = instant one-click auto-seat with a default
buy-in.

## Table lifecycle (ephemeral)
- Tables exist only when a player creates one. `createTable` writes a
  `poker_table` row (`is_ephemeral=1`, `created_by=userId`,
  `closed_at=NULL`) AND a live in-memory `LiveTable`, then auto-seats the
  creator. Schema v11 already added the columns.
- A table is destroyed when it becomes truly empty:
  `seats.size===0 && watchers.size===0`. Destroying = tear down the live
  instance + `closeTableRow` (set `closed_at`, `is_active=0`). The row is
  KEPT (poker_hand FKs to it); the lobby only lists tables that have a
  live instance, so a closed table never reappears.
- The lobby is WebSocket-driven; SSR renders an empty shell (with an
  empty-state prompt) and the live snapshot arrives over the socket.

## Wire protocol additions (protocol.js — already frozen)
C2S:
- `table.create` { name?, smallBlind, bigBlind, maxSeats, minBuyin, maxBuyin, buyin }
- `quickplay` { buyin? }
- `lobby.chat` { text }
- `invite` { toUserId }              — invite a player to MY current table
- `invite.respond` { inviteId, accept }
S2C:
- `lobby` { tables:[LobbyTable], players:[LobbyPlayer], leaderboard:[LбRow] }  (extended)
- `lobby.chat` { from, text, ts }
- `table.created` { tableId }         — creator/quick-play/invite-accept navigates here
- `invite` { inviteId, fromName, fromUserId, tableId, tableName }  — incoming
- `toast` / `error` reused

### LobbyTable (in `lobby.tables[]`) — FROZEN
```
{ id, name, variant, smallBlind, bigBlind, maxSeats, minBuyin, maxBuyin,
  seated, watchers, status: 'waiting'|'playing', createdBy, creatorName }
```
`status`: 'playing' when a hand is running, else 'waiting'.

### LobbyPlayer (in `lobby.players[]`) — FROZEN
```
{ id, name, chips, location: 'lobby'|<tableId>, tableName: string|null, isAdmin }
```
Deduped by userId (multi-tab = one entry). `location` is the table the
player is seated at or watching, else 'lobby'.

### LbRow (in `lobby.leaderboard[]`) — FROZEN
```
{ name, chips }   // top 10 users by wallet chips, desc
```

## Hub responsibilities (hub.js)
- Drop table seeding + DB auto-load. `tables` starts empty; populated only
  by `createTable`/`quickPlay`/invite.
- `createTable(conn, cfg)`: require auth; validate (1<=sb<=bb; maxSeats in
  2..9; 1<=minBuyin<=maxBuyin; buyin in [minBuyin,maxBuyin]; wallet >=
  buyin — check balance BEFORE creating). Default name
  "<DisplayName>'s Table". Create row + LiveTable + addWatcher(creator) +
  await table.sit(creator, seat 0, buyin). Send `table.created`{tableId}.
  pushLobby.
- `quickPlay(conn, {buyin?})`: pick the best live table where the user
  isn't already seated and a seat is open, matching this policy in order:
  (1) a table with exactly ONE seated player + an open seat (instant
  heads-up), (2) the fullest non-full table, else (3) create a new default
  table (1/2 NL, 6-max, buy-in 40–200). Seat the user with
  `buyin ?? min(maxBuyin, walletChips, 100*bigBlind)` (>= minBuyin, else
  error "not enough chips"). Send `table.created`{tableId}.
- `maybeCloseTable(table)`: if empty (see lifecycle) → close + delete +
  pushLobby. Call after removeWatcher, after a stand that frees the last
  seat, and in removeConnection.
- Presence: `lobbySnapshot()` returns { tables, players, leaderboard }.
  players = online authed connections deduped by userId, with wallet chips
  (batch `SELECT id,chips FROM user WHERE id IN (...)`) and location. Push
  on connect/disconnect/lobby-sub/join/leave/sit/stand/create/close.
- Invites: in-memory Map inviteId -> {fromUserId, toUserId, tableId,
  expiresAt (~60s)}. `invite`: inviter must be seated at a table with an
  open seat; send `invite` to the target's conns. `invite.respond`
  accept: if the invite is live and a seat is open, addWatcher + sit the
  target (default buy-in) and send them `table.created`{tableId}; notify
  inviter via toast. decline: toast the inviter.
- Leaderboard: `SELECT display_name/email, chips FROM user ORDER BY chips
  DESC LIMIT 10` in lobbySnapshot (small N; fine to recompute).

## Client store (client.svelte.js — already frozen)
- `poker.lobby` becomes `{ tables:[], players:[], leaderboard:[] }`.
- `poker.lobbyChat` = [] ; `poker.invites` = [] (incoming) ;
  `poker.pendingNav` = tableId|null (set on `table.created`; the lobby
  page navigates to /table/<id> then clears it).
- methods: `createTable(cfg)`, `quickPlay(buyin?)`, `sendLobbyChat(text)`,
  `invitePlayer(toUserId)`, `respondInvite(inviteId, accept)`.

## UI (Svelte 5) — three-pane lobby
`/+page.svelte` (rewrite) + `/+page.server.js` (minimal: just the signed-in
user; no table seeding). Panes:
- LEFT (main): live tables list — name, stakes, seated/max, waiting|playing,
  Join/Watch buttons. Empty-state: "No tables yet — start one or hit Quick
  Play." Top actions: **Quick Play** (primary) + **New Table** (opens modal).
- RIGHT: online players (name, chips, location badge) with an **Invite**
  action per player (when I'm seated at a table with room), and a
  **Leaderboard** (top chips) below.
- BOTTOM: lobby chat.
- Incoming invite -> a toast/banner with Accept/Decline.
- On `poker.pendingNav`, `goto('/table/'+id)`.
Components: `NewTableModal.svelte`, `LobbyPlayers.svelte` (players +
leaderboard), `LobbyChat.svelte` (or reuse TableChat styling). Match the
dark theme + app.css.
