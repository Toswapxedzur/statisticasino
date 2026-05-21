<script>
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import HandReplay from "./HandReplay.svelte";

  let { data } = $props();

  // Map<handKey, boolean> — whether the inline replay is currently open.
  let openHand = $state({});
  // Map<playerId, boolean> — whether a player branch is expanded.
  let expandedPlayer = $state({});
  // Map<"<playerId>::<tableId>", boolean> — table expansion under a player.
  let expandedTable = $state({});
  // Set<handKey> — admin multi-select for the bulk-delete bar.
  let selected = $state(new Set());
  let deleteError = $state(null);

  // `data.user` may be null for anonymous visitors; the entire delete
  // UI hangs off this flag.
  let isAdmin = $derived(!!data.user?.isAdmin);

  // ----- formatting helpers ---------------------------------------
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
    return `${fmtDate(a)} → ${fmtDate(b)}`;
  }

  // ----- expand / collapse ----------------------------------------
  function togglePlayer(id) { expandedPlayer[id] = !expandedPlayer[id]; }
  function toggleTable(playerId, tableId) {
    const k = `${playerId}::${tableId}`;
    expandedTable[k] = !expandedTable[k];
  }
  function isTableOpen(playerId, tableId) {
    return !!expandedTable[`${playerId}::${tableId}`];
  }
  function toggleHand(key) { openHand[key] = !openHand[key]; }

  // ----- admin selection ------------------------------------------
  function toggleSelect(handKey) {
    const next = new Set(selected);
    if (next.has(handKey)) next.delete(handKey);
    else next.add(handKey);
    selected = next;
  }
  function clearSelection() {
    selected = new Set();
    deleteError = null;
  }
  function selectAllInTable(t) {
    const next = new Set(selected);
    for (const h of t.hands) next.add(h.handKey);
    selected = next;
  }
  function selectAllForPlayer(p) {
    const next = new Set(selected);
    for (const t of p.tables) for (const h of t.hands) next.add(h.handKey);
    selected = next;
  }

  // Form-action handler shared by all three delete forms. SvelteKit's
  // `enhance` returns a callback that receives `{ result, update }`;
  // we re-invalidate after a successful delete so `listPlayers` re-runs
  // and the row drops out of the tree without a hard reload.
  function handleDelete() {
    return async ({ result, update }) => {
      if (result.type === "success") {
        const keys = [...selected];
        selected = new Set();
        for (const k of keys) delete openHand[k];
        deleteError = null;
        await invalidateAll();
      } else if (result.type === "failure") {
        deleteError = result.data?.error || "Delete failed.";
      }
      await update({ reset: false, invalidateAll: false });
    };
  }

  function confirmTableDelete(t, e) {
    if (!confirm(`Delete all ${t.handCount} hands at ${tableTitle(t)}? This is reversible (soft delete).`)) {
      e.preventDefault();
    }
  }
  function confirmPlayerDelete(p, e) {
    if (!confirm(`Delete all ${p.handCount} hands captured from ${p.name}'s perspective? This is reversible (soft delete).`)) {
      e.preventDefault();
    }
  }
</script>

<svelte:head>
  <link rel="stylesheet" href="/replay-engine/replay-felt.css" />
</svelte:head>

