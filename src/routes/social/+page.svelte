<script>
  // The unified Social section (S0): Chats (DM + group conversations, live over
  // the WS), Friends, Requests, and name Search — merging the old /friends and
  // /messages pages. Chats stream via the `poker` client's conversation state;
  // friend management uses the SSR form actions.
  import { poker } from "$lib/poker/client.svelte.js";
  import { page } from "$app/stores";
  import { enhance } from "$app/forms";
  import { onMount, tick } from "svelte";
  import { fly, fade, slide } from "svelte/transition";
  import { flip } from "svelte/animate";
  import { d, DUR } from "$lib/motion.js";
  import { slidingIndicator } from "$lib/actions/slider.js";
  import VoiceBar from "$lib/poker/components/VoiceBar.svelte";
  import { voice } from "$lib/poker/voice.svelte.js";
  import { calls } from "$lib/poker/call.svelte.js";
  import { uploadMedia } from "$lib/media.js";
  import Avatar from "$lib/poker/components/Avatar.svelte";

  let { data, form } = $props();

  let tab = $state("chats");                 // chats | friends | requests | search
  let mobileThread = $state(false);          // narrow screens: show the thread pane
  let draft = $state("");
  let threadEl = $state(null);

  const convs = $derived(poker.conversations);
  const openId = $derived(poker.openConvId);
  const header = $derived(openId ? poker.convHeaders[openId] : null);
  const messages = $derived(openId ? (poker.convMessages[openId] || []) : []);
  const me = $derived(poker.me);
  const typer = $derived(openId && poker.typing[openId] ? poker.typing[openId].name : null);
  const lastOwnSeq = $derived(messages.filter((m) => m.mine).reduce((mx, m) => Math.max(mx, m.seq || 0), 0));
  const seen = $derived.by(() => {
    if (!header || header.kind !== "dm" || !header.other || lastOwnSeq <= 0) return false;
    const rs = poker.readSeq[openId];
    return rs && rs[header.other.id] != null && rs[header.other.id] >= lastOwnSeq;
  });

  onMount(() => {
    poker.loadConvs();
    const to = $page.url.searchParams.get("to");
    if (to) { poker.openDmWith(to); mobileThread = true; }
    return () => poker.closeConv();
  });

  // Autoscroll the thread to the newest message.
  $effect(() => {
    messages.length;
    if (threadEl) tick().then(() => { threadEl.scrollTop = threadEl.scrollHeight; });
  });

  function openConv(c) { poker.openConv(c.id); mobileThread = true; }
  function openFriendDm(f) { poker.openDmWith(f.id); mobileThread = true; }
  function send() {
    if (!openId) return;
    const t = draft.trim();
    if (!t) return;
    poker.sendMsg(openId, t);
    draft = "";
  }
  function onKey(e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }
  let sendingImg = $state(false);
  async function onImageFile(e) {
    const file = e.target.files?.[0];
    if (!file || !openId) return;
    sendingImg = true;
    try { const id = await uploadMedia(file, "attachment"); poker.sendMsg(openId, "", { mediaId: id }); }
    catch (err) { poker.toast = { level: "error", text: err?.message || "Upload failed" }; }
    sendingImg = false; e.target.value = "";
  }

  // --- group creation ---
  let groupOpen = $state(false);
  let groupTitle = $state("");
  let groupPick = $state(new Set());
  let groupPanel = $state(false);
  let renameVal = $state("");
  $effect(() => { openId; groupPanel = false; }); // close the panel when switching chats
  // Leave any active call when switching conversations or leaving the page.
  $effect(() => { openId; return () => { if (voice.active) voice.leave(); }; });
  function togglePick(id) { const s = new Set(groupPick); s.has(id) ? s.delete(id) : s.add(id); groupPick = s; }
  function makeGroup() {
    if (!groupTitle.trim() || groupPick.size === 0) return;
    poker.createGroup(groupTitle.trim(), [...groupPick]);
    groupOpen = false; groupTitle = ""; groupPick = new Set(); tab = "chats";
  }

  // --- helpers ---
  import { initials as initial, avColor as color } from "$lib/initials.js";
  function fmtTime(ts) {
    if (!ts) return "";
    const d0 = new Date(ts), now = new Date();
    const sameDay = d0.toDateString() === now.toDateString();
    return sameDay ? d0.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
                   : d0.toLocaleDateString([], { month: "short", day: "numeric" });
  }
  function preview(c) {
    if (!c.last) return "No messages yet";
    if (c.last.kind === "image") return "📷 Photo";
    if (c.last.kind === "file") return "📎 File";
    const who = c.kind === "group" && c.last.senderName ? c.last.senderName + ": " : "";
    return who + (c.last.body || "");
  }
  // --- live friend-finding (trigram search + recommendations) ---
  let findQ = $state("");
  let findResults = $state([]);
  let findMode = $state("recommend");
  let findLoading = $state(false);
  let _findTimer = null;
  async function runFind(q) {
    findLoading = true;
    try {
      const res = await fetch(`/api/friends/find?q=${encodeURIComponent(q)}`);
      const j = await res.json();
      findResults = j.results || [];
      findMode = j.mode;
    } catch { /* keep prior */ } finally { findLoading = false; }
  }
  function onFindInput(e) {
    findQ = e.target.value;
    clearTimeout(_findTimer);
    _findTimer = setTimeout(() => runFind(findQ.trim()), 220);
  }
  function openFind() { tab = "search"; if (!findResults.length) runFind(""); }
  async function addFriend(r) {
    const res = await fetch("/api/friends", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ userId: r.id, action: "request" }) });
    const j = await res.json().catch(() => ({}));
    const s = j.status;
    findResults = findResults.map((x) => x.id !== r.id ? x : {
      ...x,
      relationship: s === "pending" ? "outgoing" : (s === "accepted" || s === "friends") ? "friends" : x.relationship,
      reqError: s === "blocked" ? "Doesn't accept requests" : s === "blocked_fof" ? "Friends-of-friends only" : null,
    });
  }

  const incoming = $derived(data.incoming || []);
  const outgoing = $derived(data.outgoing || []);
  const friends = $derived(data.friends || []);
  const reqCount = $derived(incoming.length);
