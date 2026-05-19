<script>
  let { form } = $props();
</script>

<section class="card" style="max-width:420px;margin:24px auto">
  <div class="card-head"><h3>Sign in</h3></div>
  <form method="POST">
    <label class="field">
      <span>Email</span>
      <input name="email" type="email" autocomplete="email" required value={form?.email ?? ""} />
    </label>
    <label class="field">
      <span>Password</span>
      <input name="password" type="password" autocomplete="current-password" required />
    </label>
    <button class="btn" type="submit">Sign in</button>
    {#if form?.error}<p class="form-error">{form.error}</p>{/if}
  </form>
  <p class="muted" style="margin-top:12px;font-size:12.5px">
    No account? <a href="/account/signup">Create one</a>. You can also browse and upload without one.
  </p>
</section>
