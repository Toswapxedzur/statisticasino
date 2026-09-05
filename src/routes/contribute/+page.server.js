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
import { verifyAdminFlushToken } from "$lib/server/auth.js";
import { ownerOnly } from "$lib/server/owner-only.js";

const MAX_BYTES = 50 * 1024 * 1024;  // 50 MB hard cap on a single upload

// In production (adapter-node) the file is served from
// `build/client/downloads/`; in `npm run dev` it's served from
// `static/downloads/`. We stat whichever exists so the cache-busting
// query param in the rendered link matches the bytes the client
// will actually download.
const ZIP_REL_CANDIDATES = [
  "build/client/downloads/casino-inspector.zip",
  "static/downloads/casino-inspector.zip"
];

function readZipMeta() {
  for (const rel of ZIP_REL_CANDIDATES) {
    const abs = resolve(process.cwd(), rel);
    if (!existsSync(abs)) continue;
    try {
      const s = statSync(abs);
      return { sizeBytes: s.size, mtime: s.mtimeMs };
    } catch {
      // fall through to next candidate
    }
  }
  return null;
}

export async function load({ locals }) {
  ownerOnly(locals);
  return {
    user: locals.user,
    extensionZip: readZipMeta()
  };
}

export const actions = {
  default: async ({ request, locals }) => {
    ownerOnly(locals);
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
    // Admins get permission to ingest generic captures (no
    // perspective). Two ways to assert admin here:
    //   a) Signed-in admin (cookie): server-authoritative
    //      `locals.user.isAdmin`, can't be faked client-side.
    //   b) Embedded flush token: when the extension exports a
    //      .casinodump it bakes in `container.adminToken`. The
    //      operator can re-upload the same file via this form
    //      without signing in and still get generic privileges.
    //      Comparison is timing-safe against the server's
    //      HARDCODED_ADMIN_FLUSH_TOKEN.
    const cookieAdmin = !!(locals.user && locals.user.isAdmin);
    const tokenAuth = verifyAdminFlushToken(container.adminToken);
    const isAdmin = cookieAdmin || tokenAuth === "accepted";
    if ("adminToken" in container) delete container.adminToken;

    const summary = await ingestContainer(
      container,
      locals.user ? locals.user.id : null,
      { isAdmin }
    );
    summary.adminAuth = cookieAdmin ? "accepted" : tokenAuth;
    return { summary };
  }
};
