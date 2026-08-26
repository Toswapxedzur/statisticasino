<script>
  import { enhance } from "$app/forms";
  import { fly } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";
  import { fade, scale } from "svelte/transition";
  import Avatar from "$lib/poker/components/Avatar.svelte";
  let { data, form } = $props();
  const p = $derived(data.profile);
  const pres = $derived(data.presence);
  let sendOpen = $state(false);
  let amount = $state("");
  let reportOpen = $state(false);

  const AV = ["#c0674f", "#4f7bc0", "#59a06a", "#8a5fb0", "#b0824f", "#4fa3b0", "#c05f8a", "#6a8f3a"];
  function color(id) { let h = 0; for (const c of String(id || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AV[h % AV.length]; }
  const initial = (n) => String(n || "?").trim().charAt(0).toUpperCase() || "?";
  const fmt = (n) => Number(n).toLocaleString();
  function since(ts) { try { return new Date(ts).toLocaleDateString([], { year: "numeric", month: "long" }); } catch { return ""; } }
  const rel = $derived(p.relationship);
</script>

<svelte:head><title>{p.name} — Riverside</title></svelte:head>

<div class="wrap">
  <a class="back" href="/social">‹ Social</a>

  <section class="hero card" in:fly={{ y: d(10), duration: d(DUR.base) }}>
    <Avatar id={p.id} name={p.name} mediaId={p.avatarMediaId} size={84} />
    <div class="hero-main">
      <h1>{p.name}{#if pres.online}<span class="on-dot" title="Online"></span>{/if}</h1>
      {#if p.statusText}<p class="status">{p.statusText}</p>{/if}
      <p class="since">Member since {since(p.memberSince)}{#if pres.online && pres.tableName} · playing at {pres.tableName}{/if}</p>
    </div>
    {#if !p.isSelf}
      <div class="actions">
        {#if rel === "friends"}
          <a class="btn" href="/social?to={p.id}">Message</a>
          <button class="btn btn-gold" onclick={() => (sendOpen = true)}>Send chips</button>
          <form method="POST" action="?/removeFriend" use:enhance><button class="btn btn-secondary" type="submit">Remove</button></form>
        {:else if rel === "incoming"}
          <form method="POST" action="?/acceptFriend" use:enhance><button class="btn" type="submit">Accept request</button></form>
        {:else if rel === "outgoing"}
          <button class="btn btn-secondary" disabled>Request sent</button>
        {:else}
          <form method="POST" action="?/addFriend" use:enhance><button class="btn" type="submit">Add friend</button></form>
        {/if}
      </div>
    {:else}
      <a class="btn btn-secondary" href="/account">Edit profile</a>
    {/if}
  </section>

  {#if form?.ok}<p class="form-success">{form.ok === "pending" ? "Friend request sent." : form.ok === "accepted" ? "You're now friends!" : "Done."}</p>{/if}
  {#if form?.transferOk}<p class="form-success">{form.transferOk}</p>{/if}
  {#if form?.transferError}<p class="form-error">{form.transferError}</p>{/if}
  {#if form?.ok === "blocked"}<p class="form-success">Blocked. They can no longer message or add you.</p>{/if}
  {#if form?.ok === "reported"}<p class="form-success">Report submitted — thanks. Our team will review it.</p>{/if}

  {#if !p.isSelf}
    <div class="mod-row">
      {#if p.blocked}
        <form method="POST" action="?/unblock" use:enhance><button class="btn btn-secondary btn-sm" type="submit">Unblock</button></form>
      {:else}
        <form method="POST" action="?/block" use:enhance><button class="btn btn-secondary btn-sm" type="submit">Block</button></form>
      {/if}
      <button class="btn btn-secondary btn-sm" onclick={() => (reportOpen = true)}>Report</button>
    </div>
  {/if}

  {#if p.restricted}
    <div class="card restricted"><p class="muted">This profile is private.</p></div>
  {:else}
    {#if p.bio}<section class="card bio"><h3>About</h3><p>{p.bio}</p></section>{/if}
    <section class="stats">
      <div class="stat card" in:fly={{ y: d(10), duration: d(DUR.base), delay: d(40) }}><span class="s-val gold">{fmt(p.chips)}</span><span class="s-lbl">Chips</span></div>
      <div class="stat card" in:fly={{ y: d(10), duration: d(DUR.base), delay: d(80) }}><span class="s-val">{fmt(p.stats.handsPlayed)}</span><span class="s-lbl">Hands played</span></div>
      <div class="stat card" in:fly={{ y: d(10), duration: d(DUR.base), delay: d(120) }}><span class="s-val" class:pos={p.stats.netGame >= 0} class:neg={p.stats.netGame < 0}>{p.stats.netGame >= 0 ? "+" : ""}{fmt(p.stats.netGame)}</span><span class="s-lbl">Net at tables</span></div>
      <div class="stat card" in:fly={{ y: d(10), duration: d(DUR.base), delay: d(160) }}><span class="s-val">{fmt(p.stats.biggestPot)}</span><span class="s-lbl">Biggest win</span></div>
      <div class="stat card" in:fly={{ y: d(10), duration: d(DUR.base), delay: d(200) }}><span class="s-val">{fmt(p.stats.achievements)}</span><span class="s-lbl">Achievements</span></div>
      <div class="stat card" in:fly={{ y: d(10), duration: d(DUR.base), delay: d(240) }}><span class="s-val">🔥 {p.stats ? p.streak : 0}</span><span class="s-lbl">Day streak (best {p.bestStreak})</span></div>
    </section>
  {/if}
</div>

{#if sendOpen}
  <div class="modal-backdrop" role="presentation" onclick={() => (sendOpen = false)} transition:fade={{ duration: d(DUR.fast) }}>
    <div class="modal card" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()} transition:scale={{ start: 0.96, duration: d(DUR.base) }}>
      <h3>Send chips to {p.name}</h3>
      <p class="muted small send-note">You can send up to <b class="cap">{data.transferable.toLocaleString()}</b> chips — the chips you've won at the tables. <span class="hint">Free rewards can't be sent.</span></p>
      <form method="POST" action="?/transfer" use:enhance={() => async ({ update }) => { await update(); sendOpen = false; amount = ""; }}>
        <input class="amt-input" name="amount" type="number" min="1" max={data.transferable} bind:value={amount} placeholder="Amount" autocomplete="off" />
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick={() => (sendOpen = false)}>Cancel</button>
          <button class="btn btn-gold" type="submit" disabled={!(+amount > 0) || +amount > data.transferable}>Send {+amount > 0 ? (+amount).toLocaleString() : ""}</button>
        </div>
      </form>
    </div>
  </div>
{/if}

{#if reportOpen}
  <div class="modal-backdrop" role="presentation" onclick={() => (reportOpen = false)} transition:fade={{ duration: d(DUR.fast) }}>
    <div class="modal card" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()} transition:scale={{ start: 0.96, duration: d(DUR.base) }}>
      <h3>Report {p.name}</h3>
      <form method="POST" action="?/report" use:enhance={() => async ({ update }) => { await update(); reportOpen = false; }}>
        <textarea class="report-input" name="reason" rows="4" maxlength="500" placeholder="What's the problem? (optional)"></textarea>
        <div class="modal-actions">
          <button type="button" class="btn btn-secondary" onclick={() => (reportOpen = false)}>Cancel</button>
          <button class="btn btn-danger" type="submit">Submit report</button>
        </div>
      </form>
    </div>
  </div>
{/if}

<style>
  .mod-row { display: flex; gap: 8px; margin: 10px 0; }
  .mod-row form { display: inline-flex; }
  .report-input { width: 100%; font: inherit; }
  .wrap { max-width: 760px; margin: 0 auto; }
  .back { color: var(--muted); font-size: 13px; text-decoration: none; display: inline-block; margin-bottom: 12px; }
  .back:hover { color: var(--text); }
  .hero { display: flex; align-items: center; gap: 18px; }
  .big-av { width: 84px; height: 84px; font-size: 34px; flex: 0 0 auto; }
  .hero-main { flex: 1; min-width: 0; }
  .hero-main h1 { margin: 0; font-size: 26px; display: flex; align-items: center; gap: 10px; }
  .on-dot { width: 11px; height: 11px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 8px var(--ok); }
  .status { margin: 4px 0 0; color: var(--text); font-size: 14px; }
  .since { margin: 4px 0 0; color: var(--muted); font-size: 12.5px; }
  .actions { display: flex; gap: 8px; flex: 0 0 auto; }
  .actions form { display: inline-flex; }
  .bio h3 { margin: 0 0 6px; font-size: 15px; }
  .bio p { margin: 0; color: var(--text); }
  .restricted { text-align: center; padding: 30px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; }
  .stat { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; margin-bottom: 0; }
  .s-val { font-size: 24px; font-weight: 800; font-variant-numeric: tabular-nums; font-family: var(--f-display); }
  .s-val.gold { color: var(--gold-ink); }
  .s-val.pos { color: var(--ok); } .s-val.neg { color: var(--danger); }
  .s-lbl { font-size: 11.5px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.04em; font-weight: 600; }
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: grid; place-items: center; z-index: 60; padding: 20px; }
  .modal { width: min(400px, 94vw); }
  .modal h3 { margin: 0 0 10px; }
  .send-note { margin: 0 0 12px; }
  .cap { color: var(--gold-ink); }
  .hint { display: block; margin-top: 4px; opacity: 0.8; }
  .amt-input { width: 100%; font-size: 18px; text-align: center; font-variant-numeric: tabular-nums; }
  .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 14px; }
  @media (max-width: 560px) { .hero { flex-wrap: wrap; } .actions { width: 100%; } }
</style>
