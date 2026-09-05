<script>
  let { form } = $props();
  const step = $derived(form?.step === "reset" ? "reset" : "send");
</script>

<svelte:head><title>Reset password · Bluffing Valley</title></svelte:head>

<section class="card" style="max-width:420px;margin:24px auto">
  <div class="card-head"><h3>Reset password</h3></div>

  {#if step === "send"}
    <p class="muted" style="margin:0 0 12px;font-size:13px">
      Enter your account email. If it matches an account, we'll send a 6-digit code.
    </p>
    <form method="POST" action="?/send">
      <label class="field">
        <span>Email</span>
        <input name="email" type="email" autocomplete="email" required value={form?.email ?? ""} />
      </label>
      <button class="btn" type="submit">Send code</button>
      {#if form?.error}<p class="form-error">{form.error}</p>{/if}
    </form>
  {:else}
    <p class="muted" style="margin:0 0 12px;font-size:13px">
      If <strong>{form?.email}</strong> has an account, a code is on its way. It expires in 10 minutes.
    </p>
    <form method="POST" action="?/reset">
      <input type="hidden" name="email" value={form?.email ?? ""} />
      <label class="field">
        <span>Code</span>
        <input name="code" inputmode="numeric" pattern="[0-9]{6}" maxlength="6" autocomplete="one-time-code" required />
      </label>
      <label class="field">
        <span>New password</span>
        <input name="password" type="password" autocomplete="new-password" minlength="8" required />
      </label>
      <label class="field">
        <span>Confirm new password</span>
        <input name="confirm" type="password" autocomplete="new-password" minlength="8" required />
      </label>
      <button class="btn" type="submit">Set new password</button>
      {#if form?.error}<p class="form-error">{form.error}</p>{/if}
    </form>
    <form method="POST" action="?/send" style="margin-top:10px">
      <input type="hidden" name="email" value={form?.email ?? ""} />
      <button class="btn btn-secondary" type="submit">Resend code</button>
    </form>
  {/if}

  <p class="muted" style="margin-top:12px;font-size:12.5px">
    Remembered it? <a href="/account/login">Sign in</a>.
  </p>
</section>
