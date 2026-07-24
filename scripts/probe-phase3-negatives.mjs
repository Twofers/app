// Phase 3 prod-safe behavioral negatives (pre-launch rare-feature QA plan §6).
//
// 100% negative/read tests — no prod mutation:
//   3.1  admin-* sweep: every admin fn must reject anon, a shopper JWT, and a
//        normal business-role JWT. Any 2xx is a P0 auth bypass.
//   3.2  simulate-subscribe must reject anon + normal user.
//   3.3  stripe-webhook rejects unsigned + garbage-signed payloads (400, no stack).
//   3.6  public reads return sane payloads with no secret-like strings.
//   3.8  refund/cancel fns reject invalid/foreign ids (no money moves).
//   3.9  website form fns reject invalid payloads.
//
// Identities: anon, TWOFER_QA_SHOPPER_* (consumer) and TWOFER_QA_BUSINESS_*
// (business role, MUST NOT be an admin — the probe checks this and skips the
// arm rather than reporting the resulting 200s as a bypass).
//
// Reads .env + .env.development.local. Read-only; no prod state is mutated.
// Run: node scripts/probe-phase3-negatives.mjs

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
function loadEnvFile(file, env) {
  if (!existsSync(file)) return;
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "").trim();
  }
}
const env = {};
loadEnvFile(path.join(REPO_ROOT, ".env"), env);
loadEnvFile(path.join(REPO_ROOT, ".env.development.local"), env);
const URL_BASE = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

let failed = 0;
const notes = [];
function check(name, pass, detail) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}  — ${detail}`);
  if (!pass) failed++;
}

async function call(fn, { token, body = {}, rawBody } = {}) {
  const res = await fetch(`${URL_BASE}/functions/v1/${fn}`, {
    method: "POST",
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token ?? ANON}`,
      "Content-Type": "application/json",
    },
    body: rawBody ?? JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, text };
}

async function signIn(email, password, label, { required = true } = {}) {
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const b = await res.json();
  if (!res.ok || !b.access_token) {
    console.error(`${label} sign-in failed (${res.status})`);
    if (required) process.exit(2);
    return null;
  }
  return b.access_token;
}

// Secret-ish patterns that must NEVER appear in a response body.
const SECRET_RE = /(sk_live_|sk_test_|sb_secret_|service_role|SUPABASE_SERVICE|-----BEGIN|whsec_|"password"|Bearer [A-Za-z0-9._-]{30})/;

const ADMIN_FNS = [
  "admin-ai-cost-ledger-reset", "admin-ai-operating-report", "admin-ai-prompts", "admin-ai-usage",
  "admin-business-applications", "admin-business-name-requests", "admin-claim-link-assistant",
  "admin-claim-link-create", "admin-dashboard-summary", "admin-demand-proof", "admin-onboarding-review-ai",
  "admin-promo-authorization", "admin-prospect-enrich", "admin-prospect-import", "admin-prospect-sales",
  "admin-prospect-score", "admin-qr-campaigns", "admin-reports", "admin-sales-script",
  "admin-trial-conversion-assistant", "admin-trial-create-from-prospect",
];
// admin-auth-session is the login endpoint (email/password); tested separately in 1c.

const shopperToken = await signIn(env.TWOFER_QA_SHOPPER_EMAIL, env.TWOFER_QA_SHOPPER_PASSWORD, "Shopper");
let businessToken = await signIn(env.TWOFER_QA_BUSINESS_EMAIL, env.TWOFER_QA_BUSINESS_PASSWORD, "Business role", { required: false });

/**
 * Guard this probe's own premise.
 *
 * 3.1 only means something when the extra identity is NOT an admin. The QA
 * "owner" account is the platform super-admin (`admin_users.role = owner`), so
 * pointing this arm at it produces 21 correct-but-alarming 200s that look
 * exactly like an auth bypass. Detect it and skip instead of crying wolf.
 */
async function isAdminIdentity(token) {
  if (!token) return false;
  const r = await call("admin-dashboard-summary", { token });
  return r.status >= 200 && r.status < 300;
}
if (await isAdminIdentity(businessToken)) {
  console.warn(
    "  WARNING  TWOFER_QA_BUSINESS_* is in the ADMIN allowlist — admin functions\n" +
      "           answering it is correct, not a bypass. Skipping the business arm.\n" +
      "           Point it at a normal business-role account to make 3.1 meaningful.",
  );
  businessToken = null;
}
console.log(`Identities: anon + shopper JWT${businessToken ? " + non-admin business-role JWT" : " (business arm SKIPPED)"}\n`);

