// Cross-tenant RLS DENIAL probe (the negative-direction complement to
// probe-rls-smoke.mjs).
//
// Why this exists: probe-rls-smoke.mjs only proves the POSITIVE direction — a
// shopper CAN read the rows a shopper should (feed, own profile, own claims).
// It never proves the NEGATIVE direction — that the same shopper CANNOT read
// another tenant's private data. A policy that grants everyone everything would
// pass the smoke probe and leak in production. This probe closes that hole.
//
// It signs in as BOTH a throwaway shopper and a throwaway business OWNER (to
// establish ground-truth ids the shopper must NOT be able to see), then asserts
// every cross-tenant / owner-only / PII read comes back EMPTY or DENIED.
//
// 100% read-only. Creates nothing, deletes nothing. Ground truth is drawn from
// the standing QA owner account; no test rows are written.
//
// Reads .env + .env.development.local for:
//   EXPO_PUBLIC_SUPABASE_URL, EXPO_PUBLIC_SUPABASE_ANON_KEY,
//   TWOFER_QA_SHOPPER_EMAIL / _PASSWORD, TWOFER_QA_OWNER_EMAIL / _PASSWORD
//
// Exit 0 = every denial held. Non-zero = at least one cross-tenant leak.
//
// Run:  node scripts/probe-rls-denial.mjs

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
function loadEnv() {
  const env = {};
  loadEnvFile(path.join(REPO_ROOT, ".env"), env);
  loadEnvFile(path.join(REPO_ROOT, ".env.development.local"), env);
  return env;
}

const env = loadEnv();
const URL_BASE = env.EXPO_PUBLIC_SUPABASE_URL;
const ANON = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;
const SHOPPER_EMAIL = env.TWOFER_QA_SHOPPER_EMAIL || env.TWOFER_SMOKE_EMAIL;
const SHOPPER_PW = env.TWOFER_QA_SHOPPER_PASSWORD || env.TWOFER_SMOKE_PASSWORD;
const OWNER_EMAIL = env.TWOFER_QA_OWNER_EMAIL;
const OWNER_PW = env.TWOFER_QA_OWNER_PASSWORD;

