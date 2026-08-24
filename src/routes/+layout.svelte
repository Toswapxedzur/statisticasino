<script>
  import "../app.css";
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import { SITE_NAME } from "$lib/config.js";
  import { poker } from "$lib/poker/client.svelte.js";

  let { data, children } = $props();

  // Signed-in users keep a live socket app-wide so private messages (and presence)
  // arrive on any page, and the nav can badge unread DMs.
  $effect(() => { if (data.user) poker.connect(); });
  const dmUnread = $derived(poker.dmUnreadTotal);

  // Live chip balance for the topbar pill. Seeded from the SSR layout load
  // and re-synced on navigation, but also updated in real time from the
  // WebSocket client's "chips" window event (buy-in / cash-out / payout)
  // so the pill doesn't show a stale value between page loads.
  let chips = $state(data.chips ?? 0);
  $effect(() => { chips = data.chips ?? 0; });
  onMount(() => {
    const onChips = (e) => { if (typeof e.detail === "number") chips = e.detail; };
    window.addEventListener("chips", onChips);
    return () => window.removeEventListener("chips", onChips);
  });

  // Currently-active nav tab is matched by the URL prefix.
  function isActive(prefix) {
    const p = $page.url.pathname;
    if (prefix === "/") return p === "/";
    return p === prefix || p.startsWith(prefix + "/");
  }

  function fmtChips(n) {
    return Number(n).toLocaleString("en-US");
  }
</script>

<header class="topbar">
  <a class="brand" href="/"><span class="dot"></span> {SITE_NAME}</a>
  <nav class="nav-tabs" aria-label="Sections">
    <a class="nav-tab" href="/" aria-current={isActive("/") ? "page" : undefined}>Lobby</a>
    {#if data.user}<a class="nav-tab" href="/friends" aria-current={isActive("/friends") ? "page" : undefined}>Friends</a>{/if}
    {#if data.user}<a class="nav-tab" href="/messages" aria-current={isActive("/messages") ? "page" : undefined}>Messages{#if dmUnread > 0}<span class="nav-badge">{dmUnread}</span>{/if}</a>{/if}
    <a class="nav-tab" href="/data" aria-current={isActive("/data") ? "page" : undefined}>Data</a>
    <a class="nav-tab" href="/blog" aria-current={isActive("/blog") ? "page" : undefined}>Blog</a>
    <a class="nav-tab" href="/contribute" aria-current={isActive("/contribute") ? "page" : undefined}>Contribute</a>
  </nav>

  <div class="topbar-right">
    {#if data.user}
      <a class="chips-pill" href="/account" title="Your chips balance">
        <span class="chip-ico"></span>
        {fmtChips(chips)}
        {#if data.bonusReady}<span class="bonus-dot" title="Daily bonus ready"></span>{/if}
      </a>
      <a class="nav-tab" href="/account" aria-current={isActive("/account") ? "page" : undefined}>
        {data.user.displayName || data.user.email}
        {#if data.user.isAdmin}<span style="margin-left:4px;color:var(--hero)">admin</span>{/if}
      </a>
    {:else}
      <a class="nav-tab" href="/account/login" aria-current={isActive("/account") ? "page" : undefined}>Sign in</a>
      <a class="btn btn-sm" href="/account/signup">Sign up</a>
    {/if}
  </div>
</header>

<main>
  {@render children()}
</main>

{#if data.user && poker.myTables.length > 1}
  <div class="table-switcher" aria-label="Your tables">
    {#each poker.myTables as t (t.tableId)}
      <a class="tswitch" class:turn={t.myTurn} href={`/table/${t.tableId}`}>
        {t.name}{#if t.myTurn}<span class="turn-dot" title="Your turn"></span>{/if}
      </a>
    {/each}
  </div>
{/if}

<style>
  .table-switcher {
    position: fixed; right: 14px; bottom: 14px; z-index: 50;
    display: flex; flex-direction: column; gap: 6px; align-items: flex-end;
  }
  .tswitch {
    display: inline-flex; align-items: center; gap: 7px; padding: 7px 12px;
    background: rgba(20,22,30,0.92); border: 1px solid rgba(255,255,255,0.14);
    border-radius: 999px; color: #fff; text-decoration: none; font-size: 13px; font-weight: 600;
    box-shadow: 0 4px 14px rgba(0,0,0,0.35);
  }
  .tswitch.turn { border-color: #33d17a; box-shadow: 0 0 12px rgba(51,209,122,0.5); }
  .turn-dot { width: 8px; height: 8px; border-radius: 50%; background: #33d17a; animation: pulse 1.1s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }
  .nav-badge {
    display: inline-block; margin-left: 5px; min-width: 16px; padding: 0 5px;
    background: #e0483a; color: #fff; border-radius: 999px;
    font-size: 11px; font-weight: 700; line-height: 16px; text-align: center; vertical-align: middle;
  }
  .topbar-right {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-left: auto;
  }
  .chips-pill {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 5px 12px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--hero, #6c5ce7) 16%, transparent);
    border: 1px solid color-mix(in srgb, var(--hero, #6c5ce7) 40%, transparent);
    color: var(--text, #e8e8f0);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-decoration: none;
    font-size: 14px;
  }
  .chips-pill:hover { filter: brightness(1.1); }
  .chip-ico {
    width: 14px; height: 14px; border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #ffe08a, #f5b301 60%, #b8860b);
    box-shadow: 0 0 0 2px rgba(255,255,255,0.15) inset;
    display: inline-block;
  }
  .bonus-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: #33d17a; box-shadow: 0 0 6px #33d17a;
    display: inline-block;
  }
  .btn-sm { padding: 5px 12px; font-size: 13px; }
</style>
