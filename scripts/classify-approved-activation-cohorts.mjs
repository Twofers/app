#!/usr/bin/env node
/**
 * READ-ONLY activation cohort report for the approved-not-activated rollout.
 *
 * This script issues SELECT-only queries. It does not INSERT, UPDATE, DELETE,
 * call RPCs, deploy functions, or apply migrations. Output intentionally avoids
 * names, emails, addresses, Stripe ids, claim tokens, QR tokens, and codes.
 *
 * Required env:
 * - SUPABASE_URL
 * - SUPABASE_SERVICE_ROLE_KEY
 *
 * Run:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/classify-approved-activation-cohorts.mjs
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

const APPROVED_LEGACY_STATUSES = new Set(["trial_limited", "trial_active", "approved_not_billed"]);
const APPROVED_SETUP_STATUSES = new Set(["approved_not_activated"]);
const ACTIVE_APP_ACCESS = new Set(["trial_limited", "trialing", "active", "past_due_grace", "comped"]);
const NONTERMINAL_STRIPE_BILLING = new Set(["trialing", "active", "past_due", "unpaid", "incomplete", "paused"]);
const TERMINAL_APP_ACCESS = new Set(["expired", "blocked", "suspended", "canceled"]);
const COMPED_ACCESS_LEVELS = new Set(["admin_comped", "partner_comped", "internal_test"]);

const shortId = (id) => (typeof id === "string" ? id.slice(0, 8) : "(none)");
const add = (map, key, id) => {
  const entry = map.get(key) ?? { count: 0, sample_ids: [] };
  entry.count += 1;
  if (entry.sample_ids.length < 10 && id) entry.sample_ids.push(shortId(id));
  map.set(key, entry);
};

async function fetchAll(table, select) {
  const rows = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(select)
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

function usageFlagsForBusiness(businessId, indexes) {
  const locationIds = indexes.locationsByBusiness.get(businessId) ?? [];
  const dealIds = indexes.dealsByBusiness.get(businessId) ?? [];
  const claimCount = dealIds.reduce((count, dealId) => count + (indexes.claimsByDeal.get(dealId) ?? 0), 0);
  const redemptionCount = dealIds.reduce((count, dealId) => count + (indexes.redemptionsByDeal.get(dealId) ?? 0), 0);
  const creditRows = locationIds.reduce((count, locationId) => count + (indexes.creditPeriodsByLocation.get(locationId) ?? 0), 0);
  const creditUseRows = locationIds.reduce((count, locationId) => count + (indexes.creditUseByLocation.get(locationId) ?? 0), 0);
  const subscription = indexes.subscriptionsByBusiness.get(businessId);
  const hasActiveStripeSubscription = Boolean(
    subscription?.stripe_subscription_id &&
      NONTERMINAL_STRIPE_BILLING.has(subscription.billing_status),
  );
  const nowMs = Date.now();
  const hasLiveDeal = dealIds.some((dealId) => {
    const deal = indexes.dealById.get(dealId);
    return deal?.is_active === true && (!deal.end_time || Date.parse(deal.end_time) > nowMs);
  });

  return {
    has_live_deals: hasLiveDeal,
    has_claims: claimCount > 0,
    has_redemptions: redemptionCount > 0,
    has_successful_ai: (indexes.successfulAiByBusiness.get(businessId) ?? 0) > 0,
    has_trial_or_paid_credit_periods: creditRows > 0,
    has_credit_consumption: creditUseRows > 0,
    has_active_stripe_subscription: hasActiveStripeSubscription,
  };
}

function hasAnyUsage(flags) {
  return [
    "has_live_deals",
    "has_claims",
    "has_redemptions",
    "has_successful_ai",
    "has_credit_consumption",
    "has_active_stripe_subscription",
  ].some((key) => flags[key] === true);
}

async function main() {
  const [
    applications,
    businesses,
    subscriptions,
    locations,
    deals,
    claims,
    aiLogs,
    aiCosts,
    creditPeriods,
    creditLedger,
  ] = await Promise.all([
    fetchAll("business_applications", "id,business_id,status,access_tier,trial_days,reviewed_at,created_at"),
    fetchAll("businesses", "id,status,access_level,first_approved_at"),
    fetchAll("business_subscriptions", "business_id,billing_mode,billing_status,app_access_status,trial_type,trial_start,trial_end,stripe_subscription_id"),
    fetchAll("business_locations", "id,business_id"),
    fetchAll("deals", "id,business_id,is_active,end_time"),
    fetchAll("deal_claims", "id,deal_id,redeemed_at"),
    fetchAll("ai_generation_logs", "id,business_id,success,quota_blocked,openai_called"),
    fetchAll("ai_generation_costs", "id,business_id,provider,success,estimated_cost_usd"),
    fetchAll("deal_credit_periods", "id,business_location_id,source,status,credits_used,credits_reserved"),
    fetchAll("deal_credit_ledger", "id,business_location_id,event_type,amount"),
  ]);

  const indexes = {
    subscriptionsByBusiness: new Map(subscriptions.map((row) => [row.business_id, row])),
    locationsByBusiness: new Map(),
    dealsByBusiness: new Map(),
    dealById: new Map(),
    claimsByDeal: new Map(),
    redemptionsByDeal: new Map(),
    successfulAiByBusiness: new Map(),
    creditPeriodsByLocation: new Map(),
    creditUseByLocation: new Map(),
  };

  for (const row of locations) {
    if (!row.business_id) continue;
    const list = indexes.locationsByBusiness.get(row.business_id) ?? [];
    list.push(row.id);
    indexes.locationsByBusiness.set(row.business_id, list);
  }
  for (const row of deals) {
    if (!row.business_id) continue;
    const list = indexes.dealsByBusiness.get(row.business_id) ?? [];
    list.push(row.id);
    indexes.dealsByBusiness.set(row.business_id, list);
    indexes.dealById.set(row.id, row);
  }
  for (const row of claims) {
    indexes.claimsByDeal.set(row.deal_id, (indexes.claimsByDeal.get(row.deal_id) ?? 0) + 1);
    if (row.redeemed_at) {
      indexes.redemptionsByDeal.set(row.deal_id, (indexes.redemptionsByDeal.get(row.deal_id) ?? 0) + 1);
    }
  }
  for (const row of aiLogs) {
    if (row.business_id && row.success === true && row.openai_called === true) {
      indexes.successfulAiByBusiness.set(row.business_id, (indexes.successfulAiByBusiness.get(row.business_id) ?? 0) + 1);
    }
  }
  for (const row of aiCosts) {
    if (
      row.business_id &&
      row.success === true &&
      (Number(row.estimated_cost_usd) > 0 || typeof row.provider === "string")
    ) {
      indexes.successfulAiByBusiness.set(
        row.business_id,
        (indexes.successfulAiByBusiness.get(row.business_id) ?? 0) + 1,
      );
    }
  }
  for (const row of creditPeriods) {
    indexes.creditPeriodsByLocation.set(row.business_location_id, (indexes.creditPeriodsByLocation.get(row.business_location_id) ?? 0) + 1);
    if ((Number(row.credits_used) || 0) > 0 || (Number(row.credits_reserved) || 0) > 0) {
      indexes.creditUseByLocation.set(row.business_location_id, (indexes.creditUseByLocation.get(row.business_location_id) ?? 0) + 1);
    }
  }
  for (const row of creditLedger) {
    if ((row.event_type === "reserve" || row.event_type === "commit") && Number(row.amount) > 0) {
      indexes.creditUseByLocation.set(row.business_location_id, (indexes.creditUseByLocation.get(row.business_location_id) ?? 0) + 1);
    }
  }

  const businessById = new Map(businesses.map((row) => [row.id, row]));
  const cohorts = new Map();
  const usageBreakdown = new Map();

  for (const application of applications) {
    const appId = application.id;
    const businessId = application.business_id;
    const business = businessId ? businessById.get(businessId) : null;
    const subscription = businessId ? indexes.subscriptionsByBusiness.get(businessId) : null;
    const flags = businessId ? usageFlagsForBusiness(businessId, indexes) : {};
    const used = businessId ? hasAnyUsage(flags) : false;

    if (!businessId && APPROVED_SETUP_STATUSES.has(application.status)) {
      add(cohorts, "approved_not_activated_without_account", appId);
      continue;
    }
    if (!businessId && APPROVED_LEGACY_STATUSES.has(application.status)) {
      add(cohorts, "legacy_approved_without_account_candidate", appId);
      continue;
    }
    if (!businessId) {
      add(cohorts, `no_account_${application.status}`, appId);
      continue;
    }
    if (
      business &&
      (
        COMPED_ACCESS_LEVELS.has(business.access_level) ||
        subscription?.app_access_status === "comped" ||
        ["admin_comp", "partner_comp"].includes(subscription?.billing_mode) ||
        ["admin_comped", "partner_comped"].includes(subscription?.billing_status)
      )
    ) {
      add(cohorts, "preserve_comped_or_internal", businessId);
      continue;
    }
    if (subscription && ACTIVE_APP_ACCESS.has(subscription.app_access_status) && used) {
      add(cohorts, "preserve_active_or_trial_with_usage", businessId);
      continue;
    }
    if (subscription && ACTIVE_APP_ACCESS.has(subscription.app_access_status) && !used) {
      add(cohorts, "review_active_or_trial_zero_usage", businessId);
      continue;
    }
    if (APPROVED_LEGACY_STATUSES.has(application.status) && !used) {
      add(cohorts, "backfill_candidate_legacy_approved_zero_usage", businessId);
      continue;
    }
    if (APPROVED_LEGACY_STATUSES.has(application.status) && used) {
      add(cohorts, "preserve_legacy_approved_with_usage", businessId);
      continue;
    }
    if (APPROVED_SETUP_STATUSES.has(application.status)) {
      add(cohorts, "already_approved_not_activated", businessId);
      continue;
    }
    if (subscription && TERMINAL_APP_ACCESS.has(subscription.app_access_status)) {
      add(cohorts, `preserve_terminal_${subscription.app_access_status}`, businessId);
      continue;
    }
    add(cohorts, `preserve_application_${application.status}`, appId);
  }

  for (const business of businesses) {
    const flags = usageFlagsForBusiness(business.id, indexes);
    for (const [flag, value] of Object.entries(flags)) {
      if (value) add(usageBreakdown, flag, business.id);
    }
  }

  const report = {
    generated_at: new Date().toISOString(),
    read_only: true,
    totals: {
      applications: applications.length,
      businesses: businesses.length,
      business_subscriptions: subscriptions.length,
      business_locations: locations.length,
      deals: deals.length,
      deal_claims: claims.length,
      ai_generation_logs: aiLogs.length,
      ai_generation_costs: aiCosts.length,
      deal_credit_periods: creditPeriods.length,
    },
    cohorts: Object.fromEntries([...cohorts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    usage_breakdown: Object.fromEntries([...usageBreakdown.entries()].sort(([a], [b]) => a.localeCompare(b))),
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error("activation cohort classification failed:", error.message);
  process.exit(1);
});