if (!URL_BASE || !ANON) {
  console.error("Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(2);
}
if (!SHOPPER_EMAIL || !SHOPPER_PW) {
  console.error("Missing TWOFER_QA_SHOPPER_EMAIL / _PASSWORD");
  process.exit(2);
}

async function signIn(email, password, { required = true } = {}) {
  const res = await fetch(`${URL_BASE}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    console.error(`Sign-in failed for ${String(email).slice(0, 2)}*** (${res.status})`);
    if (required) process.exit(2);
    return null;
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
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON */ }
  return { status: res.status, body: text.slice(0, 200), json };
}

function isDenied(r) {
  return r.status === 401 || r.status === 403 || /42501|permission denied/i.test(r.body);
}

let failed = 0;
const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  if (!pass) failed++;
}

// ---- Owner ground truth ---------------------------------------------------
let ownerUserId = null;
let ownerBizId = null;
let ownerDraftDealId = null;
const owner = (OWNER_EMAIL && OWNER_PW) ? await signIn(OWNER_EMAIL, OWNER_PW, { required: false }) : null;
if (owner) {
  ownerUserId = owner.userId;
  const biz = await rest(owner.token, "rpc/get_my_business", { method: "POST", body: "{}" });
  if (Array.isArray(biz.json) && biz.json[0]?.id) {
    ownerBizId = biz.json[0].id;
    // Find a non-LIVE (private) deal the owner can see but a shopper must not.
    const drafts = await rest(
      owner.token,
      `deals?select=id,status&business_id=eq.${ownerBizId}&status=neq.LIVE&limit=10`,
    );
    if (Array.isArray(drafts.json)) {
      const draft = drafts.json.find((d) => d.status && d.status !== "LIVE");
      if (draft) ownerDraftDealId = draft.id;
    }
  }
  console.log(
    `Owner ground truth: business=${ownerBizId ? "yes" : "none"}, ` +
      `privateDeal=${ownerDraftDealId ? "yes" : "none"}`,
  );
} else {
  console.log("Owner ground truth: SKIPPED (owner creds missing or stale) — running generic denial checks only.");
}

// ---- Shopper session ------------------------------------------------------
const shopper = await signIn(SHOPPER_EMAIL, SHOPPER_PW);
console.log(`Shopper: ${SHOPPER_EMAIL.slice(0, 2)}***  userId=${shopper.userId?.slice(0, 8)}…`);

// Guard: the shopper must NOT own a business or these checks lose meaning.
{
  const mine = await rest(shopper.token, "rpc/get_my_business", { method: "POST", body: "{}" });
  const owns = mine.status < 400 && Array.isArray(mine.json) && mine.json.length > 0;
  if (owns) {
    console.warn("  WARNING  shopper account OWNS a business — denial results are not valid.");
  }
}

const S = shopper.token;
const SID = shopper.userId;

// ---- A. Own-only tables: an unfiltered read must return ONLY the caller's rows.
for (const [table, col] of [
  ["deal_claims", "user_id"],
  ["favorites", "user_id"],
  ["consumer_profiles", "user_id"],
  ["push_tokens", "user_id"],
]) {
  const r = await rest(S, `${table}?select=${col}&limit=200`);
  if (isDenied(r)) {
    record(`own-only ${table}: no foreign rows`, true, `denied (${r.status})`);
  } else if (Array.isArray(r.json)) {
    const foreign = r.json.filter((row) => row[col] && row[col] !== SID);
    record(`own-only ${table}: no foreign rows`, foreign.length === 0,
      foreign.length === 0 ? `${r.json.length} row(s), all own` : `LEAK: ${foreign.length} foreign row(s)`);
  } else {
    record(`own-only ${table}: no foreign rows`, false, `unexpected HTTP ${r.status} ${r.body}`);
  }
}

// ---- B. Owner-scoped tables: a shopper owns nothing → must be empty or denied.
// business_locations is included deliberately: the DB suite (2c) treats it as a
// PRIVATE owner-only table, and on the TEST project a cross-tenant read of it
// succeeded (HTTP 200, 1 row). That project is behind on migrations, so this
// asserts the production policy directly rather than inferring it.
for (const table of [
  "promo_materials_authorizations",
  "redemption_devices",
  "owner_redemption_security",
  "deal_templates",
  "ai_generation_costs",
  "business_locations",
]) {
  const r = await rest(S, `${table}?select=*&limit=50`);
  const pass = isDenied(r) || (Array.isArray(r.json) && r.json.length === 0);
  record(`owner-only ${table}: empty/denied`, pass,
    pass ? (isDenied(r) ? `denied (${r.status})` : "empty") : `LEAK: ${r.json?.length} row(s)`);
}

// ---- C. businesses PII columns: ungranted to authenticated → must be denied.
for (const col of ["business_email", "contact_name", "owner_id", "tone"]) {
  const r = await rest(S, `businesses?select=${col}&limit=1`);
  // A correct column grant returns 42501. A 200 with a populated value = leak.
  const leaked = r.status === 200 && Array.isArray(r.json) &&
    r.json.some((row) => row[col] !== undefined && row[col] !== null);
  record(`businesses PII ${col}: withheld`, !leaked,
    leaked ? "LEAK: value returned" : (isDenied(r) ? `denied (${r.status})` : `no value (${r.status})`));
}

// ---- D. Cross-tenant ground truth (only if owner data was found).
if (ownerUserId) {
  const r = await rest(S, `deal_claims?select=id&user_id=eq.${ownerUserId}&limit=5`);
  const pass = isDenied(r) || (Array.isArray(r.json) && r.json.length === 0);
  record("cross-tenant owner claims: empty/denied", pass, pass ? "ok" : `LEAK: ${r.json?.length}`);
}
if (ownerBizId) {
  const r = await rest(S, `promo_materials_authorizations?select=id&business_id=eq.${ownerBizId}&limit=5`);
  const pass = isDenied(r) || (Array.isArray(r.json) && r.json.length === 0);
  record("cross-tenant owner promo materials: empty/denied", pass, pass ? "ok" : `LEAK: ${r.json?.length}`);
}
if (ownerDraftDealId) {
  const r = await rest(S, `deals?select=id,status&id=eq.${ownerDraftDealId}`);
  const pass = isDenied(r) || (Array.isArray(r.json) && r.json.length === 0);
  record("cross-tenant owner private deal hidden", pass, pass ? "hidden" : `LEAK: status=${r.json?.[0]?.status}`);
}
// Every deal a shopper can see must satisfy the public-read RLS predicate
// (is_active AND started AND not ended) OR be one they claimed (separate policy).
// A draft (is_active=false), future-scheduled, or expired deal leaking to a
// non-owner is a cross-tenant visibility bug. `deals` has no `status` column —
// visibility is purely the row-level predicate in 20260812130000.
{
  const claimed = await rest(S, "deal_claims?select=deal_id&limit=500");
  const claimedIds = new Set(Array.isArray(claimed.json) ? claimed.json.map((c) => c.deal_id) : []);
  const r = await rest(S, "deals?select=id,is_active,start_time,end_time&limit=500");
  if (!Array.isArray(r.json)) {
    record("shopper sees only live/claimed deals", false, `unexpected HTTP ${r.status} ${r.body}`);
  } else {
    const now = Date.now();
    const bad = r.json.filter((d) => {
      const live = d.is_active === true &&
        new Date(d.start_time).getTime() <= now && new Date(d.end_time).getTime() > now;
      return !live && !claimedIds.has(d.id);
    });
    record("shopper sees only live/claimed deals", bad.length === 0,
      bad.length === 0 ? `${r.json.length} visible, all live/claimed`
        : `LEAK: ${bad.length} non-live unclaimed deal(s)`);
  }
}

// ---- Report ---------------------------------------------------------------
console.log("");
for (const { name, pass, detail } of results) {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}  — ${detail}`);
}
console.log("");
if (failed > 0) {
  console.error(
    `${failed} DENIAL CHECK(S) FAILED — a non-owner read data the policy intends to be owner-only.\n` +
      "Classify before escalating: check WHICH columns leaked. Anything already granted\n" +
      "publicly on `businesses` (name/address/phone/lat/lng) is a policy-intent bug, not a\n" +
      "data breach; owner_id, emails, billing or internal fields would be a genuine P0.",
  );
  process.exit(1);
}
console.log(`All ${results.length} cross-tenant denial checks held.`);
