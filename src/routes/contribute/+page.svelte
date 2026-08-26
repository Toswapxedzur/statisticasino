<script>
  let { data, form } = $props();
  let submitting = $state(false);
  let fileName = $state("");
  function onFile(e) { fileName = e.target.files?.[0]?.name || ""; }

  function fmtSize(bytes) {
    if (bytes == null) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }
</script>

<section class="card">
  <div class="card-head"><h3>Upload .casinodump</h3></div>
  <p class="muted">
    Drop the file you got from <em>Settings &rarr; Export all</em> in the
    Chrome extension. Each round gets parented under the casino-side
    player whose hole cards are visible (the "perspective owner") — so
    the same round captured from a different perspective by another
    user becomes its own row, not a merge of yours.
    {#if data.user && data.user.isAdmin}
      As an admin, generic captures (no visible hole cards — pure
      spectator dumps) are also accepted and land under the
      <strong>[Generic]</strong> player.
    {:else}
      Captures with no visible hole cards (pure spectator dumps) are
      <strong>rejected</strong> as generic; only admins can ingest
      those.
    {/if}
  </p>

  <form
    method="POST"
    enctype="multipart/form-data"
    onsubmit={() => { submitting = true; }}
  >
    <div class="field">
      <span>Dump file</span>
      <label class="file-pick">
        <input name="dump" type="file" accept=".casinodump,.json,.gz,application/octet-stream" hidden onchange={onFile} />
        <span class="btn btn-secondary file-btn">Choose file</span>
        <span class="file-name" class:empty={!fileName}>{fileName || "No file selected"}</span>
      </label>
    </div>
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
        <li>
          Accepted (new rounds): {form.summary.accepted}
          {#if form.summary.acceptedGeneric > 0}
            <span style="color:var(--muted)">
              (incl. {form.summary.acceptedGeneric} generic)
            </span>
          {/if}
        </li>
        <li>Duplicates (collapsed): {form.summary.duplicates}</li>
        <li>
          Rejected as incomplete (no finishHand):
          <strong>{form.summary.rejectedIncomplete ?? 0}</strong>
        </li>
        <li>
          Rejected as generic (no perspective):
          <strong>{form.summary.rejectedGeneric}</strong>
        </li>
        {#if (form.summary.rejectedVariant ?? 0) > 0}
          <li>
            Rejected as non-Hold'em variant:
            <strong>{form.summary.rejectedVariant}</strong>
          </li>
        {/if}
        {#if (form.summary.rejectedNoStakes ?? 0) > 0}
          <li>
            Rejected (couldn't extract blinds):
            <strong>{form.summary.rejectedNoStakes}</strong>
          </li>
        {/if}
        {#if form.summary.errors && form.summary.errors.length}
          <li style="color:var(--danger)">Errors: {form.summary.errors.length}</li>
        {/if}
      </ul>
      {#if form.summary.rejectedGeneric > 0 && form.summary.accepted === 0}
        <p style="color:var(--muted);margin-top:8px">
          {#if data.user && data.user.isAdmin}
            Every hand was generic but none were accepted — check the
            errors list. (Admins can ingest generic dumps; the bytes
            still need to decode correctly.)
          {:else}
            Every hand in this dump was captured as a spectator (no
            visible hole cards). Sign in as an admin to ingest generic
            dumps, or sit at the table and play a hand for a
            non-generic capture.
          {/if}
        </p>
      {/if}
    </div>
  {/if}
</section>

<section class="card contribute-card">
  <div class="card-head"><h3>Contribute Data</h3></div>
  <p class="muted">
    Don't have a <code>.casinodump</code> yet? Install the Casino
    Inspector Chrome extension first, capture some hands while you
    play, and come back here to upload them.
  </p>

  <ol class="steps">
    <li class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <h4>Download the extension</h4>
        <p class="muted">
          Single zip with the unpacked extension inside. Works on
          macOS, Windows and Linux — every modern OS unzips it
          natively.
        </p>
        {#if data.extensionZip}
          <p>
            <!--
              Cache-bust query string keyed on the zip's mtime.
              Cloudflare and the user's browser both treat each new
              build as a new URL, so they re-fetch instead of
              serving an old cached copy from disk
              (cache-control on /downloads/ is max-age=14400).
              The `download` attribute keeps the saved filename as
              `casino-inspector.zip` regardless of the query string.
            -->
            <a
              class="btn btn-primary"
              href="/downloads/casino-inspector.zip?v={Math.floor(data.extensionZip.mtime || 0)}"
              download="casino-inspector.zip"
            >
              Download casino-inspector.zip
              <span class="muted">({fmtSize(data.extensionZip.sizeBytes)})</span>
            </a>
          </p>
        {:else}
          <p class="form-error">
            The zip hasn't been built yet. Run
            <code>npm run build</code> on the server (or
            <code>node scripts/build-extension-zip.js</code> for a
            quick rebuild without a full SvelteKit build).
          </p>
        {/if}
      </div>
    </li>

    <li class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <h4>Install it in Developer Mode</h4>
        <ol class="substeps">
          <li>Unzip <code>casino-inspector.zip</code> anywhere you like
            (Finder / Explorer's built-in unzip is fine).</li>
          <li>Open <code>chrome://extensions</code> in Chrome.</li>
          <li>Toggle <strong>Developer mode</strong> on (top-right
            corner).</li>
          <li>Click <strong>Load unpacked</strong> and pick the
            <em>folder</em> you just unzipped (the one containing
            <code>manifest.json</code>).</li>
          <li>"Casino Inspector" appears in your extensions list with
            a two-card icon. Pin it to the toolbar so you can find
            it.</li>
        </ol>
        <p class="muted">
          Same flow on Edge, Brave, and any other Chromium browser.
        </p>
      </div>
    </li>

    <li class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <h4>Play poker on casino.org</h4>
        <p class="muted">
          The extension captures passively in the background while
          you play. You don't need to keep the History tab open —
          closing it doesn't stop capture, and Chrome's
          service-worker keep-alive heartbeat (a 30-second
          <code>chrome.alarms</code> tick) ensures the worker
          stays reachable even on quiet tables. Capture only stops
          if you toggle <strong>Capture traffic</strong> off in the
          extension's Settings or disable / remove the extension
          itself.
        </p>
        <p class="muted">
          Aim to capture <em>complete</em> rounds — start at
          <code>startHand</code>, finish at <code>finishHand</code>.
          Mid-hand captures (you joined a table mid-round) are
          marked incomplete and rejected here.
        </p>
      </div>
    </li>

    <li class="step">
      <div class="step-num">4</div>
      <div class="step-body">
        <h4>Export and upload</h4>
        <ol class="substeps">
          <li>Click the Casino Inspector toolbar icon to open the
            History tab.</li>
          <li>Hit <strong>Settings &rarr; Export all</strong>. You
            get a <code>.casinodump</code> file (a gzipped JSON
            container).</li>
          <li>Drop that file into the upload box at the top of this
            page.</li>
        </ol>
        <p class="muted">
          Tip for repeat contributors: <strong>Auto-flush</strong> is
          on by default in extension Settings, so each hand is POSTed
          to <code>/api/flush</code> the moment it ends — no manual
          export needed. (Anonymous uploads are accepted there too.)
        </p>
      </div>
    </li>
  </ol>
</section>

<style>
  .file-pick { display: inline-flex; align-items: center; gap: 12px; cursor: pointer; margin-top: 4px; }
  .file-btn { flex: 0 0 auto; }
  .file-name { font-size: 13px; color: var(--text); }
  .file-name.empty { color: var(--muted); }
  .contribute-card { margin-top: 24px; }

  .steps {
    list-style: none;
    margin: 12px 0 0;
    padding: 0;
    counter-reset: step-counter;
    display: grid;
    gap: 10px;
  }
  .step {
    display: grid;
    grid-template-columns: 36px 1fr;
    gap: 14px;
    padding: 12px;
    background: var(--well);
    border-radius: var(--r-card);
  }
  .step-num {
    width: 32px; height: 32px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 999px;
    background: var(--accent-soft);
    color: var(--accent-ink);
    font-weight: 700;
  }
  .step-body h4 {
    margin: 4px 0 6px;
    font-size: 14px;
  }
  .step-body p { margin: 4px 0; }
  .substeps {
    margin: 6px 0 0 18px;
    padding: 0;
    color: var(--muted);
    font-size: 13.5px;
  }
  .substeps li { margin: 3px 0; }
  code {
    font-family: ui-monospace, Menlo, monospace;
    font-size: 12.5px;
    background: var(--surface-hover);
    padding: 1px 5px;
    border-radius: 4px;
  }
  .btn-primary {
    display: inline-flex; align-items: center; gap: 8px;
  }
</style>
