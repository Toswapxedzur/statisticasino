<script>
  import Card from "./Card.svelte";
  import Num from "./Num.svelte";
  import { scale, fade } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";

  // One seat position on the felt.
  //  seat      — a TableView seat object. May be null/absent for an empty seat.
  //              When the player is in a hand, the parent may attach
  //              `seat.holeCards` (own cards from privates, or revealed hands at
  //              showdown) so this component can render them face-up.
  //  me        — poker.me ({id,name,...}) | null (used to gate "Sit here").
  //  isMine    — true when this seat is the signed-in user's own seat.
  //  canSit    — true when the signed-in user is allowed to take this empty seat.
  //  onSit     — onSit(seatNo) — called when the empty-seat button is clicked.
  //  deadline  — action deadline (ms epoch) for the countdown ring; the parent
  //              passes view.actionDeadline when this seat isToAct.
  //  seatNo    — this seat's index (needed for onSit when the seat is empty).
  //  winner    — true to briefly highlight this seat as a hand winner.
  let {
    seat = null,
    me = null,
    isMine = false,
    canSit = false,
    onSit = () => {},
    deadline = null,
    seatNo = 0,
    winner = false,
  } = $props();

  const RING_MAX_MS = 25_000; // ACTION_TIMEOUT_MS reference for the ring arc.

  // Reactive clock: tick only while this seat is the actor.
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

  // SVG ring geometry.
  const R = 30;
  const C = 2 * Math.PI * R;
  let dash = $derived(C * frac);

  let folded = $derived(seat?.status === "folded");
  let allin = $derived(seat?.status === "allin");
  let sittingOut = $derived(!!seat?.sittingOut);

  let cards = $derived(Array.isArray(seat?.holeCards) ? seat.holeCards : null);

  let badge = $derived(
    seat?.isButton ? "D" : seat?.isSB ? "SB" : seat?.isBB ? "BB" : null,
  );

  function fmt(n) {
    return typeof n === "number" ? n.toLocaleString() : n;
  }
</script>

