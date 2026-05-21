// Upload form action (v2).
//
// Per spec 2026-05-21:
//
//   * Anyone (signed-in or anonymous) can upload data through /upload.
//   * Uploads with no detectable perspective ("generic" — pure
//     spectator captures) are rejected by ingest. The form surfaces
//     `summary.rejectedGeneric` so the user sees why nothing landed.
//
// `/api/flush` (the Chrome extension's autoflush channel) was always
// anonymous and stays that way.

import { fail } from "@sveltejs/kit";
import { decodeContainer, ingestContainer } from "$lib/server/ingest.js";

const MAX_BYTES = 50 * 1024 * 1024;  // 50 MB hard cap on a single upload

export async function load({ locals }) {
  return { user: locals.user };
}

export const actions = {
  default: async ({ request, locals }) => {
    const data = await request.formData().catch(() => null);
    if (!data) return fail(400, { error: "Could not parse form data." });

    const file = data.get("dump");
    if (!file || typeof file === "string") {
      return fail(400, { error: "Choose a dump file." });
    }
    if (file.size > MAX_BYTES) {
      return fail(413, { error: `File is too large (max ${MAX_BYTES / 1024 / 1024} MB).` });
    }

    const buf = Buffer.from(await file.arrayBuffer());

    let container;
    try {
      container = await decodeContainer(buf);
    } catch (e) {
      return fail(400, { error: `Couldn't decode the dump: ${e.message || e}` });
    }
    if (!container || !Array.isArray(container.hands)) {
      return fail(400, { error: "Dump does not contain a hands[] array." });
    }

    // Anonymous uploads are allowed — `userId` is null when there's
    // no logged-in user. The casino-side "playername" tree node
    // is derived from the dump's userIndex, NOT from this account.
    const summary = await ingestContainer(container, locals.user ? locals.user.id : null);
    return { summary };
  }
};
