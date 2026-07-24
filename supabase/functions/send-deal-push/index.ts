import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendExpoPushMessages, type ExpoPushMessage } from "../_shared/expo-push.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import {
  getSuspendedLocation,
  getPrimaryBusinessLocationId,
  getSuspendedPrimaryBusinessLocation,
  suspendedLocationResponseBody,
} from "../_shared/billing-suspension.ts";
import {
  businessVerificationRequiredResponseBody,
  isBusinessLocationPublishVerified,
} from "../_shared/business-verification.ts";
import {
  buildDealReleasePushCopy,
  fetchProfileLocaleByUserId,
} from "../_shared/viewer-locale.ts";
import {
  dealReleaseScheduledFor,
  resolveDealReleaseNotificationState,
  type DealReleaseNotificationState,
} from "../../../lib/deal-release-notification.ts";
import { getBusinessCapabilities } from "../_shared/business-capabilities.ts";
import { getServiceRoleKey } from "../_shared/service-role-key.ts";

const BASE_DEAL_SELECT = "id,title,business_id,location_id,start_time,end_time,is_active,max_claims,businesses(name,owner_id)";
const STRUCTURED_DEAL_SELECT = [
  "id",
  "title",
  "title_en",
  "title_es",
  "title_ko",
  "source_locale",
  "business_id",
  "location_id",
  "start_time",
  "end_time",
  "is_active",
  "max_claims",
  "deal_type",
  "applies_to",
  "discount_percent",
  "customer_value_percent",
  "required_purchase_quantity",
  "free_item_quantity",
  "required_item_description",
  "required_item_retail_value_cents",
  "free_item_description",
  "free_item_retail_value_cents",
  "free_item_discount_percent",
  "item_description",
  "item_retail_value_cents",
  "timezone",
  "businesses(name,owner_id,location,address)",
].join(",");
const DEAL_RELEASE_PUSH_KIND = "deal_release_push";
const MAX_DUE_DEAL_PUSHES = 100;

type DealPushBusiness = {
  name: string | null;
  owner_id: string | null;
};

type DealPushRow = Record<string, unknown> & {
  id: string;
  title: string | null;
  business_id: string;
  location_id?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  is_active?: boolean | null;
  businesses: DealPushBusiness | DealPushBusiness[] | null;
};

type DealPushEventStatus =
  | "pending"
  | "sent"
  | "skipped_no_audience"
  | "skipped_no_tokens"
  | "skipped_not_live"
  | "send_error";

type DealPushAudienceResult = {
  sent: number;
  errors: number;
  audience: number;
  tokens: number;
  status: Exclude<DealPushEventStatus, "pending">;
  reason?: string;
};

function isMissingStructuredColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === "PGRST204" || error?.code === "42703";
}

function isMissingDealPushEventsTable(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === "42P01" || error?.code === "PGRST205";
}

function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === "23505";
}

function normalizeBusiness(deal: DealPushRow): DealPushBusiness | null {
  return Array.isArray(deal.businesses) ? deal.businesses[0] ?? null : deal.businesses;
}

async function isCronAuthorized(admin: any, provided: string | null): Promise<boolean> {
  const envSecret = Deno.env.get("CRON_SECRET");
  if (envSecret && provided && provided === envSecret) return true;
  if (!provided) return false;

  try {
    const { data } = await admin.rpc("verify_deal_release_push_secret", { p_secret: provided });
    return data === true;
  } catch {
    return false;
  }
}

async function fetchDealById(admin: any, dealId: string): Promise<{ deal: DealPushRow | null; error: unknown }> {
  let dealQuery = await admin
    .from("deals")
    .select(STRUCTURED_DEAL_SELECT)
    .eq("id", dealId)
    .single();
  if (isMissingStructuredColumn(dealQuery.error)) {
    dealQuery = await admin
      .from("deals")
      .select(BASE_DEAL_SELECT)
      .eq("id", dealId)
      .single();
  }
  return {
    deal: dealQuery.data as unknown as DealPushRow | null,
    error: dealQuery.error,
  };
}

async function fetchDealsByIds(admin: any, dealIds: string[]): Promise<{ deals: DealPushRow[]; error: unknown }> {
  if (dealIds.length === 0) return { deals: [], error: null };

  let dealQuery = await admin
    .from("deals")
    .select(STRUCTURED_DEAL_SELECT)
    .in("id", dealIds);
  if (isMissingStructuredColumn(dealQuery.error)) {
    dealQuery = await admin
      .from("deals")
      .select(BASE_DEAL_SELECT)
      .in("id", dealIds);
  }
  return {
    deals: (dealQuery.data ?? []) as unknown as DealPushRow[],
    error: dealQuery.error,
  };
}

