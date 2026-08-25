<script>
  import { poker } from "$lib/poker/client.svelte.js";
  import { tick } from "svelte";
  import { fly, fade } from "svelte/transition";
  import { flip } from "svelte/animate";
  import { d, DUR } from "$lib/motion.js";

  let { data } = $props();
  let text = $state("");
  let scroller = $state(null);

  // Connect the socket and, when a conversation is open, seed its history into the
  // store + mark it read. Rendering then comes from poker.dms (live-updating).
  $effect(() => {
    poker.connect();
    const a = data.active;
    if (a) {
      poker.seedDm(a.id, a.messages);
      poker.openDm(a.id);
    }
    return () => poker.closeDm();
  });

  const messages = $derived(data.active ? (poker.dms[data.active.id] || []) : []);

  // Auto-scroll to the newest message.
  $effect(() => {
    void messages.length;
    if (scroller) tick().then(() => { scroller.scrollTop = scroller.scrollHeight; });
  });

  function send(e) {
    e.preventDefault();
    if (!data.active) return;
    poker.sendDM(data.active.id, text);
    text = "";
  }
  function fmt(ts) { return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); }
  function unread(id) { return poker.dmUnread[id] || data.conversations.find((c) => c.id === id)?.unread || 0; }
</script>

<svelte:head><title>Messages</title></svelte:head>

<div class="dm-layout">
  <aside class="convo-list card">
    <div class="card-head"><h3>Messages</h3></div>
    {#if data.conversations.length === 0}
      <p class="muted">Add friends to start messaging.</p>
    {:else}
      <ul class="convos">
        {#each data.conversations as c (c.id)}
          <li in:fly={{ x: d(-8), duration: d(DUR.base) }} out:fade={{ duration: d(DUR.fast) }} animate:flip={{ duration: d(DUR.base) }}>
            <a class="convo" class:active={data.active?.id === c.id} href={`/messages?to=${c.id}`}>
              <span class="dot" class:on={c.online}></span>
              <span class="cname">{c.name}</span>
              {#if unread(c.id) > 0}<span class="badge">{unread(c.id)}</span>{/if}
            </a>
          </li>
        {/each}
      </ul>
    {/if}
  </aside>

  <section class="thread card">
    {#if !data.active}
      <p class="muted empty">Pick a friend to start chatting.</p>
    {:else}
      <div class="card-head">
        <h3><span class="dot" class:on={data.active.online}></span> {data.active.name}</h3>
      </div>
      <div class="messages" bind:this={scroller}>
        {#each messages as m (m.id)}
          <div class="msg" class:mine={m.mine} in:fade={{ duration: d(DUR.fast) }}>
            <span class="bubble">{m.text}</span>
            <span class="ts muted">{fmt(m.ts)}</span>
          </div>
        {/each}
        {#if messages.length === 0}<p class="muted">No messages yet — say hi.</p>{/if}
      </div>
      <form class="composer" onsubmit={send}>
        <input bind:value={text} placeholder={`Message ${data.active.name}…`} maxlength="2000" autocomplete="off" />
        <button class="btn" type="submit" disabled={!text.trim()}>Send</button>
      </form>
    {/if}
  </section>
</div>

<style>
  .dm-layout { display: grid; grid-template-columns: 240px 1fr; gap: 16px; align-items: start; }
  .convos { list-style: none; margin: 0; padding: 0; }
  .convo {
    display: flex; align-items: center; gap: 8px; padding: 9px 10px; border-radius: var(--r-btn); color: inherit; text-decoration: none;
    transition: background-color var(--dur) var(--ease), color var(--dur) var(--ease);
  }
  .convo:hover { background: var(--surface-2); }
  .convo.active { background: var(--accent-soft); color: var(--accent-ink); }
  .cname { font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { background: var(--danger); color: var(--on-accent); border-radius: var(--r-pill); font-size: 11px; font-weight: 700; padding: 1px 7px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: var(--faint); flex: none; transition: background-color var(--dur) var(--ease), box-shadow var(--dur) var(--ease); }
  .dot.on { background: var(--ok); box-shadow: 0 0 0 3px var(--ok-bg); }
  .thread { display: flex; flex-direction: column; min-height: 420px; }
  .empty { margin: auto; }
  .messages { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 8px 2px; max-height: 60vh; }
  .msg { display: flex; align-items: flex-end; gap: 6px; max-width: 78%; }
  .msg.mine { align-self: flex-end; flex-direction: row-reverse; }
  .bubble { padding: 7px 11px; border-radius: 12px; background: var(--well); line-height: 1.35; word-break: break-word; }
  .msg.mine .bubble { background: var(--accent); color: var(--on-accent); }
  .ts { font-size: 10.5px; }
  .composer { display: flex; gap: 8px; padding-top: 10px; }
  .composer input { flex: 1; }
  @media (max-width: 640px) { .dm-layout { grid-template-columns: 1fr; } }
</style>
