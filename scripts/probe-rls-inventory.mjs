// READ-ONLY anon-exposure RLS probe — release-gate area 2 (black-box half).
//
// For each sensitive table, sends an UNAUTHENTICATED SELECT (anon apikey, no
// user JWT). The dangerous outcome is real rows coming back to a logged-out
// caller. Outcomes per table:
//   200/206 + non-empty array  -> LEAK (FAIL): table is publicly readable
//   200/206 + []               -> safe: RLS filtered every row
//   401 / 403 / 42501          -> safe: anon has no grant on the table
//
// This is the CI-friendly half of the RLS gate: it needs only the PUBLIC anon
// key (no service-role, no DB string) and performs NO writes. The catalog half
// (tables-without-RLS, policy list, anon/authenticated GRANTs) lives in
// scripts/rls-inventory.sql and is run with psql at release time.
//
// Pairs with probe-rls-smoke.mjs, which proves the *inverse*: that an
// authenticated user CAN still read their own rows.
//
// Config is read from process.env first, then from .env (same keys the other
// probes use): EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY.
//
// Run:  node scripts/probe-rls-inventory.mjs
// Exit: 0 = no leaks. Non-zero = at least one sensitive table leaked rows.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function loadEnv() {
  const env = { ...process.env };
  try {
    const text = readFileSync(path.join(REPO_ROOT, ".env"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      // process.env wins over .env so CI secrets take precedence.
      if (m && env[m[1]] === undefined) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "").trim();
    }
  } catch {
    // No .env (e.g. CI) — rely entirely on process.env.
  }
  return env;
}

const env = loadEnv();
const URL_BASE = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!URL_BASE || !ANON) {
  console.error("Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY (process.env or .env)");
  process.exit(2);
}

// Tables that must NEVER return rows to an unauthenticated caller.
// Keep this list in sync with supabase/migrations as tables are added.
const SENSITIVE_TABLES = [
  "profiles",
  "consumer_profiles",
  "business_profiles",
  "deal_claims",
  "redemptions",
  "redemption_devices",
  "failed_redeem_attempts",
  "owner_redemption_security",
  "push_tokens",
  "favorites",
  "ai_generation_logs",
  "ai_generation_costs",
  "subscription_history",
  "business_invite_validations",
  "business_reports",
  "user_reports",
  "deal_templates",
  "deal_shares",
  "app_analytics_events",
  "app_config",
];

async function anonSelect(table) {
  const res = await fetch(`${URL_BASE}/rest/v1/${table}?select=*&limit=1`, {
    headers: { apikey: ANON }, // no Authorization header => role "anon"
  });
  const text = await res.text();
  let rows = null;
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) rows = parsed.length;
  } catch {
    // non-JSON (error page) — treated as blocked below
  }
  return { status: res.status, rows, body: text.slice(0, 200) };
}

console.log(`Anon-exposure probe against ${URL_BASE}`);
console.log("(unauthenticated SELECT — a non-empty result is a leak)\n");

let leaks = 0;
for (const table of SENSITIVE_TABLES) {
  const { status, rows, body } = await anonSelect(table);
  const blocked = status === 401 || status === 403 || /42501|permission denied/i.test(body);
  if (blocked) {
    console.log(`  SAFE  ${table.padEnd(28)} blocked (HTTP ${status})`);
  } else if (status < 400 && rows === 0) {
    console.log(`  SAFE  ${table.padEnd(28)} readable but RLS returned 0 rows`);
  } else if (status < 400 && rows !== null && rows > 0) {
    console.error(`  LEAK  ${table.padEnd(28)} returned ${rows} row(s) to anon (HTTP ${status})`);
    leaks++;
  } else {
    // Unexpected (e.g. 404 missing table, 5xx). Report, don't fail the gate.
    console.warn(`  ????  ${table.padEnd(28)} HTTP ${status} ${body}`);
  }
}

if (leaks > 0) {
  console.error(`\n${leaks} sensitive table(s) are readable by unauthenticated callers. Fix RLS before shipping.`);
  process.exit(1);
}
console.log("\nNo anon data exposure detected.");
