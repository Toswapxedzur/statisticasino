<script>
  let { data, form } = $props();
  function fmt(ts) {
    if (!ts) return "";
    return new Date(ts).toLocaleString();
  }
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

<section class="card">
  <div class="card-head"><h3>Your uploads ({data.myUploads.length})</h3></div>
  {#if data.myUploads.length === 0}
    <p class="muted">Nothing yet. Try the <a href="/upload">Upload</a> page.</p>
  {:else}
    <ul style="list-style:none;margin:0;padding:0">
      {#each data.myUploads as u (u.id)}
        <li class="row">
          <span>
            <a href={`/data#${u.hand_key}`}>{u.hand_key}</a>
            {#if u.is_canonical}<span style="color:var(--ok);margin-left:6px;font-size:11px">CANONICAL</span>{/if}
          </span>
          <span class="muted">seat {u.perspective_seat_id ?? "?"} \u00b7 {fmt(u.uploaded_at)}</span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<section class="card">
  <div class="card-head"><h3>Clean data</h3></div>
  <p class="muted">
    Removing data is intentionally not yet implemented. The button below
    will return a "not yet" response so the surface is there for testing.
  </p>
  <div class="settings-actions" style="text-align:right">
    <form method="POST" action="?/cleanData" style="margin:0">
      <button class="btn btn-danger" type="submit">Clean data</button>
    </form>
  </div>
  {#if form?.cleanError}<p class="form-error">{form.cleanError}</p>{/if}
</section>

{#if data.user.isAdmin && data.allUsers}
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
          <span class={u.is_admin ? "" : "muted"}>{u.is_admin ? "admin" : "user"}</span>
        </li>
      {/each}
    </ul>
  </section>
{/if}
