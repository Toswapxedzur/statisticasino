<script>
  import { voice } from "$lib/poker/voice.svelte.js";
  import { fly, fade, scale } from "svelte/transition";
  import { flip } from "svelte/animate";
  import { d, DUR } from "$lib/motion.js";
  let { tableId } = $props();
  function toggle() { if (voice.active) voice.leave(); else voice.join(tableId); }
  const label = (s) => (s === "connected" ? "" : s === "connecting" ? " · connecting…" : " · " + s);
</script>

<div class="voice-bar">
  <button class="btn btn-small" class:on={voice.active} onclick={toggle}>
    {voice.active ? "Leave voice" : "🎤 Join voice"}
  </button>
  {#if voice.active}
    <button class="btn btn-small btn-secondary" transition:fly={{ x: d(-8), duration: d(DUR.base) }} onclick={() => voice.toggleMute()}>
      {voice.muted ? "🔇 Unmute" : "🎙️ Mute"}
    </button>
    {#each Object.entries(voice.peers) as [id, p] (id)}
      <span class="peer" class:on={p.state === "connected"} title={p.state}
        in:scale={{ start: 0.8, duration: d(DUR.base) }} out:fade={{ duration: d(DUR.fast) }} animate:flip={{ duration: d(DUR.base) }}>
        <span class="pdot"></span>{p.name}<span class="muted small">{label(p.state)}</span>
      </span>
    {/each}
    {#if Object.keys(voice.peers).length === 0}<span class="muted small">Waiting for others to join…</span>{/if}
  {/if}
  {#if voice.error}<span class="verr">{voice.error}</span>{/if}
</div>

<style>
  .voice-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 6px 0; }
  .btn.on { background: #e0483a; color: #fff; }
  .btn-small { padding: 4px 10px; font-size: 12.5px; }
  .peer { display: inline-flex; align-items: center; gap: 6px; font-size: 12.5px; font-weight: 600;
    padding: 3px 9px; border-radius: 999px; background: rgba(255,255,255,0.06); }
  .pdot { width: 8px; height: 8px; border-radius: 50%; background: #b0872b; }
  .peer.on .pdot { background: #33d17a; box-shadow: 0 0 6px #33d17a; }
  .small { font-size: 11px; }
  .verr { color: #e06c75; font-size: 12px; }
</style>
