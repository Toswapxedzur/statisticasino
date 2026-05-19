<script>
  let { data } = $props();
</script>

<section class="card">
  <h1 style="margin-top:0;font-size:22px">Statisticasino</h1>
  <p class="muted">
    Aggregated poker captures + investigation notes. Browse the
    <a href="/data">Data</a> tab for hands collected from many uploaders, the
    <a href="/blog">Blog</a> for statistical write-ups, or
    <a href="/upload">Upload</a> a `.casinodump` from the Chrome extension.
  </p>
  <p class="muted" style="margin-bottom:0">
    {#if data.user}
      Signed in as <strong>{data.user.email}</strong>{#if data.user.isAdmin} (admin){/if}.
    {:else}
      Anonymous browsing + uploading are fine. <a href="/account/login">Sign in</a> to manage your account.
    {/if}
  </p>
</section>
