// D2.2a — purge_user_data.
//
// Creates a throwaway user with rows in every table purge_user_data touches,
// calls the RPC, and asserts the function honored its documented contract:
//   HARD DELETE : favorites, push_tokens, consumer_profiles (+ consumer_push_prefs if present)
//   ANONYMIZE   : deal_claims, app_analytics_events  (row kept, user link + PII cleared)
// Then a second user proves the delete-user-account edge function still invokes
// purge (side effects present) and deletes the auth user.
//
// Ground truth: supabase/migrations/20260705120008_purge_user_data_rpc.sql and
// 20260714120000_fix_purge_user_data_columns.sql; edge fn supabase/functions/delete-user-account.
//
// Run: node scripts/db-tests/2a-purge-user-data.mjs   (service_role required)

import { assertTestDb } from "../assert-test-db.mjs";
import { loadTestEnv, makeReporter, rest, fn, signIn,
         adminCreateUser, adminDeleteUser, adminUserExists, uniqueEmail, randomUUID } from "./_shared.mjs";

const ctx = loadTestEnv();
assertTestDb(ctx.url); // GUARD — first action, before any DB call.

const R = makeReporter("2a purge_user_data");
const PW = `Test!${randomUUID().slice(0, 10)}`;
const created = { users: [], businesses: [], deals: [] };

async function seedUserData(userId, businessId, dealId) {
  // Returns ids of the anonymize-target rows so we can re-check them by id.
  await rest(ctx, "service", "consumer_profiles", { method: "POST",
    body: { user_id: userId, zip_code: "94107", age_range: "25_34" } });
  await rest(ctx, "service", "push_tokens", { method: "POST",
    body: { user_id: userId, expo_push_token: `ExponentPushToken[${randomUUID()}]` } });
  await rest(ctx, "service", "favorites", { method: "POST",
    body: { user_id: userId, business_id: businessId } });
  // deal_claims.business_id is denormalized and NOT NULL in the current schema.
  const claim = await rest(ctx, "service", "deal_claims", { method: "POST",
    body: { deal_id: dealId, business_id: businessId, user_id: userId, token: randomUUID(), expires_at: new Date(Date.now() + 864e5).toISOString() } });
  const evt = await rest(ctx, "service", "app_analytics_events", { method: "POST",
    body: { event_name: "dbtest_seed", user_id: userId, business_id: businessId, deal_id: dealId } });
  return { claimId: claim.json?.[0]?.id, eventId: evt.json?.[0]?.id };
}

async function assertPurged(userId, ids, label) {
  const fav = await rest(ctx, "service", `favorites?select=id&user_id=eq.${userId}`);
  R.check(`${label}: favorites hard-deleted`, Array.isArray(fav.json) && fav.json.length === 0,
    { detail: `rows left: ${fav.json?.length}`, onFail: "purge_user_data did not DELETE favorites — app bug in the RPC." });

  const push = await rest(ctx, "service", `push_tokens?select=id&user_id=eq.${userId}`);
  R.check(`${label}: push_tokens hard-deleted`, Array.isArray(push.json) && push.json.length === 0,
    { detail: `rows left: ${push.json?.length}`, onFail: "purge_user_data did not DELETE push_tokens — app bug." });

  const cp = await rest(ctx, "service", `consumer_profiles?select=user_id&user_id=eq.${userId}`);
  R.check(`${label}: consumer_profiles hard-deleted`, Array.isArray(cp.json) && cp.json.length === 0,
    { detail: `rows left: ${cp.json?.length}`, onFail: "purge_user_data did not DELETE consumer_profiles — app bug." });

  // Anonymized (row survives, link removed) — verify by the captured row id.
  if (ids.claimId) {
    const c = await rest(ctx, "service", `deal_claims?select=id,user_id&id=eq.${ids.claimId}`);
    const row = c.json?.[0];
    R.check(`${label}: deal_claims row kept but anonymized`, !!row && row.user_id === null,
      { detail: row ? `user_id=${row.user_id}` : "row missing",
        onFail: "Either the row was deleted (should be anonymized) or user_id survived (PII leak) — app bug." });
  } else {
    R.skip(`${label}: deal_claims anonymized`, "seed row id not captured");
  }
  if (ids.eventId) {
    const e = await rest(ctx, "service", `app_analytics_events?select=id,user_id&id=eq.${ids.eventId}`);
    const row = e.json?.[0];
    R.check(`${label}: app_analytics_events row kept but anonymized`, !!row && row.user_id === null,
      { detail: row ? `user_id=${row.user_id}` : "row missing",
        onFail: "Analytics row deleted or still linked to user — app bug." });
  } else {
    R.skip(`${label}: app_analytics_events anonymized`, "seed row id not captured");
  }
}

