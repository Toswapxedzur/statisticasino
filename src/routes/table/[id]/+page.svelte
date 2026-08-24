<script>
  import { onMount, onDestroy } from "svelte";
  import { poker } from "$lib/poker/client.svelte.js";
  import { SITE_NAME } from "$lib/config.js";
  import PokerTable from "$lib/poker/components/PokerTable.svelte";
  import ActionBar from "$lib/poker/components/ActionBar.svelte";
  import BankedTable from "$lib/poker/components/BankedTable.svelte";
  import BankedActionBar from "$lib/poker/components/BankedActionBar.svelte";
  import BetGameTable from "$lib/poker/components/BetGameTable.svelte";
  import BankedBetBar from "$lib/poker/components/BankedBetBar.svelte";
  import VideoPokerTable from "$lib/poker/components/VideoPokerTable.svelte";
  import VideoPokerBar from "$lib/poker/components/VideoPokerBar.svelte";
  import BuyInModal from "$lib/poker/components/BuyInModal.svelte";
  import TableChat from "$lib/poker/components/TableChat.svelte";
  import { variantLabel, isBanked as isBankedGame } from "$lib/poker/games.js";

  let { data } = $props();
  const tableId = data.table.id;

  // --- reactive live state from the shared client singleton ---
  let view = $derived(poker.tables[tableId] || null);
  let privates = $derived(poker.privates[tableId] || null);
  let turn = $derived(poker.turns[tableId] || null);
  let chat = $derived(poker.chat[tableId] || []);
  let me = $derived(poker.me);

  // Config has the same shape as the SSR-loaded table row; prefer the live
  // view's config once it arrives, fall back to the server-rendered one.
  let config = $derived(view?.config || data.table);
  // Banked games (blackjack, casino-holdem, …) run on GameTable and render with
  // the generic banked components; poker uses the poker table.
  let gameKey = $derived(view?.game || config?.variant);
  let banked = $derived(isBankedGame(gameKey));
  // Bet-selection games (baccarat/roulette/…) render a betting layout, not a hand.
  let betGame = $derived(banked && !!view?.round?.betSelection);
  // Hold-and-draw games (video poker) render an interactive five-card layout.
  let holdGame = $derived(banked && !!view?.round?.holdGame);
  let rules = $derived(view?.rules || null);

  // Add-bot control: tiers depend on the game; keep the selection valid.
  const BOT_TIERS = {
    blackjack: [["basic", "Basic"], ["aggressive", "Aggressive"], ["timid", "Timid"]],
    "casino-holdem": [["basic", "Basic"], ["loose", "Loose"], ["tight", "Tight"]],
    "three-card": [["basic", "Basic"], ["loose", "Loose"], ["tight", "Tight"]],
    baccarat: [["banker", "Banker"], ["player", "Player"], ["tie", "Tie"]],
    roulette: [["red", "Red"], ["black", "Black"], ["lucky", "Lucky 7"]],
    "sic-bo": [["small", "Small"], ["big", "Big"], ["triple", "Any Triple"]],
    "dragon-tiger": [["dragon", "Dragon"], ["tiger", "Tiger"], ["tie", "Tie"]],
    "casino-war": [["ante", "Player"], ["tie", "Tie"]],
    "andar-bahar": [["bahar", "Bahar"], ["andar", "Andar"]],
    "money-wheel": [["one", "$1"], ["twenty", "$20"], ["joker", "Joker"]],
    "caribbean-stud": [["basic", "Basic"], ["aggressive", "Aggressive"], ["tight", "Tight"]],
    "red-dog": [["basic", "Basic"], ["aggressive", "Aggressive"], ["tight", "Tight"]],
    "ultimate-holdem": [["basic", "Basic"], ["aggressive", "Aggressive"], ["tight", "Tight"]],
    "let-it-ride": [["basic", "Basic"], ["aggressive", "Aggressive"], ["tight", "Tight"]],
    "video-poker": [["basic", "Basic"], ["aggressive", "Aggressive"], ["tight", "Tight"]]
  };
  const botTiers = $derived(
    banked ? (BOT_TIERS[gameKey] || [["basic", "Basic"]]) : [["reg", "Reg"], ["fish", "Fish"]]
  );
  let botTier = $state("reg");
  $effect(() => { if (!botTiers.some(([k]) => k === botTier)) botTier = botTiers[0][0]; });
  let seatCount = $derived(view ? (view.seats || []).length : 0);
  let hasOpenSeat = $derived(seatCount < (config?.maxSeats ?? 0));
  function addBot() { poker.addBot(tableId, botTier); }

  // My seat (if any) drives the seated-player controls.
  let mySeat = $derived(
    me && view ? (view.seats || []).find((s) => s.userId === me.id) || null : null
  );
  let isSeated = $derived(!!mySeat);
  let myStack = $derived(mySeat ? mySeat.stack : 0);

  // Wallet balance: SSR value, kept live via the client's "chips" event so
  // the buy-in / rebuy caps stay accurate after wallet changes.
  let walletChips = $state(data.walletChips ?? 0);

  // --- buy-in modal ---
  let buyInSeat = $state(null);
  function openBuyIn(seat) {
    if (!me) {
      poker.toast = { level: "error", text: "Sign in to play." };
      return;
    }
    buyInSeat = seat;
  }
  function confirmBuyIn(amount) {
    if (buyInSeat != null) poker.sit(tableId, buyInSeat, amount);
    buyInSeat = null;
  }

  // --- rebuy modal ---
  let rebuyOpen = $state(false);
  let rebuyAmount = $state(0);
  let rebuyMax = $derived(mySeat ? Math.max(0, config.maxBuyin - mySeat.stack) : 0);
  function openRebuy() {
    rebuyAmount = Math.min(rebuyMax, Math.max(config.minBuyin, config.bigBlind * 20));
    rebuyOpen = true;
  }
  function confirmRebuy() {
    const amt = Math.max(1, Math.min(rebuyMax, Math.round(rebuyAmount)));
    if (amt > 0) poker.rebuy(tableId, amt);
    rebuyOpen = false;
  }

  function stand() { poker.stand(tableId); }
  function toggleSitOut() { if (mySeat) poker.sitOut(tableId, !mySeat.sittingOut); }

  // --- transient toast ---
  let toastMsg = $state(null);
  let _toastTimer = null;
  $effect(() => {
    const t = poker.toast;
    if (!t) return;
    toastMsg = t;
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => { toastMsg = null; poker.toast = null; }, 3500);
  });

  function onChips(e) {
    if (typeof e.detail === "number") walletChips = e.detail;
  }

  onMount(() => {
    poker.joinTable(tableId);
    window.addEventListener("chips", onChips);
  });
  onDestroy(() => {
    poker.leaveTable(tableId);
    if (typeof window !== "undefined") window.removeEventListener("chips", onChips);
    clearTimeout(_toastTimer);
  });
