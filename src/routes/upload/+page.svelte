<script>
  let { data, form } = $props();
  let submitting = $state(false);
</script>

<section class="card">
  <div class="card-head"><h3>Upload .casinodump</h3></div>
  <p class="muted">
    Drop the file you got from <em>Settings &rarr; Export all</em> in the
    Chrome extension. Each round gets parented under the casino-side
    player whose hole cards are visible (the "perspective owner") — so
    the same round captured from a different perspective by another
    user becomes its own row, not a merge of yours. Captures with no
    visible hole cards (pure spectator dumps) are <strong>rejected</strong>
    as generic.
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
      {submitting ? "Uploading…" : "Upload"}
    </button>
  </form>

  {#if form && form.error}
    <p class="form-error">{form.error}</p>
  {/if}
  {#if form && form.summary}
    <div class="card" style="margin-top:16px;background:var(--bg)">
      <strong>Done.</strong>
      <ul style="margin:6px 0 0 16px;padding:0;color:var(--muted)">
        <li>Received: {form.summary.received}</li>
        <li>Accepted (new rounds): {form.summary.accepted}</li>
        <li>Duplicates (collapsed): {form.summary.duplicates}</li>
        <li>
          Rejected as incomplete (no finishHand):
          <strong>{form.summary.rejectedIncomplete ?? 0}</strong>
        </li>
        <li>
          Rejected as generic (no perspective):
          <strong>{form.summary.rejectedGeneric}</strong>
        </li>
        {#if form.summary.errors && form.summary.errors.length}
          <li style="color:var(--danger)">Errors: {form.summary.errors.length}</li>
        {/if}
      </ul>
      {#if form.summary.rejectedGeneric > 0 && form.summary.accepted === 0}
        <p style="color:var(--muted);margin-top:8px">
          Every hand in this dump was captured as a spectator (no
          visible hole cards). Sit at the table and play a hand to
          produce a non-generic capture.
        </p>
      {/if}
    </div>
  {/if}
</section>
