<script>
  import { enhance } from "$app/forms";
  import { invalidateAll } from "$app/navigation";
  import HandReplay from "./HandReplay.svelte";
  import TristateCheckbox from "./TristateCheckbox.svelte";

  let { data } = $props();

  // Map<handKey, boolean> — whether the inline replay is currently open.
  let openHand = $state({});
  // Map<playerId, boolean> — whether a player branch is expanded.
  let expandedPlayer = $state({});
  // Map<"<playerId>::<tableId>", boolean> — table expansion under a player.
  let expandedTable = $state({});
  // Set<handKey> — multi-select drives every action-panel button.
  // Anyone can select; only admins can act on Delete (the per-button
  // gate is enforced server-side too).
  let selected = $state(new Set());
  let actionError = $state(null);
  let actionBusy = $state(false);

  let isAdmin = $derived(!!data.user?.isAdmin);

  // ----- formatting helpers ---------------------------------------
  // The synthetic Generic bucket is stored under the reserved name
  // "[Generic]" (see ingest.js#GENERIC_PLAYER_NAME). We render it as
  // "Generic" to keep the UI clean.
  const GENERIC_NAME = "[Generic]";
  function isGenericPlayer(p) { return p && p.name === GENERIC_NAME; }
  function playerDisplay(p)   { return isGenericPlayer(p) ? "Generic" : p.name; }

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

  // ----- selection helpers ----------------------------------------
  // Tri-state at every level: a parent's checkbox is checked iff
  // every descendant round is checked, indeterminate iff some-but-
  // not-all, unchecked iff none.

  function allHandKeys() {
    const out = [];
    for (const p of data.players) {
      for (const t of p.tables) {
        for (const h of t.hands) out.push(h.handKey);
      }
    }
    return out;
  }
  function tableHandKeys(t) { return t.hands.map((h) => h.handKey); }
  function playerHandKeys(p) {
    const out = [];
    for (const t of p.tables) for (const h of t.hands) out.push(h.handKey);
    return out;
  }

  function tristateState(keys) {
    if (!keys.length) return "none";
    let n = 0;
    for (const k of keys) if (selected.has(k)) n++;
    if (n === 0) return "none";
    if (n === keys.length) return "all";
    return "some";
  }

  function setTristate(keys, on) {
    const next = new Set(selected);
    if (on) for (const k of keys) next.add(k);
    else    for (const k of keys) next.delete(k);
    selected = next;
  }

  function toggleHandSelect(handKey) {
    const next = new Set(selected);
    if (next.has(handKey)) next.delete(handKey);
    else next.add(handKey);
    selected = next;
  }

  function selectAll() {
    const next = new Set(selected);
    for (const k of allHandKeys()) next.add(k);
    selected = next;
  }
  function clearSelection() {
    selected = new Set();
    actionError = null;
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
        actionError = null;
        await invalidateAll();
      } else if (result.type === "failure") {
        actionError = result.data?.error || "Delete failed.";
      }
      await update({ reset: false, invalidateAll: false });
    };
  }

  // ----- export actions -------------------------------------------

  async function exportSelectedDump() {
    if (selected.size === 0 || actionBusy) return;
    actionBusy = true;
    actionError = null;
    try {
      const res = await fetch("/data/export-dump", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ handKeys: [...selected] })
      });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${txt.slice(0, 240)}`);
      }
      const text = await res.text();
      const filename = (res.headers.get("Content-Disposition") || "")
        .match(/filename="?([^";]+)"?/)?.[1]
        || `casino-export-${Date.now()}.casinodump`;
      triggerDownload(filename, "application/octet-stream", text);
    } catch (e) {
      actionError = `Export failed: ${e?.message || e}`;
    } finally {
      actionBusy = false;
    }
  }

  // Lazy-load the replay engine + readable transformer, fetch each
  // selected hand's frames, run buildSteps, transform, download.
  // Done client-side so we don't need to ship the replay engine to
  // the SvelteKit server context.
  async function exportSelectedReadable() {
    if (selected.size === 0 || actionBusy) return;
    actionBusy = true;
    actionError = null;
    try {
      await ensureReplayEngine();
      const Replay = window.CasinoReplay;
      const Readable = window.CasinoReadable;
      if (!Replay || !Readable) throw new Error("Replay engine unavailable");

      const keys = [...selected];
      const rounds = [];
      for (const k of keys) {
        const res = await fetch(`/data/hand/${encodeURIComponent(k)}`);
        if (!res.ok) throw new Error(`Failed to load ${k}: HTTP ${res.status}`);
        const hand = await res.json();
        const container = {
          frames: hand.frames || [],
          tableId: hand.tableId,
          tableName: (hand.tableNames && hand.tableNames[0]) || null
        };
        const round = Replay.buildSteps(container, 0);
        rounds.push({
          // Hero info — on the web we DO have the player name (it's
          // the canonical row's player), so emit it. The "no hero"
          // case (heroSeat == null) corresponds to a Generic row;
          // we still emit player.name = "[Generic]" so the consumer
          // can group correctly.
          player: {
            name: hand.player?.name ?? null,
            casinoUserId: hand.player?.casinoUserId ?? null
          },
          table: { tableId: hand.tableId, names: hand.tableNames || null },
          round: Readable.buildRoundReadable(round, hand.heroSeat == null ? null : {
            name: hand.player?.name ?? null,
            casinoUserId: hand.player?.casinoUserId ?? null,
            seatId: hand.heroSeat,
            holeCards: hand.heroHoleCards || null
          }, { firstTs: hand.firstTs, lastTs: hand.lastTs })
        });
      }
      const payload = Readable.buildExport(rounds);
      const json = JSON.stringify(payload, null, 2);
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      triggerDownload(`casino-readable-${stamp}.json`, "application/json", json);
    } catch (e) {
      actionError = `Readable export failed: ${e?.message || e}`;
    } finally {
      actionBusy = false;
    }
  }

  async function ensureReplayEngine() {
    if (window.CasinoReplay && window.CasinoReadable) return;
    async function loadScript(src) {
      return new Promise((resolve, reject) => {
        if (document.querySelector(`script[src="${src}"]`)) return resolve();
        const s = document.createElement("script");
        s.src = src;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error(`failed to load ${src}`));
        document.head.appendChild(s);
      });
    }
    await loadScript("/replay-engine/tableize.js");
    await loadScript("/replay-engine/cards.js");
    await loadScript("/replay-engine/users.js");
    await loadScript("/replay-engine/replay.js");
    await loadScript("/replay-engine/readable.js");
  }

  function triggerDownload(filename, mime, content) {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      a.remove();
    }, 0);
  }

  // ----- derived UI flags ----------------------------------------
  let allKeys = $derived(allHandKeys());
  let allChecked = $derived(allKeys.length > 0 && allKeys.every((k) => selected.has(k)));
  let nothingSelected = $derived(selected.size === 0);
</script>

<svelte:head>
  <link rel="stylesheet" href="/replay-engine/replay-felt.css" />
</svelte:head>

{#if data.players.length > 0}
  <div class="action-bar">
    <span class="action-bar-count">
      {#if selected.size === 0}
        No rounds selected
      {:else}
        {selected.size} round{selected.size === 1 ? "" : "s"} selected
      {/if}
    </span>
    <div class="action-bar-buttons">
      <button class="btn btn-secondary"
              type="button"
              disabled={allChecked}
              onclick={selectAll}>
        Select all
      </button>
      {#if isAdmin}
        <form method="POST" action="?/deleteHands" use:enhance={handleDelete}>
          {#each [...selected] as k (k)}
            <input type="hidden" name="handKey" value={k} />
          {/each}
          <button class="btn btn-danger"
                  type="submit"
                  disabled={nothingSelected || actionBusy}>
            Delete selected
          </button>
        </form>
      {:else}
        <button class="btn btn-danger"
                type="button"
                disabled
                title="Admin only">
          Delete selected
        </button>
      {/if}
      <button class="btn btn-secondary"
              type="button"
              disabled={nothingSelected || actionBusy}
              onclick={exportSelectedDump}>
        Export
      </button>
      <button class="btn btn-secondary"
              type="button"
              disabled={nothingSelected || actionBusy}
              onclick={exportSelectedReadable}>
        Export readable
      </button>
      <button class="btn btn-secondary"
              type="button"
              disabled={nothingSelected}
              onclick={clearSelection}>
        Cancel
      </button>
    </div>
    {#if actionError}<span class="form-error" style="margin-left:8px">{actionError}</span>{/if}
  </div>
{/if}

{#if data.players.length === 0}
  <div class="list-empty">
    <p>No hands ingested yet.</p>
    <p>
      <a href="/contribute">Contribute a .casinodump</a> from the Chrome extension to get started.
      Generic captures (no visible hole cards) are rejected for normal
      uploads; admins can ingest them under the Generic player.
    </p>
  </div>
{:else}
  <ul class="p-list">
    {#each data.players as p (p.id)}
      {@const pKeys = playerHandKeys(p)}
      {@const pState = tristateState(pKeys)}
      <li class="p-item" class:p-generic={isGenericPlayer(p)}>
        <div class="p-item-head">
          <TristateCheckbox
            triState={pState}
            title="Select / deselect every round captured from this player"
            onToggle={(on) => setTristate(pKeys, on)}
          />
          <button
            class="p-row"
            aria-expanded={expandedPlayer[p.id] ? "true" : "false"}
            onclick={() => togglePlayer(p.id)}
          >
            <span class="p-caret">{expandedPlayer[p.id] ? "▾" : "▸"}</span>
            <span class="p-name">{playerDisplay(p)}</span>
            <span class="p-meta">
              {p.handCount} hand{p.handCount === 1 ? "" : "s"}
              <span class="dot-sep">·</span>
              {p.tables.length} table{p.tables.length === 1 ? "" : "s"}
              <span class="dot-sep">·</span>
              {fmtRange(p.firstTs, p.lastTs)}
            </span>
          </button>
        </div>

        {#if expandedPlayer[p.id]}
          <ul class="t-list">
            {#each p.tables as t (t.tableId)}
              {@const tKeys = tableHandKeys(t)}
              {@const tState = tristateState(tKeys)}
              <li class="t-item">
                <div class="t-item-head">
                  <TristateCheckbox
                    triState={tState}
                    title="Select / deselect every round at this table"
                    onToggle={(on) => setTristate(tKeys, on)}
                  />
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
                </div>

                {#if isTableOpen(p.id, t.tableId)}
                  <ol class="h-list">
                    {#each t.hands.slice().reverse() as h, i (h.handKey)}
                      <li class="h-item">
                        <div class="h-item-row">
                          <label class="tree-select" title="Select round for bulk action">
                            <input
                              type="checkbox"
                              checked={selected.has(h.handKey)}
                              onchange={() => toggleHandSelect(h.handKey)}
                            />
                          </label>
                          <button class="h-row" onclick={() => toggleHand(h.handKey)}
                                  aria-expanded={openHand[h.handKey] ? "true" : "false"}>
                            <span class="h-caret">{openHand[h.handKey] ? "▾" : "▸"}</span>
                            <span class="h-idx">Round {t.hands.length - i}</span>
                            <span class="h-time">{fmtDate(h.firstTs)}</span>
                            <span class="h-meta">
                              {#if h.heroSeat != null}
                                seat {h.heroSeat}
                              {:else}
                                generic
                              {/if}
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
    flex: 1; min-width: 0; text-align: left;
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
  .p-item.p-generic .p-name { color: var(--muted); font-style: italic; }

  /* Table branch (under a player) ----------------------------------- */
  .t-list { padding-left: 24px; }
  .t-item { padding: 4px 0; }
  .t-item-head { display: flex; align-items: center; gap: 8px; }
  .t-row, .h-row {
    flex: 1; min-width: 0; text-align: left;
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
    grid-template-columns: 22px 1fr;
    align-items: center;
  }
  .h-row { grid-template-columns: 16px 1fr 100px auto; }
  .h-idx { color: var(--text); }
  .h-replay { padding: 8px 0 12px 28px; }
  .dot-sep { margin: 0 6px; opacity: 0.6; }

  /* Tri-state checkbox ------------------------------------------- */
  .tree-select { display: flex; align-items: center; justify-content: center; cursor: pointer; }
  .tree-select input[type="checkbox"] { accent-color: var(--hero); cursor: pointer; }

  /* Action bar (always visible while data exists) ---------------- */
  .action-bar {
    position: sticky; top: 44px; z-index: 5;
    display: flex; align-items: center; gap: 10px;
    margin: -16px -16px 12px;
    padding: 8px 16px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
  }
  .action-bar form { display: inline-flex; align-items: center; margin: 0; }
  .action-bar-count { color: var(--muted); font-size: 12.5px; margin-right: auto; }
  .action-bar-buttons {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    justify-content: flex-end;
  }
  .action-bar-buttons button:disabled { opacity: 0.45; cursor: not-allowed; }
</style>
