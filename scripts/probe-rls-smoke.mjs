// Authenticated RLS smoke probe. Run IMMEDIATELY after applying any migration
// that touches RLS policies or policy helper functions.
//
// Why this exists: 20260712120000 shipped a policy helper that returned NULL
// (not false) for normal users, and 21 RESTRICTIVE policies silently locked
// every signed-in user out of every guarded table. SQL-editor checks run as
// postgres and bypass RLS entirely, so only a probe with a REAL user JWT can
// catch that class of bug.
//
// Reads .env for EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY and signs
// in with TWOFER_QA_SHOPPER_EMAIL / TWOFER_QA_SHOPPER_PASSWORD — a throwaway shopper
// account; never a real customer, and never a business owner (see the owner guard
// below). Falls back to TWOFER_SMOKE_* only so pre-existing setups keep running:
// that variable is shared with business-side probes and has pointed at a
// business-owning account, which makes every check here vacuous.
//
// Checks (all read-only):
//   1. SELECT on deals          (consumer feed — the table that bricked the app)
//   2. SELECT on businesses     (deal detail join)
//   3. SELECT own consumer_profiles row (onboarding read-back)
//   4. SELECT own profiles row
//   5. SELECT own deal_claims   (wallet)
//   6. SELECT own favorites
//   7. RPC deal_claim_counts    (scarcity UI)
//
// Exit code 0 = all pass. Non-zero = at least one blocked; output names it.
//
// Run:  node scripts/probe-rls-smoke.mjs

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnvFile(file, env) {
  if (!existsSync(file)) return;
  const text = readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "").trim();
  }
}

function loadEnv() {
  const env = {};
  loadEnvFile(path.join(REPO_ROOT, ".env"), env);
  loadEnvFile(path.join(REPO_ROOT, ".env.development.local"), env);
  return env;
}

function redactEmail(email) {
  const [name, domain] = String(email).split("@");
  if (!name || !domain) return "[redacted]";
  return `${name.slice(0, 2)}***@${domain}`;
}

const env = loadEnv();
const URL_BASE = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = env.TWOFER_QA_SHOPPER_EMAIL || env.TWOFER_SMOKE_EMAIL;
const PASSWORD = env.TWOFER_QA_SHOPPER_PASSWORD || env.TWOFER_SMOKE_PASSWORD;

if (!URL_BASE || !ANON) {
  console.error("Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in .env");
  process.exit(2);
}
if (!EMAIL || !PASSWORD) {
  console.error(
    "Missing TWOFER_QA_SHOPPER_EMAIL / TWOFER_QA_SHOPPER_PASSWORD (or legacy TWOFER_SMOKE_*) — need a throwaway shopper account",
  );
  process.exit(2);
}

async function signIn() {
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    console.error(`Sign-in failed (${res.status}):`, body.error_description ?? body.msg ?? body);
    process.exit(2);
  }
  return { token: body.access_token, userId: body.user?.id };
}

async function rest(token, pathAndQuery, init = {}) {
  const res = await fetch(`${URL_BASE}/rest/v1/${pathAndQuery}`, {
    ...init,
    headers: {
      apikey: ANON,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  return { status: res.status, body: text.slice(0, 300) };
}

const { token, userId } = await signIn();
console.log(`Signed in as ${redactEmail(EMAIL)}`);

// Guard this probe's own premise. Every check below only proves SHOPPER-level access.
// A business owner reaches the same rows through owner-scoped policies, so running as
// an owner can report all-pass while the shopper-facing policies lock out every real
// customer — precisely the failure this file exists to catch.
{
  const owner = await rest(token, "rpc/get_my_business", { method: "POST", body: "{}" });
  const ownsBusiness = owner.status < 400 && !["", "null", "[]"].includes(owner.body.trim());
  if (ownsBusiness) {
    console.warn(
      "  WARNING  this account OWNS a business — the results below are NOT a valid\n" +
        "           shopper-level RLS check. Point TWOFER_QA_SHOPPER_EMAIL /\n" +
        "           TWOFER_QA_SHOPPER_PASSWORD at a throwaway shopper account.",
    );
  }
}

const checks = [
  ["deals SELECT", () => rest(token, "deals?select=id&limit=1")],
  ["businesses SELECT", () => rest(token, "businesses?select=id,name&limit=1")],
  ["consumer_profiles own SELECT", () => rest(token, `consumer_profiles?select=user_id&user_id=eq.${userId}`)],
  ["profiles own SELECT", () => rest(token, `profiles?select=id&id=eq.${userId}`)],
  ["deal_claims own SELECT", () => rest(token, `deal_claims?select=id&user_id=eq.${userId}&limit=1`)],
  ["favorites own SELECT", () => rest(token, `favorites?select=business_id&user_id=eq.${userId}&limit=1`)],
  [
    "deal_claim_counts RPC",
    () =>
      rest(token, "rpc/deal_claim_counts", {
        method: "POST",
        body: JSON.stringify({ p_deal_ids: [] }),
      }),
  ],
];

let failed = 0;
for (const [name, run] of checks) {
  const { status, body } = await run();
  // 200/206 = allowed. Empty array is fine — RLS lockouts surface as 401/403,
  // or as 200 with a "permission denied" PostgREST error body (42501).
  const denied = status === 401 || status === 403 || /42501|permission denied/i.test(body);
  if (!denied && status < 400) {
    console.log(`  PASS  ${name}`);
  } else {
    console.error(`  FAIL  ${name} -> HTTP ${status} ${body}`);
    failed++;
  }
}

if (failed > 0) {
  console.error(`\n${failed} check(s) BLOCKED — an RLS policy is locking out authenticated users.`);
  process.exit(1);
}
console.log("\nAll RLS smoke checks passed.");
