// Approval email sent after an admin approves a business for setup.
//
// Best-effort by contract: this NEVER throws and NEVER blocks the approval
// write. It returns a human-readable warning string on failure (surfaced on the
// admin dashboard exactly like billing_sync_warning) or null on success/skip.
//
// Idempotent: skips if the application already has approval_email_sent_at, so
// the two approval entry points (admin-business-applications and
// admin-trial-create-from-prospect) and admin re-decides can't double-send.
//
// Secrets/PII discipline: the RESEND_API_KEY and the raw checkout token are
// never logged, never returned, and never written to audit rows. Only the
// sha256 of the token is stored (checkout_token_hash).

export type ApprovalEmailDecision = "approve_setup" | "approve_limited" | "approve_full";

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
// not start the trial, grant credits, or unlock publishing.
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
}): { subject: string; html: string; text: string } {
  const { businessName, contactName, ownerEmail, trialDays, checkoutUrl } = params;
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

async function insertAudit(
  supabaseAdmin: any,
  action: string,
  applicationId: string,
  requestId: string,
  reason: string,
): Promise<void> {
  try {
    await supabaseAdmin.from("admin_audit_log").insert({
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
}): Promise<string | null> {
  const { supabaseAdmin, application, decision, requestId } = params;
  const WARN = "Application approved, but the setup email could not be sent. Resend it or check the owner's address.";

  try {
    const applicationId = typeof application.id === "string" ? application.id : "";
    if (!applicationId) return WARN;

    // Idempotency: read the authoritative flag fresh so we don't depend on the
    // caller's SELECT list and can't double-send across the two approval paths.
    const { data: current, error: currentError } = await supabaseAdmin
      .from("business_applications")
      .select("approval_email_sent_at")
      .eq("id", applicationId)
      .maybeSingle();
    if (currentError) throw currentError;
    if (current?.approval_email_sent_at) return null;

    const ownerEmail = typeof application.email === "string" ? application.email.trim().toLowerCase() : "";
    if (!EMAIL_RE.test(ownerEmail)) {
      await insertAudit(supabaseAdmin, "admin_business_application_approval_email_failed", applicationId, requestId, "missing_or_invalid_owner_email");
      return "Application approved, but no valid owner email was on file to send the setup email.";
    }

    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("[approval-email] RESEND_API_KEY is not configured; skipping send.");
      await insertAudit(supabaseAdmin, "admin_business_application_approval_email_failed", applicationId, requestId, "resend_api_key_missing");
      return WARN;
    }

    const defaults = decisionDefaults(decision);
    const trialDays = positiveIntOr(application.trial_days, defaults.trialDays);

    // Persist the checkout token (hash only) BEFORE sending; the raw token lives
    // only in the email body and is resolved by the business-checkout-link fn.
    const rawToken = randomToken();
    const tokenHash = await sha256Hex(rawToken);
    const expiresAt = new Date(Date.now() + CHECKOUT_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000).toISOString();
    const { error: tokenError } = await supabaseAdmin
      .from("business_applications")
      .update({ checkout_token_hash: tokenHash, checkout_token_expires_at: expiresAt })
      .eq("id", applicationId);
    if (tokenError) throw tokenError;

    const checkoutUrl = `${siteBaseUrl()}/business/billing/checkout/${rawToken}`;
    const email = buildEmail({
      businessName: typeof application.business_name === "string" ? application.business_name : "",
      contactName: typeof application.contact_name === "string" ? application.contact_name : "",
      ownerEmail,
      trialDays,
      checkoutUrl,
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
      await insertAudit(supabaseAdmin, "admin_business_application_approval_email_failed", applicationId, requestId, `resend_status_${response.status}`);
      return WARN;
    }

    const { error: sentError } = await supabaseAdmin
      .from("business_applications")
      .update({ approval_email_sent_at: new Date().toISOString(), approval_email_decision: decision })
      .eq("id", applicationId);
    if (sentError) throw sentError;

    await insertAudit(supabaseAdmin, "admin_business_application_approval_email_sent", applicationId, requestId, decision);
    return null;
  } catch (error) {
    console.error("[approval-email] unexpected error:", error instanceof Error ? error.message : String(error));
    return WARN;
  }
}
