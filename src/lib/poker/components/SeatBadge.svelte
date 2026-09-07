<script>
  import Avatar from "./Avatar.svelte";
  import Num from "./Num.svelte";
  import CoinStack from "./CoinStack.svelte";
  import HandFan from "./HandFan.svelte";
  import { scale, fade, fly } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";

  // The one seat badge every game uses: avatar · name · stack · status line, with
  // the player's cards fanned underneath. Layout is the same for every game; games
  // only decide WHAT goes in the status line and which cards are shown.
  //   seat       — TableView seat ({userId, name, avatar, stack, isToAct, sittingOut,
  //                connected, status, lastAction, committed, isButton/isSB/isBB}) | null.
  //   isMine     — my own seat: bigger cards, side-by-side for ≤2, fanned above.
  //   cards      — string[] face-up cards | null; `cardCount` backs when null.
  //   cardCount  — number of face-down cards to show.
  //   line       — status text override (e.g. "bet 40", "18 bust", "win +30").
  //   lineKind   — "" | "win" | "lose" | "push" | "muted" — colours the line.
  //   deadline   — action deadline (ms) when this seat is to act (countdown ring).
  //   winner/won — highlight + floating winnings.
  //   canSit/onSit/seatNo — empty-seat button.
  //   selectable/onSelect/labelOf — forwarded to HandFan for pick-a-card turns.
  //   house      — render as the House (dealer) badge: label + bankroll, no ring.
  let {
    seat = null, isMine = false, me = null,
    cards = null, cardCount = 0, reveal = true,
    line = null, lineKind = "",
    deadline = null, winner = false, won = 0,
    canSit = false, onSit = () => {}, seatNo = 0,
    selectable = null, onSelect = () => {}, labelOf = null,
    house = false, size = "sm", children = null,
    cardWidth = 82          // the table's card size (my hand + centre); shrinks on crowded tables
  } = $props();

  const RING_MAX_MS = 25_000;
  let nowMs = $state(Date.now());
  $effect(() => {
    if (!seat?.isToAct || !deadline) return;
    nowMs = Date.now();
    const id = setInterval(() => { nowMs = Date.now(); }, 100);
    return () => clearInterval(id);
  });
  let remainMs = $derived(seat?.isToAct && deadline ? Math.max(0, deadline - nowMs) : 0);
  let remainSec = $derived(Math.ceil(remainMs / 1000));
  let frac = $derived(Math.max(0, Math.min(1, remainMs / RING_MAX_MS)));
  let urgent = $derived(seat?.isToAct && remainMs > 0 && remainMs <= 6000);
  const R = 30, C = 2 * Math.PI * R;
  let dash = $derived(C * frac);

  let folded = $derived(seat?.status === "folded");
  let allin = $derived(seat?.status === "allin");
  let sittingOut = $derived(!!seat?.sittingOut);
  let badge = $derived(seat?.isButton ? "D" : seat?.isSB ? "SB" : seat?.isBB ? "BB" : null);
  // Default status line: all-in / sitting out / last action; games may override via `line`.
  // The blind markers already show as chips next to the name; don't repeat them as status.
  let statusText = $derived(line != null ? line : allin ? "ALL-IN" : sittingOut ? "sitting out" : (seat?.lastAction && seat.lastAction !== "SB" && seat.lastAction !== "BB" ? seat.lastAction : ""));
  let statusKind = $derived(line != null ? lineKind : allin ? "allin" : sittingOut ? "muted" : "muted");
  // Same card size as my hand and the centre (82 px). Opponents / the House keep it too unless
  // their fan would be wider than an opponent badge can afford; then it shrinks to fit.
  const MIN_W = 34;
  let cardW = $derived.by(() => {
    const base = cardWidth;
    if (isMine) return base;
    // Opponents: same size as my hand, or smaller when their fan would not fit an
    // opponent badge (≈2.6 card widths). Never larger than mine.
    const n = (cards && cards.length) || cardCount || 0;
    if (n <= 0) return base;
    const cap = base * 2.6;
    const total = n > 2 ? base * (1 + 0.38 * (n - 1)) : n * base + (n - 1) * 5;
    return total <= cap ? base : Math.max(MIN_W, Math.floor(base * cap / total));
  });
  let avSize = $derived(isMine ? 44 : 34);
