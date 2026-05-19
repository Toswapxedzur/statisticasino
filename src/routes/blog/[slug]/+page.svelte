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
    background: var(--bg); border: 1px solid var(--border);
    padding: 1px 5px; border-radius: 4px;
    font-family: ui-monospace, Menlo, monospace; font-size: 12.5px;
  }
  .post-body :global(pre) {
    background: var(--bg); border: 1px solid var(--border);
    padding: 12px; border-radius: 8px; overflow-x: auto;
  }
  .post-body :global(pre code) { background: transparent; border: 0; padding: 0; }
  .post-body :global(a) { color: var(--accent); }
  .post-body :global(blockquote) {
    border-left: 3px solid var(--accent-strong);
    margin: 12px 0; padding: 4px 12px;
    color: var(--muted);
  }
</style>
