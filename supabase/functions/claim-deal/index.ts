import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isPastRedeemDeadline } from "../_shared/claim-redeem.ts";
import { hasClaimOnLocalBusinessDay } from "../_shared/claim-limits.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_BUSINESS_TZ = "America/Chicago";

/** Redeem allowed until `expires_at` + this many minutes (`expires_at` = concrete instance end). */
const REDEEM_GRACE_MINUTES = 10;

const SHORT_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

const ACQUISITION_SOURCES = new Set([
  "organic",
  "push",
  "favorite",
  "search",
  "direct",
  "campaign",
  "unknown",
]);

function ageBandAtClaim(now: Date, birthdate: string | null | undefined, ageRange: string | null | undefined): string | null {
  if (birthdate && /^\d{4}-\d{2}-\d{2}$/.test(birthdate)) {
    const [y, m, d] = birthdate.split("-").map(Number);
    const bd = new Date(Date.UTC(y!, m! - 1, d!));
    if (Number.isNaN(bd.getTime())) return ageRange ?? null;
    let age = now.getUTCFullYear() - bd.getUTCFullYear();
    const mo = now.getUTCMonth() - bd.getUTCMonth();
    if (mo < 0 || (mo === 0 && now.getUTCDate() < bd.getUTCDate())) age--;
    if (age < 18) return "under_18";
    if (age <= 24) return "18_24";
    if (age <= 34) return "25_34";
    if (age <= 44) return "35_44";
    if (age <= 54) return "45_54";
    if (age <= 64) return "55_64";
    return "65_plus";
  }
  return typeof ageRange === "string" && ageRange.trim() ? ageRange.trim() : null;
}

function randomShortCode(): string {
  const buf = new Uint8Array(6);
  crypto.getRandomValues(buf);
  let s = "";
  for (let i = 0; i < 6; i++) s += SHORT_CODE_CHARS[buf[i]! % SHORT_CODE_CHARS.length];
  return s;
}

function readZonedYmd(now: Date, tz: string) {
  const f = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const p = f.formatToParts(now);
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "0";
  return { y: Number(g("year")), mo: Number(g("month")), d: Number(g("day")) };
}

