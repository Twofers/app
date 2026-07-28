import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import { isAal2 } from "../_shared/admin-mfa.ts";
import {
  AI_QUOTA_SCOPES,
  countAiQuotaUsage,
  type AiQuotaScope,
} from "../_shared/ai-quota-resets.ts";
import { resolveDealTranslateMonthlyLimit } from "../_shared/deal-translate-limit.ts";
import { tryGetServiceRoleKey } from "../_shared/service-role-key.ts";

type AdminRole =
  | "owner"
  | "admin"
  | "support"
  | "sales"
  | "finance"
  | "moderator"
  | "developer"
  | "read_only";

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

function hasReadableAdminRole(role: unknown): role is AdminRole {
  return (
    role === "owner" ||
    role === "admin" ||
    role === "support" ||
    role === "sales" ||
    role === "finance" ||
    role === "moderator" ||
    role === "developer" ||
    role === "read_only"
  );
}

async function countRows(query: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  const { count, error } = await query;
  if (error) throw error;
  return count ?? 0;
}

// Like countRows but never throws: a missing table or transient error yields 0.
// Used for soft metrics (e.g. content-report queue) that must not be able to take
// down the whole dashboard summary if their table isn't present in every env yet.
async function countRowsSafe(query: PromiseLike<{ count: number | null; error: unknown }>): Promise<number> {
  try {
    const { count, error } = await query;
    if (error) return 0;
    return count ?? 0;
  } catch {
    return 0;
  }
}

const SECTION_NAMES = [
  "businesses",
  "offers",
  "redemptions",
  "billing_events",
  "audit_log",
  "settings",
  "business_detail",
  "owner_view",
  "prospects",
  "prospect_detail",
] as const;
type SectionName = (typeof SECTION_NAMES)[number];

function isSectionName(value: unknown): value is SectionName {
  return typeof value === "string" && (SECTION_NAMES as readonly string[]).includes(value);
}

async function readPayload(req: Request): Promise<Record<string, unknown>> {
  try {
    return await req.json();
  } catch {
    return {};
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

async function ownerEmailsForBusinesses(
  supabaseAdmin: any,
  businessIds: string[],
): Promise<Map<string, string>> {
  const emails = new Map<string, string>();
  if (!businessIds.length) return emails;
  const { data, error } = await supabaseAdmin
    .from("business_applications")
    .select("business_id,email")
    .in("business_id", businessIds);
  if (error) throw error;
  for (const row of (data ?? []) as Array<{ business_id?: string; email?: string }>) {
    if (row.business_id && row.email && !emails.has(row.business_id)) {
      emails.set(row.business_id, row.email);
    }
  }
  return emails;
}

function cleanText(value: unknown, max = 100): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function latestById(rows: Array<Record<string, unknown>>, key: string): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const id = typeof row[key] === "string" ? row[key] as string : "";
    if (id && !map.has(id)) map.set(id, row);
  }
  return map;
}

function sumDemandByTarget(rows: Array<Record<string, unknown>>, key: "prospect_id" | "business_id") {
  const map = new Map<string, { demand_count: number; unique_users_count: number }>();
  for (const row of rows) {
    const id = typeof row[key] === "string" ? row[key] as string : "";
    if (!id) continue;
    const current = map.get(id) ?? { demand_count: 0, unique_users_count: 0 };
    current.demand_count +=
      (Number(row.favorites_count) || 0) +
      (Number(row.requests_count) || 0) +
      (Number(row.views_count) || 0);
    current.unique_users_count = Math.max(current.unique_users_count, Number(row.unique_users_count) || 0);
    map.set(id, current);
  }
  return map;
}

