// Outbound mail via Gmail SMTP (nodemailer + smtps://smtp.gmail.com:465).
//
// Why Gmail SMTP and not Aliyun DirectMail / a self-hosted Postfix /
// some other transactional-mail vendor:
//   * It's the user's own account, no third-party mail vendor in the
//     trust chain. The credential (an app-scoped password) only grants
//     SMTP/IMAP for Mail; it cannot read the inbox, change account
//     settings, or pivot to other Google services. Revocable in
//     seconds at https://myaccount.google.com/apppasswords.
//   * No DNS work. Aliyun DirectMail would need SPF/DKIM records and
//     domain verification at Cloudflare; Gmail signs every message
//     with its own DKIM and inherits Google's IP reputation, so
//     Gmail-to-Gmail and Gmail-to-Outlook deliveries land in the
//     inbox without warmup.
//   * Cloud egress port 25 is blocked by default on Aliyun ECS, so
//     a self-hosted Postfix can't even open a TCP connection to the
//     destination MX. Gmail SMTP uses port 465 (SMTPS / implicit
//     TLS) which is open.
//
// Constraint: the From: header is forced to the GMAIL_USER address
// (Gmail rewrites mismatched froms). We can set a friendly display
// name via GMAIL_FROM_NAME, but the @gmail.com part is locked to
// the SMTP user.
//
// Configuration (env-driven):
//   GMAIL_USER             – full address (e.g. zhufengyuejohn@gmail.com)
//   GMAIL_APP_PASSWORD     – 16-char app password generated at the
//                            URL above. Spaces are accepted (we strip
//                            them). NOT the regular Gmail password.
//   GMAIL_FROM_NAME        – display name; default "Statisticasino"
//
// If either GMAIL_USER or GMAIL_APP_PASSWORD is missing we fall
// through to a console.log stub so signup is still testable on a
// fresh deploy without leaking creds (codes go to journalctl
// instead of the inbox). The fallback is signposted in the response
// payload (`provider: "stub"`).

import nodemailer from "nodemailer";

// Lazy-initialised singleton transporter. We don't construct it at
// import time because (a) env vars may not be ready yet under
// SvelteKit's $env/dynamic/private, and (b) constructing one in stub
// mode would just be wasted work.
let _transporter = null;
let _transporterKey = "";

async function getTransporter() {
  const env = await getEnv();
  const user = (env.GMAIL_USER || "").trim();
  // App passwords are presented to users with spaces (`abcd efgh ...`)
  // for readability. nodemailer wants them without; strip whitespace
  // so either form works in `.env`.
  const pass = (env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
  if (!user || !pass) return null;

  // Re-create the transporter if creds changed (e.g. password
  // rotation followed by a hot reload). Cheap idempotency.
  const key = `${user}:${pass.length}:${pass.slice(-4)}`;
  if (_transporter && _transporterKey === key) return _transporter;

  _transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 465,
    secure: true,                 // implicit TLS (smtps://), NOT STARTTLS
    auth: { user, pass },
    // Modest connection pooling: the Singleton transporter reuses one
    // long-lived TCP connection for back-to-back code emails so we
    // don't pay TLS handshake on every signup.
    pool: true,
    maxConnections: 1,
    maxMessages: 50
  });
  _transporterKey = key;
  return _transporter;
}

/**
 * Send a transactional email.
 *
 * @param {object} args
 * @param {string} args.to       – recipient address
 * @param {string} args.subject  – plain-text subject
 * @param {string} args.text     – plain-text body (always required so
 *                                 mail clients without HTML still render)
 * @param {string} [args.html]   – optional HTML body; mail clients
 *                                 will prefer this when available.
 * @returns {Promise<{ ok: boolean, provider: "gmail" | "stub", requestId?: string, error?: string }>}
 */
export async function sendEmail({ to, subject, text, html }) {
  const env = await getEnv();
  const transporter = await getTransporter();

  if (!transporter) {
    // Stub mode: log to stdout (captured by journalctl on the prod
    // box) so the verification code is recoverable in dev / pre-Gmail
    // setup.
    console.log(
      `[email:stub] to=${to} subject=${JSON.stringify(subject)} text=${JSON.stringify(text)}`
    );
    return { ok: true, provider: "stub" };
  }

  const fromAddr = (env.GMAIL_USER || "").trim();
  const fromName = (env.GMAIL_FROM_NAME || "Statisticasino").trim();
  // Quoting the display name handles whitespace + non-ASCII; the
  // `<addr>` form is RFC-2822 compliant.
  const from = `"${fromName.replace(/"/g, "")}" <${fromAddr}>`;

  try {
    const info = await transporter.sendMail({
      from,
      to,
      subject,
      text,
      html
    });
    return { ok: true, provider: "gmail", requestId: info.messageId };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    console.error(`[email:gmail] send failed: ${message}`);
    return { ok: false, provider: "gmail", error: message };
  }
}

// ----------------------------------------------------------- internals

async function getEnv() {
  try {
    const mod = await import("$env/dynamic/private");
    return mod.env;
  } catch {
    return process.env;
  }
}
