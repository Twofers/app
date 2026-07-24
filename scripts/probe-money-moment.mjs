// End-to-end "money moment" smoke test: publish -> discover -> claim -> redeem.
//
// This is the one loop the whole product depends on. Everything else can be
// broken and the business still limps; if this breaks, Twofer does nothing.
//
// UNLIKE every other probe in this directory, this one WRITES TO PRODUCTION:
// it publishes a live deal for the QA business, claims it as the QA shopper,
// redeems it as the owner, then deactivates the deal. It refuses to run without
// an explicit flag so it can never fire by accident (e.g. from a CI glob).
//
//   node scripts/probe-money-moment.mjs --write-to-prod
//
// Requires in .env.development.local:
//   TWOFER_QA_OWNER_EMAIL / _PASSWORD    (business owner)
//   TWOFER_QA_SHOPPER_EMAIL / _PASSWORD  (consumer)
//
// Secrets policy: claim tokens and short codes are NEVER printed — only their
// length/presence is reported.

import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

if (!process.argv.includes("--write-to-prod")) {
  console.error(
    "\nREFUSING TO RUN: this probe publishes and claims a real deal in production.\n" +
      "Re-run with --write-to-prod if that is what you intend.\n",
  );
  process.exit(2);
}

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
const step = (name, pass, detail = "") => {
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
const rest = async (tok, q, init = {}) => {
  const r = await fetch(`${U}/rest/v1/${q}`, {
    ...init,
    headers: { apikey: A, Authorization: `Bearer ${tok}`, "Content-Type": "application/json", Prefer: "return=representation", ...(init.headers ?? {}) },
  });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch {}
  return { status: r.status, json: j, text: txt };
};
const fn = async (tok, name, body) => {
  const r = await fetch(`${U}/functions/v1/${name}`, {
    method: "POST", headers: { apikey: A, Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  let j = null; try { j = JSON.parse(txt); } catch {}
  return { status: r.status, json: j, text: txt };
};

const owner = await signIn(env.TWOFER_QA_OWNER_EMAIL, env.TWOFER_QA_OWNER_PASSWORD, "Owner");
const shopper = await signIn(env.TWOFER_QA_SHOPPER_EMAIL, env.TWOFER_QA_SHOPPER_PASSWORD, "Shopper");
const bizRes = await fetch(`${U}/rest/v1/rpc/get_my_business`, {
  method: "POST", headers: { apikey: A, Authorization: `Bearer ${owner.token}`, "Content-Type": "application/json" }, body: "{}",
}).then((r) => r.json());
const biz = bizRes[0];
console.log(`Business: ${biz.name}   shopper=${shopper.id.slice(0, 8)}…\n`);

let dealId = null;
try {
  // ---- 1. Publish a live deal -------------------------------------------
  const now = Date.now();
  const ins = await rest(owner.token, "deals", {
    method: "POST",
    body: JSON.stringify({
      business_id: biz.id,
      title: "[QA] Buy one drip coffee and get one free",
      description: "Automated pre-launch QA deal. Buy one drip coffee and get one free.",
      title_en: "[QA] Buy one drip coffee and get one free",
      description_en: "Automated pre-launch QA deal. Buy one drip coffee and get one free.",
      source_locale: "en",
      start_time: new Date(now - 60_000).toISOString(),
      end_time: new Date(now + 2 * 3600_000).toISOString(),
      max_claims: 5,
      is_active: true,
      deal_status: "LIVE",
      eligibility_status: "VALID",
      customer_value_percent: 50,
      deal_type: "BUY_ONE_GET_ONE_FREE",
      applies_to: "SINGLE_ITEM",
      required_purchase_quantity: 1,
      free_item_quantity: 1,
      required_item_description: "drip coffee",
      free_item_description: "drip coffee",
      item_description: "drip coffee",
      claim_cutoff_buffer_minutes: 15,
      is_demo: false,
    }),
  });
  dealId = Array.isArray(ins.json) ? ins.json[0]?.id : null;
  step("owner publishes a live deal", Boolean(dealId), dealId ? `deal=${dealId.slice(0, 8)}…` : `HTTP ${ins.status} ${ins.text.slice(0, 120)}`);
  if (!dealId) throw new Error("publish failed");

  // ---- 2. Shopper discovers it -------------------------------------------
  const feed = await rest(shopper.token, `deals?select=id,title&id=eq.${dealId}`);
  step("shopper sees it via public RLS", Array.isArray(feed.json) && feed.json.length === 1, `${Array.isArray(feed.json) ? feed.json.length : feed.status} row(s)`);

  // ---- 3. Shopper claims --------------------------------------------------
  const claim = await fn(shopper.token, "claim-deal", { deal_id: dealId });
  const token = claim.json?.token, shortCode = claim.json?.short_code, claimId = claim.json?.claim_id;
  step("shopper claims the deal", claim.status === 200 && Boolean(token && claimId),
    `HTTP ${claim.status}, token=${token ? `<${String(token).length} chars>` : "none"}, short_code=${shortCode ? "<redacted>" : "none"}`);
  if (!token) throw new Error("claim failed: " + claim.text.slice(0, 160));

  // ---- 4. Double-claim guard (3.4) ---------------------------------------
  // claim-deal is deliberately IDEMPOTENT: a second call returns the SAME claim
  // with HTTP 200 ("You already have an active claim for this deal") rather than
  // erroring. What must never happen is a second claim row -- that would let one
  // shopper burn through max_claims and cost the merchant real product.
  const dupe = await fn(shopper.token, "claim-deal", { deal_id: dealId });
  const sameClaim = dupe.json?.claim_id === claimId;
  const rows = await rest(shopper.token, `deal_claims?select=id&deal_id=eq.${dealId}&user_id=eq.${shopper.id}`);
  const count = Array.isArray(rows.json) ? rows.json.length : -1;
  step("double-claim creates no second claim", (dupe.status >= 400 || sameClaim) && count === 1,
    `HTTP ${dupe.status}, sameClaimId=${sameClaim}, claim rows=${count}`);

  // ---- 5. Claim is active in the wallet ----------------------------------
  const w = await rest(shopper.token, `deal_claims?select=id,claim_status,redeemed_at&id=eq.${claimId}`);
  step("claim shows active in wallet", w.json?.[0]?.claim_status === "active" && !w.json?.[0]?.redeemed_at, `status=${w.json?.[0]?.claim_status}`);

  // ---- 6. A DIFFERENT user cannot redeem it ------------------------------
  const stolen = await fn(shopper.token, "redeem-token", { token });
  step("non-owner cannot redeem", stolen.status >= 400, `HTTP ${stolen.status} ${String(stolen.json?.error ?? "").slice(0, 60)}`);

  // ---- 7. Owner redeems (the money moment) -------------------------------
  const red = await fn(owner.token, "redeem-token", { token });
  step("OWNER REDEEMS THE QR", red.status === 200, `HTTP ${red.status} ${red.status !== 200 ? red.text.slice(0, 140) : ""}`);

  // ---- 8. State is consistent afterwards ---------------------------------
  const after = await rest(shopper.token, `deal_claims?select=claim_status,redeemed_at&id=eq.${claimId}`);
  const row = after.json?.[0];
  step("claim is now redeemed", row?.claim_status === "redeemed" && Boolean(row?.redeemed_at), `status=${row?.claim_status}, redeemed_at=${row?.redeemed_at ? "set" : "null"}`);

  // ---- 9. Replay protection ----------------------------------------------
  const replay = await fn(owner.token, "redeem-token", { token });
  step("same token cannot be redeemed twice", replay.status >= 400, `HTTP ${replay.status} ${String(replay.json?.error ?? "").slice(0, 60)}`);
} catch (e) {
  console.error("\n  ABORTED:", String(e).slice(0, 200));
  failed++;
} finally {
  // ---- Cleanup: always retire the QA deal --------------------------------
  if (dealId) {
    const c = await rest(owner.token, `deals?id=eq.${dealId}`, {
      method: "PATCH",
      body: JSON.stringify({ is_active: false, deal_status: "ENDED", end_time: new Date(Date.now() - 1000).toISOString() }),
    });
    console.log(`\n  CLEANUP  deal ${dealId.slice(0, 8)}… retired (is_active=false, ENDED) -> HTTP ${c.status}`);
    const check = await rest(shopper.token, `deals?select=id&id=eq.${dealId}`);
    console.log(`  CLEANUP  shopper visibility after retire: ${Array.isArray(check.json) ? check.json.length : "?"} row(s) (expect 1 — they claimed it — or 0)`);
  }
}

console.log("");
if (failed) { console.error(`${failed} MONEY-MOMENT STEP(S) FAILED.`); process.exit(1); }
console.log("MONEY MOMENT OK: publish -> discover -> claim -> redeem, with guards holding.");
