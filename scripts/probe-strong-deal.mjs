// READ-ONLY acceptance battery for the server strong-deal guard.
// Calls the IMMUTABLE `is_strong_deal_offer(title, desc)` via PostgREST RPC
// (SELECT only — no writes) and compares each verdict to the EXPECTED result.
//
// Ground truth = lib/strong-deal-guard.test.ts (the client mirror) plus the
// divergences confirmed against prod. Run this BEFORE a guard migration to see
// what's broken, and AFTER deploying to confirm parity + that weak deals are
// still rejected (no weakening of the guardrail).
//
// Run:  node scripts/probe-strong-deal.mjs

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
const SMOKE_EMAIL = env.TWOFER_SMOKE_EMAIL;
const SMOKE_PASSWORD = env.TWOFER_SMOKE_PASSWORD;
const j = (o) => JSON.stringify(o);

async function signIn() {
  if (!URL_BASE || !ANON) {
    console.error("Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY in .env");
    process.exit(2);
  }
  if (!SMOKE_EMAIL || !SMOKE_PASSWORD) {
    console.error("Missing TWOFER_SMOKE_EMAIL / TWOFER_SMOKE_PASSWORD in .env (local test account)");
    process.exit(2);
  }
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: j({ email: SMOKE_EMAIL, password: SMOKE_PASSWORD }),
  });
  const b = await res.json().catch(() => ({}));
  return b.access_token;
}

async function serverPass(token, title, desc) {
  const res = await fetch(`${URL_BASE}/rest/v1/rpc/is_strong_deal_offer`, {
    method: "POST",
    headers: { apikey: ANON, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: j({ p_title: title, p_description: desc }),
  });
  const raw = await res.text();
  if (!res.ok) return { exposed: res.status !== 404, status: res.status, raw: raw.slice(0, 160) };
  let val; try { val = JSON.parse(raw); } catch { val = raw; }
  return { exposed: true, value: val === true };
}

// [label, title, description, expectedPass]
const BATTERY = [
  // free item — PASS
  ["BOGO + buy one get one", "BOGO croissants all afternoon", "Buy one get one on any pastry.", true],
  ["free muffin", "Buy a coffee, get a free muffin", "", true],
  ["get one free", "Latte + cookie — get one free", "", true],
  ["free muffin with coffee", "Free muffin with any coffee purchase", "", true],
  ["on the house", "Second latte on the house today", "", true],
  ["complimentary", "Complimentary pastry with your espresso", "", true],
  ["buy one get one free", "Buy one get one free on all pastries", "", true],
  ["free in description", "Coffee and muffin deal", "Buy a coffee, get a muffin free.", true],
  ["2-for-1", "2-for-1 oat milk lattes", "", true],
  // Disqualified SHAPES, not weak percentages. lib/strong-deal-guard.ts has
  // rejected entire-order and second-item discounts since 2026-06-15
  // (ENTIRE_ORDER_DISCOUNT_PATTERNS / SECOND_ITEM_DISCOUNT_PATTERNS); the SQL
  // twin gained the same rules in R13. These two rows still expected PASS from
  // before the client had them, so the battery reported drift that did not
  // exist. This probe calls the guard prose-only, where both halves reject.
  ["40% off entire order shape", "40% off all drinks today", "", false],
  ["50% off second-item shape", "50% off second item", "", false],
  // confirmed divergences — must PASS after the fix
  ["DIVERGENCE free! (punct)", "Treat Yourself", "Order any latte and your second pastry is free!", true],
  ["DIVERGENCE Spanish gratis", "Café Doble", "Compra un latte y llévate otro gratis.", true],
  ["DIVERGENCE Korean 1+1", "데일리 디저트", "라떼 한 잔 사면 쿠키 1+1.", true],
  // weak deals — must REJECT (no weakening)
  ["plain special", "Fresh coffee special", "Great quality and vibes.", false],
  ["35% off", "35% off coffee", "Limited time only", false],
  ["sugar-free only", "Sugar-free latte special", "", false],
  ["dairy-free only", "Dairy-free option available today", "", false],
  ["conditional +40% off", "Buy a coffee + 40% off muffin", "", false],
  ["conditional +50% off", "Buy a latte + 50% off any pastry", "", false],
  ["conditional +60% off", "Buy an espresso + 60% off second drink", "", false],
];

const token = await signIn();
if (!token) { console.log("sign-in failed"); process.exit(1); }

console.log("=".repeat(74));
console.log("is_strong_deal_offer — deploy-acceptance battery (server RPC, read-only)");
console.log("=".repeat(74));

let mismatches = 0;
for (const [label, title, desc, expected] of BATTERY) {
  const s = await serverPass(token, title, desc);
  if (!s.exposed) {
    console.log(`\nRPC not exposed (HTTP ${s.status}). Cannot read server verdict; rely on analysis.`);
    process.exit(2);
  }
  const ok = s.value === expected;
  if (!ok) mismatches++;
  const want = expected ? "PASS" : "REJECT";
  const got = s.value ? "PASS" : "REJECT";
  console.log(`${ok ? "  ok  " : "  XX  "} ${label.padEnd(26)} want ${want.padEnd(6)} got ${got}`);
}

console.log("-".repeat(74));
console.log(mismatches === 0
  ? "ALL GOOD — server matches the client guard (valid deals pass, weak deals rejected)."
  : `${mismatches} MISMATCH(es) — server guard is out of sync with the client. See XX rows.`);
console.log("=".repeat(74));
process.exitCode = mismatches === 0 ? 0 : 1;
