// Group raw captured `messages[]` by table — NOT by time-bounded session.
// A "table" here is a permanent bucket keyed by the server's `table:<id>`
// Phoenix topic id; every frame ever captured for that id (across days,
// disconnects, name changes, ...) lives under the same bucket.
//
// Output shape (per table):
//   {
//     tableId:    "16809114",
//     names:      ["Aquarium 2", "Crystal Pond"]   // chronological,
//                                                  // dedup-preserving
//     pageUrl:    "https://www.casino.org/replaypoker/play/table/16809114",
//     pageTitle:  "Aquarium 2",
//     firstTs:    1778852135307,
//     lastTs:     1778852947112,
//     frameCount: 412,
//     handIds:    ["abc", "def", ...],
//     frames:     [{ ts, event, payload }, ...]   // chronological
//     hands:      [Hand, ...]                     // chronological,
//                                                 // produced by detectHands
//   }
//
// Hand (per round inside a table):
//   {
//     tableId, handId,                            // never null in v2:
//                                                 // synthesized from
//                                                 // firstTs if needed
//     handIndex,                                  // 0-based, oldest first
//                                                 // within this table
//     firstTs, lastTs,
//     actionCount,
//     startFrameIdx, endFrameIdx,                 // indices into table.frames
//     finishedExplicit,                           // saw its `finishHand`
//     supersededByLater,                          // a later `startHand`
//                                                 // (or a frame for a
//                                                 // brand-new `handId`)
//                                                 // appeared without our
//                                                 // own finishHand
//     lifecycle: "finished" | "in-progress" | "incomplete"
//     frames: [...]                                // slice of table.frames
//                                                 //   between [start..end]
//   }
//
// Lifecycle rule (v2, per chat 2026-05-21):
//
//   * finished     iff the hand saw its own `finishHand`.
//   * incomplete   iff the hand had a `startHand` but a LATER `startHand`
//                  (or a frame for a different `handId` we've never seen
//                  closed) arrived before our `finishHand`. Bytes for a
//                  superseded hand stop accumulating the moment the
//                  next hand opens.
//   * in-progress  iff the hand had a `startHand` and is still the
//                  most-recent open hand, no later opener seen yet.
//                  Bytes may still arrive.
//
// Things that are NEVER turned into hands:
//
//   * Frames that arrive at a table BEFORE any `startHand`. The user
//     joined mid-hand and the start was missed; we discard the slice.
//   * Frames whose `handId` matches an old/superseded hand. Bytes
//     drift from a closed-but-never-finished hand are ignored — we
//     wait for the next `startHand` (or a frame with a brand-new
//     `handId`, which itself opens a new `incomplete` row only AFTER
//     a startHand for it has been seen).
//
// Pure functions; no DOM / chrome API access. Hangs `globalThis.CasinoTableize`.