async function reserveDealPushEvent(
  admin: any,
  deal: DealPushRow,
  scheduledFor: string,
  metadata: Record<string, unknown>,
): Promise<{ id: string | null; duplicate: boolean; unavailable: boolean }> {
  const { data, error } = await admin
    .from("deal_push_events")
    .insert({
      deal_id: deal.id,
      business_id: deal.business_id,
      push_kind: DEAL_RELEASE_PUSH_KIND,
      scheduled_for: scheduledFor,
      send_status: "pending",
      metadata,
    })
    .select("id")
    .single();

  if (error) {
    if (isUniqueViolation(error)) return { id: null, duplicate: true, unavailable: false };
    if (isMissingDealPushEventsTable(error)) return { id: null, duplicate: false, unavailable: true };
    console.error("[send-deal-push] deal push event reservation failed:", error);
    return { id: null, duplicate: false, unavailable: false };
  }

  return { id: typeof data?.id === "string" ? data.id : null, duplicate: false, unavailable: false };
}

async function markDealPushEvent(
  admin: any,
  eventId: string | null,
  status: Exclude<DealPushEventStatus, "pending">,
  tokenCount: number,
  errorCount: number,
  metadata?: Record<string, unknown>,
) {
  if (!eventId) return;

  const payload: Record<string, unknown> = {
    send_status: status,
    sent_at: status === "sent" ? new Date().toISOString() : null,
    token_count: tokenCount,
    error_count: errorCount,
    updated_at: new Date().toISOString(),
  };
  if (metadata) payload.metadata = metadata;

  const { error } = await admin
    .from("deal_push_events")
    .update(payload)
    .eq("id", eventId);

  if (error) {
    console.error("[send-deal-push] deal push event update failed:", error);
  }
}

async function rescheduleDealPushEvent(admin: any, eventId: string, scheduledFor: string) {
  const { error } = await admin
    .from("deal_push_events")
    .update({
      scheduled_for: scheduledFor,
      updated_at: new Date().toISOString(),
      metadata: { reason: "deal_start_moved_later" },
    })
    .eq("id", eventId);

  if (error) {
    console.error("[send-deal-push] deal push event reschedule failed:", error);
  }
}

async function sendDealPushToAudience(
  admin: any,
  deal: DealPushRow,
  ownerUserId: string | null,
): Promise<DealPushAudienceResult> {
  const { data: favRows } = await admin
    .from("favorites")
    .select("user_id")
    .eq("business_id", deal.business_id);

  const favUserIds = new Set<string>((favRows ?? []).map((r: { user_id: string }) => r.user_id));

  if (favUserIds.size === 0) {
    return {
      sent: 0,
      errors: 0,
      audience: 0,
      tokens: 0,
      status: "skipped_no_audience",
      reason: "no favorites",
    };
  }

  const { data: optedInRows } = await admin
    .from("consumer_profiles")
    .select("user_id")
    .in("user_id", [...favUserIds])
    .eq("deal_alerts_enabled", true)
    .neq("notification_mode", "none");

  const allUserIds = new Set<string>((optedInRows ?? []).map((r: { user_id: string }) => r.user_id));
  if (ownerUserId) allUserIds.delete(ownerUserId);

  if (allUserIds.size === 0) {
    return {
      sent: 0,
      errors: 0,
      audience: 0,
      tokens: 0,
      status: "skipped_no_audience",
      reason: "no opted-in consumers",
    };
  }

  const { data: tokenRows } = await admin
    .from("push_tokens")
    .select("user_id,expo_push_token")
    .in("user_id", [...allUserIds]);

  const tokenToUserId = new Map<string, string>();
  for (const row of tokenRows ?? []) {
    const token = (row as { expo_push_token?: string }).expo_push_token?.trim();
    const userId = (row as { user_id?: string }).user_id;
    if (token && userId && !tokenToUserId.has(token)) tokenToUserId.set(token, userId);
  }

  if (tokenToUserId.size === 0) {
    return {
      sent: 0,
      errors: 0,
      audience: allUserIds.size,
      tokens: 0,
      status: "skipped_no_tokens",
      reason: "no push tokens",
    };
  }

  const localeByUserId = await fetchProfileLocaleByUserId(admin, [...allUserIds]);
  const messages: ExpoPushMessage[] = [...tokenToUserId.entries()].map(([token, userId]) => {
    const pushCopy = buildDealReleasePushCopy(deal, localeByUserId.get(userId) ?? "en-US");
    return {
      to: token,
      title: pushCopy.title,
      body: pushCopy.body,
      data: {
        dealId: deal.id,
        path: `/deal/${deal.id}`,
      },
      sound: "default",
      channelId: "deal-alerts",
    };
  });

  const result = await sendExpoPushMessages(messages);

  return {
    ...result,
    audience: allUserIds.size,
    tokens: messages.length,
    status: result.sent > 0 ? "sent" : "send_error",
  };
}

