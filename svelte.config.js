import adapter from "@sveltejs/adapter-node";
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

const config = {
  preprocess: vitePreprocess(),
  kit: {
    // Node adapter: we self-host (`node build`) rather than going through
    // Vercel's Node-compat layer; the database is on Aliyun RDS and the
    // app process needs persistent network access to it, but no edge
    // runtime constraints.
    adapter: adapter(),
    alias: {
      $lib: "src/lib"
    },
    // The Chrome extension's service worker calls /api/flush from a
    // `chrome-extension://...` origin, which SvelteKit's CSRF check
    // would otherwise reject. The endpoint is anonymous-write by design
    // (the body is a gzipped game capture; no sensitive cookies are
    // sent or honoured) so this is safe. If you ever want
    // cookie-authenticated POSTs, narrow this back to a path-scoped
    // override and re-enable the global check.
    csrf: { checkOrigin: false }
  }
};

export default config;
