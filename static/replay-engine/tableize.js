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
//     tableId, handId,                            // handId may be null
//     handIndex,                                  // 0-based, oldest first
//                                                 // within this table
//     firstTs, lastTs,
//     actionCount,
//     startFrameIdx, endFrameIdx,                 // indices into table.frames
//     startedFromStartHand,                       // saw a `startHand`
//     finishedExplicit,                           // saw a `finishHand`
//     supersededByLater,                          // a later `startHand`
//                                                 // appeared without our
//                                                 // own finishHand
//     lifecycle: "finished" | "in-progress" | "incomplete"
//     frames: [...]                                // slice of table.frames
//                                                 //   between [start..end]
//   }
//
// Lifecycle rule (per the user's spec — see chat 2026-05-18):
//   - finished     iff finishedExplicit
//   - incomplete   iff !finishedExplicit && (!startedFromStartHand
//                                            || supersededByLater)
//   - in-progress  iff !finishedExplicit && startedFromStartHand
//                                        && !supersededByLater
//                  (i.e. it's the most-recent open hand and no later
//                  startHand has appeared yet — bytes may still arrive)
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
      if (m.pageTitle) addName(bucket, m.pageTitle);
      // pageUrl: latest non-null wins so the dropdown links to the most
      // recent location of the table (URLs sometimes drift even when the
      // numeric id stays stable).
      if (m.pageUrl) bucket.pageUrl = m.pageUrl;
      if (m.pageTitle) bucket.pageTitle = m.pageTitle;

      collectHandIds(payload, bucket.handIds);
      bucket.frames.push({ ts, event, payload });
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
  // The lifecycle rule (see file header) is the structural one the user
  // specified: a hand is `finished` only if its OWN `finishHand` is
  // present in the captured frames; otherwise it's `incomplete` if any
  // later `startHand` has supplanted it (or it never had a `startHand`
  // of its own), else `in-progress` (might still receive its close).
  function detectHands(table) {
    if (!table || !Array.isArray(table.frames) || table.frames.length === 0) {
      return [];
    }

    const hands = [];
    let current = null;

    function pushCurrent(endIdx) {
      if (!current) return;
      current.endFrameIdx = endIdx;
      current.frames = table.frames.slice(current.startFrameIdx, endIdx + 1);
      hands.push(current);
      current = null;
    }

    function startHandRec(idx, handId, ts, fromStartHand) {
      // Closing the prior open hand: if it never saw its own
      // finishHand, the new startHand has supplanted it. Mark it so
      // classify() can downgrade in-progress -> incomplete.
      if (current && !current.finishedExplicit) {
        current.supersededByLater = true;
      }
      if (current) pushCurrent(idx - 1 >= current.startFrameIdx ? idx - 1 : current.startFrameIdx);
      current = {
        tableId: table.tableId,
        handId: handId ? String(handId) : null,
        firstTs: ts,
        lastTs: ts,
        actionCount: fromStartHand ? 1 : 0,
        startFrameIdx: idx,
        endFrameIdx: idx,
        startedFromStartHand: !!fromStartHand,
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
        const updateHandId = u.handId ?? u.hand_id ?? frameHandId ?? null;

        if (action === "startHand") {
          startHandRec(i, updateHandId, f.ts, true);
          continue;
        }

        if (!AUTHORITATIVE_ACTIONS.has(action)) continue;

        // No open hand AND this isn't a startHand -> recording started
        // mid-hand. Open an implicit hand; classifier will mark it
        // incomplete because startedFromStartHand stays false.
        if (!current) {
          startHandRec(i, updateHandId, f.ts, false);
        }
        current.lastTs = f.ts;
        current.endFrameIdx = i;
        current.actionCount++;
        if (!current.handId && updateHandId) current.handId = String(updateHandId);

        if (action === "finishHand") {
          current.finishedExplicit = true;
          pushCurrent(i);
        }
      }
    }

    if (current) pushCurrent(table.frames.length - 1);

    // Classify lifecycle in one pass now that we know which hands were
    // superseded by a later startHand. Also assign handIndex.
    hands.forEach((h, i) => {
      h.handIndex = i;
      if (h.finishedExplicit) {
        h.lifecycle = "finished";
      } else if (!h.startedFromStartHand || h.supersededByLater) {
        h.lifecycle = "incomplete";
      } else {
        h.lifecycle = "in-progress";
      }
      // Stable key fallback if no server hand id ever surfaced.
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
