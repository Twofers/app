const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const PROD_FUNCTION_URL =
  "https://kvodhiqhdqnptqovovia.supabase.co/functions/v1/submit-business-application";
const IOS_BUNDLE_ID = "com.unvmex2.twoforone";
const ANDROID_PACKAGE = "com.unvmex2.twoforone";

const requiredFiles = [
  "website/index.html",
  "website/404.html",
  "website/localization.js",
  "website/store-links.js",
  "website/vercel.json",
  "website/.well-known/apple-app-site-association",
  "website/.well-known/assetlinks.json",
  "website/business/index.html",
  "website/business/start-trial/index.html",
  "website/business/claim/claim.js",
  "website/business/waitlist/index.html",
  "website/business/billing/start/index.html",
  "website/business/billing/success/index.html",
  "website/business/billing/cancel/index.html",
  "website/business/billing/manage/index.html",
  "website/business/billing/add-payment-method/index.html",
  "website/business/billing/status/index.html",
  "website/business/review-pending/index.html",
  "website/business/thanks/index.html",
  "website/quick-approve-trial/index.html",
  "website/quick-approve-trial/quick-approve.js",
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
  "website/admin/admin-guard.js",
  "website/admin/admin-login.js",
  "website/admin/trial-requests.js",
  "supabase/migrations/20260730123000_business_applications.sql",
  "supabase/migrations/20260730124000_business_onboarding_workflow.sql",
  "supabase/migrations/20260730125000_admin_dashboard_foundation.sql",
  "supabase/migrations/20260730126000_website_app_onboarding_sync.sql",
  "supabase/migrations/20260730127000_stripe_business_billing_reconnection.sql",
  "supabase/migrations/20260730128000_admin_ai_quota_resets.sql",
  "supabase/migrations/20260730129000_admin_onboarding_service_role_invite_gate.sql",
  "supabase/migrations/20260815120000_admin_email_quick_approval.sql",
  "supabase/functions/submit-business-application/index.ts",
  "supabase/functions/admin-dashboard-summary/index.ts",
  "supabase/functions/admin-auth-session/index.ts",
  "supabase/functions/admin-ai-usage/index.ts",
  "supabase/functions/admin-business-applications/index.ts",
  "supabase/functions/_shared/admin-alert-email.ts",
  "supabase/functions/_shared/admin-quick-approval.ts",
  "supabase/functions/_shared/admin-mfa.ts",
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

function walkFiles(relDir) {
  const absDir = path.join(ROOT, relDir);
  const files = [];
  for (const entry of fs.readdirSync(absDir, { withFileTypes: true })) {
    const rel = path.join(relDir, entry.name).replace(/\\/g, "/");
    if (entry.isDirectory()) files.push(...walkFiles(rel));
    else files.push(rel);
  }
  return files;
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

function assertNotIncludes(rel, text, needle, message) {
  if (text.includes(needle)) failures.push(`${rel}: ${message}`);
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

  const homePage = read("website/index.html");
  const startTrialPage = read("website/business/start-trial/index.html");
  const localizationScript = read("website/localization.js");
  const storeLinksScript = read("website/store-links.js");
  const claimScript = read("website/business/claim/claim.js");
  const adminLoginHtml = read("website/admin/login/index.html");
  const adminGuardScript = read("website/admin/admin-guard.js");
  const styles = read("website/styles.css");
  for (const rel of walkFiles("website").filter((file) => file.endsWith(".html"))) {
    const html = read(rel);
    assertNotIncludes(rel, html, "20260701-logo", "website pages must not point at stale stylesheet cache keys");
    if (html.includes("/styles.css?v=")) {
      assertIncludes(rel, html, "/styles.css?v=20260712-site-hardening", "website pages must load the current shared stylesheet version");
    }
    if (html.includes("/localization.js?v=")) {
      assertIncludes(rel, html, "/localization.js?v=20260712-site-hardening", "public pages must load the current localization version");
    }
  }
  assertIncludes("website/styles.css", styles, "[hidden]", "shared stylesheet must preserve hidden element behavior");
  assertIncludes("website/styles.css", styles, ".nav-menu-button", "shared stylesheet must support the mobile navigation menu");
  assertIncludes("website/styles.css", styles, ".admin-shell .nav-links", "shared stylesheet must keep admin navigation available on mobile");
  assertIncludes("website/styles.css", styles, "data-mobile-cards", "shared stylesheet must support mobile admin table cards");
  assertIncludes("website/styles.css", styles, ".skip-link", "shared stylesheet must expose a keyboard skip link");
  assertIncludes("website/styles.css", styles, "--accent-dark: #b85020", "interactive orange must meet normal-text contrast");
  assertMatch("website/styles.css", styles, /prefers-reduced-motion[\s\S]*scroll-behavior:\s*auto/, "reduced-motion mode must disable smooth scrolling");
  assertIncludes("website/index.html", homePage, "/localization.js", "home page must load the website localization script");
  assertIncludes("website/index.html", homePage, "data-language-option=\"es\"", "home page must expose Spanish language switching");
  assertIncludes("website/index.html", homePage, "data-language-option=\"ko\"", "home page must expose Korean language switching");
  assertIncludes("website/localization.js", localizationScript, "const messages", "localization script must define static website messages");
  assertIncludes("website/localization.js", localizationScript, "applyLocale", "localization script must apply selected locale");
  assertIncludes("website/localization.js", localizationScript, "trial.heading", "localization script must cover business onboarding page copy");
  for (const key of [
    "nav.menu",
    "a11y.skipToContent",
    "notFound.heading",
    "trial.jump",
    "support.heading",
    "delete.heading",
    "terms.heading",
    "privacy.heading",
    "businessTerms.heading",
    "thanks.heading",
    "waitlist.heading",
    "review.heading",
    "quickApproval.heading",
    "share.heading",
    "billing.start.heading",
    "billing.status.heading",
    "billing.manage.heading",
    "billing.success.heading",
    "billing.cancel.heading",
    "billing.addPayment.heading",
  ]) {
    assertIncludes("website/localization.js", localizationScript, key, `localization script must cover ${key}`);
  }
  assertIncludes("website/404.html", read("website/404.html"), 'name="robots" content="noindex,follow"', "custom 404 must not be indexed");
  assertIncludes("website/store-links.js", storeLinksScript, "ios: null", "iOS store CTA must stay hidden until a real listing exists");
  assertIncludes("website/store-links.js", storeLinksScript, "android: null", "Android store CTA must stay hidden until a real listing exists");
  assertIncludes("website/business/claim/claim.js", claimScript, "setFormEnabled(false)", "claim form must stay disabled until the token preview succeeds");
  assertNotIncludes("website/admin/login/index.html", adminLoginHtml, 'name="remember" type="checkbox" checked', "persistent admin sessions must be opt-in");
  assertIncludes("website/admin/login/index.html", adminLoginHtml, "/admin/admin-login.js?v=20260712-session-hardening", "admin login must load the current session script version");
  assertIncludes("website/business/claim/index.html", read("website/business/claim/index.html"), "/business/claim/claim.js?v=20260712-claim-hardening", "claim page must load the current guarded claim script version");
  assertIncludes("website/admin/admin-guard.js", adminGuardScript, "window.location.replace", "signed-out admin subroutes must return to login");
  for (const rel of walkFiles("website/admin").filter((file) => file.endsWith("/index.html") && !["website/admin/index.html", "website/admin/login/index.html"].includes(file))) {
    assertIncludes(rel, read(rel), "/admin/admin-guard.js", "admin subroutes must load the signed-out session guard");
  }
  for (const rel of walkFiles("website").filter((file) => file.endsWith(".html") && !file.startsWith("website/admin/"))) {
    const html = read(rel);
    assertIncludes(rel, html, "/localization.js", "public website pages must load shared localization");
    assertIncludes(rel, html, "data-language-option=\"es\"", "public website pages must expose Spanish language switching");
    assertIncludes(rel, html, "data-language-option=\"ko\"", "public website pages must expose Korean language switching");
    assertIncludes(rel, html, "data-site-menu-toggle", "public website pages must expose the mobile navigation menu");
  }
  assertIncludes("website/business/start-trial/index.html", startTrialPage, PROD_FUNCTION_URL, "business form must post to the production function URL");
  // Contract is the localized jump key, not an English literal that drifts
  // with copy edits (audit F-008: the old "Request DFW Business Access"
  // assertion outlived the approved copy).
  assertIncludes("website/business/start-trial/index.html", startTrialPage, 'data-i18n="trial.jump"', "business form must use trial onboarding copy");
  assertIncludes("website/business/start-trial/index.html", startTrialPage, 'class="button trial-jump"', "business onboarding mobile hero must provide a direct form jump");
  assertIncludes("website/business/start-trial/index.html", startTrialPage, 'name="company_website"', "business form must keep honeypot field");
  assertIncludes("website/business/start-trial/index.html", startTrialPage, 'name="terms_accepted"', "business form must require terms acknowledgement");
  assertIncludes("website/business/start-trial/index.html", startTrialPage, 'name="privacy_acknowledged"', "business form must require privacy acknowledgement");
  assertIncludes("website/business/start-trial/index.html", startTrialPage, 'window.location.assign("/business/thanks/")', "business form must redirect to thanks page");
  assertIncludes("website/business/start-trial/index.html", startTrialPage, "/styles.css", "business onboarding must use the shared website stylesheet");
  assertIncludes("website/business/start-trial/index.html", startTrialPage, 'value="coffee_shop"', "business type options must submit stable values under localization");
  assertIncludes("website/business/start-trial/index.html", startTrialPage, 'value="other_local_business"', "business type options must submit stable values under localization");
  assertNotIncludes("website/business/start-trial/index.html", startTrialPage, "<style>", "business onboarding must not use a one-off embedded stylesheet");
  assertIncludes("website/business-terms/index.html", read("website/business-terms/index.html"), "/styles.css", "business terms must use the shared website stylesheet");
  assertNotIncludes("website/business-terms/index.html", read("website/business-terms/index.html"), "<style>", "business terms must not use a one-off embedded stylesheet");
  assertIncludes("website/business/thanks/index.html", read("website/business/thanks/index.html"), "/styles.css", "business thanks page must use the shared website stylesheet");
  assertNotIncludes("website/business/thanks/index.html", read("website/business/thanks/index.html"), "<style>", "business thanks page must not use a one-off embedded stylesheet");

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
  assertMatch(
    "supabase/config.toml",
    config,
    /\[functions\.admin-ai-usage\][\s\S]*?verify_jwt\s*=\s*false[\s\S]*?entrypoint\s*=\s*"\.\/functions\/admin-ai-usage\/index\.ts"/,
    "admin-ai-usage must be registered for admin AI quota lookup/reset",
  );
  assertMatch(
    "supabase/config.toml",
    config,
    /\[functions\.admin-business-applications\][\s\S]*?verify_jwt\s*=\s*false[\s\S]*?entrypoint\s*=\s*"\.\/functions\/admin-business-applications\/index\.ts"/,
    "admin-business-applications must be registered for admin trial request decisions",
  );

  const cors = read("supabase/functions/_shared/cors.ts");
  assertIncludes("supabase/functions/_shared/cors.ts", cors, '"https://twoferapp.com"', "CORS must allow apex website");
  assertIncludes("supabase/functions/_shared/cors.ts", cors, '"https://www.twoferapp.com"', "CORS must allow www website");

  const migration = read("supabase/migrations/20260730123000_business_applications.sql");
  const workflowMigration = read("supabase/migrations/20260730124000_business_onboarding_workflow.sql");
  const adminMigration = read("supabase/migrations/20260730125000_admin_dashboard_foundation.sql");
  const syncMigration = read("supabase/migrations/20260730126000_website_app_onboarding_sync.sql");
  const stripeMigration = read("supabase/migrations/20260730127000_stripe_business_billing_reconnection.sql");
  const aiQuotaMigration = read("supabase/migrations/20260730128000_admin_ai_quota_resets.sql");
  const serviceRoleOnboardingMigration = read("supabase/migrations/20260730129000_admin_onboarding_service_role_invite_gate.sql");
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
  assertMatch("supabase/migrations/20260730128000_admin_ai_quota_resets.sql", aiQuotaMigration, /CREATE TABLE IF NOT EXISTS public\.admin_ai_quota_resets/i, "AI quota reset migration must create admin reset ledger");
  assertMatch("supabase/migrations/20260730128000_admin_ai_quota_resets.sql", aiQuotaMigration, /ALTER TABLE public\.admin_ai_quota_resets ENABLE ROW LEVEL SECURITY/i, "AI quota reset ledger must enable RLS");
  assertMatch("supabase/migrations/20260730128000_admin_ai_quota_resets.sql", aiQuotaMigration, /GRANT SELECT, INSERT ON TABLE public\.admin_ai_quota_resets TO service_role/i, "AI quota resets must be service-role only");
  assertMatch("supabase/migrations/20260730129000_admin_onboarding_service_role_invite_gate.sql", serviceRoleOnboardingMigration, /CREATE OR REPLACE FUNCTION public\.businesses_require_invite/i, "admin onboarding migration must update the invite gate trigger function");
  assertMatch("supabase/migrations/20260730129000_admin_onboarding_service_role_invite_gate.sql", serviceRoleOnboardingMigration, /auth\.role\(\)[\s\S]*service_role/i, "admin onboarding migration must allow service-role materialization");
  assertMatch("supabase/migrations/20260730129000_admin_onboarding_service_role_invite_gate.sql", serviceRoleOnboardingMigration, /business invite required/i, "admin onboarding migration must preserve normal invite-required enforcement");

  const fn = read("supabase/functions/submit-business-application/index.ts");
  assertIncludes("supabase/functions/submit-business-application/index.ts", fn, "company_website", "function must enforce honeypot");
  assertIncludes("supabase/functions/submit-business-application/index.ts", fn, "SUPABASE_SERVICE_ROLE_KEY", "function must use service role insert");
  assertIncludes("supabase/functions/submit-business-application/index.ts", fn, 'from("business_applications").insert', "function must insert applications");
  assertIncludes("supabase/functions/submit-business-application/index.ts", fn, "createOnboardingRequest", "function must save normalized onboarding requests");
  // This is a public, unauthenticated endpoint: it must never materialize a
  // business or Stripe customer for an existing account from an unverified
  // email in the request body. That happens only after the real owner
  // authenticates in the app, via get-business-onboarding-context.
  assertNotIncludes("supabase/functions/submit-business-application/index.ts", fn, "materializeBusinessForUser", "public intake function must not eagerly link unverified emails to existing accounts");
  assertNotIncludes("supabase/functions/submit-business-application/index.ts", fn, "ensureStripeCustomerForBusiness", "public intake function must not create Stripe customers from an unverified email");
  assertIncludes("supabase/functions/submit-business-application/index.ts", fn, "scoreApplication", "function must score trial requests deterministically");
  assertIncludes("supabase/functions/submit-business-application/index.ts", fn, "risk_reasons", "function must store admin-readable risk reasons");
  assertIncludes("supabase/functions/submit-business-application/index.ts", fn, "enqueueStripeCustomerSync", "function must queue Stripe sync when owner auth is still pending");
  assertIncludes("supabase/functions/submit-business-application/index.ts", fn, "RATE_LIMIT_MAX_PER_EMAIL", "function must rate limit public submissions");
  if (/OPENAI_|GOOGLE_PLACES_API_KEY/.test(fn)) {
    failures.push("supabase/functions/submit-business-application/index.ts: intake function must not depend on AI or places secrets");
  }

  const adminFn = read("supabase/functions/admin-dashboard-summary/index.ts");
  assertIncludes("supabase/functions/admin-dashboard-summary/index.ts", adminFn, 'from("admin_users")', "admin summary must check admin_users");
  assertIncludes("supabase/functions/admin-dashboard-summary/index.ts", adminFn, "admin_dashboard_summary_viewed", "admin summary must write audit log");
  assertIncludes("supabase/functions/admin-dashboard-summary/index.ts", adminFn, "location_entitlements", "admin summary must use current entitlement source of truth");
  assertIncludes("supabase/functions/admin-dashboard-summary/index.ts", adminFn, "business_subscriptions", "admin summary must include business subscription risk counts");
  assertIncludes("supabase/functions/admin-dashboard-summary/index.ts", adminFn, "business_billing_profiles", "admin summary must include missing Stripe customer counts");
  assertIncludes("supabase/functions/admin-dashboard-summary/index.ts", adminFn, "ai_generation_cost_daily", "admin summary must include AI API spend totals");
  if (/STRIPE_SECRET_KEY|OPENAI_API_KEY/.test(adminFn)) {
    failures.push("supabase/functions/admin-dashboard-summary/index.ts: summary function must not depend on payment or AI secrets");
  }

  const adminAuthFn = read("supabase/functions/admin-auth-session/index.ts");
  assertIncludes("supabase/functions/admin-auth-session/index.ts", adminAuthFn, 'from("admin_users")', "admin auth must check admin_users allowlist");
  assertIncludes("supabase/functions/admin-auth-session/index.ts", adminAuthFn, "admin_login_success", "admin auth must audit successful logins");
  assertIncludes("supabase/functions/admin-auth-session/index.ts", adminAuthFn, "admin_login_denied", "admin auth must audit denied logins");
  assertIncludes("supabase/functions/admin-auth-session/index.ts", adminAuthFn, "grant_type=password", "admin auth must perform password grant server-side");
  assertIncludes("supabase/functions/admin-auth-session/index.ts", adminAuthFn, "grant_type=refresh_token", "admin auth must support persistent browser sessions");
  if (/STRIPE_SECRET_KEY|OPENAI_API_KEY/.test(adminAuthFn)) {
    failures.push("supabase/functions/admin-auth-session/index.ts: admin auth must not depend on payment or AI secrets");
  }

  const adminAiFn = read("supabase/functions/admin-ai-usage/index.ts");
  assertIncludes("supabase/functions/admin-ai-usage/index.ts", adminAiFn, 'from("admin_users")', "admin AI usage must check admin_users");
  assertIncludes("supabase/functions/admin-ai-usage/index.ts", adminAiFn, "admin_ai_quota_reset", "admin AI usage must audit quota resets");
  assertIncludes("supabase/functions/admin-ai-usage/index.ts", adminAiFn, "admin_ai_quota_resets", "admin AI usage must write reset ledger rows");
  assertIncludes("supabase/functions/admin-ai-usage/index.ts", adminAiFn, "countAiQuotaUsage", "admin AI usage must use shared reset-aware quota counts");
  if (/STRIPE_SECRET_KEY|OPENAI_API_KEY/.test(adminAiFn)) {
    failures.push("supabase/functions/admin-ai-usage/index.ts: admin AI usage must not depend on payment or AI secrets");
  }

  const adminApplicationsFn = read("supabase/functions/admin-business-applications/index.ts");
  assertIncludes("supabase/functions/admin-business-applications/index.ts", adminApplicationsFn, 'from("admin_users")', "admin business applications must check admin_users");
  assertIncludes("supabase/functions/admin-business-applications/index.ts", adminApplicationsFn, 'from("business_applications")', "admin business applications must read and update trial requests");
  assertIncludes("supabase/functions/admin-business-applications/index.ts", adminApplicationsFn, "admin_business_application_approved_limited", "admin business applications must audit limited approvals");
  assertIncludes("supabase/functions/admin-business-applications/index.ts", adminApplicationsFn, "admin_business_application_approved_full", "admin business applications must audit full approvals");
  assertIncludes("supabase/functions/admin-business-applications/index.ts", adminApplicationsFn, "ensureStripeCustomerForBusiness", "admin business applications must seed billing access when approving linked owners");
  assertIncludes("supabase/functions/admin-business-applications/index.ts", adminApplicationsFn, "quick_preview", "admin business applications must expose token-gated quick preview");
  assertIncludes("supabase/functions/admin-business-applications/index.ts", adminApplicationsFn, "quick_confirm", "admin business applications must expose token-gated quick confirmation");
  assertIncludes("supabase/functions/admin-business-applications/index.ts", adminApplicationsFn, "quickApprovalApplicationIsEligible", "quick approvals must recheck low-risk eligibility server-side");
  assertIncludes("supabase/functions/admin-business-applications/index.ts", adminApplicationsFn, '"approve_full"', "quick confirmation must reuse the full 30-day trial decision path");
  if (/STRIPE_SECRET_KEY|OPENAI_API_KEY/.test(adminApplicationsFn)) {
    failures.push("supabase/functions/admin-business-applications/index.ts: admin trial decisions must not depend on payment or AI secrets");
  }

  const trialRequestsPage = read("website/admin/trial-requests/index.html");
  // Audit F-015: the dashboard markup lives in the token-gated fragment
  // website/admin/app.html; the signed-out /admin shell is deliberately
  // minimal and carries no tables.
  const adminDashboardPage = read("website/admin/app.html");
  const adminDashboardJs = read("website/admin/admin.js");
  const adminLoginPage = read("website/admin/login/index.html");
  assertIncludes("website/admin/app.html", adminDashboardPage, "data-mobile-cards", "admin dashboard tables must render as labeled cards on phones");
  assertIncludes("website/admin/admin.js", adminDashboardJs, "dataset.label", "admin dashboard dynamic rows must provide mobile table labels");
  assertIncludes("website/admin/login/index.html", adminLoginPage, "data:image/gif;base64", "admin MFA QR image must use a non-broken placeholder before setup");
  assertIncludes("website/admin/trial-requests/index.html", trialRequestsPage, "data-admin-business-applications-endpoint", "trial requests page must point at the admin application endpoint");
  assertIncludes("website/admin/trial-requests/index.html", trialRequestsPage, "/admin/trial-requests.js", "trial requests page must load the live admin workflow script");
  assertIncludes("website/admin/trial-requests/index.html", trialRequestsPage, "data-mobile-cards", "trial requests table must render as labeled cards on phones");

  const trialRequestsJs = read("website/admin/trial-requests.js");
  assertIncludes("website/admin/trial-requests.js", trialRequestsJs, "dataset.label", "trial requests dynamic rows must provide mobile table labels");
  assertIncludes("website/admin/trial-requests.js", trialRequestsJs, "action: \"list\"", "trial requests script must load applications from the backend");
  assertIncludes("website/admin/trial-requests.js", trialRequestsJs, "action: \"decide\"", "trial requests script must submit admin decisions");
  assertIncludes("website/admin/trial-requests.js", trialRequestsJs, "approve_limited", "trial requests script must expose limited approval");
  assertIncludes("website/admin/trial-requests.js", trialRequestsJs, "approve_full", "trial requests script must expose full approval");

  const quickApprovalPage = read("website/quick-approve-trial/index.html");
  const quickApprovalJs = read("website/quick-approve-trial/quick-approve.js");
  assertIncludes("website/quick-approve-trial/index.html", quickApprovalPage, "data-quick-approval-endpoint", "quick approval page must point at the server-authorized decision endpoint");
  assertIncludes("website/quick-approve-trial/index.html", quickApprovalPage, "data-confirm-quick-approval", "quick approval page must require an explicit confirmation control");
  assertIncludes("website/quick-approve-trial/quick-approve.js", quickApprovalJs, "window.history.replaceState", "quick approval page must remove the bearer fragment before requests");
  assertIncludes("website/quick-approve-trial/quick-approve.js", quickApprovalJs, 'post("quick_preview")', "quick approval page must preview before confirmation");
  assertIncludes("website/quick-approve-trial/quick-approve.js", quickApprovalJs, 'post("quick_confirm")', "quick approval page must submit the explicit confirmation");

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
