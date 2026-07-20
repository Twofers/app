import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  finalizeStaleVisualRedeemForClaim,
  isPastRedeemDeadline,
} from "../_shared/claim-redeem.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import { parseShortCodeScanValue } from "../_shared/wallet-pass-content.ts";
import { syncWalletPassForUser } from "../_shared/wallet-pass-sync.ts";

const NEW_REDEEM_SELECT_COLUMN_NAMES = [
  "location_id",
  "qr_token_hash",
  "offer_definition_id",
  "offer_version_id",
] as const;
const NEW_REDEEM_UPDATE_COLUMN_NAMES = [
  "redeemed_by_business_user_id",
  "redeemed_at_business_id",
  "redeemed_at_location_id",
] as const;

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function normalizeQrToken(value: string): string {
  const clean = value.trim();
  if (!clean) return "";
  if (clean.toLowerCase().startsWith("twofer://redeem/")) return clean;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clean)) {
    return `twofer://redeem/${clean}`;
  }
  return clean;
}

function isMissingNewRedeemColumn(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message ?? "";
  return (
    (error?.code === "PGRST200" || error?.code === "PGRST204" || error?.code === "42703") &&
    [...NEW_REDEEM_SELECT_COLUMN_NAMES, ...NEW_REDEEM_UPDATE_COLUMN_NAMES].some((name) =>
      message.includes(name),
    )
  );
}

