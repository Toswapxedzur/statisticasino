<script>
  // PlayOK-style three-pane lobby. Everything dynamic streams over the
  // WebSocket via the shared `poker` client singleton; SSR only provides
  // the signed-in user + wallet balance (for the New Table modal caps).
  //
  // Layout:
  //   LEFT / main  — header + toolbar (Quick Play / New Table) + live
  //                  tables list (empty-state when none).
  //   RIGHT        — LobbyPlayers (online players + leaderboard + invite).
  //   BOTTOM       — LobbyChat (spans the main column on wide screens).
  // Incoming invites render as a banner stack at the very top.

  import { onMount, onDestroy } from "svelte";
  import { poker } from "$lib/poker/client.svelte.js";
  import { goto } from "$app/navigation";
  import { SITE_NAME, SITE_TAGLINE } from "$lib/config.js";
  import NewTableModal from "$lib/poker/components/NewTableModal.svelte";
  import LobbyPlayers from "$lib/poker/components/LobbyPlayers.svelte";
  import LobbyChat from "$lib/poker/components/LobbyChat.svelte";
  import { GAME_MODES, variantShort, modeOf } from "$lib/poker/games.js";

  let { data } = $props();

  // Which game mode the lobby is showing (Poker vs Blackjack). Drives the table
  // list filter and the default game for the New Table modal.
  let gameMode = $state("poker");
  const modeLabel = $derived(GAME_MODES.find((m) => m.key === gameMode)?.label ?? "Poker");
  const tablesForMode = $derived(
    (poker.lobby.tables || []).filter((t) => modeOf(t.variant) === gameMode)
  );

  // Wallet balance: SSR value, kept live via the client's "chips" event so
  // the New Table modal's buy-in caps stay accurate after wallet changes.
  let walletChips = $state(data.walletChips ?? 0);
  function onChips(e) {
    if (typeof e.detail === "number") walletChips = e.detail;
  }

  let showModal = $state(false);

  // Sign-in gate: watching the lobby is fine, but seating actions need auth.
  let signedIn = $derived(!!poker.me);

  onMount(() => {
    poker.subLobby();
    window.addEventListener("chips", onChips);
  });
  onDestroy(() => {
    poker.unsubLobby();
    if (typeof window !== "undefined") window.removeEventListener("chips", onChips);
  });

  // Server sets pendingNav on table.created (create / quick-play /
  // invite-accept). Consume it once and navigate to the table.
  $effect(() => {
    if (poker.pendingNav) {
      const id = poker.pendingNav;
      poker.clearNav();
      goto("/table/" + id);
    }
  });

  function quickPlay() {
    if (!signedIn) return;
    poker.quickPlay();
  }
  function openModal() {
    if (!signedIn) return;
    showModal = true;
  }
  function createTable(cfg) {
    poker.createTable(cfg);
    showModal = false;
  }

  const isBlackjack = $derived(gameMode === "blackjack");
</script>

<svelte:head><title>{SITE_NAME} — Lobby</title></svelte:head>

