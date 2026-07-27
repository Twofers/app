// Approval email sent after an admin approves a business for setup.
//
// Best-effort by contract: this NEVER throws and NEVER blocks the approval
// write. It returns a human-readable warning string on failure (surfaced on the
// admin dashboard exactly like billing_sync_warning) or null on success/skip.
//
// Initial sends are idempotent: they skip if the application already has
// approval_email_sent_at, so the two approval entry points and admin re-decides
// can't double-send. An explicit authenticated admin resend may bypass that
// guard; it rotates the token and restores the previous token if delivery fails.
//
// Secrets/PII discipline: the RESEND_API_KEY and the raw checkout token are
// never logged, never returned, and never written to audit rows. Only the
// sha256 of the token is stored (checkout_token_hash).

export type ApprovalEmailDecision =
  | "approve_setup"
  | "approve_limited"
  | "approve_setup_verified"
  | "approve_full_access";

/** approve_full_access grants working access up front; the rest wait for Checkout. */
function grantsAccessImmediately(decision: ApprovalEmailDecision): boolean {
  return decision === "approve_full_access";
}

// Fields are declared as unknown because callers pass raw Supabase rows (a
// SELECT list or an insert-returning row) whose columns are loosely typed. The
// module coerces every field defensively below, so this stays permissive.
export type ApprovalEmailApplication = {
  id?: unknown;
  business_name?: unknown;
  contact_name?: unknown;
  email?: unknown;
  trial_days?: unknown;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const FROM_ADDRESS = "Twofer <support@twoferapp.com>";
const CHECKOUT_TOKEN_TTL_DAYS = 30;

// Standard approved activation is a 30-day Stripe trial. Approval itself does
// not start the trial, grant credits, or unlock publishing. approve_full_access
// overrides this with the admin's day count, carried on application.trial_days.
function decisionDefaults(_decision: ApprovalEmailDecision): { trialDays: number } {
  return { trialDays: 30 };
}

function positiveIntOr(value: unknown, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

function siteBaseUrl(): string {
  return (Deno.env.get("SITE_URL") ?? "https://www.twoferapp.com").replace(/\/$/, "");
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function randomToken(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEmail(params: {
  businessName: string;
  contactName: string;
  ownerEmail: string;
  trialDays: number;
  checkoutUrl: string;
  accessLive: boolean;
}): { subject: string; html: string; text: string } {
  const { businessName, contactName, ownerEmail, trialDays, checkoutUrl, accessLive } = params;
  if (accessLive) {
    return buildFullAccessEmail(params);
  }
  const greetingName = contactName || "there";
  const named = businessName || "Your business";
  const subject = "You're approved - activate your Twofer trial";
  const bilingualFooter = "Prefieres espanol? / hangugeo doumi piryohaseyo? support@twoferapp.com";

  const text = [
    `Hi ${greetingName},`,
    "",
    `${named} is approved for Twofer setup. Your ${trialDays}-day business trial starts after you activate it through secure Checkout.`,
    "",
    "Before activation you can sign in, finish your business profile, prepare menu details, and draft your first offer.",
    "AI image generation, publishing, customer claims, and offer credits unlock only after activation is confirmed.",
    "",
    "How to get started:",
    "1. Download Twofer from the App Store or Google Play.",
    `2. Sign up as a Business using this email address: ${ownerEmail}. That is how your approved setup attaches to your account.`,
    `3. Finish setup, then activate your ${trialDays}-day trial:`,
    "",
    checkoutUrl,
    "(If you have not set up your app account yet, do that first, then open this link again.)",
    "",
    "Questions? Email support@twoferapp.com.",
    "",
    "- Twofer",
    "",
    bilingualFooter,
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f7f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1d1a;">
    <div style="max-width:520px;margin:0 auto;padding:24px;">
      <p style="font-size:16px;line-height:1.5;margin:0 0 16px;">Hi ${escapeHtml(greetingName)},</p>
      <p style="font-size:16px;line-height:1.5;margin:0 0 16px;">
        <strong>${escapeHtml(named)}</strong> is approved for Twofer setup. Your ${trialDays}-day business trial starts after you activate it through secure Checkout.
      </p>
      <p style="font-size:15px;line-height:1.5;margin:0 0 16px;">
        Before activation you can sign in, finish your business profile, prepare menu details, and draft your first offer. AI image generation, publishing, customer claims, and offer credits unlock only after activation is confirmed.
      </p>
      <p style="font-size:15px;line-height:1.5;margin:0 0 8px;">How to get started:</p>
      <ol style="font-size:15px;line-height:1.6;margin:0 0 20px;padding-left:20px;">
        <li>Download Twofer from the App Store or Google Play.</li>
        <li>Sign up as a Business using this email address: <strong>${escapeHtml(ownerEmail)}</strong>. That is how your approved setup attaches to your account.</li>
        <li>Finish setup, then activate your ${trialDays}-day trial.</li>
      </ol>
      <p style="margin:0 0 20px;">
        <a href="${escapeHtml(checkoutUrl)}" style="display:inline-block;background:#e8590c;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:12px 20px;border-radius:8px;">Activate your ${trialDays}-day trial</a>
      </p>
      <p style="font-size:13px;line-height:1.5;color:#5f625b;margin:0 0 20px;">
        If you have not set up your app account yet, do that first, then open this link again.
      </p>
      <p style="font-size:14px;line-height:1.5;margin:0 0 16px;">Questions? Email <a href="mailto:support@twoferapp.com" style="color:#e8590c;">support@twoferapp.com</a>.</p>
      <p style="font-size:14px;line-height:1.5;margin:0 0 16px;">- Twofer</p>
      <p style="font-size:12px;line-height:1.5;color:#8a8d85;margin:24px 0 0;border-top:1px solid #e3e4df;padding-top:16px;">${escapeHtml(bilingualFooter)}</p>
    </div>
  </body>
</html>`;

  return { subject, html, text };
}

/**
 * approve_full_access variant: access is already on, so the copy leads with
 * that and the countdown. The Checkout link still ships — an admin-granted
 * trial is meant to convert to paid, it just does not gate access on payment.
 */
function buildFullAccessEmail(params: {
  businessName: string;
  contactName: string;
  ownerEmail: string;
  trialDays: number;
  checkoutUrl: string;
}): { subject: string; html: string; text: string } {
  const { businessName, contactName, ownerEmail, trialDays, checkoutUrl } = params;
  const greetingName = contactName || "there";
  const named = businessName || "Your business";
  const subject = `You're approved - ${trialDays} days of full access`;
  const bilingualFooter = "Prefieres espanol? / hangugeo doumi piryohaseyo? support@twoferapp.com";

  const text = [
    `Hi ${greetingName},`,
    "",
    `${named} is approved, and your ${trialDays} days of full access are live now. No payment needed to start.`,
    "",
    "How to get started:",
    "1. Download Twofer from the App Store or Google Play.",
    `2. Sign up as a Business using this email address: ${ownerEmail}. That is how your access attaches to your account.`,
    "3. Build your first offer and publish it.",
    "",
    `To keep going after ${trialDays} days, add payment any time:`,
    "",
    checkoutUrl,
    "",
    "Questions? Email support@twoferapp.com.",
    "",
    "- Twofer",
    "",
    bilingualFooter,
  ].join("\n");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f7f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1d1a;">
    <div style="max-width:520px;margin:0 auto;padding:24px;">
      <p style="font-size:16px;line-height:1.5;margin:0 0 16px;">Hi ${escapeHtml(greetingName)},</p>
      <p style="font-size:16px;line-height:1.5;margin:0 0 16px;">
        <strong>${escapeHtml(named)}</strong> is approved, and your ${trialDays} days of full access are live now. No payment needed to start.
      </p>
      <p style="font-size:15px;line-height:1.5;margin:0 0 8px;">How to get started:</p>
      <ol style="font-size:15px;line-height:1.6;margin:0 0 20px;padding-left:20px;">
        <li>Download Twofer from the App Store or Google Play.</li>
        <li>Sign up as a Business using this email address: <strong>${escapeHtml(ownerEmail)}</strong>. That is how your access attaches to your account.</li>
        <li>Build your first offer and publish it.</li>
      </ol>
      <p style="font-size:15px;line-height:1.5;margin:0 0 12px;">To keep going after ${trialDays} days, add payment any time:</p>
      <p style="margin:0 0 20px;">
        <a href="${escapeHtml(checkoutUrl)}" style="display:inline-block;background:#e8590c;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:12px 20px;border-radius:8px;">Add payment</a>
      </p>
      <p style="font-size:14px;line-height:1.5;margin:0 0 16px;">Questions? Email <a href="mailto:support@twoferapp.com" style="color:#e8590c;">support@twoferapp.com</a>.</p>
      <p style="font-size:14px;line-height:1.5;margin:0 0 16px;">- Twofer</p>
      <p style="font-size:12px;line-height:1.5;color:#8a8d85;margin:24px 0 0;border-top:1px solid #e3e4df;padding-top:16px;">${escapeHtml(bilingualFooter)}</p>
    </div>
  </body>
</html>`;

  return { subject, html, text };
}

async function insertAudit(
  supabaseAdmin: any,
  action: string,
  applicationId: string,
  requestId: string,
  reason: string,
  actor?: { id?: string | null; email?: string | null },
): Promise<void> {
  try {
    await supabaseAdmin.from("admin_audit_log").insert({
      admin_user_id: actor?.id ?? null,
      admin_email: actor?.email ?? null,
      action,
      target_type: "business_application",
      target_id: applicationId,
      reason,
      request_id: requestId,
    });
  } catch (auditError) {
    console.error("[approval-email] audit insert failed:", auditError instanceof Error ? auditError.message : String(auditError));
  }
}

/**
 * Send the setup-approved email. Returns null on success or when skipped
 * (already sent / not an approval); returns a short warning string on any
 * recoverable failure. Never throws.
 */
export async function sendApprovalEmail(params: {
  supabaseAdmin: any;
  application: ApprovalEmailApplication;
  decision: ApprovalEmailDecision;
  requestId: string;
  allowResend?: boolean;
  adminUserId?: string | null;
  adminEmail?: string | null;
}): Promise<string | null> {
  const { supabaseAdmin, application, decision, requestId } = params;
  const WARN = "Application approved, but the setup email could not be sent. Resend it or check the owner's address.";
  const isResend = params.allowResend === true;
  const actor = { id: params.adminUserId ?? null, email: params.adminEmail ?? null };
  let currentTokenHash: string | null = null;
  let currentTokenExpiresAt: string | null = null;
  let rotatedTokenHash: string | null = null;
  let providerAccepted = false;

  async function restorePreviousToken(): Promise<boolean> {
    if (!isResend || !rotatedTokenHash) return true;
    const { data, error } = await supabaseAdmin
      .from("business_applications")
      .update({
        checkout_token_hash: currentTokenHash,
        checkout_token_expires_at: currentTokenExpiresAt,
      })
      .eq("id", typeof application.id === "string" ? application.id : "")
      .eq("checkout_token_hash", rotatedTokenHash)
      .select("id")
      .maybeSingle();
    if (error || !data) {
      console.error("[approval-email] failed to restore the previous billing token after resend failure.");
      return false;
    }
    rotatedTokenHash = null;
    return true;
  }

  try {
    const applicationId = typeof application.id === "string" ? application.id : "";
    if (!applicationId) return WARN;

    // Idempotency: read the authoritative flag fresh so we don't depend on the
    // caller's SELECT list and can't double-send across the two approval paths.
    const { data: current, error: currentError } = await supabaseAdmin
      .from("business_applications")
      .select("approval_email_sent_at,checkout_token_hash,checkout_token_expires_at")
      .eq("id", applicationId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (current?.approval_email_sent_at && !isResend) return null;
    currentTokenHash = typeof current?.checkout_token_hash === "string"
      ? current.checkout_token_hash
      : null;
    currentTokenExpiresAt = typeof current?.checkout_token_expires_at === "string"
      ? current.checkout_token_expires_at
      : null;

    const ownerEmail = typeof application.email === "string" ? application.email.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(ownerEmail)) {
      await insertAudit(
        supabaseAdmin,
        isResend
          ? "admin_business_application_billing_link_resend_failed"
          : "admin_business_application_approval_email_failed",
        applicationId,
        requestId,
        "missing_or_invalid_owner_email",
        actor,
      );
      return "Application approved, but no valid owner email was on file to send the setup email.";
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("[approval-email] RESEND_API_KEY is not configured; skipping send.");
      await insertAudit(
        supabaseAdmin,
        isResend
          ? "admin_business_application_billing_link_resend_failed"
          : "admin_business_application_approval_email_failed",
        applicationId,
        requestId,
        "resend_api_key_missing",
        actor,
      );
      return WARN;
    }

    const defaults = decisionDefaults(decision);
    const trialDays = positiveIntOr(application.trial_days, defaults.trialDays);

    // Persist the checkout token (hash only) BEFORE sending; the raw token lives
    // only in the email body and is resolved by the business-checkout-link fn.
    const rawToken = randomToken();
    const tokenHash = await sha256Hex(rawToken);
    const expiresAt = new Date(Date.now() + CHECKOUT_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const tokenUpdate = supabaseAdmin
      .from("business_applications")
      .update({ checkout_token_hash: tokenHash, checkout_token_expires_at: expiresAt })
      .eq("id", applicationId);
    const guardedTokenUpdate = isResend
      ? currentTokenHash
        ? tokenUpdate.eq("checkout_token_hash", currentTokenHash)
        : tokenUpdate.is("checkout_token_hash", null)
      : tokenUpdate;
    const { data: tokenRow, error: tokenError } = await guardedTokenUpdate
      .select("id")
      .maybeSingle();
    if (tokenError) throw tokenError;
    if (!tokenRow) {
      return "The billing link changed before this email could be sent. Refresh the queue and try again.";
    }
    rotatedTokenHash = tokenHash;

    const checkoutUrl = `${siteBaseUrl()}/business/billing/checkout/${rawToken}`;
    const email = buildEmail({
      businessName: typeof application.business_name === "string" ? application.business_name : "",
      contactName: typeof application.contact_name === "string" ? application.contact_name : "",
      ownerEmail,
      trialDays,
      checkoutUrl,
      accessLive: grantsAccessImmediately(decision),
    });

    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [ownerEmail],
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    });

    if (!response.ok) {
      // Never echo the provider response body (may carry request context); only
      // the status code is safe to log.
      console.error(`[approval-email] Resend send failed with status ${response.status}`);
      const restored = await restorePreviousToken();
      await insertAudit(
        supabaseAdmin,
        isResend
          ? "admin_business_application_billing_link_resend_failed"
          : "admin_business_application_approval_email_failed",
        applicationId,
        requestId,
        `resend_status_${response.status}`,
        actor,
      );
      return restored
        ? WARN
        : "The email was not sent, and the previous billing link could not be restored. Refresh the queue and send a new link.";
    }
    providerAccepted = true;

    const { error: sentError } = await supabaseAdmin
      .from("business_applications")
      .update({ approval_email_sent_at: new Date().toISOString(), approval_email_decision: decision })
      .eq("id", applicationId);
    if (sentError) throw sentError;

    await insertAudit(
      supabaseAdmin,
      isResend
        ? "admin_business_application_billing_link_resent"
        : "admin_business_application_approval_email_sent",
      applicationId,
      requestId,
      decision,
      actor,
    );
    return null;
  } catch (error) {
    const restored = providerAccepted ? true : await restorePreviousToken();
    console.error("[approval-email] unexpected error:", error instanceof Error ? error.message : String(error));
    return restored
      ? WARN
      : "The email was not sent, and the previous billing link could not be restored. Refresh the queue and send a new link.";
  }
}
