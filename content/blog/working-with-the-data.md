---
title: "Working with the Data: Browse, Replay, Export"
slug: working-with-the-data
date: 2026-05-22
description: "A complete tour of how Statisticasino organizes uploaded hands, how to read the /data tree, and how to extract subsets for offline analysis."
---

Once a `.casinodump` lands on the [Contribute](/contribute) page (or arrives through the extension's `Flush now`), every finished round inside it gets unpacked into the [Data](/data) page as a row in a structured tree. This post is a complete map of that tree: how it's organized, what every node means, how the inline replay works, and how to pull the data back out as either another `.casinodump` or as plain JSON.

## The three-level tree

`/data` renders one giant nested list:

```
Player (casino-side screen name)
└── Table (with all the names it's been called by)
    └── Round 1
    └── Round 2
    ...
```

Three levels, top to bottom: **Player → Table → Round**. Click the caret on any branch to expand it; click again to collapse. Every level has a tri-state checkbox on its left for bulk selection (more on that under [Selection mechanics](#selection-mechanics)).

### Why "Player" is the top level (and what it actually means)

The most important thing to internalize is that a "Player" node is **the in-game perspective owner of the captured hand** — the seat whose hole cards were visible because the extension was running on that person's browser. It is **not**:

*   The site account that uploaded the dump (uploads are anonymous by default; see the data-privacy post).
*   A unique opponent at the table.
*   A merged history across all players who were ever seated.

If you and a friend both ran the extension at the same physical table and both uploaded the same round, you'll see **two** sibling Player nodes for that round — yours under your screen name, your friend's under theirs. Same `(tableId, handId)`, two different perspectives, both kept side-by-side. This is by design: the perspectives are not interchangeable (your hole cards aren't the same as theirs), and merging them would lose information.

### What "Table" tracks

A Table node groups every round captured at the same casino-side table id, regardless of how many sessions or how much time elapsed between captures. The list of names you see beside the table id (e.g. *"Casino Royale 200/400 NL · Lobby West 200/400"*) is the union of every display name that table has ever been called by — casino.org occasionally renames rooms, and we keep the history so a renamed table doesn't fork into two ghost branches.

### What "Round" gives you

Each round row shows:

*   **Round number** (1-based; counted within the table, oldest first).
*   **Captured-at timestamp**.
*   **Hero seat** — which physical seat the perspective owner was sitting in (`seat 0` through `seat 8`), or **`generic`** for spectator captures (admin-only — see below).
*   **Upload count** — if a round shows `2 uploads`, two different `.casinodump` files contributed it. The first upload becomes canonical; subsequent ones are recorded in `hand_upload` as audit rows but do not overwrite the bytes.
*   **Comment count** — placeholder; the schema supports per-round comments but the UI for posting them is still TBD.

### Inline replay: the red-seat highlight

Click a round row and a felt diagram drops down beneath it. This is the same replay engine the Chrome extension ships in `history.html`, lifted into the website (`static/replay-engine/`) and lazy-loaded on first use. It gives you:

*   **A full felt** with chip stacks, board cards, and a scrubber.
*   **Prev / Next step** controls so you can advance one action at a time.
*   **One red seat** — the perspective owner. Every other seat is rendered neutrally; the red highlight tells you "this is the seat whose hole cards we have." Generic rounds (no perspective) render with no red seat at all.

The replay reads from gzipped Phoenix WebSocket frames stored verbatim in `hand_canonical.frames_blob`, so what you see is byte-for-byte the gameplay sequence as it happened — not a regenerated approximation.

## The synthetic Generic player

There is one Player node that is **not** a real casino-side screen name: **`Generic`**. It's a synthetic bucket that holds rounds an admin chose to ingest from a pure spectator capture (no visible hole cards anywhere in the dump).

Behavior:

*   **Non-admin uploads** of generic dumps are rejected at ingest time with `summary.rejectedGeneric`. The website returns a counter so the contributor knows how many rounds were dropped.
*   **Admin uploads** can opt those rounds into the database; they land under the Generic player with `hero_seat = NULL` and no hole cards. The replay panel falls back to "no red seat" for these rows.
*   In the UI the Generic node is rendered in muted italics so it's visually distinct from real perspective owners.

The Generic bucket exists so admins can curate interesting hands they observed but didn't play in (e.g. a strange shuffle pattern at a table they were watching). For statistical analysis, generic rows are usually noise; filter them out by ignoring the Generic player branch.

## Selection mechanics

`/data` supports multi-select at every level of the tree, with a sticky **action bar** at the top that surfaces every bulk operation in one place.

*   **Round checkbox** — flip a single round in or out of the selection.
*   **Table checkbox** (tri-state) — clicked once, selects every round at that table; clicked again, clears them. If some-but-not-all of the table's rounds are selected, the checkbox renders in the indeterminate state (a horizontal bar instead of a checkmark).
*   **Player checkbox** (tri-state) — same idea, one level up. Selects every round under that player across every table.
*   **"Select all" button** — top-level shortcut.
*   **"Cancel" button** — clears the current selection without acting on it.

The selection drives all four bulk-action buttons:

| Button | Who can use it | What happens |
| - | - | - |
| **Delete selected** | admins only | Hard `DELETE FROM hand_canonical` (cascades to `hand_upload`). No undelete — re-upload the source dump if you want a round back |
| **Export** | anyone | Re-builds a `.casinodump` from the stored frames + canonical metadata of the selected rounds and downloads it. Symmetric to what the extension produces |
| **Export readable** | anyone | Lazy-loads the replay engine in your browser, runs each round through `buildSteps` + `buildRoundReadable`, and downloads a `.json` array of human-friendly action lists |
| **Cancel** | anyone | Clears the selection |

## Export: round-trip `.casinodump`

`POST /data/export-dump` (wired up to the **Export** button) takes a list of `handKey`s and returns a single base64-of-gzipped JSON `.casinodump` you can:

*   Re-import into another instance of Statisticasino (drop on its `/contribute` page).
*   Replay locally in the Chrome extension's history page (load the file via the extension's import path, if you've wired one up).
*   Archive offline as a flat file.

The exporter rebuilds every field the extension stamped on the original envelope (`tableId`, `tableNames`, `firstTs`/`lastTs`, raw frames, content hash). Fields the database doesn't preserve (`pageUrl`, `pageTitle`, `handIndex`) are emitted as `null` — the replay layer doesn't need them.

A `userIndex` mapping `casinoUserId → display name` is rebuilt from the `casino_player` rows we touched, so re-importing into a fresh database resolves player names correctly.

## Export readable: the JSON-for-humans path

The **Export readable** button is the one to use if you want to actually do statistics on the data without writing a Phoenix-frame parser yourself. Each captured round becomes a top-level array element with this shape:

```json
{
  "player": { "name": "screen-name", "casinoUserId": 12345 },
  "table":  { "tableId": "abc-123", "names": ["Casino Royale 200/400 NL"] },
  "round": {
    "handId": "hand-...",
    "firstTs": 1716370000000,
    "lastTs":  1716370120000,
    "hero":    { "name": "screen-name", "casinoUserId": 12345,
                 "seatId": 3, "holeCards": ["Ah", "Kd"] },
    "actions": [
      { "type": "postBlind", "seatId": 1, "amount": 200 },
      { "type": "postBlind", "seatId": 2, "amount": 400 },
      { "type": "deal", "phase": "preflop" },
      { "type": "raise", "seatId": 3, "amount": 1200 },
      { "type": "fold",  "seatId": 4 },
      ...
      { "type": "showdown", "winners": [...] }
    ]
  }
}
```

Notably, the `actions` array is **merged steps** — preflop / flop / turn / river / showdown, with bet sizes, fold-or-call decisions, and showdown outcomes — *not* raw Phoenix frames. The transform happens entirely in your browser (the website lazy-loads the same `replay.js` + `readable.js` modules the extension uses), so the SvelteKit server doesn't need to ship the replay engine.

For a generic round (`hero` perspective absent), `hero` is `null`. The action list is otherwise complete.

## How rounds get keyed (and why re-uploading the same hand is a no-op)

Every row in `hand_canonical` has a unique key built from three components:

```
hand_key = `${player_id}::${table_id}::${hand_dedup_id}`
```

where `hand_dedup_id` is either the casino-issued `handId` (when present and well-formed) or a `ts-<firstTs>` synthetic key (for legacy rounds without a real `handId`).

Because the player id is in the key, **the same physical round captured by two different in-game players produces two distinct rows** under two different player nodes. The keying does *not* merge across hero perspectives.

Within one perspective, re-uploading the same dump is silently a no-op:

*   The ingest path notices an existing row with the same `(player_id, table_id, hand_dedup_id)` triple.
*   It bumps the duplicate counter in the upload summary so the UI can say *"3 rounds, 2 already known"*.
*   It still appends a `hand_upload` audit row so we know who tried to re-upload what and when.

If you delete a round and then re-upload the dump, the round comes back fresh — there are no tombstone rows after schema v5 (see *[Privacy & data handling](#)* for details).

## Database tables, in one paragraph each

If you're poking at the SQL directly:

*   **`casino_player`** — one row per casino-side screen name we've ever ingested as a perspective owner. Plus the synthetic `[Generic]` row.
*   **`hand_canonical`** — the actual rounds. Each row owns its gzipped Phoenix frame slab in `frames_blob`, plus the hero seat / hole cards, plus timestamps.
*   **`hand_upload`** — audit trail. One row per upload that produced or duplicated a canonical row. `is_canonical = 1` marks the upload that *first* produced the row; subsequent duplicates have `is_canonical = 0`.
*   **`comment`** — placeholder for per-round discussion. Schema supports anonymous comments (uploader is optional); UI not yet built.
*   **`user`** / **`session`** — auth. Only matters for admins (who can delete and ingest generic rounds); anonymous browsers / contributors don't touch these.

## A few practical recipes

**"How many hands have I personally contributed?"** — Open `/data`, find the player node with your casino-side screen name, look at the `n hands` counter. (We don't link rounds to site accounts, so this is the closest thing to a personal "I uploaded these" view.)

**"How do I get all of one player's hands as JSON?"** — On `/data`, click the player checkbox to select every round under them, click **Export readable**, save the resulting `.json`.

**"How do I move data from one Statisticasino instance to another?"** — Select the rounds you want, click **Export**, drop the resulting `.casinodump` on the other instance's `/contribute` page (admin login required there).

**"How do I compare two different perspectives of the same physical round?"** — Find the round under each player branch (same `tableId`, same round number), open both inline replays in adjacent browser tabs, step through them side-by-side. The frames are the same, but the hero seat changes (different red seat), and the visible hole cards differ.

**"How do I tell whether a round was uploaded by multiple people?"** — Look at the `n uploads` counter on the round row. `1 upload` = exactly one contributor; `2 uploads` or more = multiple, with the first canonical and the rest in the audit trail. Click into the inline replay; the bytes you see are always the canonical (first) version.

## Coming back later

The site is read-public and search-engine-indexable, but it intentionally has no public sharing primitives beyond a stable per-round URL (`/data/hand/<key>` returns JSON and is what the inline replay fetches). Bookmark a `/data` page and the same tree will be there next time, plus whatever everyone else has uploaded in the interim.

If you want a feature that isn't here — comments, per-round permalinks with embedded replays, an admin queue for unfiled hands, anything else — open an issue or DM me. The blog is also where new features get announced, so subscribe to the RSS feed (`/blog.rss` is on the wishlist; not built yet) or just check back periodically.
