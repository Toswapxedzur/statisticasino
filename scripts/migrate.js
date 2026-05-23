// Standalone migration entry point. Run with `npm run migrate`.
//
// For first-install / CI; the dev server also auto-migrates on every
// boot via hooks.server.js so manual runs are rarely needed.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), ".env");
if (existsSync(envPath)) {
  const text = readFileSync(envPath, "utf8");
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2];
  }
}

const { ensureMigrated, shutdown } = await import("../src/lib/server/migrate.js");

await ensureMigrated();
console.log("[statisticasino] migrations applied");

await shutdown();