function omitNewRedeemUpdateColumns<T extends Record<string, unknown>>(row: T) {
  const next = { ...row };
  for (const name of NEW_REDEEM_UPDATE_COLUMN_NAMES) delete next[name];
  return next;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({ error: "Method not allowed" }),
      {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(
      supabaseUrl,
      supabaseServiceKey,
      {
        global: {
          headers: {
            Authorization: req.headers.get("Authorization")!,
          },
        },
      }
    );
    /** Service role — failed_redeem_attempts is RLS default-deny (service role only). */
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    const clientIp = (() => {
      const fwd = req.headers.get("x-forwarded-for");
      const first = fwd?.split(",")[0]?.trim();
      return first || req.headers.get("x-real-ip") || null;
    })();

    // 🔐 Get authenticated business user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized. Please log in as a business owner." }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    if (isRedeemerUser(user)) {
      return forbiddenForRedeemerResponse(corsHeaders);
    }

    // 🔍 Verify user owns a business.
    // Filtering on owner_id needs a SELECT grant on that column, which
    // anon/authenticated do not have (20260705120000), so this runs on the
    // service-role client. Still scoped to the authenticated user.id, so the
    // gate is unchanged.
    const { data: businesses, error: businessError } = await supabaseAdmin
      .from("businesses")
      .select("id")
      .eq("owner_id", user.id)
      .limit(10);

    const business = businesses?.[0] ?? null;
    if (businessError || !business) {
      return new Response(
        JSON.stringify({ error: "You must be a business owner to redeem tokens." }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const businessIds = (businesses ?? []).map((b) => b.id);
    let scannerLocationId: string | null = null;
    try {
      const { data: scannerLocation, error: scannerLocationError } = await supabase
        .from("business_locations")
        .select("id")
        .eq("business_id", business.id)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle();
      if (scannerLocationError) {
        console.warn("[redeem-token] scanner location lookup skipped:", scannerLocationError.message);
      } else {
        scannerLocationId = scannerLocation?.id ?? null;
      }
    } catch (err) {
      console.warn("[redeem-token] scanner location lookup unavailable:", String(err).slice(0, 160));
    }

    // 🔒 Brute-force lockout (20260705120007_failed_redeem_attempts.sql):
    // >= 10 failed attempts in the last 5 minutes for this business (and IP,
    // when one is available) → 429 before any code lookup happens.
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    let lockoutQuery = supabaseAdmin
      .from("failed_redeem_attempts")
      .select("*", { count: "exact", head: true })
      .eq("business_id", business.id)
      .gte("attempted_at", fiveMinutesAgo);
    if (clientIp) {
      lockoutQuery = lockoutQuery.eq("ip_address", clientIp);
    }
    const { count: failedCount, error: lockoutErr } = await lockoutQuery;
    if (lockoutErr) {
      console.error("[redeem-token] lockout check failed:", lockoutErr);
    } else if (failedCount !== null && failedCount >= 10) {
      return new Response(
        JSON.stringify({ error: "Too many failed attempts. Try again in a few minutes." }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    /** Best-effort failure log feeding the lockout above. Never blocks the response. */
    const attemptBusinessId = business.id;
    const attemptUserId = user.id;
    async function recordFailedAttempt(reason: string): Promise<void> {
      try {
        const { error: insErr } = await supabaseAdmin.from("failed_redeem_attempts").insert({
          business_id: attemptBusinessId,
          ip_address: clientIp,
          user_id: attemptUserId,
          reason,
        });
        if (insErr) console.error("[redeem-token] failed-attempt insert error:", insErr);
      } catch (err) {
        console.error("[redeem-token] failed-attempt insert threw:", err);
      }
    }

    // 🚦 Rate limit: max 10 redeem attempts per minute per business owner
    const { data: dealIdsData } = await supabase
      .from("deals")
      .select("id")
      .in("business_id", businessIds);
    const dealIds = (dealIdsData ?? []).map((d) => d.id);
    if (dealIds.length > 0) {
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
      const { count: recentRedeems } = await supabase
        .from("deal_claims")
        .select("*", { count: "exact", head: true })
        .in("deal_id", dealIds)
        .gte("redeemed_at", oneMinuteAgo);
      if (recentRedeems !== null && recentRedeems >= 10) {
        return new Response(
          JSON.stringify({ error: "Too many attempts. Try again in 30 seconds." }),
          {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    // 📦 Parse request body
    let body;
    try {
      body = await req.json();
    } catch {
      return new Response(
        JSON.stringify({ error: "Invalid JSON in request body" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const tokenRaw = body.token;
    const shortCodeRaw = body.short_code;
    let shortCodeNorm =
      typeof shortCodeRaw === "string"
        ? shortCodeRaw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
        : "";
    const tokenInput = typeof tokenRaw === "string" ? tokenRaw.trim() : "";
    const tokenNorm = tokenInput ? normalizeQrToken(tokenInput) : "";
    // Native wallet-pass barcodes encode the short code (twofer://redeem/sc/<CODE>).
    // The scanner forwards raw scans as `token`, so route those through the existing
    // short-code lookup — same credential staff type manually today.
    if (shortCodeNorm.length === 0) {
      const walletScanShortCode = parseShortCodeScanValue(tokenInput);
      if (walletScanShortCode) shortCodeNorm = walletScanShortCode;
    }

    const selectClaimNew = `
        *,
        deal:deals!inner(
          id,
          business_id,
          location_id,
          title,
          source_locale,
          title_en,
          title_es,
          title_ko,
          is_demo,
          business:businesses!inner(id, owner_id)
        )
      `;
    const selectClaimLegacy = `
        *,
        deal:deals!inner(
          id,
          business_id,
          title,
          source_locale,
          title_en,
          title_es,
          title_ko,
          is_demo,
          business:businesses!inner(id, owner_id)
        )
      `;

    let claim: Record<string, unknown> | null = null;
    let claimError: { code?: string; message?: string } | null = null;

    if (shortCodeNorm.length >= 4) {
      let r = await supabase
        .from("deal_claims")
        .select(selectClaimNew)
        .eq("short_code", shortCodeNorm)
        .maybeSingle();
      if (isMissingNewRedeemColumn(r.error)) {
        r = await supabase
          .from("deal_claims")
          .select(selectClaimLegacy)
          .eq("short_code", shortCodeNorm)
          .maybeSingle();
      }
      claim = r.data as Record<string, unknown> | null;
      claimError = r.error;
    } else if (tokenNorm.length > 0) {
      const tokenHash = await sha256Base64Url(tokenNorm);
      let r = await supabase
        .from("deal_claims")
        .select(selectClaimNew)
        .eq("qr_token_hash", tokenHash)
        .maybeSingle();
      if (isMissingNewRedeemColumn(r.error) || !r.data) {
        r = await supabase
          .from("deal_claims")
          .select(isMissingNewRedeemColumn(r.error) ? selectClaimLegacy : selectClaimNew)
          .eq("token", tokenNorm)
          .maybeSingle();
      }
      if (!r.data && tokenInput && tokenInput !== tokenNorm) {
        r = await supabase
          .from("deal_claims")
          .select(selectClaimLegacy)
          .eq("token", tokenInput)
          .maybeSingle();
      }
      if (isMissingNewRedeemColumn(r.error)) {
        r = await supabase
          .from("deal_claims")
          .select(selectClaimLegacy)
          .eq("token", tokenInput || tokenNorm)
          .maybeSingle();
      }
      claim = r.data as Record<string, unknown> | null;
      claimError = r.error;
    } else {
      return new Response(
        JSON.stringify({ error: "Missing or invalid token or claim code" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (claimError || !claim) {
      await recordFailedAttempt("unknown_code");
      return new Response(
        JSON.stringify({ error: "Invalid token or claim code" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const claimId = claim.id as string;
    const now = new Date();
    const nowIso = now.toISOString();

    // 🔒 Verify token belongs to a deal owned by this business
    const deal = claim.deal as {
      id?: string | null;
      business_id?: string | null;
      location_id?: string | null;
      title?: string | null;
      source_locale?: string | null;
      title_en?: string | null;
      title_es?: string | null;
      title_ko?: string | null;
      is_demo?: boolean | null;
      business?: { owner_id?: string };
      max_claims?: number | null;
    } | null;
    if (!deal || deal.business?.owner_id !== user.id) {
      await recordFailedAttempt("wrong_business");
      return new Response(
        JSON.stringify({ error: "This token does not belong to your business" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    if (!businessIds.includes(deal.business_id ?? "")) {
      await recordFailedAttempt("wrong_business");
      return new Response(
        JSON.stringify({
          error: "This deal belongs to another business and cannot be redeemed here.",
          error_code: "WRONG_BUSINESS_REDEMPTION",
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    const dealLocationId = deal.location_id ?? (claim.location_id as string | null | undefined) ?? null;
    if (dealLocationId && scannerLocationId && dealLocationId !== scannerLocationId) {
      await recordFailedAttempt("wrong_location");
      return new Response(
        JSON.stringify({
          error: "This deal can only be redeemed at the location shown in the customer's wallet.",
          error_code: "WRONG_LOCATION_REDEMPTION",
        }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (deal.is_demo === true) {
      return new Response(
        JSON.stringify({ error: "This is sample content for testing only. Not a real offer." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    await finalizeStaleVisualRedeemForClaim(supabaseAdmin, claimId, nowIso);

    const { data: freshRow } = await supabase
      .from("deal_claims")
      .select("redeemed_at, claim_status, expires_at, grace_period_minutes")
      .eq("id", claimId)
      .maybeSingle();

    // ✅ Check if already redeemed
    if (freshRow?.redeemed_at || claim.redeemed_at) {
      return new Response(
        JSON.stringify({ error: "This token has already been redeemed" }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const claimStatus = String(freshRow?.claim_status ?? claim.claim_status ?? "active");
    if (claimStatus === "canceled" || claimStatus === "expired") {
      await recordFailedAttempt("expired");
      return new Response(
        JSON.stringify({ error: "This token has expired" }),
        {
          status: 410,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    if (claimStatus !== "active" && claimStatus !== "redeeming") {
      return new Response(
        JSON.stringify({ error: "This claim cannot be redeemed" }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ⏰ Check if past redeem deadline (expires_at + grace)
    const grace =
      typeof freshRow?.grace_period_minutes === "number" && freshRow.grace_period_minutes > 0
        ? freshRow.grace_period_minutes
        : 10;
    const expiresIso = (freshRow?.expires_at ?? claim.expires_at) as string;
    if (isPastRedeemDeadline(now.getTime(), expiresIso, grace)) {
      await supabaseAdmin.from("deal_claims").update({ claim_status: "expired" }).eq("id", claimId);
      await recordFailedAttempt("expired");
      return new Response(
        JSON.stringify({ error: "This token has expired" }),
        {
          status: 410,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 💾 Mark as redeemed (idempotent: same claim id, only if still null)
    // Manual short-code entry is the backup path for staff QR redemption.
    const redeemMethod = "qr";
    const redeemUpdateRow = {
      redeemed_at: nowIso,
      claim_status: "redeemed",
      redeem_method: redeemMethod,
      redeem_started_at: null,
      redeemed_by_business_user_id: user.id,
      redeemed_at_business_id: deal.business_id ?? business.id,
      redeemed_at_location_id: dealLocationId ?? scannerLocationId,
    };
    let updateResult = await supabaseAdmin
      .from("deal_claims")
      .update(redeemUpdateRow)
      .eq("id", claimId)
      .is("redeemed_at", null)
      .select("redeemed_at")
      .single();
    if (isMissingNewRedeemColumn(updateResult.error)) {
      updateResult = await supabaseAdmin
        .from("deal_claims")
        .update(omitNewRedeemUpdateColumns(redeemUpdateRow))
        .eq("id", claimId)
        .is("redeemed_at", null)
        .select("redeemed_at")
        .single();
    }
    const { data: updated, error: updateError } = updateResult;

    if (updateError || !updated) {
      console.error("Update error:", updateError);
      return new Response(
        JSON.stringify({ error: updateError ? `Failed to redeem token: ${updateError.message}` : "This token has already been redeemed" }),
        {
          status: updateError ? 500 : 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Best-effort: record redemption analytics for MVP.
    // This is intentionally fire-and-forget-ish (logged on failure only) to avoid breaking staff redemption.
    try {
      await supabase.from("app_analytics_events").insert({
        event_name: "redeem_completed",
        user_id: user.id,
        business_id: deal.business_id ?? null,
        deal_id: deal.id ?? null,
        claim_id: claimId,
        context: {
          method: redeemMethod,
          offer_definition_id: (claim.offer_definition_id as string | null | undefined) ?? null,
          offer_version_id: (claim.offer_version_id as string | null | undefined) ?? null,
        },
      });
    } catch (err) {
      console.error("[redeem-token] analytics insert failed", err);
    }

    // Native wallet pass: flip the customer's Twofer Card to "Redeemed".
    // Best-effort and flag-gated; a no-op until the customer added the card.
    await syncWalletPassForUser(supabaseAdmin, (claim.user_id as string | null | undefined) ?? null);

    // ✅ Success
    return new Response(
      JSON.stringify({
        ok: true,
        deal_title: deal.title,
        deal_source_locale: deal.source_locale ?? null,
        deal_title_en: deal.title_en ?? null,
        deal_title_es: deal.title_es ?? null,
        deal_title_ko: deal.title_ko ?? null,
        redeemed_at: nowIso,
        deal_id: deal.id,
        claim_id: claimId,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({ error: "Server error" }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
