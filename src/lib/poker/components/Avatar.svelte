<script>
  // A user avatar: shows the uploaded image when `mediaId` is set, otherwise a
  // colored initial derived from the id. Drop-in wherever avatars appear.
  import { initials as initial, avColor as color } from "$lib/initials.js";
  let { name = "?", id = "", mediaId = null, size = 40, href = null } = $props();
</script>

{#if href}
  <a class="av" href={href} style="width:{size}px;height:{size}px;{mediaId ? '' : `background:${color(id)};font-size:${Math.round(size * 0.36)}px`}" title="View profile">
    {#if mediaId}<img src="/media/{mediaId}" alt={name} loading="lazy" />{:else}{initial(name)}{/if}
  </a>
{:else}
  <span class="av" style="width:{size}px;height:{size}px;{mediaId ? '' : `background:${color(id)};font-size:${Math.round(size * 0.36)}px`}">
    {#if mediaId}<img src="/media/{mediaId}" alt={name} loading="lazy" />{:else}{initial(name)}{/if}
  </span>
{/if}

<style>
  .av { border-radius: 50%; display: grid; place-items: center; font-weight: 700; color: #fff; overflow: hidden; flex: 0 0 auto; text-decoration: none; transition: filter var(--dur, .2s) var(--ease, ease); }
  a.av:hover { filter: brightness(1.1); }
  .av img { width: 100%; height: 100%; object-fit: cover; }
</style>
