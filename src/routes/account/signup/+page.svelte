<script>
  import { enhance } from "$app/forms";
  import { SITE_NAME } from "$lib/config.js";

  let { form } = $props();
  let creating = $state(false);
</script>

<section class="card" style="max-width:440px;margin:24px auto">
  <div class="card-head"><h3>Create your {SITE_NAME} account</h3></div>

  <form
    method="POST"
    use:enhance={() => {
      creating = true;
      return async ({ update }) => {
        await update({ reset: false });
        creating = false;
      };
    }}
  >
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

    <button class="btn" type="submit" disabled={creating}>
      {creating ? "Creating..." : "Create account"}
    </button>

    {#if form?.error}
      <p class="form-error">{form.error}</p>
    {/if}
  </form>

  <p class="muted" style="margin-top:12px;font-size:12.5px">
    New accounts start with free chips. Already have one?
    <a href="/account/login">Sign in</a>.
  </p>
</section>
