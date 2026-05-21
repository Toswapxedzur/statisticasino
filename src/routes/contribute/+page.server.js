// /contribute (formerly /upload, renamed 2026-05-21).
//
// Per spec:
//
//   * Anyone (signed-in or anonymous) can upload data through this
//     page.
//   * Generic uploads (no detectable perspective — pure spectator
//     captures) are accepted IFF the uploader is an admin; they land
//     under the synthetic [Generic] player node. Non-admin generic
//     uploads still get `summary.rejectedGeneric` per v2 contract.
//
// `/api/flush` (the Chrome extension's autoflush channel) was always
// anonymous and stays that way; admin-only generic ingest is a
// /contribute-only privilege.
//
// We additionally surface a "Contribute Data" walkthrough that points
// to a downloadable .zip of the unpacked Chrome extension; the file
// is generated at build time by scripts/build-extension-zip.js into
// static/downloads/.

import { fail } from "@sveltejs/kit";
import { existsSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { decodeContainer, ingestContainer } from "$lib/server/ingest.js";

const MAX_BYTES = 50 * 1024 * 1024;  // 50 MB hard cap on a single upload

// Resolved at module-load time; SvelteKit re-imports the route on
// every dev-server change anyway, so the cached value stays fresh.
const ZIP_REL_PATH = "static/downloads/casino-inspector.zip";

function readZipMeta() {
  const abs = resolve(process.cwd(), ZIP_REL_PATH);
  if (!existsSync(abs)) return null;
  try {
    const s = statSync(abs);
    return { sizeBytes: s.size, mtime: s.mtimeMs };
  } catch {
    return null;
  }
}

export async function load({ locals }) {
  return {
    user: locals.user,
    extensionZip: readZipMeta()
  };
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
    //
    // Admins additionally get permission to ingest generic captures
    // (no perspective). isAdmin is read from the (server-authoritative)
    // session so a non-admin can't fake the privilege from the client.
    const isAdmin = !!(locals.user && locals.user.isAdmin);
    const summary = await ingestContainer(
      container,
      locals.user ? locals.user.id : null,
      { isAdmin }
    );
    return { summary };
  }
};
