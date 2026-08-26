// Issue a signed OSS PUT URL for a direct browser upload. The client uploads the
// bytes to `uploadUrl`, then references `mediaId` (avatar -> profile, attachment
// -> chat message).
import { json, error } from "@sveltejs/kit";
import { createUpload } from "$lib/server/media.js";

export async function POST({ request, locals }) {
  if (!locals.user) throw error(401, "Sign in.");
  const { kind, mime, bytes } = await request.json();
  if (kind !== "avatar" && kind !== "attachment") throw error(400, "bad kind");
  const res = await createUpload({ uploaderId: locals.user.id, kind, mime, bytes: Number(bytes) });
  if (res.error) throw error(res.error === "media_unavailable" ? 503 : 400, res.error);
  return json(res);
}
