<script>
  import "../app.css";
  import { page } from "$app/stores";
  import { onMount } from "svelte";
  import { onNavigate } from "$app/navigation";
  import { SITE_NAME } from "$lib/config.js";
  import { poker } from "$lib/poker/client.svelte.js";
  import { slidingIndicator } from "$lib/actions/slider.js";
  import { reducedMotion, d, DUR } from "$lib/motion.js";
  import { fly } from "svelte/transition";
  import Num from "$lib/poker/components/Num.svelte";
  import ProfilePopover from "$lib/poker/components/ProfilePopover.svelte";
  import NotifBell from "$lib/poker/components/NotifBell.svelte";
  import CallOverlay from "$lib/poker/components/CallOverlay.svelte";

  // Smooth slide+fade between main sections via the View Transitions API.
  // Only <main> (view-transition-name: main-content) animates — the topbar and
  // its sliding tab indicator stay put and glide on their own. Progressive
  // enhancement: browsers without the API just navigate; reduced-motion skips it.
  onNavigate((navigation) => {
    if (typeof document === "undefined" || !document.startViewTransition || reducedMotion()) return;
    return new Promise((resolve) => {
      document.startViewTransition(async () => {
        resolve();
        await navigation.complete;
      });
    });
  });

  let { data, children } = $props();

  // Signed-in users keep a live socket app-wide so private messages (and presence)
  // arrive on any page, and the nav can badge unread DMs.
  $effect(() => { if (data.user) poker.connect(); });
  const socialUnread = $derived(poker.socialUnread);

  // Live chip balance for the topbar pill (SSR seed + live "chips" events).
  let chips = $state(data.chips ?? 0);
  $effect(() => { chips = data.chips ?? 0; });

  // Theme: dark-blue by default; the saved choice is applied pre-paint in
  // app.html, we just mirror + toggle it here.
  let theme = $state("dark");
  let menuOpen = $state(false);

  onMount(() => {
    theme = document.documentElement.getAttribute("data-theme") || "dark";
    const onChips = (e) => { if (typeof e.detail === "number") chips = e.detail; };
    window.addEventListener("chips", onChips);
    return () => window.removeEventListener("chips", onChips);
  });

  let _themeTimer = null;
  function toggleTheme() {
    const root = document.documentElement;
    // Ease every element's colors through the swap (unless reduced motion).
    if (!reducedMotion()) {
      root.classList.add("theming");
      clearTimeout(_themeTimer);
      _themeTimer = setTimeout(() => root.classList.remove("theming"), 480);
    }
    theme = theme === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", theme);
    try { localStorage.setItem("rv-theme", theme); } catch (e) {}
  }

  // Close the mobile menu on navigation.
  $effect(() => { $page.url.pathname; menuOpen = false; });

  function isActive(prefix) {
    const p = $page.url.pathname;
    if (prefix === "/") return p === "/";
    return p === prefix || p.startsWith(prefix + "/");
  }

  function fmtChips(n) { return Number(n).toLocaleString("en-US"); }

  const links = $derived([
    { href: "/", label: "Lobby", show: true },
    { href: "/social", label: "Social", show: !!data.user, badge: socialUnread },
    { href: "/quests", label: "Quests", show: !!data.user },
    { href: "/sprint", label: "Sprint", show: true },
    { href: "/leaderboards", label: "Ranks", show: true },
    { href: "/data", label: "Data", show: true },
    { href: "/blog", label: "Blog", show: true },
    { href: "/contribute", label: "Contribute", show: true },
  ]);
</script>

