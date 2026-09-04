<script>
  import Chip from "$lib/poker/components/Chip.svelte";

  let { data } = $props();

  const MODE_NAMES = {
    holdem: "Poker",
    blackjack: "Blackjack",
    baccarat: "Baccarat",
    "big-two": "Big Two",
    "crazy-eights": "Crazy Eights",
    "casino-holdem": "Casino Hold'em",
    "caribbean-stud": "Caribbean Stud",
    "ultimate-holdem": "Ultimate Hold'em",
    "three-card": "Three Card Poker",
    "let-it-ride": "Let It Ride",
    "red-dog": "Red Dog",
    "pai-gow": "Pai Gow Poker",
    "video-poker": "Video Poker",
    keno: "Keno"
  };
  const CONTEXT_NAMES = { cash: "Cash rooms", tournament: "Tournaments", sprint: "Sprint" };

  const fmt = (value) => Number(value || 0).toLocaleString();
  const signed = (value) => `${Number(value) >= 0 ? "+" : ""}${fmt(value)}`;
  const modeName = (mode) => MODE_NAMES[mode] || String(mode || "Unknown").split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
  const dateLabel = (value) => value ? new Date(value).toLocaleDateString([], { year: "numeric", month: "short", day: "numeric" }) : "—";
  const shortDay = (day) => new Date(`${day}T00:00:00`).toLocaleDateString([], { month: "short", day: "numeric" });

  function buildChart(rows) {
    const width = 760;
    const height = 250;
    const padX = 28;
    const padTop = 20;
    const padBottom = 34;
    const plotWidth = width - padX * 2;
    const plotHeight = height - padTop - padBottom;
    if (!rows.length) return { width, height, bars: [], labels: [], zeroY: padTop + plotHeight, maxNet: 0, minNet: 0 };

    const values = rows.map((row) => Number(row.net || 0));
    const maxNet = Math.max(0, ...values);
    const minNet = Math.min(0, ...values);
    const range = Math.max(1, maxNet - minNet);
    const yFor = (value) => padTop + ((maxNet - value) / range) * plotHeight;
    const zeroY = yFor(0);
    const slot = plotWidth / rows.length;
    const barWidth = Math.max(2, Math.min(34, slot * 0.68));
    const bars = rows.map((row, index) => {
      const value = Number(row.net || 0);
      const valueY = yFor(value);
      return {
        ...row,
        value,
        x: padX + index * slot + (slot - barWidth) / 2,
        y: value >= 0 ? valueY : zeroY,
        width: barWidth,
        height: Math.max(3, Math.abs(zeroY - valueY)),
        positive: value >= 0
      };
    });
    const labelIndexes = [...new Set([0, Math.floor((rows.length - 1) / 2), rows.length - 1])];
    const labels = labelIndexes.map((index) => ({
      text: shortDay(rows[index].day),
      x: padX + index * slot + slot / 2,
      anchor: index === 0 ? "start" : index === rows.length - 1 ? "end" : "middle"
    }));
    return { width, height, bars, labels, zeroY, maxNet, minNet };
  }

  const chart = $derived(buildChart(data.daily));
  const playerModes = $derived(data.modes.filter((row) => row.role === "player"));
  const bankerModes = $derived(data.modes.filter((row) => row.role === "banker"));
</script>

<svelte:head><title>Your Statistics — Riverside</title></svelte:head>

