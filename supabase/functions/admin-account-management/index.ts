import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.19.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

import { cancelStripeForBusinesses } from "../_shared/account-stripe-cancellation.ts";
import { applyBusinessBillingAccessState } from "../_shared/business-location-entitlement-sync.ts";
import { deleteAuthUserWithRetry } from "../_shared/auth-admin-delete-retry.ts";
import { isAal2 } from "../_shared/admin-mfa.ts";
import { clientIpFromRequest } from "../_shared/client-ip.ts";
import { getCorsHeaders } from "../_shared/cors.ts";
import { forbiddenForRedeemerResponse, isRedeemerUser } from "../_shared/redemption-role.ts";
import { staffUserIdsToSweep } from "../_shared/redemption-sweep.ts";
import { tryGetServiceRoleKey } from "../_shared/service-role-key.ts";

type AdminRole = "owner" | "admin" | "support" | "sales" | "finance" | "moderator" | "developer" | "read_only";
type AccountAction =
  | "list"
  | "detail"
  | "update_profile"
  | "send_password_reset"
  | "resend_verification"
  | "reset_mfa"
  | "correct_email"
  | "extend_trial"
  | "unlock"
  | "suspend"
  | "reactivate"
  | "archive"
  | "permanent_delete";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set<AccountAction>([
  "list",
  "detail",
  "update_profile",
  "send_password_reset",
  "resend_verification",
  "reset_mfa",
  "correct_email",
  "extend_trial",
  "unlock",
  "suspend",
  "reactivate",
  "archive",
  "permanent_delete",
]);
const READ_ROLES = new Set<AdminRole>(["owner", "admin", "support", "sales", "finance", "moderator", "developer", "read_only"]);
const EDIT_ROLES = new Set<AdminRole>(["owner", "admin", "support"]);
const LIFECYCLE_ROLES = new Set<AdminRole>(["owner", "admin", "moderator"]);
const REPAIR_ROLES = new Set<AdminRole>(["owner", "admin", "support"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const STAFF_LOCKOUT_WINDOW_MS = 5 * 60 * 1000;

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...getCorsHeaders(req), "Content-Type": "application/json" },
  });
}

function cleanText(value: unknown, max = 240): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function nullableText(value: unknown, max = 240): string | null {
  const cleaned = cleanText(value, max);
  return cleaned || null;
}

function cleanBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function reasonFrom(payload: Record<string, unknown>): string {
  return cleanText(payload.reason, 500);
}

function countResult(result: { count: number | null; error: unknown }): number {
  if (result.error) throw result.error;
  return result.count ?? 0;
}

async function audit(
  supabase: any,
  req: Request,
  admin: { id: string; email?: string | null },
  action: string,
  targetUserId: string | null,
  reason: string | null,
  requestId: string,
  beforeValue?: unknown,
  afterValue?: unknown,
  businessId?: string | null,
) {
  const { error } = await supabase.from("admin_audit_log").insert({
    admin_user_id: admin.id,
    admin_email: admin.email ?? null,
    action,
    target_type: "account",
    target_id: targetUserId,
    business_id: businessId ?? null,
    reason,
    before_value: beforeValue ?? null,
    after_value: afterValue ?? null,
    ip_address: clientIpFromRequest(req),
    user_agent: req.headers.get("user-agent"),
    request_id: requestId,
  });
  if (error) throw error;
}