async function main() {
  // Shared merchant fixture (owns the business + deal the victim rows reference).
  const merchantId = await adminCreateUser(ctx, { email: uniqueEmail("merchant"), password: PW, role: "business" });
  created.users.push(merchantId);
  const biz = await rest(ctx, "service", "businesses", { method: "POST", body: { owner_id: merchantId, name: "DBTest Cafe" } });
  const businessId = biz.json?.[0]?.id;
  created.businesses.push(businessId);
  // The deals suspension write-guard resolves a location for EVERY insert
  // (block_suspended_location_deal_write -> resolve_deal_credit_location), so the
  // business needs a business_profiles row (billing-v4 FK target, id == businesses.id)
  // plus one location. is_recurring keeps the insert free of deal-credit charges.
  await rest(ctx, "service", "business_profiles", { method: "POST",
    body: { id: businessId, user_id: merchantId, owner_id: merchantId, name: "DBTest Cafe" } });
  await rest(ctx, "service", "business_locations", { method: "POST",
    body: { business_id: businessId, name: "DBTest HQ", address: "1 Test St" } });
  const deal = await rest(ctx, "service", "deals", { method: "POST",
    body: { business_id: businessId, title: "Buy one get one free", description: "BOGO", is_recurring: true, end_time: new Date(Date.now() + 864e5).toISOString() } });
  const dealId = deal.json?.[0]?.id;
  created.deals.push(dealId);
  if (!businessId || !dealId) {
    R.check("fixture: business + deal created", false, { detail: `biz=${businessId} deal=${dealId} (${biz.text} | ${deal.text})` });
    return;
  }
  R.check("fixture: business + deal created", true);

  // ---- Part 1: direct RPC ----
  const victim1 = await adminCreateUser(ctx, { email: uniqueEmail("victim1"), password: PW, role: "customer" });
  created.users.push(victim1);
  const ids1 = await seedUserData(victim1, businessId, dealId);
  const purge = await rest(ctx, "service", "rpc/purge_user_data", { method: "POST", body: { p_user_id: victim1 } });
  R.check("RPC purge_user_data returns success", purge.status < 300,
    { detail: `HTTP ${purge.status} ${purge.text}`, onFail: "The RPC raised (e.g. undefined_column) — app bug in the function body." });
  await assertPurged(victim1, ids1, "direct RPC");

  // ---- Part 2: delete-user-account edge fn invokes purge ----
  const victim2Email = uniqueEmail("victim2");
  const victim2 = await adminCreateUser(ctx, { email: victim2Email, password: PW, role: "customer" });
  created.users.push(victim2);
  const ids2 = await seedUserData(victim2, businessId, dealId);
  const { token } = await signIn(ctx, victim2Email, PW);
  const del = await fn(ctx, "delete-user-account", { token });
  if (del.status === 404 && del.json?.code === "NOT_FOUND") {
    // The function isn't deployed on the test project; nothing about the
    // purge wiring can be verified, so record skips rather than fake failures.
    R.skip("delete-user-account returns 200 ok", "function not deployed on test project — purge wiring unverified");
    R.skip("via delete-user-account: purge side effects", "function not deployed on test project");
    R.skip("delete-user-account deleted the auth user", "function not deployed on test project");
  } else {
    R.check("delete-user-account returns 200 ok", del.status === 200 && del.json?.ok === true,
      { detail: `HTTP ${del.status} ${del.text}`, onFail: "Edge fn failed — cannot confirm it invokes purge." });
    await assertPurged(victim2, ids2, "via delete-user-account");
    const stillThere = await adminUserExists(ctx, victim2);
    R.check("delete-user-account deleted the auth user", stillThere === false,
      { onFail: "auth user survived — deletion path broken (app bug)." });
  }
}

try {
  await main();
} catch (e) {
  R.check("2a ran without throwing", false, { detail: e.message });
} finally {
  // Cleanup (best-effort): anonymized rows keep a NULL user_id and are harmless,
  // but remove the fixture business/deal + throwaway users.
  for (const d of created.deals) if (d) await rest(ctx, "service", `deals?id=eq.${d}`, { method: "DELETE" });
  for (const b of created.businesses) if (b) await rest(ctx, "service", `businesses?id=eq.${b}`, { method: "DELETE" });
  for (const u of created.users) await adminDeleteUser(ctx, u);
}

const { failed } = R.summary();
process.exit(failed ? 1 : 0);