async function dispatchDueDealPushes(admin: any, dryRun: boolean): Promise<Record<string, unknown>> {
  const nowMs = Date.now();
  const nowIso = new Date(nowMs).toISOString();

  const { data: eventRows, error: eventErr } = await admin
    .from("deal_push_events")
    .select("id,deal_id,scheduled_for")
    .eq("push_kind", DEAL_RELEASE_PUSH_KIND)
    .eq("send_status", "pending")
    .lte("scheduled_for", nowIso)
    .order("scheduled_for", { ascending: true })
    .limit(MAX_DUE_DEAL_PUSHES);

  if (eventErr) {
    if (isMissingDealPushEventsTable(eventErr)) {
      return { ok: false, sent: 0, reason: "deal push events migration not applied" };
    }
    console.error("[send-deal-push] due event query failed:", eventErr);
    return { ok: false, sent: 0, reason: "due event query failed" };
  }

  const dueEvents = (eventRows ?? []) as { id: string; deal_id: string; scheduled_for: string }[];
  if (dueEvents.length === 0) {
    return { ok: true, candidates: 0, sent: 0, reason: "no due deal release pushes" };
  }

  if (dryRun) {
    return {
      ok: true,
      dry_run: true,
      candidates: dueEvents.length,
      oldest_scheduled_for: dueEvents[0]?.scheduled_for ?? null,
    };
  }

  const { deals, error: dealsErr } = await fetchDealsByIds(
    admin,
    [...new Set(dueEvents.map((event) => event.deal_id))],
  );
  if (dealsErr) {
    console.error("[send-deal-push] due deal query failed:", dealsErr);
    return { ok: false, sent: 0, reason: "due deal query failed" };
  }

  const dealsById = new Map(deals.map((deal) => [deal.id, deal]));
  let sent = 0;
  let errors = 0;
  let skipped = 0;
  let rescheduled = 0;
  let audience = 0;
  let tokens = 0;

  for (const event of dueEvents) {
    const deal = dealsById.get(event.deal_id);
    if (!deal) {
      skipped++;
      await markDealPushEvent(admin, event.id, "skipped_not_live", 0, 0, { reason: "deal_missing" });
      continue;
    }

    const state = resolveDealReleaseNotificationState(deal, nowMs);
    if (state === "upcoming") {
      const scheduledFor = dealReleaseScheduledFor(deal);
      if (scheduledFor) {
        rescheduled++;
        await rescheduleDealPushEvent(admin, event.id, scheduledFor);
        continue;
      }
    }

    if (state !== "live") {
      skipped++;
      await markDealPushEvent(admin, event.id, "skipped_not_live", 0, 0, { reason: state });
      continue;
    }

    const capabilities = await getBusinessCapabilities(admin as any, deal.business_id);
    if (!capabilities.can_publish_offer) {
      skipped++;
      await markDealPushEvent(admin, event.id, "skipped_not_live", 0, 0, {
        reason: `business_capability:${capabilities.reason_code}`,
      });
      continue;
    }

    const business = normalizeBusiness(deal);
    const result = await sendDealPushToAudience(admin, deal, business?.owner_id ?? null);
    sent += result.sent;
    errors += result.errors;
    audience += result.audience;
    tokens += result.tokens;
    if (result.status !== "sent") skipped++;

    await markDealPushEvent(admin, event.id, result.status, result.tokens, result.errors, {
      reason: result.reason ?? "deal_release",
    });
  }

  return {
    ok: true,
    candidates: dueEvents.length,
    sent,
    errors,
    skipped,
    rescheduled,
    audience,
    tokens,
  };
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  function jsonResponse(body: Record<string, unknown>, status = 200) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = getServiceRoleKey();
    const admin = createClient(supabaseUrl, serviceKey);

    let body: { deal_id?: string; dispatch_due?: boolean; dry_run?: boolean };
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "Invalid JSON" }, 400);
    }

    if (body?.dispatch_due === true) {
      if (!(await isCronAuthorized(admin as any, req.headers.get("x-cron-secret")))) {
        return jsonResponse({ error: "Unauthorized" }, 401);
      }
      const result = await dispatchDueDealPushes(admin as any, body.dry_run === true);
      return jsonResponse(result, result.ok === false ? 500 : 200);
    }

    const authClient = createClient(supabaseUrl, serviceKey, {
      global: { headers: { Authorization: req.headers.get("Authorization")! } },
    });

    const {
      data: { user },
      error: authErr,
    } = await authClient.auth.getUser();
    if (authErr || !user) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }
    if (isRedeemerUser(user)) {
      return forbiddenForRedeemerResponse(corsHeaders);
    }

    const dealId = body?.deal_id;
    if (!dealId || typeof dealId !== "string") {
      return jsonResponse({ error: "deal_id is required" }, 400);
    }

    const { deal, error: dealErr } = await fetchDealById(admin as any, dealId);

    if (dealErr || !deal) {
      return jsonResponse({ error: "Deal not found" }, 404);
    }

    const biz = normalizeBusiness(deal);

    if (!biz || biz.owner_id !== user.id) {
      return jsonResponse({ error: "Not your deal" }, 403);
    }

    const capabilities = await getBusinessCapabilities(admin as any, deal.business_id);
    if (!capabilities.can_publish_offer) {
      return jsonResponse(
        {
          error: "Business access does not currently allow deal notifications.",
          error_code: "BUSINESS_NOTIFICATION_CAPABILITY_REQUIRED",
          reason_code: capabilities.reason_code,
        },
        403,
      );
    }

    const suspendedLocation =
      await getSuspendedLocation(admin as any, typeof deal.location_id === "string" ? deal.location_id : null) ??
        await getSuspendedPrimaryBusinessLocation(admin as any, deal.business_id);
    if (suspendedLocation) {
      return jsonResponse(suspendedLocationResponseBody("send deal notifications"), 403);
    }

    const publishLocationId =
      typeof deal.location_id === "string" && deal.location_id.trim()
        ? deal.location_id.trim()
        : await getPrimaryBusinessLocationId(admin as any, deal.business_id);
    const publishVerified = await isBusinessLocationPublishVerified(admin as any, publishLocationId);
    if (!publishVerified) {
      return jsonResponse(businessVerificationRequiredResponseBody("send deal notifications"), 403);
    }

    const nowMs = Date.now();
    const releaseState: DealReleaseNotificationState = resolveDealReleaseNotificationState(deal, nowMs);
    const scheduledFor = dealReleaseScheduledFor(deal);
    if (releaseState === "upcoming") {
      if (!scheduledFor) {
        return jsonResponse({ sent: 0, errors: 0, audience: 0, reason: "invalid release time" });
      }
      const event = await reserveDealPushEvent(admin as any, deal, scheduledFor, {
        reason: "scheduled_for_release",
        source: "merchant_publish",
      });
      return jsonResponse({
        ok: true,
        sent: 0,
        errors: 0,
        audience: 0,
        scheduled: !event.unavailable,
        already_scheduled: event.duplicate,
        release_at: scheduledFor,
        reason: event.unavailable ? "deal push events migration not applied" : "scheduled for release",
      });
    }

    if (releaseState !== "live") {
      return jsonResponse({ ok: true, sent: 0, errors: 0, audience: 0, reason: releaseState });
    }

    const event = scheduledFor
      ? await reserveDealPushEvent(admin as any, deal, scheduledFor, {
          reason: "immediate_live_release",
          source: "merchant_publish",
        })
      : { id: null, duplicate: false, unavailable: false };

    if (event.duplicate) {
      return jsonResponse({
        ok: true,
        sent: 0,
        errors: 0,
        audience: 0,
        reason: "release push already reserved",
      });
    }

    const result = await sendDealPushToAudience(admin as any, deal, user.id);
    await markDealPushEvent(admin as any, event.id, result.status, result.tokens, result.errors, {
      reason: result.reason ?? "merchant_publish_live_release",
    });

    return jsonResponse({
      ...result,
    });
  } catch (err) {
    console.error("[send-deal-push] Unhandled error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
