import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

serve((req) => {
  const url = new URL(req.url);
  const checkoutRaw = url.searchParams.get("checkout")?.trim().toLowerCase() ?? "";
  const checkout = checkoutRaw === "success" || checkoutRaw === "cancel" ? checkoutRaw : "success";
  const siteUrl = (Deno.env.get("SITE_URL") ?? "https://www.twoferapp.com").replace(/\/$/, "");
  const nextPath = checkout === "success" ? "/business/billing/success/" : "/business/billing/cancel/";
  const nextUrl = `${siteUrl}${nextPath}`;
  const title = checkout === "success" ? "Billing confirmed" : "Billing canceled";
  const body = checkout === "success"
    ? "Your Twofer business billing flow is complete. Stripe will securely confirm the subscription status before app access changes."
    : "The Twofer business billing flow was canceled. No payment changes were made.";

  return new Response(
    `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="refresh" content="0;url=${escapeHtml(nextUrl)}" />
    <title>${escapeHtml(title)} | Twofer</title>
  </head>
  <body>
    <main style="font-family: system-ui, sans-serif; max-width: 680px; margin: 12vh auto; padding: 24px;">
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(body)}</p>
      <p><a href="${escapeHtml(nextUrl)}">Continue</a></p>
    </main>
  </body>
</html>`,
    { headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
});
