// Upload form action.
//
// Accepts multipart/form-data with a `dump` file field. The file is
// either a `.casinodump` (base64 of gzipped JSON), a raw gzipped JSON
// container, or a plain JSON container — `decodeContainer` sniffs.

import { fail } from "@sveltejs/kit";
import { decodeContainer, ingestContainer } from "$lib/server/ingest.js";

const MAX_BYTES = 50 * 1024 * 1024;  // 50 MB hard cap on a single upload

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

    const summary = await ingestContainer(container, locals.user ? locals.user.id : null);
    return { summary };
  }
};
