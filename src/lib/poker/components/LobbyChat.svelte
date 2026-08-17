<script>
  // Compact lobby chat: a scrollable list of {from, text, ts} messages plus
  // an input. Enter or the Send button calls onSend(text) and clears the
  // field. The list is height-capped and auto-scrolls to the newest message
  // when new ones arrive (unless the user has scrolled up to read history).
  // Mirrors TableChat.svelte so lobby + table chat feel consistent.

  let { messages = [], onSend = () => {} } = $props();

  let draft = $state("");
  let listEl;
  let pinned = true; // stay stuck to the bottom while at the bottom

  function fmtTime(ts) {
    if (!ts) return "";
    try {
      return new Date(ts).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
    } catch {
      return "";
    }
  }

  function onScroll() {
    if (!listEl) return;
    const gap = listEl.scrollHeight - listEl.scrollTop - listEl.clientHeight;
    pinned = gap < 24;
  }

  // Autoscroll to newest whenever the message count changes and we're
  // pinned to the bottom.
  $effect(() => {
    // Track length so the effect re-runs on new messages.
    void messages.length;
    if (listEl && pinned) {
      listEl.scrollTop = listEl.scrollHeight;
    }
  });

  function send() {
    const text = draft.trim();
    if (!text) return;
    onSend?.(text);
    draft = "";
    pinned = true;
  }

  function onKey(ev) {
    if (ev.key === "Enter" && !ev.shiftKey) {
      ev.preventDefault();
      send();
    }
  }
</script>

<div class="chat card">
  <div class="card-head">
    <h3>Lobby chat</h3>
  </div>

  <div class="messages" bind:this={listEl} onscroll={onScroll}>
    {#if messages.length === 0}
      <div class="empty muted">No messages yet — say hello.</div>
    {:else}
      {#each messages as m, i (i)}
        <div class="msg">
          <span class="from">{m.from}</span>
          <span class="text">{m.text}</span>
          <span class="ts muted">{fmtTime(m.ts)}</span>
        </div>
      {/each}
    {/if}
  </div>

  <div class="compose">
    <input
      type="text"
      placeholder="Message…"
      maxlength="240"
      bind:value={draft}
      onkeydown={onKey}
    />
    <button class="btn" onclick={send} disabled={!draft.trim()}>Send</button>
  </div>
</div>

<style>
  .chat { margin-bottom: 0; }
  .messages {
    max-height: 220px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding-right: 4px;
  }
  .empty {
    text-align: center;
    font-size: 12.5px;
    padding: 24px 0;
  }
  .msg {
    display: flex;
    align-items: baseline;
    gap: 6px;
    font-size: 12.5px;
    line-height: 1.4;
  }
  .from {
    font-weight: 700;
    color: var(--accent);
    flex: 0 0 auto;
    max-width: 40%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .text {
    flex: 1 1 auto;
    color: var(--text);
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  .ts {
    flex: 0 0 auto;
    font-size: 10.5px;
  }
  .compose {
    display: flex;
    gap: 6px;
    margin-top: 10px;
  }
  .compose input {
    flex: 1 1 auto;
    min-width: 0;
  }
  .compose .btn { flex: 0 0 auto; }
</style>
