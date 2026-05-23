<script>
  import { enhance } from "$app/forms";

  let { form } = $props();

  // Server-side flags surfaced via the action's return value.
  let codeSent = $derived(form?.codeSent === true);
  let stubbed = $derived(form?.stubbed === true);

  // In-flight indicators — we look at the submitting <button>'s
  // formAction so the same handler can serve both submit paths.
  let sending = $state(false);
  let creating = $state(false);
</script>

<section class="card" style="max-width:440px;margin:24px auto">
  <div class="card-head"><h3>Create account</h3></div>

  <form
    method="POST"
    action="?/create"
    use:enhance={({ action }) => {
      const isSendCode = action.search === "?/sendCode";
      if (isSendCode) sending = true;
      else creating = true;
      return async ({ update }) => {
        // reset:false so the user's typed-but-not-yet-submitted fields
        // (display name, password) survive a "Send code" round trip.
        await update({ reset: false });
        sending = false;
        creating = false;
      };
    }}
  >
    <label class="field">
      <span>Display name (optional)</span>
      <input
        name="displayName"
        type="text"
        autocomplete="name"
        value={form?.displayName ?? ""}
      />
    </label>

    <label class="field">
      <span>Email</span>
      <input
        name="email"
        type="email"
        autocomplete="email"
        required
        value={form?.email ?? ""}
      />
    </label>

    <label class="field">
      <span>Password (min 8 characters)</span>
      <input
        name="password"
        type="password"
        autocomplete="new-password"
        minlength="8"
        required
      />
    </label>

    <label class="field">
      <span>Verification code</span>
      <div style="display:flex;gap:8px;align-items:stretch">
        <input
          name="verificationCode"
          inputmode="numeric"
          autocomplete="one-time-code"
          maxlength="6"
          minlength="6"
          pattern={"\\d{6}"}
          placeholder="6-digit code"
          required
          style="flex:1"
        />
        <!--
          formaction targets ?/sendCode for THIS button only, so the
          rest of the form fields can stay invalid (no password yet
          etc.). formnovalidate skips browser-side `required` checks
          on the password / code fields when the user just wants a
          code emailed.
        -->
        <button
          class="btn ghost"
          type="submit"
          formaction="?/sendCode"
          formnovalidate
          disabled={sending}
        >{sending ? "Sending..." : "Send code"}</button>
      </div>
    </label>

    {#if codeSent}
      <p class="form-info">{form?.message}</p>
    {/if}
    {#if stubbed}
      <p class="muted" style="font-size:12px;margin-top:-6px">
        (Email provider not configured — code is in the server log.)
      </p>
    {/if}

    <button
      class="btn"
      type="submit"
      disabled={creating}
    >{creating ? "Creating..." : "Create account"}</button>

    {#if form?.error}
      <p class="form-error">{form.error}</p>
    {/if}
  </form>

  <p class="muted" style="margin-top:12px;font-size:12.5px">
    Already have one? <a href="/account/login">Sign in</a>.
  </p>
</section>

<style>
  .form-info {
    color: var(--ok, #2e7d32);
    font-size: 13px;
    margin: 4px 0 10px;
  }
</style>
