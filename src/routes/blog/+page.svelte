<script>
  let { data } = $props();
  function fmt(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" });
  }
</script>

<section>
  <h1 style="margin:0 0 12px;font-size:22px">Investigations</h1>
  {#if data.posts.length === 0}
    <p class="muted">No posts yet. Drop a markdown file into <code>statisticasino/content/blog/</code>.</p>
  {:else}
    <ul class="blog-list">
      {#each data.posts as p (p.slug)}
        <li class="blog-card" class:pinned={p.pinned}>
          <a class="blog-title" href={`/blog/${p.slug}`}>{p.title}</a>
          {#if p.pinned}<span class="pin-tag" title="Pinned to the top">PINNED</span>{/if}
          {#if p.draft}<span class="draft-tag">DRAFT</span>{/if}
          <div class="blog-meta muted">{fmt(p.date)}</div>
          {#if p.description}
            <p class="blog-desc">{p.description}</p>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .blog-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
  .blog-card {
    padding: 14px 16px; background: var(--surface); border-radius: var(--r-card); box-shadow: var(--shadow-card);
    transition: background-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease), transform var(--dur) var(--ease);
  }
  .blog-card:hover { background: var(--surface-2); box-shadow: var(--shadow-hover); transform: translateY(-1px); }
  .blog-title { font-size: 17px; font-weight: 600; }
  .blog-meta { font-size: 12.5px; margin-top: 2px; }
  .blog-desc { margin: 6px 0 0; color: var(--text); }
  .draft-tag {
    display: inline-block;
    margin-left: 8px;
    font-size: 10.5px; font-weight: 700; letter-spacing: 0.4px;
    color: var(--muted); background: var(--well); padding: 1px 6px; border-radius: var(--r-pill);
  }
  .pin-tag {
    display: inline-block;
    margin-left: 8px;
    font-size: 10.5px; font-weight: 700; letter-spacing: 0.4px;
    color: var(--gold-ink); background: var(--gold-bg);
    padding: 1px 6px; border-radius: var(--r-pill);
  }
  .blog-card.pinned { background: var(--gold-bg); }
</style>