// ---- 3.1 Admin negative sweep (anon + shopper + business owner) -----------
console.log("3.1 Admin negative sweep — any 2xx is a P0 auth bypass:");
for (const fn of ADMIN_FNS) {
  // Give admin-qr-campaigns a valid-shaped action so it reaches requireAdmin, not the 400 action-guard.
  const body = fn === "admin-qr-campaigns" ? { action: "overview" } : {};
  const anon = await call(fn, { token: ANON, body });
  const shop = await call(fn, { token: shopperToken, body });
  const rejected = (s) => s === 401 || s === 403;
  let ok = rejected(anon.status) && rejected(shop.status);
  let detail = `anon ${anon.status} / shopper ${shop.status}`;
  if (businessToken) {
    const biz = await call(fn, { token: businessToken, body });
    ok = ok && rejected(biz.status);
    detail += ` / business ${biz.status}`;
  }
  check(fn, ok, detail);
}

// ---- 3.2 simulate-subscribe lockdown --------------------------------------
console.log("\n3.2 simulate-subscribe lockdown:");
for (const [label, token] of [["anon", ANON], ["shopper", shopperToken]]) {
  const r = await call("simulate-subscribe", { token });
  const ok = [401, 403, 404, 410].includes(r.status);
  check(`simulate-subscribe ${label}`, ok, `HTTP ${r.status} ${r.text.slice(0, 80)}`);
}

// ---- 3.3 stripe-webhook signature rejection -------------------------------
console.log("\n3.3 stripe-webhook signature:");
{
  const unsigned = await call("stripe-webhook", { token: ANON, rawBody: JSON.stringify({ id: "evt_test", type: "charge.refunded" }) });
  const noStack = !/at .*\(|\.ts:\d+|Traceback|\.deno\//.test(unsigned.text);
  check("unsigned payload", unsigned.status === 400 && noStack, `HTTP ${unsigned.status}, no-stack=${noStack}`);
  const garbage = await fetch(`${URL_BASE}/functions/v1/stripe-webhook`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json", "stripe-signature": "t=123,v1=deadbeefgarbage" },
    body: JSON.stringify({ id: "evt_test", type: "charge.refunded" }),
  });
  const gtext = await garbage.text();
  const gNoStack = !/at .*\(|\.ts:\d+|Traceback/.test(gtext);
  check("garbage-signed payload", garbage.status === 400 && gNoStack, `HTTP ${garbage.status}, no-stack=${gNoStack}`);
}

// ---- 3.6 Public reads: sane, no secrets -----------------------------------
console.log("\n3.6 Public read endpoints (no secrets/PII leakage):");
{
  const pricing = await call("billing-pricing", { token: shopperToken });
  check("billing-pricing", pricing.status < 500 && !SECRET_RE.test(pricing.text), `HTTP ${pricing.status}, secret-free=${!SECRET_RE.test(pricing.text)}`);
  const locals = await call("public-local-businesses", { token: ANON, body: { limit: 3 } });
  const noEmail = !/@[a-z0-9.-]+\.[a-z]{2,}/i.test(locals.text); // public projection must not carry emails
  check("public-local-businesses", locals.status === 200 && !SECRET_RE.test(locals.text) && noEmail, `HTTP ${locals.status}, secret-free & no-email=${!SECRET_RE.test(locals.text) && noEmail}`);
  const activation = await call("business-activation-status", { token: shopperToken });
  check("business-activation-status", activation.status < 500 && !SECRET_RE.test(activation.text), `HTTP ${activation.status}, secret-free=${!SECRET_RE.test(activation.text)}`);
}

// ---- 3.8 Refund/cancel negative paths (NO money moves) --------------------
console.log("\n3.8 Refund/cancel with invalid/foreign ids (no money moves):");
for (const fn of ["stripe-request-introductory-refund", "stripe-cancel-paid-subscription", "stripe-cancel-trial-subscription"]) {
  const r = await call(fn, { token: shopperToken, body: { business_id: "00000000-0000-0000-0000-000000000000", subscription_id: "sub_nonexistent_qa" } });
  const ok = r.status >= 400 && r.status < 500 && !SECRET_RE.test(r.text);
  check(fn, ok, `HTTP ${r.status} ${r.text.slice(0, 70)}`);
}

// ---- 3.9 Website form fns reject invalid payloads -------------------------
console.log("\n3.9 Website form fns, invalid payloads:");
{
  const signup = await call("submit-launch-signup", { token: ANON, body: { email: "not-an-email" } });
  check("submit-launch-signup", signup.status === 400, `HTTP ${signup.status} ${signup.text.slice(0, 70)}`);
  const req = await call("request-business-on-twofer", { token: shopperToken, body: { business_name: "" } });
  const ok = req.status >= 400 && req.status < 500;
  check("request-business-on-twofer", ok, `HTTP ${req.status} ${req.text.slice(0, 70)}`);
}

console.log("");
if (failed > 0) { console.error(`${failed} PHASE-3 NEGATIVE CHECK(S) FAILED.`); process.exit(1); }
console.log("All Phase 3 negative checks passed.");
