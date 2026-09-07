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
  import Chip from "$lib/poker/components/Chip.svelte";
  import Num from "$lib/poker/components/Num.svelte";
  import { variantLabel, isBanked as isBankedGame, isShedding } from "$lib/poker/games.js";
  import Select from "$lib/components/Select.svelte";
  import { fade, fly, scale } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";
  import { play, playBurst, soundEnabled, setSoundEnabled } from "$lib/sfx.js";
  import { tableSoundCues } from "$lib/poker/table-sfx.js";

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

  // ---- card picking: the cards live under my seat badge; the bars only hold buttons ----
  // draw (Five-Card Draw discards) / hold (Video Poker) → indices; set (Pai Gow front) /
  // shed (Crazy Eights, Big Two) → card strings. Reset whenever the turn changes.
  let picked = $state([]);
  let pendingEight = $state(null);
  const pickMode = $derived(!turn ? null : isDrawTurn ? "draw" : holdGame ? "hold" : setGame ? "set" : shedGame ? "shed" : null);
  const turnSig = $derived(turn ? [pickMode, turn.deadline, (turn.cards || turn.hand || []).join(",")].join("|") : "");
  $effect(() => { turnSig; picked = []; pendingEight = null; });
  const pick = $derived.by(() => {
    if (!pickMode) return null;
    const byIndex = pickMode === "draw" || pickMode === "hold";
    const single = pickMode === "shed" && !turn.combo;
    const legal = single ? new Set(turn.legal || []) : null;
    const labels = { draw: "discard", hold: "held", set: "front", shed: "play" };
    return {
      selected: new Set(picked), legal,
      keyOf: (i, c) => (byIndex ? i : c),
      labelOf: () => labels[pickMode],
      onSelect: (k) => {
        if (single) {
          if (!legal.has(k)) return;
          if (k[0] === "8") { pendingEight = k; return; }
          poker.act(tableId, { type: "play", card: k });
          return;
        }
        if (picked.includes(k)) picked = picked.filter((x) => x !== k);
        else if (pickMode === "set" && picked.length >= 2) return;
        else picked = [...picked, k];
      }
    };
  });
  // Who we're waiting on (for the action column when it isn't my turn).
  const actorName = $derived.by(() => {
    const no = view?.toActSeat ?? view?.round?.toActSeat ?? null;
    if (no == null) return null;
    return (view?.seats || []).find((x) => x.seat === no)?.name ?? null;
  });
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

  // --- sound effects (see $lib/sfx.js) ---
  let sfxOn = $state(true);
  onMount(() => { sfxOn = soundEnabled(); });
  function toggleSfx() { sfxOn = !sfxOn; setSoundEnabled(sfxOn); }
  let _prevView = null;
  $effect(() => {
    const v = view;
    const prev = _prevView; _prevView = v;
    if (!v || !prev || prev.id !== v.id) return;
    for (const c of tableSoundCues(prev, v, me?.id ?? null)) {
      if (c.count) playBurst(c.name, c.count, c.gap, { delay: c.delay, volume: c.volume });
      else play(c.name, { delay: c.delay, volume: c.volume });
    }
  });
  // Your turn: the server sends TABLE_TURN only to the acting player.
  let _prevTurnDeadline = null;
  $effect(() => {
    const t = poker.turns[tableId] || null;
    const dl = t?.deadline ?? null;
    if (dl && dl !== _prevTurnDeadline) play("turn");
    _prevTurnDeadline = dl;
  });
  // Last five seconds of my clock: one tick per second.
  $effect(() => {
    const dl = poker.turns[tableId]?.deadline ?? null;
    if (!dl) return;
    let last = -1;
    const iv = setInterval(() => {
      const left = Math.ceil((dl - Date.now()) / 1000);
      if (left <= 5 && left > 0 && left !== last) { last = left; play("tick"); }
      if (left <= 0) clearInterval(iv);
    }, 200);
    return () => clearInterval(iv);
  });
  // Tournament / Sprint round goes live: a short fanfare.
  let _prevTnyStatus = null;
  $effect(() => {
    const st = view?.tournament?.status ?? null;
    if (_prevTnyStatus && st === "running" && _prevTnyStatus !== "running") play("fanfare");
    _prevTnyStatus = st;
  });
  // Idle on my turn: a quiet chip riffle every few seconds after the first 5 s.
  $effect(() => {
    const dl = poker.turns[tableId]?.deadline ?? null;
    if (!dl) return;
    const t0 = Date.now();
    const iv = setInterval(() => { if (Date.now() - t0 >= 5000 && dl - Date.now() > 6000) play("think"); }, 7000);
    return () => clearInterval(iv);
  });

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

