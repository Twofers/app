// Admin alert email sent when a new business application lands from the public
// website form (submit-business-application).
//
// Best-effort by contract: this NEVER throws and NEVER blocks the application
// insert. It returns a short warning string on failure (caller only logs it —
// the public endpoint response must not change shape) or null on success/skip.
//
// Secrets discipline: the RESEND_API_KEY is never logged or returned, and the
// Resend response body is never echoed (status code only).

export type NewApplicationAlert = {
  applicationId: string;
  businessName: string;
  contactName: string;
  email: string;
  phone: string | null;
  address: string | null;
  businessType: string | null;
  status: string;
  accessTier: string;
  verificationStatus: string;
  riskScore: number;
  source: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RESEND_ENDPOINT = "https://api.resend.com/emails";
const FROM_ADDRESS = "Twofer <support@twoferapp.com>";
const DEFAULT_ALERT_INBOX = "support@twoferapp.com";

function siteBaseUrl(): string {
  return (Deno.env.get("SITE_URL") ?? "https://www.twoferapp.com").replace(/\/$/, "");
}

function alertInbox(): string {
  const configured = (Deno.env.get("ADMIN_ALERT_EMAIL") ?? "").trim().toLowerCase();
  return EMAIL_RE.test(configured) ? configured : DEFAULT_ALERT_INBOX;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function orDash(value: string | null): string {
  const trimmed = (value ?? "").trim();
  return trimmed || "—";
}

function buildEmail(alert: NewApplicationAlert): { subject: string; html: string; text: string } {
  const businessName = alert.businessName.trim() || "New business";
  const adminUrl = `${siteBaseUrl()}/admin`;
  const subject = `New business application (${alert.status}) — ${businessName}`;

  const rows: Array<[string, string]> = [
    ["Business", businessName],
    ["Contact", orDash(alert.contactName)],
    ["Email", orDash(alert.email)],
    ["Phone", orDash(alert.phone)],
    ["Address", orDash(alert.address)],
    ["Type", orDash(alert.businessType)],
    ["Status", alert.status],
    ["Access tier", alert.accessTier],
    ["Verification", alert.verificationStatus],
    ["Risk score", String(alert.riskScore)],
    ["Source", alert.source],
  ];

  const text = [
    `A new business application was submitted.`,
    ``,
    ...rows.map(([label, value]) => `${label}: ${value}`),
    ``,
    `Review it in the admin dashboard:`,
    adminUrl,
  ].join("\n");

  const htmlRows = rows
    .map(
      ([label, value]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#5f625b;font-size:14px;vertical-align:top;">${escapeHtml(label)}</td><td style="padding:4px 0;font-size:14px;font-weight:600;">${escapeHtml(value)}</td></tr>`,
    )
    .join("");

  const html = `<!doctype html>
<html>
  <body style="margin:0;padding:0;background:#f6f7f4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1c1d1a;">
    <div style="max-width:520px;margin:0 auto;padding:24px;">
      <p style="font-size:16px;line-height:1.5;margin:0 0 16px;">A new business application was submitted.</p>
      <table style="border-collapse:collapse;margin:0 0 20px;">${htmlRows}</table>
      <p style="margin:0 0 20px;">
        <a href="${escapeHtml(adminUrl)}" style="display:inline-block;background:#e8590c;color:#ffffff;text-decoration:none;font-size:16px;font-weight:600;padding:12px 20px;border-radius:8px;">Open admin dashboard</a>
      </p>
    </div>
  </body>
</html>`;

  return { subject, html, text };
}

/**
 * Send the new-application alert to the admin inbox. Returns null on success or
 * when skipped (no API key); returns a short warning string on any recoverable
 * failure. Never throws.
 */
export async function sendNewApplicationAdminAlert(alert: NewApplicationAlert): Promise<string | null> {
  const WARN = "Application saved, but the admin alert email could not be sent.";

  try {
    const resendApiKey = Deno.env.get("RESEND_API_KEY");
    if (!resendApiKey) {
      console.error("[admin-alert-email] RESEND_API_KEY is not configured; skipping send.");
      return WARN;
    }

    const email = buildEmail(alert);
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_ADDRESS,
        to: [alertInbox()],
        subject: email.subject,
        html: email.html,
        text: email.text,
      }),
    });

    if (!response.ok) {
      // Never echo the provider response body; only the status code is safe.
      console.error(`[admin-alert-email] Resend send failed with status ${response.status}`);
      return WARN;
    }

    return null;
  } catch (error) {
    console.error("[admin-alert-email] unexpected error:", error instanceof Error ? error.message : String(error));
    return WARN;
  }
}
