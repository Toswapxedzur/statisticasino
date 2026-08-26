// Serve a media object by redirecting to a short-lived signed OSS URL. Avatars
// are public; attachments require a signed-in viewer (the 32-hex id is itself an
// unguessable capability shared only within a conversation).
import { redirect, error } from "@sveltejs/kit";
import { mediaRow, downloadUrl } from "$lib/server/media.js";

export async function GET({ params, locals }) {
  const row = await mediaRow(params.id);
  if (!row) throw error(404, "Not found.");
  if (row.kind !== "avatar" && !locals.user) throw error(401, "Sign in.");
  const url = downloadUrl(row);
  if (!url) throw error(503, "Media unavailable.");
  throw redirect(302, url);
}
