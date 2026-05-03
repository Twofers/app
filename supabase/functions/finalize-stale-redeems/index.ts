import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isPastRedeemDeadline, VISUAL_REDEEM_AUTO_FINALIZE_MS } from "../_shared/claim-redeem.ts";
import { getCorsHeaders } from "../_shared/cors.ts";

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    });

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized. Please log in." }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const appVersion =
      typeof (body as { app_version?: unknown }).app_version === "string" ? (body as { app_version: string }).app_version : null;
    const devicePlatform =
      typeof (body as { device_platform?: unknown }).device_platform === "string"
        ? (body as { device_platform: string }).device_platform
        : null;

    const cutoff = new Date(Date.now() - VISUAL_REDEEM_AUTO_FINALIZE_MS).toISOString();
    const nowIso = new Date().toISOString();

    const nowMs = Date.now();

    // Stage 1: claims in `redeeming` state long enough to be considered stale.
    // Important: only mark them as `redeemed` if they are still redeemable by the redeem-by deadline.
    const { data: staleRedeemingClaims, error: staleRedeemingErr } = await supabase
      .from("deal_claims")
      .select("id, deal_id, expires_at, grace_period_minutes, claim_status, deal:deals!inner(business_id)")
      .eq("user_id", user.id)
      .eq("claim_status", "redeeming")
      .lte("redeem_started_at", cutoff)
      .is("redeemed_at", null);

    let finalizedCount = 0;
    let expiredCount = 0;

    if (staleRedeemingErr) {
      console.error(staleRedeemingErr);
      return new Response(JSON.stringify({ error: "Failed to query stale claims" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } else if (staleRedeemingClaims && staleRedeemingClaims.length > 0) {
      const toRedeem = staleRedeemingClaims.filter((r: {
        id: string;
        expires_at: string;
        grace_period_minutes: number | null;
      }) => {
        const g = typeof r.grace_period_minutes === "number" ? r.grace_period_minutes : 10;
        return !isPastRedeemDeadline(nowMs, r.expires_at, g);
      });

      const toExpire = staleRedeemingClaims.filter((r: {
        id: string;
        expires_at: string;
        grace_period_minutes: number | null;
      }) => {
        const g = typeof r.grace_period_minutes === "number" ? r.grace_period_minutes : 10;
        return isPastRedeemDeadline(nowMs, r.expires_at, g);
      });

      // Redeem stale visual redemptions that are still within their redeem-by window.
      if (toRedeem.length > 0) {
        const ids = toRedeem.map((r: { id: string }) => r.id);
        const { data: redeemedUpd, error: redeemedErr } = await supabase
          .from("deal_claims")
          .update({
            redeemed_at: nowIso,
            claim_status: "redeemed",
            redeem_method: "visual",
            redeem_started_at: null,
          })
          .eq("user_id", user.id)
          .eq("claim_status", "redeeming")
          .lte("redeem_started_at", cutoff)
          .in("id", ids)
          .is("redeemed_at", null)
          .select("id");

        if (redeemedErr) {
          console.error(redeemedErr);
        } else {
          finalizedCount = (redeemedUpd ?? []).length;
        }
      }

      // Expire stale visual redemptions that are already past redeem-by deadline.
      if (toExpire.length > 0) {
        const ids = toExpire.map((r: { id: string }) => r.id);
        const { data: expiredRedeemingUpd, error: expiredRedeemingErr } = await supabase
          .from("deal_claims")
          .update({ claim_status: "expired", redeem_started_at: null })
          .eq("user_id", user.id)
          .eq("claim_status", "redeeming")
          .lte("redeem_started_at", cutoff)
          .in("id", ids)
          .is("redeemed_at", null)
          .select("id");

        if (expiredRedeemingErr) {
          console.error(expiredRedeemingErr);
        } else {
          const updatedIds = new Set((expiredRedeemingUpd ?? []).map((r: { id: string }) => r.id));
          expiredCount += updatedIds.size;

          // Best-effort analytics insert. Never block claim expiration on telemetry.
          try {
            const analyticsRows = toExpire
              .filter((r) => updatedIds.has(r.id))
              .map((r) => ({
                event_name: "claim_expired",
                user_id: user.id,
                claim_id: r.id,
                deal_id: r.deal_id ?? null,
                business_id: r.deal?.business_id ?? null,
                context: { source: "finalize_stale_redeems" },
                app_version: appVersion,
                device_platform: devicePlatform,
              }));

            if (analyticsRows.length > 0) {
              const { error: insErr } = await supabase.from("app_analytics_events").insert(analyticsRows);
              if (insErr) console.error(insErr);
            }
          } catch (insErr) {
            console.error("[finalize-stale-redeems] claim_expired analytics insert failed", insErr);
          }
        }
      }
    }

    // Stage 2: any other open claims past redeem-by deadline should be expired.
    const { data: openClaims, error: openErr } = await supabase
      .from("deal_claims")
      .select("id, deal_id, expires_at, grace_period_minutes, claim_status, deal:deals!inner(business_id)")
      .eq("user_id", user.id)
      .is("redeemed_at", null);

    if (!openErr && openClaims && openClaims.length > 0) {
      const toExpire = openClaims.filter((r: {
        id: string;
        deal_id: string | null;
        expires_at: string;
        grace_period_minutes: number | null;
        claim_status: string | null;
        deal?: { business_id?: string | null } | null;
      }) => {
        if (r.claim_status === "canceled" || r.claim_status === "redeemed" || r.claim_status === "expired") return false;
        const g = typeof r.grace_period_minutes === "number" ? r.grace_period_minutes : 10;
        return isPastRedeemDeadline(nowMs, r.expires_at, g);
      });

      if (toExpire.length > 0) {
        const ids = toExpire.map((r: { id: string }) => r.id);
        const { data: expUpd, error: expErr } = await supabase
          .from("deal_claims")
          .update({ claim_status: "expired", redeem_started_at: null })
          .eq("user_id", user.id)
          .in("id", ids)
          .is("redeemed_at", null)
          .not("claim_status", "in", "(redeemed,canceled,expired)")
          .select("id");

        if (expErr) {
          console.error(expErr);
        } else {
          const updatedIds = new Set((expUpd ?? []).map((r: { id: string }) => r.id));
          expiredCount += updatedIds.size;

          // Best-effort analytics insert. Never block claim expiration on telemetry.
          try {
            const analyticsRows = toExpire
              .filter((r) => updatedIds.has(r.id))
              .map((r) => ({
                event_name: "claim_expired",
                user_id: user.id,
                claim_id: r.id,
                deal_id: r.deal_id ?? null,
                business_id: r.deal?.business_id ?? null,
                context: { source: "finalize_stale_redeems" },
                app_version: appVersion,
                device_platform: devicePlatform,
              }));

            if (analyticsRows.length > 0) {
              const { error: insErr } = await supabase.from("app_analytics_events").insert(analyticsRows);
              if (insErr) console.error(insErr);
            }
          } catch (insErr) {
            console.error("[finalize-stale-redeems] claim_expired analytics insert failed", insErr);
          }
        }
      }
    } else if (openErr) {
      console.error(openErr);
    }

    return new Response(
      JSON.stringify({
        ok: true,
        finalized_count: finalizedCount,
        expired_count: expiredCount,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: "Server error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
