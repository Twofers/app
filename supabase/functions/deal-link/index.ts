import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Swap these when the app is published to stores.
const FALLBACK_BASE = "https://www.twoferapp.com/deal";
const WEBSITE_HOME = "https://www.twoferapp.com";
// const PLAY_STORE = "https://play.google.com/store/apps/details?id=com.unvmex2.twoforone";
// const APP_STORE  = "https://apps.apple.com/app/twofer/idXXXXXXXXXX";

import { getCorsHeaders } from "../_shared/cors.ts";
import {
  PUBLIC_DEAL_BASE_SELECT,
  PUBLIC_DEAL_LOCALIZED_SELECT,
  buildPublicDealDisplay,
  isMissingPublicDealLocalizationColumn,
  localeCopy,
  localeHtmlLang,
  resolveViewerLocaleFromRequest,
  type PublicDealRow,
} from "../_shared/viewer-locale.ts";
import type { SupportedLocale } from "../../../lib/supported-locales.ts";

const SCHEME_PREFIX = "twoforone://deal/";
const BRAND_COLOR = "#FF9F1C";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlResponse(html: string, corsHeaders: Record<string, string>, status = 200) {
  return new Response(html, {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

type LandingPageArgs = {
  dealId: string | null;
  dealTitle: string;
  businessName: string;
  fallbackUrl: string;
  canOpenApp: boolean;
  locale: SupportedLocale;
};

function buildLandingPage({
  dealId,
  dealTitle,
  businessName,
  fallbackUrl,
  canOpenApp,
  locale,
}: LandingPageArgs): string {
  const schemeUrl = canOpenApp && dealId ? `${SCHEME_PREFIX}${dealId}` : "";
  const copy = localeCopy(locale);
  const subtitle = canOpenApp
    ? copy.landingAvailableSubtitle
    : copy.landingUnavailableSubtitle;
  const hint = canOpenApp ? copy.landingAvailableHintHtml : esc(copy.landingUnavailableHint);
  const primaryAction = canOpenApp
    ? `<a id="openApp" class="btn btn-primary" href="${esc(schemeUrl)}">
      ${esc(copy.openInApp)}
    </a>`
    : `<a class="btn btn-primary" href="${esc(fallbackUrl)}">
      ${esc(copy.visitWebsite)}
    </a>`;
  const secondaryAction = canOpenApp
    ? `<a class="btn btn-secondary" href="${esc(fallbackUrl)}">
      ${esc(copy.getApp)}
    </a>`
    : "";
  const autoOpenScript = canOpenApp
    ? `<script>
(function(){
  var scheme = ${JSON.stringify(schemeUrl)};
  var fallback = ${JSON.stringify(fallbackUrl)};
  var t = setTimeout(function(){ window.location.href = fallback; }, 1500);
  window.addEventListener("blur", function(){ clearTimeout(t); });
  try { window.location.href = scheme; } catch(e){}
})();
</script>`
    : "";

  return `<!DOCTYPE html>
<html lang="${esc(localeHtmlLang(locale))}">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${esc(copy.appName)} - ${esc(dealTitle)}</title>
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
  <div class="brand"><span>Twofer</span></div>
  <div class="body">
    <p class="biz">${esc(businessName)}</p>
    <h1 class="title">${esc(dealTitle)}</h1>
    <p class="subtitle">${esc(subtitle)}</p>

    ${primaryAction}
    ${secondaryAction}

    <p class="hint">
      ${hint}
    </p>
  </div>
  <div class="footer">
    <span>${esc(copy.poweredBy)}</span>
  </div>
</div>

${autoOpenScript}
</body>
</html>`;
}

function genericLanding(corsHeaders: Record<string, string>, locale: SupportedLocale) {
  const copy = localeCopy(locale);
  return htmlResponse(
    buildLandingPage({
      dealId: null,
      dealTitle: copy.genericDealTitle,
      businessName: copy.appName,
      fallbackUrl: WEBSITE_HOME,
      canOpenApp: false,
      locale,
    }),
    corsHeaders,
  );
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const url = new URL(req.url);
  const locale = resolveViewerLocaleFromRequest(req, url);
  const dealId = url.searchParams.get("id")?.trim();

  if (!dealId || !UUID_RE.test(dealId)) {
    return genericLanding(corsHeaders, locale);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!supabaseUrl || !anonKey) {
    return genericLanding(corsHeaders, locale);
  }
  const publicClient = createClient(supabaseUrl, anonKey);

  let data: PublicDealRow | null = null;
  try {
    const nowIso = new Date().toISOString();
    let query = await publicClient
      .from("deals")
      .select(PUBLIC_DEAL_LOCALIZED_SELECT)
      .eq("id", dealId)
      .eq("is_active", true)
      .lte("start_time", nowIso)
      .gt("end_time", nowIso)
      .maybeSingle();
    if (isMissingPublicDealLocalizationColumn(query.error)) {
      query = await publicClient
        .from("deals")
        .select(PUBLIC_DEAL_BASE_SELECT)
        .eq("id", dealId)
        .eq("is_active", true)
        .lte("start_time", nowIso)
        .gt("end_time", nowIso)
        .maybeSingle();
    }
    if (query.error) throw query.error;
    data = query.data as PublicDealRow | null;
  } catch {
    return genericLanding(corsHeaders, locale);
  }

  if (!data?.id) {
    return genericLanding(corsHeaders, locale);
  }

  const fallbackUrl = `${FALLBACK_BASE}/${encodeURIComponent(dealId)}`;
  const display = buildPublicDealDisplay(data, locale);

  return htmlResponse(
    buildLandingPage({
      dealId,
      dealTitle: display.title,
      businessName: display.businessName,
      fallbackUrl,
      canOpenApp: true,
      locale,
    }),
    corsHeaders,
  );
});
