#!/usr/bin/env node
/**
 * READ-ONLY dry-run impact report for the two pending billing migrations:
 *   - 20260803120000_expire_billing_access_cron_schedule.sql (schema/cron only, no data impact)
 *   - 20260803121000_billing_access_state_backfill.sql (data repair — this is what we're previewing)
 *
 * This script issues SELECT-only queries that mirror each part of the backfill
 * migration's WHERE clauses, so it reports exactly which rows would change
 * without changing anything. It never INSERTs, UPDATEs, or DELETEs.
 *
 * It does not print emails, names, addresses, or raw Stripe customer/subscription
 * IDs — only counts, boolean flags, and id prefixes (first 8 chars of each uuid)
 * so results are safe to paste into a report.
 *
 * Required env:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 *
 * Run:  SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/dry-run-billing-migration-impact.mjs
 */

import { createClient } from "@supabase/supabase-js";

const required = ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"];
const missing = required.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error(`Missing required env: ${missing.join(", ")}`);
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const COMPED_ACCESS_LEVELS = new Set(["admin_comped", "partner_comped", "internal_test"]);
const shortId = (id) => (typeof id === "string" ? id.slice(0, 8) : "(none)");

function resolveBusinessAccessLevelForAppAccessStatus(appAccessStatus, currentAccessLevel) {
  if (currentAccessLevel && COMPED_ACCESS_LEVELS.has(currentAccessLevel)) return null;
  switch (appAccessStatus) {
    case "active":
    case "past_due_grace":
      return "paid";
    case "trialing":
      return "full_trial";
    case "trial_limited":
      return "limited_trial";
    case "canceled":
    case "expired":
    case "blocked":
    case "suspended":
      return "none";
    default:
      return null;
  }
}

function resolveLocationEntitlementStatus(appAccessStatus, trialType, cancelAtPeriodEnd) {
  switch (appAccessStatus) {
    case "trial_limited":
      return "admin_trial_active";
    case "trialing":
      return trialType === "stripe_trial" ? (cancelAtPeriodEnd ? "trial_canceling" : "trial_active") : "admin_trial_active";
    case "active":
      return cancelAtPeriodEnd ? "pro_canceling" : "pro_active";
    case "past_due_grace":
      return "pro_active";
    case "canceled":
    case "expired":
    case "blocked":
    case "suspended":
      return "canceled_suspended";
    case "comped":
      return null;
    default:
      return "trial_eligible";
  }
}

async function fetchAll(table, select) {
  const { data, error } = await supabase.from(table).select(select);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
}

