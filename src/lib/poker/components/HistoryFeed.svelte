<script>
  // Renders a unified activity feed (from activity.js recentActivity). Events
  // that involve another player (transfers, new friendships) carry a `ref`
  // user id, so those rows link to that player's profile.
  import { fly } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";
  let { events = [] } = $props();

  const fmt = (n) => Number(n).toLocaleString();
  function when(ts) {
    const dt = new Date(ts), now = new Date();
    const diff = now - dt, day = 86400000;
    if (diff < 60000) return "just now";
    if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
    if (dt.toDateString() === now.toDateString()) return dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (diff < 7 * day) return dt.toLocaleDateString([], { weekday: "short" }) + " " + dt.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    return dt.toLocaleDateString([], { month: "short", day: "numeric" });
  }
</script>

<div class="feed">
  {#each events as e, i (e.type + e.ts + (e.ref || "") + i)}
    <svelte:element this={e.ref ? "a" : "div"} href={e.ref ? `/u/${e.ref}` : undefined}
      class="ev card" class:linky={!!e.ref}
      in:fly={{ y: d(8), duration: d(DUR.base), delay: d(Math.min(i, 12) * 22) }}>
      <span class="ev-icon">{e.icon}</span>
      <span class="ev-main">
        <span class="ev-label">{e.label}</span>
        {#if e.sub}<span class="ev-sub">{e.sub}</span>{/if}
      </span>
      {#if e.type === "money"}
        <span class="ev-amt" class:pos={e.amount >= 0} class:neg={e.amount < 0}>{e.amount >= 0 ? "+" : ""}{fmt(e.amount)}</span>
      {/if}
      <span class="ev-time">{when(e.ts)}</span>
    </svelte:element>
  {/each}
</div>

<style>
  .feed { display: flex; flex-direction: column; gap: 8px; }
  .ev { display: flex; align-items: center; gap: 13px; margin-bottom: 0; padding: 13px 16px; text-decoration: none; color: inherit;
    transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
  .ev.linky { cursor: pointer; }
  .ev.linky:hover { transform: translateY(-2px); box-shadow: var(--shadow-hover); text-decoration: none; }
  .ev-icon { font-size: 20px; width: 34px; height: 34px; display: grid; place-items: center; background: var(--well); border-radius: 50%; flex: 0 0 auto; }
  .ev-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .ev-label { font-weight: 600; font-size: 14px; }
  .ev-sub { font-size: 12px; color: var(--muted); }
  .ev-amt { font-weight: 800; font-variant-numeric: tabular-nums; font-size: 14px; flex: 0 0 auto; }
  .ev-amt.pos { color: var(--ok); } .ev-amt.neg { color: var(--danger); }
  .ev-time { color: var(--faint); font-size: 11.5px; flex: 0 0 auto; min-width: 58px; text-align: right; }
</style>
