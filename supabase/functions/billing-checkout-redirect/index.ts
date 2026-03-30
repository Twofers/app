import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve((req) => {
  const url = new URL(req.url);
  const checkoutRaw = url.searchParams.get("checkout")?.trim().toLowerCase() ?? "";
  const checkout = checkoutRaw === "success" || checkoutRaw === "cancel" ? checkoutRaw : null;

  // Stripe requires HTTP(S) success/cancel URLs, but we ultimately want to return into the app.
  // Use canonical path-style deep links for stronger cross-platform parsing.
  // Expected app route: /(tabs)/billing with checkout query.
  const target =
    checkout !== null
      ? `twoforone:///billing?checkout=${encodeURIComponent(checkout)}`
      : "twoforone:///billing";

  const fallbackMessage =
    checkout === "success"
      ? "Payment completed. If the app does not open automatically, open TWOFER and refresh Billing."
      : "Checkout canceled. If the app does not open automatically, open TWOFER and check Billing.";

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>TWOFER Billing Redirect</title>
  </head>
  <body style="font-family: -apple-system, Segoe UI, Roboto, sans-serif; padding: 24px; color: #11181c;">
    <h2 style="margin:0 0 12px;">Returning to TWOFER…</h2>
    <p style="margin:0 0 12px;">${fallbackMessage}</p>
    <p style="margin:0 0 12px;">
      <a href="${target}" style="color:#FF9F1C;font-weight:700;">Open TWOFER</a>
    </p>
    <script>
      window.location.replace(${JSON.stringify(target)});
      setTimeout(function () {
        window.location.href = ${JSON.stringify(target)};
      }, 900);
    </script>
  </body>
</html>`;

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
});