<div class="tablepage">
  <!-- slim overlay strip: no site bar on a table -->
  <div class="hud">
    <a href="/" class="back" aria-label="Back to lobby" title="Lobby">‹</a>
    <div class="title">
      <b>{data.table.name}</b>
      <span class="stakes">
        {#if shedding}{variantLabel(gameKey)} · ante {config.smallBlind}
        {:else if banked}{variantLabel(gameKey)} · min bet {config.smallBlind}{#if rules && rules.blackjackPays} · {rules.blackjackPays} · {rules.decks} deck{rules.decks > 1 ? "s" : ""} · {rules.dealerHitsSoft17 ? "H17" : "S17"}{rules.surrender ? " · surrender" : ""}{rules.peek === false ? " · no-peek" : ""}{/if}
        {:else}{variantLabel(config.variant)} · {config.smallBlind}/{config.bigBlind}{/if}
        · buy-in {config.minBuyin.toLocaleString()}–{config.maxBuyin.toLocaleString()}
      </span>
    </div>
    {#if !me}<span class="signin">Watching — <a href="/account/login">Sign in to play</a></span>{/if}
    <div class="hud-right">
      {#if me}<a class="wallet" href="/account" title="Your chips"><Chip value={walletChips} size={14} /><Num value={walletChips} /></a>{/if}
      <button type="button" class="sfx-btn" class:off={!sfxOn} onclick={toggleSfx} title={sfxOn ? "Mute table sounds" : "Unmute table sounds"} aria-pressed={sfxOn}>{sfxOn ? "🔊" : "🔇"}</button>
    </div>
  </div>

  {#if toastMsg}
    <div class="toast {toastMsg.level}" role="status" in:fly={{ y: d(-12), duration: d(DUR.base) }} out:fade={{ duration: d(DUR.fast) }}>{toastMsg.text}</div>
  {/if}

  {#if view?.tournament}
    {@const tny = view.tournament}
    {@const isSprint = tny.kind === "sprint"}
    <section class="tny-hud" transition:fly={{ y: d(-10), duration: d(DUR.base) }}>
      <span class="tny-badge">{isSprint ? "⚡ River Sprint" : tny.status === "complete" ? "🏆 Finished" : tny.status === "running" ? "Level " + tny.level : "Registering"}</span>
      {#if tny.blinds}<span>Blinds <b>{tny.blinds.sb}/{tny.blinds.bb}</b></span>{/if}
      {#if !isSprint}<span>Prize pool <b>{(tny.prizePool ?? 0).toLocaleString()}</b></span>{/if}
      <span>{tny.remaining} left{#if !isSprint} / {tny.registered}{/if}</span>
      {#if !isSprint && tny.status === "running"}<span class="muted">next level in {tny.nextLevelInHands}</span>{/if}
      {#if me && tny.places?.length}
        {@const myPlace = tny.places.find((p) => p.userId === me.id)}
        {#if myPlace}<span class="tny-place">You finished #{myPlace.place}</span>{/if}
      {/if}
    </section>
  {/if}

  <!-- the arena: seats around the ring, my seat + big cards at the bottom -->
  <div class="arena-wrap">
    {#if view}
      {#if shedGame}
        <ShedTable {view} {me} hand={privates?.holeCards || []} onSit={openBuyIn} {pick} />
      {:else if holdGame}
        <VideoPokerTable {view} {me} onSit={openBuyIn} {pick} />
      {:else if pickGame}
        <KenoTable {view} {me} onSit={openBuyIn} />
      {:else if setGame}
        <PaiGowTable {view} {me} onSit={openBuyIn} {pick} />
      {:else if betGame}
        <BetGameTable {view} {me} onSit={openBuyIn} />
      {:else if banked}
        <BankedTable {view} {me} onSit={openBuyIn} {pick} />
      {:else}
        <PokerTable {view} {me} {privates} onSit={openBuyIn} {pick} />
      {/if}
    {:else}
      <div class="loading"><p class="muted">{poker.connected ? "Loading table…" : "Connecting…"}</p></div>
    {/if}
  </div>

  <!-- the dock: chat | my actions | seat controls -->
  <div class="dock">
    <div class="dock-chat">
      <TableChat messages={chat || []} onSend={(t) => poker.sendChat(tableId, t)} />
    </div>

    <div class="dock-actions">
      {#if view && turn}
        {#if shedGame}
          <ShedBar {turn} selected={picked} {pendingEight} onAct={(a) => poker.act(tableId, a)} onCancelEight={() => (pendingEight = null)} />
        {:else if holdGame}
          <VideoPokerBar {turn} selected={picked} onAct={(a) => poker.act(tableId, a)} />
        {:else if pickGame}
          <KenoBar {turn} onAct={(a) => poker.act(tableId, a)} />
        {:else if setGame}
          <PaiGowBar selected={picked} onAct={(a) => poker.act(tableId, a)} />
        {:else if betGame}
          <BankedBetBar {turn} onAct={(a) => poker.act(tableId, a)} />
        {:else if banked}
          <BankedActionBar {turn} onAct={(a) => poker.act(tableId, a)} />
        {:else if isDrawTurn}
          <DrawBar selected={picked} onAct={(a) => poker.act(tableId, a)} />
        {:else}
          <ActionBar {turn} {config} potTotal={view.potTotal} {myStack} onAct={(a) => poker.act(tableId, a)} />
        {/if}
      {:else if view && isSeated}
        <div class="waiting muted">{actorName ? `Waiting for ${actorName}…` : "Waiting for the next hand…"}</div>
      {:else if view && me && hasOpenSeat}
        <div class="waiting muted">Pick an empty seat to play.</div>
      {/if}
    </div>

    <div class="dock-side">
      {#if isSeated}
        <div class="seat-controls">
          <button class="btn" onclick={stand}>Stand</button>
          <button class="btn" onclick={toggleSitOut}>{mySeat.sittingOut ? "Sit back in" : "Sit out"}</button>
          <button class="btn" onclick={openRebuy} disabled={rebuyMax <= 0}>Rebuy</button>
        </div>
        {#if hasOpenSeat}
          <div class="bot-controls">
            <span class="muted small">Add a bot:</span>
            <Select bind:value={botTier} options={botTiers.map(([value, label]) => ({ value, label }))} ariaLabel="Bot difficulty" />
            <button class="btn btn-secondary" onclick={addBot} disabled={!canAffordBot}>Add bot</button>
            <span class="muted small" title="You stake the bot: its buy-in comes from your chips and returns to you when it leaves.">stake {botStake.toLocaleString()}{#if !canAffordBot} · not enough chips{/if}</span>
          </div>
        {/if}
      {:else if me && view && !hasOpenSeat}
        <div class="seat-controls">
          {#if onWaitlist}
            <span class="muted small">On the waitlist — we'll seat you when a spot opens.</span>
            <button class="btn btn-secondary" onclick={leaveWaitlist}>Leave waitlist</button>
          {:else}
            <span class="muted small">Table's full.</span>
            <button class="btn" onclick={joinWaitlist}>Join waitlist</button>
          {/if}
        </div>
      {/if}
      {#if me}<VoiceBar {tableId} />{/if}
    </div>
  </div>
</div>


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
  .tablepage { position: relative; display: flex; flex-direction: column; height: 100vh; height: 100dvh; overflow: hidden; }

  .hud { position: absolute; top: 0; left: 0; right: 0; z-index: 6; display: flex; align-items: center; gap: 12px; padding: 10px 14px; pointer-events: none; }
  .hud > * { pointer-events: auto; }
  .back { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 999px; background: var(--surface); color: var(--text); text-decoration: none; font-size: 22px; line-height: 1; box-shadow: var(--shadow-card); }
  .title { display: flex; flex-direction: column; line-height: 1.15; }
  .title b { font-family: var(--f-display); font-size: 17px; }
  .stakes { color: var(--muted); font-size: 12px; }
  .signin { color: var(--muted); font-size: 13px; }
  .signin a { color: var(--hero); }
  .hud-right { margin-left: auto; display: flex; align-items: center; gap: 8px; }
  .wallet { display: inline-flex; align-items: center; gap: 6px; padding: 5px 11px 5px 8px; border-radius: 999px; background: var(--surface); color: var(--gold-ink); font-weight: 800; font-size: 13px; text-decoration: none; box-shadow: var(--shadow-card); font-variant-numeric: tabular-nums; }
  .sfx-btn { appearance: none; border: 0; background: var(--surface); color: var(--text); border-radius: 999px; width: 34px; height: 34px; cursor: pointer; font-size: 15px; box-shadow: var(--shadow-card); }
  .sfx-btn.off { opacity: 0.55; }

  .toast { position: absolute; top: 56px; left: 50%; transform: translateX(-50%); z-index: 7; max-width: 520px; padding: 11px 15px; border-radius: var(--r-card); text-align: center; font-size: 14px; box-shadow: var(--shadow-card); background: var(--surface); color: var(--text); }
  .toast.error { color: var(--danger); box-shadow: 0 0 0 2px var(--danger), var(--shadow-card); }
  .tny-hud { position: absolute; top: 54px; left: 50%; transform: translateX(-50%); z-index: 5; display: flex; align-items: center; gap: 14px; flex-wrap: wrap; padding: 7px 14px; border-radius: var(--r-pill); font-size: 13px; background: var(--accent-soft); }
  .tny-hud b { font-variant-numeric: tabular-nums; }
  .tny-badge { font-weight: 700; padding: 2px 10px; border-radius: var(--r-pill); background: var(--accent); color: var(--on-accent); }
  .tny-place { font-weight: 700; color: var(--ok); }

  .arena-wrap { flex: 1; min-height: 0; position: relative; padding: 48px 8px 0; }
  .loading { height: 100%; display: grid; place-items: center; }

  .dock { flex: 0 0 auto; display: grid; grid-template-columns: minmax(240px, 1fr) minmax(360px, 2fr) minmax(240px, 1fr); gap: 12px; align-items: stretch; padding: 8px 14px 14px; height: 236px; }
  .dock-chat { min-width: 0; display: flex; flex-direction: column; }
  .dock-chat :global(.chat) { height: 100%; display: flex; flex-direction: column; min-height: 0; }
  .dock-chat :global(.chat .messages) { flex: 1; max-height: none; min-height: 0; }
  .dock-actions { display: flex; align-items: center; justify-content: center; min-width: 0; }
  .dock-actions > :global(*) { width: 100%; max-width: 640px; margin: 0; }
  .waiting { font-size: 14px; text-align: center; }
  .dock-side { display: flex; flex-direction: column; gap: 10px; justify-content: center; align-items: flex-start; min-width: 0; }
  .seat-controls { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  .bot-controls { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .bot-controls .small, .seat-controls .small { font-size: 12px; }
  .small { font-size: 12px; opacity: 0.8; }

  @media (max-width: 960px) {
    .tablepage { height: auto; min-height: 100vh; overflow: visible; }
    .arena-wrap { flex: none; height: 72vh; }
    .dock { grid-template-columns: 1fr; height: auto; }
    .dock-chat :global(.chat .messages) { max-height: 180px; }
    .dock-side { align-items: center; }
  }

  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); display: flex; align-items: center; justify-content: center; z-index: 50; padding: 20px; }
  .modal { width: min(420px, 94vw); padding: 20px; display: flex; flex-direction: column; gap: 12px; }
  .modal h3 { margin: 0; }
  .modal .num { width: 100%; padding: 9px 11px; border-radius: var(--r-btn); border: 0; background: var(--well); color: var(--text); }
  .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 4px; }
  .btn.primary { background: var(--accent); color: var(--on-accent); }
  .btn.ghost { background: var(--well); box-shadow: none; }
</style>
