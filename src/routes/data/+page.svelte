<script>
  import { onMount } from "svelte";
  import HandReplay from "./HandReplay.svelte";

  let { data } = $props();
  // Map<handKey, boolean> — whether the inline replay is currently open.
  let openHand = $state({});

  function tableTitle(t) {
    if (!t.names.length) return "Table";
    return t.names.slice().reverse().join(" - ");
  }
  function fmtDate(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const today = new Date();
    const sameDay = d.toDateString() === today.toDateString();
    if (sameDay) {
      return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  function fmtRange(a, b) {
    if (!a || !b) return "";
    if (fmtDate(a) === fmtDate(b)) return fmtDate(a);
    return `${fmtDate(a)} \u2192 ${fmtDate(b)}`;
  }

  let expanded = $state({});       // tableId -> bool
  function toggleTable(id) { expanded[id] = !expanded[id]; }
  function toggleHand(key) { openHand[key] = !openHand[key]; }
</script>

<svelte:head>
  <link rel="stylesheet" href="/replay-engine/replay-felt.css" />
</svelte:head>

{#if data.tables.length === 0}
  <div class="list-empty">
    <p>No hands ingested yet.</p>
    <p><a href="/upload">Upload a .casinodump</a> from the Chrome extension to get started.</p>
  </div>
{:else}
  <ul class="t-list">
    {#each data.tables as t (t.tableId)}
      <li class="t-item">
        <button
          class="t-row"
          aria-expanded={expanded[t.tableId] ? "true" : "false"}
          onclick={() => toggleTable(t.tableId)}
        >
          <span class="t-caret">{expanded[t.tableId] ? "\u25BE" : "\u25B8"}</span>
          <span class="t-name">{tableTitle(t)}</span>
          <span class="t-id">#{t.tableId}</span>
          <span class="t-meta">
            {t.hands.length} hand{t.hands.length === 1 ? "" : "s"}
            <span class="dot-sep">\u00b7</span>
            {fmtRange(t.firstTs, t.lastTs)}
          </span>
        </button>
        {#if expanded[t.tableId]}
          <ol class="h-list">
            {#each t.hands.slice().reverse() as h, i (h.handKey)}
              <li class="h-item">
                <button class="h-row" onclick={() => toggleHand(h.handKey)}
                        aria-expanded={openHand[h.handKey] ? "true" : "false"}>
                  <span class="h-caret">{openHand[h.handKey] ? "\u25BE" : "\u25B8"}</span>
                  <span class="h-idx">Round {t.hands.length - i}</span>
                  <span class="h-time">{fmtDate(h.firstTs)}</span>
                  <span class="h-meta">
                    {h.perspectiveCount} perspective{h.perspectiveCount === 1 ? "" : "s"}
                    {#if h.uploadCount > h.perspectiveCount}
                      <span class="dot-sep">\u00b7</span>
                      {h.uploadCount} upload{h.uploadCount === 1 ? "" : "s"}
                    {/if}
                    {#if h.commentCount > 0}
                      <span class="dot-sep">\u00b7</span>
                      {h.commentCount} comment{h.commentCount === 1 ? "" : "s"}
                    {/if}
                  </span>
                </button>
                {#if openHand[h.handKey]}
                  <div class="h-replay">
                    <HandReplay handKey={h.handKey} />
                  </div>
                {/if}
              </li>
            {/each}
          </ol>
        {/if}
      </li>
    {/each}
  </ul>
{/if}

<style>
  .t-list, .h-list { list-style: none; margin: 0; padding: 0; }
  .t-item { padding: 6px 0; border-bottom: 1px solid var(--border); }
  .t-row, .h-row {
    width: 100%; text-align: left;
    appearance: none; background: transparent; border: 0; color: var(--text);
    display: grid;
    grid-template-columns: 16px 1fr auto auto;
    align-items: baseline; gap: 10px;
    padding: 6px 4px; cursor: pointer; font: inherit;
  }
  .t-row:hover, .h-row:hover { background: var(--surface-hover); }
  .t-caret, .h-caret { color: var(--muted); }
  .t-name { font-weight: 600; }
  .t-id, .h-time { color: var(--muted); font-family: ui-monospace, Menlo, monospace; font-size: 12px; }
  .t-meta, .h-meta { color: var(--muted); font-size: 12px; }
  .h-list { padding-left: 24px; }
  .h-item { padding: 4px 0; }
  .h-row { grid-template-columns: 16px 1fr 100px auto; }
  .h-idx { color: var(--text); }
  .h-replay { padding: 8px 0 12px 28px; }
  .dot-sep { margin: 0 6px; opacity: 0.6; }
</style>
