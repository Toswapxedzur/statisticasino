<script>
  let { form } = $props();
</script>

<section class="card" style="max-width:420px;margin:24px auto">
  <div class="card-head"><h3>Create account</h3></div>
  <form method="POST">
    <label class="field">
      <span>Display name (optional)</span>
      <input name="displayName" type="text" autocomplete="name" value={form?.displayName ?? ""} />
    </label>
    <label class="field">
      <span>Email</span>
      <input name="email" type="email" autocomplete="email" required value={form?.email ?? ""} />
    </label>
    <label class="field">
      <span>Password (min 8 characters)</span>
      <input name="password" type="password" autocomplete="new-password" minlength="8" required />
    </label>
    <button class="btn" type="submit">Create account</button>
    {#if form?.error}<p class="form-error">{form.error}</p>{/if}
  </form>
  <p class="muted" style="margin-top:12px;font-size:12.5px">
    Already have one? <a href="/account/login">Sign in</a>.
  </p>
</section>
