import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  // better-sqlite3 ships native bindings; keep it out of Vite's prebundling
  // so it's resolved at runtime against the platform's actual binary.
  optimizeDeps: { exclude: ["better-sqlite3"] },
  ssr: { external: ["better-sqlite3"] },
  server: { port: 5173 }
});
