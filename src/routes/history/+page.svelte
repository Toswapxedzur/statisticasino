<script>
  import { goto } from "$app/navigation";
  import { fly } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";
  import { slidingIndicator } from "$lib/actions/slider.js";
  let { data } = $props();

  const FILTERS = [
    { key: "all", label: "All" },
    { key: "money", label: "Chips" },
    { key: "achievements", label: "Achievements" },
    { key: "friends", label: "Friends" },
  ];
  function setFilter(k) { goto(`/history?filter=${k}`, { keepFocus: true, noScroll: true }); }
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

<svelte:head><title>History — Riverside</title></svelte:head>

<div class="wrap">
  <div class="head">
    <h1>Your history</h1>
    <div class="filters slider" use:slidingIndicator>
      {#each FILTERS as f}
        <button class="fbtn" class:on={data.filter === f.key} onclick={() => setFilter(f.key)}>{f.label}</button>
      {/each}
    </div>
  </div>

  {#if data.events.length === 0}
    <div class="empty card"><p class="muted">Nothing here yet — play some hands, claim your daily reward, or add a friend.</p></div>
  {:else}
    <div class="feed">
      {#each data.events as e, i (e.type + e.ts + (e.ref || "") + i)}
        <div class="ev card" in:fly={{ y: d(8), duration: d(DUR.base), delay: d(Math.min(i, 12) * 22) }}>
          <span class="ev-icon">{e.icon}</span>
          <span class="ev-main">
            <span class="ev-label">{e.label}</span>
            {#if e.sub}<span class="ev-sub">{e.sub}</span>{/if}
          </span>
          {#if e.type === "money"}
            <span class="ev-amt" class:pos={e.amount >= 0} class:neg={e.amount < 0}>{e.amount >= 0 ? "+" : ""}{fmt(e.amount)}</span>
          {/if}
          <span class="ev-time">{when(e.ts)}</span>
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .wrap { max-width: 720px; margin: 0 auto; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 14px; flex-wrap: wrap; margin-bottom: 16px; }
  .head h1 { margin: 0; font-size: 26px; }
  .filters { display: inline-flex; gap: 2px; background: var(--well); padding: 3px; border-radius: var(--r-pill); position: relative; }
  .filters .sel-ind { background: var(--surface); box-shadow: var(--shadow-card); }
  .fbtn { border: 0; background: transparent; color: var(--muted); font-weight: 600; font-size: 12.5px; padding: 7px 13px; border-radius: var(--r-pill); cursor: pointer; position: relative;
    transition: color var(--dur) var(--ease); }
  .fbtn:hover { color: var(--text); }
  .fbtn.on { color: var(--text); }
  .empty { text-align: center; padding: 40px 20px; }
  .feed { display: flex; flex-direction: column; gap: 8px; }
  .ev { display: flex; align-items: center; gap: 13px; margin-bottom: 0; padding: 13px 16px; }
  .ev-icon { font-size: 20px; width: 34px; height: 34px; display: grid; place-items: center; background: var(--well); border-radius: 50%; flex: 0 0 auto; }
  .ev-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .ev-label { font-weight: 600; font-size: 14px; }
  .ev-sub { font-size: 12px; color: var(--muted); }
  .ev-amt { font-weight: 800; font-variant-numeric: tabular-nums; font-size: 14px; flex: 0 0 auto; }
  .ev-amt.pos { color: var(--ok); } .ev-amt.neg { color: var(--danger); }
  .ev-time { color: var(--faint); font-size: 11.5px; flex: 0 0 auto; min-width: 58px; text-align: right; }
</style>
