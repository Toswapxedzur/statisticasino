<script>
  // A user avatar: shows the uploaded image when `mediaId` is set, otherwise a
  // colored initial derived from the id. Drop-in wherever avatars appear.
  let { name = "?", id = "", mediaId = null, size = 40, href = null } = $props();
  const AV = ["#c0674f", "#4f7bc0", "#59a06a", "#8a5fb0", "#b0824f", "#4fa3b0", "#c05f8a", "#6a8f3a"];
  const color = (x) => { let h = 0; for (const c of String(x || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0; return AV[h % AV.length]; };
  const initial = (n) => String(n || "?").trim().charAt(0).toUpperCase() || "?";
</script>

{#if href}
  <a class="av" href={href} style="width:{size}px;height:{size}px;{mediaId ? '' : `background:${color(id)};font-size:${Math.round(size * 0.42)}px`}" title="View profile">
    {#if mediaId}<img src="/media/{mediaId}" alt={name} loading="lazy" />{:else}{initial(name)}{/if}
  </a>
{:else}
  <span class="av" style="width:{size}px;height:{size}px;{mediaId ? '' : `background:${color(id)};font-size:${Math.round(size * 0.42)}px`}">
    {#if mediaId}<img src="/media/{mediaId}" alt={name} loading="lazy" />{:else}{initial(name)}{/if}
  </span>
{/if}

<style>
  .av { border-radius: 50%; display: grid; place-items: center; font-weight: 700; color: #fff; overflow: hidden; flex: 0 0 auto; text-decoration: none; transition: filter var(--dur, .2s) var(--ease, ease); }
  a.av:hover { filter: brightness(1.1); }
  .av img { width: 100%; height: 100%; object-fit: cover; }
</style>
