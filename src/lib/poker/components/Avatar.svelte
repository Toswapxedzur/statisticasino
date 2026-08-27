<script>
  // A user avatar: uploaded image (via `mediaId` -> /media/[id]) or a colored
  // 2-letter monogram. Interaction:
  //   userId set -> clicking opens the app-wide profile POPOVER (add friend, etc.)
  //   href set    -> plain link (navigation)
  //   neither     -> static
  import { initials as initial, avColor as color } from "$lib/initials.js";
  import { profilePop } from "$lib/profilePopover.svelte.js";
  let { name = "?", id = "", mediaId = null, size = 40, href = null, userId = null } = $props();

  function openPop(e) {
    e.preventDefault(); e.stopPropagation();
    profilePop.open(userId, e.currentTarget.getBoundingClientRect());
  }
  const styleFor = () => `width:${size}px;height:${size}px;${mediaId ? "" : `background:${color(id || userId)};font-size:${Math.round(size * 0.36)}px`}`;
</script>

{#if userId}
  <button type="button" class="av av-btn" style={styleFor()} onclick={openPop} aria-label={`${name} — open profile`}>
    {#if mediaId}<img src="/media/{mediaId}" alt={name} loading="lazy" />{:else}{initial(name)}{/if}
  </button>
{:else if href}
  <a class="av" href={href} style={styleFor()} title="View profile">
    {#if mediaId}<img src="/media/{mediaId}" alt={name} loading="lazy" />{:else}{initial(name)}{/if}
  </a>
{:else}
  <span class="av" style={styleFor()}>
    {#if mediaId}<img src="/media/{mediaId}" alt={name} loading="lazy" />{:else}{initial(name)}{/if}
  </span>
{/if}

<style>
  .av { border-radius: 50%; display: grid; place-items: center; font-weight: 700; color: #fff; overflow: hidden; flex: 0 0 auto; text-decoration: none; transition: filter var(--dur, .2s) var(--ease, ease); }
  .av-btn { border: 0; padding: 0; cursor: pointer; }
  a.av:hover, .av-btn:hover { filter: brightness(1.1); }
  .av img { width: 100%; height: 100%; object-fit: cover; }
</style>
