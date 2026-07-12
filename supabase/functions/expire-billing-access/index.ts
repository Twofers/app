// Cron-triggered sweep that downgrades access for business subscriptions the
// client can never expire on its own:
//  - admin card-free trials whose trial_end has passed without conversion
//  - Stripe subscriptions whose past-due grace_period_until has passed
//    without the payment recovering
//
// Both queries are naturally idempotent: once a row is flipped to `expired`
// it no longer matches its own WHERE clause, so repeated/overlapping cron
// runs cannot double-process the same business.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { applyBusinessBillingAccessState } from "../_shared/business-location-entitlement-sync.ts";

const MAX_CANDIDATES = 500;

type SubscriptionRow = {
  business_id: string;
  trial_type: string | null;
  trial_start: string | null;
  trial_end: string | null;
  current_period_start: string | null;
  current_period_end: string | null;
  cancel_at_period_end: boolean | null;
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

async function expireTrials(admin: any, nowIso: string, dryRun: boolean) {
  const { data: rows, error } = await admin
    .from("business_subscriptions")
    .select("business_id,trial_type,trial_start,trial_end,current_period_start,current_period_end,cancel_at_period_end")
    .in("app_access_status", ["trialing", "trial_limited"])
    .not("trial_end", "is", null)
    .lt("trial_end", nowIso)
    .limit(MAX_CANDIDATES);
  if (error) throw error;

  const candidates = (rows ?? []) as SubscriptionRow[];
  if (dryRun) return { candidates: candidates.length, processed: 0 };

  let processed = 0;
  for (const row of candidates) {
    const { error: updateError } = await admin
      .from("business_subscriptions")
      .update({ app_access_status: "expired", billing_status: "none", updated_at: nowIso })
      .eq("business_id", row.business_id)
      .in("app_access_status", ["trialing", "trial_limited"]);
    if (updateError) {
      console.error("[expire-billing-access] trial expiry update failed:", updateError);
      continue;
    }
    await applyBusinessBillingAccessState({
      supabase: admin,
      businessId: row.business_id,
      provider: "admin",
      appAccessStatus: "expired",
      trialType: row.trial_type,
      trialStart: row.trial_start,
      trialEnd: row.trial_end,
      currentPeriodStart: row.current_period_start,
      currentPeriodEnd: row.current_period_end,
      cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    });
    // resolveBusinessStatusForAppAccessStatus("expired", ...) is intentionally a
    // no-op — "expired" is ambiguous between a trial running out (here) and a
    // paid grace period lapsing (expireGracePeriods below), and those need
    // different businesses.status labels. Set the trial-specific one directly.
    await admin
      .from("businesses")
      .update({ status: "trial_expired", updated_at: nowIso })
      .eq("id", row.business_id)
      .not("access_level", "in", '("admin_comped","partner_comped","internal_test")');
    processed++;
  }
  return { candidates: candidates.length, processed };
}

async function expireGracePeriods(admin: any, nowIso: string, dryRun: boolean) {
  const { data: rows, error } = await admin
    .from("business_subscriptions")
    .select("business_id,trial_type,trial_start,trial_end,current_period_start,current_period_end,cancel_at_period_end")
    .eq("app_access_status", "past_due_grace")
    .not("grace_period_until", "is", null)
    .lt("grace_period_until", nowIso)
    .limit(MAX_CANDIDATES);
  if (error) throw error;

  const candidates = (rows ?? []) as SubscriptionRow[];
  if (dryRun) return { candidates: candidates.length, processed: 0 };

  let processed = 0;
  for (const row of candidates) {
    const { error: updateError } = await admin
      .from("business_subscriptions")
      .update({ app_access_status: "expired", updated_at: nowIso })
      .eq("business_id", row.business_id)
      .eq("app_access_status", "past_due_grace");
    if (updateError) {
      console.error("[expire-billing-access] grace expiry update failed:", updateError);
      continue;
    }
    await applyBusinessBillingAccessState({
      supabase: admin,
      businessId: row.business_id,
      provider: "stripe",
      appAccessStatus: "expired",
      trialType: row.trial_type,
      trialStart: row.trial_start,
      trialEnd: row.trial_end,
      currentPeriodStart: row.current_period_start,
      currentPeriodEnd: row.current_period_end,
      cancelAtPeriodEnd: Boolean(row.cancel_at_period_end),
    });
    // See the equivalent note in expireTrials — "expired" is ambiguous, so the
    // paid-grace-lapsed label is set here directly rather than in the shared resolver.
    await admin
      .from("businesses")
      .update({ status: "canceled", updated_at: nowIso })
      .eq("id", row.business_id)
      .not("access_level", "in", '("admin_comped","partner_comped","internal_test")');
    processed++;
  }
  return { candidates: candidates.length, processed };
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
  const nowIso = new Date().toISOString();

  try {
    const trials = await expireTrials(admin, nowIso, dryRun);
    const grace = await expireGracePeriods(admin, nowIso, dryRun);
    return jsonResponse({
      ok: true,
      dry_run: dryRun,
      trial_expirations: trials,
      grace_expirations: grace,
    });
  } catch (err) {
    console.error("[expire-billing-access] Unhandled error:", err);
    return jsonResponse({ error: "Internal server error" }, 500);
  }
});