<header class="topbar">
  <button class="menu-btn" aria-label="Menu" aria-expanded={menuOpen} onclick={() => (menuOpen = !menuOpen)}>
    <span class="bars"></span>
  </button>

  <a class="brand" href="/"><span class="dot"></span> {SITE_NAME}</a>

  <nav class="nav-tabs desk" aria-label="Sections" use:slidingIndicator>
    {#each links as l}
      {#if l.show}
        <a class="nav-tab" href={l.href} aria-current={isActive(l.href) ? "page" : undefined}>
          {l.label}{#if l.badge > 0}<span class="nav-badge">{l.badge}</span>{/if}
        </a>
      {/if}
    {/each}
  </nav>

  <div class="topbar-right">
    <button class="theme-btn" aria-label="Toggle theme" title="Toggle light / dark" onclick={toggleTheme}>
      {theme === "dark" ? "☾" : "☀"}
    </button>
    {#if data.user}<NotifBell />{/if}
    {#if data.user}
      <a class="chips-pill" href="/account" title="Your chips balance">
        <span class="chip-ico"></span>
        <Num value={chips} />
        {#if data.bonusReady}<span class="bonus-dot" title="Daily bonus ready"></span>{/if}
      </a>
      <a class="nav-tab" href="/account" aria-current={isActive("/account") ? "page" : undefined}>
        {data.user.displayName || data.user.email}
        {#if data.user.isAdmin}<span style="margin-left:4px;color:var(--gold-ink)">admin</span>{/if}
      </a>
    {:else}
      <a class="nav-tab" href="/account/login" aria-current={isActive("/account") ? "page" : undefined}>Sign in</a>
      <a class="btn btn-sm" href="/account/signup">Sign up</a>
    {/if}
  </div>
</header>

{#if menuOpen}
  <nav class="mobile-menu" aria-label="Sections" transition:fly={{ y: d(-10), duration: d(DUR.base) }}>
    {#each links as l}
      {#if l.show}
        <a class="m-link" href={l.href} aria-current={isActive(l.href) ? "page" : undefined}>
          {l.label}{#if l.badge > 0}<span class="nav-badge">{l.badge}</span>{/if}
        </a>
      {/if}
    {/each}
    {#if data.user}<a class="m-link" href="/account" aria-current={isActive("/account") ? "page" : undefined}>Account</a>{/if}
  </nav>
{/if}

<main>
  {@render children()}
</main>

<ProfilePopover />
{#if data.user}<CallOverlay />{/if}

{#if data.user && poker.myTables.length > 1}
  <div class="table-switcher" aria-label="Your tables">
    {#each poker.myTables as t (t.tableId)}
      <a class="tswitch" class:turn={t.myTurn} href={`/table/${t.tableId}`}>
        {t.name}{#if t.myTurn}<span class="turn-dot" title="Your turn"></span>{/if}
      </a>
    {/each}
  </div>
{/if}

<style>
  /* mobile menu toggle — hidden on desktop */
  .menu-btn {
    display: none; width: 34px; height: 34px; border: 0; border-radius: var(--r-pill);
    background: var(--well); color: var(--text); cursor: pointer; place-items: center;
    transition: background-color var(--dur) var(--ease);
  }
  .menu-btn:hover { background: var(--surface-2); }
  .menu-btn .bars, .menu-btn .bars::before, .menu-btn .bars::after {
    content: ""; display: block; width: 15px; height: 2px; border-radius: 2px; background: currentColor; position: relative;
  }
  .menu-btn .bars::before { position: absolute; top: -5px; }
  .menu-btn .bars::after { position: absolute; top: 5px; }

  .theme-btn {
    width: 34px; height: 34px; border: 0; border-radius: var(--r-pill);
    background: var(--well); color: var(--muted); cursor: pointer; font-size: 15px;
    display: grid; place-items: center;
    transition: color var(--dur) var(--ease), background-color var(--dur) var(--ease), transform var(--dur) var(--ease);
  }
  .theme-btn:hover { color: var(--text); background: var(--surface-2); transform: translateY(-1px); }

  .topbar-right { display: flex; align-items: center; gap: 9px; margin-left: auto; }

  .chip-ico {
    width: 13px; height: 13px; border-radius: 50%;
    background: radial-gradient(circle at 35% 30%, #ffe08a, #f5b301 60%, #b8860b);
    box-shadow: inset 0 0 0 2px rgba(255,255,255,0.28); display: inline-block;
  }
  .bonus-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 6px var(--ok); display: inline-block; }

  .nav-badge {
    display: inline-block; margin-left: 5px; min-width: 16px; padding: 0 5px;
    background: var(--danger); color: #fff; border-radius: var(--r-pill);
    font-size: 11px; font-weight: 700; line-height: 16px; text-align: center; vertical-align: middle;
  }

  .mobile-menu {
    position: sticky; top: 58px; z-index: 19; display: none; flex-direction: column;
    background: var(--surface); box-shadow: var(--shadow-panel); padding: 8px;
  }
  .mobile-menu .m-link {
    padding: 11px 14px; border-radius: var(--r-btn); color: var(--text); font-weight: 600; font-size: 14px;
    text-decoration: none; transition: background-color var(--dur) var(--ease);
  }
  .mobile-menu .m-link:hover { background: var(--well); text-decoration: none; }
  .mobile-menu .m-link[aria-current="page"] { background: var(--accent-soft); color: var(--accent-ink); }

  .table-switcher {
    position: fixed; right: 14px; bottom: 14px; z-index: 50;
    display: flex; flex-direction: column; gap: 6px; align-items: flex-end;
  }
  .tswitch {
    display: inline-flex; align-items: center; gap: 7px; padding: 8px 13px;
    background: var(--surface); border-radius: var(--r-pill); color: var(--text);
    text-decoration: none; font-size: 13px; font-weight: 600; box-shadow: var(--shadow-hover);
    transition: transform var(--dur) var(--ease);
  }
  .tswitch:hover { transform: translateY(-2px); text-decoration: none; }
  .tswitch.turn { box-shadow: 0 0 0 2px var(--ok), var(--shadow-hover); }
  .turn-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); animation: pulse 1.1s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.35; } }

  @media (max-width: 760px) {
    .nav-tabs.desk { display: none; }
    .menu-btn { display: grid; }
    .mobile-menu { display: flex; }
    .topbar-right .nav-tab { display: none; }
  }
</style>
