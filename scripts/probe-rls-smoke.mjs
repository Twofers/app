// Authenticated RLS smoke probe. Run IMMEDIATELY after applying any migration
// that touches RLS policies or policy helper functions.
//
// Why this exists: 20260712120000 shipped a policy helper that returned NULL
// (not false) for normal users, and 21 RESTRICTIVE policies silently locked
// every signed-in user out of every guarded table. SQL-editor checks run as
// postgres and bypass RLS entirely, so only a probe with a REAL user JWT can
// catch that class of bug.
//
// Reads .env for EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY and
// signs in with TWOFER_SMOKE_EMAIL / TWOFER_SMOKE_PASSWORD (a throwaway shopper
// test account — add those two lines to .env; never a real customer account).
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

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const text = readFileSync(path.join(REPO_ROOT, ".env"), "utf8");
  const env = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "").trim();
  }
  return env;
}

const env = loadEnv();
const URL_BASE = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const EMAIL = env.TWOFER_SMOKE_EMAIL;
const PASSWORD = env.TWOFER_SMOKE_PASSWORD;

if (!URL_BASE || !ANON) {
  console.error("Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in .env");
  process.exit(2);
}
if (!EMAIL || !PASSWORD) {
  console.error("Missing TWOFER_SMOKE_EMAIL / TWOFER_SMOKE_PASSWORD in .env (throwaway shopper test account)");
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
console.log(`Signed in as ${EMAIL} (${userId})`);

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
