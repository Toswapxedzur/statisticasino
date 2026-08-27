<script>
  import { enhance } from "$app/forms";
  import Avatar from "$lib/poker/components/Avatar.svelte";
  import Select from "$lib/components/Select.svelte";
  import { uploadMedia } from "$lib/media.js";
  let { data, form } = $props();

  let visibility = $state(data.profile?.visibility || "public");
  let adjustUserId = $state("");
  let promoteUserId = $state("");

  let avatarId = $state(data.profile?.avatarMediaId ?? null);
  let uploadingAvatar = $state(false);
  let avatarErr = $state("");
  async function onAvatarFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    uploadingAvatar = true; avatarErr = "";
    try {
      const id = await uploadMedia(file, "avatar");
      const fd = new FormData(); fd.set("avatarMediaId", id);
      await fetch("?/setAvatar", { method: "POST", body: fd });
      avatarId = id;
    } catch (err) { avatarErr = err?.message || "Upload failed"; }
    uploadingAvatar = false;
    e.target.value = "";
  }
  async function removeAvatar() {
    const fd = new FormData(); fd.set("avatarMediaId", "");
    await fetch("?/setAvatar", { method: "POST", body: fd });
    avatarId = null;
  }
  function fmt(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleString();
  }
  function chips(n) { return Number(n).toLocaleString("en-US"); }
  const REASON_LABEL = {
    signup_grant: "Welcome grant",
    daily_bonus: "Daily bonus",
    admin_adjust: "Admin adjustment",
    table_buyin: "Table buy-in",
    table_cashout: "Table cash-out"
  };
</script>

<section class="card">
  <div class="card-head">
    <h3>Account</h3>
    <form method="POST" action="?/logout" style="margin:0">
      <button class="btn btn-secondary" type="submit">Sign out</button>
    </form>
  </div>
  <div class="row"><span>Email</span><span>{data.user.email}</span></div>
  <div class="row"><span>Display name</span><span>{data.user.displayName || "(none)"}</span></div>
  <div class="row">
    <span>Role</span>
    <span>{data.user.isAdmin ? "admin" : "authenticated user"}</span>
  </div>
</section>

