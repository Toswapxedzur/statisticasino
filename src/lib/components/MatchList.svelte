<script>
  // A list of recorded matches (rows from store.recentReplaysForUser): mode,
  // table, when, the player's net with its coin, and a link to the replay.
  import Chip from "$lib/poker/components/Chip.svelte";

  let { matches = [], empty = "No matches in this window." } = $props();

  const MODE = { holdem: "Poker" };
  const modeName = (m) => MODE[m] || String(m || "").replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  const fmt = (n) => Number(n || 0).toLocaleString();
  const signed = (n) => (n >= 0 ? "+" : "") + fmt(n);
  function when(ms) {
    const d = Date.now() - Number(ms);
    if (d < 60_000) return "just now";
    if (d < 3_600_000) return `${Math.floor(d / 60_000)}m ago`;
    if (d < 86_400_000) return `${Math.floor(d / 3_600_000)}h ago`;
    return new Date(Number(ms)).toLocaleDateString();
  }
</script>

{#if matches.length}
  <ul class="ml">
    {#each matches as m (m.id)}
      <li>
        <a class="ml-row" href="/replay/{m.id}">
          <span class="ml-mode">{modeName(m.mode)}{#if m.context && m.context !== "cash"} <em>{m.context}</em>{/if}{#if m.role === "banker"} <em>banker</em>{/if}</span>
          <span class="ml-table muted">{m.table_name || "table"}{#if m.hand_no} · #{m.hand_no}{/if}</span>
          <span class="ml-when muted">{when(m.ended_at)}</span>
          <span class="ml-net" class:pos={m.net >= 0} class:neg={m.net < 0}><Chip value={Math.abs(m.net)} size={14} /> {signed(m.net)}</span>
        </a>
      </li>
    {/each}
  </ul>
{:else}
  <p class="muted small">{empty}</p>
{/if}

<style>
  .ml { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .ml-row {
    display: grid; grid-template-columns: 1.1fr 1.4fr auto auto; gap: 12px; align-items: center;
    padding: 10px 14px; border-radius: 12px; text-decoration: none; color: var(--text);
    background: color-mix(in srgb, var(--surface) 82%, #000 18%);
    transition: background var(--dur) var(--ease);
  }
  .ml-row:hover { background: color-mix(in srgb, var(--surface) 70%, #fff 6%); }
  .ml-mode { font-weight: 700; font-size: 13.5px; }
  .ml-mode em { font-style: normal; font-size: 10.5px; font-weight: 800; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); margin-left: 6px; }
  .ml-table, .ml-when { font-size: 12.5px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .ml-net { display: inline-flex; align-items: center; gap: 5px; font-weight: 800; font-variant-numeric: tabular-nums; font-size: 13px; white-space: nowrap; }
  .pos { color: var(--ok, #6ee7a8); }
  .neg { color: var(--danger, #f37f8c); }
  @media (max-width: 560px) { .ml-row { grid-template-columns: 1fr auto; } .ml-table, .ml-when { display: none; } }
</style>
