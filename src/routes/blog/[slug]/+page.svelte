<script>
  let { data } = $props();
  function fmt(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
  }
</script>

<article class="post">
  <a href="/blog" class="muted" style="font-size:12.5px">\u2190 Back to all posts</a>
  <h1>{data.post.title}</h1>
  <div class="muted post-meta">{fmt(data.post.date)}{#if data.post.draft} \u00b7 draft{/if}</div>
  <div class="post-body">
    {@html data.post.html}
  </div>
</article>

<style>
  .post { max-width: 760px; margin: 0 auto; }
  .post h1 { margin: 16px 0 6px; font-size: 28px; }
  .post-meta { font-size: 12.5px; margin-bottom: 18px; }
  .post-body :global(h2) { margin-top: 28px; font-size: 20px; }
  .post-body :global(h3) { margin-top: 22px; font-size: 16px; }
  .post-body :global(p), .post-body :global(li) { line-height: 1.6; }
  .post-body :global(code) {
    background: var(--well);
    padding: 1px 5px; border-radius: 4px;
    font-family: ui-monospace, Menlo, monospace; font-size: 12.5px;
  }
  .post-body :global(pre) {
    background: var(--well); box-shadow: var(--shadow-card);
    padding: 12px; border-radius: var(--r-btn); overflow-x: auto;
  }
  .post-body :global(pre code) { background: transparent; padding: 0; }
  .post-body :global(a) { color: var(--accent-ink); }
  .post-body :global(blockquote) {
    box-shadow: inset 3px 0 0 var(--accent);
    background: var(--accent-soft); border-radius: var(--r-btn);
    margin: 12px 0; padding: 8px 12px;
    color: var(--muted);
  }

  /* Markdown tables (used for contingency tables, summary tables, etc.) */
  .post-body :global(table) {
    border-spacing: 0 4px;
    margin: 14px 0;
    font-size: 13.5px;
    overflow-x: auto;
    display: block;
    max-width: 100%;
  }
  .post-body :global(thead) {
    background: var(--surface);
  }
  .post-body :global(th), .post-body :global(td) {
    background: var(--well);
    padding: 6px 10px;
    text-align: left;
    vertical-align: top;
  }
  .post-body :global(tbody tr:nth-child(even)) {
    background: var(--surface-2);
  }

  /* KaTeX math: inherit the post text color (KaTeX defaults to black) and
     fit the rendered glyphs into our line-height without disrupting prose. */
  .post-body :global(.katex) {
    color: var(--text);
    font-size: 1.02em;
  }
  .post-body :global(.katex-display) {
    margin: 14px 0;
    overflow-x: auto;
    overflow-y: hidden;
    padding: 4px 0;
  }
  .post-body :global(.katex-display > .katex) {
    white-space: nowrap;
  }
</style>
