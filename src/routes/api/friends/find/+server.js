// Live friend-finding for the Social "Find" tab. q >= 2 chars -> trigram search;
// otherwise -> recommendations (recent teammates + friends-of-friends). Each
// result is tagged with the viewer's relationship so the UI shows the right action.
import { json, error } from "@sveltejs/kit";
import { searchByTrigram, recommendFriends } from "$lib/server/friend-search.js";
import { query } from "$lib/server/db.js";

async function tagRelationships(viewerId, results) {
  const ids = results.map((r) => r.id);
  if (!ids.length) return results;
  const ph = ids.map(() => "?").join(",");
  const edges = await query(
    `SELECT requester_id, addressee_id, status FROM friendship
      WHERE (requester_id = ? AND addressee_id IN (${ph}))
         OR (addressee_id = ? AND requester_id IN (${ph}))`,
    [viewerId, ...ids, viewerId, ...ids]
  );
  const rel = new Map();
  for (const e of edges) {
    const other = e.requester_id === viewerId ? e.addressee_id : e.requester_id;
    rel.set(other, e.status === "accepted" ? "friends" : (e.requester_id === viewerId ? "outgoing" : "incoming"));
  }
  return results.map((r) => ({ ...r, relationship: rel.get(r.id) || "none" }));
}

export async function GET({ url, locals }) {
  if (!locals.user) throw error(401, "Sign in.");
  const q = String(url.searchParams.get("q") || "").trim();
  const results = q.length >= 2
    ? await searchByTrigram(q, 15, locals.user.id)
    : await recommendFriends(locals.user.id, 12);
  return json({ mode: q.length >= 2 ? "search" : "recommend", results: await tagRelationships(locals.user.id, results) });
}
