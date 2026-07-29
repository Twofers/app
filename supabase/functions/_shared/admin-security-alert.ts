type AdminSecurityAlert = {
  event: string;
  adminEmail?: string | null;
  targetId?: string | null;
  requestId: string;
  occurredAt?: string;
};

function clean(value: unknown, max = 300): string {
  return typeof value === "string"
    ? value.replace(/[\r\n\t]+/g, " ").trim().slice(0, max)
    : "";
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export async function sendAdminSecurityAlert(alert: AdminSecurityAlert): Promise<string | null> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const destination = clean(Deno.env.get("ADMIN_SECURITY_ALERT_EMAIL"), 254).toLowerCase();
  if (!apiKey || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(destination)) {
    return "Admin security alert destination is not configured.";
  }

  const event = clean(alert.event, 100) || "admin_security_event";
  const occurredAt = clean(alert.occurredAt, 80) || new Date().toISOString();
  const adminEmail = clean(alert.adminEmail, 254) || "(not provided)";
  const targetId = clean(alert.targetId, 100) || "(none)";
  const requestId = clean(alert.requestId, 100);

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Twofer Security <support@twoferapp.com>",
        to: [destination],
        subject: `Twofer admin security event: ${event}`,
        text: [
          `Event: ${event}`,
          `Admin: ${adminEmail}`,
          `Target: ${targetId}`,
          `Time: ${occurredAt}`,
          `Request ID: ${requestId}`,
          "",
          "If you did not perform this action, revoke sessions and provider credentials immediately.",
        ].join("\n"),
        html: `<h1>Twofer admin security event</h1>
          <p><strong>Event:</strong> ${escapeHtml(event)}</p>
          <p><strong>Admin:</strong> ${escapeHtml(adminEmail)}</p>
          <p><strong>Target:</strong> ${escapeHtml(targetId)}</p>
          <p><strong>Time:</strong> ${escapeHtml(occurredAt)}</p>
          <p><strong>Request ID:</strong> ${escapeHtml(requestId)}</p>
          <p>If you did not perform this action, revoke sessions and provider credentials immediately.</p>`,
      }),
    });
    if (!response.ok) {
      console.error(`[admin-security-alert] Resend failed with status ${response.status}`);
      return "Admin security alert could not be sent.";
    }
    return null;
  } catch (error) {
    console.error("[admin-security-alert] send failed:", error instanceof Error ? error.message : String(error));
    return "Admin security alert could not be sent.";
  }
}
