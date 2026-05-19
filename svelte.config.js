import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Node adapter: we self-host (`node build`) rather than going through
    // Vercel's Node-compat layer, because the SQLite database is a local
    // file and we want stable filesystem access.
    adapter: adapter(),
    alias: {
      $lib: "src/lib"
    }
  }
};

export default config;
