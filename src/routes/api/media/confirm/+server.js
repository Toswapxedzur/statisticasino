// Mark an uploaded object as ready (the client calls this after the PUT succeeds).
import { json, error } from "@sveltejs/kit";
import { confirmUpload } from "$lib/server/media.js";

export async function POST({ request, locals }) {
  if (!locals.user) throw error(401, "Sign in.");
  const { mediaId } = await request.json();
  if (!mediaId) throw error(400, "no media");
  await confirmUpload(mediaId, locals.user.id);
  return json({ ok: true });
}
