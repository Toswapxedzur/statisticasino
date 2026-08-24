<script>
  let { data, form } = $props();
</script>

<svelte:head><title>Friends</title></svelte:head>

<section class="card">
  <div class="card-head"><h3>Add a friend</h3></div>
  <form method="POST" action="?/add" class="add-form">
    <input class="handle" name="handle" placeholder="Display name or email" autocomplete="off" />
    <button class="btn" type="submit">Send request</button>
  </form>
  {#if form?.addError}<p class="form-error">{form.addError}</p>{/if}
  {#if form?.addOk}<p class="form-success">{form.addOk}</p>{/if}
</section>

{#if data.incoming.length}
  <section class="card">
    <div class="card-head"><h3>Friend requests ({data.incoming.length})</h3></div>
    <ul class="people">
      {#each data.incoming as p (p.id)}
        <li class="person">
          <span class="who"><span class="dot" class:on={p.online}></span>{p.name}</span>
          <span class="actions">
            <form method="POST" action="?/respond" style="margin:0">
              <input type="hidden" name="userId" value={p.id} />
              <input type="hidden" name="accept" value="true" />
              <button class="btn btn-small" type="submit">Accept</button>
            </form>
            <form method="POST" action="?/respond" style="margin:0">
              <input type="hidden" name="userId" value={p.id} />
              <input type="hidden" name="accept" value="false" />
              <button class="btn btn-small btn-secondary" type="submit">Decline</button>
            </form>
          </span>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<section class="card">
  <div class="card-head"><h3>Friends ({data.friends.length})</h3></div>
  {#if data.friends.length === 0}
    <p class="muted">No friends yet — add someone by their display name or email above.</p>
  {:else}
    <ul class="people">
      {#each data.friends as p (p.id)}
        <li class="person">
          <span class="who">
            <span class="dot" class:on={p.online}></span>{p.name}
            {#if p.tableId}<span class="muted small">· at {p.tableName || "a table"}</span>{/if}
          </span>
          <span class="actions">
            {#if p.tableId}<a class="btn btn-small" href={`/table/${p.tableId}`}>Join</a>{/if}
            <form method="POST" action="?/remove" style="margin:0">
              <input type="hidden" name="userId" value={p.id} />
              <button class="btn btn-small btn-secondary" type="submit">Remove</button>
            </form>
          </span>
        </li>
      {/each}
    </ul>
  {/if}
</section>

{#if data.outgoing.length}
  <section class="card">
    <div class="card-head"><h3>Pending sent ({data.outgoing.length})</h3></div>
    <ul class="people">
      {#each data.outgoing as p (p.id)}
        <li class="person">
          <span class="who muted">{p.name} · awaiting reply</span>
          <form method="POST" action="?/remove" style="margin:0">
            <input type="hidden" name="userId" value={p.id} />
            <button class="btn btn-small btn-secondary" type="submit">Cancel</button>
          </form>
        </li>
      {/each}
    </ul>
  </section>
{/if}

<style>
  .add-form { display: flex; gap: 8px; flex-wrap: wrap; }
  .handle { flex: 1; min-width: 200px; padding: 8px 10px; border-radius: 8px;
    border: 1px solid var(--border, rgba(255,255,255,0.15)); background: rgba(255,255,255,0.04); color: inherit; }
  .people { list-style: none; margin: 0; padding: 0; }
  .person { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 0;
    border-bottom: 1px solid var(--border, rgba(255,255,255,0.07)); }
  .person:last-child { border-bottom: none; }
  .who { display: inline-flex; align-items: center; gap: 8px; font-weight: 600; }
  .actions { display: inline-flex; gap: 6px; align-items: center; }
  .dot { width: 9px; height: 9px; border-radius: 50%; background: #6b7280; flex: none; }
  .dot.on { background: #33d17a; box-shadow: 0 0 6px #33d17a; }
  .btn-small { padding: 4px 10px; font-size: 12.5px; }
  .small { font-size: 11.5px; }
</style>
