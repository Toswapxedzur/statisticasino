<script>
  import "../app.css";
  import { page } from "$app/stores";

  let { data, children } = $props();

  // Currently-active nav tab is matched by the URL prefix.
  function isActive(prefix) {
    const p = $page.url.pathname;
    if (prefix === "/") return p === "/";
    return p === prefix || p.startsWith(prefix + "/");
  }
</script>

<header class="topbar">
  <a class="brand" href="/"><span class="dot"></span> Statisticasino</a>
  <nav class="nav-tabs" aria-label="Sections">
    <a class="nav-tab" href="/data" aria-current={isActive("/data") ? "page" : undefined}>Data</a>
    <a class="nav-tab" href="/blog" aria-current={isActive("/blog") ? "page" : undefined}>Blog</a>
    <a class="nav-tab" href="/upload" aria-current={isActive("/upload") ? "page" : undefined}>Upload</a>
    {#if data.user}
      <a class="nav-tab" href="/account" aria-current={isActive("/account") ? "page" : undefined}>
        {data.user.displayName || data.user.email}
        {#if data.user.isAdmin}<span style="margin-left:4px;color:var(--hero)">admin</span>{/if}
      </a>
    {:else}
      <a class="nav-tab" href="/account/login" aria-current={isActive("/account") ? "page" : undefined}>Sign in</a>
    {/if}
  </nav>
  <span class="status-pill">{data.handCount} hand{data.handCount === 1 ? "" : "s"}</span>
</header>

<main>
  {@render children()}
</main>
