// Resolve numeric user/seat IDs to human display names by scraping every
// captured payload that we know carries a `{id, username}` pair. The
// extension already saves:
//   - fetch/xhr responseBody.data  → typically JSON from /api/v2/users
//   - ws output frames             → contain seats/players arrays with userId
//   - lobby RSC blobs              → arrays like `seats:[{id, username, ...}]`
//
// We do a best-effort regex+JSON sweep over each entry's string fields. This
// keeps us robust against the many shapes seen on Replay Poker / casino.org
// without forcing the renderer to know how each endpoint is structured.
//
// Public API:
//   CasinoUsers.buildIndex(messages)        -> Map<userId, { username, avatar? }>
//   CasinoUsers.nameFor(index, userId)      -> "username" | "User 123" fallback
//   CasinoUsers.augmentSeat(index, seat)    -> { ...seat, username, avatar }
//
// Loaded as a classic script that hangs `window.CasinoUsers`.

(function (root) {
  // Conservative substring guard so we don't try to JSON.parse a 2 MB blob
  // when there's no chance of a user object inside.
  function looksLikeUserBlob(s) {
    if (typeof s !== "string" || s.length === 0) return false;
    // Cheap pre-check — every Replay Poker user object includes the literal
    // "username" key. Lobby payloads also include "seats" or "players" with
    // numeric `id` and string `username`.
    return s.indexOf("username") !== -1;
  }

  function tryParseJson(s) {
    try { return JSON.parse(s); } catch { return null; }
  }

  // ----------------------------------------------------------- recursive walk
  //
  // Visit every object/array in a parsed payload, looking for nodes that
  // look like a user record. A "user record" is any object with both a
  // numeric `id` and a string `username` — or a numeric `userId` and a
  // string `username` (which is the shape on seats/players).
  function walk(node, sink) {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const child of node) walk(child, sink);
      return;
    }
    if (typeof node !== "object") return;

    const idCandidate = node.id ?? node.userId ?? node.user_id;
    const name = typeof node.username === "string" ? node.username
               : typeof node.userName === "string" ? node.userName
               : typeof node.screen_name === "string" ? node.screen_name
               : typeof node.displayName === "string" ? node.displayName
               : null;

    if (name && (typeof idCandidate === "number" || /^\d+$/.test(String(idCandidate || "")))) {
      const id = Number(idCandidate);
      if (Number.isFinite(id) && id > 0) {
        const prev = sink.get(id);
        if (!prev || (!prev.avatar && typeof node.avatar === "string")) {
          sink.set(id, {
            username: name,
            avatar: typeof node.avatar === "string" ? node.avatar : (prev && prev.avatar) || null,
            country: (node.country && node.country.name) || (prev && prev.country) || null
          });
        }
      }
    }

    for (const k in node) {
      const v = node[k];
      if (v && typeof v === "object") walk(v, sink);
    }
  }

  // Lobby payloads arrive inside Next.js RSC chunks, e.g.
  //   `7:["$","$L12",null,{"lobbyData":{"rings":[{"seats":[{"id":..."username":"..."}]}]}}]`
  // We try a direct JSON.parse first; if that fails we hunt for embedded
  // JSON objects/arrays that contain `"username"`.
  function harvestFromString(s, sink) {
    if (!looksLikeUserBlob(s)) return;

    // Direct JSON parse path (most /api/v2/users responses).
    const parsed = tryParseJson(s);
    if (parsed) {
      walk(parsed, sink);
      return;
    }

    // RSC payload — scan for `{...}` and `[...]` chunks containing
    // "username". Cheap heuristic: find every literal `"username":"` and
    // expand outward to a JSON-ish boundary.
    const re = /"username"\s*:\s*"/g;
    let m;
    while ((m = re.exec(s)) !== null) {
      const start = findObjectStart(s, m.index);
      if (start < 0) continue;
      const end = findObjectEnd(s, start);
      if (end <= start) continue;
      const chunk = s.slice(start, end + 1);
      const parsedChunk = tryParseJson(chunk);
      if (parsedChunk) walk(parsedChunk, sink);
      re.lastIndex = end + 1;
    }
  }

  // Walk backwards from `i` to the nearest `{` that opens the enclosing
  // object. We don't try to be perfect about quoted braces — the parser
  // will catch malformed chunks and we just skip them.
  function findObjectStart(s, i) {
    let depth = 0;
    for (let k = i; k >= 0; k--) {
      const c = s.charCodeAt(k);
      if (c === 125 /* } */) depth++;
      else if (c === 123 /* { */) {
        if (depth === 0) return k;
        depth--;
      }
    }
    return -1;
  }

  // Forward walk to the matching `}`. Naive depth counter; quoted braces
  // are rare in these payloads and tryParseJson will discard misreads.
  function findObjectEnd(s, start) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let k = start; k < s.length; k++) {
      const ch = s[k];
      if (inStr) {
        if (esc) { esc = false; continue; }
        if (ch === "\\") { esc = true; continue; }
        if (ch === "\"") inStr = false;
        continue;
      }
      if (ch === "\"") { inStr = true; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return k;
      }
    }
    return -1;
  }

  // ---------------------------------------------------------- entry handlers

  // Most stored entries have one of these string fields we can scan.
  //   - fetch/xhr:  entry.responseBody.data
  //   - postmessage / sse: entry.data.data
  //   - ws:         entry.data.data
  function extractScannableStrings(entry) {
    const out = [];
    if (!entry) return out;
    const rb = entry.responseBody;
    if (rb && typeof rb.data === "string") out.push(rb.data);
    const dt = entry.data;
    if (dt && typeof dt === "object" && typeof dt.data === "string") out.push(dt.data);
    else if (typeof dt === "string") out.push(dt);
    return out;
  }

  function buildIndex(messages) {
    const sink = new Map();
    if (!Array.isArray(messages)) return sink;
    for (const m of messages) {
      const strings = extractScannableStrings(m);
      for (const s of strings) harvestFromString(s, sink);
    }
    return sink;
  }

  // Add the same scan to a pageData[] snapshot if you want; the page tables
  // already render usernames as plain text so it's optional.
  function ingestPageData(rows, sink) {
    if (!Array.isArray(rows)) return;
    for (const r of rows) walk(r, sink);
  }

  function nameFor(index, userId) {
    if (userId == null) return null;
    const id = Number(userId);
    if (!Number.isFinite(id) || id <= 0) return null;
    const hit = index && index.get && index.get(id);
    if (hit && hit.username) return hit.username;
    return `User ${id}`;
  }

  function avatarFor(index, userId) {
    if (userId == null) return null;
    const id = Number(userId);
    const hit = index && index.get && index.get(id);
    return (hit && hit.avatar) || null;
  }

  function augmentSeat(index, seat) {
    if (!seat) return seat;
    const username = nameFor(index, seat.userId);
    const avatar = avatarFor(index, seat.userId);
    return Object.assign({}, seat, { username, avatar });
  }

  root.CasinoUsers = {
    buildIndex,
    ingestPageData,
    nameFor,
    avatarFor,
    augmentSeat
  };
})(typeof self !== "undefined" ? self : (typeof window !== "undefined" ? window : globalThis));