<div class="wrap">
  <header class="page-head">
    <div>
      <p class="cap">Your play</p>
      <h1>Statistics</h1>
      <p class="muted intro">Every recorded table result, plus detailed poker tendencies from your latest replayable hands.</p>
    </div>
    <a class="history-link" href="/history">View history</a>
  </header>

  <section class="overview" aria-label="Overview">
    <article class="metric card">
      <span class="cap">Matches played</span>
      <strong>{fmt(data.overview.matches)}</strong>
      <small>{fmt(data.overview.daysActive)} active days</small>
    </article>
    <article class="metric card">
      <span class="cap">Total net</span>
      <strong class="money" class:pos={data.overview.totalNet >= 0} class:neg={data.overview.totalNet < 0}>
        <Chip value={Math.abs(data.overview.totalNet)} size={18} /> {signed(data.overview.totalNet)}
      </strong>
      <small>Across every recorded mode</small>
    </article>
    <article class="metric card">
      <span class="cap">Win rate</span>
      <strong>{data.overview.winRate.toLocaleString()}%</strong>
      <small>{fmt(data.overview.wins)} winning matches</small>
    </article>
    <article class="metric card">
      <span class="cap">Biggest win</span>
      <strong class="money gold"><Chip value={data.overview.biggestWin} size={18} /> {fmt(data.overview.biggestWin)}</strong>
      <small>Best single recorded result</small>
    </article>
  </section>

  <section class="section-block">
    <div class="section-head">
      <div><p class="cap">Where you play</p><h2>By context</h2></div>
    </div>
    <div class="contexts">
      {#each data.overview.contexts as context (context.context)}
        <article class="context-card">
          <div class="context-top">
            <h3>{CONTEXT_NAMES[context.context] || context.context}</h3>
            <span>{fmt(context.matches)} matches</span>
          </div>
          <div class="context-net" class:pos={context.net >= 0} class:neg={context.net < 0}>{signed(context.net)}</div>
          <div class="context-meta"><span>{context.winRate.toLocaleString()}% wins</span><span>Best {fmt(context.biggestWin)}</span></div>
        </article>
      {/each}
    </div>
  </section>

  <section class="chart-card card">
    <div class="section-head chart-head">
      <div><p class="cap">Day by day</p><h2>Daily net</h2></div>
      {#if data.daily.length}<span class="muted small">{fmt(data.daily.reduce((sum, row) => sum + row.matches, 0))} recorded matches</span>{/if}
    </div>
    {#if chart.bars.length === 0}
      <div class="empty-chart muted">Your daily results will appear after a recorded match.</div>
    {:else}
      <div class="chart-wrap">
        <svg viewBox={`0 0 ${chart.width} ${chart.height}`} role="img" aria-label="Daily net winnings bar chart">
          <rect class="zero" x="28" y={chart.zeroY - 1} width={chart.width - 56} height="2" rx="1"></rect>
          {#each chart.bars as bar (bar.day)}
            <rect class:bar-pos={bar.positive} class:bar-neg={!bar.positive} x={bar.x} y={bar.y} width={bar.width} height={bar.height} rx="3">
              <title>{bar.day}: {signed(bar.value)} over {fmt(bar.matches)} matches</title>
            </rect>
          {/each}
          {#each chart.labels as label (label.text + label.x)}
            <text class="axis-label" x={label.x} y={chart.height - 8} text-anchor={label.anchor}>{label.text}</text>
          {/each}
        </svg>
      </div>
      <div class="chart-scale"><span class="pos">High {signed(chart.maxNet)}</span><span class="neg">Low {signed(chart.minNet)}</span></div>
    {/if}
  </section>

  <section class="poker-card card">
    <div class="section-head">
      <div><p class="cap">Poker laboratory</p><h2>Deep stats</h2></div>
      <span class="muted small">Latest {fmt(data.poker.sampleHands)} recorded hands sampled</span>
    </div>
    <div class="poker-totals">
      <div><span class="cap">Lifetime hands</span><strong>{fmt(data.poker.hands)}</strong></div>
      <div><span class="cap">Lifetime net</span><strong class:pos={data.poker.net >= 0} class:neg={data.poker.net < 0}>{signed(data.poker.net)}</strong></div>
      <div><span class="cap">Biggest pot won</span><strong class="gold">{fmt(data.poker.biggestPotWon)}</strong></div>
    </div>
    <div class="poker-grid">
      <div class="pstat"><strong>{data.poker.vpip.toLocaleString()}%</strong><span>VPIP</span><small>Voluntarily entered {fmt(data.poker.vpipHands)} of {fmt(data.poker.preflopHands)} tracked preflops</small></div>
      <div class="pstat"><strong>{data.poker.pfr.toLocaleString()}%</strong><span>PFR</span><small>Raised preflop in {fmt(data.poker.pfrHands)} tracked hands</small></div>
      <div class="pstat"><strong>{data.poker.aggressionFactor == null ? "—" : data.poker.aggressionFactor.toLocaleString()}</strong><span>Aggression factor</span><small>{fmt(data.poker.betsRaises)} bets/raises · {fmt(data.poker.calls)} calls</small></div>
      <div class="pstat"><strong>{fmt(data.poker.showdownsSeen)}</strong><span>Showdowns seen</span><small>{fmt(data.poker.showdownsWon)} won · {data.poker.showdownWinRate.toLocaleString()}%</small></div>
    </div>
    <p class="method muted small">VPIP and PFR use deterministic engine re-simulation to read the street before every recorded action. Lifetime hands and net include legacy cash history; advanced rates are capped at the newest 400 recorded poker hands.</p>
  </section>

  <section class="section-block">
    <div class="section-head">
      <div><p class="cap">Game mix</p><h2>Mode breakdown</h2></div>
    </div>
    {#if data.modes.length === 0}
      <div class="card empty-table muted">No recorded modes yet.</div>
    {:else}
      <div class="mode-table card">
        <div class="mode-row mode-header" aria-hidden="true">
          <span>Mode</span><span>Matches</span><span>Net</span><span>Win rate</span><span>Best win</span><span>Last played</span>
        </div>
        {#each playerModes as row (`${row.mode}:${row.role}`)}
          <div class="mode-row">
            <span class="mode-name">{modeName(row.mode)}</span>
            <span>{fmt(row.matches)}</span>
            <span class:pos={row.net >= 0} class:neg={row.net < 0}>{signed(row.net)}</span>
            <span>{row.winRate.toLocaleString()}%</span>
            <span class="gold">{fmt(row.biggestWin)}</span>
            <span class="muted">{dateLabel(row.lastPlayed)}</span>
          </div>
        {/each}
        {#if bankerModes.length}
          <div class="role-divider"><span>Banking results</span><small>Separated from ordinary player bets</small></div>
          {#each bankerModes as row (`${row.mode}:${row.role}`)}
            <div class="mode-row banker-row">
              <span class="mode-name">{modeName(row.mode)} <em>Banker</em></span>
              <span>{fmt(row.matches)}</span>
              <span class:pos={row.net >= 0} class:neg={row.net < 0}>{signed(row.net)}</span>
              <span>{row.winRate.toLocaleString()}%</span>
              <span class="gold">{fmt(row.biggestWin)}</span>
              <span class="muted">{dateLabel(row.lastPlayed)}</span>
            </div>
          {/each}
        {/if}
      </div>
    {/if}
  </section>
</div>

<style>
  .wrap { max-width: 980px; margin: 0 auto; }
  .page-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; margin-bottom: 18px; }
  h1 { margin: 1px 0 0; font-size: 30px; }
  h2 { margin: 2px 0 0; font-size: 18px; }
  h3 { margin: 0; font-size: 14px; }
  .cap { margin: 0; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; font-size: 10.5px; font-weight: 800; }
  .intro { margin: 7px 0 0; max-width: 650px; }
  .history-link { color: var(--accent-ink); text-decoration: none; font-weight: 700; font-size: 13px; background: var(--well); padding: 9px 13px; border-radius: var(--r-pill); }
  .history-link:hover { color: var(--text); background: var(--surface-2); }

  .overview { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
  .metric { margin: 0; display: flex; flex-direction: column; gap: 5px; min-height: 132px; justify-content: center; }
  .metric strong { font-family: var(--f-display); font-size: 26px; font-weight: 850; font-variant-numeric: tabular-nums; display: flex; align-items: center; gap: 7px; }
  .metric small, .pstat small { color: var(--muted); font-size: 11.5px; line-height: 1.35; }
  .money, .gold { color: var(--gold-ink); }
  .pos { color: var(--ok, #6ee7a8) !important; }
  .neg { color: var(--danger) !important; }

  .section-block, .chart-card, .poker-card { margin-top: 24px; }
  .section-head { display: flex; align-items: flex-end; justify-content: space-between; gap: 16px; margin-bottom: 12px; }
  .contexts { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
  .context-card { background: color-mix(in srgb, var(--surface) 76%, var(--well)); border-radius: var(--r-card); padding: 15px; box-shadow: var(--shadow-card); }
  .context-top { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; }
  .context-top span, .context-meta { color: var(--muted); font-size: 11.5px; }
  .context-net { margin: 12px 0 8px; font-family: var(--f-display); font-size: 22px; font-weight: 850; font-variant-numeric: tabular-nums; }
  .context-meta { display: flex; justify-content: space-between; gap: 12px; font-variant-numeric: tabular-nums; }

  .chart-card, .poker-card { margin-bottom: 0; padding: 18px; }
  .chart-wrap { width: 100%; overflow: hidden; background: color-mix(in srgb, var(--well) 76%, transparent); border-radius: var(--r-card); padding: 8px 4px 0; }
  svg { display: block; width: 100%; height: auto; color: var(--muted); }
  .zero { fill: color-mix(in srgb, var(--muted) 24%, transparent); }
  .bar-pos { fill: var(--ok, #6ee7a8); }
  .bar-neg { fill: var(--danger); }
  .axis-label { fill: currentColor; font-size: 11px; font-family: inherit; }
  .chart-scale { display: flex; justify-content: space-between; gap: 16px; margin-top: 8px; font-size: 11.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .empty-chart, .empty-table { text-align: center; padding: 42px 18px; }

  .poker-totals { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; margin-bottom: 10px; }
  .poker-totals > div { background: var(--well); border-radius: var(--r-btn); padding: 13px; display: flex; flex-direction: column; gap: 5px; }
  .poker-totals strong { font-size: 20px; font-weight: 850; font-variant-numeric: tabular-nums; }
  .poker-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
  .pstat { background: color-mix(in srgb, var(--surface) 62%, var(--well)); border-radius: var(--r-btn); padding: 14px; display: flex; flex-direction: column; gap: 4px; }
  .pstat strong { font-family: var(--f-display); font-size: 24px; font-weight: 850; font-variant-numeric: tabular-nums; }
  .pstat > span { font-size: 12px; font-weight: 800; }
  .method { margin: 13px 2px 0; }

  .mode-table { margin: 0; padding: 6px 12px; overflow-x: auto; }
  .mode-row { min-width: 760px; display: grid; grid-template-columns: minmax(170px, 1.4fr) repeat(4, minmax(88px, .7fr)) minmax(110px, .9fr); align-items: center; gap: 12px; padding: 12px 8px; font-size: 13px; font-variant-numeric: tabular-nums; }
  .mode-row:not(.mode-header) { background: color-mix(in srgb, var(--surface) 70%, var(--well)); border-radius: var(--r-btn); margin: 6px 0; }
  .mode-header { color: var(--muted); text-transform: uppercase; letter-spacing: .06em; font-size: 10px; font-weight: 800; padding-bottom: 4px; }
  .mode-name { font-weight: 750; color: var(--text); }
  .mode-name em { display: inline-block; margin-left: 5px; padding: 3px 7px; border-radius: var(--r-pill); background: var(--well); color: var(--gold-ink); font-style: normal; font-size: 9.5px; text-transform: uppercase; letter-spacing: .05em; }
  .banker-row { background: color-mix(in srgb, var(--gold-ink) 7%, var(--surface)) !important; }
  .role-divider { display: flex; align-items: baseline; gap: 9px; padding: 14px 8px 3px; color: var(--gold-ink); font-size: 12px; font-weight: 800; }
  .role-divider small { color: var(--muted); font-weight: 500; }

  @media (max-width: 820px) {
    .overview { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .poker-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  }
  @media (max-width: 620px) {
    .page-head { align-items: flex-start; }
    .contexts, .poker-totals { grid-template-columns: 1fr; }
    .chart-head { align-items: flex-start; flex-direction: column; gap: 5px; }
  }
  @media (max-width: 440px) {
    .overview, .poker-grid { grid-template-columns: 1fr; }
    .page-head { flex-direction: column; }
    .metric { min-height: 0; }
  }
</style>
