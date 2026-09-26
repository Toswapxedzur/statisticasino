<script>
  import { enhance } from "$app/forms";
  import Avatar from "$lib/poker/components/Avatar.svelte";
  import Chip from "$lib/poker/components/Chip.svelte";
  import { LOOKS, plateStyle } from "$lib/cosmetics.js";
  import { SITE_NAME } from "$lib/config.js";

  let { data } = $props();
  let ring = $state(data.ring);
  let badge = $state(data.badge);
  let error = $state(null);

  const owned = new Set(data.owned);
  const fmt = (n) => Number(n).toLocaleString("en-US");
  const short = (n) => (n >= 1e6 ? `${n / 1e6}M` : n >= 1e3 ? `${n / 1e3}K` : String(n));
  const progress = (at) => Math.min(100, Math.round(((data.peak || 0) / at) * 100));
  const plate = $derived(plateStyle(badge));
  const plateVars = (p) => `background:${p.bg};--ink:${p.ink};--sub:${p.sub};--money:${p.money}`;

  // equip without a reload; the server re-checks the unlock
  const equipping = (slot, look) => () => async ({ result }) => {
    if (result.type === "success") { error = null; if (slot === "ring") ring = look; else badge = look; }
    else if (result.type === "failure") error = result.data?.error || "Couldn't equip that.";
  };
</script>

<svelte:head><title>Cosmetics — {SITE_NAME}</title></svelte:head>

<div class="wrap">
  <div class="head">
    <h1>Cosmetics</h1>
    <span class="bal" title="Your highest wealth ever: wallet plus chips on tables"><Chip value={data.peak} size={20} /> {fmt(data.peak)}</span>
  </div>
  <p class="muted intro">
    Everyone starts with the chess ring and badge. Reaching a wealth milestone unlocks that metal's
    ring and badge for good. Your wealth is your wallet plus the chips on your tables, and it counts
    your highest ever.
  </p>

  <!-- how you look at a table -->
  <div class="preview">
    <div class="plate" style={plateVars(plate)}>
      <Avatar id={data.me.id} name={data.me.name} mediaId={data.me.avatarMediaId} size={36} {ring} />
      <div class="txt">
        <div class="r1"><span class="name">{data.me.name}</span><span class="stack">{fmt(data.wealth)}</span></div>
        <div class="r3">How you look at the table</div>
      </div>
    </div>
  </div>
  {#if error}<p class="err" role="alert">{error}</p>{/if}

  {#each [["ring", "Rings", "The band round your avatar."], ["badge", "Badges", "The colour of your seat plate."]] as [slot, title, sub]}
    <section class="grp">
      <div class="grp-head"><h2>{title}</h2><span class="muted small">{sub}</span></div>
      <div class="grid">
        {#each LOOKS as l (l.key)}
          {@const has = owned.has(l.key)}
          {@const on = (slot === "ring" ? ring : badge) === l.key}
          <form method="POST" action="?/equip" use:enhance={equipping(slot, l.key)} class="tile" class:on class:locked={!has}>
            <input type="hidden" name="slot" value={slot} />
            <input type="hidden" name="look" value={l.key} />
            <div class="swatch">
              {#if slot === "ring"}
                <Avatar id={data.me.id} name={data.me.name} mediaId={data.me.avatarMediaId} size={40} ring={l.key} />
              {:else}
                <span class="mini" style={plateVars(plateStyle(l.key))}><b>Aa</b><i>12,480</i></span>
              {/if}
            </div>
            <div class="nm">{l.name}</div>
            {#if on}
              <span class="state wearing">Wearing</span>
            {:else if has}
              <button class="state wear" type="submit">Wear</button>
            {:else}
              <span class="state lock">Unlocks at {short(l.at)}</span>
              <div class="bar" aria-label="{progress(l.at)}% of the way"><div class="fill" style="width:{progress(l.at)}%"></div></div>
            {/if}
          </form>
        {/each}
      </div>
    </section>
  {/each}
</div>

<style>
  .wrap { max-width: 720px; margin: 0 auto; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
  h1 { margin: 0; font-size: 26px; }
  .bal { font-weight: 800; font-variant-numeric: tabular-nums; color: var(--gold-ink); font-size: 17px; display: inline-flex; align-items: center; gap: 7px; }
  .intro { margin: 6px 0 18px; max-width: 62ch; }
  .small { font-size: 12.5px; }
  .err { color: var(--danger); margin: 0 0 12px; font-weight: 600; }

  .preview { display: flex; justify-content: center; padding: 22px 12px; background: var(--well); border-radius: var(--r-card); margin-bottom: 22px; }
  .plate { display: flex; align-items: center; gap: 8px; padding: 5px 14px 5px 5px; border-radius: 16px; box-shadow: var(--shadow-card); }
  .plate .r1 { display: flex; gap: 7px; align-items: baseline; }
  .plate .name { font-size: 14px; font-weight: 700; color: var(--ink); }
  .plate .stack { font-size: 15px; font-weight: 700; color: var(--money); font-variant-numeric: tabular-nums; }
  .plate .r3 { font-size: 11px; color: var(--sub); }

  .grp { margin-bottom: 24px; }
  .grp-head { display: flex; align-items: baseline; gap: 10px; margin-bottom: 10px; flex-wrap: wrap; }
  .grp-head h2 { margin: 0; font-size: 15px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(118px, 1fr)); gap: 10px; }
  .tile { margin: 0; display: grid; justify-items: center; gap: 6px; padding: 14px 8px 12px; background: var(--surface); border-radius: var(--r-card);
    box-shadow: var(--shadow-card); transition: box-shadow var(--dur) var(--ease); }
  .tile.on { box-shadow: 0 0 0 2px var(--accent), var(--shadow-card); }
  .tile.locked .swatch { filter: grayscale(0.85) brightness(0.8); opacity: 0.75; }
  .swatch { height: 70px; display: grid; place-items: center; }
  .mini { display: inline-flex; align-items: baseline; gap: 6px; padding: 9px 12px; border-radius: 12px; box-shadow: var(--shadow-card); }
  .mini b { color: var(--ink); font-size: 14px; }
  .mini i { color: var(--money); font-style: normal; font-weight: 700; font-size: 13px; font-variant-numeric: tabular-nums; }
  .nm { font-weight: 700; font-size: 13.5px; }
  .state { font-size: 12px; font-weight: 700; }
  .wearing { color: var(--accent); }
  .wear { border: 0; cursor: pointer; background: var(--accent); color: var(--on-accent, #fff); padding: 5px 14px; border-radius: var(--r-pill); font: inherit; font-size: 12px; font-weight: 700; }
  .wear:hover { filter: brightness(1.08); }
  .lock { color: var(--muted); }
  .bar { width: 80%; height: 5px; background: var(--well); border-radius: var(--r-pill); overflow: hidden; }
  .fill { height: 100%; background: var(--gold-ink); border-radius: var(--r-pill); }
</style>
