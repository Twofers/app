// READ-ONLY: check whether the demo business would pass the deals-insert
// subscription gate added in billing v4 (20260601153000). That policy requires
// a business_profiles row for the owner with subscription_status IN
// ('trial','active'); otherwise every deal INSERT is blocked by RLS.
//
// No writes. Run:  node scripts/probe-subscription.mjs

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
const j = (o) => JSON.stringify(o);

async function signIn() {
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: j({ email: env.EXPO_PUBLIC_DEMO_EMAIL, password: env.EXPO_PUBLIC_DEMO_PASSWORD }),
  });
  const b = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`sign-in ${res.status}`);
  return { token: b.access_token, userId: b.user?.id };
}

async function get(token, pathq) {
  const res = await fetch(`${URL_BASE}/rest/v1/${pathq}`, {
    headers: { apikey: ANON, Authorization: `Bearer ${token}` },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

const { token, userId } = await signIn();
console.log("Signed in as demo user:", userId?.slice(0, 8) + "…");

const biz = await get(token, `businesses?owner_id=eq.${userId}&select=id,name,owner_id`);
console.log("\nbusinesses (owned):", biz.status, j(biz.body));

// business_profiles is gated by user_id OR owner_id — try both.
const bp = await get(
  token,
  `business_profiles?or=(user_id.eq.${userId},owner_id.eq.${userId})&select=*`,
);
console.log("\nbusiness_profiles row(s):", bp.status);
if (Array.isArray(bp.body)) {
  if (bp.body.length === 0) {
    console.log("  (NO ROW) — the insert gate's EXISTS(...) fails → RLS blocks every publish.");
  }
  for (const row of bp.body) {
    console.log("  subscription_status:", row.subscription_status ?? "(null)");
    // print any trial/period-ish columns if present
    for (const k of Object.keys(row)) {
      if (/trial|period|expire|end|status|tier/i.test(k)) {
        console.log(`    ${k}:`, row[k]);
      }
    }
  }
  const ok = bp.body.some((r) => ["trial", "active"].includes(r.subscription_status));
  console.log("\nVERDICT:", ok
    ? "PASS — demo would clear the subscription gate (publish allowed for demo)."
    : "BLOCKED — demo's status is not trial/active → deal INSERT denied by RLS.");
} else {
  console.log("  unexpected:", j(bp.body)?.slice(0, 200));
}
