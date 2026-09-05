<script>
  import { onMount } from "svelte";
  import { enhance } from "$app/forms";
  import Select from "$lib/components/Select.svelte";
  import Checkbox from "$lib/components/Checkbox.svelte";
  let { data, form } = $props();

  // --- Appearance (client-side theme) ---
  let theme = $state("system");
  onMount(() => { try { theme = localStorage.getItem("rv-theme") || "system"; } catch { theme = "system"; } });
  function setTheme(t) {
    theme = t;
    const root = document.documentElement;
    try {
      if (t === "system") { root.removeAttribute("data-theme"); localStorage.removeItem("rv-theme"); }
      else { root.setAttribute("data-theme", t); localStorage.setItem("rv-theme", t); }
    } catch { /* ignore */ }
  }

  // --- Privacy (form) ---
  let visibility = $state(data.visibility);
  let historyWindow = $state(["private", "7d"].includes(data.historyWindow) ? data.historyWindow : "7d");
  let friendReqPolicy = $state(data.friendReqPolicy);

  // --- Social toggles (form via hidden inputs) ---
  let s = $state({ ...data.settings });
  const SOCIAL = [
    { key: "readReceipts", label: "Send read receipts (others see when you've read their message)" },
    { key: "typing", label: "Show when I'm typing" },
    { key: "allowGroupAdd", label: "Let friends add me to group chats" },
  ];
  const NOTIFS = [
    { key: "notifyFriendReq", label: "Friend requests" },
    { key: "notifyMessages", label: "New messages" },
    { key: "notifyTransfers", label: "Chip transfers" },
  ];
</script>

<svelte:head><title>Settings — Riverside</title></svelte:head>

<div class="wrap">
  <h1>Settings</h1>

  <section class="card">
    <div class="card-head"><h3>Appearance</h3></div>
    <label class="field"><span>Theme</span></label>
    <div class="seg">
      {#each [["light", "☀ Light"], ["dark", "☾ Dark"], ["system", "🖥 System"]] as [val, lbl]}
        <button type="button" class="seg-btn" class:on={theme === val} onclick={() => setTheme(val)}>{lbl}</button>
      {/each}
    </div>
    <p class="muted small">System follows your device's light/dark setting.</p>
  </section>

  <section class="card">
    <div class="card-head"><h3>Privacy</h3></div>
    <form method="POST" action="?/savePrivacy" use:enhance>
      <label class="field"><span>Who can see my profile</span></label>
      <Select name="visibility" bind:value={visibility} block
        options={[{ value: "public", label: "Everyone" }, { value: "friends", label: "Friends only" }, { value: "private", label: "Nobody (private)" }]} />
      <label class="field" style="margin-top:14px"><span>Who can send me friend requests</span></label>
      <Select name="friendReqPolicy" bind:value={friendReqPolicy} block
        options={[{ value: "everyone", label: "Everyone" }, { value: "fof", label: "Friends of friends" }, { value: "nobody", label: "Nobody" }]} />
      <label class="field" style="margin-top:14px"><span>Public play history &amp; replays</span></label>
      <Select name="historyWindow" bind:value={historyWindow} block
        options={[
          { value: "private", label: "Private (only me)" },
          { value: "7d", label: "Show the last 7 days" }
        ]} />
      <p class="muted small">Riverside keeps 7 days of play history. Visitors to your profile can see your stats and step-through replays from that window; your hole cards in an exposed replay stay hidden unless they were revealed at showdown.</p>
      <button class="btn" type="submit" style="margin-top:14px">Save privacy</button>
      {#if form?.privacyOk}<p class="form-success">Saved.</p>{/if}
    </form>
  </section>

  <section class="card">
    <div class="card-head"><h3>Social</h3></div>
    <form method="POST" action="?/saveSocial" use:enhance>
      {#each SOCIAL as t}
        <div class="toggle-row"><Checkbox bind:checked={s[t.key]} label={t.label} /></div>
        <input type="hidden" name={t.key} value={String(s[t.key])} />
      {/each}
      <h4 class="sub">Notifications</h4>
      {#each NOTIFS as t}
        <div class="toggle-row"><Checkbox bind:checked={s[t.key]} label={t.label} /></div>
        <input type="hidden" name={t.key} value={String(s[t.key])} />
      {/each}
      <button class="btn" type="submit" style="margin-top:14px">Save</button>
      {#if form?.socialOk}<p class="form-success">Saved.</p>{/if}
    </form>
  </section>
</div>

<style>
  .wrap { max-width: 620px; margin: 0 auto; }
  h1 { margin: 0 0 18px; font-size: 26px; }
  .field { margin-bottom: 6px; }
  .seg { display: inline-flex; background: var(--well); border-radius: var(--r-pill); padding: 3px; gap: 2px; }
  .seg-btn { border: 0; background: transparent; color: var(--muted); font-weight: 600; font-size: 13px; padding: 8px 16px; border-radius: var(--r-pill); cursor: pointer;
    transition: color var(--dur) var(--ease), background-color var(--dur) var(--ease); }
  .seg-btn:hover { color: var(--text); }
  .seg-btn.on { color: var(--text); background: var(--surface); box-shadow: var(--shadow-card); }
  .small { margin: 8px 0 0; }
  .toggle-row { margin: 10px 0; }
  .sub { margin: 18px 0 4px; font-size: 13px; color: var(--muted); }
</style>
