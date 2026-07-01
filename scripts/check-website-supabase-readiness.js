const fs = require("node:fs");
const path = require("node:path");

const ROOT = process.cwd();
const PROD_FUNCTION_URL =
  "https://kvodhiqhdqnptqovovia.supabase.co/functions/v1/submit-business-application";
const IOS_BUNDLE_ID = "com.unvmex2.twoforone";
const ANDROID_PACKAGE = "com.unvmex2.twoforone";

const requiredFiles = [
  "website/index.html",
  "website/styles.css",
  "website/_headers",
  "website/_redirects",
  "website/vercel.json",
  "website/.well-known/apple-app-site-association",
  "website/.well-known/assetlinks.json",
  "website/business/index.html",
  "website/business/thanks/index.html",
  "website/business-terms/index.html",
  "website/delete-account/index.html",
  "website/privacy/index.html",
  "website/s/index.html",
  "website/support/index.html",
  "website/terms/index.html",
  "supabase/migrations/20260730123000_business_applications.sql",
  "supabase/functions/submit-business-application/index.ts",
];

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
  for (const rel of websiteFiles) {
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
      const target = routeToFile(link);
      if (target && !exists(target)) failures.push(`${rel}: broken local link ${link}`);
    }
  }

  const businessPage = read("website/business/index.html");
  assertIncludes("website/business/index.html", businessPage, PROD_FUNCTION_URL, "business form must post to the production function URL");
  assertIncludes("website/business/index.html", businessPage, 'name="company_website"', "business form must keep honeypot field");
  assertIncludes("website/business/index.html", businessPage, 'name="terms_accepted"', "business form must require terms acknowledgement");
  assertIncludes("website/business/index.html", businessPage, 'name="privacy_acknowledged"', "business form must require privacy acknowledgement");
  assertIncludes("website/business/index.html", businessPage, 'window.location.assign("/business/thanks/")', "business form must redirect to thanks page");

  const redirects = read("website/_redirects");
  assertMatch("website/_redirects", redirects, /^\/s\/\*\s+\/s\/index\.html\s+200/m, "must rewrite shared offer links to /s/index.html");

  const headers = read("website/_headers");
  assertIncludes("website/_headers", headers, "/.well-known/apple-app-site-association", "must set AASA headers");
  assertIncludes("website/_headers", headers, "/.well-known/assetlinks.json", "must set assetlinks headers");

  const vercel = JSON.parse(read("website/vercel.json"));
  if (!JSON.stringify(vercel.rewrites ?? []).includes("/s/:path*")) {
    failures.push("website/vercel.json: must rewrite shared offer links on Vercel");
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

  const cors = read("supabase/functions/_shared/cors.ts");
  assertIncludes("supabase/functions/_shared/cors.ts", cors, '"https://twoferapp.com"', "CORS must allow apex website");
  assertIncludes("supabase/functions/_shared/cors.ts", cors, '"https://www.twoferapp.com"', "CORS must allow www website");

  const migration = read("supabase/migrations/20260730123000_business_applications.sql");
  assertMatch("supabase/migrations/20260730123000_business_applications.sql", migration, /ALTER TABLE public\.business_applications ENABLE ROW LEVEL SECURITY/i, "business_applications must enable RLS");
  assertMatch("supabase/migrations/20260730123000_business_applications.sql", migration, /REVOKE ALL ON TABLE public\.business_applications FROM anon, authenticated/i, "business_applications must revoke public client role access");
  assertMatch("supabase/migrations/20260730123000_business_applications.sql", migration, /CREATE TRIGGER business_applications_set_updated_at/i, "business_applications must maintain updated_at");

  const fn = read("supabase/functions/submit-business-application/index.ts");
  assertIncludes("supabase/functions/submit-business-application/index.ts", fn, "company_website", "function must enforce honeypot");
  assertIncludes("supabase/functions/submit-business-application/index.ts", fn, "SUPABASE_SERVICE_ROLE_KEY", "function must use service role insert");
  assertIncludes("supabase/functions/submit-business-application/index.ts", fn, 'from("business_applications").insert', "function must insert applications");
  if (/STRIPE_|OPENAI_|GOOGLE_PLACES_API_KEY/.test(fn)) {
    failures.push("supabase/functions/submit-business-application/index.ts: intake function must not depend on payment or AI secrets");
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
