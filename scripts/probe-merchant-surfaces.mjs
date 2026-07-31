// Merchant-side surface probe (pre-launch QA risk R3).
//
// The consumer half of the app gets constant QA; the merchant half -- onboarding
// context, activation/billing status, analytics, redemption-owner controls,
// promo authorization -- is barely exercised and is half the product. If a
// merchant cannot see their dashboard or run redemption, no deals exist for
// shoppers to claim.
//
// Read-only by default: every call here either reads owner-scoped data or is a
// negative test. Nothing is published, charged, or deleted.
//
// Run: node scripts/probe-merchant-surfaces.mjs

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = {};
for (const f of [".env", ".env.development.local"]) {
  const p = path.join(REPO_ROOT, f);
  if (!existsSync(p)) continue;
  for (const l of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) env[m[1]] = m[2].replace(/^['"]|['"]$/g, "").trim();
  }
}
const U = env.EXPO_PUBLIC_SUPABASE_URL, A = env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

let failed = 0;
const check = (name, pass, detail = "") => {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
  if (!pass) failed++;
};

async function signIn(email, password, label) {
  const r = await fetch(`${U}/auth/v1/token?grant_type=password`, {
    method: "POST", headers: { apikey: A, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const b = await r.json();
  if (!b.access_token) { console.error(`${label} sign-in failed (${r.status})`); process.exit(2); }
  return { token: b.access_token, id: b.user.id };
}
const fn = async (tok, name, body = {}) => {
  const r = await fetch(`${U}/functions/v1/${name}`, {
    method: "POST", headers: { apikey: A, Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, text: t };
};
const rpc = async (tok, name, body = {}) => {
  const r = await fetch(`${U}/rest/v1/rpc/${name}`, {
    method: "POST", headers: { apikey: A, Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, json: j, text: t };
};

const owner = await signIn(env.TWOFER_QA_OWNER_EMAIL, env.TWOFER_QA_OWNER_PASSWORD, "Owner");
const shopper = await signIn(env.TWOFER_QA_SHOPPER_EMAIL, env.TWOFER_QA_SHOPPER_PASSWORD, "Shopper");
const biz = (await rpc(owner.token, "get_my_business")).json?.[0];
if (!biz) { console.error("owner has no business"); process.exit(2); }
console.log(`Merchant: ${biz.name}  (status=${biz.status ?? "?"})\n`);

// ---- Dashboard / onboarding -----------------------------------------------
console.log("Merchant dashboard + onboarding:");
{
  const ctx = await fn(owner.token, "get-business-onboarding-context", { business_id: biz.id });
  check("get-business-onboarding-context loads for the owner", ctx.status === 200, `HTTP ${ctx.status} ${ctx.status !== 200 ? ctx.text.slice(0, 90) : ""}`);

  // Assert on DATA EXPOSURE, not the status code. This endpoint answers "what
  // can I do?" for the CALLER and deliberately ignores a business_id it does not
  // own, so a non-owner correctly gets HTTP 200 carrying an empty context with
  // every capability false. What must never happen is the other tenant's
  // business, locations or terms coming back.
  const asShopper = await fn(shopper.token, "get-business-onboarding-context", { business_id: biz.id });
  const s = asShopper.json ?? {};
  const leaked =
    s.business != null ||
    (Array.isArray(s.locations) && s.locations.length > 0) ||
    (Array.isArray(s.terms_acceptances) && s.terms_acceptances.length > 0) ||
    (Array.isArray(s.contact_channels) && s.contact_channels.length > 0);
  const anyCapability = Object.values(s.access_state ?? {}).some((v) => v === true);
  check("non-owner gets no cross-tenant data and no capabilities",
    asShopper.status >= 400 || (!leaked && !anyCapability),
    `HTTP ${asShopper.status}, business=${s.business == null ? "null" : "PRESENT!"}, anyCapabilityTrue=${anyCapability}`);

  const own = await rpc(owner.token, "get_my_business");
  const full = own.json?.[0] ?? {};
  check("owner reads their OWN business incl. PII via definer RPC",
    own.status === 200 && "owner_id" in full,
    `cols=${Object.keys(full).length}, owner_id present=${"owner_id" in full}`);
}

// ---- Billing / activation surface (no money moves) ------------------------
console.log("\nBilling + activation (read-only, no charges):");
{
  const act = await fn(owner.token, "business-activation-status", { business_id: biz.id });
  check("business-activation-status answers the owner", act.status < 500, `HTTP ${act.status}`);

  const pricing = await fn(owner.token, "billing-pricing", {});
  check("billing-pricing answers the owner", pricing.status < 500, `HTTP ${pricing.status}`);

  // A merchant must never be able to move their own billing state directly.
  const sim = await fn(owner.token, "simulate-subscribe", { business_id: biz.id });
  check("merchant cannot self-activate via simulate-subscribe", [401, 403, 404, 410].includes(sim.status), `HTTP ${sim.status}`);
}

// ---- Analytics -------------------------------------------------------------
console.log("\nMerchant analytics:");
{
  const deals = await fetch(`${U}/rest/v1/deals?select=id&business_id=eq.${biz.id}&limit=1`, {
    headers: { apikey: A, Authorization: `Bearer ${owner.token}` },
  }).then((r) => r.json());
  const dealId = deals?.[0]?.id;
  if (dealId) {
    const ins = await rpc(owner.token, "merchant_deal_insights", { p_deal_id: dealId });
    check("merchant_deal_insights answers the owner", ins.status === 200, `HTTP ${ins.status}`);
    const stolen = await rpc(shopper.token, "merchant_deal_insights", { p_deal_id: dealId });
    check("…and refuses a non-owner", stolen.status >= 400 || stolen.json === null, `HTTP ${stolen.status}`);
  } else {
    check("merchant has a deal to analyse", false, "no deals found");
  }
}

// ---- Redemption-owner controls (read/negative only) -----------------------
console.log("\nRedemption owner controls:");
{
  const sec = await fn(owner.token, "owner-redemption-security", { business_id: biz.id, action: "status" });
  check("owner-redemption-security reachable by owner", sec.status < 500, `HTTP ${sec.status}`);
  const secShopper = await fn(shopper.token, "owner-redemption-security", { business_id: biz.id, action: "status" });
  check("…denied to a non-owner", secShopper.status >= 400, `HTTP ${secShopper.status}`);

  const dev = await fn(owner.token, "manage-redemption-devices", { business_id: biz.id, action: "list" });
  check("manage-redemption-devices reachable by owner", dev.status < 500, `HTTP ${dev.status}`);
  const devShopper = await fn(shopper.token, "manage-redemption-devices", { business_id: biz.id, action: "list" });
  check("…denied to a non-owner", devShopper.status >= 400, `HTTP ${devShopper.status}`);
}

// ---- Promo materials -------------------------------------------------------
console.log("\nPromo materials authorization (K1 regression):");
{
  const r = await fetch(`${U}/rest/v1/promo_materials_authorizations?select=id,business_id&business_id=eq.${biz.id}`, {
    headers: { apikey: A, Authorization: `Bearer ${owner.token}` },
  });
  const j = await r.json().catch(() => null);
  // The K1 fix exists so an OWNER can read their own rows. Zero rows is fine
  // (none authorized yet); a permission error would mean the fix regressed.
  const denied = r.status === 401 || r.status === 403 || /42501|permission denied/i.test(JSON.stringify(j));
  check("owner can read their own promo authorizations (K1 fix holds)", !denied, `HTTP ${r.status}, rows=${Array.isArray(j) ? j.length : "?"}`);
}

console.log("");
if (failed) { console.error(`${failed} MERCHANT SURFACE CHECK(S) FAILED.`); process.exit(1); }
console.log("All merchant-surface checks passed.");
