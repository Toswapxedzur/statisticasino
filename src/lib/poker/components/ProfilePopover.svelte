<script>
  // The single app-wide profile popover. Mounted once in the root layout; opens
  // when any avatar calls profilePop.open(userId, rect). Fetches a mini-profile
  // and lets you add/accept/message without leaving the page.
  import { profilePop } from "$lib/profilePopover.svelte.js";
  import Avatar from "$lib/poker/components/Avatar.svelte";
  import { calls } from "$lib/poker/call.svelte.js";
  import { fly } from "svelte/transition";
  import { d, DUR } from "$lib/motion.js";

  let profile = $state(null);
  let loading = $state(false);
  let busy = $state(false);
  let cardEl = $state(null);

  $effect(() => {
    const id = profilePop.userId;
    if (!id) { profile = null; return; }
    loading = true; profile = null;
    fetch(`/api/user/${id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => { if (profilePop.userId === id) { profile = p; loading = false; } })
      .catch(() => { loading = false; });
  });

  $effect(() => {
    if (typeof document === "undefined") return;
    const onDoc = (e) => { if (profilePop.userId && cardEl && !cardEl.contains(e.target)) profilePop.close(); };
    const onKey = (e) => { if (e.key === "Escape") profilePop.close(); };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDoc); document.removeEventListener("keydown", onKey); };
  });

  const pos = $derived.by(() => {
    const r = profilePop.rect;
    const W = 260, H = 220;
    if (!r || typeof window === "undefined") return { top: "80px", left: "50%" };
    let left = Math.min(Math.max(8, r.left), window.innerWidth - W - 8);
    let top = r.bottom + 8;
    if (top + H > window.innerHeight) top = Math.max(8, r.top - H - 8);
    return { top: top + "px", left: left + "px" };
  });

  async function act(action) {
    if (!profile || busy) return;
    busy = true;
    try {
      const res = await fetch("/api/friends", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: profile.id, action }),
      });
      const j = await res.json().catch(() => ({}));
      const s = j.status;
      if (s === "pending") profile = { ...profile, relationship: "outgoing" };
      else if (s === "friends" || s === "accepted" || s === "exists") profile = { ...profile, relationship: s === "exists" ? profile.relationship : "friends" };
      else if (s === "none") profile = { ...profile, relationship: "none" };
      else if (s === "blocked") profile = { ...profile, reqError: "They aren't accepting friend requests." };
      else if (s === "blocked_fof") profile = { ...profile, reqError: "Only friends-of-friends can add them." };
    } finally { busy = false; }
  }
</script>

{#if profilePop.userId}
  <div class="pp-card card" bind:this={cardEl} style="top:{pos.top};left:{pos.left}" transition:fly={{ y: d(-6), duration: d(DUR.fast) }}>
    {#if loading || !profile}
      <div class="pp-loading muted">Loading…</div>
    {:else}
      <div class="pp-head">
        <Avatar id={profile.id} name={profile.name} mediaId={profile.avatarMediaId} size={44} />
        <div class="pp-idblock">
          <a class="pp-name" href="/u/{profile.id}">{profile.name}{#if profile.online}<span class="pp-on" title="Online"></span>{/if}</a>
          {#if profile.statusText}<span class="pp-status">{profile.statusText}</span>{/if}
        </div>
      </div>
      {#if !profile.restricted && profile.stats}
        <div class="pp-stats">
          <span><b>{profile.stats.handsPlayed.toLocaleString()}</b> hands</span>
          <span class:pos={profile.stats.netGame >= 0} class:neg={profile.stats.netGame < 0}><b>{profile.stats.netGame >= 0 ? "+" : ""}{profile.stats.netGame.toLocaleString()}</b> net</span>
        </div>
      {/if}
      {#if profile.reqError}<div class="pp-err">{profile.reqError}</div>{/if}
      <div class="pp-actions">
        {#if profile.isSelf}
          <a class="btn btn-sm btn-secondary" href="/u/{profile.id}">View profile</a>
        {:else}
          {#if profile.relationship === "friends"}
            <a class="btn btn-sm" href="/social?to={profile.id}">Message</a>
            {#if profile.online}<button class="btn btn-sm btn-secondary pp-call" title="Voice call" aria-label="Voice call" onclick={() => { const p = profile; profilePop.close(); calls.start(p.id, p.name); }}>📞</button>{/if}
          {:else if profile.relationship === "incoming"}
            <button class="btn btn-sm" disabled={busy} onclick={() => act("accept")}>Accept</button>
          {:else if profile.relationship === "outgoing"}
            <button class="btn btn-sm btn-secondary" disabled>Requested</button>
          {:else}
            <button class="btn btn-sm" disabled={busy} onclick={() => act("request")}>＋ Add friend</button>
          {/if}
          <a class="btn btn-sm btn-secondary" href="/u/{profile.id}">Profile</a>
        {/if}
      </div>
    {/if}
  </div>
{/if}

<style>
  .pp-card { position: fixed; z-index: 200; width: 260px; padding: 14px; margin: 0; box-shadow: var(--shadow-panel); }
  .pp-loading { padding: 8px 0; text-align: center; }
  .pp-head { display: flex; align-items: center; gap: 11px; }
  .pp-idblock { min-width: 0; display: flex; flex-direction: column; }
  .pp-name { font-weight: 700; font-size: 15px; color: var(--text); text-decoration: none; display: inline-flex; align-items: center; gap: 7px; }
  .pp-name:hover { color: var(--accent-ink); }
  .pp-on { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 6px var(--ok); }
  .pp-status { font-size: 12px; color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pp-stats { display: flex; gap: 16px; margin: 11px 0; font-size: 12.5px; color: var(--muted); }
  .pp-stats b { color: var(--text); font-variant-numeric: tabular-nums; }
  .pp-stats .pos b { color: var(--ok); } .pp-stats .neg b { color: var(--danger); }
  .pp-err { font-size: 12px; color: var(--danger); margin-bottom: 8px; }
  .pp-actions { display: flex; gap: 8px; margin-top: 4px; }
  .pp-actions .btn { flex: 1; }
  .pp-actions .pp-call { flex: 0 0 auto; }
</style>
