const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const PROD_FUNCTION_URL =
  "https://kvodhiqhdqnptqovovia.supabase.co/functions/v1/submit-business-application";
const IOS_BUNDLE_ID = "com.unvmex2.twoforone";
const ANDROID_PACKAGE = "com.unvmex2.twoforone";

const requiredFiles = [
  "website/index.html",
  "website/vercel.json",
  "website/.well-known/apple-app-site-association",
  "website/.well-known/assetlinks.json",
  "website/business/index.html",
  "website/business/start-trial/index.html",
  "website/business/waitlist/index.html",
  "website/business/billing/start/index.html",
  "website/business/billing/success/index.html",
  "website/business/billing/cancel/index.html",
  "website/business/billing/manage/index.html",
  "website/business/billing/add-payment-method/index.html",
  "website/business/billing/status/index.html",
  "website/business/review-pending/index.html",
  "website/business/thanks/index.html",
  "website/business-terms/index.html",
  "website/admin/index.html",
  "website/admin/login/index.html",
  "website/admin/businesses/index.html",
  "website/admin/businesses/new/index.html",
  "website/admin/businesses/detail/index.html",
  "website/admin/trial-requests/index.html",
  "website/admin/offers/index.html",
  "website/admin/billing/events/index.html",
  "website/admin/audit-log/index.html",
  "website/admin/settings/index.html",
  "website/admin/admin.js",
  "supabase/migrations/20260730123000_business_applications.sql",
  "supabase/migrations/20260730124000_business_onboarding_workflow.sql",
  "supabase/migrations/20260730125000_admin_dashboard_foundation.sql",
  "supabase/migrations/20260730126000_website_app_onboarding_sync.sql",
  "supabase/migrations/20260730127000_stripe_business_billing_reconnection.sql",
  "supabase/functions/submit-business-application/index.ts",
  "supabase/functions/admin-dashboard-summary/index.ts",
  "supabase/functions/get-business-onboarding-context/index.ts",
  "supabase/functions/update-business-profile-section/index.ts",
  "supabase/functions/stripe-create-checkout-session/index.ts",
  "supabase/functions/stripe-customer-portal-session/index.ts",
  "supabase/functions/stripe-ensure-customer/index.ts",
  "supabase/functions/stripe-backfill-customers/index.ts",
  "supabase/functions/stripe-webhook/index.ts",
  "supabase/functions/billing-checkout-redirect/index.ts",
];

const externallyServedRoutes = new Set(["/privacy", "/privacy/", "/support", "/support/", "/terms", "/terms/"]);