<div class="lobby-shell">
  <!-- Incoming invites banner stack -->
  {#if poker.invites.length}
    <section class="invites">
      {#each poker.invites as inv (inv.inviteId)}
        <div class="card invite-card">
          <div class="invite-text">
            <strong>{inv.fromName}</strong> invited you to
            <strong>{inv.tableName || "a table"}</strong>.
          </div>
          <div class="invite-actions">
            <button class="btn btn-sm" onclick={() => poker.respondInvite(inv.inviteId, true)}>Accept</button>
            <button class="btn btn-sm btn-secondary" onclick={() => poker.respondInvite(inv.inviteId, false)}>Decline</button>
          </div>
        </div>
      {/each}
    </section>
  {/if}

  <div class="panes">
    <!-- LEFT / main column -->
    <div class="main-col">
      <section class="hero">
        <div>
          <h1>{SITE_NAME}</h1>
          <p class="muted tagline">{SITE_TAGLINE}. Play-money Texas Hold'em — no real money, just chips and bragging rights.</p>
        </div>
        <span class="conn {poker.connected ? 'on' : 'off'}">
          {poker.connected ? "live" : "connecting…"}
        </span>
      </section>

      <section class="card">
        <div class="mode-pills" role="tablist" aria-label="Game mode">
          {#each GAME_MODES as m}
            <button
              type="button"
              class="mode-pill"
              class:on={gameMode === m.key}
              role="tab"
              aria-selected={gameMode === m.key}
              onclick={() => (gameMode = m.key)}
            >{m.label}</button>
          {/each}
        </div>

        <div class="card-head">
          <h3>{isBlackjack ? "Blackjack Tables" : "Ring Games — " + modeLabel}</h3>
          {#if signedIn}
            <span class="muted small">Chips: {walletChips.toLocaleString()}</span>
          {/if}
        </div>

        <div class="toolbar">
          {#if !isBlackjack}
            <button class="btn" onclick={quickPlay} disabled={!signedIn}>Quick Play</button>
          {/if}
          <button class="btn btn-secondary" onclick={openModal} disabled={!signedIn}>
            {isBlackjack ? "New Blackjack Table" : "New Table"}
          </button>
          {#if !signedIn}
            <span class="muted small signin-note">
              <a href="/account/login">Sign in</a> to play — you can watch the lobby freely.
            </span>
          {/if}
        </div>

        {#if tablesForMode.length === 0}
          <div class="empty-state">
            <p class="muted">
              {isBlackjack
                ? "No blackjack tables yet — start one and host, or let a bot bank it."
                : "No tables yet — hit Quick Play or start one."}
            </p>
          </div>
        {:else}
          <div class="table-wrap">
            <table class="lobby">
              <thead>
                <tr>
                  <th>Table</th>
                  <th class="num">{isBlackjack ? "Min bet" : "Stakes"}</th>
                  <th class="num">Players</th>
                  <th>Status</th>
                  <th>Host</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {#each tablesForMode as t (t.id)}
                  <tr>
                    <td class="name">
                      <span class="tname">{t.name}</span>
                      <span class="variant">{variantShort(t.variant)}</span>
                    </td>
                    <td class="num">{isBlackjack ? t.smallBlind : t.smallBlind + "/" + t.bigBlind}</td>
                    <td class="num players" class:full={t.seated >= t.maxSeats}>
                      {t.seated} / {t.maxSeats}
                    </td>
                    <td>
                      <span class="badge {t.status === 'playing' ? 'playing' : 'waiting'}">{t.status}</span>
                    </td>
                    <td class="host muted">{t.creatorName}</td>
                    <td class="num">
                      <button class="btn btn-sm" onclick={() => goto("/table/" + t.id)}>Open</button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>

      <!-- BOTTOM: lobby chat spans the main column -->
      <LobbyChat messages={poker.lobbyChat} onSend={(t) => poker.sendLobbyChat(t)} />
    </div>

    <!-- RIGHT column -->
    <aside class="side-col">
      <LobbyPlayers
        players={poker.lobby.players}
        leaderboard={poker.lobby.leaderboard}
        me={poker.me}
        onInvite={(uid) => poker.invitePlayer(uid)}
      />
    </aside>
  </div>
</div>

{#if showModal}
  <NewTableModal
    {walletChips}
    mode={gameMode}
    onCreate={createTable}
    onCancel={() => (showModal = false)}
  />
{/if}

<style>
  .lobby-shell { display: flex; flex-direction: column; gap: 12px; }

  .invites { display: flex; flex-direction: column; gap: 8px; }
  .invite-card {
    display: flex; align-items: center; justify-content: space-between;
    gap: 12px; margin-bottom: 0; border-color: var(--accent-strong);
    background: var(--accent-soft);
  }
  .invite-text { font-size: 13px; }
  .invite-actions { display: flex; gap: 6px; flex: 0 0 auto; }

  .panes {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 12px;
    align-items: start;
  }
  .main-col { min-width: 0; display: flex; flex-direction: column; }
  .side-col { min-width: 0; }

  .hero {
    display: flex; align-items: flex-start; justify-content: space-between;
    gap: 16px; margin: 4px 0 10px;
  }
  .hero h1 { margin: 0 0 4px; font-size: 30px; letter-spacing: 0.3px; }
  .tagline { margin: 0; }
  .conn {
    font-size: 12px; font-weight: 700; padding: 4px 10px; border-radius: 999px;
    text-transform: uppercase; letter-spacing: 0.5px; flex: 0 0 auto;
  }
  .conn.on { color: var(--ok); background: rgba(74, 222, 128, 0.12); }
  .conn.off { color: #e0a030; background: rgba(224, 160, 48, 0.12); }

  .small { font-size: 12.5px; }

  /* Game-mode pills (Poker / Blackjack) — the lobby's top-level game switch. */
  .mode-pills { display: flex; gap: 8px; margin-bottom: 12px; }
  .mode-pill {
    appearance: none; cursor: pointer;
    border: 1px solid var(--border); background: transparent; color: var(--text);
    border-radius: 999px; padding: 6px 16px; font-size: 13px; font-weight: 600;
    transition: border-color 0.12s, background 0.12s, color 0.12s;
  }
  .mode-pill:hover { border-color: var(--accent); }
  .mode-pill.on {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
  }

  .toolbar {
    display: flex; align-items: center; gap: 10px; flex-wrap: wrap;
    margin-bottom: 12px;
  }
  .signin-note { margin-left: 2px; }

  .empty-state {
    text-align: center; padding: 40px 16px;
    border: 1px dashed var(--border-strong); border-radius: 10px;
  }
  .empty-state p { margin: 0; }

  .table-wrap { overflow-x: auto; }
  table.lobby { width: 100%; border-collapse: collapse; font-size: 14px; }
  table.lobby th, table.lobby td { padding: 10px 12px; text-align: left; }
  table.lobby th.num, table.lobby td.num { text-align: right; }
  table.lobby thead th {
    font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.5px;
    color: var(--muted); border-bottom: 1px solid var(--border);
  }
  table.lobby tbody tr { border-bottom: 1px solid var(--border); }
  table.lobby tbody tr:hover { background: var(--surface-hover); }
  td.name .tname { font-weight: 700; display: block; }
  .variant { display: block; font-size: 11px; color: var(--muted); }
  .players.full { color: #e0a030; }
  .num { font-variant-numeric: tabular-nums; }
  .host { font-size: 12.5px; }

  .badge {
    display: inline-block; font-size: 11px; font-weight: 700;
    padding: 2px 9px; border-radius: 999px; text-transform: capitalize;
    letter-spacing: 0.3px;
  }
  .badge.waiting { color: var(--muted); background: var(--surface-hover); border: 1px solid var(--border); }
  .badge.playing { color: var(--ok); background: rgba(74, 222, 128, 0.12); border: 1px solid rgba(74, 222, 128, 0.35); }

  .btn-sm { padding: 5px 12px; font-size: 12px; }

  /* Panes stack on narrow screens. */
  @media (max-width: 860px) {
    .panes { grid-template-columns: 1fr; }
    .side-col { order: 2; }
  }
</style>