</script>

<svelte:head><title>Social — Bluffing Valley</title></svelte:head>

<div class="social" class:show-thread={mobileThread}>
  <!-- LEFT: list pane -->
  <aside class="pane list-pane">
    <div class="tabs-row slider" use:slidingIndicator>
      <button class="stab" class:on={tab === "chats"} onclick={() => (tab = "chats")}>Chats</button>
      <button class="stab" class:on={tab === "friends"} onclick={() => (tab = "friends")}>Friends</button>
      <button class="stab" class:on={tab === "requests"} onclick={() => (tab = "requests")}>
        Requests{#if reqCount > 0}<span class="dot-badge">{reqCount}</span>{/if}
      </button>
      <button class="stab" class:on={tab === "search"} onclick={openFind}>Find</button>
    </div>

    <div class="pane-body">
      {#if tab === "chats"}
        <div class="list-head">
          <span class="muted small">Conversations</span>
          <button class="btn btn-xs btn-gold" onclick={() => (groupOpen = true)}>＋ Group</button>
        </div>
        {#if convs.length === 0}
          <div class="empty small">No chats yet — open one from Friends, or start a group.</div>
        {:else}
          {#each convs as c (c.id)}
            <button class="conv" class:active={c.id === openId} onclick={() => openConv(c)}
              in:fly={{ y: d(6), duration: d(DUR.base) }} animate:flip={{ duration: d(DUR.base) }}>
              {#if c.kind === "group"}
                <span class="avatar conv-av" style="background:var(--accent)">#</span>
              {:else}
                <Avatar id={c.other?.id} name={c.title} mediaId={c.other?.avatarMediaId} size={40} />
              {/if}
              <span class="conv-main">
                <span class="conv-top"><span class="conv-title">{c.title}</span><span class="conv-time">{fmtTime(c.lastMsgAt)}</span></span>
                <span class="conv-sub"><span class="conv-prev">{preview(c)}</span>{#if c.unread > 0}<span class="unread">{c.unread}</span>{/if}</span>
              </span>
            </button>
          {/each}
        {/if}

      {:else if tab === "friends"}
        {#if friends.length === 0}
          <div class="empty small">No friends yet — use Find to add someone.</div>
        {:else}
          {#each friends as f (f.id)}
            <div class="frow" in:fly={{ y: d(6), duration: d(DUR.base) }} animate:flip={{ duration: d(DUR.base) }}>
              <Avatar id={f.id} name={f.name} mediaId={f.avatarMediaId} size={40} userId={f.id} />
              <a class="frow-main frow-link" href="/u/{f.id}">
                <span class="frow-name">{f.name}</span>
                <span class="frow-status {f.online ? 'on' : ''}">{f.online ? (f.tableName ? "at " + f.tableName : "online") : "offline"}</span>
              </a>
              <button class="btn btn-xs" onclick={() => openFriendDm(f)}>Message</button>
              {#if f.online}<button class="btn btn-xs btn-secondary" title="Voice call" aria-label="Voice call {f.name}" onclick={() => calls.start(f.id, f.name)}>📞</button>{/if}
              <form method="POST" action="?/remove" use:enhance>
                <input type="hidden" name="userId" value={f.id} />
                <button class="btn btn-xs btn-secondary" type="submit" title="Remove friend">✕</button>
              </form>
            </div>
          {/each}
        {/if}

      {:else if tab === "requests"}
        <div class="list-head"><span class="muted small">Incoming</span></div>
        {#if incoming.length === 0}<div class="empty small">No pending requests.</div>{/if}
        {#each incoming as p (p.id)}
          <div class="frow" in:fly={{ y: d(6), duration: d(DUR.base) }} animate:flip={{ duration: d(DUR.base) }}>
            <span class="avatar frow-av" style="background:{color(p.id)}">{initial(p.name)}</span>
            <span class="frow-main"><span class="frow-name">{p.name}</span><span class="frow-status">wants to connect</span></span>
            <form method="POST" action="?/respond" use:enhance>
              <input type="hidden" name="userId" value={p.id} /><input type="hidden" name="accept" value="true" />
              <button class="btn btn-xs" type="submit">Accept</button>
            </form>
            <form method="POST" action="?/respond" use:enhance>
              <input type="hidden" name="userId" value={p.id} /><input type="hidden" name="accept" value="false" />
              <button class="btn btn-xs btn-secondary" type="submit">Decline</button>
            </form>
          </div>
        {/each}
        {#if outgoing.length > 0}
          <div class="list-head" style="margin-top:14px"><span class="muted small">Sent</span></div>
          {#each outgoing as p (p.id)}
            <div class="frow">
              <span class="avatar frow-av" style="background:{color(p.id)}">{initial(p.name)}</span>
              <span class="frow-main"><span class="frow-name">{p.name}</span><span class="frow-status">pending…</span></span>
              <form method="POST" action="?/remove" use:enhance>
                <input type="hidden" name="userId" value={p.id} />
                <button class="btn btn-xs btn-secondary" type="submit">Cancel</button>
              </form>
            </div>
          {/each}
        {/if}

      {:else if tab === "search"}
        <div class="search-form">
          <input class="search-input" placeholder="Search players by name…" autocomplete="off" bind:value={findQ} oninput={onFindInput} />
        </div>
        <div class="find-head"><span class="muted small">{findMode === "search" ? "Results" : "Suggested for you"}</span>{#if findLoading}<span class="muted small">searching…</span>{/if}</div>
        {#if findResults.length === 0 && !findLoading}
          <div class="empty small">{findMode === "search" ? "No players found." : "No suggestions yet — play some hands or add a friend."}</div>
        {/if}
        {#each findResults as r (r.id)}
          <div class="frow" in:fly={{ y: d(6), duration: d(DUR.base) }} animate:flip={{ duration: d(DUR.base) }}>
            <Avatar id={r.id} name={r.name} mediaId={r.avatarMediaId} size={38} userId={r.id} />
            <div class="frow-main">
              <span class="frow-name">{r.name}</span>
              {#if r.reason}<span class="frow-status">{r.reason}</span>{:else if r.reqError}<span class="frow-status" style="color:var(--danger)">{r.reqError}</span>{/if}
            </div>
            {#if r.relationship === "friends"}
              <a class="btn btn-xs btn-secondary" href="/social?to={r.id}">Message</a>
            {:else if r.relationship === "outgoing"}
              <button class="btn btn-xs btn-secondary" disabled>Requested</button>
            {:else if r.relationship === "incoming"}
              <a class="btn btn-xs" href="/u/{r.id}">Respond</a>
            {:else}
              <button class="btn btn-xs" onclick={() => addFriend(r)}>＋ Add</button>
            {/if}
          </div>
        {/each}
      {/if}
    </div>
  </aside>

  <!-- RIGHT: thread pane -->
  <section class="pane thread-pane">
    {#if openId && header}
      <div class="thread-head">
        <button class="back-btn" onclick={() => (mobileThread = false)} aria-label="Back">‹</button>
        {#if header.kind === "dm" && header.other}
          <Avatar id={header.other.id} name={header.title} mediaId={header.other.avatarMediaId} size={40} userId={header.other.id} />
        {:else}
          <span class="avatar th-av" style="background:var(--accent)">#</span>
        {/if}
        <span class="th-title">
          {#if header.kind === "dm" && header.other}<a class="th-name-link" href="/u/{header.other.id}">{header.title}</a>{:else}{header.title}{/if}
          <span class="th-sub">{header.kind === "group" ? header.members.length + " members" : (friends.find((f) => f.id === header.other?.id)?.online ? "online" : "")}</span>
        </span>
        {#if header.kind === "group"}<button class="gear" onclick={() => (groupPanel = !groupPanel)} aria-label="Group settings">⚙</button>{/if}
      </div>
      {#if me}
        {#key openId}
          <div class="voice-strip"><VoiceBar tableId={openId} /></div>
        {/key}
      {/if}
      {#if groupPanel && header.kind === "group"}
        <div class="group-panel" transition:slide={{ duration: d(DUR.base) }}>
          <div class="gp-rename">
            <input class="search-input" bind:value={renameVal} placeholder={header.title} maxlength="128" />
            <button class="btn btn-sm" onclick={() => { if (renameVal.trim()) { poker.renameGroup(openId, renameVal.trim()); renameVal = ''; } }}>Rename</button>
          </div>
          <div class="gp-members">
            {#each header.members as mem (mem.id)}
              <div class="gp-mem">
                <a class="avatar frow-av" href="/u/{mem.id}" style="background:{color(mem.id)}">{initial(mem.name)}</a>
                <span class="frow-name">{mem.name}{#if mem.id === me?.id} (you){/if}</span>
                {#if mem.id !== me?.id}<button class="btn btn-xs btn-secondary" onclick={() => poker.removeFromGroup(openId, mem.id)}>Remove</button>{/if}
              </div>
            {/each}
          </div>
          {#if friends.filter((f) => !header.members.some((m) => m.id === f.id)).length > 0}
            <p class="muted small" style="margin:8px 0 4px">Add friends</p>
            {#each friends.filter((f) => !header.members.some((m) => m.id === f.id)) as f (f.id)}
              <div class="gp-mem">
                <span class="avatar frow-av" style="background:{color(f.id)}">{initial(f.name)}</span>
                <span class="frow-name">{f.name}</span>
                <button class="btn btn-xs" onclick={() => poker.addToGroup(openId, [f.id])}>Add</button>
              </div>
            {/each}
          {/if}
          <button class="btn btn-sm btn-secondary gp-leave" onclick={() => { poker.leaveGroup(openId); groupPanel = false; mobileThread = false; }}>Leave group</button>
        </div>
      {/if}
      <div class="thread" bind:this={threadEl}>
        {#each messages as m (m.id)}
          {#if m.kind === "system"}
            <div class="sys-msg" in:fade={{ duration: d(DUR.base) }}>{m.body}</div>
          {:else}
            <div class="msg" class:mine={m.mine} in:fly={{ y: d(6), duration: d(DUR.base) }}>
              {#if header.kind === "group" && !m.mine}<a class="msg-who" href="/u/{m.senderId}" style="color:{color(m.senderId)}">{m.senderName}</a>{/if}
              <span class="bubble-row">
                {#if m.deletedAt}
                  <span class="bubble deleted">message deleted</span>
                {:else if m.mediaId}
                  <a class="img-msg" href="/media/{m.mediaId}" target="_blank" rel="noopener"><img src="/media/{m.mediaId}" alt="photo" loading="lazy" /></a>
                  {#if m.mine}<button class="del-btn" onclick={() => poker.deleteMsg(openId, m.id)} aria-label="Delete message">✕</button>{/if}
                {:else}
                  <span class="bubble">{m.body}</span>
                  {#if m.mine}<button class="del-btn" onclick={() => poker.deleteMsg(openId, m.id)} aria-label="Delete message">✕</button>{/if}
                {/if}
              </span>
              <span class="msg-time">{fmtTime(m.createdAt)}</span>
            </div>
          {/if}
        {/each}
        {#if seen}<div class="seen-ind">Seen</div>{/if}
        {#if typer}<div class="typing-ind">{typer} is typing…</div>{/if}
      </div>
      <div class="composer">
        <label class="img-btn" title="Send a photo">
          {sendingImg ? "…" : "🖼"}
          <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onchange={onImageFile} disabled={sendingImg} />
        </label>
        <textarea class="composer-input" bind:value={draft} onkeydown={onKey} oninput={() => openId && poker.sendTyping(openId)} rows="1" placeholder="Message…"></textarea>
        <button class="btn send-btn" onclick={send} disabled={!draft.trim()}>Send</button>
      </div>
    {:else}
      <div class="thread-empty">
        <p class="muted">Select a chat, or open one from Friends.</p>
      </div>
    {/if}
  </section>
</div>

{#if groupOpen}
  <div class="modal-backdrop" role="presentation" onclick={() => (groupOpen = false)} transition:fade={{ duration: d(DUR.fast) }}>
    <div class="modal card" role="dialog" aria-modal="true" onclick={(e) => e.stopPropagation()} transition:fly={{ y: d(12), duration: d(DUR.base) }}>
      <h3>New group</h3>
      <input class="search-input" bind:value={groupTitle} placeholder="Group name" maxlength="128" />
      <p class="muted small" style="margin:10px 0 6px">Add friends</p>
      <div class="pick-list">
        {#each friends as f (f.id)}
          <button class="pick" class:on={groupPick.has(f.id)} onclick={() => togglePick(f.id)}>
            <span class="avatar frow-av" style="background:{color(f.id)}">{initial(f.name)}</span>
            <span class="frow-name">{f.name}</span>
            {#if groupPick.has(f.id)}<span class="pick-check">✓</span>{/if}
          </button>
        {/each}
        {#if friends.length === 0}<div class="empty small">Add friends first.</div>{/if}
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" onclick={() => (groupOpen = false)}>Cancel</button>
        <button class="btn" onclick={makeGroup} disabled={!groupTitle.trim() || groupPick.size === 0}>Create</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .social { display: grid; grid-template-columns: 340px minmax(0, 1fr); gap: 16px; height: calc(100vh - 58px - 32px); }
  .pane { background: var(--surface); border-radius: var(--r-panel); box-shadow: var(--shadow-card); overflow: hidden; display: flex; flex-direction: column; min-height: 0; }

  .tabs-row { display: flex; gap: 2px; padding: 10px 10px 8px; position: relative; }
  .tabs-row .sel-ind { background: var(--accent-soft); }
  .stab { flex: 1; border: 0; background: transparent; color: var(--muted); font-weight: 600; font-size: 12.5px; padding: 7px 8px; border-radius: var(--r-pill); cursor: pointer; position: relative;
    transition: color var(--dur) var(--ease); display: inline-flex; align-items: center; justify-content: center; gap: 5px; }
  .stab:hover { color: var(--text); }
  .stab.on { color: var(--accent-ink); }
  .dot-badge { min-width: 15px; height: 15px; padding: 0 4px; border-radius: 999px; background: var(--danger); color: #fff; font-size: 10px; font-weight: 800; display: grid; place-items: center; }

  .pane-body { flex: 1; overflow-y: auto; padding: 6px 10px 12px; min-height: 0; }
  .list-head { display: flex; align-items: center; justify-content: space-between; padding: 6px 4px 8px; }
  .empty { text-align: center; color: var(--muted); padding: 24px 12px; }
  .small { font-size: 12.5px; }

  .conv { width: 100%; display: flex; align-items: center; gap: 11px; padding: 9px 10px; border: 0; background: transparent; border-radius: var(--r-card); cursor: pointer; text-align: left;
    transition: background-color var(--dur) var(--ease); }
  .conv:hover { background: var(--well); }
  .conv.active { background: var(--accent-soft); }
  .conv-av, .frow-av, .th-av { width: 40px; height: 40px; font-size: 15px; flex: 0 0 auto; }
  .conv-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .conv-top { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
  .conv-title { font-weight: 700; font-size: 14px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .conv-time { color: var(--faint); font-size: 11px; flex: 0 0 auto; }
  .conv-sub { display: flex; justify-content: space-between; gap: 8px; align-items: center; }
  .conv-prev { color: var(--muted); font-size: 12.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .unread { min-width: 18px; height: 18px; padding: 0 5px; border-radius: 999px; background: var(--accent); color: var(--on-accent); font-size: 11px; font-weight: 800; display: grid; place-items: center; flex: 0 0 auto; }

  .frow { display: flex; align-items: center; gap: 10px; padding: 8px 6px; border-radius: var(--r-card); transition: background-color var(--dur) var(--ease); }
  .frow:hover { background: var(--well); }
  .frow-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
  .frow-name { font-weight: 700; font-size: 13.5px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .frow-status { font-size: 11.5px; color: var(--muted); }
  .frow-status.on { color: var(--ok); }
  a.frow-av, a.th-av { text-decoration: none; transition: filter var(--dur) var(--ease); }
  a.frow-av:hover, a.th-av:hover { filter: brightness(1.1); }
  .frow-link { text-decoration: none; color: inherit; }
  .frow-link:hover .frow-name { color: var(--accent-ink); }
  .th-name-link { color: inherit; text-decoration: none; }
  .th-name-link:hover { color: var(--accent-ink); }
  .frow form { display: inline-flex; }

  .search-form { display: flex; gap: 8px; padding: 4px 2px 10px; }
  .search-input { flex: 1; }
  .find-head { display: flex; justify-content: space-between; align-items: center; padding: 2px 4px 8px; }

  /* thread pane */
  .thread-pane { min-width: 0; }
  .thread-head { display: flex; align-items: center; gap: 11px; padding: 12px 16px; box-shadow: 0 1px 0 var(--well); }
  .back-btn { display: none; border: 0; background: var(--well); color: var(--text); width: 30px; height: 30px; border-radius: 999px; font-size: 18px; cursor: pointer; }
  .th-title { font-weight: 700; font-size: 15px; display: flex; flex-direction: column; }
  .th-sub { font-weight: 500; font-size: 11.5px; color: var(--muted); }
  .gear { margin-left: auto; border: 0; background: var(--well); color: var(--muted); width: 32px; height: 32px; border-radius: 999px; cursor: pointer; font-size: 15px;
    transition: color var(--dur) var(--ease), background-color var(--dur) var(--ease); }
  .gear:hover { color: var(--text); background: var(--surface-2); }
  .voice-strip { padding: 6px 16px 0; }
  .group-panel { padding: 12px 16px; background: var(--surface-2); display: flex; flex-direction: column; gap: 8px; }
  .gp-rename { display: flex; gap: 8px; }
  .gp-members { display: flex; flex-direction: column; gap: 4px; }
  .gp-mem { display: flex; align-items: center; gap: 9px; padding: 3px 0; }
  .gp-mem .frow-name { flex: 1; }
  .gp-leave { align-self: flex-start; margin-top: 6px; color: var(--danger); }
  .sys-msg { align-self: center; font-size: 11.5px; color: var(--muted); background: var(--well); padding: 4px 12px; border-radius: 999px; margin: 4px 0; max-width: 80%; text-align: center; }
  .thread { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 8px; min-height: 0; }
  .msg { max-width: 72%; align-self: flex-start; display: flex; flex-direction: column; gap: 2px; }
  .msg.mine { align-self: flex-end; align-items: flex-end; }
  .msg-who { font-size: 11px; font-weight: 700; padding-left: 4px; text-decoration: none; }
  .msg-who:hover { text-decoration: underline; }
  .bubble { background: var(--well); padding: 9px 13px; border-radius: 15px; border-bottom-left-radius: 5px; font-size: 14px; line-height: 1.35; white-space: pre-wrap; word-break: break-word; }
  .msg.mine .bubble { background: var(--accent); color: var(--on-accent); border-radius: 15px; border-bottom-right-radius: 5px; }
  .msg-time { font-size: 10.5px; color: var(--faint); padding: 0 4px; }
  .bubble-row { display: inline-flex; align-items: center; gap: 6px; }
  .msg.mine .bubble-row { flex-direction: row-reverse; }
  .del-btn { opacity: 0; border: 0; background: transparent; color: var(--muted); cursor: pointer; font-size: 11px;
    transition: opacity var(--dur) var(--ease), color var(--dur) var(--ease); }
  .msg:hover .del-btn { opacity: 1; }
  .del-btn:hover { color: var(--danger); }
  .bubble.deleted { font-style: italic; color: var(--muted); background: transparent; box-shadow: inset 0 0 0 1px var(--well); }
  .seen-ind { align-self: flex-end; font-size: 10.5px; color: var(--faint); padding-right: 4px; }
  .typing-ind { align-self: flex-start; font-size: 12px; color: var(--muted); font-style: italic; padding-left: 4px; }
  .composer { display: flex; gap: 10px; padding: 12px 16px; box-shadow: 0 -1px 0 var(--well); align-items: flex-end; }
  .composer-input { flex: 1; resize: none; max-height: 120px; font: inherit; }
  .img-btn { flex: 0 0 auto; width: 38px; height: 38px; display: grid; place-items: center; border-radius: var(--r-btn); background: var(--well); cursor: pointer; font-size: 17px;
    transition: background-color var(--dur) var(--ease); }
  .img-btn:hover { background: var(--surface-2); }
  .img-msg { display: block; line-height: 0; }
  .img-msg img { max-width: 240px; max-height: 280px; border-radius: 13px; object-fit: cover; box-shadow: var(--shadow-card); }
  .send-btn { flex: 0 0 auto; }
  .thread-empty { flex: 1; display: grid; place-items: center; }

  /* group modal */
  .modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: grid; place-items: center; z-index: 60; padding: 20px; }
  .modal { width: min(440px, 94vw); }
  .modal h3 { margin: 0 0 12px; }
  .pick-list { max-height: 260px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
  .pick { display: flex; align-items: center; gap: 10px; padding: 7px 9px; border: 0; background: var(--well); border-radius: var(--r-card); cursor: pointer; text-align: left; transition: background-color var(--dur) var(--ease); }
  .pick.on { background: var(--accent-soft); }
  .pick-check { margin-left: auto; color: var(--accent-ink); font-weight: 800; }
  .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 14px; }

  @media (max-width: 760px) {
    .social { grid-template-columns: 1fr; height: calc(100vh - 58px - 24px); }
    .thread-pane { display: none; }
    .social.show-thread .list-pane { display: none; }
    .social.show-thread .thread-pane { display: flex; }
    .back-btn { display: grid; place-items: center; }
  }
</style>
