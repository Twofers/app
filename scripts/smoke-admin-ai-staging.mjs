// Deployed staging smoke for website/admin AI operations.
//
// Required:
//   TWOFER_STAGING_SUPABASE_URL
//   TWOFER_STAGING_SUPABASE_ANON_KEY
//   TWOFER_STAGING_ADMIN_EMAIL
//   TWOFER_STAGING_ADMIN_PASSWORD
//
// Optional:
//   TWOFER_STAGING_WEBSITE_URL=https://staging.example.com
//   TWOFER_STAGING_ADMIN_E2E_WRITE=true   # saves an inactive prompt version
//   TWOFER_ALLOW_PRODUCTION_ADMIN_AI_E2E=true

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KNOWN_PROD_SUPABASE = "https://kvodhiqhdqnptqovovia.supabase.co";

function loadEnvFile(file, env) {
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match && env[match[1]] === undefined) {
      env[match[1]] = match[2].replace(/^['"]|['"]$/g, "").trim();
    }
  }
}

function env() {
  const values = { ...process.env };
  loadEnvFile(path.join(REPO_ROOT, ".env"), values);
  loadEnvFile(path.join(REPO_ROOT, ".env.development.local"), values);
  return values;
}

function requireValue(values, key) {
  const value = values[key];
  if (!value) throw new Error(`Missing ${key}`);
  return value;
}

function redactEmail(email) {
  const [name, domain] = String(email).split("@");
  if (!name || !domain) return "[redacted]";
  return `${name.slice(0, 2)}***@${domain}`;
}

async function readJson(res) {
  const text = await res.text();
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    return { raw: text.slice(0, 160) };
  }
}

async function signIn({ url, anon, email, password }) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anon, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await readJson(res);
  if (!res.ok || !body.access_token) {
    throw new Error(`Admin sign-in failed with HTTP ${res.status}`);
  }
  return body.access_token;
}

async function callFunction({ url, anon, token, name, method = "POST", body }) {
  const res = await fetch(`${url}/functions/v1/${name}`, {
    method,
    headers: {
      apikey: anon,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "Content-Type": "application/json",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await readJson(res) };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const values = env();
const url = requireValue(values, "TWOFER_STAGING_SUPABASE_URL").replace(/\/+$/, "");
const anon = requireValue(values, "TWOFER_STAGING_SUPABASE_ANON_KEY");
const email = requireValue(values, "TWOFER_STAGING_ADMIN_EMAIL");
const password = requireValue(values, "TWOFER_STAGING_ADMIN_PASSWORD");
const websiteUrl = values.TWOFER_STAGING_WEBSITE_URL?.replace(/\/+$/, "");
const allowProd = values.TWOFER_ALLOW_PRODUCTION_ADMIN_AI_E2E === "true";
const writeEnabled = values.TWOFER_STAGING_ADMIN_E2E_WRITE === "true";

if (url === KNOWN_PROD_SUPABASE && !allowProd) {
  throw new Error("Refusing to run staging admin AI e2e against the known production Supabase project.");
}

console.log(`Admin AI staging smoke against ${url}`);
const token = await signIn({ url, anon, email, password });
console.log(`Signed in as ${redactEmail(email)}`);

const publicProjection = await callFunction({ url, anon, name: "public-local-businesses", method: "GET" });
assert(publicProjection.status === 200, `public-local-businesses expected 200, got ${publicProjection.status}`);
console.log("PASS public-local-businesses");

for (const name of [
  "admin-ai-prompts",
  "admin-ai-operating-report",
  "admin-prospect-enrich",
  "admin-demand-proof",
  "admin-sales-script",
]) {
  const unauth = await callFunction({ url, anon, name, body: {} });
  assert([401, 403].includes(unauth.status), `${name} unauth expected 401/403, got ${unauth.status}`);
  console.log(`PASS ${name} unauth fail-closed`);
}

const prompts = await callFunction({ url, anon, token, name: "admin-ai-prompts", body: { action: "list" } });
assert(prompts.status === 200 && prompts.body.ok && Array.isArray(prompts.body.prompts), `admin-ai-prompts list failed with HTTP ${prompts.status}`);
assert(prompts.body.prompts.some((row) => row.is_active && row.feature === "operating_report"), "No active operating_report prompt found");
console.log(`PASS prompt registry list (${prompts.body.prompts.length} versions)`);

const report = await callFunction({
  url,
  anon,
  token,
  name: "admin-ai-operating-report",
  body: {
    date_from: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    feature: "admin",
  },
});
assert(report.status === 200 && report.body.ok && report.body.report, `admin-ai-operating-report failed with HTTP ${report.status}`);
assert(report.body.report.ai && report.body.report.prospects, "Operating report missing AI/prospect sections");
console.log("PASS operating report");

if (writeEnabled) {
  const active = prompts.body.prompts.find((row) => row.is_active && row.feature === "operating_report");
  assert(active, "Cannot find active operating_report prompt for write smoke");
  const version = `admin-operating-report-e2e-${Date.now()}`;
  const write = await callFunction({
    url,
    anon,
    token,
    name: "admin-ai-prompts",
    body: {
      action: "upsert",
      feature: "operating_report",
      prompt_name: "operating_report",
      prompt_version: version,
      system_prompt: active.system_prompt,
      output_schema: active.output_schema || {},
      is_active: false,
    },
  });
  assert(write.status === 200 && write.body.ok && write.body.prompt?.is_active === false, `Prompt write smoke failed with HTTP ${write.status}`);
  console.log("PASS inactive prompt version write");
}

if (websiteUrl) {
  for (const route of ["/admin/sales-ai", "/admin/ai-operating-report", "/admin/ai-prompts"]) {
    const res = await fetch(`${websiteUrl}${route}`, { redirect: "follow" });
    assert(res.status === 200, `${route} expected HTTP 200, got ${res.status}`);
    console.log(`PASS website route ${route}`);
  }
}

console.log("Admin AI staging smoke passed.");
