<script>
  import { onMount, onDestroy } from "svelte";
  import { goto } from "$app/navigation";
  import { poker } from "$lib/poker/client.svelte.js";
  import { voice } from "$lib/poker/voice.svelte.js";
  import VoiceBar from "$lib/poker/components/VoiceBar.svelte";
  import { SITE_NAME } from "$lib/config.js";
  import PokerTable from "$lib/poker/components/PokerTable.svelte";
  import ActionBar from "$lib/poker/components/ActionBar.svelte";
  import DrawBar from "$lib/poker/components/DrawBar.svelte";
  import BankedTable from "$lib/poker/components/BankedTable.svelte";
  import BankedActionBar from "$lib/poker/components/BankedActionBar.svelte";
  import BetGameTable from "$lib/poker/components/BetGameTable.svelte";
  import BankedBetBar from "$lib/poker/components/BankedBetBar.svelte";
  import VideoPokerTable from "$lib/poker/components/VideoPokerTable.svelte";
  import VideoPokerBar from "$lib/poker/components/VideoPokerBar.svelte";
  import KenoTable from "$lib/poker/components/KenoTable.svelte";
  import KenoBar from "$lib/poker/components/KenoBar.svelte";
  import PaiGowTable from "$lib/poker/components/PaiGowTable.svelte";
  import PaiGowBar from "$lib/poker/components/PaiGowBar.svelte";
  import ShedTable from "$lib/poker/components/ShedTable.svelte";
  import ShedBar from "$lib/poker/components/ShedBar.svelte";
  import BuyInModal from "$lib/poker/components/BuyInModal.svelte";
  import TableChat from "$lib/poker/components/TableChat.svelte";
  import { variantLabel, isBanked as isBankedGame, isShedding } from "$lib/poker/games.js";
  import Select from "$lib/components/Select.svelte";
  import { fade, fly, scale } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";

  let { data } = $props();
  // Reactive: a River Sprint fold-teleport navigates /table/A -> /table/B on the
  // SAME route, which REUSES this component — so tableId must track the param, not
  // capture it once, or the page would stay bound to the old table.
  let tableId = $derived(data.table.id);

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
  // Number-pick games (keno) render a ticket grid.
  let pickGame = $derived(banked && !!view?.round?.pickGame);
  // Five-Card Draw's draw phase surfaces a "draw" action → show the discard UI.
  let isDrawTurn = $derived(!!turn && (turn.actions || []).some((a) => a.type === "draw"));
  // Hand-split games (pai gow) render a two-hand layout with a split picker.
  let setGame = $derived(banked && !!view?.round?.setGame);
  // Shedding games (Crazy Eights, Big Two) — player-vs-player, no house.
  let shedding = $derived(isShedding(gameKey));
  let shedGame = $derived(!!view?.round?.shedGame);
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
    "video-poker": [["basic", "Basic"], ["aggressive", "Aggressive"], ["tight", "Tight"]],
    slots: [["low", "Low stakes"], ["high", "High roller"]],
    keno: [["casual", "Casual"], ["chaser", "Jackpot chaser"]],
    craps: [["pass", "Pass Line"], ["dontpass", "Don't Pass"], ["field", "Field"]],
    "pai-gow": [["house", "House way"]],
    "crazy-eights": [["basic", "Basic"], ["reckless", "Reckless"]],
    "big-two": [["basic", "Basic"], ["leader", "Aggressive"]]
  };
  const botTiers = $derived(
    (banked || shedding) ? (BOT_TIERS[gameKey] || [["basic", "Basic"]]) : [["reg", "Reg"], ["fish", "Fish"], ["shark", "Shark"], ["pro", "Pro"]]
  );
  let botTier = $state("reg");
  $effect(() => { if (!botTiers.some(([k]) => k === botTier)) botTier = botTiers[0][0]; });
  // You STAKE a bot: its buy-in is funded from your wallet (the server picks
  // 100 big blinds, clamped to the table's buy-in range) and returns to you when
  // the bot leaves. Mirror that here so the cost is visible before you click.
  let botStake = $derived(config
    ? Math.max(config.minBuyin, Math.min(config.maxBuyin, config.bigBlind * 100))
    : 0);
  let canAffordBot = $derived(walletChips >= botStake);
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
  let rebuyFill = $derived.by(() => {
    const lo = Math.min(config?.bigBlind ?? 1, rebuyMax);
    return rebuyMax > lo ? ((rebuyAmount - lo) / (rebuyMax - lo)) * 100 : 0;
  });
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

  // Waitlist (a full table). Optimistic local flag; the server seats us + pulls us
  // in via a TABLE_CREATED nav when a seat opens. Clears once we're seated.
  let onWaitlist = $state(false);
  function joinWaitlist() { poker.joinWaitlist(tableId); onWaitlist = true; }
  function leaveWaitlist() { poker.leaveWaitlist(tableId); onWaitlist = false; }
  $effect(() => { if (isSeated) onWaitlist = false; });

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

  // Join the CURRENT table and stream its state — reactive so a fold-teleport
  // (component reused across /table/A -> /table/B) leaves A and joins B. On
  // cleanup, keep watching a table we're still SEATED at (multi-tabling), only
  // stop watching one we're merely spectating.
  $effect(() => {
    const id = tableId;
    poker.joinTable(id);
    return () => {
      const seatedHere = !!(poker.me && (poker.tables[id]?.seats || []).some((s) => s.userId === poker.me.id));
      if (!seatedHere) poker.leaveTable(id);
    };
  });

  // If the table we're on VANISHES (a River Sprint round ends and the pool tears
  // its tables down), don't strand the player on a dead felt — send them home.
  // Keyed on the exact tableId last seen live, so a teleport's brief null (before
  // the new table's state arrives) doesn't trip it.
  let _seenTable = $state(null);
  $effect(() => {
    if (view) _seenTable = tableId;
    else if (_seenTable === tableId) goto("/");
  });

  onMount(() => { window.addEventListener("chips", onChips); });
  onDestroy(() => {
    voice.leave(); // drop out of voice when leaving the table page
    if (typeof window !== "undefined") window.removeEventListener("chips", onChips);
    clearTimeout(_toastTimer);
  });
