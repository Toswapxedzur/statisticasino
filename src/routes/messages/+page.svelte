<script>
  import { poker } from "$lib/poker/client.svelte.js";
  import { tick } from "svelte";

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
          <li>
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
          <div class="msg" class:mine={m.mine}>
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
  .convo { display: flex; align-items: center; gap: 8px; padding: 9px 10px; border-radius: 8px; color: inherit; text-decoration: none; }
  .convo:hover { background: rgba(255,255,255,0.05); }
  .convo.active { background: rgba(255,255,255,0.09); }
  .cname { font-weight: 600; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .badge { background: #e0483a; color: #fff; border-radius: 999px; font-size: 11px; font-weight: 700; padding: 1px 7px; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #6b7280; flex: none; }
  .dot.on { background: #33d17a; box-shadow: 0 0 6px #33d17a; }
  .thread { display: flex; flex-direction: column; min-height: 420px; }
  .empty { margin: auto; }
  .messages { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 6px; padding: 8px 2px; max-height: 60vh; }
  .msg { display: flex; align-items: flex-end; gap: 6px; max-width: 78%; }
  .msg.mine { align-self: flex-end; flex-direction: row-reverse; }
  .bubble { padding: 7px 11px; border-radius: 12px; background: rgba(255,255,255,0.08); line-height: 1.35; word-break: break-word; }
  .msg.mine .bubble { background: var(--hero, #3a6df0); color: #fff; }
  .ts { font-size: 10.5px; }
  .composer { display: flex; gap: 8px; padding-top: 10px; }
  .composer input { flex: 1; padding: 9px 11px; border-radius: 8px;
    border: 1px solid var(--border, rgba(255,255,255,0.15)); background: rgba(255,255,255,0.04); color: inherit; }
  @media (max-width: 640px) { .dm-layout { grid-template-columns: 1fr; } }
</style>
