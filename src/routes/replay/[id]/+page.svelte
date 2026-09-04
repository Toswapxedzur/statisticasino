<script>
  // Step-through viewer for one recorded match. Frames were expanded (and
  // redacted) server-side; this page just pages through them.
  import Card from "$lib/poker/components/Card.svelte";
  import Chip from "$lib/poker/components/Chip.svelte";
  import CoinStack from "$lib/poker/components/CoinStack.svelte";

  let { data } = $props();

  let i = $state(0);
  let playing = $state(false);
  const frames = data.frames || [];
  const last = frames.length - 1;
  let frame = $derived(frames[i] || null);

  const nameOf = (seat) => data.players.find((p) => p.seat === seat)?.name || `Seat ${seat}`;
  const fmt = (n) => Number(n || 0).toLocaleString();

  function step(d) {
    i = Math.max(0, Math.min(last, i + d));
    if (i === last) playing = false;
  }
  $effect(() => {
    if (!playing) return;
    const t = setInterval(() => step(1), 900);
    return () => clearInterval(t);
  });
  function onKey(e) {
    if (e.key === "ArrowRight") { step(1); e.preventDefault(); }
    else if (e.key === "ArrowLeft") { step(-1); e.preventDefault(); }
  }

  const MODE_LABEL = { holdem: "Poker" };
  const modeLabel = MODE_LABEL[data.mode] || (data.mode || "").replace(/-/g, " ");
  const CARD_RE = /^[A2-9TJQK][shdc]$/;
  // Generic module view: find labelled card arrays anywhere in the view.
  function cardRows(view) {
    const rows = [];
    const walk = (v, label) => {
      if (Array.isArray(v)) {
        if (v.length && v.every((x) => typeof x === "string" && CARD_RE.test(x))) {
          rows.push({ label, cards: v });
        } else {
          v.forEach((x, idx) => walk(x, v.length > 1 ? `${label} ${idx + 1}` : label));
        }
      } else if (v && typeof v === "object") {
        const name = typeof v.name === "string" ? v.name : (v.seat != null ? nameOf(v.seat) : null);
        for (const [k, val] of Object.entries(v)) {
          if (k === "deck") continue;
          walk(val, name && (k === "cards" || k === "hand") ? name : k);
        }
      }
    };
    walk(view, "");
    return rows.slice(0, 12);
  }
  function actionLabel(a) {
    if (!a) return "Start of the match";
    const who = nameOf(a.seat);
    const amt = a.amount ? ` ${fmt(a.amount)}` : "";
    return `${who}: ${a.type}${amt}${a.auto ? " (auto)" : ""}`;
  }
</script>

<svelte:window onkeydown={onKey} />

