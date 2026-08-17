<script>
  let { data, form } = $props();
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
    <form method="POST" action="?/claimDailyBonus" style="margin:0">
      <button class="btn" type="submit" disabled={!data.bonusReady}>
        {data.bonusReady ? `Claim daily +${chips(data.dailyBonus)}` : "Daily bonus claimed"}
      </button>
    </form>
  </div>
  {#if form?.bonusError}<p class="form-error">{form.bonusError}</p>{/if}
  {#if form?.bonusOk}<p class="form-success">+{chips(form.bonusAmount)} chips added.</p>{/if}

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

{#if data.user.isAdmin && data.allUsers}
  <section class="card">
    <div class="card-head"><h3>Admin \u2014 grant / adjust chips</h3></div>
    <form method="POST" action="?/adjustChips" class="adjust-form">
      <label class="field">
        <span>User</span>
        <select name="userId" required class="admin-select">
          {#each data.allUsers as u (u.id)}
            <option value={u.id}>{u.email}{#if u.display_name} ({u.display_name}){/if} \u2014 {chips(u.chips)} chips</option>
          {/each}
        </select>
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
        <select name="userId" required style="background:var(--bg);border:1px solid var(--border-strong);color:var(--text);border-radius:6px;padding:6px 10px">
          {#each data.allUsers.filter((u) => !u.is_admin) as u (u.id)}
            <option value={u.id}>{u.email}{#if u.display_name} ({u.display_name}){/if}</option>
          {/each}
        </select>
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
  .wallet .balance-row {
    display: flex; align-items: center; justify-content: space-between;
    gap: 16px; flex-wrap: wrap;
  }
  .balance { display: inline-flex; align-items: baseline; gap: 8px; }
  .balance-num { font-size: 30px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .chip-ico.big {
    width: 20px; height: 20px; border-radius: 50%; align-self: center;
    background: radial-gradient(circle at 35% 30%, #ffe08a, #f5b301 60%, #b8860b);
    box-shadow: 0 0 0 2px rgba(255,255,255,0.15) inset; display: inline-block;
  }
  .sub { margin: 16px 0 6px; font-size: 13px; color: var(--muted); }
  .ledger { list-style: none; margin: 0; padding: 0; font-size: 13px; }
  .led-ts { font-size: 11.5px; }
  .pos { color: #33d17a; font-variant-numeric: tabular-nums; }
  .neg { color: #e06c75; font-variant-numeric: tabular-nums; }
  .adjust-form .admin-select {
    background: var(--bg); border: 1px solid var(--border-strong);
    color: var(--text); border-radius: 6px; padding: 6px 10px; width: 100%;
  }
</style>