<div class="seat" class:mine={isMine} class:folded class:sitting-out={sittingOut} class:winner>
  {#if seat && seat.userId != null}
    <!-- committed bet chips in front of the seat -->
    {#if seat.committed > 0}
      <div class="bet" in:scale={{ start: 0.7, duration: d(DUR.base) }} out:fade={{ duration: d(DUR.fast) }}><span class="chip-dot"></span><Num value={seat.committed} /></div>
    {/if}

    <div class="pod" class:toact={seat.isToAct} in:scale={{ start: 0.9, duration: d(DUR.base) }} out:fade={{ duration: d(DUR.fast) }}>
      {#if seat.isToAct && deadline}
        <svg class="ring" class:urgent viewBox="0 0 72 72" aria-hidden="true">
          <circle class="ring-bg" cx="36" cy="36" r={R} />
          <circle
            class="ring-fg"
            cx="36" cy="36" r={R}
            stroke-dasharray="{dash} {C}"
            transform="rotate(-90 36 36)"
          />
        </svg>
      {/if}

      <!-- Render face-up whenever cards are ATTACHED (own cards, or showdown
           reveals during the result window — when the server has already
           cleared hasCards). Fall back to face-down backs while the seat is
           in a hand but not revealed to us. (#3) -->
      <div class="cards" class:has={cards || seat.hasCards}>
        {#if cards}
          {#each cards as c}<Card card={c} size="sm" />{/each}
        {:else if seat.hasCards}
          <Card faceDown size="sm" /><Card faceDown size="sm" />
        {/if}
      </div>

      <div class="plate">
        <div class="row1">
          <span class="name" title={seat.name}>{seat.name}</span>
          {#if badge}<span class="badge b-{badge.toLowerCase()}">{badge}</span>{/if}
          {#if !seat.connected}<span class="dot off" title="disconnected"></span>{/if}
        </div>
        <div class="row2">
          <span class="stack"><Num value={seat.stack} /></span>
          {#if seat.isToAct && deadline}<span class="secs" class:urgent>{remainSec}s</span>{/if}
        </div>
        <div class="row3">
          {#if allin}<span class="tag allin">ALL-IN</span>
          {:else if sittingOut}<span class="tag out">SITTING OUT</span>
          {:else if seat.lastAction}<span class="tag last">{seat.lastAction}</span>{/if}
        </div>
      </div>
    </div>
  {:else}
    <!-- empty seat -->
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
  .seat {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    width: 132px;
  }

  /* bet chips in front */
  .bet {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    margin-bottom: 4px;
    padding: 2px 8px;
    font-size: 12px;
    font-weight: 700;
    color: #12202e;
    background: #e7c14b;
    border-radius: 999px;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.4);
  }
  .chip-dot {
    width: 8px; height: 8px; border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #fff 0 25%, #d33 26% 100%);
    box-shadow: 0 0 0 1px rgba(0,0,0,0.3);
  }

  .pod { position: relative; display: flex; flex-direction: column; align-items: center; }

  /* countdown ring around the acting seat */
  .ring {
    position: absolute;
    top: -6px; left: 50%;
    width: 96px; height: 96px;
    transform: translateX(-50%);
    pointer-events: none;
    z-index: 0;
  }
  .ring-bg { fill: none; stroke: rgba(255,255,255,0.12); stroke-width: 4; }
  .ring-fg {
    fill: none; stroke: var(--accent, #6dc6e8); stroke-width: 4;
    stroke-linecap: round;
    transition: stroke-dasharray 0.12s linear;
  }
  .ring.urgent .ring-fg { stroke: var(--danger, #f87171); }

  .cards { display: flex; gap: 3px; height: 42px; margin-bottom: -8px; z-index: 1; }
  .cards:not(.has) { height: 0; margin-bottom: 0; }

  .plate {
    position: relative;
    z-index: 1;
    min-width: 112px;
    max-width: 132px;
    padding: 7px 11px;
    background: var(--surface);
    border: 0;
    border-radius: 12px;
    box-shadow: var(--shadow-card);
    text-align: center;
    transition: box-shadow var(--dur) var(--ease);
  }
  .toact .plate {
    box-shadow: 0 0 0 2px var(--accent), 0 0 20px color-mix(in srgb, var(--accent) 45%, transparent);
  }
  .mine .plate { box-shadow: 0 0 0 2px var(--accent-soft), var(--shadow-card); background: var(--surface-2); }

  .row1 { display: flex; align-items: center; justify-content: center; gap: 5px; }
  .name {
    font-size: 13px; font-weight: 700; color: var(--text, #f3f6fb);
    max-width: 84px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .badge {
    font-size: 9px; font-weight: 800; line-height: 1;
    padding: 2px 4px; border-radius: 4px; color: #12202e;
  }
  .b-d { background: #f3f6fb; }
  .b-sb { background: #a9dcef; }
  .b-bb { background: #e7c14b; }

  .dot.off {
    width: 7px; height: 7px; border-radius: 50%;
    background: var(--muted, #8ea3bd); opacity: 0.6;
  }

  .row2 {
    display: flex; align-items: baseline; justify-content: center; gap: 6px;
    margin-top: 2px;
  }
  .stack { font-size: 13px; font-weight: 700; color: var(--gold, #f4c94b); font-variant-numeric: tabular-nums; }
  .secs { font-size: 11px; color: var(--muted, #8ea3bd); font-variant-numeric: tabular-nums; }
  .secs.urgent { color: var(--danger, #f87171); font-weight: 700; }

  .row3 { min-height: 14px; margin-top: 2px; }
  .tag {
    display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: 0.4px;
    padding: 1px 6px; border-radius: 999px;
  }
  .tag.last { color: var(--muted, #8ea3bd); background: rgba(255,255,255,0.05); }
  .tag.allin { color: #12202e; background: var(--danger, #f87171); }
  .tag.out { color: var(--muted, #8ea3bd); background: rgba(255,255,255,0.05); }

  /* states */
  .seat.folded .pod { opacity: 0.42; filter: grayscale(0.4); }
  .seat.sitting-out .plate { opacity: 0.7; }
  .seat.winner .plate {
    box-shadow: 0 0 0 2px rgba(74,222,128,0.65), 0 0 18px rgba(74,222,128,0.4);
    animation: winpulse 1.1s ease-in-out 2;
  }
  @keyframes winpulse {
    0%, 100% { box-shadow: 0 0 0 2px rgba(74,222,128,0.5), 0 0 12px rgba(74,222,128,0.3); }
    50% { box-shadow: 0 0 0 3px rgba(74,222,128,0.85), 0 0 24px rgba(74,222,128,0.55); }
  }

  /* empty seat */
  .empty {
    display: flex; align-items: center; justify-content: center;
    min-width: 104px; height: 56px;
    border-radius: 12px;
    background: var(--well);
    box-shadow: inset 0 0 0 1px rgba(128,128,128,0.10);
  }
  .sit-btn { font-size: 12px; padding: 6px 12px; }
  .empty-lbl { font-size: 12px; color: var(--muted, #8ea3bd); }
  .empty-lbl.link { text-decoration: none; }
  .empty-lbl.link:hover { color: var(--text, #f3f6fb); }

  /* mobile: shrink the pod so 6–9 seats don't collide on a small table */
  @media (max-width: 640px) {
    .seat { width: 96px; }
    .plate { min-width: 0; max-width: 100px; padding: 5px 7px; }
    .name { max-width: 62px; font-size: 12px; }
    .ring { width: 74px; height: 74px; }
    .empty { min-width: 78px; height: 46px; }
  }
</style>
