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
  import { slidingIndicator } from "$lib/actions/slider.js";
  import { fade, fly } from "svelte/transition";
  import { flip } from "svelte/animate";
  import { d, DUR } from "$lib/motion.js";

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

  const isBanked = $derived(gameMode !== "poker");

  // Tournaments (Sit-N-Go). Shown only in poker mode.
  const tournaments = $derived(poker.lobby.tournaments || []);
  const myId = $derived(poker.me?.id ?? null);
  const isRegistered = (t) => !!myId && (t.entrantIds || []).includes(myId);
  function newTournament() {
    if (!signedIn) return;
    poker.createTournament({ variant: "holdem", entry: 500, startingStack: 1500, maxSeats: 6 });
  }
</script>

<svelte:head><title>{SITE_NAME} — Lobby</title></svelte:head>

<div class="lobby-shell">
  <!-- Incoming invites banner stack -->
  {#if poker.invites.length}
    <section class="invites">
      {#each poker.invites as inv (inv.inviteId)}
        <div class="card invite-card" in:fly={{ y: d(-10), duration: d(DUR.base) }} out:fade={{ duration: d(DUR.fast) }} animate:flip={{ duration: d(DUR.base) }}>
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
          <span class="eyebrow">Play-money · just chips</span>
          <h1>{SITE_NAME}<span class="conn {poker.connected ? 'on' : 'off'}">{poker.connected ? "live" : "connecting…"}</span></h1>
        </div>
      </section>

      <div class="modes-wrap">
        <div class="mode-pager slider" role="tablist" aria-label="Game mode" use:slidingIndicator>
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
      </div>

      <div class="row-head">
        <h3>{isBanked ? modeLabel + " tables" : "Ring games"}</h3>
        <div class="toolbar">
          {#if !isBanked}
            <button class="btn btn-sm" onclick={quickPlay} disabled={!signedIn}>Quick Play</button>
          {/if}
          <button class="btn btn-secondary btn-sm" onclick={openModal} disabled={!signedIn}>
            {isBanked ? "New table" : "New table"}
          </button>
        </div>
      </div>
      {#if !signedIn}
        <p class="muted small signin-note"><a href="/account/login">Sign in</a> to play — watch the lobby freely.</p>
      {/if}

      {#if tablesForMode.length === 0}
        <div class="empty-state">
          <p class="muted">
            {isBanked
              ? "No " + modeLabel + " tables yet — start one and host, or let a bot bank it."
              : "No tables yet — hit Quick Play or start one."}
          </p>
        </div>
      {:else}
        <div class="table-grid">
          {#each tablesForMode as t (t.id)}
            <div class="tcard" in:fly={{ y: d(10), duration: d(DUR.base) }} out:fade={{ duration: d(DUR.fast) }} animate:flip={{ duration: d(DUR.base) }}>
              <div class="tcard-top">
                <div>
                  <div class="variant">{t.name}</div>
                  <div class="stakes">{variantShort(t.variant)} · {isBanked ? "min " + t.smallBlind : t.smallBlind + "/" + t.bigBlind}</div>
                </div>
                <span class="tag {t.status === 'playing' ? 'playing' : 'open'}">{t.status}</span>
              </div>
              <div class="pips" aria-label="{t.seated} of {t.maxSeats} seated">
                {#each Array(t.maxSeats) as _, i}<span class="pip" class:on={i < t.seated}></span>{/each}
                <span class="seats-lbl">{t.seated}/{t.maxSeats}</span>
              </div>
              <button class="btn btn-block" onclick={() => goto("/table/" + t.id)}>
                {t.seated >= t.maxSeats ? "Watch" : "Join ▸"}
              </button>
            </div>
          {/each}
        </div>
      {/if}

      {#if !isBanked}
        <section class="tny">
          <div class="row-head">
            <h3>Sit &amp; Go</h3>
            <button class="btn btn-gold btn-sm" onclick={newTournament} disabled={!signedIn}>＋ New</button>
          </div>
          {#if tournaments.length === 0}
            <div class="empty-state"><p class="muted">No tournaments yet — start a Sit &amp; Go (6-max, 500 entry). Empty seats fill with bots.</p></div>
          {:else}
            {#each tournaments as t (t.id)}
              <div class="trow" in:fly={{ y: d(10), duration: d(DUR.base) }} out:fade={{ duration: d(DUR.fast) }} animate:flip={{ duration: d(DUR.base) }}>
                <div class="tcol tmain"><div class="tname">{t.name}</div><div class="tvar">{variantShort(t.variant)}</div></div>
                <div class="tcol"><span class="lbl">Entry</span><span class="num">{t.entry.toLocaleString()}</span></div>
                <div class="tcol"><span class="lbl">Prize</span><span class="prize">{t.prizePool.toLocaleString()}</span></div>
                <div class="tcol hide-m">
                  <span class="tag {t.status === 'running' ? 'playing' : 'open'}">
                    {t.status}{#if t.status !== "registering"} · {t.remaining} left{:else} · {t.registered}/{t.maxSeats}{/if}
                  </span>
                </div>
                <div class="tcol tact">
                  {#if t.status === "registering"}
                    {#if isRegistered(t)}
                      {#if t.createdBy === myId}
                        <button class="btn btn-xs" onclick={() => poker.startTournament(t.id)} disabled={t.registered < 1}>Start</button>
                      {/if}
                      <button class="btn btn-xs btn-secondary" onclick={() => poker.unregisterTournament(t.id)}>Leave</button>
                    {:else}
                      <button class="btn btn-xs btn-gold" onclick={() => poker.registerTournament(t.id)} disabled={!signedIn}>Register</button>
                    {/if}
                  {:else}
                    <button class="btn btn-xs" onclick={() => goto("/table/" + t.id)}>{isRegistered(t) ? "Resume" : "Watch"}</button>
                  {/if}
                </div>
              </div>
            {/each}
          {/if}
        </section>
      {/if}

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
    gap: 12px; margin-bottom: 0; background: var(--accent-soft);
  }
  .invite-text { font-size: 13px; }
  .invite-actions { display: flex; gap: 6px; flex: 0 0 auto; }

  .panes {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 300px;
    gap: 16px;
    align-items: start;
  }
  .main-col { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .side-col { min-width: 0; }

  .hero { margin: 6px 0 16px; }
  .hero h1 { margin: 6px 0 0; font-size: clamp(28px, 3.4vw, 38px); display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .conn {
    font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: var(--r-pill);
    text-transform: uppercase; letter-spacing: 0.5px;
    font-family: var(--f-body);
  }
  .conn.on { color: var(--ok); background: var(--ok-bg); }
  .conn.off { color: var(--gold-ink); background: var(--gold-bg); }

  .small { font-size: 12.5px; }
  .signin-note { margin: 0 0 12px; }

  /* game-mode pager — a sliding selector box, horizontally scrollable */
  .modes-wrap { overflow-x: auto; margin-bottom: 20px; padding: 4px 0 6px; scrollbar-width: none; }
  .modes-wrap::-webkit-scrollbar { display: none; }
  .mode-pager { display: inline-flex; gap: 4px; }
  .mode-pager .sel-ind { background: var(--accent); box-shadow: var(--shadow-card); }
  .mode-pill {
    flex: 0 0 auto; cursor: pointer; border: 0; background: transparent; color: var(--muted);
    border-radius: var(--r-pill); padding: 8px 15px; font-weight: 600; font-size: 13px; white-space: nowrap;
    transition: color var(--dur) var(--ease);
  }
  .mode-pill:hover { color: var(--text); }
  .mode-pill.on { color: var(--on-accent); }

  .row-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin: 6px 0 14px; }
  .row-head h3 { font-size: 19px; margin: 0; }
  .toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }

  .empty-state { text-align: center; padding: 34px 16px; background: var(--well); border-radius: var(--r-card); }
  .empty-state p { margin: 0; }

  .table-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(258px, 1fr)); gap: 14px; }
  .tcard { border-radius: var(--r-card); background: var(--surface); padding: 16px; box-shadow: var(--shadow-card);
    transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
  .tcard:hover { transform: translateY(-3px); box-shadow: var(--shadow-hover); }
  .tcard-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
  .tcard .variant { font-weight: 700; font-size: 15px; }
  .tcard .stakes { color: var(--muted); font-size: 12px; margin-top: 2px; font-variant-numeric: tabular-nums; }
  .pips { display: flex; align-items: center; gap: 5px; margin: 15px 0; }
  .pip { width: 9px; height: 9px; border-radius: 50%; background: var(--well); box-shadow: inset 0 0 0 1px rgba(128,128,128,.18); }
  .pip.on { background: var(--accent); box-shadow: none; }
  .seats-lbl { color: var(--muted); font-size: 12px; margin-left: 6px; font-variant-numeric: tabular-nums; }
  .btn-block { width: 100%; }

  /* tournaments — borderless spaced row-cards */
  .tny { margin-top: 22px; }
  .trow { display: grid; grid-template-columns: 1.6fr .7fr .8fr 1fr auto; align-items: center; gap: 12px;
    background: var(--surface); border-radius: var(--r-card); padding: 12px 16px; box-shadow: var(--shadow-card); margin-bottom: 8px;
    transition: transform var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
  .trow:hover { transform: translateY(-2px); box-shadow: var(--shadow-hover); }
  .trow .tname { font-weight: 700; font-size: 14px; }
  .trow .tvar { color: var(--muted); font-size: 11.5px; }
  .trow .lbl { color: var(--faint); font-size: 10px; letter-spacing: .08em; text-transform: uppercase; font-weight: 700; display: block; margin-bottom: 2px; }
  .trow .num { font-variant-numeric: tabular-nums; font-weight: 700; font-size: 14px; }
  .trow .prize { color: var(--gold-ink); font-variant-numeric: tabular-nums; font-weight: 800; font-size: 14px; }
  .trow .tact { display: flex; gap: 6px; justify-content: flex-end; }

  @media (max-width: 860px) {
    .panes { grid-template-columns: 1fr; }
    .side-col { order: 2; }
  }
  @media (max-width: 560px) {
    .trow { grid-template-columns: 1fr auto; row-gap: 8px; }
    .trow .hide-m { display: none; }
  }
</style>
