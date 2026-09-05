<script>
  // The ranked board + its controls (metric / timeframe / scope). Navigation
  // is query-string based so it works wherever the board is mounted.
  import { goto } from "$app/navigation";
  import { fly } from "svelte/transition";
  import { flip } from "svelte/animate";
  import { d, DUR } from "$lib/motion.js";
  import Avatar from "$lib/poker/components/Avatar.svelte";

  let { rows = [], metric = "chips", timeframe = "all", scope = "global", signedIn = false, basePath = "/data", extra = {} } = $props();

  function nav(patch) {
    const p = new URLSearchParams({ ...extra, metric, tf: timeframe, scope, ...patch });
    goto(`${basePath}?${p}`, { keepFocus: true, noScroll: true });
  }
  const fmt = (n) => Number(n).toLocaleString();
  const isNet = $derived(metric === "net");
  const unit = $derived(isNet ? "net at tables" : "chips");
</script>

<div class="controls">
  <div class="seg">
    <button class="sb" class:on={metric === "chips"} onclick={() => nav({ metric: "chips" })}>Chips</button>
    <button class="sb" class:on={metric === "net"} onclick={() => nav({ metric: "net" })}>Net winnings</button>
  </div>
  {#if isNet}
    <div class="seg">
      {#each [["all", "All-time"], ["week", "This week"], ["month", "This month"]] as [v, l]}
        <button class="sb" class:on={timeframe === v} onclick={() => nav({ tf: v })}>{l}</button>
      {/each}
    </div>
  {/if}
  <div class="seg">
    <button class="sb" class:on={scope === "global"} onclick={() => nav({ scope: "global" })}>Global</button>
    <button class="sb" class:on={scope === "friends"} onclick={() => nav({ scope: "friends" })} disabled={!signedIn}>Friends</button>
  </div>
</div>

{#if rows.length === 0}
  <div class="empty card"><p class="muted">{scope === "friends" ? "No friends on this board yet — add some friends!" : "No ranked players yet."}</p></div>
{:else}
  <div class="board">
    {#each rows as r, i (r.id)}
      <div class="lrow card" class:top={i < 3} in:fly={{ y: d(8), duration: d(DUR.base), delay: d(Math.min(i, 12) * 20) }} animate:flip={{ duration: d(DUR.base) }}>
        <span class="rank" class:medal={i < 3}>{i + 1}</span>
        <Avatar id={r.id} name={r.name} mediaId={r.avatarMediaId} size={34} userId={r.id} />
        <a class="lname" href="/u/{r.id}">{r.name}</a>
        <span class="lval" class:gold={!isNet} class:pos={isNet && r.value >= 0} class:neg={isNet && r.value < 0}>
          {isNet && r.value >= 0 ? "+" : ""}{fmt(r.value)}
        </span>
      </div>
    {/each}
  </div>
  <p class="muted small unit-note">Ranked by {unit}.</p>
{/if}

<style>
  .controls { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 16px; }
  .seg { display: inline-flex; background: var(--well); border-radius: var(--r-pill); padding: 3px; gap: 2px; }
  .sb { border: 0; background: transparent; color: var(--muted); font-weight: 600; font-size: 12.5px; padding: 7px 13px; border-radius: var(--r-pill); cursor: pointer;
    transition: color var(--dur) var(--ease), background-color var(--dur) var(--ease); }
  .sb:hover:not(:disabled) { color: var(--text); }
  .sb.on { color: var(--text); background: var(--surface); box-shadow: var(--shadow-card); }
  .sb:disabled { opacity: .5; cursor: not-allowed; }
  .empty { text-align: center; padding: 40px 20px; }
  .board { display: flex; flex-direction: column; gap: 8px; }
  .lrow { display: flex; align-items: center; gap: 13px; margin-bottom: 0; padding: 12px 16px; }
  .lrow.top { box-shadow: 0 0 0 1px var(--gold-line, rgba(200,160,60,.3)), var(--shadow-card); }
  .rank { width: 26px; text-align: center; font-weight: 800; color: var(--muted); font-variant-numeric: tabular-nums; flex: 0 0 auto; }
  .rank.medal { color: var(--gold-ink); font-size: 16px; }
  .lname { flex: 1; min-width: 0; font-weight: 700; font-size: 14.5px; color: var(--text); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lname:hover { color: var(--accent-ink); }
  .lval { font-weight: 800; font-variant-numeric: tabular-nums; font-size: 15px; flex: 0 0 auto; }
  .lval.gold { color: var(--gold-ink); }
  .lval.pos { color: var(--ok); } .lval.neg { color: var(--danger); }
  .unit-note { margin-top: 10px; text-align: center; }
</style>
