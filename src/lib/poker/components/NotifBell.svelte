<script>
  // Topbar notification bell: unread count + a dropdown of the recent activity
  // feed (friend requests/accepts, chip transfers, missed messages). Opening the
  // panel marks everything read. Clicking an item routes to the right place.
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { fly } from "svelte/transition";
  import { poker } from "$lib/poker/client.svelte.js";
  import { d, DUR } from "$lib/motion.js";

  let open = $state(false);
  let root;

  const items = $derived(poker.notifications || []);
  const unread = $derived(poker.notifUnread || 0);

  const ICON = { friend_request: "👋", friend_accept: "✅", transfer: "💸", message: "💬" };

  function toggle() {
    open = !open;
    if (open && unread > 0) poker.markNotifsRead(); // opening clears the badge
  }

  function rel(ts) {
    const s = Math.max(0, (Date.now() - Number(ts)) / 1000);
    if (s < 60) return "just now";
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
    return `${Math.floor(s / 86400)}d ago`;
  }

  function dest(n) {
    if (n.kind === "message") return "/social";
    if (n.kind === "transfer") return n.actorId ? `/u/${n.actorId}` : "/account";
    if (n.kind === "friend_accept") return n.actorId ? `/u/${n.actorId}` : "/social";
    return "/social"; // friend_request → requests live on Social
  }

  function pick(n) {
    open = false;
    goto(dest(n));
  }

  onMount(() => {
    const onDoc = (e) => { if (open && root && !root.contains(e.target)) open = false; };
    const onKey = (e) => { if (e.key === "Escape") open = false; };
    document.addEventListener("click", onDoc, true);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("click", onDoc, true); document.removeEventListener("keydown", onKey); };
  });
</script>

<div class="bell-wrap" bind:this={root}>
  <button class="bell" class:has={unread > 0} aria-label="Notifications" onclick={toggle}>
    <span class="ico">🔔</span>
    {#if unread > 0}<span class="dot">{unread > 9 ? "9+" : unread}</span>{/if}
  </button>

  {#if open}
    <div class="panel" transition:fly={{ y: d(-8), duration: d(DUR.base) }}>
      <div class="head">
        <span>Notifications</span>
        {#if items.length > 0}<button class="clear" onclick={() => poker.markNotifsRead()}>Mark all read</button>{/if}
      </div>
      {#if items.length === 0}
        <div class="empty">You're all caught up.</div>
      {:else}
        <div class="list">
          {#each items as n (n.id)}
            <button class="row" class:unread={!n.readAt} onclick={() => pick(n)}>
              <span class="kico">{ICON[n.kind] || "•"}</span>
              <span class="body">
                <span class="text">{n.body}</span>
                <span class="time">{rel(n.createdAt)}</span>
              </span>
            </button>
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .bell-wrap { position: relative; display: inline-flex; }
  .bell {
    position: relative; width: 34px; height: 34px; border: 0; border-radius: var(--r-pill);
    background: var(--well); color: var(--muted); cursor: pointer; font-size: 15px;
    display: grid; place-items: center;
    transition: color var(--dur) var(--ease), background-color var(--dur) var(--ease), transform var(--dur) var(--ease);
  }
  .bell:hover { color: var(--text); background: var(--surface-2); transform: translateY(-1px); }
  .bell.has { color: var(--text); }
  .dot {
    position: absolute; top: -3px; right: -3px; min-width: 16px; height: 16px; padding: 0 4px;
    background: var(--danger); color: #fff; border-radius: var(--r-pill);
    font-size: 10px; font-weight: 800; line-height: 16px; text-align: center;
  }
  .panel {
    position: absolute; top: 42px; right: 0; z-index: 60; width: 320px; max-width: 86vw;
    background: var(--surface); border-radius: var(--r-card); box-shadow: var(--shadow-panel);
    overflow: hidden;
  }
  .head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 14px; font-weight: 700; font-size: 13px; color: var(--text);
  }
  .clear { border: 0; background: transparent; color: var(--accent-ink); font-size: 12px; font-weight: 600; cursor: pointer; }
  .clear:hover { opacity: .75; }
  .empty { padding: 26px 16px; text-align: center; color: var(--muted); font-size: 13px; }
  .list { max-height: 380px; overflow-y: auto; display: flex; flex-direction: column; padding: 4px; gap: 2px; }
  .row {
    display: flex; align-items: flex-start; gap: 10px; width: 100%; text-align: left;
    border: 0; background: transparent; cursor: pointer; padding: 9px 10px; border-radius: var(--r-btn);
    transition: background-color var(--dur) var(--ease);
  }
  .row:hover { background: var(--well); }
  .row.unread { background: var(--accent-soft); }
  .row.unread:hover { background: var(--accent-soft); filter: brightness(1.05); }
  .kico { flex: 0 0 auto; font-size: 16px; line-height: 1.3; }
  .body { display: flex; flex-direction: column; min-width: 0; gap: 2px; }
  .text { color: var(--text); font-size: 13px; line-height: 1.35; }
  .time { color: var(--muted); font-size: 11px; }
</style>
