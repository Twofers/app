import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  finalizeStaleVisualRedeemForClaim,
  isPastRedeemDeadline,
} from "../_shared/claim-redeem.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

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
    /** Service-role client used for cross-tenant queries (rate limit, failed-attempt logging)
     * that must NOT be filtered by RLS. The user-JWT-scoped `supabase` client above is RLS-enforced. */
    const admin = createClient(supabaseUrl, supabaseServiceKey);

    // Caller IP — used for per-IP brute-force throttle.
    const callerIp =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("cf-connecting-ip") ||
      null;

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

    // 🔍 Verify user owns a business
    const { data: businesses, error: businessError } = await supabase
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
    const primaryBusinessId = businessIds[0];

    // 🚦 Rate limit: max 10 successful redeems per minute per business owner.
    // Uses admin client because the user-JWT client only sees claims for deals in the owner's
    // RLS-allowed scope; a recent RLS migration (20260330120000) tightened that further so
    // counts can return 0 even when the throttle should fire.
    const { data: dealIdsData } = await admin
      .from("deals")
      .select("id")
      .in("business_id", businessIds);
    const dealIds = (dealIdsData ?? []).map((d) => d.id);
    if (dealIds.length > 0) {
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
      const { count: recentRedeems } = await admin
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

    // 🛡️ Brute-force protection: block this business+IP if it has 10+ failed attempts in the last 5 min.
    if (primaryBusinessId) {
      const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
      const failQuery = admin
        .from("failed_redeem_attempts")
        .select("id", { count: "exact", head: true })
        .eq("business_id", primaryBusinessId)
        .gte("attempted_at", fiveMinAgo);
      const { count: recentFailures } = callerIp
        ? await failQuery.eq("ip_address", callerIp)
        : await failQuery;
      if (recentFailures !== null && recentFailures >= 10) {
        return new Response(
          JSON.stringify({
            error: "Too many failed attempts. Try again in a few minutes.",
            error_code: "FAILED_ATTEMPTS_LOCKOUT",
          }),
          { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    /** Helper to log a failed redemption attempt for brute-force tracking. */
    async function logFailedAttempt(reason: string) {
      if (!primaryBusinessId) return;
      try {
        await admin.from("failed_redeem_attempts").insert({
          business_id: primaryBusinessId,
          ip_address: callerIp,
          user_id: user.id,
          reason,
        });
      } catch (e) {
        console.log(`[redeem-token] failed to log attempt: ${String(e).slice(0, 200)}`);
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
    const shortCodeNorm =
      typeof shortCodeRaw === "string"
        ? shortCodeRaw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "")
        : "";
    const tokenNorm = typeof tokenRaw === "string" ? tokenRaw.trim() : "";

    const selectClaim = `
        *,
        deal:deals!inner(
          id,
          business_id,
          title,
          business:businesses!inner(id, owner_id)
        )
      `;

    let claim: Record<string, unknown> | null = null;
    let claimError: { message?: string } | null = null;

    if (shortCodeNorm.length >= 4) {
      const r = await supabase
        .from("deal_claims")
        .select(selectClaim)
        .eq("short_code", shortCodeNorm)
        .maybeSingle();
      claim = r.data as Record<string, unknown> | null;
      claimError = r.error;
    } else if (tokenNorm.length > 0) {
      const r = await supabase
        .from("deal_claims")
        .select(selectClaim)
        .eq("token", tokenNorm)
        .maybeSingle();
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
      await logFailedAttempt("unknown_code");
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
    const deal = claim.deal as any;
    if (!deal || deal.business?.owner_id !== user.id) {
      await logFailedAttempt("wrong_business");
      return new Response(
        JSON.stringify({ error: "This token does not belong to your business" }),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    await finalizeStaleVisualRedeemForClaim(supabase, claimId, nowIso);

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
      await supabase.from("deal_claims").update({ claim_status: "expired" }).eq("id", claimId);
      return new Response(
        JSON.stringify({ error: "This token has expired" }),
        {
          status: 410,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 💾 Mark as redeemed (idempotent: same claim id, only if still null)
    const redeemMethod = shortCodeNorm.length >= 4 ? "short_code" : "qr";
    const { data: updated, error: updateError } = await supabase
      .from("deal_claims")
      .update({
        redeemed_at: nowIso,
        claim_status: "redeemed",
        redeem_method: redeemMethod,
        redeem_started_at: null,
      })
      .eq("id", claimId)
      .is("redeemed_at", null)
      .select("redeemed_at")
      .single();

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
        context: { method: redeemMethod },
      });
    } catch (err) {
      console.error("[redeem-token] analytics insert failed", err);
    }

    // ✅ Success
    return new Response(
      JSON.stringify({
        ok: true,
        deal_title: deal.title,
        redeemed_at: nowIso,
        deal_id: deal.id,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 200,
      }
    );
  } catch (err) {
    console.error("Unexpected error:", err);
    return new Response(
      JSON.stringify({
        error: "Server error",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