async function main() {
  const report = {};

  const businesses = await fetchAll(
    "businesses",
    "id,access_level,status",
  );
  report.total_businesses = businesses.length;

  const subscriptions = await fetchAll(
    "business_subscriptions",
    "business_id,billing_status,app_access_status,trial_type,trial_start,trial_end,current_period_start,current_period_end,cancel_at_period_end,grace_period_until,stripe_customer_id,stripe_subscription_id",
  );
  const subsByBusiness = new Map(subscriptions.map((s) => [s.business_id, s]));
  report.total_business_subscriptions_rows = subscriptions.length;
  report.businesses_with_no_subscription_row = businesses.length - subscriptions.length;

  // --- Part 1 preview: missing trial_end backfill ---------------------------
  const missingTrialEnd = subscriptions.filter(
    (s) => ["trialing", "trial_limited"].includes(s.app_access_status) && !s.trial_end,
  );
  const applications = await fetchAll(
    "business_applications",
    "business_id,trial_days,reviewed_at,created_at",
  );
  const latestTrialDaysByBusiness = new Map();
  for (const app of applications) {
    if (!app.business_id || app.trial_days == null) continue;
    const existing = latestTrialDaysByBusiness.get(app.business_id);
    const appTime = new Date(app.reviewed_at ?? app.created_at ?? 0).getTime();
    const existingTime = existing ? new Date(existing.reviewed_at ?? existing.created_at ?? 0).getTime() : -1;
    if (!existing || appTime > existingTime) latestTrialDaysByBusiness.set(app.business_id, app);
  }
  const missingTrialEndFixable = missingTrialEnd.filter((s) => latestTrialDaysByBusiness.has(s.business_id));
  const missingTrialEndUnfixable = missingTrialEnd.filter((s) => !latestTrialDaysByBusiness.has(s.business_id));
  report.part1_missing_trial_end_total = missingTrialEnd.length;
  report.part1_missing_trial_end_will_be_backfilled = missingTrialEndFixable.length;
  report.part1_missing_trial_end_no_application_trial_days_found = missingTrialEndUnfixable.length;
  report.part1_sample_business_ids = missingTrialEnd.slice(0, 10).map((s) => shortId(s.business_id));

  // --- Part 2 preview: access_level downgrade --------------------------------
  const businessById = new Map(businesses.map((b) => [b.id, b]));
  const downgradeCandidates = subscriptions.filter((s) => {
    const biz = businessById.get(s.business_id);
    if (!biz) return false;
    return (
      ["canceled", "expired", "blocked", "suspended"].includes(s.app_access_status) &&
      ["paid", "full_trial", "limited_trial"].includes(biz.access_level) &&
      !COMPED_ACCESS_LEVELS.has(biz.access_level)
    );
  });
  report.part2_businesses_to_downgrade = downgradeCandidates.length;
  report.part2_sample_business_ids = downgradeCandidates.slice(0, 10).map((s) => shortId(s.business_id));

  // --- Part 3 preview: location_entitlements upsert --------------------------
  const locations = await fetchAll("business_locations", "id,business_id,created_at");
  const primaryLocationByBusiness = new Map();
  for (const loc of [...locations].sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id.localeCompare(b.id))) {
    if (!primaryLocationByBusiness.has(loc.business_id)) primaryLocationByBusiness.set(loc.business_id, loc.id);
  }
  const entitlements = await fetchAll("location_entitlements", "business_location_id,status,suspended_at");
  const entitlementByLocation = new Map(entitlements.map((e) => [e.business_location_id, e]));

  let willCreate = 0;
  let willUpdate = 0;
  let noLocationYet = 0;
  for (const s of downgradeCandidates) {
    const locationId = primaryLocationByBusiness.get(s.business_id);
    if (!locationId) {
      noLocationYet++;
      continue;
    }
    if (entitlementByLocation.has(locationId)) willUpdate++;
    else willCreate++;
  }
  report.part3_location_entitlements_will_create = willCreate;
  report.part3_location_entitlements_will_update = willUpdate;
  report.part3_downgrade_candidates_with_no_business_location = noLocationYet;

  // --- Businesses with no business_locations row at all (any status) --------
  report.businesses_with_no_business_locations_row =
    businesses.length - new Set(locations.map((l) => l.business_id)).size;

  // --- Full drift audit: business_subscriptions vs businesses vs location_entitlements ---
  let mismatches = 0;
  const mismatchSamples = [];
  for (const biz of businesses) {
    if (COMPED_ACCESS_LEVELS.has(biz.access_level)) continue;
    const sub = subsByBusiness.get(biz.id);
    if (!sub) continue;
    const expectedAccessLevel = resolveBusinessAccessLevelForAppAccessStatus(sub.app_access_status, biz.access_level);
    const accessLevelMismatch = expectedAccessLevel !== null && expectedAccessLevel !== biz.access_level;

    const locationId = primaryLocationByBusiness.get(biz.id);
    const entitlement = locationId ? entitlementByLocation.get(locationId) : null;
    const expectedLocationStatus = resolveLocationEntitlementStatus(
      sub.app_access_status,
      sub.trial_type,
      Boolean(sub.cancel_at_period_end),
    );
    const locationStatusMismatch =
      expectedLocationStatus !== null && (!entitlement || entitlement.status !== expectedLocationStatus);

    if (accessLevelMismatch || locationStatusMismatch) {
      mismatches++;
      if (mismatchSamples.length < 10) {
        mismatchSamples.push({
          business_id: shortId(biz.id),
          app_access_status: sub.app_access_status,
          access_level_actual: biz.access_level,
          access_level_expected: expectedAccessLevel,
          location_status_actual: entitlement?.status ?? "(no row)",
          location_status_expected: expectedLocationStatus,
        });
      }
    }
  }
  report.total_drift_mismatches_before_migration = mismatches;
  report.drift_mismatch_samples = mismatchSamples;

  // --- Stripe customer / subscription ID presence -----------------------------
  const withStripeCustomer = subscriptions.filter((s) => s.stripe_customer_id);
  const withStripeSubscription = subscriptions.filter((s) => s.stripe_subscription_id);
  report.subscriptions_with_stripe_customer_id = withStripeCustomer.length;
  report.subscriptions_with_stripe_subscription_id = withStripeSubscription.length;

  const billingProfiles = await fetchAll(
    "business_billing_profiles",
    "business_id,stripe_customer_id,stripe_customer_livemode,stripe_sync_status",
  );
  report.billing_profiles_with_stripe_customer_id = billingProfiles.filter((p) => p.stripe_customer_id).length;
  report.billing_profiles_livemode_true = billingProfiles.filter((p) => p.stripe_customer_livemode === true).length;
  report.billing_profiles_livemode_false_or_null = billingProfiles.filter((p) => p.stripe_customer_livemode !== true).length;

  const { data: runtimeConfig } = await supabase
    .from("app_runtime_config")
    .select("billing_environment,purchase_surface")
    .eq("id", 1)
    .maybeSingle();
  report.runtime_billing_environment = runtimeConfig?.billing_environment ?? "(unknown)";
  report.runtime_purchase_surface = runtimeConfig?.purchase_surface ?? "(unknown)";

  // --- Test / pilot / comped / internal accounts -------------------------------
  report.comped_or_internal_businesses = businesses.filter((b) => COMPED_ACCESS_LEVELS.has(b.access_level)).length;
  const smokeBusinessId = process.env.TWOFER_SMOKE_BUSINESS_ID;
  if (smokeBusinessId) {
    const smokeBiz = businessById.get(smokeBusinessId);
    report.known_smoke_business_present = Boolean(smokeBiz);
    report.known_smoke_business_access_level = smokeBiz?.access_level ?? null;
  }

  console.log(JSON.stringify(report, null, 2));
}

main().catch((err) => {
  console.error("dry-run failed:", err.message);
  process.exit(1);
});