<div class="wrap">
  <div class="head">
    <h1>{modeLabel} replay</h1>
    <span class="sub">
      {data.tableName || "table"}{#if data.handNo} · hand #{data.handNo}{/if}
      · {new Date(data.endedAt).toLocaleString()}
      {#if data.context !== "cash"}· {data.context}{/if}
    </span>
  </div>

  {#if !frames.length}
    <!-- Re-simulation unavailable (an old recording): summary only. -->
    <div class="panel">
      <p class="muted">This match can't be re-simulated step by step any more; here is its outcome.</p>
      {#if data.final?.nets}
        {#each data.final.nets as n}
          <div class="row"><span>{nameOf(n.seat)}</span><span class={n.net >= 0 ? "pos" : "neg"}>{n.net >= 0 ? "+" : ""}{fmt(n.net)}</span></div>
        {/each}
      {/if}
    </div>
  {:else}
    <div class="panel">
      {#if data.kind === "poker"}
        {@const f = frame}
        <div class="board">
          {#each Array(5) as _, bi}
            {#if f.board[bi]}<Card card={f.board[bi]} size="md" />{:else}<Card size="md" />{/if}
          {/each}
        </div>
        <div class="pot">
          {#if f.pot > 0}<CoinStack value={f.pot} size={18} />{/if}
          <span class="pot-amt">{fmt(f.pot)}</span>
          {#if f.street}<span class="street">{f.street}</span>{/if}
        </div>
        <div class="seats">
          {#each f.players as p (p.seat)}
            <div class="seat" class:folded={p.status === "folded"} class:toact={f.toActSeat === p.seat}>
              <div class="cards">
                {#if data.holes?.[p.seat]}
                  {#each data.holes[p.seat] as c}<Card card={c} size="sm" />{/each}
                {:else}
                  <Card faceDown size="sm" /><Card faceDown size="sm" />
                {/if}
              </div>
              <div class="who">{nameOf(p.seat)}</div>
              <div class="stack">{fmt(p.stack)}</div>
              {#if p.totalCommitted > 0}
                <div class="bet"><CoinStack value={p.totalCommitted} size={14} /> {fmt(p.totalCommitted)}</div>
              {/if}
              {#if p.status === "allin"}<span class="tag">ALL-IN</span>{/if}
            </div>
          {/each}
        </div>
      {:else}
        {@const v = frame.view}
        {#if v?.outcome?.headline}<div class="headline">{v.outcome.headline}</div>{/if}
        {#each cardRows(v) as row}
          <div class="cardrow">
            {#if row.label}<span class="rl">{row.label}</span>{/if}
            <span class="rc">{#each row.cards as c}<Card card={c} size="sm" />{/each}</span>
          </div>
        {/each}
        {#if v?.bets}
          {#each v.bets.filter((b) => b.bets?.length) as b}
            <div class="row"><span>{nameOf(b.seat)}</span>
              <span class="muted">{b.bets.map((x) => `${x.option} ${fmt(x.amount)}`).join(" · ")}</span></div>
          {/each}
        {/if}
        {#if v?.results}
          {#each v.results as r}
            <div class="row"><span>{nameOf(r.seat)}</span>
              <span class={r.delta >= 0 ? "pos" : "neg"}>{r.delta >= 0 ? "+" : ""}{fmt(r.delta)}</span></div>
          {/each}
        {/if}
      {/if}

      <div class="ticker">{actionLabel(frame?.action)}</div>

      <div class="controls">
        <button class="btn" onclick={() => { i = 0; }} disabled={i === 0}>⏮</button>
        <button class="btn" onclick={() => step(-1)} disabled={i === 0}>←</button>
        <button class="btn play" onclick={() => (playing = !playing)}>{playing ? "Pause" : "Play"}</button>
        <button class="btn" onclick={() => step(1)} disabled={i === last}>→</button>
        <button class="btn" onclick={() => { i = last; }} disabled={i === last}>⏭</button>
        <span class="pos-ind">{i + 1} / {frames.length}</span>
      </div>
    </div>
  {/if}

  <div class="panel outcome">
    <div class="cap">Result</div>
    {#each data.players as p (p.seat)}
      <div class="row">
        <span>{p.name || `Seat ${p.seat}`}{#if p.role === "banker"} <em class="muted">banker</em>{/if}</span>
        <span class="net {p.net >= 0 ? 'pos' : 'neg'}"><Chip value={Math.abs(p.net)} size={14} /> {p.net >= 0 ? "+" : ""}{fmt(p.net)}</span>
      </div>
    {/each}
  </div>
</div>

<style>
  .wrap { max-width: 700px; margin: 0 auto; padding: 22px 18px 60px; }
  .head { margin-bottom: 14px; }
  h1 { margin: 0; font-size: 21px; text-transform: capitalize; }
  .sub { color: var(--muted); font-size: 12.5px; }
  .panel {
    background: color-mix(in srgb, var(--surface) 88%, #000 12%);
    border-radius: 18px; padding: 20px; margin-bottom: 14px;
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
  }
  .board { display: flex; gap: 7px; justify-content: center; margin-bottom: 12px; }
  .pot { display: flex; align-items: center; justify-content: center; gap: 8px; margin-bottom: 16px; }
  .pot-amt { color: var(--gold-ink); font-weight: 800; font-variant-numeric: tabular-nums; }
  .street { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  .seats { display: flex; gap: 18px; flex-wrap: wrap; justify-content: center; }
  .seat { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 8px 10px; border-radius: 12px; }
  .seat.toact { background: color-mix(in srgb, var(--accent, #4f7cff) 14%, transparent); }
  .seat.folded { opacity: 0.38; }
  .seat .cards { display: flex; gap: 3px; }
  .who { font-weight: 700; font-size: 12.5px; }
  .stack { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; }
  .bet { display: flex; align-items: center; gap: 5px; color: var(--gold-ink); font-weight: 700; font-size: 12px; font-variant-numeric: tabular-nums; }
  .tag { font-size: 10px; font-weight: 800; color: #f0a35a; }
  .headline { font-weight: 800; font-size: 15px; margin-bottom: 10px; text-align: center; }
  .cardrow { display: flex; align-items: center; gap: 10px; margin: 6px 0; flex-wrap: wrap; }
  .rl { color: var(--muted); font-size: 12px; min-width: 90px; text-transform: capitalize; }
  .rc { display: flex; gap: 4px; flex-wrap: wrap; }
  .ticker { margin-top: 16px; text-align: center; color: var(--text); font-size: 13.5px; min-height: 20px; }
  .controls { display: flex; align-items: center; justify-content: center; gap: 8px; margin-top: 12px; }
  .btn {
    background: color-mix(in srgb, var(--surface) 70%, #fff 6%); color: var(--text);
    border: 0; border-radius: 10px; padding: 7px 13px; font-size: 14px; cursor: pointer;
  }
  .btn:disabled { opacity: 0.35; cursor: default; }
  .btn.play { min-width: 74px; font-weight: 700; }
  .pos-ind { color: var(--muted); font-size: 12px; font-variant-numeric: tabular-nums; margin-left: 6px; }
  .cap { color: var(--muted); font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 8px; }
  .row { display: flex; justify-content: space-between; align-items: center; padding: 5px 0; font-size: 13.5px; }
  .net { display: inline-flex; align-items: center; gap: 6px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .pos { color: var(--ok, #6ee7a8); }
  .neg { color: var(--danger, #f37f8c); }
  .muted { color: var(--muted); }
</style>
