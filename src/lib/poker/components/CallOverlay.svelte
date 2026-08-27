<script>
  // App-wide voice-call UI (Phase E): an incoming-call modal when a friend rings,
  // and a docked in-call bar (mute / hang up + a running duration) once connected.
  // All state lives on the poker store; the `calls` controller drives transitions.
  import { fly, scale } from "svelte/transition";
  import { poker } from "$lib/poker/client.svelte.js";
  import { calls } from "$lib/poker/call.svelte.js";
  import { d, DUR } from "$lib/motion.js";

  const incoming = $derived(poker.incomingCall);
  const call = $derived(poker.call);
  const muted = $derived(calls.muted);

  // Running call duration (starts when the call goes active).
  let elapsed = $state(0);
  $effect(() => {
    if (call?.state === "active") {
      const start = Date.now();
      elapsed = 0;
      const t = setInterval(() => { elapsed = Math.floor((Date.now() - start) / 1000); }, 1000);
      return () => clearInterval(t);
    }
    elapsed = 0;
  });
  const clock = $derived(`${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, "0")}`);

  const statusText = $derived(
    call?.state === "active" ? clock
    : call?.state === "connecting" ? "Connecting…"
    : "Calling…"
  );
</script>

{#if incoming}
  <div class="scrim" transition:fly={{ duration: d(DUR.fast) }}>
    <div class="ring-card" transition:scale={{ duration: d(DUR.base), start: 0.9 }}>
      <div class="pulse"><span class="ph">📞</span></div>
      <div class="who">{incoming.fromName}</div>
      <div class="sub">Incoming voice call…</div>
      <div class="btns">
        <button class="rbtn decline" onclick={() => calls.decline()} aria-label="Decline">Decline</button>
        <button class="rbtn accept" onclick={() => calls.accept()} aria-label="Accept">Accept</button>
      </div>
    </div>
  </div>
{/if}

{#if call}
  <div class="callbar" transition:fly={{ y: d(20), duration: d(DUR.base) }}>
    <span class="live" class:on={call.state === "active"}></span>
    <span class="cname">{call.peer?.name || "Friend"}</span>
    <span class="cstatus">{statusText}</span>
    {#if call.state === "active"}
      <button class="cbtn" class:muted onclick={() => calls.toggleMute()} aria-label={muted ? "Unmute" : "Mute"}>
        {muted ? "🔇" : "🎙"}
      </button>
    {/if}
    <button class="cbtn hang" onclick={() => calls.hangup()} aria-label="Hang up">📵</button>
  </div>
{/if}

<style>
  .scrim {
    position: fixed; inset: 0; z-index: 80; display: grid; place-items: center;
    background: color-mix(in srgb, var(--bg) 72%, transparent); backdrop-filter: blur(3px);
  }
  .ring-card {
    background: var(--surface); border-radius: var(--r-card); box-shadow: var(--shadow-panel);
    padding: 28px 30px; text-align: center; width: min(320px, 88vw);
  }
  .pulse { width: 76px; height: 76px; margin: 0 auto 14px; border-radius: 50%;
    display: grid; place-items: center; background: var(--accent-soft); animation: ring 1.3s infinite; }
  .ph { font-size: 32px; }
  @keyframes ring { 0%,100% { box-shadow: 0 0 0 0 var(--accent-soft); } 50% { box-shadow: 0 0 0 12px transparent; } }
  .who { font-size: 20px; font-weight: 800; color: var(--text); }
  .sub { color: var(--muted); font-size: 13px; margin-top: 4px; }
  .btns { display: flex; gap: 12px; margin-top: 22px; }
  .rbtn { flex: 1; border: 0; border-radius: var(--r-pill); padding: 12px 0; font-weight: 700; font-size: 14px; cursor: pointer;
    transition: transform var(--dur) var(--ease), filter var(--dur) var(--ease); }
  .rbtn:hover { transform: translateY(-1px); filter: brightness(1.06); }
  .decline { background: var(--danger); color: #fff; }
  .accept { background: var(--ok); color: #06240f; }

  .callbar {
    position: fixed; left: 50%; transform: translateX(-50%); bottom: 18px; z-index: 70;
    display: flex; align-items: center; gap: 11px; padding: 9px 12px 9px 15px;
    background: var(--surface); border-radius: var(--r-pill); box-shadow: var(--shadow-panel);
  }
  .live { width: 9px; height: 9px; border-radius: 50%; background: var(--muted); flex: 0 0 auto; }
  .live.on { background: var(--ok); box-shadow: 0 0 7px var(--ok); animation: blink 1.4s infinite; }
  @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: .4; } }
  .cname { font-weight: 700; font-size: 14px; color: var(--text); }
  .cstatus { color: var(--muted); font-size: 12.5px; font-variant-numeric: tabular-nums; min-width: 42px; }
  .cbtn { width: 34px; height: 34px; border: 0; border-radius: 50%; cursor: pointer; font-size: 15px;
    background: var(--well); color: var(--text); display: grid; place-items: center;
    transition: background-color var(--dur) var(--ease), transform var(--dur) var(--ease); }
  .cbtn:hover { transform: translateY(-1px); background: var(--surface-2); }
  .cbtn.muted { background: var(--accent-soft); }
  .cbtn.hang { background: var(--danger); color: #fff; }
</style>
