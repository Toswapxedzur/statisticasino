---
title: "Privacy & data handling"
slug: data-privacy
date: 2026-05-22
pinned: true
description: "Exactly what gets collected, what gets uploaded when you Flush or Export, and what does not."
---

This site is a school project. It only works because contributors run a
companion Chrome extension that captures their casino.org game traffic
and either uploads it (`Flush now`) or exports it as a `.casinodump`
file you can drop on the [Contribute](/contribute) page. Before you do
either, here's a plain-English description of what's actually inside
those payloads and what isn't.

## TL;DR

- **Collected:** poker game traffic from `*.casino.org` only, while the
  extension is loaded — gameplay messages, the casino-side display
  names of you and the players at your tables, table chat that occurs
  during a hand, your hole cards (only your own — opponents' face-down
  cards stay face-down), and timestamps.
- **Not collected:** your casino.org password, your session cookies,
  your IP address, your email, your real name, anything outside
  `*.casino.org`, anything from sites you visit while the extension is
  off, and any data while you're not on a casino.org page.
- **Uploaded only when *you* click `Flush now` or upload a
  `.casinodump`.** The extension does not auto-upload. There is no
  "telemetry" or background sync.

## What the extension captures locally

The extension's content scripts only run on `https://*.casino.org/*`
(see `manifest.json#host_permissions`). On every other site —
including this one — it does nothing.

Within casino.org, it observes:

1. The Phoenix WebSocket frames that carry gameplay (bets, cards,
   chat-during-hand, dealer messages, etc.).
2. HTTP responses from a small allow-list of in-game APIs that contain
   user-display data (so it can resolve `userId` → casino-side
   screen name).

Captured data lives in `chrome.storage.local`, on your machine, in your
Chrome profile. It never leaves automatically. You can wipe it any
time by clicking the trash icons in the extension's history page or by
removing the extension.

## What ends up in a `.casinodump` / `Flush now` payload

When you choose to upload (either manually or by exporting a file),
the extension assembles a list of **hand envelopes**, one per
completed hand. Each envelope contains:

- **`tableId`** and the table names it was displayed under (e.g.
  "Casino Royale 200/400 NL").
- **`pageUrl` / `pageTitle`** of the casino.org tab where that hand
  was observed (e.g. `https://www.casino.org/replaypoker/play/table/12345`).
- **The raw Phoenix WS frames** between `startHand` and `finishHand` —
  this is the gameplay record. It includes bets, raises, folds, board
  cards, pot sizes, and **anything chatted on the table channel during
  that hand**. Treat in-hand table chat as public.
- **Your hole cards** (visible because *you* are the one running the
  extension). Other players' hole cards remain `["X","X"]` unless they
  go to showdown — same as on the casino site itself.
- **Timestamps** for every frame.
- A **`userIndex`** mapping `userId → casino-side display name` for the
  players at your tables, so the website can render names instead of
  numeric ids.

The envelopes are gzipped and either POSTed to the website's
`/api/flush` endpoint or wrapped into a `.casinodump` file you can
drop on `/contribute` later.

## What is **not** in a `.casinodump`

Specifically, the following things are never read or sent:

- Your casino.org **password** — the extension does not touch
  authentication forms or storage.
- Your casino.org **session cookies** or `Authorization` headers —
  the request observer is read-only and does not capture cookie or
  authorization headers.
- Your **IP address** — the extension doesn't know it; the server
  receives it as the source of any HTTPS connection but it is not
  stored in the database alongside your contribution.
- Your **email**, **real name**, or any account info from this site
  (you do not need an account to contribute).
- Any data from any site **other than `*.casino.org`** — the extension
  is inert outside that origin.
- Browser **history** outside of casino.org tabs you actually played
  on.
- **Other tabs**, **other extensions**, **clipboard**, **microphone**,
  **camera** — none of this is requested by the manifest, so Chrome
  won't even let the extension reach it.

## On the website side

Anyone (signed in or not) can drop a `.casinodump` on the
[Contribute](/contribute) page. The server splits it into one record
per `(player, table, hand)` and stores those rows in a SQLite
database. Reads on `/data` are public. **Deletes are
admin-only**, and they're soft — a `removed_at` column is set rather
than the row being dropped, so the audit trail survives.

If you want a specific hand removed, message me. If you want
everything you ever uploaded gone, also message me — there is no
self-service delete because uploads are not tied to accounts.

## What "first upload wins" means for you

The first contributor to upload a given `(player, table, hand)`
fingerprint becomes the canonical record. Re-uploading the same hand
from the same perspective is a no-op. The same hand uploaded from a
**different** in-game player produces a separate sibling row under
that player — both perspectives are kept side-by-side, neither
overwrites the other.

## Questions / corrections

This post lives in `statisticasino/content/blog/data-privacy.md`. If
something here is wrong or has gone stale, please open an issue or DM
me; the post is pinned so any update floats to the top of the blog
index.
