import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [sveltekit()],
  // mysql2 is a pure-JS driver, no native bits to externalise.
  // Default Vite port (5173) collides with the user's other local
  // service. 5273 is well outside the common dev-port band; strictPort
  // makes Vite fail fast instead of silently jumping to 5274/5275 if
  // it's ever taken — which would defeat the point of pinning it.
  server: { port: 5273, strictPort: true }
});