/** Wall-clock time in `tz` → UTC instant (ms). */
function zonedWallToUtcMs(
  y: number,
  mo: number,
  d: number,
  hour: number,
  minute: number,
  tz: string,
): number {
  let guess = Date.UTC(y, mo - 1, d, hour, minute, 0);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  for (let i = 0; i < 48; i++) {
    const parts = fmt.formatToParts(new Date(guess));
    const gv = (ty: string) => Number(parts.find((p) => p.type === ty)?.value ?? 0);
    if (
      gv("year") === y && gv("month") === mo && gv("day") === d && gv("hour") === hour &&
      gv("minute") === minute
    ) {
      return guess;
    }
    guess += ((hour - gv("hour")) * 60 + (minute - gv("minute"))) * 60 * 1000;
    guess += (d - gv("day")) * 86400000;
    guess += (mo - gv("month")) * 30 * 86400000;
    guess += (y - gv("year")) * 365 * 86400000;
  }
  return guess;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
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
    /** Service role only — used for deal-id / claim lookups that RLS would otherwise hide. Always filter `user_id` to the authenticated user. */
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // 🔐 Get authenticated user
    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    if (userError || !user) {
      return new Response(
        JSON.stringify({ error: "Unauthorized. Please log in." }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
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

    const dealId = body.deal_id;
    const acquisitionRaw = typeof body.acquisition_source === "string" ? body.acquisition_source.trim() : "";
    const acquisition_source = ACQUISITION_SOURCES.has(acquisitionRaw) ? acquisitionRaw : "unknown";
    const zip_at_claim = typeof body.zip_at_claim === "string" ? body.zip_at_claim.trim().slice(0, 12) : null;
    const location_source_at_claim =
      body.location_source_at_claim === "gps" || body.location_source_at_claim === "zip"
        ? body.location_source_at_claim
        : body.location_source_at_claim === "unknown"
          ? "unknown"
          : null;
    const app_version_at_claim =
      typeof body.app_version_at_claim === "string" ? body.app_version_at_claim.trim().slice(0, 64) : null;
    const device_platform_at_claim =
      typeof body.device_platform_at_claim === "string" ? body.device_platform_at_claim.trim().slice(0, 32) : null;
    const session_id_at_claim =
      typeof body.session_id_at_claim === "string" ? body.session_id_at_claim.trim().slice(0, 128) : null;

    if (!dealId) {
      return new Response(
        JSON.stringify({ error: "Missing deal_id" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 🚦 Rate limit: max 3 claim attempts per minute per user
    const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
    const { count: recentClaimCount } = await supabase
      .from("deal_claims")
      .select("*", { count: "exact", head: true })
      .eq("user_id", user.id)
      .gte("created_at", oneMinuteAgo);
    if (recentClaimCount !== null && recentClaimCount >= 3) {
      return new Response(
        JSON.stringify({ error: "Too many attempts. Try again in 30 seconds." }),
        {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 🔍 Fetch and validate deal
    const { data: deal, error: dealError } = await supabase
      .from("deals")
      .select("id, business_id, start_time, end_time, claim_cutoff_buffer_minutes, max_claims, is_active, is_recurring, days_of_week, window_start_minutes, window_end_minutes, timezone")
      .eq("id", dealId)
      .single();

    if (dealError || !deal) {
      return new Response(
        JSON.stringify({ error: "Deal not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!deal.is_active) {
      return new Response(
        JSON.stringify({ error: "This deal is not active" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const now = new Date();
    const startTime = deal.start_time ? new Date(deal.start_time) : null;
    const endTime = new Date(deal.end_time);
    if (startTime && now < startTime) {
      return new Response(
        JSON.stringify({ error: "This deal has not started yet." }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
    const cutoffBufferMinutes = deal.claim_cutoff_buffer_minutes || 15;
    const claimCutoffTime = new Date(endTime.getTime() - cutoffBufferMinutes * 60 * 1000);

    if (now >= endTime) {
      return new Response(
        JSON.stringify({ error: "This deal has expired" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (now >= claimCutoffTime) {
      return new Response(
        JSON.stringify({
          error: `Claiming has closed. Cutoff was ${claimCutoffTime.toLocaleString()}`,
        }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ⏰ Recurring window validation
    if (deal.is_recurring) {
      const days = Array.isArray(deal.days_of_week) ? deal.days_of_week : [];
      const windowStart = deal.window_start_minutes;
      const windowEnd = deal.window_end_minutes;
      const tz = (typeof deal.timezone === "string" && deal.timezone.trim().length > 0)
        ? deal.timezone.trim()
        : DEFAULT_BUSINESS_TZ;

      if (!days.length || windowStart == null || windowEnd == null) {
        return new Response(
          JSON.stringify({ error: "This deal is not configured correctly." }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const parts = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        weekday: "short",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(now);

      const weekday = parts.find((p) => p.type === "weekday")?.value ?? "Mon";
      const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
      const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
      const minutesNow = hour * 60 + minute;

      const dayMap: Record<string, number> = {
        Mon: 1,
        Tue: 2,
        Wed: 3,
        Thu: 4,
        Fri: 5,
        Sat: 6,
        Sun: 7,
      };
      const today = dayMap[weekday] ?? 1;

      if (!days.includes(today)) {
        return new Response(
          JSON.stringify({ error: "This deal is not active today." }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      if (windowStart >= windowEnd) {
        return new Response(
          JSON.stringify({ error: "This deal has an invalid time window." }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const cutoffMinutes = windowEnd - cutoffBufferMinutes;
      if (minutesNow < windowStart || minutesNow >= windowEnd) {
        return new Response(
          JSON.stringify({ error: "This deal is not active right now." }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      if (minutesNow >= cutoffMinutes) {
        return new Response(
          JSON.stringify({ error: "Claiming has closed for today's window." }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    const businessId = deal.business_id as string;

    /** All deal ids for this business (includes inactive/expired deals for claim history rules). */
    const { data: bizDealRows, error: bizDealsError } = await supabaseAdmin
      .from("deals")
      .select("id")
      .eq("business_id", businessId);
    if (bizDealsError) {
      console.error("biz deals lookup:", bizDealsError);
    }
    let businessDealIds = (bizDealRows ?? []).map((r: { id: string }) => r.id);
    if (businessDealIds.length === 0) {
      businessDealIds = [dealId];
    }

    const nowMs = now.getTime();

    // 🚫 At most one active claim app-wide (unredeemed, before redeem-by deadline). Same deal → idempotent 200.
    const { data: unredeemedRows, error: unredeemedErr } = await supabaseAdmin
      .from("deal_claims")
      .select("id, deal_id, token, expires_at, short_code, grace_period_minutes, claim_status")
      .eq("user_id", user.id)
      .is("redeemed_at", null);

    if (unredeemedErr) {
      console.error("unredeemed claims lookup:", unredeemedErr);
    } else {
      const notCanceled = (unredeemedRows ?? []).filter(
        (row: { claim_status?: string | null }) => row.claim_status !== "canceled",
      );
      const activeRows = notCanceled.filter((row: {
        expires_at: string;
        grace_period_minutes: number | null;
      }) => {
        const grace = row.grace_period_minutes ?? REDEEM_GRACE_MINUTES;
        return !isPastRedeemDeadline(nowMs, row.expires_at, grace);
      });

      const forThisDeal = activeRows.find((r: { deal_id: string }) => r.deal_id === dealId);
      if (forThisDeal) {
        const fc = forThisDeal as {
          id: string;
          token: string;
          expires_at: string;
          short_code: string | null;
        };
        return new Response(
          JSON.stringify({
            claim_id: fc.id,
            token: fc.token,
            expires_at: fc.expires_at,
            short_code: fc.short_code ?? null,
            message: "You already have an active claim for this deal",
          }),
          {
            status: 200,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }

      if (activeRows.length > 0) {
        return new Response(
          JSON.stringify({
            error:
              "You already have an active claim. Redeem it or wait until it expires before claiming another deal.",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    // 🚫 One non-canceled claim per business per local calendar day (deal timezone)
    const businessTz =
      typeof deal.timezone === "string" && deal.timezone.trim().length > 0
        ? deal.timezone.trim()
        : DEFAULT_BUSINESS_TZ;
    const lookbackIso = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentClaims, error: todayErr } = await supabaseAdmin
      .from("deal_claims")
      .select("id, deal_id, created_at, claim_status")
      .eq("user_id", user.id)
      .in("deal_id", businessDealIds)
      .gte("created_at", lookbackIso);

    if (todayErr) {
      console.error("recent claims for daily limit:", todayErr);
    } else if (recentClaims && recentClaims.length > 0) {
      const hasClaimThisLocalDay = hasClaimOnLocalBusinessDay({
        now,
        businessTz,
        claims: recentClaims as Array<{ created_at: string; claim_status: string | null }>,
      });

      if (hasClaimThisLocalDay) {
        return new Response(
          JSON.stringify({
            error: "You can only claim once per business per local day.",
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    // 📊 Check max_claims limit (count all claims, not just redeemed)
    if (deal.max_claims !== null && deal.max_claims > 0) {
      const { count, error: countError } = await supabase
        .from("deal_claims")
        .select("*", { count: "exact", head: true })
        .eq("deal_id", dealId);

      if (countError) {
        console.error("Error counting claims:", countError);
      } else if (count !== null && count >= deal.max_claims) {
        return new Response(
          JSON.stringify({ error: "This deal has reached its claim limit." }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
    }

    const { data: consumerProf } = await supabase
      .from("consumer_profiles")
      .select("birthdate, age_range")
      .eq("user_id", user.id)
      .maybeSingle();

    const age_band_at_claim = ageBandAtClaim(
      now,
      consumerProf?.birthdate as string | undefined,
      consumerProf?.age_range as string | undefined,
    );

    // ⏱ Concrete claim `expires_at` (instance end). Redeem allowed until expires_at + grace (see shared helper).
    const token = crypto.randomUUID();
    const tzForDeal =
      typeof deal.timezone === "string" && deal.timezone.trim().length > 0
        ? deal.timezone.trim()
        : DEFAULT_BUSINESS_TZ;
    let concreteExpiresMs: number;
    if (deal.is_recurring) {
      const windowEndMin = deal.window_end_minutes as number;
      const { y, mo, d } = readZonedYmd(now, tzForDeal);
      const weh = Math.floor(windowEndMin / 60);
      const wem = windowEndMin % 60;
      const dayWindowEndMs = zonedWallToUtcMs(y, mo, d, weh, wem, tzForDeal);
      concreteExpiresMs = Math.min(dayWindowEndMs, endTime.getTime());
    } else {
      concreteExpiresMs = endTime.getTime();
    }
    const expiresAt = new Date(concreteExpiresMs).toISOString();

    // 🧾 Insert claim (retry on rare short_code collision)
    let insertError: { code?: string; message?: string } | null = null;
    let short_code: string | null = null;
    let newClaimId: string | null = null;
    for (let attempt = 0; attempt < 14; attempt++) {
      const code = randomShortCode();
      const { data: inserted, error: err } = await supabaseAdmin
        .from("deal_claims")
        .insert({
          deal_id: dealId,
          user_id: user.id,
          token,
          expires_at: expiresAt,
          short_code: code,
          claim_status: "active",
          grace_period_minutes: REDEEM_GRACE_MINUTES,
          acquisition_source,
          age_band_at_claim,
          zip_at_claim,
          location_source_at_claim,
          app_version_at_claim,
          device_platform_at_claim,
          session_id_at_claim,
        })
        .select("id")
        .single();
      if (!err && inserted?.id) {
        short_code = code;
        newClaimId = inserted.id as string;
        insertError = null;
        break;
      }
      insertError = err ?? { message: "insert failed" };
      const msg = String(err?.message ?? "");
      if (err?.code === "23505" && msg.includes("short_code")) {
        continue;
      }
      break;
    }

    if (insertError || !short_code || !newClaimId) {
      console.error("Insert error:", insertError);
      if (insertError?.code === "23505") {
        return new Response(
          JSON.stringify({ error: "You already have an active claim for this deal" }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }
      return new Response(
        JSON.stringify({
          error: `Failed to create claim: ${insertError?.message ?? "unknown"}`,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // ✅ Success
    return new Response(
      JSON.stringify({
        claim_id: newClaimId,
        token,
        expires_at: expiresAt,
        short_code,
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
