// Cron-triggered 24-hour trial-ending billing reminder push.
//
// This job is dormant until deployed and scheduled. It records a server-owned
// reminder event before sending so a location cannot receive duplicate 24-hour
// charge reminders if cron retries or overlaps.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { sendExpoPushMessages, type ExpoPushMessage } from "../_shared/expo-push.ts";
import {
  TRIAL_ENDING_PUSH_KIND,
  TRIAL_ENDING_PUSH_MAX_LEAD_HOURS,
  TRIAL_ENDING_PUSH_MIN_LEAD_HOURS,
  buildTrialEndingPushMessage,
  isTrialEndingPushCandidate,
  resolveTrialReminderLocale,
  trialEndingPushScheduledForIso,
} from "../_shared/trial-reminder-push.ts";

const HOUR_MS = 60 * 60 * 1000;
const MAX_CANDIDATES = 500;

type TrialEntitlementRow = {
  business_location_id: string;
  trial_ends_at: string | null;
  business_locations?: {
    business_id?: string | null;
    businesses?: {
      owner_id?: string | null;
      preferred_locale?: string | null;
    } | null;
  } | null;
};

type ReminderCandidate = {
  businessLocationId: string;
  ownerUserId: string;
  trialEndsAt: string;
  scheduledFor: string;
  locale: "en" | "es" | "ko";
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function isAuthorized(admin: any, provided: string | null): Promise<boolean> {
  const envSecret = Deno.env.get("CRON_SECRET");
  if (envSecret && provided && provided === envSecret) return true;
  if (!provided) return false;

  try {
    const { data } = await admin.rpc("verify_billing_reminder_secret", { p_secret: provided });
    return data === true;
  } catch {
    return false;
  }
}

function normalizeLocation(row: TrialEntitlementRow): TrialEntitlementRow["business_locations"] | null {
  const value = row.business_locations as unknown;
  if (Array.isArray(value)) return (value[0] as TrialEntitlementRow["business_locations"]) ?? null;
  return (value as TrialEntitlementRow["business_locations"]) ?? null;
}

function normalizeBusiness(
  location: TrialEntitlementRow["business_locations"] | null,
): NonNullable<NonNullable<TrialEntitlementRow["business_locations"]>["businesses"]> | null {
  const value = location?.businesses as unknown;
  if (Array.isArray(value)) {
    return (value[0] as NonNullable<NonNullable<TrialEntitlementRow["business_locations"]>["businesses"]>) ?? null;
  }
  return (value as NonNullable<NonNullable<TrialEntitlementRow["business_locations"]>["businesses"]>) ?? null;
}

function toCandidate(row: TrialEntitlementRow, nowMs: number): ReminderCandidate | null {
  const trialEndsAt = typeof row.trial_ends_at === "string" ? row.trial_ends_at : null;
  if (!isTrialEndingPushCandidate(trialEndsAt, nowMs)) return null;

  const location = normalizeLocation(row);
  const business = normalizeBusiness(location);
  const ownerUserId = typeof business?.owner_id === "string" ? business.owner_id : "";
  if (!ownerUserId || !trialEndsAt) return null;

  const scheduledFor = trialEndingPushScheduledForIso(trialEndsAt);
  if (!scheduledFor) return null;

  return {
    businessLocationId: row.business_location_id,
    ownerUserId,
    trialEndsAt,
    scheduledFor,
    locale: resolveTrialReminderLocale(business?.preferred_locale),
  };
}

async function reserveReminderEvent(admin: any, candidate: ReminderCandidate): Promise<string | null> {
  const { data, error } = await admin
    .from("billing_trial_reminder_events")
    .insert({
      business_location_id: candidate.businessLocationId,
      owner_user_id: candidate.ownerUserId,
      reminder_kind: TRIAL_ENDING_PUSH_KIND,
      trial_ends_at: candidate.trialEndsAt,
      scheduled_for: candidate.scheduledFor,
      send_status: "pending",
      metadata: {
        locale: candidate.locale,
        route: "/(tabs)/billing",
      },
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return null;
    console.error("[send-trial-ending-reminders] event reservation failed:", error);
    return null;
  }

  return typeof data?.id === "string" ? data.id : null;
}

async function markReminderEvent(
  admin: any,
  id: string,
  status: "sent" | "skipped_no_tokens" | "send_error",
  tokenCount: number,
  errorCount: number,
) {
  const { error } = await admin
    .from("billing_trial_reminder_events")
    .update({
      send_status: status,
      sent_at: status === "sent" ? new Date().toISOString() : null,
      token_count: tokenCount,
      error_count: errorCount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);

  if (error) {
    console.error("[send-trial-ending-reminders] event update failed:", error);
  }
}

serve(async (req) => {
  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, supabaseServiceKey);

  if (!(await isAuthorized(admin, req.headers.get("x-cron-secret")))) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: { dry_run?: boolean } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body is fine */
  }
  const dryRun = body?.dry_run === true;
  const nowMs = Date.now();
  const windowStartIso = new Date(nowMs + TRIAL_ENDING_PUSH_MIN_LEAD_HOURS * HOUR_MS).toISOString();
  const windowEndIso = new Date(nowMs + TRIAL_ENDING_PUSH_MAX_LEAD_HOURS * HOUR_MS).toISOString();

  try {
    const { data: rows, error } = await admin
      .from("location_entitlements")
      .select(
        "business_location_id,trial_ends_at,business_locations!inner(business_id,businesses!inner(owner_id,preferred_locale))",
      )
      .eq("status", "trial_active")
      .gt("trial_ends_at", windowStartIso)
      .lte("trial_ends_at", windowEndIso)
      .limit(MAX_CANDIDATES);

    if (error) {
      console.error("[send-trial-ending-reminders] entitlement query failed:", error);
      return jsonResponse({ error: "entitlement query failed" }, 500);
    }

    const candidates = ((rows ?? []) as TrialEntitlementRow[])
      .map((row) => toCandidate(row, nowMs))
      .filter((candidate): candidate is ReminderCandidate => candidate !== null);

    if (candidates.length === 0) {
      return jsonResponse({ ok: true, candidates: 0, sent: 0, reason: "no trials ending in reminder window" });
    }

    if (dryRun) {
      return jsonResponse({
        ok: true,
        dry_run: true,
        candidates: candidates.length,
        reminder_kind: TRIAL_ENDING_PUSH_KIND,
        window_start: windowStartIso,
        window_end: windowEndIso,
      });
    }

    const ownerIds = [...new Set(candidates.map((candidate) => candidate.ownerUserId))];
    const { data: tokenRows, error: tokenError } = await admin
      .from("push_tokens")
      .select("user_id,expo_push_token")
      .in("user_id", ownerIds);

    if (tokenError) {
      console.error("[send-trial-ending-reminders] token query failed:", tokenError);
      return jsonResponse({ error: "token query failed" }, 500);
    }

    const tokensByUser = new Map<string, string[]>();
    for (const row of tokenRows ?? []) {
      const userId = typeof row.user_id === "string" ? row.user_id : "";
      const token = typeof row.expo_push_token === "string" ? row.expo_push_token : "";
      if (!userId || !token) continue;
      const tokens = tokensByUser.get(userId) ?? [];
      tokens.push(token);
      tokensByUser.set(userId, tokens);
    }

    let reserved = 0;
    let skippedDuplicates = 0;
    let skippedNoTokens = 0;
    let sent = 0;
    let errors = 0;

    for (const candidate of candidates) {
      const eventId = await reserveReminderEvent(admin, candidate);
      if (!eventId) {
        skippedDuplicates++;
        continue;
      }
      reserved++;

      const tokens = [...new Set(tokensByUser.get(candidate.ownerUserId) ?? [])];
      if (tokens.length === 0) {
        skippedNoTokens++;
        await markReminderEvent(admin, eventId, "skipped_no_tokens", 0, 0);
        continue;
      }

      const message = buildTrialEndingPushMessage(candidate.locale);
      const messages: ExpoPushMessage[] = tokens.map((token) => ({
        to: token,
        title: message.title,
        body: message.body,
        data: {
          path: "/(tabs)/billing",
          reminder_kind: TRIAL_ENDING_PUSH_KIND,
        },
        sound: "default",
        channelId: "deal-alerts",
      }));

      const result = await sendExpoPushMessages(messages);
      sent += result.sent;
      errors += result.errors;
      await markReminderEvent(
        admin,
        eventId,
        result.sent > 0 ? "sent" : "send_error",
        messages.length,
        result.errors,
      );
    }

    return jsonResponse({
      ok: true,
      candidates: candidates.length,
      reserved,
      skipped_duplicates: skippedDuplicates,
      skipped_no_tokens: skippedNoTokens,
      sent,
      errors,
    });
  } catch (err) {
    console.error("[send-trial-ending-reminders] Unhandled error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