{#if isAdmin && selected.size > 0}
  <div class="delete-bar">
    <form method="POST" action="?/deleteHands" use:enhance={handleDelete}>
      {#each [...selected] as k (k)}
        <input type="hidden" name="handKey" value={k} />
      {/each}
      <span>{selected.size} round{selected.size === 1 ? "" : "s"} selected</span>
      <button class="btn btn-danger" type="submit">
        Delete {selected.size} round{selected.size === 1 ? "" : "s"}
      </button>
      <button class="btn btn-secondary" type="button" onclick={clearSelection}>Cancel</button>
    </form>
    {#if deleteError}<span class="form-error" style="margin-left:8px">{deleteError}</span>{/if}
  </div>
{/if}

{#if data.players.length === 0}
  <div class="list-empty">
    <p>No hands ingested yet.</p>
    <p>
      <a href="/upload">Upload a .casinodump</a> from the Chrome extension to get started.
      Generic captures (no perspective) are rejected.
    </p>
  </div>
{:else}
  <ul class="p-list">
    {#each data.players as p (p.id)}
      <li class="p-item">
        <div class="p-item-head">
          <button
            class="p-row"
            aria-expanded={expandedPlayer[p.id] ? "true" : "false"}
            onclick={() => togglePlayer(p.id)}
          >
            <span class="p-caret">{expandedPlayer[p.id] ? "▾" : "▸"}</span>
            <span class="p-name">{p.name}</span>
            <span class="p-meta">
              {p.handCount} hand{p.handCount === 1 ? "" : "s"}
              <span class="dot-sep">·</span>
              {p.tables.length} table{p.tables.length === 1 ? "" : "s"}
              <span class="dot-sep">·</span>
              {fmtRange(p.firstTs, p.lastTs)}
            </span>
          </button>
          {#if isAdmin}
            <button
              class="btn btn-secondary btn-sm"
              type="button"
              onclick={() => selectAllForPlayer(p)}
              title="Select every round captured from this player"
            >Select all</button>
            <form method="POST" action="?/deletePlayer" use:enhance={handleDelete} style="margin:0">
              <input type="hidden" name="playerId" value={p.id} />
              <button
                class="btn btn-danger btn-sm"
                type="submit"
                onclick={(e) => confirmPlayerDelete(p, e)}
              >Delete player</button>
            </form>
          {/if}
        </div>

        {#if expandedPlayer[p.id]}
          <ul class="t-list">
            {#each p.tables as t (t.tableId)}
              <li class="t-item">
                <div class="t-item-head">
                  <button
                    class="t-row"
                    aria-expanded={isTableOpen(p.id, t.tableId) ? "true" : "false"}
                    onclick={() => toggleTable(p.id, t.tableId)}
                  >
                    <span class="t-caret">{isTableOpen(p.id, t.tableId) ? "▾" : "▸"}</span>
                    <span class="t-name">{tableTitle(t)}</span>
                    <span class="t-id">#{t.tableId}</span>
                    <span class="t-meta">
                      {t.handCount} hand{t.handCount === 1 ? "" : "s"}
                      <span class="dot-sep">·</span>
                      {fmtRange(t.firstTs, t.lastTs)}
                    </span>
                  </button>
                  {#if isAdmin}
                    <button
                      class="btn btn-secondary btn-sm"
                      type="button"
                      onclick={() => selectAllInTable(t)}
                      title="Add every round in this table to the selection"
                    >Select all</button>
                    <form method="POST" action="?/deleteTable" use:enhance={handleDelete} style="margin:0">
                      <input type="hidden" name="playerId" value={p.id} />
                      <input type="hidden" name="tableId" value={t.tableId} />
                      <button
                        class="btn btn-danger btn-sm"
                        type="submit"
                        onclick={(e) => confirmTableDelete(t, e)}
                      >Delete table</button>
                    </form>
                  {/if}
                </div>

                {#if isTableOpen(p.id, t.tableId)}
                  <ol class="h-list">
                    {#each t.hands.slice().reverse() as h, i (h.handKey)}
                      <li class="h-item">
                        <div class="h-item-row" class:has-checkbox={isAdmin}>
                          {#if isAdmin}
                            <label class="h-check" title="Select for delete">
                              <input
                                type="checkbox"
                                checked={selected.has(h.handKey)}
                                onchange={() => toggleSelect(h.handKey)}
                              />
                            </label>
                          {/if}
                          <button class="h-row" onclick={() => toggleHand(h.handKey)}
                                  aria-expanded={openHand[h.handKey] ? "true" : "false"}>
                            <span class="h-caret">{openHand[h.handKey] ? "▾" : "▸"}</span>
                            <span class="h-idx">Round {t.hands.length - i}</span>
                            <span class="h-time">{fmtDate(h.firstTs)}</span>
                            <span class="h-meta">
                              seat {h.heroSeat}
                              {#if h.uploadCount > 1}
                                <span class="dot-sep">·</span>
                                {h.uploadCount} uploads
                              {/if}
                              {#if h.commentCount > 0}
                                <span class="dot-sep">·</span>
                                {h.commentCount} comment{h.commentCount === 1 ? "" : "s"}
                              {/if}
                            </span>
                          </button>
                        </div>
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
      </li>
    {/each}
  </ul>
{/if}

<style>
  .p-list, .t-list, .h-list { list-style: none; margin: 0; padding: 0; }

  /* Player branch ---------------------------------------------------- */
  .p-item { padding: 8px 0; border-bottom: 1px solid var(--border); }
  .p-item-head { display: flex; align-items: center; gap: 8px; }
  .p-row {
    width: 100%; text-align: left;
    appearance: none; background: transparent; border: 0; color: var(--text);
    display: grid;
    grid-template-columns: 16px 1fr auto;
    align-items: baseline; gap: 10px;
    padding: 6px 4px; cursor: pointer; font: inherit;
  }
  .p-row:hover { background: var(--surface-hover); }
  .p-caret { color: var(--muted); }
  .p-name { font-weight: 700; font-size: 15px; color: var(--hero); }
  .p-meta { color: var(--muted); font-size: 12px; }

  /* Table branch (under a player) ----------------------------------- */
  .t-list { padding-left: 24px; }
  .t-item { padding: 4px 0; }
  .t-item-head { display: flex; align-items: center; gap: 8px; }
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

  /* Round branch (under a table) ------------------------------------ */
  .h-list { padding-left: 24px; }
  .h-item { padding: 4px 0; }
  .h-item-row {
    display: grid;
    grid-template-columns: 1fr;
    align-items: center;
  }
  .h-item-row.has-checkbox { grid-template-columns: 22px 1fr; }
  .h-row { grid-template-columns: 16px 1fr 100px auto; }
  .h-idx { color: var(--text); }
  .h-replay { padding: 8px 0 12px 28px; }
  .dot-sep { margin: 0 6px; opacity: 0.6; }

  /* Admin-only delete UI ------------------------------------------- */
  .h-check { display: flex; align-items: center; justify-content: center; cursor: pointer; }
  .h-check input[type="checkbox"] { accent-color: var(--hero); cursor: pointer; }
  .btn-sm { padding: 3px 10px; font-size: 11.5px; border-radius: 6px; }
  .delete-bar {
    position: sticky; top: 44px; z-index: 5;
    display: flex; align-items: center; gap: 10px;
    margin: -16px -16px 12px;
    padding: 8px 16px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .delete-bar form {
    display: inline-flex; align-items: center; gap: 8px; margin: 0;
  }
</style>
