import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getCorsHeaders } from "../_shared/cors.ts";
import { sendExpoPushBatch } from "../_shared/expo-push.ts";
import {
  getSuspendedLocation,
  getSuspendedPrimaryBusinessLocation,
  suspendedLocationResponseBody,
} from "../_shared/billing-suspension.ts";
import {
  buildOwnerClaimPushMessage,
  decideOwnerClaimPush,
  resolveOwnerPushLocale,
} from "../_shared/owner-claim-push.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import {
  evaluateRepeatClaimPolicy,
  normalizeRepeatClaimPolicyType,
} from "../_shared/repeat-claim-policy.ts";
import { syncWalletPassForUser } from "../_shared/wallet-pass-sync.ts";
import { isPastRedeemDeadline } from "../_shared/claim-redeem.ts";

const DEFAULT_BUSINESS_TZ = "America/Chicago";

/** Redeem allowed until `expires_at` + this many minutes (`expires_at` = concrete instance end). */
const REDEEM_GRACE_MINUTES = 10;

const SHORT_CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const NEW_CLAIM_COLUMN_NAMES = [
  "business_id",
  "location_id",
  "qr_token_hash",
  "offer_definition_id",
  "offer_version_id",
] as const;
const NEW_DEAL_SELECT_COLUMN_NAMES = [
  "location_id",
  "offer_definition_id",
  "offer_version_id",
  "deal_status",
  "eligibility_status",
  "repeat_claim_policy_type",
  "repeat_claim_cooldown_days",
] as const;

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

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function sha256Base64Url(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return base64Url(new Uint8Array(digest));
}

function isMissingNewClaimColumn(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message ?? "";
  return (
    (error?.code === "PGRST204" || error?.code === "42703") &&
    NEW_CLAIM_COLUMN_NAMES.some((name) => message.includes(name))
  );
}

function isMissingNewDealSelectColumn(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message ?? "";
  return (
    (error?.code === "PGRST200" || error?.code === "PGRST204" || error?.code === "42703") &&
    NEW_DEAL_SELECT_COLUMN_NAMES.some((name) => message.includes(name))
  );
}

function isClaimLimitReachedError(error: { code?: string; message?: string; details?: string } | null | undefined) {
  const detail = `${error?.message ?? ""} ${error?.details ?? ""}`;
  return error?.code === "P0001" && /MAX_CLAIMS_REACHED|CLAIM_LIMIT_REACHED/.test(detail);
}