</script>

<svelte:head><title>{data.table.name} — {SITE_NAME}</title></svelte:head>

<section class="table-top">
  <a href="/" class="back">‹ Lobby</a>
  <h2>{data.table.name}</h2>
  <span class="stakes">
    {#if banked}
      {variantLabel(gameKey)} · min bet {config.smallBlind}{#if rules && rules.blackjackPays} · {rules.blackjackPays} · {rules.decks} deck{rules.decks > 1 ? "s" : ""} · {rules.dealerHitsSoft17 ? "H17" : "S17"}{rules.surrender ? " · surrender" : ""}{rules.peek === false ? " · no-peek" : ""}{/if}
    {:else}
      {variantLabel(config.variant)} · {config.smallBlind}/{config.bigBlind}
    {/if}
    · buy-in {config.minBuyin.toLocaleString()}–{config.maxBuyin.toLocaleString()}</span>
  {#if !me}
    <span class="signin">Watching — <a href="/account/login">Sign in to play</a></span>
  {/if}
</section>

{#if toastMsg}
  <div class="toast {toastMsg.level}" role="status">{toastMsg.text}</div>
{/if}

{#if view}
  {#if holdGame}
    <VideoPokerTable {view} {me} onSit={openBuyIn} />
    {#if turn}
      <VideoPokerBar {turn} onAct={(a) => poker.act(tableId, a)} />
    {/if}
  {:else if betGame}
    <BetGameTable {view} {me} onSit={openBuyIn} />
    {#if turn}
      <BankedBetBar {turn} onAct={(a) => poker.act(tableId, a)} />
    {/if}
  {:else if banked}
    <BankedTable {view} {me} onSit={openBuyIn} />
    {#if turn}
      <BankedActionBar {turn} onAct={(a) => poker.act(tableId, a)} />
    {/if}
  {:else}
    <PokerTable {view} {me} {privates} onSit={openBuyIn} />
    {#if turn}
      <ActionBar
        {turn}
        {config}
        potTotal={view.potTotal}
        {myStack}
        onAct={(a) => poker.act(tableId, a)}
      />
    {/if}
  {/if}

  {#if isSeated}
    <section class="seat-controls">
      <button class="btn" onclick={stand}>Stand</button>
      <button class="btn" onclick={toggleSitOut}>
        {mySeat.sittingOut ? "Sit back in" : "Sit out"}
      </button>
      <button class="btn" onclick={openRebuy} disabled={rebuyMax <= 0}>Rebuy</button>
    </section>

    {#if hasOpenSeat}
      <section class="bot-controls">
        <span class="muted small">Add a bot:</span>
        <select bind:value={botTier} aria-label="Bot difficulty">
          {#each botTiers as [k, label]}<option value={k}>{label}</option>{/each}
        </select>
        <button class="btn btn-secondary" onclick={addBot}>Add bot</button>
      </section>
    {/if}
  {/if}
{:else}
  <section class="felt-shell">
    <div class="felt">
      <div class="felt-center">
        <p class="muted">{poker.connected ? "Loading table…" : "Connecting…"}</p>
      </div>
    </div>
  </section>
{/if}

<TableChat messages={chat || []} onSend={(t) => poker.sendChat(tableId, t)} />

{#if buyInSeat != null}
  <BuyInModal
    {config}
    {walletChips}
    seat={buyInSeat}
    onConfirm={confirmBuyIn}
    onCancel={() => (buyInSeat = null)}
  />
{/if}

{#if rebuyOpen}
  <div class="modal-backdrop" onclick={() => (rebuyOpen = false)} role="presentation">
    <div class="modal card" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Rebuy">
      <h3>Rebuy</h3>
      <p class="muted small">Top up your stack (max {rebuyMax.toLocaleString()} to reach the table cap).</p>
      <input
        class="range"
        type="range"
        min={Math.min(config.bigBlind, rebuyMax)}
        max={rebuyMax}
        step={config.bigBlind || 1}
        bind:value={rebuyAmount}
      />
      <input class="num" type="number" min="1" max={rebuyMax} bind:value={rebuyAmount} />
      <div class="modal-actions">
        <button class="btn ghost" onclick={() => (rebuyOpen = false)}>Cancel</button>
        <button class="btn primary" onclick={confirmRebuy} disabled={rebuyAmount <= 0}>
          Rebuy {Math.round(rebuyAmount).toLocaleString()}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .table-top { display: flex; align-items: baseline; gap: 12px; margin: 16px 0; flex-wrap: wrap; }
  .table-top h2 { margin: 0; }
  .back { text-decoration: none; color: var(--muted, #9aa); font-size: 13px; }
  .stakes { color: var(--muted, #9aa); font-size: 13px; }
  .signin { color: var(--muted, #9aa); font-size: 13px; margin-left: auto; }
  .signin a { color: var(--hero, #6cf); }

  .toast {
    max-width: 520px; margin: 0 auto 12px; padding: 10px 14px; border-radius: 10px;
    text-align: center; font-size: 14px; border: 1px solid var(--border, #333);
    background: #1c1c22; color: var(--text, #eee);
  }
  .toast.error { border-color: #e0555f; color: #ffb3b8; background: #2a1618; }

  .seat-controls {
    display: flex; gap: 10px; justify-content: center; margin: 14px 0 6px; flex-wrap: wrap;
  }
  .bot-controls {
    display: flex; gap: 8px; align-items: center; justify-content: center; margin: 6px 0 10px; flex-wrap: wrap;
  }
  .bot-controls select {
    padding: 6px 10px; border-radius: 8px;
    border: 1px solid var(--border, #333); background: #0e0e12; color: var(--text, #eee);
  }
  .bot-controls .small { font-size: 12.5px; }

  .felt-shell { display: flex; justify-content: center; padding: 10px 0 30px; }
  .felt {
    width: min(900px, 96vw); aspect-ratio: 16 / 9;
    border-radius: 180px / 120px;
    background: radial-gradient(ellipse at center, #2e7d55 0%, #1f6043 70%, #17402f 100%);
    border: 14px solid #5b3a24;
    box-shadow: inset 0 0 60px rgba(0,0,0,0.4), 0 20px 40px rgba(0,0,0,0.35);
    display: flex; align-items: center; justify-content: center;
  }
  .felt-center { text-align: center; color: #dfeee6; }
  .small { font-size: 12px; opacity: 0.8; }

  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px;
  }
  .modal { width: min(420px, 94vw); padding: 20px; display: flex; flex-direction: column; gap: 12px; }
  .modal h3 { margin: 0; }
  .modal .range { width: 100%; }
  .modal .num {
    width: 100%; padding: 8px 10px; border-radius: 8px;
    border: 1px solid var(--border, #333); background: #0e0e12; color: var(--text, #eee);
  }
  .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 4px; }
  .btn.primary { background: var(--hero, #2e7d55); color: #fff; }
  .btn.ghost { background: transparent; }
</style>
