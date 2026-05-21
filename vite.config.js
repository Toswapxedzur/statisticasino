import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  // better-sqlite3 ships native bindings; keep it out of Vite's prebundling
  // so it's resolved at runtime against the platform's actual binary.
  optimizeDeps: { exclude: ["better-sqlite3"] },
  ssr: { external: ["better-sqlite3"] },
  // Default Vite port (5173) collides with the user's other local
  // service. 5273 is well outside the common dev-port band; strictPort
  // makes Vite fail fast instead of silently jumping to 5274/5275 if
  // it's ever taken — which would defeat the point of pinning it.
  server: { port: 5273, strictPort: true }
});