function dateOrNull(value: unknown): Date | null {
  if (typeof value !== "string" || !value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function latestIso(current: string | null, candidate: unknown): string | null {
  const candidateDate = dateOrNull(candidate);
  if (!candidateDate) return current;
  const currentDate = dateOrNull(current);
  return !currentDate || candidateDate.getTime() > currentDate.getTime() ? candidateDate.toISOString() : current;
}

function earliestIso(current: string | null, candidate: unknown): string | null {
  const candidateDate = dateOrNull(candidate);
  if (!candidateDate) return current;
  const currentDate = dateOrNull(current);
  return !currentDate || candidateDate.getTime() < currentDate.getTime() ? candidateDate.toISOString() : current;
}

function daysBetween(fromIso: string | null, to: Date): number | null {
  const from = dateOrNull(fromIso);
  if (!from) return null;
  return Math.max(0, Math.floor((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000)));
}

function daysUntil(toIso: string | null, now: Date): number | null {
  const to = dateOrNull(toIso);
  if (!to) return null;
  return Math.ceil((to.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}

type OfferEffectiveStatus = "live" | "scheduled" | "expired" | "inactive";
type RecentDealStatus = OfferEffectiveStatus | "sold_out" | "needs_review";

const ACTIVE_USER_EVENT_NAMES = [
  "app_opened",
  "deal_viewed",
  "deal_claimed",
  "deal_redeemed",
] as const;
const ACTIVE_USER_DEFINITION =
  "Distinct consumer with an app_opened, deal_viewed, deal_claimed, or deal_redeemed event in app_analytics_events in the last 30 days, excluding business-role users.";

// Deals have no separate status enum -- only is_active plus start/end timestamps.
// A stored is_active=true never means "live" on its own: an end_time in the past
// always wins (expired), and a start_time in the future always wins (scheduled).
function offerEffectiveStatus(
  deal: { is_active?: unknown; start_time?: unknown; end_time?: unknown },
  now: Date,
): OfferEffectiveStatus {
  const start = dateOrNull(deal.start_time);
  const end = dateOrNull(deal.end_time);
  if (end && end.getTime() <= now.getTime()) return "expired";
  if (start && start.getTime() > now.getTime()) return "scheduled";
  return deal.is_active === true ? "live" : "inactive";
}

function rate(numerator: number, denominator: number): number {
  if (!denominator) return 0;
  return Number((numerator / denominator).toFixed(4));
}

function chunks<T>(items: T[], size = 200): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

async function loadActiveConsumerCount(
  supabaseAdmin: any,
  sinceIso: string,
): Promise<number> {
  const userIds = new Set<string>();
  const pageSize = 1000;
  for (let offset = 0;; offset += pageSize) {
    const { data, error } = await supabaseAdmin
      .from("app_analytics_events")
      .select("user_id")
      .in("event_name", [...ACTIVE_USER_EVENT_NAMES])
      .gte("occurred_at", sinceIso)
      .not("user_id", "is", null)
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ user_id?: string | null }>;
    for (const row of rows) {
      if (row.user_id) userIds.add(row.user_id);
    }
    if (rows.length < pageSize) break;
  }
  if (!userIds.size) return 0;

  let activeConsumers = 0;
  for (const idChunk of chunks([...userIds])) {
    const { data, error } = await supabaseAdmin
      .from("profiles")
      .select("id,role")
      .in("id", idChunk);
    if (error) throw error;
    activeConsumers += ((data ?? []) as Array<{ role?: string | null }>)
      .filter((profile) => profile.role === "customer")
      .length;
  }
  return activeConsumers;
}

async function loadAccountGrowth(
  supabaseAdmin: any,
  asOfIso: string,
): Promise<Record<string, unknown>> {
  const { data, error } = await supabaseAdmin.rpc("admin_account_growth_summary", {
    p_as_of: asOfIso,
  });
  if (error) throw error;
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("Account growth summary returned an invalid payload.");
  }
  return data as Record<string, unknown>;
}

async function loadDistinctLiveBusinessCount(
  supabaseAdmin: any,
  nowIso: string,
): Promise<number> {
  const businessIds = new Set<string>();
  const pageSize = 1000;
  for (let offset = 0;; offset += pageSize) {
    const { data, error } = await supabaseAdmin
      .from("deals")
      .select("business_id")
      .eq("is_active", true)
      .lte("start_time", nowIso)
      .or(`end_time.is.null,end_time.gt.${nowIso}`)
      .range(offset, offset + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ business_id?: string | null }>;
    for (const row of rows) {
      if (row.business_id) businessIds.add(row.business_id);
    }
    if (rows.length < pageSize) break;
  }
  return businessIds.size;
}

function recentDealStatus(
  deal: Record<string, unknown>,
  claimCount: number,
  now: Date,
): RecentDealStatus {
  const effective = offerEffectiveStatus(deal, now);
  const maxClaims = Number(deal.max_claims || 0);
  if (effective === "live" && maxClaims > 0 && claimCount >= maxClaims) return "sold_out";
  if (effective === "inactive" && (dateOrNull(deal.end_time)?.getTime() ?? 0) > now.getTime()) {
    return "needs_review";
  }
  return effective;
}

async function loadRecentDeals(
  supabaseAdmin: any,
  now: Date,
): Promise<Array<Record<string, unknown>>> {
  const { data, error } = await supabaseAdmin
    .from("deals")
    .select("id,title,business_id,is_active,start_time,end_time,max_claims,created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw error;
  const deals = (data ?? []) as Array<Record<string, unknown>>;
  const dealIds = deals.map((deal) => String(deal.id || "")).filter(Boolean);
  const businessIds = [...new Set(deals.map((deal) => String(deal.business_id || "")).filter(Boolean))];
  const [claimsResult, redemptionsResult, businessesResult] = await Promise.all([
    dealIds.length
      ? supabaseAdmin.from("deal_claims").select("id,deal_id").in("deal_id", dealIds).limit(10000)
      : Promise.resolve({ data: [], error: null }),
    dealIds.length
      ? supabaseAdmin.from("admin_redemption_facts_v1").select("claim_id,deal_id").in("deal_id", dealIds).limit(10000)
      : Promise.resolve({ data: [], error: null }),
    businessIds.length
      ? supabaseAdmin.from("businesses").select("id,name").in("id", businessIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (claimsResult.error) throw claimsResult.error;
  if (redemptionsResult.error) throw redemptionsResult.error;
  if (businessesResult.error) throw businessesResult.error;

  const claimsByDeal = new Map<string, number>();
  for (const claim of (claimsResult.data ?? []) as Array<Record<string, unknown>>) {
    const dealId = String(claim.deal_id || "");
    claimsByDeal.set(dealId, (claimsByDeal.get(dealId) ?? 0) + 1);
  }
  const redemptionsByDeal = new Map<string, number>();
  for (const redemption of (redemptionsResult.data ?? []) as Array<Record<string, unknown>>) {
    const dealId = String(redemption.deal_id || "");
    redemptionsByDeal.set(dealId, (redemptionsByDeal.get(dealId) ?? 0) + 1);
  }
  const businessNames = new Map<string, string>();
  for (const business of (businessesResult.data ?? []) as Array<Record<string, unknown>>) {
    businessNames.set(String(business.id), String(business.name || business.id));
  }

  return deals.map((deal) => {
    const dealId = String(deal.id);
    const claimCount = claimsByDeal.get(dealId) ?? 0;
    const redemptionCount = redemptionsByDeal.get(dealId) ?? 0;
    const maxClaims = Number(deal.max_claims || 0);
    const status = recentDealStatus(deal, claimCount, now);
    return {
      id: dealId,
      business_id: deal.business_id ?? null,
      business_name: businessNames.get(String(deal.business_id || "")) ?? null,
      title: deal.title ?? "",
      status,
      claims: claimCount,
      redemptions: redemptionCount,
      expires_at: deal.end_time ?? null,
      created_at: deal.created_at ?? null,
      anomaly_flags: [
        ...(claimCount > 0 && redemptionCount === 0 ? ["claims_no_redemptions"] : []),
        ...(maxClaims > 0 && redemptionCount > maxClaims ? ["redemptions_over_quantity"] : []),
        ...(status !== "live" && status !== "sold_out" ? ["no_live_offer"] : []),
      ],
    };
  });
}

async function loadOnboardingRows(
  supabaseAdmin: any,
): Promise<Array<Record<string, unknown>>> {
  const approvedStatuses = [
    "approved_not_billed",
    "approved_not_activated",
    "trial_active",
    "trial_limited",
    "active",
  ];
  const { data: applicationData, error: applicationError } = await supabaseAdmin
    .from("business_applications")
    .select("id,business_id,business_name,contact_name,email,status,terms_accepted,created_at")
    .in("status", approvedStatuses)
    .not("business_id", "is", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (applicationError) throw applicationError;
  const applications = (applicationData ?? []) as Array<Record<string, unknown>>;
  const latestApplications = latestById(applications, "business_id");
  const businessIds = [...latestApplications.keys()];
  if (!businessIds.length) return [];

  const [
    businessesResult,
    subscriptionsResult,
    offerVersionsResult,
    dealsResult,
    termsResult,
    redemptionsResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("businesses")
      .select("id,owner_id,name,contact_name,business_email,public_email,address,address_line1,city,state,postal_code,category,phone,status")
      .in("id", businessIds),
    supabaseAdmin
      .from("business_subscriptions")
      .select("business_id,stripe_customer_id,billing_mode,billing_status,app_access_status,trial_start,trial_end,updated_at")
      .in("business_id", businessIds)
      .order("updated_at", { ascending: false }),
    supabaseAdmin
      .from("offer_versions")
      .select("business_id,status,created_at")
      .in("business_id", businessIds),
    supabaseAdmin
      .from("deals")
      .select("id,business_id,is_active,start_time,end_time,created_at")
      .in("business_id", businessIds),
    supabaseAdmin
      .from("terms_acceptances")
      .select("business_id,document_type,accepted_at")
      .in("business_id", businessIds)
      .eq("document_type", "business_terms"),
    supabaseAdmin
      .from("admin_redemption_facts_v1")
      .select("business_id,redeemed_at")
      .in("business_id", businessIds)
      .limit(10000),
  ]);
  for (const result of [
    businessesResult,
    subscriptionsResult,
    offerVersionsResult,
    dealsResult,
    termsResult,
    redemptionsResult,
  ]) {
    if (result.error) throw result.error;
  }

  const businesses = (businessesResult.data ?? []) as Array<Record<string, unknown>>;
  const subscriptions = latestById(
    (subscriptionsResult.data ?? []) as Array<Record<string, unknown>>,
    "business_id",
  );
  const offerCreated = new Set(
    ((offerVersionsResult.data ?? []) as Array<Record<string, unknown>>)
      .map((row) => String(row.business_id || ""))
      .filter(Boolean),
  );
  const published = new Set(
    ((dealsResult.data ?? []) as Array<Record<string, unknown>>)
      .map((row) => String(row.business_id || ""))
      .filter(Boolean),
  );
  const termsAccepted = new Set(
    ((termsResult.data ?? []) as Array<Record<string, unknown>>)
      .map((row) => String(row.business_id || ""))
      .filter(Boolean),
  );
  const redemptionTested = new Set(
    ((redemptionsResult.data ?? []) as Array<Record<string, unknown>>)
      .map((row) => String(row.business_id || ""))
      .filter(Boolean),
  );
  const authByOwner = new Map<string, { email_confirmed_at?: string | null }>();
  await Promise.all(businesses.map(async (business) => {
    const ownerId = String(business.owner_id || "");
    if (!ownerId || authByOwner.has(ownerId)) return;
    const { data, error } = await supabaseAdmin.auth.admin.getUserById(ownerId);
    if (!error && data.user) {
      authByOwner.set(ownerId, {
        email_confirmed_at: data.user.email_confirmed_at ?? null,
      });
    }
  }));

  return businesses.map((business) => {
    const businessId = String(business.id);
    const application = latestApplications.get(businessId)!;
    const subscription = subscriptions.get(businessId) ?? null;
    const businessInfoComplete = [
      business.name,
      business.contact_name,
      business.business_email || business.public_email,
      business.address || business.address_line1,
      business.city,
      business.state,
      business.postal_code,
      business.category,
      business.phone,
    ].every((value) => typeof value === "string" && value.trim().length > 0);
    const appAccessStatus = String(subscription?.app_access_status || "");
    const billingMode = String(subscription?.billing_mode || "");
    const billingStatus = String(subscription?.billing_status || "");
    const checklist = [
      { key: "application_approved", label: "Application approved", complete: true },
      {
        key: "owner_email_verified",
        label: "Owner email verified",
        complete: Boolean(authByOwner.get(String(business.owner_id || ""))?.email_confirmed_at),
      },
      { key: "business_info_complete", label: "Business information complete", complete: businessInfoComplete },
      {
        key: "terms_accepted",
        label: "Business terms accepted",
        complete: application.terms_accepted === true || termsAccepted.has(businessId),
      },
      {
        key: "trial_activated",
        label: "Trial or access activated",
        complete: ["trialing", "trial_limited", "active", "comped"].includes(appAccessStatus),
      },
      {
        key: "billing_confirmed",
        label: "Billing confirmed",
        complete: Boolean(subscription?.stripe_customer_id) ||
          ["admin_comp", "partner_comp"].includes(billingMode) ||
          ["active", "trialing", "admin_comped", "partner_comped"].includes(billingStatus),
      },
      {
        key: "first_offer_created",
        label: "First offer created",
        complete: offerCreated.has(businessId) || published.has(businessId),
      },
      { key: "first_offer_published", label: "First offer published", complete: published.has(businessId) },
      { key: "redemption_tested", label: "Redemption tested", complete: redemptionTested.has(businessId) },
    ];
    const completedCount = checklist.filter((item) => item.complete).length;
    return {
      business_id: businessId,
      business_name: business.name ?? application.business_name ?? businessId,
      owner_email: application.email ?? business.business_email ?? null,
      application_id: application.id ?? null,
      application_status: application.status ?? null,
      business_status: business.status ?? null,
      app_access_status: subscription?.app_access_status ?? null,
      checklist,
      completed_count: completedCount,
      total: checklist.length,
    };
  }).filter((row) => row.completed_count < row.total);
}

async function loadOptionalAiBudget(supabaseAdmin: any): Promise<number | null> {
  const { data, error } = await supabaseAdmin
    .from("feature_flags")
    .select("enabled,rules")
    .eq("key", "admin_ai_monthly_budget")
    .maybeSingle();
  if (error) throw error;
  if (!data?.enabled) return null;
  const value = Number((data.rules as Record<string, unknown> | null)?.monthly_usd);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function queueCategory(row: Record<string, unknown>): string {
  const codes = Array.isArray(row.reason_codes) ? row.reason_codes.map(String) : [];
  if (codes.includes("pending_trial_request")) return "setup";
  if (codes.some((code) => code.includes("redemptions"))) return "redemptions";
  if (codes.includes("no_recent_offers")) return "offers";
  if (codes.some((code) => code.startsWith("ai_"))) return "ai";
  if (codes.includes("trial_ending_soon")) return "billing";
  return "accounts";
}

function queuePriority(score: number): "high" | "medium" | "low" {
  if (score >= 70) return "high";
  if (score >= 45) return "medium";
  return "low";
}

function normalizeQueue(
  businessHealth: Array<Record<string, unknown>>,
  counts: {
    trialRequests: number;
    pendingBusinesses: number;
    failedBillingEvents: number;
    openReports: number;
    offersNeedingReview: number;
  },
): Array<Record<string, unknown>> {
  const healthItems = businessHealth.map((row) => {
    const businessId = String(row.business_id || "");
    const reasonCode = Array.isArray(row.reason_codes) && row.reason_codes.length
      ? String(row.reason_codes[0])
      : "health_review";
    const score = Number(row.attention_score || 0);
    return {
      key: `${reasonCode}:${businessId}`,
      category: queueCategory(row),
      priority: queuePriority(score),
      attention_score: score,
      business_id: businessId || null,
      business_name: row.business_name ?? null,
      title: row.primary_reason ?? "Business health review",
      explanation: row.primary_reason ?? "Business activity needs review.",
      waiting_since: row.trial_request_created_at ?? row.last_offer_at ?? null,
      recommended_action: row.suggested_read_only_action ?? "Review business activity",
      status: "new",
      note: null,
      links: {
        business: businessId ? `/admin/businesses/detail?businessId=${businessId}` : null,
      },
    };
  });
  const countItems = [
    {
      key: "setup:open_trial_requests",
      count: counts.trialRequests,
      category: "setup",
      attention_score: 90,
      title: "Business access requests waiting for review",
      explanation: "Owners cannot continue setup until these requests are reviewed.",
      recommended_action: "Review business access requests",
      href: "/admin/trial-requests",
    },
    {
      key: "setup:pending_verification",
      count: counts.pendingBusinesses,
      category: "setup",
      attention_score: 82,
      title: "Businesses waiting for verification",
      explanation: "Verification gaps can block a business from going fully live.",
      recommended_action: "Review pending business verification",
      href: "/admin/businesses?status=pending_verification",
    },
    {
      key: "billing:failed_events",
      count: counts.failedBillingEvents,
      category: "billing",
      attention_score: 88,
      title: "Failed billing events",
      explanation: "Billing sync failures may affect owner access or payment status.",
      recommended_action: "Review failed billing events",
      href: "/admin/billing/events?status=failed",
    },
    {
      key: "reports:open",
      count: counts.openReports,
      category: "reports",
      attention_score: 76,
      title: "Customer reports waiting for review",
      explanation: "Reported businesses, offers, or customers need an operator decision.",
      recommended_action: "Review open reports",
      href: "/admin/reports",
    },
    {
      key: "offers:needs_review",
      count: counts.offersNeedingReview,
      category: "offers",
      attention_score: 72,
      title: "Offers needing review",
      explanation: "Owner-created offers may need moderation or setup support.",
      recommended_action: "Review offers",
      href: "/admin/offers?status=review",
    },
  ]
    .filter((item) => item.count > 0)
    .map((item) => ({
      ...item,
      priority: queuePriority(item.attention_score),
      business_id: null,
      business_name: null,
      waiting_since: null,
      status: "new",
      note: null,
      links: { primary: item.href },
    }));
  return [...healthItems, ...countItems].sort((left, right) =>
    Number(right.attention_score || 0) - Number(left.attention_score || 0));
}

async function overlayQueueStatuses(
  supabaseAdmin: any,
  queue: Array<Record<string, unknown>>,
): Promise<{ items: Array<Record<string, unknown>>; error: string | null }> {
  const keys = queue.map((item) => String(item.key || "")).filter(Boolean);
  if (!keys.length) return { items: queue, error: null };
  const { data, error } = await supabaseAdmin
    .from("admin_queue_item_status")
    .select("issue_key,status,note,updated_by,updated_at")
    .in("issue_key", keys);
  if (error) {
    console.warn("[admin-dashboard-summary] queue status overlay error:", error);
    return {
      items: queue,
      error: "Queue statuses could not be loaded.",
    };
  }
  const statusByKey = new Map(
    ((data ?? []) as Array<Record<string, unknown>>).map((row) => [String(row.issue_key), row]),
  );
  return {
    items: queue.map((item) => ({
      ...item,
      ...(statusByKey.get(String(item.key)) ?? {}),
    })),
    error: null,
  };
}

function quotaLimitForScope(scope: AiQuotaScope, supabaseAdmin: any, businessId: string): Promise<number> | number {
  if (scope === "deal_translate") return resolveDealTranslateMonthlyLimit(supabaseAdmin, businessId);
  const envName = {
    ad_generation: "AI_MONTHLY_LIMIT",
    compose_offer: "AI_MONTHLY_LIMIT",
    deal_copy: "AI_COPY_MONTHLY_LIMIT",
    deal_suggestions: "AI_INSIGHTS_MONTHLY_LIMIT",
    deal_translate: "AI_TRANSLATE_MONTHLY_LIMIT",
  }[scope];
  const value = Number(Deno.env.get(envName) ?? "30");
  return Number.isFinite(value) && value > 0 ? value : 30;
}

async function aiQuotaSummaryForBusiness(supabaseAdmin: any, businessId: string) {
  let maxUsed = 0;
  let limitForMax = 0;
  for (const scope of AI_QUOTA_SCOPES) {
    const counted = await countAiQuotaUsage(supabaseAdmin, { businessId, scope });
    const limit = await quotaLimitForScope(scope, supabaseAdmin, businessId);
    if (counted.used > maxUsed || (counted.used === maxUsed && limit > limitForMax)) {
      maxUsed = counted.used;
      limitForMax = limit;
    }
  }
  const ratio = limitForMax > 0 ? maxUsed / limitForMax : 0;
  return {
    used: maxUsed,
    limit: limitForMax,
    risk: ratio >= 0.8 ? "high" : ratio >= 0.6 ? "watch" : "normal",
  };
}

type HealthSignalInputs = {
  liveOfferCount: number;
  redemptions30d: number;
  redemptions7d: number;
  claims30d: number;
  lastOfferAt: string | null;
  lastRedeemedAt: string | null;
  firstRedeemedAt: string | null;
  hasPendingApplication: boolean;
  businessStatus: string;
  activeTrial: boolean;
  trialDaysRemaining: number | null;
  aiQuotaRisk: "high" | "watch" | "normal";
  aiCostAvailable: boolean;
  aiMonthCostUsd: number | null;
};

// Single source of truth for the health/attention-score formula, shared by the
// aggregate Business Health list and the single-business detail drilldown so the
// two views can never silently drift apart.
function deriveHealthSignals(input: HealthSignalInputs, now: Date) {
  const fourteenDaysAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const fortyEightHoursAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000);

  const reasonCodes: string[] = [];
  let attentionScore = 0;
  if (input.liveOfferCount > 0 && input.redemptions30d === 0) {
    attentionScore += 45;
    reasonCodes.push("live_offers_no_redemptions");
  }
  if (input.claims30d > 0 && input.redemptions30d === 0) {
    attentionScore += 40;
    reasonCodes.push("claims_no_redemptions");
  }
  if (input.hasPendingApplication) {
    attentionScore += 35;
    reasonCodes.push("pending_trial_request");
  }
  if (input.activeTrial && input.trialDaysRemaining !== null && input.trialDaysRemaining >= 0 && input.trialDaysRemaining <= 7) {
    attentionScore += 30;
    reasonCodes.push("trial_ending_soon");
  }
  const noRecentOffers = (input.businessStatus === "active" || input.businessStatus === "trialing" || input.businessStatus === "limited_trial") &&
    (!input.lastOfferAt || (dateOrNull(input.lastOfferAt)?.getTime() ?? 0) < fourteenDaysAgo.getTime());
  if (noRecentOffers) {
    attentionScore += 25;
    reasonCodes.push("no_recent_offers");
  }
  if (input.aiQuotaRisk === "high") {
    attentionScore += 20;
    reasonCodes.push("ai_quota_high");
  }
  if (input.aiCostAvailable && (input.aiMonthCostUsd ?? 0) >= 10) {
    attentionScore += 15;
    reasonCodes.push("ai_cost_high");
  }
  const recentRedemption = (dateOrNull(input.lastRedeemedAt)?.getTime() ?? 0) >= fortyEightHoursAgo.getTime();
  if (recentRedemption) attentionScore = Math.max(0, attentionScore - 20);

  const firstRedemptionRecent = (dateOrNull(input.firstRedeemedAt)?.getTime() ?? 0) >= sevenDaysAgo.getTime();
  const isCelebrate = input.redemptions7d >= 3 || firstRedemptionRecent;
  const healthLabel = isCelebrate
    ? "celebrate"
    : attentionScore >= 45
      ? "needs_attention"
      : attentionScore > 0
        ? "watch"
        : "healthy";
  const primaryReason = reasonCodes.includes("live_offers_no_redemptions")
    ? "Live offers have no recent redemptions"
    : reasonCodes.includes("claims_no_redemptions")
      ? "Claims are not turning into redemptions"
      : reasonCodes.includes("pending_trial_request")
        ? "Trial request is waiting for review"
        : reasonCodes.includes("trial_ending_soon")
          ? "Active trial is nearing expiration"
          : reasonCodes.includes("no_recent_offers")
            ? "No recent offers are available"
            : reasonCodes.includes("ai_quota_high")
              ? "AI usage is close to quota"
              : isCelebrate
                ? "Recent redemption activity is worth celebrating"
                : "No business health issues found";

  return {
    reasonCodes,
    attentionScore,
    healthLabel,
    primaryReason,
    suggestedReadOnlyAction: isCelebrate
      ? "Celebrate recent redemption momentum"
      : attentionScore > 0
        ? "Review offer performance and merchant setup"
        : "Monitor current business activity",
  };
}

async function loadBusinessHealthRows(
  supabaseAdmin: any,
): Promise<{ rows: Array<Record<string, unknown>>; total: number }> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  const [
    businessesResult,
    dealsResult,
    claimsResult,
    redemptionsResult,
    applicationsResult,
    subscriptionsResult,
    costResult,
  ] = await Promise.all([
    supabaseAdmin
      .from("businesses")
      .select("id,owner_id,name,status,access_level,verification_status,risk_level,created_at")
      .order("created_at", { ascending: false })
      .limit(500),
    supabaseAdmin
      .from("deals")
      .select("id,business_id,is_active,start_time,end_time,created_at")
      .gte("created_at", new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString())
      .limit(10000),
    supabaseAdmin
      .from("deal_claims")
      .select("id,business_id,deal_id,claim_status,created_at")
      .gte("created_at", thirtyDaysAgo.toISOString())
      .limit(10000),
    supabaseAdmin
      .from("admin_redemption_facts_v1")
      .select("claim_id,business_id,deal_id,redeemed_at")
      .limit(10000),
    supabaseAdmin
      .from("business_applications")
      .select("business_id,status,created_at,email")
      .in("status", ["pending_review", "pending_verification", "review_required"])
      .order("created_at", { ascending: false })
      .limit(1000),
    supabaseAdmin
      .from("business_subscriptions")
      .select("business_id,app_access_status,trial_end,current_period_end,updated_at")
      .order("updated_at", { ascending: false })
      .limit(1000),
    supabaseAdmin
      .from("ai_generation_costs")
      .select("business_id,estimated_cost_usd")
      .gte("created_at", new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)).toISOString())
      .limit(10000),
  ]);

  if (businessesResult.error) throw businessesResult.error;
  if (dealsResult.error) throw dealsResult.error;
  if (claimsResult.error) throw claimsResult.error;
  if (redemptionsResult.error) throw redemptionsResult.error;
  if (applicationsResult.error) throw applicationsResult.error;
  if (subscriptionsResult.error) throw subscriptionsResult.error;

  const businesses = (businessesResult.data ?? []) as Array<Record<string, unknown>>;
  const businessIds = businesses.map((row) => String(row.id)).filter(Boolean);
  const ownerEmails = await ownerEmailsForBusinesses(supabaseAdmin, businessIds);

  const stats = new Map<string, {
    liveOfferCount: number;
    activeOrScheduledOfferCount: number;
    lastOfferAt: string | null;
    claims7d: number;
    claims30d: number;
    unredeemedClaims30d: number;
    redemptions7d: number;
    redemptions30d: number;
    lastRedeemedAt: string | null;
    firstRedeemedAt: string | null;
    aiMonthCostUsd: number | null;
  }>();
  for (const id of businessIds) {
    stats.set(id, {
      liveOfferCount: 0,
      activeOrScheduledOfferCount: 0,
      lastOfferAt: null,
      claims7d: 0,
      claims30d: 0,
      unredeemedClaims30d: 0,
      redemptions7d: 0,
      redemptions30d: 0,
      lastRedeemedAt: null,
      firstRedeemedAt: null,
      aiMonthCostUsd: costResult.error ? null : 0,
    });
  }

  const dealToBusiness = new Map<string, string>();
  for (const deal of (dealsResult.data ?? []) as Array<Record<string, unknown>>) {
    const businessId = String(deal.business_id ?? "");
    const dealId = String(deal.id ?? "");
    if (!businessId || !stats.has(businessId)) continue;
    if (dealId) dealToBusiness.set(dealId, businessId);
    const row = stats.get(businessId)!;
    const effectiveStatus = offerEffectiveStatus(deal, now);
    const isCurrent = effectiveStatus === "live";
    const isScheduled = effectiveStatus === "scheduled";
    if (isCurrent) row.liveOfferCount += 1;
    if (isCurrent || isScheduled) row.activeOrScheduledOfferCount += 1;
    row.lastOfferAt = latestIso(row.lastOfferAt, deal.created_at || deal.start_time);
  }

  for (const claim of (claimsResult.data ?? []) as Array<Record<string, unknown>>) {
    const businessId = String(claim.business_id ?? dealToBusiness.get(String(claim.deal_id ?? "")) ?? "");
    if (!businessId || !stats.has(businessId)) continue;
    const createdAt = dateOrNull(claim.created_at);
    if (!createdAt) continue;
    const row = stats.get(businessId)!;
    row.claims30d += 1;
    if (createdAt.getTime() >= sevenDaysAgo.getTime()) row.claims7d += 1;
    if (claim.claim_status !== "redeemed") row.unredeemedClaims30d += 1;
  }

  for (const redemption of (redemptionsResult.data ?? []) as Array<Record<string, unknown>>) {
    const businessId = String(redemption.business_id ?? dealToBusiness.get(String(redemption.deal_id ?? "")) ?? "");
    if (!businessId || !stats.has(businessId)) continue;
    const redeemedAt = dateOrNull(redemption.redeemed_at);
    if (!redeemedAt) continue;
    const row = stats.get(businessId)!;
    row.firstRedeemedAt = earliestIso(row.firstRedeemedAt, redemption.redeemed_at);
    row.lastRedeemedAt = latestIso(row.lastRedeemedAt, redemption.redeemed_at);
    if (redeemedAt.getTime() >= thirtyDaysAgo.getTime()) row.redemptions30d += 1;
    if (redeemedAt.getTime() >= sevenDaysAgo.getTime()) row.redemptions7d += 1;
  }

  if (!costResult.error) {
    for (const cost of (costResult.data ?? []) as Array<Record<string, unknown>>) {
      const businessId = String(cost.business_id ?? "");
      if (!businessId || !stats.has(businessId)) continue;
      const businessStats = stats.get(businessId)!;
      businessStats.aiMonthCostUsd = (businessStats.aiMonthCostUsd ?? 0) + (Number(cost.estimated_cost_usd) || 0);
    }
  }

  const applicationByBusiness = latestById((applicationsResult.data ?? []) as Array<Record<string, unknown>>, "business_id");
  const subscriptionByBusiness = latestById((subscriptionsResult.data ?? []) as Array<Record<string, unknown>>, "business_id");
  const rows = await Promise.all(businesses.map(async (business) => {
    const businessId = String(business.id);
    const row = stats.get(businessId)!;
    const application = applicationByBusiness.get(businessId) ?? null;
    const subscription = subscriptionByBusiness.get(businessId) ?? null;
    const trialEnd = latestIso(null, subscription?.trial_end || subscription?.current_period_end);
    const trialDaysRemaining = daysUntil(trialEnd, now);
    const activeTrial = subscription?.app_access_status === "trialing" || subscription?.app_access_status === "trial_limited";
    const quota = await aiQuotaSummaryForBusiness(supabaseAdmin, businessId);
    const status = String(business.status ?? "");
    const aiMonthCostUsd = row.aiMonthCostUsd;
    const aiCostAvailable = aiMonthCostUsd !== null;

    const signals = deriveHealthSignals({
      liveOfferCount: row.liveOfferCount,
      redemptions30d: row.redemptions30d,
      redemptions7d: row.redemptions7d,
      claims30d: row.claims30d,
      lastOfferAt: row.lastOfferAt,
      lastRedeemedAt: row.lastRedeemedAt,
      firstRedeemedAt: row.firstRedeemedAt,
      hasPendingApplication: Boolean(application),
      businessStatus: status,
      activeTrial,
      trialDaysRemaining,
      aiQuotaRisk: quota.risk as "high" | "watch" | "normal",
      aiCostAvailable,
      aiMonthCostUsd,
    }, now);

    return {
      business_id: businessId,
      business_name: business.name ?? businessId,
      owner_email: ownerEmails.get(businessId) ?? null,
      status: business.status ?? null,
      access_level: business.access_level ?? null,
      verification_status: business.verification_status ?? null,
      risk_level: business.risk_level ?? null,
      live_offer_count: row.liveOfferCount,
      active_or_scheduled_offer_count: row.activeOrScheduledOfferCount,
      last_offer_at: row.lastOfferAt,
      days_since_last_offer: daysBetween(row.lastOfferAt, now),
      claims_7d: row.claims7d,
      claims_30d: row.claims30d,
      unredeemed_claims_30d: row.unredeemedClaims30d,
      redemptions_7d: row.redemptions7d,
      redemptions_30d: row.redemptions30d,
      last_redeemed_at: row.lastRedeemedAt,
      claim_to_redemption_rate_30d: rate(row.redemptions30d, row.claims30d),
      trial_request_status: application?.status ?? null,
      trial_request_created_at: application?.created_at ?? null,
      trial_app_access_status: subscription?.app_access_status ?? null,
      trial_ends_at: trialEnd,
      trial_days_remaining: trialDaysRemaining,
      ai_month_used_max: quota.used,
      ai_month_limit_for_max: quota.limit,
      ai_quota_risk: quota.risk,
      ai_month_cost_usd: aiCostAvailable ? Number(aiMonthCostUsd.toFixed(6)) : null,
      ai_cost_available: aiCostAvailable,
      health_label: signals.healthLabel,
      primary_reason: signals.primaryReason,
      reason_codes: signals.reasonCodes,
      attention_score: signals.attentionScore,
      suggested_read_only_action: signals.suggestedReadOnlyAction,
    };
  }));

  const sortedRows = rows
    .filter((row) => row.health_label !== "healthy" || Number(row.attention_score) > 0)
    .sort((left, right) => {
      const scoreDiff = Number(right.attention_score) - Number(left.attention_score);
      if (scoreDiff) return scoreDiff;
      const leftTrial = left.trial_days_remaining === null || left.trial_days_remaining === undefined
        ? Number.POSITIVE_INFINITY
        : Number(left.trial_days_remaining);
      const rightTrial = right.trial_days_remaining === null || right.trial_days_remaining === undefined
        ? Number.POSITIVE_INFINITY
        : Number(right.trial_days_remaining);
      if (leftTrial !== rightTrial) return leftTrial - rightTrial;
      return (dateOrNull(right.last_redeemed_at)?.getTime() ?? 0) -
        (dateOrNull(left.last_redeemed_at)?.getTime() ?? 0);
    });
  return {
    rows: sortedRows.slice(0, 50),
    total: sortedRows.length,
  };
}

// Per-business version of the health signal computation used by the Business Health
// Detail Drilldown. Scoped entirely to one business_id so it stays cheap regardless of
// how many businesses exist, and reuses deriveHealthSignals so the drilldown numbers can
// never disagree with the aggregate Business Health list above.
async function loadBusinessHealthDetail(
  supabaseAdmin: any,
  businessId: string,
  businessStatus: string,
  applications: Array<Record<string, unknown>>,
): Promise<{
  health: Record<string, unknown>;
  offer_activity: Record<string, unknown>;
  claims_and_redemptions: Record<string, unknown>;
  trial_and_access: Record<string, unknown>;
  ai_usage: Record<string, unknown>;
}> {
  const now = new Date();
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));

  const [dealsResult, subscriptionResult] = await Promise.all([
    supabaseAdmin
      .from("deals")
      .select("id,title,is_active,start_time,end_time,created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(500),
    supabaseAdmin
      .from("business_subscriptions")
      .select("app_access_status,trial_end,current_period_end,updated_at")
      .eq("business_id", businessId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (dealsResult.error) throw dealsResult.error;
  if (subscriptionResult.error) throw subscriptionResult.error;

  const deals = (dealsResult.data ?? []) as Array<Record<string, unknown>>;
  const dealIds = deals.map((deal) => String(deal.id ?? "")).filter(Boolean);

  const [claimsResult, redemptionsResult, costResult] = await Promise.all([
    dealIds.length
      ? supabaseAdmin.from("deal_claims").select("id,deal_id,claim_status,created_at").in("deal_id", dealIds).limit(5000)
      : Promise.resolve({ data: [], error: null }),
    dealIds.length
      ? supabaseAdmin.from("admin_redemption_facts_v1").select("claim_id,deal_id,redeemed_at").in("deal_id", dealIds).limit(5000)
      : Promise.resolve({ data: [], error: null }),
    supabaseAdmin
      .from("ai_generation_costs")
      .select("estimated_cost_usd")
      .eq("business_id", businessId)
      .gte("created_at", monthStart.toISOString())
      .limit(5000),
  ]);
  if (claimsResult.error) throw claimsResult.error;
  if (redemptionsResult.error) throw redemptionsResult.error;

  const claimsByDeal = new Map<string, number>();
  let claims7d = 0;
  let claims30d = 0;
  let unredeemedClaims30d = 0;
  for (const claim of (claimsResult.data ?? []) as Array<Record<string, unknown>>) {
    const dealId = String(claim.deal_id ?? "");
    if (dealId) claimsByDeal.set(dealId, (claimsByDeal.get(dealId) ?? 0) + 1);
    const createdAt = dateOrNull(claim.created_at);
    if (!createdAt || createdAt.getTime() < thirtyDaysAgo.getTime()) continue;
    claims30d += 1;
    if (createdAt.getTime() >= sevenDaysAgo.getTime()) claims7d += 1;
    if (claim.claim_status !== "redeemed") unredeemedClaims30d += 1;
  }

  const redemptionsByDeal = new Map<string, number>();
  let redemptions7d = 0;
  let redemptions30d = 0;
  let lastRedeemedAt: string | null = null;
  let firstRedeemedAt: string | null = null;
  for (const redemption of (redemptionsResult.data ?? []) as Array<Record<string, unknown>>) {
    const dealId = String(redemption.deal_id ?? "");
    if (dealId) redemptionsByDeal.set(dealId, (redemptionsByDeal.get(dealId) ?? 0) + 1);
    lastRedeemedAt = latestIso(lastRedeemedAt, redemption.redeemed_at);
    firstRedeemedAt = earliestIso(firstRedeemedAt, redemption.redeemed_at);
    const redeemedAt = dateOrNull(redemption.redeemed_at);
    if (!redeemedAt) continue;
    if (redeemedAt.getTime() >= thirtyDaysAgo.getTime()) redemptions30d += 1;
    if (redeemedAt.getTime() >= sevenDaysAgo.getTime()) redemptions7d += 1;
  }

  let liveOfferCount = 0;
  let activeOrScheduledOfferCount = 0;
  let lastOfferAt: string | null = null;
  const offerRows: Array<Record<string, unknown>> = [];
  for (const deal of deals) {
    const dealId = String(deal.id ?? "");
    const effectiveStatus = offerEffectiveStatus(deal, now);
    const isCurrent = effectiveStatus === "live";
    const isScheduled = effectiveStatus === "scheduled";
    if (isCurrent) liveOfferCount += 1;
    if (isCurrent || isScheduled) activeOrScheduledOfferCount += 1;
    lastOfferAt = latestIso(lastOfferAt, deal.created_at || deal.start_time);
    if (isCurrent || isScheduled) {
      offerRows.push({
        id: dealId,
        title: deal.title ?? "",
        start_time: deal.start_time ?? null,
        end_time: deal.end_time ?? null,
        status: isCurrent ? "live" : "scheduled",
        claim_count: claimsByDeal.get(dealId) ?? 0,
        redemption_count: redemptionsByDeal.get(dealId) ?? 0,
      });
    }
  }
  offerRows.sort((a, b) =>
    (dateOrNull(b.start_time as string)?.getTime() ?? 0) - (dateOrNull(a.start_time as string)?.getTime() ?? 0));

  const aiCostAvailable = !costResult.error;
  const aiMonthCostUsd = aiCostAvailable
    ? ((costResult.data ?? []) as Array<Record<string, unknown>>).reduce(
      (sum, costRow) => sum + (Number(costRow.estimated_cost_usd) || 0),
      0,
    )
    : null;

  const subscription = subscriptionResult.data as Record<string, unknown> | null;
  const trialEnd = latestIso(null, subscription?.trial_end || subscription?.current_period_end);
  const trialDaysRemaining = daysUntil(trialEnd, now);
  const canonicalAppAccessStatus = (subscription?.app_access_status as string | undefined) ?? null;
  const activeTrial = canonicalAppAccessStatus === "trialing" || canonicalAppAccessStatus === "trial_limited";

  const pendingStatuses = ["pending_review", "pending_verification", "review_required"];
  const hasPendingApplication = applications.some((application) => pendingStatuses.includes(String(application.status ?? "")));
  const latestApplication = applications[0] ?? null;

  // The application/trial-request row is a point-in-time decision record and is never
  // rewritten when billing later cancels or expires access, so it can go stale (e.g. it
  // still reads "trial_active" after app_access_status moves to "canceled"). Canonical
  // current access always comes from business_subscriptions.app_access_status, so flag
  // this as a display-only mismatch rather than treating the application row as live state.
  const NON_CURRENT_ACCESS_STATUSES = new Set(["canceled", "expired", "suspended", "none", "blocked"]);
  const accessIsNonCurrent = canonicalAppAccessStatus
    ? NON_CURRENT_ACCESS_STATUSES.has(canonicalAppAccessStatus)
    : true;
  const applicationStatus = latestApplication?.status ? String(latestApplication.status) : null;
  const ACTIVE_LOOKING_APPLICATION_STATUSES = new Set(["trial_active", "trial_limited", "approved_not_billed", "active"]);
  const accessMismatch = accessIsNonCurrent && Boolean(applicationStatus) &&
    ACTIVE_LOOKING_APPLICATION_STATUSES.has(applicationStatus as string);

  const quota = await aiQuotaSummaryForBusiness(supabaseAdmin, businessId);

  const signals = deriveHealthSignals({
    liveOfferCount,
    redemptions30d,
    redemptions7d,
    claims30d,
    lastOfferAt,
    lastRedeemedAt,
    firstRedeemedAt,
    hasPendingApplication,
    businessStatus,
    activeTrial,
    trialDaysRemaining,
    aiQuotaRisk: quota.risk as "high" | "watch" | "normal",
    aiCostAvailable,
    aiMonthCostUsd,
  }, now);

  return {
    health: {
      health_label: signals.healthLabel,
      attention_score: signals.attentionScore,
      primary_reason: signals.primaryReason,
      reason_codes: signals.reasonCodes,
      suggested_read_only_action: signals.suggestedReadOnlyAction,
    },
    offer_activity: {
      live_offer_count: liveOfferCount,
      active_or_scheduled_offer_count: activeOrScheduledOfferCount,
      last_offer_at: lastOfferAt,
      days_since_last_offer: daysBetween(lastOfferAt, now),
      offers: offerRows.slice(0, 20),
    },
    claims_and_redemptions: {
      claims_7d: claims7d,
      claims_30d: claims30d,
      unredeemed_claims_30d: unredeemedClaims30d,
      redemptions_7d: redemptions7d,
      redemptions_30d: redemptions30d,
      last_redeemed_at: lastRedeemedAt,
    },
    trial_and_access: {
      trial_request_status: latestApplication?.status ?? null,
      trial_request_created_at: latestApplication?.created_at ?? null,
      app_access_status: canonicalAppAccessStatus,
      // Only surface trial timing when the canonical status is actually trialing;
      // otherwise a canceled business would still show "N days left" from a stale trial.
      trial_ends_at: activeTrial ? trialEnd : null,
      trial_days_remaining: activeTrial ? trialDaysRemaining : null,
      access_mismatch: accessMismatch,
      access_mismatch_note: accessMismatch
        ? `Current app access is ${canonicalAppAccessStatus ?? "none"}. This business's application record still shows "${applicationStatus}", which reflects the original trial request, not current access.`
        : null,
    },
    ai_usage: {
      ai_month_used_max: quota.used,
      ai_month_limit_for_max: quota.limit,
      ai_quota_risk: quota.risk,
      ai_month_cost_usd: aiCostAvailable && aiMonthCostUsd !== null ? Number(aiMonthCostUsd.toFixed(6)) : null,
      ai_cost_available: aiCostAvailable,
    },
  };
}

// Read-only per-tab data for the admin site. Every view is audited; mutations
// stay in their dedicated admin edge functions.
async function loadSection(
  supabaseAdmin: any,
  section: SectionName,
  payload: Record<string, unknown>,
  canViewAdminUsers: boolean,
): Promise<Record<string, unknown>> {
  if (section === "businesses") {
    const { data, error } = await supabaseAdmin
      .from("businesses")
      .select("id,owner_id,name,status,access_level,verification_status,risk_level,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const emails = await ownerEmailsForBusinesses(
      supabaseAdmin,
      rows.map((row) => String(row.id)),
    );
    return {
      businesses: rows.map((row) => ({ ...row, owner_email: emails.get(String(row.id)) ?? null })),
    };
  }

  if (section === "offers") {
    const { data, error } = await supabaseAdmin
      .from("deals")
      .select("id,title,business_id,is_active,start_time,end_time,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const businessIds = [...new Set(rows.map((row) => String(row.business_id)).filter(Boolean))];
    const names = new Map<string, string>();
    if (businessIds.length) {
      const { data: businesses, error: businessError } = await supabaseAdmin
        .from("businesses")
        .select("id,name")
        .in("id", businessIds);
      if (businessError) throw businessError;
      for (const business of (businesses ?? []) as Array<{ id: string; name?: string }>) {
        names.set(business.id, business.name ?? business.id);
      }
    }
    const now = new Date();
    return {
      offers: rows.map((row) => ({
        ...row,
        business_name: names.get(String(row.business_id)) ?? null,
        effective_status: offerEffectiveStatus(row, now),
      })),
    };
  }

  if (section === "redemptions") {
    const { data, error } = await supabaseAdmin
      .from("admin_redemption_facts_v1")
      .select("claim_id,business_id,deal_id,customer_user_id,redeemed_at,redeem_method,claimed_at")
      .order("redeemed_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const businessIds = [...new Set(rows.map((row) => String(row.business_id || "")).filter(Boolean))];
    const dealIds = [...new Set(rows.map((row) => String(row.deal_id || "")).filter(Boolean))];
    const [businesses, deals] = await Promise.all([
      businessIds.length
        ? supabaseAdmin.from("businesses").select("id,name").in("id", businessIds)
        : Promise.resolve({ data: [], error: null }),
      dealIds.length
        ? supabaseAdmin.from("deals").select("id,title").in("id", dealIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (businesses.error) throw businesses.error;
    if (deals.error) throw deals.error;
    const businessNames = new Map((businesses.data ?? []).map((row: Record<string, unknown>) => [String(row.id), String(row.name || "")]));
    const dealNames = new Map((deals.data ?? []).map((row: Record<string, unknown>) => [String(row.id), String(row.title || "")]));
    return {
      redemptions: rows.map((row) => ({
        ...row,
        business_name: businessNames.get(String(row.business_id)) || null,
        deal_title: dealNames.get(String(row.deal_id)) || null,
      })),
    };
  }

  if (section === "billing_events") {
    const { data, error } = await supabaseAdmin
      .from("billing_provider_events")
      .select("id,provider,event_type,processing_status,received_at,processed_at,error_message")
      .order("received_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return { billing_events: data ?? [] };
  }

  if (section === "audit_log") {
    const { data, error } = await supabaseAdmin
      .from("admin_audit_log")
      .select("id,admin_email,action,target_type,business_id,reason,created_at")
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return { audit_log: data ?? [] };
  }

  if (section === "settings") {
    const [launchAreas, featureFlags, adminUsers] = await Promise.all([
      supabaseAdmin
        .from("launch_areas")
        .select("id,name,slug,city,state,status,timezone")
        .order("name", { ascending: true }),
      supabaseAdmin
        .from("feature_flags")
        .select("id,key,description,enabled,updated_at")
        .order("key", { ascending: true }),
      canViewAdminUsers
        ? supabaseAdmin
          .from("admin_users")
          .select("id,email,role,is_active,require_mfa,display_name,last_admin_login_at")
          .order("email", { ascending: true })
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (launchAreas.error) throw launchAreas.error;
    if (featureFlags.error) throw featureFlags.error;
    if (adminUsers.error) throw adminUsers.error;
    return {
      launch_areas: launchAreas.data ?? [],
      feature_flags: featureFlags.data ?? [],
      admin_users: adminUsers.data ?? [],
      admin_users_visible: canViewAdminUsers,
    };
  }

  if (section === "prospects") {
    const search = cleanText(payload.search, 120);
    const city = cleanText(payload.city, 80);
    const status = cleanText(payload.status, 40);
    const reviewStatus = cleanText(payload.review_status, 40);
    const scoreTierRaw = cleanText(payload.score_tier, 40);
    const scoreTier = scoreTierRaw.toLowerCase() === "do_not_contact" || scoreTierRaw.toLowerCase() === "do not contact"
      ? "Do Not Contact"
      : scoreTierRaw.toUpperCase();
    let query = supabaseAdmin
      .from("business_prospects")
      .select("id,display_name,city,state,postal_code,category,public_label_state,status,review_status,linked_business_id,duplicate_of_prospect_id,last_verified_at,updated_at,created_at")
      .order("updated_at", { ascending: false })
      .limit(200);
    if (search) query = query.ilike("display_name", `%${search}%`);
    if (city) query = query.ilike("city", city);
    if (status) query = query.eq("status", status);
    if (reviewStatus) query = query.eq("review_status", reviewStatus);

    const { data, error } = await query;
    if (error) throw error;
    const rows = (data ?? []) as Array<Record<string, unknown>>;
    const prospectIds = rows.map((row) => String(row.id)).filter(Boolean);
    const linkedBusinessIds = rows.map((row) => String(row.linked_business_id ?? "")).filter(Boolean);
    const [demand, scores, sales, businesses] = await Promise.all([
      prospectIds.length
        ? supabaseAdmin
          .from("business_demand_rollups")
          .select("prospect_id,favorites_count,requests_count,views_count,unique_users_count")
          .in("prospect_id", prospectIds)
          .gte("rollup_date", new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10))
        : Promise.resolve({ data: [], error: null }),
      prospectIds.length
        ? supabaseAdmin
          .from("business_prospect_scores")
          .select("prospect_id,total_score,tier,recommended_next_action,created_at")
          .in("prospect_id", prospectIds)
          .order("created_at", { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      prospectIds.length
        ? supabaseAdmin
          .from("sales_accounts")
          .select("prospect_id,assigned_admin_user_id,stage,priority,next_action,next_action_at,last_contact_at,outcome,updated_at")
          .in("prospect_id", prospectIds)
        : Promise.resolve({ data: [], error: null }),
      linkedBusinessIds.length
        ? supabaseAdmin
          .from("businesses")
          .select("id,name,status,access_level")
          .in("id", linkedBusinessIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (demand.error) throw demand.error;
    if (scores.error) throw scores.error;
    if (sales.error) throw sales.error;
    if (businesses.error) throw businesses.error;

    const demandByProspect = sumDemandByTarget((demand.data ?? []) as Array<Record<string, unknown>>, "prospect_id");
    const scoreByProspect = latestById((scores.data ?? []) as Array<Record<string, unknown>>, "prospect_id");
    const salesByProspect = latestById((sales.data ?? []) as Array<Record<string, unknown>>, "prospect_id");
    const businessById = latestById((businesses.data ?? []) as Array<Record<string, unknown>>, "id");
    const enriched = rows.map((row) => {
      const demandStats = demandByProspect.get(String(row.id)) ?? { demand_count: 0, unique_users_count: 0 };
      const score = scoreByProspect.get(String(row.id)) ?? null;
      const salesAccount = salesByProspect.get(String(row.id)) ?? null;
      const linkedBusiness = row.linked_business_id ? businessById.get(String(row.linked_business_id)) ?? null : null;
      return {
        ...row,
        demand_count: demandStats.demand_count,
        unique_users_count: demandStats.unique_users_count,
        score,
        sales_account: salesAccount,
        linked_business: linkedBusiness,
      };
    }).filter((row) => !scoreTier || String((row.score as Record<string, unknown> | null)?.tier ?? "").toUpperCase() === scoreTier);

    return { prospects: enriched };
  }

  if (section === "prospect_detail") {
    const prospectId = typeof payload.prospect_id === "string" ? payload.prospect_id.trim() : "";
    if (!UUID_RE.test(prospectId)) {
      return {
        prospect: null,
        sources: [],
        enrichments: [],
        scores: [],
        demand_rollups: [],
        sales_account: null,
        sales_activities: [],
        claim_links: [],
        conversions: [],
        audit_log: [],
      };
    }

    const [
      prospect,
      sources,
      enrichments,
      scores,
      demandRollups,
      salesAccount,
      salesActivities,
      claimLinks,
      conversions,
      audit,
    ] = await Promise.all([
      supabaseAdmin
        .from("business_prospects")
        .select("id,display_name,normalized_name,category,subcategory,address_line1,address_line2,city,state,postal_code,country,latitude,longitude,source_type,source_confidence,public_label_state,status,review_status,linked_business_id,duplicate_of_prospect_id,private_contact_json,created_at,updated_at,last_verified_at")
        .eq("id", prospectId)
        .maybeSingle(),
      supabaseAdmin
        .from("business_prospect_sources")
        .select("id,provider,source_url,source_payload_hash,confidence,fetched_at,stale_at,created_by_admin_user_id,created_at")
        .eq("prospect_id", prospectId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("business_prospect_enrichments")
        .select("id,provider,model,prompt_version,enrichment_json,confidence,review_status,reviewed_by_admin_user_id,reviewed_at,created_at")
        .eq("prospect_id", prospectId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("business_prospect_scores")
        .select("id,score_version,total_score,tier,score_inputs_json,recommended_next_action,created_at")
        .eq("prospect_id", prospectId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("business_demand_rollups")
        .select("id,rollup_date,rollup_window,city,favorites_count,requests_count,views_count,unique_users_count,notification_enabled_count,created_at,updated_at")
        .eq("prospect_id", prospectId)
        .order("rollup_date", { ascending: false })
        .limit(60),
      supabaseAdmin
        .from("sales_accounts")
        .select("id,assigned_admin_user_id,stage,priority,next_action,next_action_at,last_contact_at,outcome,objections_json,notes,created_at,updated_at")
        .eq("prospect_id", prospectId)
        .maybeSingle(),
      supabaseAdmin
        .from("sales_activities")
        .select("id,activity_type,summary,outcome,created_by_admin_user_id,created_at")
        .eq("prospect_id", prospectId)
        .order("created_at", { ascending: false })
        .limit(50),
      supabaseAdmin
        .from("business_claim_links")
        .select("id,prospect_id,business_id,expires_at,max_uses,uses_count,accepted_by_user_id,accepted_at,revoked_at,created_by_admin_user_id,created_at")
        .eq("prospect_id", prospectId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("prospect_to_business_links")
        .select("id,business_application_id,business_onboarding_request_id,business_id,conversion_type,created_by_admin_user_id,created_at")
        .eq("prospect_id", prospectId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabaseAdmin
        .from("admin_audit_log")
        .select("id,admin_email,action,target_type,reason,created_at")
        .eq("target_id", prospectId)
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    if (prospect.error) throw prospect.error;
    if (sources.error) throw sources.error;
    if (enrichments.error) throw enrichments.error;
    if (scores.error) throw scores.error;
    if (demandRollups.error) throw demandRollups.error;
    if (salesAccount.error) throw salesAccount.error;
    if (salesActivities.error) throw salesActivities.error;
    if (claimLinks.error) throw claimLinks.error;
    if (conversions.error) throw conversions.error;
    if (audit.error) throw audit.error;

    let linkedBusiness: Record<string, unknown> | null = null;
    let billing: Record<string, unknown> | null = null;
    const prospectRow = prospect.data as Record<string, unknown> | null;
    if (prospectRow?.linked_business_id) {
      const [businessResult, subscriptionResult] = await Promise.all([
        supabaseAdmin
          .from("businesses")
          .select("id,name,status,access_level,verification_status,created_at")
          .eq("id", prospectRow.linked_business_id as string)
          .maybeSingle(),
        supabaseAdmin
          .from("business_subscriptions")
          .select("id,billing_status,app_access_status,trial_start,trial_end,current_period_end,updated_at")
          .eq("business_id", prospectRow.linked_business_id as string)
          .order("updated_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);
      if (businessResult.error) throw businessResult.error;
      if (subscriptionResult.error) throw subscriptionResult.error;
      linkedBusiness = businessResult.data ?? null;
      billing = subscriptionResult.data ?? null;
    }

    return {
      prospect: prospect.data ?? null,
      linked_business: linkedBusiness,
      billing,
      sources: sources.data ?? [],
      enrichments: enrichments.data ?? [],
      scores: scores.data ?? [],
      demand_rollups: demandRollups.data ?? [],
      sales_account: salesAccount.data ?? null,
      sales_activities: salesActivities.data ?? [],
      claim_links: claimLinks.data ?? [],
      conversions: conversions.data ?? [],
      audit_log: audit.data ?? [],
    };
  }

  if (section === "owner_view") {
    const businessId = cleanText(payload.business_id, 40);
    if (!UUID_RE.test(businessId)) {
      throw Object.assign(new Error("A valid business id is required."), { status: 400 });
    }
    const [businessResult, dealsResult, subscriptionResult] = await Promise.all([
      supabaseAdmin
        .from("businesses")
        .select("id,owner_id,name,status,verification_status,category,short_description,logo_url,created_at")
        .eq("id", businessId)
        .maybeSingle(),
      supabaseAdmin
        .from("deals")
        .select("id,title,description,is_active,start_time,end_time,max_claims,created_at")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabaseAdmin
        .from("business_subscriptions")
        .select("billing_status,app_access_status,plan_name,trial_end,current_period_end,cancel_at_period_end,updated_at")
        .eq("business_id", businessId)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (businessResult.error) throw businessResult.error;
    if (!businessResult.data) throw Object.assign(new Error("Business not found."), { status: 404 });
    if (dealsResult.error) throw dealsResult.error;
    if (subscriptionResult.error) throw subscriptionResult.error;
    const deals = (dealsResult.data ?? []) as Array<Record<string, unknown>>;
    const dealIds = deals.map((deal) => String(deal.id)).filter(Boolean);
    const [claimsResult, redemptionsResult] = await Promise.all([
      dealIds.length
        ? supabaseAdmin.from("deal_claims").select("id,deal_id,claim_status,created_at,redeemed_at").in("deal_id", dealIds).limit(5000)
        : Promise.resolve({ data: [], error: null }),
      dealIds.length
        ? supabaseAdmin.from("admin_redemption_facts_v1").select("claim_id,deal_id,redeemed_at").in("deal_id", dealIds).limit(5000)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (claimsResult.error) throw claimsResult.error;
    if (redemptionsResult.error) throw redemptionsResult.error;
    const claimsByDeal = new Map<string, number>();
    const redemptionsByDeal = new Map<string, number>();
    for (const claim of claimsResult.data ?? []) {
      const dealId = String(claim.deal_id || "");
      claimsByDeal.set(dealId, (claimsByDeal.get(dealId) ?? 0) + 1);
    }
    for (const redemption of redemptionsResult.data ?? []) {
      const dealId = String(redemption.deal_id || "");
      redemptionsByDeal.set(dealId, (redemptionsByDeal.get(dealId) ?? 0) + 1);
    }
    const now = new Date();
    const offers = deals
      .map((deal) => ({
        ...deal,
        status: offerEffectiveStatus(deal, now),
        claim_count: claimsByDeal.get(String(deal.id)) ?? 0,
        redemption_count: redemptionsByDeal.get(String(deal.id)) ?? 0,
      }))
      .sort((left, right) => {
        const rank: Record<string, number> = { live: 0, scheduled: 1, inactive: 2, expired: 3 };
        const statusRank = (rank[String(left.status)] ?? 4) - (rank[String(right.status)] ?? 4);
        if (statusRank) return statusRank;
        return (dateOrNull((right as Record<string, unknown>).created_at)?.getTime() ?? 0) -
          (dateOrNull((left as Record<string, unknown>).created_at)?.getTime() ?? 0);
      });
    const subscription = subscriptionResult.data as Record<string, unknown> | null;
    const banners: Array<{ tone: string; message: string }> = [];
    if (String(subscription?.app_access_status || "") === "approved_not_activated") {
      banners.push({ tone: "warning", message: "Finish secure billing activation to publish and receive customer claims." });
    }
    if (["past_due", "past_due_grace"].includes(String(subscription?.billing_status || subscription?.app_access_status || ""))) {
      banners.push({ tone: "danger", message: "Billing needs attention. Review payment details to keep business access active." });
    }
    if (subscription?.trial_end) {
      banners.push({ tone: "info", message: `Trial access ends ${new Date(String(subscription.trial_end)).toLocaleDateString("en-US")}.` });
    }
    if (!offers.some((offer) => offer.status === "live")) {
      banners.push({ tone: "info", message: "No offer is live right now. Create or schedule an offer when ready." });
    }
    return {
      owner_view: {
        business: businessResult.data,
        offers,
        claims: {
          total: (claimsResult.data ?? []).length,
          redemptions: (redemptionsResult.data ?? []).length,
        },
        subscription,
        banners,
        read_only: true,
        impersonation: false,
      },
    };
  }

  // business_detail
  const businessId = typeof payload.business_id === "string" ? payload.business_id.trim() : "";
  if (!UUID_RE.test(businessId)) {
    return {
      business: null,
      applications: [],
      audit_log: [],
      health: null,
      offer_activity: null,
      claims_and_redemptions: null,
      trial_and_access: null,
      ai_usage: null,
      promo_materials: [],
      business_health_error: null,
    };
  }
  const [business, applications, audit] = await Promise.all([
    supabaseAdmin
      .from("businesses")
      .select("id,name,status,access_level,verification_status,risk_level,created_at")
      .eq("id", businessId)
      .maybeSingle(),
    supabaseAdmin
      .from("business_applications")
      .select("id,business_name,contact_name,email,phone,address,business_type,launch_area,status,access_tier,verification_status,risk_score,trial_days,trial_offer_limit,trial_claim_limit,admin_notes,reviewed_at,created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(20),
    supabaseAdmin
      .from("admin_audit_log")
      .select("id,admin_email,action,target_type,reason,created_at")
      .eq("business_id", businessId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);
  if (business.error) throw business.error;
  if (applications.error) throw applications.error;
  if (audit.error) throw audit.error;

  const ownerEmails = await ownerEmailsForBusinesses(supabaseAdmin, [businessId]);
  const businessRow = business.data
    ? { ...business.data, owner_email: ownerEmails.get(businessId) ?? null }
    : null;

  let healthDetail: Awaited<ReturnType<typeof loadBusinessHealthDetail>> | null = null;
  let businessHealthError: string | null = null;
  if (businessRow) {
    try {
      healthDetail = await loadBusinessHealthDetail(
        supabaseAdmin,
        businessId,
        String(businessRow.status ?? ""),
        (applications.data ?? []) as Array<Record<string, unknown>>,
      );
    } catch (healthErr) {
      businessHealthError = "Business health drilldown could not be loaded.";
      console.warn("[admin-dashboard-summary] business_detail health error:", healthErr);
    }
  }

  // Read-only promotional-materials consent status, one entry per location.
  // Never gates anything; a failure here degrades to an empty list rather than
  // failing the whole business detail view.
  const promoMaterials = await loadPromoMaterialsDetail(supabaseAdmin, businessId);
  let onboarding: Record<string, unknown> | null = null;
  try {
    onboarding = (await loadOnboardingRows(supabaseAdmin))
      .find((row) => row.business_id === businessId) ?? null;
  } catch (onboardingErr) {
    console.warn("[admin-dashboard-summary] business onboarding detail error:", onboardingErr);
  }

  return {
    business: businessRow,
    applications: applications.data ?? [],
    audit_log: audit.data ?? [],
    promo_materials: promoMaterials,
    health: healthDetail?.health ?? null,
    offer_activity: healthDetail?.offer_activity ?? null,
    claims_and_redemptions: healthDetail?.claims_and_redemptions ?? null,
    trial_and_access: healthDetail?.trial_and_access ?? null,
    ai_usage: healthDetail?.ai_usage ?? null,
    onboarding,
    business_health_error: businessHealthError,
  };
}

/** Label shown wherever an admin recorded consent on the business's behalf. */
const ADMIN_ASSISTED_LABEL = "Recorded by Twofer on behalf of business";

/**
 * Per-location promotional-materials consent status for the admin business
 * detail view. "Authorized" = an open (un-revoked) row exists. Revoked and
 * superseded rows are returned as history so an admin can see the full trail.
 */
async function loadPromoMaterialsDetail(
  supabaseAdmin: any,
  businessId: string,
): Promise<Array<Record<string, unknown>>> {
  try {
    const [locations, authorizations] = await Promise.all([
      supabaseAdmin
        .from("business_locations")
        .select("id,name,address")
        .eq("business_id", businessId)
        .order("created_at", { ascending: true }),
      supabaseAdmin
        .from("promo_materials_authorizations")
        .select(
          "id,location_id,authorized_at,revoked_at,authorizer_name,authorizer_role,business_terms_version,source,permission_received_at,created_at",
        )
        .eq("business_id", businessId)
        .order("created_at", { ascending: false }),
    ]);
    if (locations.error) throw locations.error;
    if (authorizations.error) throw authorizations.error;

    const rows = (authorizations.data ?? []) as Array<Record<string, unknown>>;
    return ((locations.data ?? []) as Array<Record<string, unknown>>).map((location) => {
      const forLocation = rows.filter((row) => row.location_id === location.id);
      const active = forLocation.find((row) => row.revoked_at == null) ?? null;
      const latest = active ?? forLocation[0] ?? null;
      return {
        location_id: location.id,
        location_name: location.name ?? null,
        location_address: location.address ?? null,
        status: active ? "authorized" : "not_authorized",
        authorized_at: latest?.authorized_at ?? null,
        revoked_at: latest?.revoked_at ?? null,
        // Falls back to the source when no name was captured (website intake).
        authorizer_name: latest?.authorizer_name ?? null,
        authorizer_role: latest?.authorizer_role ?? null,
        source: latest?.source ?? null,
        business_terms_version: latest?.business_terms_version ?? null,
        permission_received_at: latest?.permission_received_at ?? null,
        recorded_on_behalf_label: latest?.source === "admin_assisted" ? ADMIN_ASSISTED_LABEL : null,
        history: forLocation,
      };
    });
  } catch (error) {
    // Pre-migration schema, or a transient read failure: show nothing rather
    // than breaking the business detail page.
    console.warn("[admin-dashboard-summary] promo materials detail error:", error);
    return [];
  }
}

function utcMonthStart(offsetMonths = 0): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, 1, 0, 0, 0, 0));
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function usd(value: unknown): number {
  const numberValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numberValue) ? Number(numberValue.toFixed(6)) : 0;
}

async function sumDailyAiCost(
  supabaseAdmin: any,
  startInclusive: Date,
  endExclusive: Date,
): Promise<{ totalUsd: number; attempts: number }> {
  const { data, error } = await supabaseAdmin
    .from("ai_generation_cost_daily")
    .select("total_ai_cost_usd,generated_ad_attempts")
    .gte("day", isoDate(startInclusive))
    .lt("day", isoDate(endExclusive));
  if (error) throw error;

  const rows = (data ?? []) as Array<{ total_ai_cost_usd?: unknown; generated_ad_attempts?: unknown }>;
  return rows.reduce(
    (acc, row) => ({
      totalUsd: usd(acc.totalUsd + usd(row.total_ai_cost_usd)),
      attempts: acc.attempts + (Number(row.generated_ad_attempts) || 0),
    }),
    { totalUsd: 0, attempts: 0 },
  );
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST" && req.method !== "GET") {
    return json(req, { error: "Method not allowed." }, 405);
  }

  const requestId = crypto.randomUUID();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = tryGetServiceRoleKey();
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();

    if (!supabaseUrl || !serviceRoleKey) {
      return json(req, { error: "Admin dashboard is not configured." }, 500);
    }

    const supabaseUser = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);

    const {
      data: { user },
      error: userError,
    } = await supabaseUser.auth.getUser();

    if (userError || !user) {
      return json(req, { error: "Unauthorized." }, 401);
    }
    if (isRedeemerUser(user)) {
      return forbiddenForRedeemerResponse(corsHeaders);
    }

    const { data: adminUser, error: adminError } = await supabaseAdmin
      .from("admin_users")
      .select("id,email,role,is_active,require_mfa,display_name")
      .eq("id", user.id)
      .maybeSingle();

    if (adminError) throw adminError;
    if (!adminUser?.is_active || !hasReadableAdminRole(adminUser.role)) {
      await supabaseAdmin.from("admin_audit_log").insert({
        admin_user_id: user.id,
        admin_email: user.email ?? null,
        action: "admin_dashboard_denied",
        target_type: "admin_dashboard",
        reason: "not_active_admin",
        request_id: requestId,
      });
      return json(req, { error: "Forbidden." }, 403);
    }
    if (adminUser.require_mfa && !isAal2(bearerToken)) {
      return json(req, { error: "MFA verification required." }, 403);
    }

    const payload = req.method === "POST" ? await readPayload(req) : {};
    if (payload.section === "queue_status") {
      if (!["owner", "admin", "support"].includes(String(adminUser.role))) {
        return json(req, { error: "This admin role cannot update the action queue." }, 403);
      }
      const issueKey = cleanText(payload.issue_key, 200).toLowerCase();
      const status = cleanText(payload.status, 40).toLowerCase();
      const note = cleanText(payload.note, 1000);
      const allowedStatuses = new Set(["new", "reviewing", "waiting_owner", "resolved", "dismissed"]);
      if (!/^[a-z0-9_:-]{3,200}$/.test(issueKey) || !allowedStatuses.has(status)) {
        return json(req, { error: "A valid issue key and queue status are required." }, 400);
      }
      const updatedAt = new Date().toISOString();
      const { data: queueStatus, error: queueStatusError } = await supabaseAdmin
        .from("admin_queue_item_status")
        .upsert({
          issue_key: issueKey,
          status,
          note: note || null,
          updated_by: user.id,
          updated_at: updatedAt,
        }, { onConflict: "issue_key" })
        .select("issue_key,status,note,updated_by,updated_at")
        .single();
      if (queueStatusError) throw queueStatusError;
      await supabaseAdmin.from("admin_audit_log").insert({
        admin_user_id: user.id,
        admin_email: adminUser.email ?? user.email ?? null,
        action: "admin_queue_status_set",
        target_type: "admin_queue_item",
        business_id: typeof payload.business_id === "string" && UUID_RE.test(payload.business_id)
          ? payload.business_id
          : null,
        reason: note || `Queue status set to ${status}.`,
        request_id: requestId,
      });
      return json(req, {
        ok: true,
        request_id: requestId,
        queue_status: queueStatus,
      });
    }
    if (isSectionName(payload.section)) {
      const canViewAdminUsers = adminUser.role === "owner" || adminUser.role === "admin";
      const sectionData = await loadSection(supabaseAdmin, payload.section, payload, canViewAdminUsers);
      await supabaseAdmin.from("admin_audit_log").insert({
        admin_user_id: user.id,
        admin_email: adminUser.email ?? user.email ?? null,
        action: payload.section === "owner_view" ? "admin_owner_view_opened" : `admin_${payload.section}_viewed`,
        target_type: "admin_dashboard",
        target_id: (payload.section === "business_detail" || payload.section === "owner_view") && typeof payload.business_id === "string" &&
            UUID_RE.test(payload.business_id)
          ? payload.business_id
          : null,
        request_id: requestId,
      });
      return json(req, {
        ok: true,
        request_id: requestId,
        admin: {
          email: adminUser.email,
          role: adminUser.role,
          display_name: adminUser.display_name,
          require_mfa: adminUser.require_mfa,
        },
        section: payload.section,
        ...sectionData,
      });
    }

    const nowIso = new Date().toISOString();
    const dayStart = new Date();
    dayStart.setUTCHours(0, 0, 0, 0);
    const weekStart = new Date();
    weekStart.setUTCDate(weekStart.getUTCDate() - 7);
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setUTCDate(thirtyDaysAgo.getUTCDate() - 30);
    const sevenDaysOut = new Date();
    sevenDaysOut.setUTCDate(sevenDaysOut.getUTCDate() + 7);
    const currentMonthStart = utcMonthStart(0);
    const nextMonthStart = utcMonthStart(1);
    const priorMonthStart = utcMonthStart(-1);

    const [
      activeBusinesses,
      pendingBusinesses,
      suspendedBusinesses,
      trialRequests,
      highRiskRequests,
      liveOffers,
      offersNeedingReview,
      claimsToday,
      redemptionsToday,
      trialingLocations,
      trialsEndingSoon,
      pastDueLocations,
      pastDueBusinesses,
      missingStripeCustomers,
      stripeWebhookErrors,
      failedAdminActions,
      newConsumersThisWeek,
      dealsCreatedToday,
      dealsCreated7d,
      redemptions7d,
      claims30d,
      redemptions30d,
      dealsCreatedCurrentMonth,
      currentMonthAiSpend,
      priorMonthAiSpend,
      openProspects,
      readyProspects,
      acceptedClaimLinks,
      openBusinessReports,
      openUserReports,
    ] = await Promise.all([
      countRows(
        supabaseAdmin
          .from("businesses")
          .select("id", { count: "exact", head: true })
          .in("status", ["active", "trialing", "limited_trial"]),
      ),
      countRows(
        supabaseAdmin
          .from("businesses")
          .select("id", { count: "exact", head: true })
          .eq("status", "pending_verification"),
      ),
      countRows(
        supabaseAdmin
          .from("businesses")
          .select("id", { count: "exact", head: true })
          .in("status", ["suspended", "disabled"]),
      ),
      countRows(
        supabaseAdmin
          .from("business_applications")
          .select("id", { count: "exact", head: true })
          .in("status", ["pending_review", "pending_verification", "review_required"]),
      ),
      countRows(
        supabaseAdmin
          .from("business_applications")
          .select("id", { count: "exact", head: true })
          .lte("risk_score", 39)
          .in("status", ["pending_review", "pending_verification", "review_required"]),
      ),
      countRows(
        supabaseAdmin
          .from("deals")
          .select("id", { count: "exact", head: true })
          .eq("is_active", true)
          .lte("start_time", nowIso)
          .or(`end_time.is.null,end_time.gt.${nowIso}`),
      ),
      countRows(
        supabaseAdmin
          .from("deals")
          .select("id", { count: "exact", head: true })
          .eq("is_active", false)
          .gt("end_time", nowIso),
      ),
      countRows(
        supabaseAdmin
          .from("deal_claims")
          .select("id", { count: "exact", head: true })
          .gte("created_at", dayStart.toISOString()),
      ),
      countRows(
        supabaseAdmin
          .from("admin_redemption_facts_v1")
          .select("claim_id", { count: "exact", head: true })
          .gte("redeemed_at", dayStart.toISOString()),
      ),
      countRows(
        supabaseAdmin
          .from("location_entitlements")
          .select("id", { count: "exact", head: true })
          .in("status", ["trial_active", "admin_trial_active"]),
      ),
      countRows(
        supabaseAdmin
          .from("location_entitlements")
          .select("id", { count: "exact", head: true })
          .in("status", ["trial_active", "admin_trial_active"])
          .lte("trial_ends_at", sevenDaysOut.toISOString())
          .gte("trial_ends_at", nowIso),
      ),
      countRows(
        supabaseAdmin
          .from("location_entitlements")
          .select("id", { count: "exact", head: true })
          .in("status", ["payment_failed_suspended", "trial_expired_payment_failed_suspended"]),
      ),
      countRows(
        supabaseAdmin
          .from("business_subscriptions")
          .select("id", { count: "exact", head: true })
          .in("app_access_status", ["past_due_grace", "blocked", "suspended", "canceled", "expired"]),
      ),
      countRows(
        supabaseAdmin
          .from("business_billing_profiles")
          .select("id", { count: "exact", head: true })
          .is("stripe_customer_id", null),
      ),
      countRows(
        supabaseAdmin
          .from("billing_provider_events")
          .select("id", { count: "exact", head: true })
          .eq("processing_status", "failed"),
      ),
      countRows(
        supabaseAdmin
          .from("admin_audit_log")
          .select("id", { count: "exact", head: true })
          .ilike("action", "%failed%")
          .gte("created_at", weekStart.toISOString()),
      ),
      countRows(
        supabaseAdmin
          .from("consumer_profiles")
          .select("user_id", { count: "exact", head: true })
          .gte("created_at", weekStart.toISOString()),
      ),
      countRows(
        supabaseAdmin
          .from("deals")
          .select("id", { count: "exact", head: true })
          .gte("created_at", dayStart.toISOString()),
      ),
      countRows(
        supabaseAdmin
          .from("deals")
          .select("id", { count: "exact", head: true })
          .gte("created_at", weekStart.toISOString()),
      ),
      countRows(
        supabaseAdmin
          .from("admin_redemption_facts_v1")
          .select("claim_id", { count: "exact", head: true })
          .gte("redeemed_at", weekStart.toISOString()),
      ),
      countRows(
        supabaseAdmin
          .from("deal_claims")
          .select("id", { count: "exact", head: true })
          .gte("created_at", thirtyDaysAgo.toISOString()),
      ),
      countRows(
        supabaseAdmin
          .from("admin_redemption_facts_v1")
          .select("claim_id", { count: "exact", head: true })
          .gte("redeemed_at", thirtyDaysAgo.toISOString()),
      ),
      countRows(
        supabaseAdmin
          .from("deals")
          .select("id", { count: "exact", head: true })
          .gte("created_at", currentMonthStart.toISOString())
          .lt("created_at", nextMonthStart.toISOString()),
      ),
      sumDailyAiCost(supabaseAdmin, currentMonthStart, nextMonthStart),
      sumDailyAiCost(supabaseAdmin, priorMonthStart, currentMonthStart),
      countRows(
        supabaseAdmin
          .from("business_prospects")
          .select("id", { count: "exact", head: true })
          .in("status", ["new", "imported", "enriched", "ready_to_contact"]),
      ),
      countRows(
        supabaseAdmin
          .from("business_prospects")
          .select("id", { count: "exact", head: true })
          .eq("status", "ready_to_contact"),
      ),
      countRows(
        supabaseAdmin
          .from("business_claim_links")
          .select("id", { count: "exact", head: true })
          .not("accepted_at", "is", null)
          .gte("accepted_at", currentMonthStart.toISOString()),
      ),
      countRowsSafe(
        supabaseAdmin
          .from("business_reports")
          .select("id", { count: "exact", head: true })
          .eq("status", "open"),
      ),
      countRowsSafe(
        supabaseAdmin
          .from("user_reports")
          .select("id", { count: "exact", head: true })
          .eq("status", "open"),
      ),
    ]);

    const { data: recentApplications, error: applicationsError } = await supabaseAdmin
      .from("business_applications")
      .select("id,business_name,contact_name,email,business_type,launch_area,status,access_tier,risk_score,created_at")
      .order("created_at", { ascending: false })
      .limit(8);
    if (applicationsError) throw applicationsError;

    const { data: recentAudit, error: auditError } = await supabaseAdmin
      .from("admin_audit_log")
      .select("id,admin_email,action,target_type,business_id,reason,created_at")
      .order("created_at", { ascending: false })
      .limit(8);
    if (auditError) throw auditError;

    let businessHealth: Array<Record<string, unknown>> = [];
    let businessHealthTotal = 0;
    let businessHealthError: string | null = null;
    try {
      const healthResult = await loadBusinessHealthRows(supabaseAdmin);
      businessHealth = healthResult.rows;
      businessHealthTotal = healthResult.total;
    } catch (healthErr) {
      businessHealthError = "Business health could not be loaded.";
      console.warn("[admin-dashboard-summary] business health error:", healthErr);
    }

    let activeUsers30d = 0;
    let activeUsersError: string | null = null;
    try {
      activeUsers30d = await loadActiveConsumerCount(supabaseAdmin, thirtyDaysAgo.toISOString());
    } catch (activeErr) {
      activeUsersError = "Active users could not be loaded.";
      console.warn("[admin-dashboard-summary] active users error:", activeErr);
    }

    let accountGrowth: Record<string, unknown> | null = null;
    let accountGrowthError: string | null = null;
    try {
      accountGrowth = await loadAccountGrowth(supabaseAdmin, nowIso);
    } catch (accountGrowthErr) {
      accountGrowthError = "Account growth could not be loaded.";
      console.warn("[admin-dashboard-summary] account growth error:", accountGrowthErr);
    }

    let businessesWithLiveOffer = 0;
    let liveBusinessCountError: string | null = null;
    try {
      businessesWithLiveOffer = await loadDistinctLiveBusinessCount(supabaseAdmin, nowIso);
    } catch (liveBusinessErr) {
      liveBusinessCountError = "Businesses with a live offer could not be loaded.";
      console.warn("[admin-dashboard-summary] live business count error:", liveBusinessErr);
    }

    let recentDeals: Array<Record<string, unknown>> = [];
    let recentDealsError: string | null = null;
    try {
      recentDeals = await loadRecentDeals(supabaseAdmin, new Date(nowIso));
    } catch (recentDealErr) {
      recentDealsError = "Recent deals could not be loaded.";
      console.warn("[admin-dashboard-summary] recent deals error:", recentDealErr);
    }

    let onboarding: Array<Record<string, unknown>> = [];
    let onboardingError: string | null = null;
    try {
      onboarding = await loadOnboardingRows(supabaseAdmin);
    } catch (onboardingErr) {
      onboardingError = "Business onboarding progress could not be loaded.";
      console.warn("[admin-dashboard-summary] onboarding error:", onboardingErr);
    }

    let aiBudgetMonthlyUsd: number | null = null;
    let aiBudgetError: string | null = null;
    try {
      aiBudgetMonthlyUsd = await loadOptionalAiBudget(supabaseAdmin);
    } catch (budgetErr) {
      aiBudgetError = "AI monthly budget setting could not be loaded.";
      console.warn("[admin-dashboard-summary] AI budget setting error:", budgetErr);
    }

    const derivedQueue = normalizeQueue(businessHealth, {
      trialRequests,
      pendingBusinesses,
      failedBillingEvents: stripeWebhookErrors,
      openReports: openBusinessReports + openUserReports,
      offersNeedingReview,
    });
    const queueOverlay = await overlayQueueStatuses(supabaseAdmin, derivedQueue);
    const queueAll = queueOverlay.items;
    const queue = queueAll.filter((item) =>
      item.status !== "resolved" && item.status !== "dismissed");

    await supabaseAdmin.from("admin_audit_log").insert({
      admin_user_id: user.id,
      admin_email: adminUser.email ?? user.email ?? null,
      action: "admin_dashboard_summary_viewed",
      target_type: "admin_dashboard",
      request_id: requestId,
    });

    return json(req, {
      ok: true,
      request_id: requestId,
      admin: {
        email: adminUser.email,
        role: adminUser.role,
        display_name: adminUser.display_name,
        require_mfa: adminUser.require_mfa,
      },
      summary: {
        businesses: {
          active: activeBusinesses,
          pendingVerification: pendingBusinesses,
          suspended: suspendedBusinesses,
          trialingLocations,
          trialsEndingSoon,
          withLiveOffer: businessesWithLiveOffer,
        },
        trialRequests: {
          open: trialRequests,
          highRisk: highRiskRequests,
        },
        offers: {
          live: liveOffers,
          needsReview: offersNeedingReview,
        },
        deals: {
          createdToday: dealsCreatedToday,
          created7d: dealsCreated7d,
          liveNow: liveOffers,
        },
        redemptions: {
          today: redemptionsToday,
          last7d: redemptions7d,
          claimToRedeemRate30d: rate(redemptions30d, claims30d),
        },
        users: {
          active30d: activeUsers30d,
          definition: ACTIVE_USER_DEFINITION,
        },
        accounts: accountGrowth,
        activity: {
          claimsToday,
          redemptionsToday,
          newConsumersThisWeek,
        },
        billing: {
          pastDueLocations,
          pastDueBusinesses,
          missingStripeCustomers,
          stripeWebhookErrors,
        },
        security: {
          failedAdminActions,
        },
        apiSpend: {
          currentMonthUsd: currentMonthAiSpend.totalUsd,
          currentMonthAttempts: currentMonthAiSpend.attempts,
          currentMonthStart: currentMonthStart.toISOString(),
          priorMonthUsd: priorMonthAiSpend.totalUsd,
          priorMonthAttempts: priorMonthAiSpend.attempts,
          priorMonthStart: priorMonthStart.toISOString(),
          priorMonthEnd: currentMonthStart.toISOString(),
          updatedAt: nowIso,
          perGeneratedDealUsd: dealsCreatedCurrentMonth > 0
            ? Number((currentMonthAiSpend.totalUsd / dealsCreatedCurrentMonth).toFixed(6))
            : 0,
          budgetMonthlyUsd: aiBudgetMonthlyUsd,
        },
        prospects: {
          open: openProspects,
          readyToContact: readyProspects,
          acceptedClaimLinksThisMonth: acceptedClaimLinks,
        },
        moderation: {
          openReports: openBusinessReports + openUserReports,
        },
      },
      businessHealth,
      businessHealthTotal,
      businessHealthError,
      queue,
      queueAll,
      recentDeals,
      onboarding,
      summaryV2Errors: {
        activeUsers: activeUsersError,
        accountGrowth: accountGrowthError,
        businessesWithLiveOffer: liveBusinessCountError,
        recentDeals: recentDealsError,
        queueStatuses: queueOverlay.error,
        onboarding: onboardingError,
        aiBudget: aiBudgetError,
      },
      recentApplications: recentApplications ?? [],
      recentAudit: recentAudit ?? [],
    });
  } catch (err) {
    console.error("[admin-dashboard-summary] error:", err);
    return json(req, { error: "Failed to load admin dashboard summary.", request_id: requestId }, 500);
  }
});
