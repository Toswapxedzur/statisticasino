<script>
  // LobbyPlayers: a single panel with two stacked sections.
  //
  //  1. "Players online (N)" — one row per LobbyPlayer showing name (own
  //     name highlighted), chip count, and a location badge ("In lobby"
  //     when location === 'lobby', otherwise the tableName). Every player
  //     that is NOT me gets a small Invite button -> onInvite(player.id).
  //     The list scrolls when it grows too tall.
  //
  //  2. "Leaderboard" — a ranked top-10 list of {name, chips} rows.
  //
  // Read-only: parent supplies the reactive data via props.

  import { onMount } from "svelte";
  import { fly, fade } from "svelte/transition";
  import { flip } from "svelte/animate";
  import { d, DUR } from "$lib/motion.js";

  let { players = [], leaderboard = [], me = null, onInvite = () => {} } =
    $props();

  const top = $derived((leaderboard ?? []).slice(0, 10));
  // Gate so the initial online list / leaderboard don't all fly in on load.
  let ready = $state(false);
  onMount(() => { requestAnimationFrame(() => (ready = true)); });

  function fmt(n) {
    return typeof n === "number" ? n.toLocaleString() : (n ?? "0");
  }
</script>

<div class="players card">
  <section class="section">
    <div class="card-head">
      <h3>Players online ({players.length})</h3>
    </div>

    <div class="list">
      {#if players.length === 0}
        <div class="empty muted">No one else is around right now.</div>
      {:else}
        {#each players as p (p.id)}
          {@const mine = me && p.id === me.id}
          <div class="prow" class:me={mine} in:fly={{ y: d(6), duration: ready ? d(DUR.base) : 0 }} out:fade={{ duration: d(DUR.fast) }} animate:flip={{ duration: d(DUR.base) }}>
            {#if mine}
              <span class="name" title={p.name}>{p.name}<span class="you"> (you)</span></span>
            {:else}
              <a class="name name-link" href="/u/{p.id}" title="View {p.name}'s profile">{p.name}</a>
            {/if}
            <span class="loc" class:playing={p.location !== "lobby"}>
              {p.location === "lobby"
                ? "In lobby"
                : (p.tableName ?? "At a table")}
            </span>
            <span class="chips">{fmt(p.chips)}</span>
            {#if !mine}
              <button
                class="btn btn-secondary btn-xs invite"
                onclick={() => onInvite(p.id)}
              >
                Invite
              </button>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </section>

  <section class="section">
    <div class="card-head">
      <h3>Leaderboard</h3>
    </div>

    <div class="board">
      {#if top.length === 0}
        <div class="empty muted">No rankings yet.</div>
      {:else}
        {#each top as row, i (i)}
          <div class="lrow" in:fade={{ duration: ready ? d(DUR.fast) : 0 }}>
            <span class="rank">{i + 1}.</span>
            <span class="name" title={row.name}>{row.name}</span>
            <span class="chips">{fmt(row.chips)}</span>
          </div>
        {/each}
      {/if}
    </div>
  </section>
</div>

<style>
  .players { display: flex; flex-direction: column; gap: 14px; }
  .section { display: flex; flex-direction: column; }
  .card-head { margin-bottom: 6px; }

  .empty {
    text-align: center;
    font-size: 12.5px;
    padding: 18px 0;
  }

  .list {
    max-height: 240px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    padding-right: 4px;
    gap: 4px;
  }
  .board {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .prow {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    background: var(--well);
    border-radius: var(--r-btn);
    font-size: 12.5px;
    transition: background-color var(--dur) var(--ease);
  }
  .prow:hover { background: var(--surface-2); }

  .lrow {
    display: flex;
    align-items: baseline;
    gap: 8px;
    padding: 6px 8px;
    background: var(--well);
    border-radius: var(--r-btn);
    font-size: 12.5px;
  }

  .name {
    flex: 1 1 auto;
    min-width: 0;
    color: var(--text);
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .prow.me .name { color: var(--accent); }
  .name-link { text-decoration: none; transition: color var(--dur, .2s) var(--ease, ease); }
  .name-link:hover { color: var(--accent-ink); }
  .you { color: var(--muted); font-weight: 400; }

  .rank {
    flex: 0 0 auto;
    width: 22px;
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .loc {
    flex: 0 0 auto;
    max-width: 40%;
    font-size: 10.5px;
    color: var(--muted);
    background: var(--surface-2);
    border-radius: var(--r-pill);
    padding: 1px 8px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .loc.playing {
    color: var(--accent-ink);
    background: var(--accent-soft);
  }

  .chips {
    flex: 0 0 auto;
    color: var(--gold-ink);
    font-weight: 700;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .invite { flex: 0 0 auto; }
</style>