async function ownedBusinesses(supabase: any, userId: string) {
  const { data, error } = await supabase
    .from("businesses")
    .select(
      "id,name,status,access_level,verification_status,category,short_description,description,contact_name,business_email,public_email,phone,address,address_line1,address_line2,city,state,postal_code,country,website,website_url,instagram_handle,instagram_url,facebook_url,pickup_note,hours_text,preferred_locale,claim_notifications_enabled,repeat_claim_policy_type,repeat_claim_cooldown_days,created_at,updated_at",
    )
    .eq("owner_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

async function ensureTargetIsManageable(supabase: any, targetUserId: string) {
  const { data: adminTarget, error } = await supabase
    .from("admin_users")
    .select("id,is_active")
    .eq("id", targetUserId)
    .maybeSingle();
  if (error) throw error;
  if (adminTarget) {
    throw Object.assign(new Error("Admin accounts must be managed from Admin Settings."), {
      status: 409,
      code: "admin_account_protected",
    });
  }
}

async function accountDetail(supabase: any, targetUserId: string) {
  const [authResult, profileResult, consumerResult, businesses] = await Promise.all([
    supabase.auth.admin.getUserById(targetUserId),
    supabase
      .from("profiles")
      .select("id,role,app_locale,account_status,suspended_at,suspension_reason,archived_at,archive_reason,updated_at")
      .eq("id", targetUserId)
      .maybeSingle(),
    supabase
      .from("consumer_profiles")
      .select(
        "user_id,zip_code,birthdate,notification_mode,radius_miles,deal_alerts_enabled,created_at,updated_at",
      )
      .eq("user_id", targetUserId)
      .maybeSingle(),
    ownedBusinesses(supabase, targetUserId),
  ]);

  if (authResult.error || !authResult.data?.user) {
    throw Object.assign(new Error("Account not found."), { status: 404, code: "account_not_found" });
  }
  if (profileResult.error) throw profileResult.error;
  if (consumerResult.error) throw consumerResult.error;

  const businessIds = businesses.map((business: { id: string }) => business.id);
  const [subscriptions, dealCount, claimCount, favoriteCount, auditRows, lockoutRows] = await Promise.all([
    businessIds.length
      ? supabase
        .from("business_subscriptions")
        .select(
          "business_id,billing_status,app_access_status,plan_name,stripe_subscription_id,trial_end,current_period_end,cancel_at_period_end,canceled_at,updated_at",
        )
        .in("business_id", businessIds)
      : Promise.resolve({ data: [], error: null }),
    businessIds.length
      ? supabase.from("deals").select("id", { count: "exact", head: true }).in("business_id", businessIds)
      : Promise.resolve({ count: 0, error: null }),
    supabase.from("deal_claims").select("id", { count: "exact", head: true }).eq("user_id", targetUserId),
    supabase.from("favorites").select("id", { count: "exact", head: true }).eq("user_id", targetUserId),
    supabase
      .from("admin_audit_log")
      .select("id,admin_email,action,reason,before_value,after_value,created_at")
      .eq("target_id", targetUserId)
      .order("created_at", { ascending: false })
      .limit(50),
    businessIds.length
      ? supabase
        .from("failed_redeem_attempts")
        .select("id,business_id,redemption_device_id,attempted_at")
        .in("business_id", businessIds)
        .gte("attempted_at", new Date(Date.now() - STAFF_LOCKOUT_WINDOW_MS).toISOString())
        .limit(500)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (subscriptions.error) throw subscriptions.error;
  if (auditRows.error) throw auditRows.error;
  if (lockoutRows.error) throw lockoutRows.error;

  const authUser = authResult.data.user;
  const factors = Array.isArray((authUser as { factors?: unknown }).factors)
    ? ((authUser as { factors?: Array<Record<string, unknown>> }).factors ?? [])
    : [];
  const role = profileResult.data?.role ?? (businesses.length ? "business" : "customer");
  return {
    account: {
      user_id: authUser.id,
      email: authUser.email ?? null,
      phone: authUser.phone ?? null,
      role,
      account_status: profileResult.data?.account_status ?? "active",
      app_locale: profileResult.data?.app_locale ?? null,
      created_at: authUser.created_at ?? null,
      last_sign_in_at: authUser.last_sign_in_at ?? null,
      email_confirmed_at: authUser.email_confirmed_at ?? null,
      banned_until: authUser.banned_until ?? null,
      suspended_at: profileResult.data?.suspended_at ?? null,
      suspension_reason: profileResult.data?.suspension_reason ?? null,
      archived_at: profileResult.data?.archived_at ?? null,
      archive_reason: profileResult.data?.archive_reason ?? null,
      mfa_factors: factors.map((factor) => ({
        factor_type: factor.factor_type ?? null,
        status: factor.status ?? null,
        created_at: factor.created_at ?? null,
      })),
    },
    consumer_profile: consumerResult.data ?? null,
    businesses,
    subscriptions: subscriptions.data ?? [],
    impact: {
      businesses: businesses.length,
      deals: countResult(dealCount),
      customer_claims: countResult(claimCount),
      favorites: countResult(favoriteCount),
      stripe_subscriptions: (subscriptions.data ?? []).filter((row: { stripe_subscription_id?: unknown }) =>
        typeof row.stripe_subscription_id === "string" && row.stripe_subscription_id.startsWith("sub_")
      ).length,
      recent_redemption_failures: (lockoutRows.data ?? []).length,
      redemption_lockout_active: (lockoutRows.data ?? []).length >= 10,
    },
    audit_log: auditRows.data ?? [],
  };
}

async function captureLifecycleState(supabase: any, userId: string, adminId: string) {
  const businesses = await ownedBusinesses(supabase, userId);
  const businessIds = businesses.map((row: { id: string }) => row.id);
  const [subscriptions, activeDeals] = await Promise.all([
    businessIds.length
      ? supabase
        .from("business_subscriptions")
        .select("business_id,billing_status,app_access_status,access_locked_at,access_locked_reason")
        .in("business_id", businessIds)
      : Promise.resolve({ data: [], error: null }),
    businessIds.length
      ? supabase.from("deals").select("id").in("business_id", businessIds).eq("is_active", true)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (subscriptions.error) throw subscriptions.error;
  if (activeDeals.error) throw activeDeals.error;

  const { error } = await supabase.from("account_lifecycle_state").upsert({
    user_id: userId,
    previous_businesses: businesses.map((row: Record<string, unknown>) => ({
      id: row.id,
      status: row.status,
      access_level: row.access_level,
    })),
    previous_subscriptions: subscriptions.data ?? [],
    previous_active_deal_ids: (activeDeals.data ?? []).map((row: { id: string }) => row.id),
    captured_at: new Date().toISOString(),
    captured_by: adminId,
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (error) throw error;
  return { businesses, businessIds };
}

async function suspendAccount(supabase: any, targetUserId: string, adminId: string, reason: string) {
  const before = await accountDetail(supabase, targetUserId);
  if (before.account.account_status === "archived") {
    throw Object.assign(new Error("Archived accounts cannot be suspended."), { status: 409 });
  }
  if (before.account.account_status !== "suspended") {
    const { businessIds } = await captureLifecycleState(supabase, targetUserId, adminId);
    const now = new Date().toISOString();
    const authUpdate = await supabase.auth.admin.updateUserById(targetUserId, { ban_duration: "876000h" });
    if (authUpdate.error) throw authUpdate.error;
    const profileUpdate = await supabase.from("profiles").upsert({
      id: targetUserId,
      role: before.account.role,
      account_status: "suspended",
      suspended_at: now,
      suspended_by: adminId,
      suspension_reason: reason,
      archived_at: null,
      archived_by: null,
      archive_reason: null,
      updated_at: now,
    }, { onConflict: "id" });
    if (profileUpdate.error) throw profileUpdate.error;
    if (businessIds.length) {
      const businessUpdate = await supabase.from("businesses").update({
        status: "suspended",
        suspended_at: now,
        suspended_by: adminId,
        suspension_reason: reason,
        can_publish_cached: false,
        updated_at: now,
      }).in("id", businessIds);
      if (businessUpdate.error) throw businessUpdate.error;
      const dealsUpdate = await supabase.from("deals").update({ is_active: false }).in("business_id", businessIds);
      if (dealsUpdate.error) throw dealsUpdate.error;
      const subscriptionsUpdate = await supabase.from("business_subscriptions").update({
        app_access_status: "suspended",
        access_locked_at: now,
        access_locked_reason: "admin_account_suspended",
        updated_at: now,
      }).in("business_id", businessIds);
      if (subscriptionsUpdate.error) throw subscriptionsUpdate.error;
    }
  }
  return { before, after: await accountDetail(supabase, targetUserId) };
}

async function reactivateAccount(supabase: any, targetUserId: string) {
  const before = await accountDetail(supabase, targetUserId);
  if (before.account.account_status !== "suspended") {
    throw Object.assign(new Error("Only suspended accounts can be reactivated."), { status: 409 });
  }
  const { data: snapshot, error: snapshotError } = await supabase
    .from("account_lifecycle_state")
    .select("previous_businesses,previous_subscriptions,previous_active_deal_ids")
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (snapshotError) throw snapshotError;
  if (!snapshot) {
    throw Object.assign(new Error("The pre-suspension restore snapshot is missing."), { status: 409 });
  }

  for (const business of snapshot.previous_businesses ?? []) {
    const { error } = await supabase.from("businesses").update({
      status: business.status,
      access_level: business.access_level,
      suspended_at: null,
      suspended_by: null,
      suspension_reason: null,
      updated_at: new Date().toISOString(),
    }).eq("id", business.id);
    if (error) throw error;
  }
  for (const subscription of snapshot.previous_subscriptions ?? []) {
    const { error } = await supabase.from("business_subscriptions").update({
      billing_status: subscription.billing_status,
      app_access_status: subscription.app_access_status,
      access_locked_at: subscription.access_locked_at,
      access_locked_reason: subscription.access_locked_reason,
      updated_at: new Date().toISOString(),
    }).eq("business_id", subscription.business_id);
    if (error) throw error;
  }

  const restorableIds = Array.isArray(snapshot.previous_active_deal_ids)
    ? snapshot.previous_active_deal_ids.filter((id: unknown): id is string => typeof id === "string" && UUID_RE.test(id))
    : [];
  for (const business of snapshot.previous_businesses ?? []) {
    const eligibility = await supabase.rpc("can_business_publish", { p_business_id: business.id });
    if (eligibility.error) throw eligibility.error;
    if (eligibility.data?.canPublish === true || eligibility.data?.can_publish === true) {
      const idsForBusiness = restorableIds;
      if (idsForBusiness.length) {
        const { error } = await supabase
          .from("deals")
          .update({ is_active: true })
          .eq("business_id", business.id)
          .in("id", idsForBusiness)
          .gt("end_time", new Date().toISOString());
        if (error) throw error;
      }
    }
  }

  const authUpdate = await supabase.auth.admin.updateUserById(targetUserId, { ban_duration: "none" });
  if (authUpdate.error) throw authUpdate.error;
  const profileUpdate = await supabase.from("profiles").update({
    account_status: "active",
    suspended_at: null,
    suspended_by: null,
    suspension_reason: null,
    updated_at: new Date().toISOString(),
  }).eq("id", targetUserId);
  if (profileUpdate.error) throw profileUpdate.error;
  const cleanup = await supabase.from("account_lifecycle_state").delete().eq("user_id", targetUserId);
  if (cleanup.error) throw cleanup.error;
  return { before, after: await accountDetail(supabase, targetUserId) };
}

async function stripeClientForAccount(supabase: any, businessIds: string[]) {
  if (!businessIds.length) return null;
  const { data: profiles, error } = await supabase
    .from("business_billing_profiles")
    .select("stripe_customer_livemode")
    .in("business_id", businessIds)
    .not("stripe_customer_id", "is", null);
  if (error) throw error;
  const stripeSecretKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeSecretKey) return null;
  const keyIsLive = stripeSecretKey.startsWith("sk_live_");
  const hasModeMismatch = (profiles ?? []).some((row: { stripe_customer_livemode?: unknown }) =>
    typeof row.stripe_customer_livemode === "boolean" && row.stripe_customer_livemode !== keyIsLive
  );
  if (hasModeMismatch) {
    throw Object.assign(new Error("Stripe key mode does not match this account's billing records."), {
      code: "stripe_mode_mismatch",
    });
  }
  return new Stripe(stripeSecretKey, { apiVersion: "2024-06-20" });
}

async function archiveAccount(supabase: any, targetUserId: string, adminId: string, reason: string) {
  const before = await accountDetail(supabase, targetUserId);
  if (before.account.account_status === "archived") return { before, after: before, stripe: null };
  const { businessIds } = await captureLifecycleState(supabase, targetUserId, adminId);
  const stripe = await cancelStripeForBusinesses({
    supabase,
    stripe: await stripeClientForAccount(supabase, businessIds),
    businessIds,
    source: "admin_account_archive",
  });
  const authUpdate = await supabase.auth.admin.updateUserById(targetUserId, { ban_duration: "876000h" });
  if (authUpdate.error) throw authUpdate.error;
  const now = new Date().toISOString();
  const profileUpdate = await supabase.from("profiles").upsert({
    id: targetUserId,
    role: before.account.role,
    account_status: "archived",
    archived_at: now,
    archived_by: adminId,
    archive_reason: reason,
    suspended_at: null,
    suspended_by: null,
    suspension_reason: null,
    updated_at: now,
  }, { onConflict: "id" });
  if (profileUpdate.error) throw profileUpdate.error;
  if (businessIds.length) {
    const businessUpdate = await supabase.from("businesses").update({
      status: "archived",
      access_level: "none",
      can_publish_cached: false,
      updated_at: now,
    }).in("id", businessIds);
    if (businessUpdate.error) throw businessUpdate.error;
    const dealsUpdate = await supabase.from("deals").update({ is_active: false }).in("business_id", businessIds);
    if (dealsUpdate.error) throw dealsUpdate.error;
  }
  return { before, after: await accountDetail(supabase, targetUserId), stripe };
}

async function permanentlyDeleteAccount(supabase: any, targetUserId: string) {
  const before = await accountDetail(supabase, targetUserId);
  const businesses = await ownedBusinesses(supabase, targetUserId);
  const businessIds = businesses.map((business: { id: string }) => business.id);
  const authProbe = await supabase.auth.admin.getUserById(targetUserId);
  if (authProbe.error) throw authProbe.error;
  const stripe = await cancelStripeForBusinesses({
    supabase,
    stripe: await stripeClientForAccount(supabase, businessIds),
    businessIds,
    source: "admin_account_delete",
  });

  const { data: devices, error: devicesError } = await supabase
    .from("redemption_devices")
    .select("staff_user_id")
    .eq("owner_id", targetUserId);
  if (devicesError) console.error("[admin-account-management] staff device lookup failed:", devicesError);
  for (const staffUserId of staffUserIdsToSweep(devices, targetUserId)) {
    const result = await deleteAuthUserWithRetry(supabase, staffUserId);
    if (result.error) console.error("[admin-account-management] staff auth delete failed:", result.error);
  }

  const purge = await supabase.rpc("purge_user_data", { p_user_id: targetUserId });
  if (purge.error) throw purge.error;
  for (const businessId of businessIds) {
    for (const bucket of ["business-logos", "deal-photos"]) {
      const listed = await supabase.storage.from(bucket).list(businessId, { limit: 1000 });
      if (listed.error) continue;
      const paths = (listed.data ?? []).map((object: { name: string }) => `${businessId}/${object.name}`);
      if (paths.length) await supabase.storage.from(bucket).remove(paths);
    }
  }
  const deleted = await deleteAuthUserWithRetry(supabase, targetUserId);
  if (deleted.error) throw deleted.error;
  return { before, stripe, auth_delete_attempts: deleted.attempts };
}

async function updateProfile(supabase: any, targetUserId: string, payload: Record<string, unknown>) {
  const before = await accountDetail(supabase, targetUserId);
  const email = cleanText(payload.email, 320).toLowerCase();
  if (email && email !== before.account.email) {
    throw Object.assign(new Error("Use Account Repair to correct a login email."), { status: 409 });
  }

  if (before.account.role === "business") {
    const businessId = cleanText(payload.business_id, 40) || before.businesses[0]?.id;
    if (!businessId || !before.businesses.some((business: { id: string }) => business.id === businessId)) {
      throw Object.assign(new Error("Business not found for this owner."), { status: 404 });
    }
    const patch = {
      name: cleanText(payload.name, 160),
      category: nullableText(payload.category, 100),
      short_description: nullableText(payload.short_description, 280),
      contact_name: nullableText(payload.contact_name, 160),
      business_email: nullableText(payload.business_email, 320),
      public_email: nullableText(payload.public_email, 320),
      phone: nullableText(payload.phone, 40),
      address: nullableText(payload.address, 300),
      address_line1: nullableText(payload.address_line1, 180),
      address_line2: nullableText(payload.address_line2, 180),
      city: nullableText(payload.city, 100),
      state: nullableText(payload.state, 40),
      postal_code: nullableText(payload.postal_code, 20),
      country: nullableText(payload.country, 2) ?? "US",
      website_url: nullableText(payload.website_url, 500),
      instagram_url: nullableText(payload.instagram_url, 500),
      facebook_url: nullableText(payload.facebook_url, 500),
      pickup_note: nullableText(payload.pickup_note, 500),
      hours_text: nullableText(payload.hours_text, 500),
      preferred_locale: nullableText(payload.preferred_locale, 10),
      claim_notifications_enabled: cleanBoolean(payload.claim_notifications_enabled),
      repeat_claim_policy_type: nullableText(payload.repeat_claim_policy_type, 40) ?? "NONE",
      repeat_claim_cooldown_days: payload.repeat_claim_cooldown_days === null ||
          payload.repeat_claim_cooldown_days === ""
        ? null
        : Math.max(1, Math.min(365, Number(payload.repeat_claim_cooldown_days) || 1)),
      updated_at: new Date().toISOString(),
    };
    if (!patch.name) throw Object.assign(new Error("Business name is required."), { status: 400 });
    const result = await supabase.from("businesses").update(patch).eq("id", businessId);
    if (result.error) throw result.error;
  } else {
    const zip = cleanText(payload.zip_code, 5);
    if (!/^\d{5}$/.test(zip)) throw Object.assign(new Error("ZIP code must be five digits."), { status: 400 });
    const birthdate = nullableText(payload.birthdate, 10);
    if (birthdate && !/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) {
      throw Object.assign(new Error("Birthday must use YYYY-MM-DD."), { status: 400 });
    }
    const notificationMode = cleanText(payload.notification_mode, 40) || "all_nearby";
    const radiusMiles = Math.max(1, Math.min(50, Number(payload.radius_miles) || 3));
    const result = await supabase.from("consumer_profiles").upsert({
      user_id: targetUserId,
      zip_code: zip,
      birthdate,
      notification_mode: notificationMode,
      radius_miles: radiusMiles,
      deal_alerts_enabled: cleanBoolean(payload.deal_alerts_enabled) ?? false,
      updated_at: new Date().toISOString(),
    }, { onConflict: "user_id" });
    if (result.error) throw result.error;
  }
  return { before, after: await accountDetail(supabase, targetUserId) };
}

async function listAccounts(
  supabase: any,
  payload: Record<string, unknown>,
  page: number,
  perPage: number,
) {
  const query = cleanText(payload.query, 160);
  const base = await supabase.rpc("admin_account_directory", {
    p_query: nullableText(query, 160),
    p_role: nullableText(payload.role, 20),
    p_status: nullableText(payload.status, 20),
    p_limit: perPage,
    p_offset: (page - 1) * perPage,
  });
  if (base.error) throw base.error;
  if (!query) return base.data ?? [];

  const matchedUserIds = new Set<string>();
  const normalizedCode = query.replace(/[^a-z0-9]/gi, "").toUpperCase();
  const businessQuery = supabase
    .from("businesses")
    .select("id,owner_id")
    .or(`phone.ilike.%${query.replace(/[,%()]/g, "")}%,id.eq.${UUID_RE.test(query) ? query : "00000000-0000-0000-0000-000000000000"}`)
    .limit(50);
  const codeQuery = normalizedCode.length >= 4 && normalizedCode.length <= 24
    ? supabase.from("deal_claims").select("user_id").eq("short_code", normalizedCode).limit(20)
    : Promise.resolve({ data: [], error: null });
  const [businessMatches, codeMatches] = await Promise.all([businessQuery, codeQuery]);
  if (businessMatches.error) throw businessMatches.error;
  if (codeMatches.error) throw codeMatches.error;
  for (const row of businessMatches.data ?? []) {
    if (UUID_RE.test(String(row.owner_id || ""))) matchedUserIds.add(String(row.owner_id));
  }
  for (const row of codeMatches.data ?? []) {
    if (UUID_RE.test(String(row.user_id || ""))) matchedUserIds.add(String(row.user_id));
  }

  const rowsById = new Map<string, Record<string, unknown>>();
  for (const row of base.data ?? []) rowsById.set(String(row.user_id), row);
  for (const userId of [...matchedUserIds].slice(0, 50)) {
    if (rowsById.has(userId)) continue;
    const result = await supabase.rpc("admin_account_directory", {
      p_query: userId,
      p_role: nullableText(payload.role, 20),
      p_status: nullableText(payload.status, 20),
      p_limit: 1,
      p_offset: 0,
    });
    if (result.error) throw result.error;
    for (const row of result.data ?? []) rowsById.set(String(row.user_id), row);
  }
  return [...rowsById.values()].slice(0, perPage);
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sendAuthLinkEmail(params: {
  supabase: any;
  userId: string;
  kind: "recovery" | "verification";
}) {
  const userResult = await params.supabase.auth.admin.getUserById(params.userId);
  if (userResult.error || !userResult.data.user?.email) {
    throw Object.assign(new Error("The account does not have a deliverable email address."), { status: 409 });
  }
  const email = userResult.data.user.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) throw Object.assign(new Error("The account email is invalid."), { status: 409 });
  const siteUrl = (Deno.env.get("SITE_URL") ?? "https://www.twoferapp.com").replace(/\/$/, "");
  const linkResult = await params.supabase.auth.admin.generateLink(
    params.kind === "recovery"
      ? { type: "recovery", email, options: { redirectTo: `${siteUrl}/reset-password` } }
      : { type: "magiclink", email, options: { redirectTo: `${siteUrl}/business` } },
  );
  if (linkResult.error) throw linkResult.error;
  const actionLink = linkResult.data?.properties?.action_link;
  if (!actionLink) throw new Error("The secure account link could not be generated.");
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) throw Object.assign(new Error("Account email delivery is not configured."), { status: 503 });
  const passwordReset = params.kind === "recovery";
  const subject = passwordReset ? "Reset your Twofer password" : "Verify your Twofer email";
  const intro = passwordReset
    ? "Use the secure link below to reset your Twofer password."
    : "Use the secure link below to verify your email and continue setting up Twofer.";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: "Twofer <support@twoferapp.com>",
      to: [email],
      subject,
      text: `${intro}\n\n${actionLink}\n\nIf you did not request this, contact support@twoferapp.com.`,
      html: `<p>${escapeHtml(intro)}</p><p><a href="${escapeHtml(actionLink)}">${passwordReset ? "Reset password" : "Verify email"}</a></p><p>If you did not request this, contact support@twoferapp.com.</p>`,
    }),
  });
  if (!response.ok) {
    throw Object.assign(new Error("The secure account email could not be delivered."), { status: 502 });
  }
}

async function resetMfa(supabase: any, userId: string) {
  const result = await supabase.auth.admin.getUserById(userId);
  if (result.error || !result.data.user) throw result.error ?? new Error("Account not found.");
  const factors = Array.isArray((result.data.user as { factors?: unknown }).factors)
    ? ((result.data.user as { factors?: Array<{ id?: string; factor_type?: string }> }).factors ?? [])
    : [];
  let deleted = 0;
  for (const factor of factors) {
    if (!factor.id || factor.factor_type !== "totp") continue;
    const removal = await supabase.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
    if (removal.error) throw removal.error;
    deleted += 1;
  }
  return deleted;
}

async function extendTrial(supabase: any, userId: string, days: number) {
  const businesses = await ownedBusinesses(supabase, userId);
  const businessId = String(businesses[0]?.id || "");
  if (!businessId) throw Object.assign(new Error("This account does not own a business."), { status: 409 });
  const current = await supabase
    .from("business_subscriptions")
    .select("trial_type,trial_start,trial_end,app_access_status,current_period_start,current_period_end,cancel_at_period_end")
    .eq("business_id", businessId)
    .maybeSingle();
  if (current.error) throw current.error;
  if (current.data?.trial_type !== "admin_comp" || !["trialing", "trial_limited"].includes(String(current.data?.app_access_status))) {
    throw Object.assign(new Error("Only an active admin-granted trial can be extended here."), { status: 409 });
  }
  const base = Math.max(Date.now(), Date.parse(String(current.data.trial_end || "")) || 0);
  const trialEnd = new Date(base + days * 86400000).toISOString();
  const update = await supabase.from("business_subscriptions").update({
    trial_end: trialEnd,
    updated_at: new Date().toISOString(),
  }).eq("business_id", businessId);
  if (update.error) throw update.error;
  await applyBusinessBillingAccessState({
    supabase,
    businessId,
    provider: "admin",
    appAccessStatus: current.data.app_access_status,
    trialType: "admin_comp",
    trialStart: current.data.trial_start,
    trialEnd,
    currentPeriodStart: current.data.current_period_start,
    currentPeriodEnd: current.data.current_period_end,
    cancelAtPeriodEnd: current.data.cancel_at_period_end === true,
  });
  return { businessId, trialEnd };
}

async function unlockRedemptionAttempts(supabase: any, userId: string) {
  const businesses = await ownedBusinesses(supabase, userId);
  const businessIds = businesses.map((row: { id: string }) => row.id);
  if (!businessIds.length) throw Object.assign(new Error("This account does not own a business."), { status: 409 });
  const before = await supabase
    .from("failed_redeem_attempts")
    .select("id", { count: "exact", head: true })
    .in("business_id", businessIds)
    .gte("attempted_at", new Date(Date.now() - STAFF_LOCKOUT_WINDOW_MS).toISOString());
  if (before.error) throw before.error;
  if ((before.count ?? 0) < 10) {
    throw Object.assign(new Error("No active staff redemption lockout exists for this account."), { status: 409 });
  }
  const cleared = await supabase
    .from("failed_redeem_attempts")
    .delete()
    .in("business_id", businessIds)
    .gte("attempted_at", new Date(Date.now() - STAFF_LOCKOUT_WINDOW_MS).toISOString());
  if (cleared.error) throw cleared.error;
  return before.count ?? 0;
}

serve(async (req) => {
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json(req, { error: "Method not allowed." }, 405);
  const requestId = crypto.randomUUID();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = tryGetServiceRoleKey();
    const authHeader = req.headers.get("Authorization") ?? "";
    const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!supabaseUrl || !serviceRoleKey) return json(req, { error: "Account management is not configured." }, 500);

    const supabaseUser = createClient(supabaseUrl, serviceRoleKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const userResult = await supabaseUser.auth.getUser();
    const user = userResult.data.user;
    if (userResult.error || !user) return json(req, { error: "Unauthorized." }, 401);
    if (isRedeemerUser(user)) return forbiddenForRedeemerResponse(corsHeaders);

    const { data: adminUser, error: adminError } = await supabaseAdmin
      .from("admin_users")
      .select("id,email,role,is_active,require_mfa")
      .eq("id", user.id)
      .maybeSingle();
    if (adminError) throw adminError;
    if (!adminUser?.is_active || !READ_ROLES.has(adminUser.role as AdminRole)) {
      return json(req, { error: "Forbidden." }, 403);
    }
    if (adminUser.require_mfa && !isAal2(bearerToken)) {
      return json(req, { error: "MFA verification required." }, 403);
    }

    let payload: Record<string, unknown>;
    try {
      payload = await req.json();
    } catch {
      return json(req, { error: "Invalid JSON body." }, 400);
    }
    const action = cleanText(payload.action, 40) as AccountAction;
    if (!ACTIONS.has(action)) return json(req, { error: "Unknown action." }, 400);

    if (action === "list") {
      const page = Math.max(1, Number(payload.page) || 1);
      const perPage = Math.max(1, Math.min(100, Number(payload.per_page) || 50));
      const data = await listAccounts(supabaseAdmin, payload, page, perPage);
      await audit(supabaseAdmin, req, adminUser, "admin_accounts_listed", null, null, requestId);
      return json(req, {
        ok: true,
        accounts: data,
        page,
        per_page: perPage,
        total: Number(data?.[0]?.total_count ?? data.length),
        admin: { role: adminUser.role },
      });
    }

    const targetUserId = cleanText(payload.user_id, 40);
    if (!UUID_RE.test(targetUserId)) return json(req, { error: "A valid user_id is required." }, 400);
    await ensureTargetIsManageable(supabaseAdmin, targetUserId);

    if (action === "detail") {
      const detail = await accountDetail(supabaseAdmin, targetUserId);
      await audit(supabaseAdmin, req, adminUser, "admin_account_viewed", targetUserId, null, requestId);
      return json(req, {
        ok: true,
        ...detail,
        permissions: {
          can_edit: EDIT_ROLES.has(adminUser.role as AdminRole),
          can_manage_lifecycle: LIFECYCLE_ROLES.has(adminUser.role as AdminRole),
          can_permanently_delete: adminUser.role === "owner",
          can_repair: REPAIR_ROLES.has(adminUser.role as AdminRole),
        },
      });
    }

    const reason = reasonFrom(payload);
    if (reason.length < 5) return json(req, { error: "A reason of at least five characters is required." }, 400);
    if (action === "update_profile" && !EDIT_ROLES.has(adminUser.role as AdminRole)) {
      return json(req, { error: "Your admin role cannot edit account profiles." }, 403);
    }
    const repairActions = new Set<AccountAction>([
      "send_password_reset",
      "resend_verification",
      "reset_mfa",
      "correct_email",
      "extend_trial",
      "unlock",
    ]);
    if (repairActions.has(action) && !REPAIR_ROLES.has(adminUser.role as AdminRole)) {
      return json(req, { error: "Your admin role cannot repair accounts." }, 403);
    }
    if (action !== "update_profile" && !repairActions.has(action) && !LIFECYCLE_ROLES.has(adminUser.role as AdminRole)) {
      return json(req, { error: "Your admin role cannot change account lifecycle." }, 403);
    }
    if (action === "permanent_delete" && adminUser.role !== "owner") {
      return json(req, { error: "Only the owner admin can permanently delete accounts." }, 403);
    }
    if (action === "permanent_delete" && payload.confirmation !== "DELETE") {
      return json(req, { error: "Type DELETE to confirm permanent deletion." }, 400);
    }
    if (action === "archive" && payload.confirmation !== "ARCHIVE") {
      return json(req, { error: "Type ARCHIVE to confirm account archival." }, 400);
    }
    if (action === "suspend" && payload.confirmation !== "SUSPEND") {
      return json(req, { error: "Type SUSPEND to confirm account suspension." }, 400);
    }
    if (action === "reset_mfa" && payload.confirmation !== "RESET MFA") {
      return json(req, { error: "Type RESET MFA to confirm factor removal." }, 400);
    }
    if (action === "correct_email" && payload.confirmation !== "CONFIRM EMAIL") {
      return json(req, { error: "Type CONFIRM EMAIL to confirm the login-email correction." }, 400);
    }

    let result: any;
    if (action === "update_profile") result = await updateProfile(supabaseAdmin, targetUserId, payload);
    if (action === "suspend") result = await suspendAccount(supabaseAdmin, targetUserId, adminUser.id, reason);
    if (action === "reactivate") result = await reactivateAccount(supabaseAdmin, targetUserId);
    if (action === "archive") result = await archiveAccount(supabaseAdmin, targetUserId, adminUser.id, reason);
    if (action === "permanent_delete") result = await permanentlyDeleteAccount(supabaseAdmin, targetUserId);
    if (repairActions.has(action)) {
      const before = await accountDetail(supabaseAdmin, targetUserId);
      let repairResult: Record<string, unknown> = {};
      if (action === "send_password_reset") {
        await sendAuthLinkEmail({ supabase: supabaseAdmin, userId: targetUserId, kind: "recovery" });
        repairResult = { delivered: true };
      }
      if (action === "resend_verification") {
        await sendAuthLinkEmail({ supabase: supabaseAdmin, userId: targetUserId, kind: "verification" });
        repairResult = { delivered: true };
      }
      if (action === "reset_mfa") repairResult = { factors_removed: await resetMfa(supabaseAdmin, targetUserId) };
      if (action === "correct_email") {
        const email = cleanText(payload.email, 320).toLowerCase();
        if (!EMAIL_RE.test(email)) throw Object.assign(new Error("Enter a valid replacement email."), { status: 400 });
        const update = await supabaseAdmin.auth.admin.updateUserById(targetUserId, { email, email_confirm: true });
        if (update.error) throw update.error;
        repairResult = { email_corrected: true };
      }
      if (action === "extend_trial") {
        const days = Math.max(1, Math.min(30, Number(payload.days) || 0));
        if (!Number.isInteger(days)) throw Object.assign(new Error("Trial extension days must be a whole number."), { status: 400 });
        repairResult = await extendTrial(supabaseAdmin, targetUserId, days);
      }
      if (action === "unlock") repairResult = { attempts_cleared: await unlockRedemptionAttempts(supabaseAdmin, targetUserId) };
      result = {
        before,
        after: await accountDetail(supabaseAdmin, targetUserId),
        repair: repairResult,
      };
    }

    await audit(
      supabaseAdmin,
      req,
      adminUser,
      `admin_account_${action}`,
      targetUserId,
      reason,
      requestId,
      result?.before
        ? { account: result.before.account, impact: result.before.impact }
        : null,
      result?.after
        ? { account: result.after.account, impact: result.after.impact }
        : { permanently_deleted: true, stripe: result?.stripe ?? null },
      action === "permanent_delete" ? null : result?.before?.businesses?.[0]?.id ?? null,
    );
    return json(req, {
      ok: true,
      action,
      account: result?.after?.account ?? null,
      repair: result?.repair ?? null,
      stripe: result?.stripe ?? null,
      permanently_deleted: action === "permanent_delete",
      request_id: requestId,
    });
  } catch (error) {
    console.error("[admin-account-management] error:", error);
    const value = error as { message?: string; status?: number; code?: string };
    return json(req, {
      error: value.message || "Account management failed.",
      error_code: value.code || "account_management_failed",
      request_id: requestId,
    }, value.status && value.status >= 400 && value.status < 600 ? value.status : 500);
  }
});
