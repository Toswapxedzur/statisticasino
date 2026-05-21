// Bundles the unpacked Chrome extension at ../casinoMalwareExtension/
// into static/downloads/casino-inspector.zip so the Contribute page
// can serve a one-click "Download the extension" button.
//
// Wired into `npm run build` (prebuild step) so a fresh `npm run
// build` produces a fresh zip in lockstep with whatever extension
// state exists on disk.
//
// Run standalone with: node scripts/build-extension-zip.js
//
// Skipped behaviour: if the extension folder is missing, we log a
// warning and exit 0 so a server build that doesn't have the
// extension checked out doesn't fail. The Contribute page renders
// a "zip not built yet" notice in that case.

import { createWriteStream, existsSync, mkdirSync, statSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
// archiver v8 dropped the legacy `archiver("zip", opts)` factory in
// favour of named ESM exports. We instantiate the class directly.
import { ZipArchive } from "archiver";

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/ lives at <repo>/statisticasino/scripts/, the extension at
// <repo>/casinoMalwareExtension/. Two parent jumps.
const EXT_DIR  = resolve(__dirname, "..", "..", "casinoMalwareExtension");
const OUT_DIR  = resolve(__dirname, "..", "static", "downloads");
const OUT_PATH = resolve(OUT_DIR, "casino-inspector.zip");

// Don't ship the developer-only build artifacts inside the zip.
// `assets/build-icons.py` regenerates icons but isn't needed at
// runtime, .idea is JetBrains editor metadata, .DS_Store is macOS
// noise, .git is repo internals.
const EXCLUDE_PATTERNS = [
  /(^|\/)\.DS_Store$/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)\.idea(\/|$)/,
  /(^|\/)\.vscode(\/|$)/,
  /(^|\/)assets\/build-icons\.py$/,
  /(^|\/)build-icons\.py$/,
  // Captured-round dev reference; not needed at runtime and adds ~480 KB.
  /(^|\/)sampling\.txt$/
];

function shouldExclude(relPath) {
  return EXCLUDE_PATTERNS.some((re) => re.test(relPath));
}

async function main() {
  if (!existsSync(EXT_DIR)) {
    console.warn(
      `[build-extension-zip] ${EXT_DIR} not found; skipping. ` +
      `(Contribute page will render a "zip not built yet" notice.)`
    );
    return;
  }
  // Sanity-check we're zipping the right thing — manifest.json must
  // exist or this would just be a folder of random files.
  if (!existsSync(resolve(EXT_DIR, "manifest.json"))) {
    console.warn(
      `[build-extension-zip] ${EXT_DIR} has no manifest.json; refusing to zip.`
    );
    return;
  }

  if (!existsSync(OUT_DIR)) mkdirSync(OUT_DIR, { recursive: true });

  await new Promise((accept, reject) => {
    const out = createWriteStream(OUT_PATH);
    const archive = new ZipArchive({ zlib: { level: 9 } });
    out.on("close", () => accept());
    archive.on("warning", (e) => {
      if (e.code === "ENOENT") console.warn("[build-extension-zip]", e);
      else reject(e);
    });
    archive.on("error", reject);
    archive.pipe(out);

    // Walk the extension directory ourselves rather than using
    // archive.directory() so we can apply EXCLUDE_PATTERNS cleanly.
    // Files land under a top-level `casino-inspector/` folder inside
    // the zip so unzipping produces a single tidy folder rather than
    // splatting files into the user's Downloads.
    function walk(absDir, relInsideZip) {
      for (const entry of readdirSync(absDir, { withFileTypes: true })) {
        const abs = resolve(absDir, entry.name);
        const rel = relInsideZip ? `${relInsideZip}/${entry.name}` : entry.name;
        if (shouldExclude(rel)) continue;
        if (entry.isDirectory()) {
          walk(abs, rel);
        } else if (entry.isFile()) {
          archive.file(abs, { name: `casino-inspector/${rel}` });
        }
      }
    }
    walk(EXT_DIR, "");

    archive.finalize();
  });

  const size = statSync(OUT_PATH).size;
  console.log(
    `[build-extension-zip] wrote ${OUT_PATH} ` +
    `(${(size / 1024).toFixed(1)} KB)`
  );
}

main().catch((e) => {
  console.error("[build-extension-zip] FAILED:", e);
  process.exit(1);
});