function omitNewClaimColumns<T extends Record<string, unknown>>(row: T) {
  const next = { ...row };
  for (const name of NEW_CLAIM_COLUMN_NAMES) delete next[name];
  return next;
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
  const corsHeaders = getCorsHeaders(req);

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
    if (isRedeemerUser(user)) {
      return forbiddenForRedeemerResponse(corsHeaders);
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

    if (!dealId || typeof dealId !== "string") {
      return new Response(
        JSON.stringify({ error: "Missing deal_id" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // Validate UUID format before hitting the database
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(dealId)) {
      return new Response(
        JSON.stringify({ error: "Invalid deal_id format" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    // 🔍 Fetch and validate deal (before rate limit, so invalid IDs don't exhaust quotas)
    const dealSelectNew =
      "id, business_id, location_id, offer_definition_id, offer_version_id, start_time, end_time, claim_cutoff_buffer_minutes, max_claims, is_active, is_demo, is_recurring, days_of_week, window_start_minutes, window_end_minutes, timezone, deal_status, eligibility_status, businesses(repeat_claim_policy_type, repeat_claim_cooldown_days)";
    const dealSelectLegacy =
      "id, business_id, start_time, end_time, claim_cutoff_buffer_minutes, max_claims, is_active, is_demo, is_recurring, days_of_week, window_start_minutes, window_end_minutes, timezone";
    let dealResult = await supabase
      .from("deals")
      .select(dealSelectNew)
      .eq("id", dealId)
      .single();
    if (isMissingNewDealSelectColumn(dealResult.error)) {
      dealResult = await supabase
        .from("deals")
        .select(dealSelectLegacy)
        .eq("id", dealId)
        .single();
    }
    const { data: deal, error: dealError } = dealResult;

    if (dealError || !deal) {
      return new Response(
        JSON.stringify({ error: "Deal not found" }),
        {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
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

    if (!deal.is_active) {
      return new Response(
        JSON.stringify({ error: "This deal is not active" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const dealStatus = typeof deal.deal_status === "string" ? deal.deal_status : "LIVE";
    const eligibilityStatus = typeof deal.eligibility_status === "string" ? deal.eligibility_status : "UNKNOWN";
    if (dealStatus === "DRAFT_INVALID" || eligibilityStatus === "INVALID") {
      return new Response(
        JSON.stringify({
          error: "This deal is not eligible to claim.",
          error_code: "DEAL_NOT_ELIGIBLE",
        }),
        {
          status: 409,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }
    if (dealStatus !== "LIVE" && dealStatus !== "UNKNOWN") {
      return new Response(
        JSON.stringify({ error: "This deal is not active" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // 🚦 Rate limit: max 3 claim attempts per minute per user
    // Placed after deal validation so invalid IDs don't exhaust legitimate users' quotas.
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

    if (!deal.end_time) {
      return new Response(
        JSON.stringify({ error: "Deal is misconfigured (missing end time)" }),
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
      // Format in the deal's timezone — server-side toLocaleString() is UTC,
      // which reads as the wrong time to the user.
      const tzForCutoff =
        typeof deal.timezone === "string" && deal.timezone.trim().length > 0
          ? deal.timezone.trim()
          : DEFAULT_BUSINESS_TZ;
      let cutoffLabel: string;
      try {
        cutoffLabel = new Intl.DateTimeFormat("en-US", {
          timeZone: tzForCutoff,
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }).format(claimCutoffTime);
      } catch {
        cutoffLabel = claimCutoffTime.toISOString();
      }
      return new Response(
        JSON.stringify({
          error: `Claiming has closed. Cutoff was ${cutoffLabel}`,
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
      if (tz === DEFAULT_BUSINESS_TZ && deal.timezone !== DEFAULT_BUSINESS_TZ) {
        console.warn(`[claim-deal] deal ${dealId} has empty/missing timezone, falling back to ${DEFAULT_BUSINESS_TZ}`);
      }

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
      const statusActive = (unredeemedRows ?? []).filter(
        (row: { claim_status?: string | null }) =>
          row.claim_status === "active" || row.claim_status === "redeeming",
      );
      // Audit F-004: a claim is only "over" at the shared redeem deadline
      // (expires_at + grace, per-row grace_period_minutes) — never at nominal
      // expiry. Redemption honors the grace window, so claim bookkeeping must
      // too, or a still-redeemable claim gets expired here and a second
      // logical claim allowed while the first can still be redeemed.
      const isPastDeadline = (row: { expires_at: string; grace_period_minutes?: number | null }) => {
        const expires = Date.parse(row.expires_at);
        if (!Number.isFinite(expires)) return false;
        return isPastRedeemDeadline(nowMs, row.expires_at, row.grace_period_minutes as number);
      };
      const staleIds = (statusActive as { id: string; expires_at: string; grace_period_minutes?: number | null }[])
        .filter(isPastDeadline)
        .map((row) => row.id);
      if (staleIds.length > 0) {
        await supabaseAdmin
          .from("deal_claims")
          .update({ claim_status: "expired", redeem_started_at: null })
          .in("id", staleIds)
          .eq("user_id", user.id)
          .in("claim_status", ["active", "redeeming"])
          .is("redeemed_at", null);
      }
      const activeRows = statusActive.filter((row: {
        expires_at: string;
        grace_period_minutes?: number | null;
      }) => {
        const expires = Date.parse(row.expires_at);
        return Number.isFinite(expires) && !isPastDeadline(row);
      });

      const forThisDeal = activeRows.find((r: { deal_id: string }) => r.deal_id === dealId);
      if (forThisDeal) {
        const fc = forThisDeal as {
          id: string;
          token: string | null;
          expires_at: string;
          short_code: string | null;
          grace_period_minutes?: number | null;
        };
        return new Response(
          JSON.stringify({
            claim_id: fc.id,
            token: fc.token ?? null,
            expires_at: fc.expires_at,
            // A grace-window claim has nominal expires_at in the past but is
            // still redeemable; the client needs the grace to render the
            // correct redeem-by countdown instead of showing it expired.
            grace_period_minutes: fc.grace_period_minutes ?? null,
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
              "You already have an active deal in your wallet. Redeem it, let it expire, or release it before claiming another.",
            error_code: "CUSTOMER_ALREADY_HAS_ACTIVE_DEAL",
            activeClaimId: (activeRows[0] as { id?: string } | undefined)?.id ?? null,
          }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
    }

    const suspendedLocation =
      await getSuspendedLocation(
        supabaseAdmin as any,
        (deal as { location_id?: string | null }).location_id ?? null,
      ) ??
        await getSuspendedPrimaryBusinessLocation(supabaseAdmin as any, businessId);
    if (suspendedLocation) {
      return new Response(
        JSON.stringify(suspendedLocationResponseBody("claim new deals")),
        {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        },
      );
    }

    // Repeat limits are business-level and count only successful redemptions.
    const businessPolicyRow = Array.isArray(deal.businesses)
      ? deal.businesses[0]
      : (deal.businesses as { repeat_claim_policy_type?: string | null; repeat_claim_cooldown_days?: number | null } | null);
    const repeatPolicyType = normalizeRepeatClaimPolicyType(businessPolicyRow?.repeat_claim_policy_type);
    const repeatCooldownDays =
      typeof businessPolicyRow?.repeat_claim_cooldown_days === "number"
        ? businessPolicyRow.repeat_claim_cooldown_days
        : null;

    if (repeatPolicyType !== "NONE") {
      let priorRedeemResult = await supabaseAdmin
        .from("deal_claims")
        .select("id, redeemed_at")
        .eq("user_id", user.id)
        .eq("business_id", businessId)
        .eq("claim_status", "redeemed")
        .not("redeemed_at", "is", null)
        .order("redeemed_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (isMissingNewClaimColumn(priorRedeemResult.error)) {
        priorRedeemResult = await supabaseAdmin
          .from("deal_claims")
          .select("id, redeemed_at")
          .eq("user_id", user.id)
          .in("deal_id", businessDealIds)
          .eq("claim_status", "redeemed")
          .not("redeemed_at", "is", null)
          .order("redeemed_at", { ascending: false })
          .limit(1)
          .maybeSingle();
      }

      if (priorRedeemResult.error) {
        console.error("repeat policy redemption lookup:", priorRedeemResult.error);
      } else if (priorRedeemResult.data?.redeemed_at) {
        const repeatBlock = evaluateRepeatClaimPolicy({
          policyType: repeatPolicyType,
          cooldownDays: repeatCooldownDays,
          lastRedeemedAt: priorRedeemResult.data.redeemed_at as string,
          nowMs,
        });
        if (repeatBlock) {
          return new Response(
            JSON.stringify({
              error: repeatBlock.message,
              error_code: repeatBlock.errorCode,
              ...("nextEligibleAt" in repeatBlock ? { nextEligibleAt: repeatBlock.nextEligibleAt } : {}),
            }),
            {
              status: 409,
              headers: { ...corsHeaders, "Content-Type": "application/json" },
            },
          );
        }
      }
    }

    // 📊 Check max_claims limit (count all claims, not just redeemed)
    if (deal.max_claims !== null && deal.max_claims > 0) {
      const { count, error: countError } = await supabase
        .from("deal_claims")
        .select("*", { count: "exact", head: true })
        .eq("deal_id", dealId)
        .neq("claim_status", "canceled");

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
    const token = `twofer://redeem/${crypto.randomUUID()}`;
    const qrTokenHash = await sha256Base64Url(token);
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
      const claimInsertRow = {
          deal_id: dealId,
          user_id: user.id,
          business_id: businessId,
          location_id: (deal as { location_id?: string | null }).location_id ?? null,
          offer_definition_id: (deal as { offer_definition_id?: string | null }).offer_definition_id ?? null,
          offer_version_id: (deal as { offer_version_id?: string | null }).offer_version_id ?? null,
          token: null,
          qr_token_hash: qrTokenHash,
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
        };
      let insertResult = await supabaseAdmin
        .from("deal_claims")
        .insert(claimInsertRow)
        .select("id")
        .single();
      if (isMissingNewClaimColumn(insertResult.error)) {
        insertResult = await supabaseAdmin
          .from("deal_claims")
          .insert({ ...omitNewClaimColumns(claimInsertRow), token })
          .select("id")
          .single();
      }
      const { data: inserted, error: err } = insertResult;
      if (!err && inserted?.id) {
        short_code = code;
        newClaimId = inserted.id as string;
        insertError = null;
        break;
      }
      insertError = err ?? { message: "insert failed" };
      // Retry only on short_code unique constraint violations.
      // Check both constraint detail and message for robustness across PG versions.
      if (err?.code === "23505") {
        const detail = String(err?.details ?? err?.message ?? "");
        if (detail.includes("short_code") || detail.includes("deal_claims_short_code")) {
          continue;
        }
      }
      break;
    }

    if (insertError || !short_code || !newClaimId) {
      console.error("Insert error:", insertError);
      if (isClaimLimitReachedError(insertError)) {
        return new Response(
          JSON.stringify({ error: "This deal has reached its claim limit." }),
          {
            status: 409,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          },
        );
      }
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

    // 🔔 Owner notification (new claim / sold out, spec 11.8 minimum).
    // Server-side only so it cannot be spoofed; best-effort so a push failure
    // never blocks or fails the claim itself. Until the
    // 20260713120000_business_claim_notifications migration is applied, the
    // select below errors on the missing column and the catch keeps this inert.
    try {
      const { data: pushRow } = await supabaseAdmin
        .from("deals")
        .select("title, claim_push_last_sent_at, businesses(owner_id, preferred_locale, claim_notifications_enabled)")
        .eq("id", dealId)
        .single();
      const ownerBiz = pushRow?.businesses as unknown as {
        owner_id: string | null;
        preferred_locale: string | null;
        claim_notifications_enabled: boolean | null;
      } | null;
      // Skip self-claims (legacy accounts where the claimer owns the business).
      if (pushRow && ownerBiz?.owner_id && ownerBiz.owner_id !== user.id) {
        let claimCount: number | null = null;
        if (deal.max_claims !== null && deal.max_claims > 0) {
          const { count } = await supabaseAdmin
            .from("deal_claims")
            .select("*", { count: "exact", head: true })
            .eq("deal_id", dealId)
            .neq("claim_status", "canceled");
          claimCount = count;
        }
        const lastSentMs = pushRow.claim_push_last_sent_at
          ? Date.parse(pushRow.claim_push_last_sent_at)
          : NaN;
        const kind = decideOwnerClaimPush({
          notificationsEnabled: ownerBiz.claim_notifications_enabled !== false,
          maxClaims: deal.max_claims ?? null,
          claimCount,
          nowMs: Date.now(),
          lastClaimPushAtMs: Number.isFinite(lastSentMs) ? lastSentMs : null,
        });
        if (kind) {
          if (kind === "new_claim") {
            // Record the send time before sending to narrow the duplicate window.
            await supabaseAdmin
              .from("deals")
              .update({ claim_push_last_sent_at: new Date().toISOString() })
              .eq("id", dealId);
          }
          // Consent gate: push_tokens rows only exist for devices that granted
          // OS notification permission (and are removed on sign-out).
          const { data: tokenRows } = await supabaseAdmin
            .from("push_tokens")
            .select("expo_push_token")
            .eq("user_id", ownerBiz.owner_id);
          const ownerTokens = (tokenRows ?? [])
            .map((r: { expo_push_token: string | null }) => r.expo_push_token?.trim())
            .filter((tk): tk is string => Boolean(tk));
          if (ownerTokens.length > 0) {
            const msg = buildOwnerClaimPushMessage(
              kind,
              resolveOwnerPushLocale(ownerBiz.preferred_locale),
              pushRow.title as string | null,
            );
            await sendExpoPushBatch(ownerTokens, msg.title, msg.body, { path: "/dashboard" });
          }
        }
      }
    } catch (pushErr) {
      console.error("[claim-deal] owner push failed (non-fatal):", pushErr);
    }

    // Native wallet pass: mirror the new claim onto the customer's Twofer Card.
    // Best-effort and flag-gated; a no-op until the user has added the card.
    await syncWalletPassForUser(supabaseAdmin, user.id);

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
