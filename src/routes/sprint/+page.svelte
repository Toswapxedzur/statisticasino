<script>
  import { enhance } from "$app/forms";
  import { onMount } from "svelte";
  import Avatar from "$lib/poker/components/Avatar.svelte";
  import Chip from "$lib/poker/components/Chip.svelte";

  let { data, form } = $props();
  let now = $state(Date.now());
  let entered = $state(!!data.featured?.entered);
  let chips = $state(data.chips);

  onMount(() => {
    const h = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(h);
  });

  const fmt = (n) => Number(n).toLocaleString();
  const f = $derived(data.featured);
  const startsInMs = $derived(f ? Number(f.scheduled_at) - now : 0);
  function countdown(ms) {
    if (ms <= 0) return "now";
    const s = Math.floor(ms / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
    return `${sec}s`;
  }
  const playedToday = $derived(!!data.featured?.playedToday && !entered);

  function onRegister() {
    return () => async ({ result, update }) => {
      if (result.type === "success" && result.data?.registered) {
        entered = true;
        chips = chips - data.cfg.bid;
      }
      await update({ reset: false });
    };
  }
</script>

<svelte:head><title>River Sprint — Bluffing Valley</title></svelte:head>

<div class="wrap">
  <div class="head">
    <div>
      <div class="eyebrow">⚡ Daily event</div>
      <h1>River Sprint</h1>
    </div>
    {#if data.signedIn}<div class="bal"><Chip value={chips} size={20} /> {fmt(chips)}</div>{/if}
  </div>
  <p class="muted intro">
    A {data.cfg.durationMin}-minute fast-fold race. Fold and you're instantly moved to a new table — non-stop action, real decisions. Most chips at the buzzer wins a share of the pool. {data.cfg.roundsPerDay} rounds a day, one entry each.
  </p>

  {#if f}
    <section class="card feature" class:live={f.status === "live"}>
      <div class="feat-top">
        <div>
          <div class="label">{f.status === "live" ? "Round in progress" : "Next round"}</div>
          <div class="when">{f.status === "live" ? "Playing now" : `Starts in ${countdown(startsInMs)}`}</div>
        </div>
        <div class="stat">
          <div class="stat-n">{f.entrants || 0}</div>
          <div class="stat-l">entered</div>
        </div>
      </div>

      <div class="specs">
        <div><span class="sv"><Chip value={data.cfg.bid} size={16} /> {fmt(data.cfg.bid)}</span><span class="sl">Buy-in</span></div>
        <div><span class="sv">{fmt(data.cfg.startingStack)}</span><span class="sl">Starting stack</span></div>
        <div><span class="sv">{data.cfg.durationMin} min</span><span class="sl">Clock</span></div>
        <div><span class="sv">70 / 30</span><span class="sl">Bids / house</span></div>
      </div>

      <div class="cta">
        {#if !data.signedIn}
          <a class="btn-primary" href="/account/login">Sign in to enter</a>
        {:else if entered}
          <span class="enrolled">✓ You're in — good luck!</span>
        {:else if f.status === "live"}
          <span class="closed">Round already underway</span>
        {:else if playedToday}
          <span class="closed">Already entered a Sprint today — back tomorrow</span>
        {:else}
          <form method="POST" action="?/register" use:enhance={onRegister()}>
            <input type="hidden" name="roundId" value={f.id} />
            <button class="btn-primary" type="submit">Enter for {fmt(data.cfg.bid)} chips</button>
          </form>
        {/if}
        {#if form?.error}<span class="err">{form.error}</span>{/if}
      </div>
    </section>
  {:else}
    <div class="card empty"><p class="muted">No rounds scheduled right now — check back soon.</p></div>
  {/if}

  {#if data.upcoming.length > 1}
    <div class="up">
      <span class="muted small">Also today:</span>
      {#each data.upcoming.slice(1, 3) as r (r.id)}
        <span class="up-chip">{new Date(Number(r.scheduled_at)).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
      {/each}
    </div>
  {/if}

  {#if data.lastResults?.length}
    <section class="card">
      <div class="card-head"><h2>Last round</h2><span class="muted small">Prize pool {fmt(data.lastRound.prize_pool)}</span></div>
      <div class="board">
        {#each data.lastResults as r (r.user_id)}
          <div class="lrow" class:top={r.place <= 3}>
            <span class="rank" class:medal={r.place <= 3}>{r.place}</span>
            <Avatar id={r.user_id} name={r.name} mediaId={r.avatar_media_id} size={30} userId={r.user_id} />
            <a class="lname" href="/u/{r.user_id}">{r.name}</a>
            {#if r.prize > 0}<span class="prize"><Chip value={r.prize} size={14} /> +{fmt(r.prize)}</span>{/if}
          </div>
        {/each}
      </div>
    </section>
  {/if}
</div>

<style>
  .wrap { max-width: 620px; margin: 0 auto; }
  .head { display: flex; align-items: flex-end; justify-content: space-between; gap: 12px; }
  .eyebrow { font-size: 12px; font-weight: 700; letter-spacing: .04em; color: var(--gold-ink); text-transform: uppercase; }
  h1 { margin: 2px 0 0; font-size: 28px; }
  .bal { font-weight: 800; font-variant-numeric: tabular-nums; color: var(--gold-ink); font-size: 16px; display: inline-flex; align-items: center; gap: 7px; }
  .intro { margin: 8px 0 20px; max-width: 60ch; }

  .feature { padding: 20px; }
  .feature.live { box-shadow: 0 0 0 1px var(--gold-line, rgba(200,160,60,.4)), var(--shadow-card); }
  .feat-top { display: flex; align-items: flex-start; justify-content: space-between; }
  .label { font-size: 11.5px; letter-spacing: .05em; text-transform: uppercase; color: var(--muted); font-weight: 600; }
  .when { font-size: 22px; font-weight: 800; margin-top: 3px; }
  .stat { text-align: right; }
  .stat-n { font-size: 24px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .stat-l { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: .04em; }

  .specs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 18px 0; }
  .specs > div { display: flex; flex-direction: column; gap: 2px; background: var(--well); border-radius: var(--r-btn); padding: 10px 12px; }
  .sv { font-weight: 700; font-size: 14px; font-variant-numeric: tabular-nums; display: inline-flex; align-items: center; gap: 5px; }
  .sl { font-size: 10.5px; color: var(--muted); text-transform: uppercase; letter-spacing: .03em; }

  .cta { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .btn-primary { border: 0; cursor: pointer; font-weight: 700; font-size: 14px; color: #1a1200;
    background: var(--gold-ink); padding: 11px 20px; border-radius: var(--r-pill); text-decoration: none; display: inline-block;
    transition: filter var(--dur) var(--ease); }
  .btn-primary:hover { filter: brightness(1.08); }
  .cta form { margin: 0; }
  .enrolled { font-weight: 700; color: var(--ok); }
  .closed { font-weight: 600; color: var(--muted); }
  .err { color: var(--danger); font-size: 13px; }

  .up { display: flex; align-items: center; gap: 8px; margin: 14px 2px 0; }
  .up-chip { font-size: 12.5px; font-family: inherit; font-variant-numeric: tabular-nums; background: var(--well); border-radius: var(--r-pill); padding: 4px 10px; color: var(--text); }

  .card-head { display: flex; align-items: baseline; justify-content: space-between; }
  .card-head h2 { margin: 0; font-size: 16px; }
  .board { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; }
  .lrow { display: flex; align-items: center; gap: 11px; padding: 8px 4px; }
  .rank { width: 22px; text-align: center; font-weight: 800; color: var(--muted); font-variant-numeric: tabular-nums; }
  .rank.medal { color: var(--gold-ink); }
  .lname { flex: 1; min-width: 0; font-weight: 700; font-size: 14px; color: var(--text); text-decoration: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .lname:hover { color: var(--accent-ink); }
  .prize { font-weight: 800; color: var(--gold-ink); font-variant-numeric: tabular-nums; font-size: 13.5px; display: inline-flex; align-items: center; gap: 5px; }
  .empty { text-align: center; padding: 30px; }
</style>