const failures = [];
const warnings = [];
const mojibakePatterns = ["\u00c2", "\ufffd", "\u00e2\u20ac"];

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), "utf8");
}

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function routeToFile(route) {
  if (route === "/") return "website/index.html";
  if (!route.startsWith("/")) return null;
  const clean = route.replace(/[?#].*$/, "");
  if (path.extname(clean)) return `website${clean}`;
  if (clean.startsWith("/s/")) return "website/s/index.html";
  return `website${clean.endsWith("/") ? clean : `${clean}/`}index.html`;
}

function assertIncludes(rel, text, needle, message) {
  if (!text.includes(needle)) failures.push(`${rel}: ${message}`);
}

function assertMatch(rel, text, pattern, message) {
  if (!pattern.test(text)) failures.push(`${rel}: ${message}`);
}

for (const rel of requiredFiles) {
  if (!exists(rel)) failures.push(`${rel}: required file is missing`);
}

if (failures.length === 0) {
  const websiteFiles = requiredFiles.filter((rel) => rel.startsWith("website/"));
  const ownedTextFiles = websiteFiles.filter((rel) => rel !== "website/index.html");
  for (const rel of ownedTextFiles) {
    const text = read(rel);
    if (mojibakePatterns.some((pattern) => text.includes(pattern))) {
      failures.push(`${rel}: contains mojibake text`);
    }
  }

  for (const rel of websiteFiles.filter((rel) => rel.endsWith(".html"))) {
    const html = read(rel);
    const links = [...html.matchAll(/\s(?:href|src)=["']([^"']+)["']/g)].map((match) => match[1]);
    for (const link of links) {
      if (!link.startsWith("/") || link.startsWith("//")) continue;
      if (externallyServedRoutes.has(link)) continue;
      const target = routeToFile(link);
      if (target && !exists(target)) failures.push(`${rel}: broken local link ${link}`);
    }
  }

  const businessPage = read("website/business/index.html");
  assertIncludes("website/business/index.html", businessPage, PROD_FUNCTION_URL, "business form must post to the production function URL");
  assertIncludes("website/business/index.html", businessPage, "Start Your DFW Business Trial", "business form must use trial onboarding copy");
  assertIncludes("website/business/index.html", businessPage, 'name="company_website"', "business form must keep honeypot field");
  assertIncludes("website/business/index.html", businessPage, 'name="terms_accepted"', "business form must require terms acknowledgement");
  assertIncludes("website/business/index.html", businessPage, 'name="privacy_acknowledged"', "business form must require privacy acknowledgement");
  assertIncludes("website/business/index.html", businessPage, 'window.location.assign("/business/thanks/")', "business form must redirect to thanks page");

  const vercel = JSON.parse(read("website/vercel.json"));
  if (!JSON.stringify(vercel.rewrites ?? []).includes("/business")) {
    failures.push("website/vercel.json: must rewrite /business on Vercel");
  }
  if (!JSON.stringify(vercel.rewrites ?? []).includes("/business/start-trial")) {
    failures.push("website/vercel.json: must rewrite /business/start-trial on Vercel");
  }
  if (!JSON.stringify(vercel.rewrites ?? []).includes("/business-terms")) {
    failures.push("website/vercel.json: must rewrite /business-terms on Vercel");
  }
  if (!JSON.stringify(vercel.rewrites ?? []).includes("/business/billing/start")) {
    failures.push("website/vercel.json: must rewrite /business/billing/start on Vercel");
  }
  if (!JSON.stringify(vercel.rewrites ?? []).includes("/business/billing/success")) {
    failures.push("website/vercel.json: must rewrite /business/billing/success on Vercel");
  }
  if (!JSON.stringify(vercel.rewrites ?? []).includes("/business/billing/cancel")) {
    failures.push("website/vercel.json: must rewrite /business/billing/cancel on Vercel");
  }
  if (!JSON.stringify(vercel.rewrites ?? []).includes("/business/billing/manage")) {
    failures.push("website/vercel.json: must rewrite /business/billing/manage on Vercel");
  }
  if (!JSON.stringify(vercel.rewrites ?? []).includes("/business/billing/add-payment-method")) {
    failures.push("website/vercel.json: must rewrite /business/billing/add-payment-method on Vercel");
  }
  if (!JSON.stringify(vercel.rewrites ?? []).includes("/business/billing/status")) {
    failures.push("website/vercel.json: must rewrite /business/billing/status on Vercel");
  }
  if (!JSON.stringify(vercel.rewrites ?? []).includes("/admin")) {
    failures.push("website/vercel.json: must rewrite /admin on Vercel");
  }
  if (!JSON.stringify(vercel.headers ?? []).includes("/.well-known/apple-app-site-association")) {
    failures.push("website/vercel.json: must set AASA headers on Vercel");
  }
  if (!JSON.stringify(vercel.headers ?? []).includes("/.well-known/assetlinks.json")) {
    failures.push("website/vercel.json: must set assetlinks headers on Vercel");
  }

  const aasaText = read("website/.well-known/apple-app-site-association");
  const assetlinksText = read("website/.well-known/assetlinks.json");
  const aasa = JSON.parse(aasaText);
  const assetlinks = JSON.parse(assetlinksText);

  const appIDs = aasa?.applinks?.details?.flatMap((detail) => detail.appIDs ?? []) ?? [];
  if (!appIDs.some((appID) => typeof appID === "string" && appID.endsWith(`.${IOS_BUNDLE_ID}`))) {
    failures.push("website/.well-known/apple-app-site-association: missing iOS bundle id appID");
  }
  if (!aasaText.includes("/s/*")) {
    failures.push("website/.well-known/apple-app-site-association: missing /s/* component");
  }
  if (aasaText.includes("TEAMID")) {
    warnings.push("website/.well-known/apple-app-site-association still contains TEAMID placeholder");
  }

  const androidTargets = Array.isArray(assetlinks) ? assetlinks.map((entry) => entry.target) : [];
  const hasAndroidTarget = androidTargets.some((target) => target?.package_name === ANDROID_PACKAGE);
  if (!hasAndroidTarget) {
    warnings.push("website/.well-known/assetlinks.json does not yet enable Android App Links");
  }
  if (assetlinksText.includes("REPLACE_WITH_GOOGLE_PLAY_APP_SIGNING_SHA256")) {
    warnings.push("website/.well-known/assetlinks.json still contains Android signing SHA-256 placeholder");
  }

  const config = read("supabase/config.toml");
  assertMatch(
    "supabase/config.toml",
    config,
    /\[functions\.submit-business-application\][\s\S]*?verify_jwt\s*=\s*false[\s\S]*?entrypoint\s*=\s*"\.\/functions\/submit-business-application\/index\.ts"/,
    "submit-business-application must be registered as a public web form function",
  );
  assertMatch(
    "supabase/config.toml",
    config,
    /\[functions\.stripe-create-checkout-session\][\s\S]*?verify_jwt\s*=\s*false[\s\S]*?entrypoint\s*=\s*"\.\/functions\/stripe-create-checkout-session\/index\.ts"/,
    "stripe-create-checkout-session must be registered as a server-authorized web/admin function",
  );
  assertMatch(
    "supabase/config.toml",
    config,
    /\[functions\.stripe-customer-portal-session\][\s\S]*?verify_jwt\s*=\s*false[\s\S]*?entrypoint\s*=\s*"\.\/functions\/stripe-customer-portal-session\/index\.ts"/,
    "stripe-customer-portal-session must be registered as a server-authorized web/admin function",
  );
  assertMatch(
    "supabase/config.toml",
    config,
    /\[functions\.stripe-ensure-customer\][\s\S]*?verify_jwt\s*=\s*false[\s\S]*?entrypoint\s*=\s*"\.\/functions\/stripe-ensure-customer\/index\.ts"/,
    "stripe-ensure-customer must be registered for admin customer sync",
  );
  assertMatch(
    "supabase/config.toml",
    config,
    /\[functions\.stripe-backfill-customers\][\s\S]*?verify_jwt\s*=\s*false[\s\S]*?entrypoint\s*=\s*"\.\/functions\/stripe-backfill-customers\/index\.ts"/,
    "stripe-backfill-customers must be registered for controlled admin backfill",
  );

  const cors = read("supabase/functions/_shared/cors.ts");
  assertIncludes("supabase/functions/_shared/cors.ts", cors, '"https://twoferapp.com"', "CORS must allow apex website");
  assertIncludes("supabase/functions/_shared/cors.ts", cors, '"https://www.twoferapp.com"', "CORS must allow www website");

  const migration = read("supabase/migrations/20260730123000_business_applications.sql");
  const workflowMigration = read("supabase/migrations/20260730124000_business_onboarding_workflow.sql");
  const adminMigration = read("supabase/migrations/20260730125000_admin_dashboard_foundation.sql");
  const syncMigration = read("supabase/migrations/20260730126000_website_app_onboarding_sync.sql");
  const stripeMigration = read("supabase/migrations/20260730127000_stripe_business_billing_reconnection.sql");
  assertMatch("supabase/migrations/20260730123000_business_applications.sql", migration, /ALTER TABLE public\.business_applications ENABLE ROW LEVEL SECURITY/i, "business_applications must enable RLS");
  assertMatch("supabase/migrations/20260730123000_business_applications.sql", migration, /REVOKE ALL ON TABLE public\.business_applications FROM anon, authenticated/i, "business_applications must revoke public client role access");
  assertMatch("supabase/migrations/20260730123000_business_applications.sql", migration, /CREATE TRIGGER business_applications_set_updated_at/i, "business_applications must maintain updated_at");
  assertMatch("supabase/migrations/20260730124000_business_onboarding_workflow.sql", workflowMigration, /ADD COLUMN IF NOT EXISTS access_tier/i, "business onboarding workflow must store access tiers");
  assertMatch("supabase/migrations/20260730124000_business_onboarding_workflow.sql", workflowMigration, /trial_limited/i, "business onboarding workflow must support limited trials");
  assertMatch("supabase/migrations/20260730124000_business_onboarding_workflow.sql", workflowMigration, /field_invited/i, "business onboarding workflow must reserve field invites");
  assertMatch("supabase/migrations/20260730125000_admin_dashboard_foundation.sql", adminMigration, /CREATE TABLE IF NOT EXISTS public\.admin_users/i, "admin dashboard must have server-side admin allowlist");
  assertMatch("supabase/migrations/20260730125000_admin_dashboard_foundation.sql", adminMigration, /CREATE TABLE IF NOT EXISTS public\.admin_audit_log/i, "admin dashboard must have audit log");
  assertMatch("supabase/migrations/20260730125000_admin_dashboard_foundation.sql", adminMigration, /CREATE OR REPLACE FUNCTION public\.can_business_publish/i, "admin dashboard must include central publishing helper");
  assertMatch("supabase/migrations/20260730126000_website_app_onboarding_sync.sql", syncMigration, /CREATE TABLE IF NOT EXISTS public\.business_onboarding_requests/i, "sync migration must store raw/normalized onboarding requests");
  assertMatch("supabase/migrations/20260730126000_website_app_onboarding_sync.sql", syncMigration, /CREATE TABLE IF NOT EXISTS public\.business_members/i, "sync migration must link owner membership");
  assertMatch("supabase/migrations/20260730126000_website_app_onboarding_sync.sql", syncMigration, /CREATE TABLE IF NOT EXISTS public\.business_invites/i, "sync migration must create pending owner invites");
  assertMatch("supabase/migrations/20260730126000_website_app_onboarding_sync.sql", syncMigration, /CREATE TABLE IF NOT EXISTS public\.business_profile_field_sources/i, "sync migration must track field sources");
  assertMatch("supabase/migrations/20260730126000_website_app_onboarding_sync.sql", syncMigration, /CREATE TABLE IF NOT EXISTS public\.business_profile_revision_log/i, "sync migration must track app/admin revisions");
  assertMatch("supabase/migrations/20260730126000_website_app_onboarding_sync.sql", syncMigration, /policy_name := 'redeemer_' \|\| tbl \|\| '_block_all'/i, "new sync tables must generate redeemer block policies");
  for (const [table, purpose] of [
    ["business_billing_profiles", "business billing contacts and Stripe customers"],
    ["business_subscriptions", "business Stripe subscription state"],
    ["billing_events", "auditable billing event history"],
    ["stripe_checkout_sessions", "web/admin checkout sessions"],
    ["stripe_portal_sessions", "web/admin portal sessions"],
    ["stripe_sync_jobs", "pending Stripe customer sync jobs"],
    ["billing_reminders", "payment reminder scheduling"],
    ["billing_tokens", "single-use billing links"],
  ]) {
    assertMatch(
      "supabase/migrations/20260730127000_stripe_business_billing_reconnection.sql",
      stripeMigration,
      new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table}`, "i"),
      `Stripe reconnection migration must create ${purpose}`,
    );
    assertMatch(
      "supabase/migrations/20260730127000_stripe_business_billing_reconnection.sql",
      stripeMigration,
      new RegExp(`ALTER TABLE public\\.${table} ENABLE ROW LEVEL SECURITY`, "i"),
      `${table} must enable RLS`,
    );
  }
  assertMatch("supabase/migrations/20260730127000_stripe_business_billing_reconnection.sql", stripeMigration, /policy_name := 'redeemer_' \|\| tbl \|\| '_block_all'/i, "Stripe billing tables must block redeemer sessions");
  assertMatch("supabase/migrations/20260730127000_stripe_business_billing_reconnection.sql", stripeMigration, /CREATE OR REPLACE FUNCTION public\.can_business_publish/i, "Stripe reconnection must update central publishing helper");
  assertMatch("supabase/migrations/20260730127000_stripe_business_billing_reconnection.sql", stripeMigration, /business_subscriptions/i, "publish helper must read business subscription status");
  assertMatch("supabase/migrations/20260730127000_stripe_business_billing_reconnection.sql", stripeMigration, /location_entitlements/i, "publish helper must keep legacy entitlement fallback");

  const fn = read("supabase/functions/submit-business-application/index.ts");
  assertIncludes("supabase/functions/submit-business-application/index.ts", fn, "company_website", "function must enforce honeypot");
  assertIncludes("supabase/functions/submit-business-application/index.ts", fn, "SUPABASE_SERVICE_ROLE_KEY", "function must use service role insert");
  assertIncludes("supabase/functions/submit-business-application/index.ts", fn, 'from("business_applications").insert', "function must insert applications");
  assertIncludes("supabase/functions/submit-business-application/index.ts", fn, "createOnboardingRequest", "function must save normalized onboarding requests");
  assertIncludes("supabase/functions/submit-business-application/index.ts", fn, "materializeBusinessForUser", "function must link existing app users to canonical business profiles");
  assertIncludes("supabase/functions/submit-business-application/index.ts", fn, "scoreApplication", "function must score trial requests deterministically");
  assertIncludes("supabase/functions/submit-business-application/index.ts", fn, "risk_reasons", "function must store admin-readable risk reasons");
  assertIncludes("supabase/functions/submit-business-application/index.ts", fn, "ensureStripeCustomerForBusiness", "function must create Stripe customers when a canonical owner exists");
  assertIncludes("supabase/functions/submit-business-application/index.ts", fn, "enqueueStripeCustomerSync", "function must queue Stripe sync when owner auth is still pending");
  if (/OPENAI_|GOOGLE_PLACES_API_KEY/.test(fn)) {
    failures.push("supabase/functions/submit-business-application/index.ts: intake function must not depend on AI or places secrets");
  }

  const adminFn = read("supabase/functions/admin-dashboard-summary/index.ts");
  assertIncludes("supabase/functions/admin-dashboard-summary/index.ts", adminFn, 'from("admin_users")', "admin summary must check admin_users");
  assertIncludes("supabase/functions/admin-dashboard-summary/index.ts", adminFn, "admin_dashboard_summary_viewed", "admin summary must write audit log");
  assertIncludes("supabase/functions/admin-dashboard-summary/index.ts", adminFn, "location_entitlements", "admin summary must use current entitlement source of truth");
  assertIncludes("supabase/functions/admin-dashboard-summary/index.ts", adminFn, "business_subscriptions", "admin summary must include business subscription risk counts");
  assertIncludes("supabase/functions/admin-dashboard-summary/index.ts", adminFn, "business_billing_profiles", "admin summary must include missing Stripe customer counts");
  if (/STRIPE_SECRET_KEY|OPENAI_API_KEY/.test(adminFn)) {
    failures.push("supabase/functions/admin-dashboard-summary/index.ts: summary function must not depend on payment or AI secrets");
  }

  const contextFn = read("supabase/functions/get-business-onboarding-context/index.ts");
  assertIncludes("supabase/functions/get-business-onboarding-context/index.ts", contextFn, "materializeBusinessForUser", "context function must materialize website requests on app login");
  assertIncludes("supabase/functions/get-business-onboarding-context/index.ts", contextFn, "can_business_publish", "context function must use central publish helper");
  assertIncludes("supabase/functions/get-business-onboarding-context/index.ts", contextFn, "enqueueStripeCustomerSync", "context function must queue Stripe sync after app materialization");
  if (/STRIPE_SECRET_KEY|OPENAI_API_KEY|stripe-create-checkout|customer-portal/i.test(contextFn)) {
    failures.push("supabase/functions/get-business-onboarding-context/index.ts: app context must not return billing or AI secret surfaces");
  }

  const updateFn = read("supabase/functions/update-business-profile-section/index.ts");
  assertIncludes("supabase/functions/update-business-profile-section/index.ts", updateFn, "profile_conflict", "profile update function must reject stale edits");
  assertIncludes("supabase/functions/update-business-profile-section/index.ts", updateFn, "business_profile_revision_log", "profile update function must write revision history");
  assertIncludes("supabase/functions/update-business-profile-section/index.ts", updateFn, "business_profile_field_sources", "profile update function must update field sources");
  if (/STRIPE_SECRET_KEY|OPENAI_API_KEY|stripe-create-checkout|customer-portal/i.test(updateFn)) {
    failures.push("supabase/functions/update-business-profile-section/index.ts: app update must not return billing or AI secret surfaces");
  }

  const checkoutFn = read("supabase/functions/stripe-create-checkout-session/index.ts");
  assertIncludes("supabase/functions/stripe-create-checkout-session/index.ts", checkoutFn, "business_id", "checkout function must be business-scoped");
  assertIncludes("supabase/functions/stripe-create-checkout-session/index.ts", checkoutFn, 'config.purchaseSurface !== "web_only"', "checkout function must be gated to web billing");
  assertIncludes("supabase/functions/stripe-create-checkout-session/index.ts", checkoutFn, "billing_tokens", "checkout function must support controlled emailed billing links");
  assertIncludes("supabase/functions/stripe-create-checkout-session/index.ts", checkoutFn, "business_members", "checkout function must authorize merchant ownership");
  assertIncludes("supabase/functions/stripe-create-checkout-session/index.ts", checkoutFn, "admin_users", "checkout function must authorize admin starts");
  assertIncludes("supabase/functions/stripe-create-checkout-session/index.ts", checkoutFn, "ensureStripeCustomerForBusiness", "checkout function must ensure Stripe customer before checkout");
  assertIncludes("supabase/functions/stripe-create-checkout-session/index.ts", checkoutFn, "stripe_checkout_sessions", "checkout function must audit checkout sessions");
  assertIncludes("supabase/functions/stripe-create-checkout-session/index.ts", checkoutFn, "/business/billing/success/", "checkout function must return website success URL");
  assertIncludes("supabase/functions/stripe-create-checkout-session/index.ts", checkoutFn, "/business/billing/cancel/", "checkout function must return website cancel URL");
  if (/user_owns_business_location|trial_acknowledged|trial_checkout_intents|twoforone:\/\//i.test(checkoutFn)) {
    failures.push("supabase/functions/stripe-create-checkout-session/index.ts: checkout must not use old mobile/location trial billing paths");
  }

  const portalFn = read("supabase/functions/stripe-customer-portal-session/index.ts");
  assertIncludes("supabase/functions/stripe-customer-portal-session/index.ts", portalFn, "business_id", "portal function must be business-scoped");
  assertIncludes("supabase/functions/stripe-customer-portal-session/index.ts", portalFn, "business_billing_profiles", "portal function must read business Stripe customer id");
  assertIncludes("supabase/functions/stripe-customer-portal-session/index.ts", portalFn, "billing_tokens", "portal function must support controlled emailed portal links");
  assertIncludes("supabase/functions/stripe-customer-portal-session/index.ts", portalFn, "business_members", "portal function must authorize merchant ownership");
  assertIncludes("supabase/functions/stripe-customer-portal-session/index.ts", portalFn, "stripe_portal_sessions", "portal function must audit portal sessions");
  assertIncludes("supabase/functions/stripe-customer-portal-session/index.ts", portalFn, "/business/billing/manage/", "portal function must return website manage URL");
  if (/user_owns_business_location|location_id|twoforone:\/\//i.test(portalFn)) {
    failures.push("supabase/functions/stripe-customer-portal-session/index.ts: portal must not use old mobile/location billing paths");
  }

  const webhookFn = read("supabase/functions/stripe-webhook/index.ts");
  assertIncludes("supabase/functions/stripe-webhook/index.ts", webhookFn, "syncBusinessSubscriptionFromStripe", "webhook must sync business subscription state");
  assertIncludes("supabase/functions/stripe-webhook/index.ts", webhookFn, "businessIdForStripeCustomer", "webhook must map Stripe customer ids back to businesses");
  assertIncludes("supabase/functions/stripe-webhook/index.ts", webhookFn, "business_subscriptions", "webhook must write business subscriptions");
  assertIncludes("supabase/functions/stripe-webhook/index.ts", webhookFn, "billing_events", "webhook must write billing event history");
  assertIncludes("supabase/functions/stripe-webhook/index.ts", webhookFn, "businessId && !isRefundWebhookEvent(event.type)", "webhook must not swallow refund events in the business billing branch");

  const redirectFn = read("supabase/functions/billing-checkout-redirect/index.ts");
  assertIncludes("supabase/functions/billing-checkout-redirect/index.ts", redirectFn, "/business/billing/success/", "billing redirect must land on website success page");
  assertIncludes("supabase/functions/billing-checkout-redirect/index.ts", redirectFn, "/business/billing/cancel/", "billing redirect must land on website cancel page");
  if (/twoforone:\/\//i.test(redirectFn)) {
    failures.push("supabase/functions/billing-checkout-redirect/index.ts: billing redirect must not deep-link into the mobile app");
  }
}

if (process.env.REQUIRE_SIGNED_ASSOCIATION_FILES === "true") {
  if (warnings.some((warning) => warning.includes("Android App Links"))) {
    failures.push("website/.well-known/assetlinks.json is missing the Google Play App Signing SHA-256");
  }
  failures.push(...warnings);
  warnings.length = 0;
}

for (const warning of warnings) console.warn(`Warning: ${warning}`);

if (failures.length > 0) {
  console.error("Website/Supabase local readiness check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Website/Supabase local readiness check passed.");
