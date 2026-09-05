<script>
  // Data hub: search any player, browse your in-game history, and look at
  // another player's in-game history (within what they expose).
  import { goto } from "$app/navigation";
  import Avatar from "$lib/poker/components/Avatar.svelte";
  import MatchList from "$lib/components/MatchList.svelte";

  let { data } = $props();

  let q = $state("");
  let results = $state([]);
  let searching = $state(false);
  let timer = null;
  function onInput() {
    clearTimeout(timer);
    if (q.trim().length < 2) { results = []; return; }
    timer = setTimeout(search, 180);
  }
  async function search() {
    if (!data.signedIn) return;
    searching = true;
    try {
      const res = await fetch(`/api/friends/find?q=${encodeURIComponent(q.trim())}`);
      results = res.ok ? (await res.json()).results : [];
    } catch { results = []; }
    searching = false;
  }
  function open(id) { results = []; q = ""; goto(`/data?u=${encodeURIComponent(id)}`); }
</script>

<svelte:head><title>Data — Riverside</title></svelte:head>

<div class="wrap">
  <div class="head">
    <h1>Data</h1>
    {#if data.horizonDays}<span class="muted small">Last {data.horizonDays} days</span>{/if}
  </div>
  <p class="muted intro">Your in-game history, other players' history, and every replay — recorded automatically as you play.</p>

  <section class="card search">
    <label class="field"><span>Look up a player</span></label>
    {#if data.signedIn}
      <input class="q" type="search" placeholder="Search by name…" bind:value={q} oninput={onInput} autocomplete="off" />
      {#if results.length}
        <ul class="results">
          {#each results as r (r.id)}
            <li>
              <button class="res" type="button" onclick={() => open(r.id)}>
                <Avatar id={r.id} name={r.name} mediaId={r.avatarMediaId ?? r.avatar_media_id ?? null} size={26} />
                <span class="res-name">{r.name}</span>
                <span class="muted small res-go">View history →</span>
              </button>
            </li>
          {/each}
        </ul>
      {:else if q.trim().length >= 2 && !searching}
        <p class="muted small">No players match “{q.trim()}”.</p>
      {/if}
    {:else}
      <p class="muted small"><a href="/account/login">Sign in</a> to search players and see your own history.</p>
    {/if}
  </section>

  {#if data.player}
    <section class="card player">
      {#if data.player.missing}
        <p class="muted">No such player.</p>
      {:else}
        <div class="p-head">
          <Avatar id={data.player.id} name={data.player.name} mediaId={data.player.avatarMediaId} size={36} />
          <div class="p-id">
            <h2>{data.player.name}</h2>
            <a class="muted small" href="/u/{data.player.id}">Open profile →</a>
          </div>
        </div>
        {#if data.player.restricted}
          <p class="muted small">This profile is private.</p>
        {:else if data.player.privateHistory}
          <p class="muted small">This player keeps their play history private.</p>
        {:else}
          <div class="cap">In-game history</div>
          <MatchList matches={data.player.matches} empty="No matches in the visible window." />
        {/if}
      {/if}
    </section>
  {/if}

  {#if data.myMatches}
    <section class="card mine">
      <div class="sec-head">
        <h2>Your history</h2>
        <a class="muted small" href="/stats">Full statistics →</a>
      </div>
      <MatchList matches={data.myMatches} empty="You haven't played a recorded match in this window yet." />
    </section>
  {/if}
</div>

<style>
  .wrap { max-width: 760px; margin: 0 auto; }
  .head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  h1 { margin: 0; font-size: 26px; }
  .intro { margin: 6px 0 18px; }
  .card { margin-bottom: 14px; }
  .q { width: 100%; font-size: 15px; padding: 11px 14px; border: 0; border-radius: 12px;
    background: var(--well); color: var(--text); outline: none; }
  .results { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .res { display: flex; align-items: center; gap: 10px; width: 100%; text-align: left; border: 0; cursor: pointer;
    padding: 8px 10px; border-radius: 10px; background: transparent; color: var(--text); }
  .res:hover { background: color-mix(in srgb, var(--surface) 70%, #fff 6%); }
  .res-name { font-weight: 700; flex: 1; }
  .p-head { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
  .p-id h2 { margin: 0; font-size: 18px; }
  .cap { color: var(--muted); font-size: 11.5px; text-transform: uppercase; letter-spacing: .6px; margin: 8px 0; }
  .sec-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 10px; }
  .sec-head h2 { margin: 0; font-size: 18px; }
</style>