(function (root) {
  const TABLE_TOPIC_RE = /^table:([^:\s]+)$/;
  const TITLE_SUFFIX_RE = /\s*[-–—|·]\s*Replay\s*Poker\s*$/i;

  // updates[].action values that count as authoritative gameplay steps.
  // Mirrors DATA_FORMAT.md §4.2.
  const AUTHORITATIVE_ACTIONS = new Set([
    "startHand", "blinds", "dealHoleCards", "dealCommunityCards",
    "check", "call", "bet", "raise", "fold", "allIn",
    "updatePots", "betRefund", "showdown", "show", "muck",
    "awardPot", "finishHand"
  ]);

  // ------------------------------------------------------- helpers

  function pickTimestamp(m) {
    return (m && (m.endTs || m.ts || m.receivedTs || m.startTs)) || 0;
  }

  function safeParseJson(s) {
    try { return JSON.parse(s); } catch { return null; }
  }

  function parsePhoenixFrame(s) {
    if (typeof s !== "string") return null;
    const t = s.trim();
    if (!t.startsWith("[") || !t.endsWith("]")) return null;
    const arr = safeParseJson(t);
    if (!Array.isArray(arr) || arr.length < 4) return null;
    if (typeof arr[2] !== "string" || typeof arr[3] !== "string") return null;
    return arr;
  }

  function collectHandIds(payload, sink) {
    if (!payload || typeof payload !== "object") return;
    if (payload.handId != null) sink.add(String(payload.handId));
    if (payload.hand_id != null) sink.add(String(payload.hand_id));
    if (Array.isArray(payload.updates)) {
      for (const u of payload.updates) {
        if (u && typeof u === "object") {
          if (u.handId != null) sink.add(String(u.handId));
          if (u.hand_id != null) sink.add(String(u.hand_id));
        }
      }
    }
  }

  function extractWsString(m) {
    if (!m || m.kind !== "ws") return null;
    const d = m.data;
    if (d && typeof d === "object" && typeof d.data === "string") return d.data;
    if (typeof d === "string") return d;
    return null;
  }

  function cleanTitle(raw) {
    if (!raw || typeof raw !== "string") return null;
    const stripped = raw.replace(TITLE_SUFFIX_RE, "").trim();
    return stripped || null;
  }

  // Append `name` to the table's known-names list, preserving the order
  // of *first occurrence*. Lets the UI render "Crystal Pond - Aquarium 2"
  // when the same tableId has been called by different names over time.
  function addName(bucket, name) {
    const cleaned = cleanTitle(name);
    if (!cleaned) return;
    if (bucket.names.indexOf(cleaned) === -1) bucket.names.push(cleaned);
  }

  // Heuristic: does this page URL appear to be about `tableId`?
  // casino.org's table pages embed the numeric id into the path
  // (`/replaypoker/play/table/16809114`). Lobby / chat / friends pages
  // don't. We accept any URL whose path ends in `/<tableId>` or
  // contains `/table/<tableId>`. If we have no URL at all, fall through
  // (caller will skip name adoption rather than guess).
  function pageMentionsTable(pageUrl, tableId) {
    if (!pageUrl || !tableId) return false;
    const id = String(tableId);
    // Match boundaries so 16809114 doesn't match 168091149.
    const re = new RegExp("(?:^|/)" + id.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&") + "(?:/|$|\\?|#)");
    try {
      return re.test(pageUrl);
    } catch {
      return false;
    }
  }

  // ------------------------------------------------------- tableize

  // Walk the flat `messages[]` array and bucket every Phoenix `table:<id>`
  // frame by `tableId`. No idle-gap splitting; a table bucket exists
  // forever, even across captures separated by weeks.
  function tableize(messages) {
    if (!Array.isArray(messages) || messages.length === 0) return [];

    const buckets = new Map(); // tableId -> bucket

    const sorted = messages.slice().sort((a, b) => pickTimestamp(a) - pickTimestamp(b));

    for (const m of sorted) {
      const text = extractWsString(m);
      if (!text) continue;
      const frame = parsePhoenixFrame(text);
      if (!frame) continue;

      const topic = frame[2];
      const event = frame[3];
      const payload = frame[4];

      const topicMatch = TABLE_TOPIC_RE.exec(topic);
      if (!topicMatch) continue;
      const tableId = topicMatch[1];
      const ts = pickTimestamp(m) || 0;

      let bucket = buckets.get(tableId);
      if (!bucket) {
        bucket = {
          tableId,
          names: [],                 // chronological, dedup-preserving
          pageUrl: m.pageUrl || null,
          pageTitle: m.pageTitle || null,
          firstTs: ts,
          lastTs: ts,
          frameCount: 0,
          handIds: new Set(),
          frames: []
        };
        buckets.set(tableId, bucket);
      }

      bucket.lastTs = ts;
      bucket.frameCount++;
      // Only adopt the message's pageTitle / pageUrl if the page was
      // actually about THIS table. WebSocket frames for table B can
      // arrive while the user is still on table A's page (e.g. they
      // opened B in a second tab whose bridge captured B's frames, OR
      // the page kept A's socket subscribed after navigating). Without
      // this guard the table-B bucket would inherit "Aquarium 2" from
      // table A's page title — which is exactly the
      // "rounds-at-different-tables-mislabelled" bug the user reported
      // (chat 2026-05-20).
      if (m.pageUrl && pageMentionsTable(m.pageUrl, tableId)) {
        bucket.pageUrl = m.pageUrl;
        if (m.pageTitle) {
          addName(bucket, m.pageTitle);
          bucket.pageTitle = m.pageTitle;
        }
      }

      collectHandIds(payload, bucket.handIds);
      // `srcId` is the id of the raw `messages[]` entry that produced
      // this frame. The history page's delete actions need it so they
      // can filter the underlying messages array (a hand has no
      // standalone storage row — it's derived from a slice of frames).
      bucket.frames.push({ ts, event, payload, srcId: m.id || null });
    }

    const finished = [];
    for (const bucket of buckets.values()) {
      bucket.handIds = Array.from(bucket.handIds);
      bucket.hands = detectHands(bucket);
      finished.push(bucket);
    }
    // Newest-first overall — matches the History page's "recent on top"
    // ordering. Within each table, hands are oldest-first (chronological
    // play order); the UI is free to reverse for display.
    finished.sort((a, b) => b.lastTs - a.lastTs);
    return finished;
  }

  // -------------------------------------------------- detect hands

  // Walk a table's chronological frames and produce one entry per hand.
  //
  // v2 rules (per chat 2026-05-21):
  //
  //   * Frames before the very first `startHand` at this table are
  //     IGNORED. We do not synthesize a hand without a start.
  //
  //   * `startHand` either opens a fresh hand or — if there's already
  //     a `current` hand that's still open — closes the current as
  //     `supersededByLater` (=> lifecycle "incomplete") and opens a
  //     new one.
  //
  //   * A non-`startHand` authoritative action whose `handId` differs
  //     from `current.handId`:
  //       - if we've never opened a hand for that id before, it
  //         signals that a NEW hand started but its `startHand` was
  //         missed. We close `current` as superseded and DROP this
  //         frame (no implicit open). The next `startHand` (which the
  //         poker server will send shortly) will open the new hand
  //         properly.
  //       - if we've seen and closed that id before, it's old drift
  //         from a superseded hand. DROP the frame; do not extend
  //         either `current` or the closed hand.
  //
  //   * Everything else extends `current`.
  function detectHands(table) {
    if (!table || !Array.isArray(table.frames) || table.frames.length === 0) {
      return [];
    }

    const hands = [];
    let current = null;
    // Set of handIds we've already opened-and-closed (whether finished
    // or superseded). Used to tell "new hand whose startHand we
    // missed" apart from "drift from an old hand".
    const seenHandIds = new Set();

    function pushCurrent(endIdx) {
      if (!current) return;
      current.endFrameIdx = endIdx;
      current.frames = table.frames.slice(current.startFrameIdx, endIdx + 1);
      if (current.handId) seenHandIds.add(current.handId);
      hands.push(current);
      current = null;
    }

    // Open a fresh hand on a real `startHand`. If there's already an
    // open hand, mark it superseded and close it just before this
    // frame (so the slice ends one frame back — the new startHand
    // belongs to the NEXT hand, not the closing one).
    function openFreshHand(idx, handId, ts) {
      if (current) {
        if (!current.finishedExplicit) current.supersededByLater = true;
        const closeAt = Math.max(idx - 1, current.startFrameIdx);
        pushCurrent(closeAt);
      }
      current = {
        tableId: table.tableId,
        handId: handId ? String(handId) : null,
        firstTs: ts,
        lastTs: ts,
        actionCount: 1, // the startHand action itself counts
        startFrameIdx: idx,
        endFrameIdx: idx,
        finishedExplicit: false,
        supersededByLater: false,
        frames: null,
        lifecycle: "in-progress"
      };
    }

    for (let i = 0; i < table.frames.length; i++) {
      const f = table.frames[i];
      if (!f || f.event !== "output") continue;
      const updates = f.payload && Array.isArray(f.payload.updates)
        ? f.payload.updates
        : null;
      if (!updates || updates.length === 0) continue;

      const frameHandId = f.payload && (f.payload.handId ?? f.payload.hand_id);

      for (const u of updates) {
        if (!u || typeof u !== "object" || !u.action) continue;
        const action = u.action;
        if (action === "startHand") {
          const handId = u.handId ?? u.hand_id ?? frameHandId ?? null;
          openFreshHand(i, handId, f.ts);
          continue;
        }

        if (!AUTHORITATIVE_ACTIONS.has(action)) continue;

        // Rule: ignore everything before the first startHand.
        if (!current) continue;

        const updateHandId = u.handId ?? u.hand_id ?? frameHandId ?? null;
        const updateHandIdStr = updateHandId == null ? null : String(updateHandId);

        if (updateHandIdStr && current.handId && updateHandIdStr !== current.handId) {
          // The frame belongs to a different hand than the one we
          // think is open. Two cases:
          if (seenHandIds.has(updateHandIdStr)) {
            // Old drift from a superseded/closed hand — ignore.
            continue;
          }
          // A NEW hand whose startHand we missed. Close the current
          // as superseded and DROP this frame; the next real
          // `startHand` will open the new hand properly.
          if (!current.finishedExplicit) current.supersededByLater = true;
          const closeAt = Math.max(i - 1, current.startFrameIdx);
          pushCurrent(closeAt);
          continue;
        }

        // Extend the current hand.
        current.lastTs = f.ts;
        current.endFrameIdx = i;
        current.actionCount++;
        if (!current.handId && updateHandIdStr) current.handId = updateHandIdStr;

        if (action === "finishHand") {
          // finishHand for our current hand only — see the handId
          // mismatch branch above for foreign finishHands.
          current.finishedExplicit = true;
          pushCurrent(i);
        }
      }
    }

    if (current) pushCurrent(table.frames.length - 1);

    // Classify lifecycle in one pass now that we know which hands were
    // superseded by a later startHand. Also assign handIndex. Every
    // hand here has a `startHand` (we never open implicitly anymore)
    // so the v1 "no startHand observed" branch is gone.
    hands.forEach((h, i) => {
      h.handIndex = i;
      if (h.finishedExplicit) {
        h.lifecycle = "finished";
      } else if (h.supersededByLater) {
        h.lifecycle = "incomplete";
      } else {
        h.lifecycle = "in-progress";
      }
      if (!h.handId) h.handId = `hand-${i + 1}`;
    });

    return hands;
  }

  // ------------------------------------------------- public surface

  root.CasinoTableize = {
    tableize,
    detectHands,
    AUTHORITATIVE_ACTIONS,
    cleanTitle
  };
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis));