</script>

<svelte:head><title>{data.table.name} — {SITE_NAME}</title></svelte:head>

<section class="table-top">
  <a href="/" class="back">‹ Lobby</a>
  <h2>{data.table.name}</h2>
  <span class="stakes">
    {#if shedding}
      {variantLabel(gameKey)} · ante {config.smallBlind}
    {:else if banked}
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
  <div class="toast {toastMsg.level}" role="status" in:fly={{ y: d(-12), duration: d(DUR.base) }} out:fade={{ duration: d(DUR.fast) }}>{toastMsg.text}</div>
{/if}

{#if view?.tournament}
  {@const tny = view.tournament}
  <section class="tny-hud" transition:fly={{ y: d(-10), duration: d(DUR.base) }}>
    <span class="tny-badge">{tny.status === "complete" ? "🏆 Finished" : tny.status === "running" ? "Level " + tny.level : "Registering"}</span>
    {#if tny.blinds}<span>Blinds <b>{tny.blinds.sb}/{tny.blinds.bb}</b></span>{/if}
    <span>Prize pool <b>{tny.prizePool.toLocaleString()}</b></span>
    <span>{tny.remaining} left / {tny.registered}</span>
    {#if tny.status === "running"}<span class="muted">next level in {tny.nextLevelInHands}</span>{/if}
    {#if me && tny.places?.length}
      {@const myPlace = tny.places.find((p) => p.userId === me.id)}
      {#if myPlace}<span class="tny-place">You finished #{myPlace.place}</span>{/if}
    {/if}
  </section>
{/if}

{#if view}
  {#if shedGame}
    <ShedTable {view} {me} onSit={openBuyIn} />
    {#if isSeated}
      <ShedBar hand={privates?.holeCards || []} {turn} onAct={(a) => poker.act(tableId, a)} />
    {/if}
  {:else if holdGame}
    <VideoPokerTable {view} {me} onSit={openBuyIn} />
    {#if turn}
      <VideoPokerBar {turn} onAct={(a) => poker.act(tableId, a)} />
    {/if}
  {:else if pickGame}
    <KenoTable {view} {me} onSit={openBuyIn} />
    {#if turn}
      <KenoBar {turn} onAct={(a) => poker.act(tableId, a)} />
    {/if}
  {:else if setGame}
    <PaiGowTable {view} {me} onSit={openBuyIn} />
    {#if turn}
      <PaiGowBar {turn} onAct={(a) => poker.act(tableId, a)} />
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
    {#if turn && isDrawTurn}
      <DrawBar cards={privates?.holeCards || []} onAct={(a) => poker.act(tableId, a)} />
    {:else if turn}
      <ActionBar
        {turn}
        {config}
        potTotal={view.potTotal}
        {myStack}
        onAct={(a) => poker.act(tableId, a)}
      />
    {/if}
  {/if}

  {#if me}
    <VoiceBar {tableId} />
  {/if}

  {#if isSeated}
    <section class="seat-controls" transition:fly={{ y: d(10), duration: d(DUR.base) }}>
      <button class="btn" onclick={stand}>Stand</button>
      <button class="btn" onclick={toggleSitOut}>
        {mySeat.sittingOut ? "Sit back in" : "Sit out"}
      </button>
      <button class="btn" onclick={openRebuy} disabled={rebuyMax <= 0}>Rebuy</button>
    </section>

    {#if hasOpenSeat}
      <section class="bot-controls" transition:fly={{ y: d(10), duration: d(DUR.base) }}>
        <span class="muted small">Add a bot:</span>
        <Select bind:value={botTier} options={botTiers.map(([value, label]) => ({ value, label }))} ariaLabel="Bot difficulty" />
        <button class="btn btn-secondary" onclick={addBot} disabled={!canAffordBot}>Add bot</button>
        <span class="muted small" title="You stake the bot: its buy-in comes from your chips and returns to you when it leaves.">
          stake {botStake.toLocaleString()}{#if !canAffordBot} · not enough chips{/if}
        </span>
      </section>
    {/if}
  {:else if me && !hasOpenSeat}
    <section class="seat-controls" transition:fly={{ y: d(10), duration: d(DUR.base) }}>
      {#if onWaitlist}
        <span class="muted small">You're on the waitlist — we'll seat you the moment a spot opens.</span>
        <button class="btn btn-secondary" onclick={leaveWaitlist}>Leave waitlist</button>
      {:else}
        <span class="muted small">Table's full.</span>
        <button class="btn" onclick={joinWaitlist}>Join waitlist</button>
      {/if}
    </section>
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
  <div class="modal-backdrop" onclick={() => (rebuyOpen = false)} role="presentation" transition:fade={{ duration: d(DUR.fast) }}>
    <div class="modal card" onclick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Rebuy" transition:scale={{ start: 0.96, duration: d(DUR.base) }}>
      <h3>Rebuy</h3>
      <p class="muted small">Top up your stack (max {rebuyMax.toLocaleString()} to reach the table cap).</p>
      <input
        class="rng"
        type="range"
        style="--fill:{rebuyFill}%"
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
  .tny-hud { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; margin: 10px 0;
    padding: 9px 15px; border-radius: var(--r-pill); font-size: 13px;
    background: var(--accent-soft); }
  .tny-hud b { font-variant-numeric: tabular-nums; }
  .tny-badge { font-weight: 700; padding: 2px 10px; border-radius: var(--r-pill); background: var(--accent); color: var(--on-accent); }
  .tny-place { font-weight: 700; color: var(--ok); }
  .table-top { display: flex; align-items: baseline; gap: 12px; margin: 16px 0; flex-wrap: wrap; }
  .table-top h2 { margin: 0; }
  .back { text-decoration: none; color: var(--muted, #9aa); font-size: 13px; }
  .stakes { color: var(--muted, #9aa); font-size: 13px; }
  .signin { color: var(--muted, #9aa); font-size: 13px; margin-left: auto; }
  .signin a { color: var(--hero, #6cf); }

  .toast {
    max-width: 520px; margin: 0 auto 12px; padding: 11px 15px; border-radius: var(--r-card);
    text-align: center; font-size: 14px; box-shadow: var(--shadow-card);
    background: var(--surface); color: var(--text);
  }
  .toast.error { color: var(--danger); box-shadow: 0 0 0 2px var(--danger), var(--shadow-card); }

  .seat-controls {
    display: flex; gap: 10px; justify-content: center; margin: 14px 0 6px; flex-wrap: wrap;
  }
  .bot-controls {
    display: flex; gap: 8px; align-items: center; justify-content: center; margin: 6px 0 10px; flex-wrap: wrap;
  }
  .bot-controls select {
    padding: 7px 10px; border-radius: var(--r-btn);
    border: 0; background: var(--well); color: var(--text);
  }
  .bot-controls .small { font-size: 12.5px; }

  .felt-shell { display: flex; justify-content: center; padding: 18px 0 30px; }
  .felt {
    width: min(820px, 96vw); aspect-ratio: 16 / 9;
    display: flex; align-items: center; justify-content: center;
  }
  .felt-center { text-align: center; color: var(--muted); }
  .small { font-size: 12px; opacity: 0.8; }

  .modal-backdrop {
    position: fixed; inset: 0; background: rgba(0,0,0,0.6);
    display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px;
  }
  .modal { width: min(420px, 94vw); padding: 20px; display: flex; flex-direction: column; gap: 12px; }
  .modal h3 { margin: 0; }
  .modal .range { width: 100%; }
  .modal .num {
    width: 100%; padding: 9px 11px; border-radius: var(--r-btn);
    border: 0; background: var(--well); color: var(--text);
  }
  .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 4px; }
  .btn.primary { background: var(--accent); color: var(--on-accent); }
  .btn.ghost { background: var(--well); box-shadow: none; }
</style>