</script>

<div class="seat" class:mine={isMine} class:folded class:sitting-out={sittingOut} class:winner class:allin class:house class:toact={!!seat?.isToAct}>
  {#if seat && seat.userId != null}
    {#if winner && won > 0}
      <div class="won" in:fly={{ y: d(10), duration: d(DUR.slow) }} out:fade={{ duration: d(DUR.base) }}>
        <CoinStack value={won} size={17} />+<Num value={won} />
      </div>
    {/if}
    {#if !house && seat.committed > 0}
      <div class="bet" in:scale={{ start: 0.6, duration: d(DUR.base) }} out:fade={{ duration: d(DUR.fast) }}><CoinStack value={seat.committed} size={18} /><Num value={seat.committed} /></div>
    {/if}

    <div class="plate" in:scale={{ start: 0.92, duration: d(DUR.base) }}>
      {#if seat.isToAct && deadline}
        <svg class="ring" class:urgent viewBox="0 0 72 72" aria-hidden="true">
          <circle class="ring-bg" cx="36" cy="36" r={R} />
          <circle class="ring-fg" cx="36" cy="36" r={R} stroke-dasharray="{dash} {C}" transform="rotate(-90 36 36)" />
        </svg>
      {/if}
      <div class="av"><Avatar id={seat.userId} name={house ? "House" : seat.name} mediaId={seat.avatar ?? null} userId={isMine || house ? null : seat.userId} size={avSize} /></div>
      <div class="txt">
        <div class="row1">
          <span class="name" title={seat.name}>{house ? "House" : seat.name}</span>
          {#if badge}<span class="badge b-{badge.toLowerCase()}">{badge}</span>{/if}
          {#if !seat.connected && !house}<span class="dot off" title="disconnected"></span>{/if}
        </div>
        <div class="row2">
          <span class="stack"><Num value={seat.stack} /></span>
          {#if seat.isToAct && deadline}<span class="secs" class:urgent>{remainSec}s</span>{/if}
        </div>
        <div class="row3 {statusKind}">{statusText}</div>
      </div>
    </div>

    {#if children}<div class="extra">{@render children()}</div>{/if}
    <div class="hand" class:has={(cards && cards.length) || cardCount > 0}>
      <HandFan {cards} count={cardCount} width={cardW} fan={isMine ? "auto" : (cardCount > 3 || (cards?.length ?? 0) > 3 ? "stack" : "auto")} {selectable} {onSelect} {labelOf} {reveal} />
    </div>
  {:else}
    <div class="empty">
      {#if canSit}
        <button class="btn sit-btn" onclick={() => onSit(seatNo)}>Sit here</button>
      {:else if me}
        <span class="empty-lbl">Empty</span>
      {:else}
        <a class="empty-lbl link" href="/account/login">Sign in to sit</a>
      {/if}
    </div>
  {/if}
</div>

<style>
  .seat { position: relative; display: flex; flex-direction: column; align-items: center; gap: 6px; width: max-content; }
  .bet {
    display: inline-flex; align-items: center; gap: 5px; padding: 2px 9px 2px 4px;
    font-size: 12px; font-weight: 800; color: var(--gold-ink);
    background: color-mix(in srgb, var(--surface) 78%, #000 22%); border-radius: 999px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45); font-variant-numeric: tabular-nums;
  }
  .won {
    position: absolute; top: -18px; left: 50%; transform: translateX(-50%); z-index: 6;
    display: inline-flex; align-items: center; gap: 4px; font-size: 13px; font-weight: 800; color: var(--gold-ink);
    background: color-mix(in srgb, var(--surface) 90%, transparent); padding: 2px 9px 2px 5px; border-radius: 999px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.45), 0 0 0 1px color-mix(in srgb, var(--gold) 45%, transparent);
    white-space: nowrap; pointer-events: none; font-variant-numeric: tabular-nums;
  }
  .plate {
    position: relative; display: flex; align-items: center; gap: 9px;
    padding: 7px 12px 7px 8px; min-width: 150px; max-width: 200px;
    background: var(--surface); border-radius: 14px; box-shadow: var(--shadow-card);
    transition: box-shadow var(--dur) var(--ease);
  }
  .mine .plate { background: var(--surface-2); box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow-card); min-width: 190px; }
  .toact .plate { box-shadow: 0 0 0 2px var(--accent), 0 0 20px color-mix(in srgb, var(--accent) 45%, transparent); }
  .house .plate { background: color-mix(in srgb, var(--surface) 70%, var(--gold-bg) 30%); }
  .av { position: relative; z-index: 1; line-height: 0; }
  .ring { position: absolute; left: -2px; top: 50%; width: 50px; height: 50px; transform: translateY(-50%); pointer-events: none; z-index: 0; }
  .mine .ring { width: 60px; height: 60px; left: -3px; }
  .ring-bg { fill: none; stroke: rgba(255,255,255,0.12); stroke-width: 5; }
  .ring-fg { fill: none; stroke: var(--accent); stroke-width: 5; stroke-linecap: round; transition: stroke-dasharray 0.12s linear; }
  .ring.urgent .ring-fg { stroke: var(--danger); }
  .txt { display: flex; flex-direction: column; min-width: 0; text-align: left; }
  .row1 { display: flex; align-items: center; gap: 5px; }
  .name { font-size: 13px; font-weight: 700; color: var(--text); max-width: 120px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mine .name { font-size: 14px; }
  .badge { font-size: 9px; font-weight: 800; line-height: 1; padding: 2px 4px; border-radius: 4px; color: #12202e; }
  .b-d { background: #f3f6fb; } .b-sb { background: #a9dcef; } .b-bb { background: #e7c14b; }
  .dot.off { width: 7px; height: 7px; border-radius: 50%; background: var(--muted); opacity: 0.6; }
  .row2 { display: flex; align-items: baseline; gap: 6px; }
  .stack { font-size: 13px; font-weight: 700; color: var(--gold-ink); font-variant-numeric: tabular-nums; }
  .mine .stack { font-size: 15px; }
  .secs { font-size: 11px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .secs.urgent { color: var(--danger); font-weight: 700; }
  .row3 { font-size: 11px; min-height: 13px; color: var(--muted); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 140px; }
  .row3.win { color: var(--ok); font-weight: 700; }
  .row3.lose { color: var(--danger); font-weight: 700; }
  .row3.push { color: var(--gold-ink); font-weight: 700; }
  .row3.allin { color: var(--danger); font-weight: 800; letter-spacing: 0.4px; }
  .hand { line-height: 0; }
  .extra { display: flex; justify-content: center; }
  .hand:not(.has) { display: none; }
  .seat.folded .plate, .seat.folded .hand { opacity: 0.42; filter: grayscale(0.4); }
  .seat.sitting-out .plate { opacity: 0.7; }
  .seat.winner .plate { box-shadow: 0 0 0 2px rgba(74,222,128,0.65), 0 0 18px rgba(74,222,128,0.4); animation: winpulse 1.1s ease-in-out 2; }
  .seat.allin .plate { box-shadow: 0 0 0 2px color-mix(in srgb, var(--danger) 72%, transparent), 0 0 16px color-mix(in srgb, var(--danger) 32%, transparent); }
  @keyframes winpulse {
    0%, 100% { box-shadow: 0 0 0 2px rgba(74,222,128,0.5), 0 0 12px rgba(74,222,128,0.3); }
    50% { box-shadow: 0 0 0 3px rgba(74,222,128,0.85), 0 0 24px rgba(74,222,128,0.55); }
  }
  .empty { display: flex; align-items: center; justify-content: center; min-width: 112px; height: 52px; border-radius: 14px; background: var(--well); box-shadow: inset 0 0 0 1px rgba(128,128,128,0.10); }
  .sit-btn { font-size: 12px; padding: 6px 12px; }
  .empty-lbl { font-size: 12px; color: var(--muted); }
  .empty-lbl.link { text-decoration: none; }
  @media (prefers-reduced-motion: reduce) { .seat.winner .plate { animation: none; } }
</style>
