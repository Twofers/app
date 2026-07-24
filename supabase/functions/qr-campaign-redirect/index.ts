import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { clientIpFromRequest } from "../_shared/client-ip.ts";
import {
  classifyQrDevice,
  dailyQrIpHash,
  isLikelyQrBot,
  normalizeQrSlug,
  resolveQrRedirect,
  type QrDestinationType,
} from "../_shared/qr-campaign.ts";
import { tryGetServiceRoleKey } from "../_shared/service-role-key.ts";

type ActiveCampaign = {
  id: string;
  destination_type: QrDestinationType;
};

function websiteFallback(): string {
  return Deno.env.get("SITE_URL")?.replace(/\/+$/, "") || "https://www.twoferapp.com";
}

function redirect(location: string, status = 302): Response {
  return new Response(null, {
    status,
    headers: {
      Location: location,
      "Cache-Control": "no-store, private, max-age=0",
      "CDN-Cache-Control": "no-store",
      "Referrer-Policy": "no-referrer",
      "X-Robots-Tag": "noindex, nofollow",
      Vary: "User-Agent",
    },
  });
}

function methodNotAllowed(): Response {
  return new Response("Method not allowed", {
    status: 405,
    headers: {
      Allow: "GET, HEAD",
      "Cache-Control": "no-store, private, max-age=0",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "HEAD") return methodNotAllowed();

  const url = new URL(req.url);
  const slug = normalizeQrSlug(url.searchParams.get("slug"));
  const fallbackUrl = websiteFallback();
  if (!slug) return redirect(fallbackUrl);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = tryGetServiceRoleKey();
  if (!supabaseUrl || !serviceRoleKey) return redirect(fallbackUrl);

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: campaign, error: campaignError } = await supabase
    .from("qr_campaigns")
    .select("id,destination_type")
    .eq("slug", slug)
    .eq("is_active", true)
    .maybeSingle<ActiveCampaign>();

  if (campaignError) {
    console.error("[qr-campaign-redirect] campaign lookup failed:", campaignError.code ?? "", campaignError.message ?? "");
    return redirect(fallbackUrl);
  }
  if (!campaign) return redirect(fallbackUrl);

  const userAgent = req.headers.get("user-agent") ?? "";
  const deviceType = classifyQrDevice(userAgent);
  const destination = resolveQrRedirect({
    destinationType: campaign.destination_type,
    deviceType,
    config: {
      iosAppStoreUrl: Deno.env.get("TWOFER_IOS_APP_STORE_URL") ?? null,
      androidPlayStoreUrl: Deno.env.get("TWOFER_ANDROID_PLAY_STORE_URL") ?? null,
      websiteUrl: fallbackUrl,
    },
  });

  // HEAD requests are often preflight/link-preview probes. Redirect them but
  // do not treat them as a customer scan event.
  if (req.method === "HEAD") return redirect(destination.url);

  const ipHash = await dailyQrIpHash({
    ip: clientIpFromRequest(req),
    secret: Deno.env.get("QR_SCAN_IP_HASH_SECRET") ?? null,
  });

  const { data: recordedRows, error: recordError } = await supabase.rpc("record_qr_campaign_scan", {
    p_slug: slug,
    p_user_agent: userAgent,
    p_device_type: deviceType,
    p_ip_hash: ipHash?.hash ?? null,
    p_ip_hash_day: ipHash?.day ?? null,
    p_redirect_target_type: destination.targetType,
    p_is_likely_bot: isLikelyQrBot(deviceType),
  });

  if (recordError) {
    // Tracking failure must never prevent an install conversion. Log only the
    // safe database code/message, never request headers or raw IP material.
    console.error("[qr-campaign-redirect] scan record failed:", recordError.code ?? "", recordError.message ?? "");
    return redirect(destination.url);
  }

  // A campaign can be disabled between the initial lookup and atomic insert.
  // Respect the current state and avoid redirecting that retired QR code.
  if (!Array.isArray(recordedRows) || recordedRows.length === 0) return redirect(fallbackUrl);

  return redirect(destination.url);
});
