<script>
  let { data, form } = $props();
  let submitting = $state(false);
</script>

<section class="card">
  <div class="card-head"><h3>Upload .casinodump</h3></div>
  <p class="muted">
    Drop the file you got from <em>Settings &rarr; Export all</em> in the
    Chrome extension. We'll merge each hand into the canonical dataset.
    Finished hands you uploaded from your seat will be marked
    <span style="color:var(--hero);font-weight:600">red</span> on the replay felt.
  </p>

  <form
    method="POST"
    enctype="multipart/form-data"
    onsubmit={() => { submitting = true; }}
  >
    <label class="field">
      <span>Dump file</span>
      <input name="dump" type="file" accept=".casinodump,.json,.gz,application/octet-stream" required />
    </label>
    <button class="btn" type="submit" disabled={submitting}>
      {submitting ? "Uploading\u2026" : "Upload"}
    </button>
    {#if !data.user}
      <p class="muted" style="margin-top:8px">
        Uploading anonymously. <a href="/account/login">Sign in</a> to link
        these hands to your account (no requirement).
      </p>
    {/if}
  </form>

  {#if form && form.error}
    <p class="form-error">{form.error}</p>
  {/if}
  {#if form && form.summary}
    <div class="card" style="margin-top:16px;background:var(--bg)">
      <strong>Done.</strong>
      <ul style="margin:6px 0 0 16px;padding:0;color:var(--muted)">
        <li>Received: {form.summary.received}</li>
        <li>New canonical hands: {form.summary.canonicalCreated}</li>
        <li>Perspectives added: {form.summary.perspectivesAdded}</li>
        <li>Duplicates: {form.summary.duplicates}</li>
        {#if form.summary.errors && form.summary.errors.length}
          <li style="color:var(--danger)">Errors: {form.summary.errors.length}</li>
        {/if}
      </ul>
    </div>
  {/if}
</section>
