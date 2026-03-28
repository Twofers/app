import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Swap these when the app is published to stores.
const FALLBACK_BASE = "https://www.twoferapp.com/deal";
// const PLAY_STORE = "https://play.google.com/store/apps/details?id=com.unvmex2.twoforone";
// const APP_STORE  = "https://apps.apple.com/app/twofer/idXXXXXXXXXX";

const SCHEME_PREFIX = "twoforone://deal/";
const BRAND_COLOR = "#FF9F1C";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlResponse(html: string, status = 200) {
  return new Response(html, {
    status,
    headers: { ...corsHeaders, "Content-Type": "text/html; charset=utf-8" },
  });
}

function buildLandingPage(
  dealId: string,
  dealTitle: string,
  businessName: string,
  fallbackUrl: string,
): string {
  const schemeUrl = `${SCHEME_PREFIX}${dealId}`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>TWOFER — ${esc(dealTitle)}</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  body{
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    background:#fff;display:flex;align-items:center;justify-content:center;
    min-height:100vh;padding:24px;color:#11181C;
  }
  .card{
    width:100%;max-width:420px;text-align:center;
    border:3px solid ${BRAND_COLOR};border-radius:24px;
    overflow:hidden;background:#fff;
  }
  .brand{background:${BRAND_COLOR};padding:16px;text-align:center}
  .brand span{font-size:28px;font-weight:900;color:#fff;letter-spacing:3px}
  .body{padding:32px 24px}
  .biz{font-size:13px;font-weight:700;color:#888;margin-bottom:8px}
  .title{font-size:24px;font-weight:800;line-height:1.25;margin-bottom:16px}
  .subtitle{font-size:15px;color:#555;line-height:1.5;margin-bottom:28px}
  .btn{
    display:inline-block;width:100%;padding:16px;border-radius:16px;
    font-size:17px;font-weight:800;text-decoration:none;
    cursor:pointer;margin-bottom:12px;
  }
  .btn-primary{background:${BRAND_COLOR};color:#fff}
  .btn-secondary{
    background:#fff;color:${BRAND_COLOR};
    border:2px solid ${BRAND_COLOR};
  }
  .hint{font-size:12px;color:#999;margin-top:16px;line-height:1.5}
  .footer{padding:12px 24px;border-top:1px solid #eee}
  .footer span{font-size:11px;color:#bbb;font-weight:600;letter-spacing:.5px}
</style>
</head>
<body>
<div class="card">
  <div class="brand"><span>TWOFER</span></div>
  <div class="body">
    <p class="biz">${esc(businessName)}</p>
    <h1 class="title">${esc(dealTitle)}</h1>
    <p class="subtitle">Claim this BOGO deal in seconds — open TWOFER and show it at the counter.</p>

    <a id="openApp" class="btn btn-primary" href="${esc(schemeUrl)}">
      Open in TWOFER
    </a>

    <a class="btn btn-secondary" href="${esc(fallbackUrl)}">
      Get TWOFER at twoferapp.com
    </a>

    <p class="hint">
      Don't have the app yet? Tap above to visit twoferapp.com.<br/>
      After installing, scan this code again to claim your deal!
    </p>
  </div>
  <div class="footer">
    <span>Powered by TWOFER — local deals, zero waste</span>
  </div>
</div>

<script>
(function(){
  var scheme = ${JSON.stringify(schemeUrl)};
  var fallback = ${JSON.stringify(fallbackUrl)};
  var t = setTimeout(function(){ window.location.href = fallback; }, 1500);
  window.addEventListener("blur", function(){ clearTimeout(t); });
  try { window.location.href = scheme; } catch(e){}
})();
</script>
</body>
</html>`;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const dealId = url.searchParams.get("id")?.trim();

  if (!dealId) {
    return htmlResponse(
      buildLandingPage("", "TWOFER Deals", "TWOFER", "https://www.twoferapp.com"),
      200,
    );
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  let dealTitle = "A great deal is waiting for you";
  let businessName = "";

  try {
    const { data } = await admin
      .from("deals")
      .select("title, businesses(name)")
      .eq("id", dealId)
      .single();

    if (data?.title) dealTitle = data.title;
    if ((data as any)?.businesses?.name) businessName = (data as any).businesses.name;
  } catch {
    // Graceful fallback — show generic page even if DB lookup fails.
  }

  const fallbackUrl = `${FALLBACK_BASE}/${encodeURIComponent(dealId)}`;

  return htmlResponse(buildLandingPage(dealId, dealTitle, businessName, fallbackUrl));
});