<section class="card wallet">
  <div class="card-head"><h3>Chips wallet</h3></div>
  <div class="balance-row">
    <div class="balance">
      <span class="chip-ico big"></span>
      <span class="balance-num">{chips(data.chips)}</span>
      <span class="muted">chips</span>
    </div>
    <div class="bonus-side">
      {#if (form?.streak ?? data.streak) > 0}
        <span class="streak" title="Consecutive daily logins. Status only — no extra chips.">
          🔥 {form?.streak ?? data.streak}-day streak{#if (form?.bestStreak ?? data.bestStreak) > (form?.streak ?? data.streak)} · best {form?.bestStreak ?? data.bestStreak}{/if}
        </span>
      {/if}
      <form method="POST" action="?/claimDailyBonus" style="margin:0">
        <button class="btn" type="submit" disabled={!data.bonusReady}>
          {data.bonusReady ? `Claim daily +${chips(data.dailyBonus)}` : "Daily bonus claimed"}
        </button>
      </form>
    </div>
  </div>
  {#if form?.bonusError}<p class="form-error">{form.bonusError}</p>{/if}
  {#if form?.bonusOk}<p class="form-success">+{chips(form.bonusAmount)} chips added. 🔥 {form.streak}-day streak.{#if form.newBadges?.length} New badge{form.newBadges.length > 1 ? "s" : ""} unlocked!{/if}</p>{/if}

  {#if data.ledger?.length}
    <h4 class="sub">Recent activity</h4>
    <ul class="ledger">
      {#each data.ledger as e}
        <li class="row">
          <span>{REASON_LABEL[e.reason] || e.reason}<span class="muted led-ts"> · {fmt(e.created_at)}</span></span>
          <span class={e.delta >= 0 ? "pos" : "neg"}>{e.delta >= 0 ? "+" : ""}{chips(e.delta)}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

{#if data.achievements?.length}
  <section class="card">
    <div class="card-head">
      <h3>Achievements</h3>
      <span class="muted">{data.achievements.filter((a) => a.unlocked).length} / {data.achievements.length}</span>
    </div>
    <p class="muted" style="margin:0 0 12px">Badges for milestones. Status only — they don't grant chips.</p>
    <div class="badges">
      {#each data.achievements as a (a.key)}
        <div class="badge" class:locked={!a.unlocked} title={a.desc}>
          <span class="badge-ico">{a.unlocked ? "🏅" : "🔒"}</span>
          <span class="badge-name">{a.name}</span>
          <span class="badge-desc muted">{a.desc}</span>
        </div>
      {/each}
    </div>
  </section>
{/if}

<section class="card">
  <div class="card-head"><h3>Change display name</h3></div>
  <form method="POST" action="?/updateDisplayName">
    <label class="field">
      <span>Display name</span>
      <input
        name="displayName"
        type="text"
        autocomplete="name"
        maxlength="64"
        placeholder="Leave blank to clear"
        value={data.user.displayName ?? ""}
      />
    </label>
    <button class="btn" type="submit">Save</button>
    {#if form?.displayNameError}<p class="form-error">{form.displayNameError}</p>{/if}
    {#if form?.displayNameOk}<p class="form-success">Saved.</p>{/if}
  </form>
</section>

<section class="card">
  <div class="card-head">
    <h3>Social profile</h3>
    <span style="display:flex;gap:8px">
      <a class="btn btn-secondary btn-sm" href="/settings">Settings</a>
      <a class="btn btn-secondary btn-sm" href="/history">History</a>
      <a class="btn btn-secondary btn-sm" href="/u/{data.user.id}">View my profile</a>
    </span>
  </div>
  <div class="avatar-edit">
    <Avatar id={data.user.id} name={data.user.displayName || data.user.email} mediaId={avatarId} size={64} />
    <div class="avatar-controls">
      <label class="btn btn-secondary btn-sm">
        {uploadingAvatar ? "Uploading…" : "Change photo"}
        <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" hidden onchange={onAvatarFile} disabled={uploadingAvatar} />
      </label>
      {#if avatarId}<button class="btn btn-secondary btn-sm" type="button" onclick={removeAvatar}>Remove</button>{/if}
      {#if avatarErr}<span class="form-error">{avatarErr}</span>{/if}
    </div>
  </div>
  <form method="POST" action="?/updateProfile">
    <label class="field">
      <span>Status</span>
      <input name="statusText" type="text" maxlength="140" placeholder="What's your vibe?" value={data.profile?.statusText ?? ""} />
    </label>
    <label class="field">
      <span>About</span>
      <textarea name="bio" maxlength="500" rows="3" placeholder="A short bio for your profile">{data.profile?.bio ?? ""}</textarea>
    </label>
    <label class="field">
      <span>Who can see my profile</span>
      <Select name="visibility" bind:value={visibility} block
        options={[{ value: "public", label: "Everyone" }, { value: "friends", label: "Friends only" }, { value: "private", label: "Nobody (private)" }]} />
    </label>
    <button class="btn" type="submit">Save profile</button>
    {#if form?.profileOk}<p class="form-success">Profile saved.</p>{/if}
    {#if form?.profileError}<p class="form-error">{form.profileError}</p>{/if}
  </form>
</section>

<section class="card">
  <div class="card-head"><h3>Your uploads ({data.myUploads.length})</h3></div>
  {#if data.myUploads.length === 0}
    <p class="muted">Nothing yet. Try the <a href="/contribute">Contribute</a> page.</p>
  {:else}
    <ul style="list-style:none;margin:0;padding:0">
      {#each data.myUploads as u (u.id)}
        <li class="row">
          <span>
            <a href={`/data#${u.hand_key}`}>{u.hand_key}</a>
            {#if u.is_canonical}<span style="color:var(--ok);margin-left:6px;font-size:11px">CANONICAL</span>{/if}
          </span>
          <span class="muted">
            {u.player_name === "[Generic]"
              ? "Generic \u00b7 "
              : (u.player_name ? `${u.player_name} \u00b7 ` : "")}{u.hero_seat == null ? "no hero" : `seat ${u.hero_seat}`} \u00b7 {fmt(u.uploaded_at)}
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="card">
  <div class="card-head"><h3>Clean data</h3></div>
  <p class="muted">
    {#if data.user.isAdmin}
      Per-round, per-table, and per-player deletion lives on the
      <a href="/data">Data</a> page now — admins see checkboxes,
      <em>Delete table</em> buttons, and a sticky bulk-delete bar.
    {:else}
      Only admins can clean data. Ask an existing admin to promote your
      account.
    {/if}
  </p>
</section>

{#if data.user.isAdmin && data.reports}
  <section class="card">
    <div class="card-head"><h3>Reports ({data.reports.length})</h3></div>
    {#if data.reports.length === 0}
      <p class="muted small">No open reports.</p>
    {:else}
      {#each data.reports as r (r.id)}
        <div class="report-row">
          <div class="report-main">
            <span><a href="/u/{r.reporter_id}">{r.reporter_name || r.reporter_email || "someone"}</a> reported <a href="/u/{r.target_id}"><b>{r.target_name || r.target_email || "a user"}</b></a></span>
            {#if r.reason}<span class="muted small">{r.reason}</span>{/if}
          </div>
          <form method="POST" action="?/resolveReport" use:enhance>
            <input type="hidden" name="id" value={r.id} />
            <button class="btn btn-sm btn-secondary" type="submit">Resolve</button>
          </form>
        </div>
      {/each}
    {/if}
  </section>
{/if}

{#if data.user.isAdmin && data.allUsers}
  <section class="card">
    <div class="card-head"><h3>Admin \u2014 grant / adjust chips</h3></div>
    <form method="POST" action="?/adjustChips" class="adjust-form">
      <label class="field">
        <span>User</span>
        <Select name="userId" bind:value={adjustUserId} block
          options={data.allUsers.map((u) => ({ value: u.id, label: `${u.email}${u.display_name ? ` (${u.display_name})` : ""} \u2014 ${chips(u.chips)} chips` }))} />
      </label>
      <label class="field">
        <span>Amount (negative to remove)</span>
        <input name="delta" type="number" step="1" placeholder="e.g. 5000 or -2000" required />
      </label>
      <button class="btn" type="submit">Apply adjustment</button>
      {#if form?.adjustError}<p class="form-error">{form.adjustError}</p>{/if}
      {#if form?.adjustOk}<p class="form-success">Done. New balance: {chips(form.adjustBalance)} chips.</p>{/if}
    </form>
  </section>

  <section class="card">
    <div class="card-head"><h3>Admin \u2014 promote a user</h3></div>
    <form method="POST" action="?/promote">
      <label class="field">
        <span>User</span>
        <Select name="userId" bind:value={promoteUserId} block
          options={data.allUsers.filter((u) => !u.is_admin).map((u) => ({ value: u.id, label: `${u.email}${u.display_name ? ` (${u.display_name})` : ""}` }))} />
      </label>
      <button class="btn" type="submit">Promote to admin</button>
      {#if form?.promoteError}<p class="form-error">{form.promoteError}</p>{/if}
      {#if form?.promoteOk}<p class="form-success">Promoted.</p>{/if}
    </form>

    <h4 style="margin:18px 0 6px;font-size:13px;color:var(--muted)">All accounts</h4>
    <ul style="list-style:none;margin:0;padding:0">
      {#each data.allUsers as u (u.id)}
        <li class="row">
          <span>{u.email}{#if u.display_name} ({u.display_name}){/if}</span>
          <span>
            <span class="muted" style="margin-right:10px">{chips(u.chips)} chips</span>
            <span class={u.is_admin ? "" : "muted"}>{u.is_admin ? "admin" : "user"}</span>
          </span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .avatar-edit { display: flex; align-items: center; gap: 14px; margin-bottom: 14px; }
  .avatar-controls { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
  .report-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 9px 0; }
  .report-main { display: flex; flex-direction: column; gap: 2px; font-size: 13.5px; }
  .wallet .balance-row {
    display: flex; align-items: center; justify-content: space-between;
    gap: 16px; flex-wrap: wrap;
  }
  .balance { display: inline-flex; align-items: baseline; gap: 8px; }
  .balance-num { font-size: 30px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .bonus-side { display: inline-flex; align-items: center; gap: 12px; flex-wrap: wrap; justify-content: flex-end; }
  .streak { font-size: 13px; font-weight: 600; color: var(--fg); white-space: nowrap; }
  .badges { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
  .badge {
    display: flex; flex-direction: column; gap: 3px; padding: 10px 12px;
    border-radius: var(--r-btn); background: var(--well); box-shadow: var(--shadow-card);
  }
  .badge.locked { opacity: 0.5; }
  .badge-ico { font-size: 20px; }
  .badge-name { font-weight: 700; font-size: 13px; }
  .badge-desc { font-size: 11.5px; line-height: 1.3; }
  .chip-ico.big {
    width: 20px; height: 20px; border-radius: 50%; align-self: center;
    background: var(--gold-ink); box-shadow: inset 0 0 0 3px var(--gold-bg); display: inline-block;
  }
  .sub { margin: 16px 0 6px; font-size: 13px; color: var(--muted); }
  .ledger { list-style: none; margin: 0; padding: 0; font-size: 13px; }
  .led-ts { font-size: 11.5px; }
  .pos { color: var(--ok); font-variant-numeric: tabular-nums; }
  .neg { color: var(--danger); font-variant-numeric: tabular-nums; }
  .admin-select { width: 100%; }
</style>
