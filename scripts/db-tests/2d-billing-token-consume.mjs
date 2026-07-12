// D2.2d — atomic billing-token consumption (audit F-006).
//
// consume_billing_token (migration 20260813120000) replaces the read-then-
// update sequence in stripe-create-checkout-session / stripe-customer-portal-
// session. This suite proves, against the REMOTE TEST project:
//   1. race: 10 concurrent consumes of a max_uses=1 token succeed exactly once
//      and leave use_count = 1;
//   2. negative matrix: expired / revoked / exhausted / wrong action / wrong
//      business / unknown hash all return exactly false (never null);
//   3. privilege: anon and authenticated callers cannot execute the RPC
//      (service_role only);
//   4. multi-use: a max_uses=3 token under 10 concurrent calls yields exactly
//      3 successes and use_count = 3.
//
// REQUIRES migration 20260813120000_consume_billing_token_rpc.sql applied to
// the test project. If the RPC is absent every check is reported as SKIP with
// that instruction, so the suite stays actionable rather than false-red.
//
// Run: node scripts/db-tests/2d-billing-token-consume.mjs   (service_role required)

import { assertTestDb } from "../assert-test-db.mjs";
import { loadTestEnv, makeReporter, rest,
         adminCreateUser, adminDeleteUser, signIn, uniqueEmail, randomUUID } from "./_shared.mjs";

const ctx = loadTestEnv();
assertTestDb(ctx.url); // GUARD — first action, before any DB call.

const R = makeReporter("2d billing-token consume");
const PW = `Test!${randomUUID().slice(0, 10)}`;
const cleanup = { rows: [], users: [] };

const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString();
const fakeHash = () => randomUUID().replaceAll("-", "") + randomUUID().replaceAll("-", "");

async function seed(table, body) {
  const r = await rest(ctx, "service", table, { method: "POST", body });
  const row = Array.isArray(r.json) ? r.json[0] : null;
  if (row?.id) cleanup.rows.unshift([table, row.id]);
  if (!row) R.skip(`seed ${table}`, `HTTP ${r.status} ${r.text}`);
  return row;
}

/** Call the RPC. keyKind "service"|"anon"; token = user JWT (with anon key). */
async function consume(keyKind, args, token) {
  return rest(ctx, keyKind, "rpc/consume_billing_token", {
    method: "POST",
    body: args,
    token,
    prefer: "return=representation",
  });
}

async function tokenRow(id) {
  const r = await rest(ctx, "service", `billing_tokens?select=use_count,max_uses&id=eq.${id}`);
  return r.json?.[0] ?? null;
}

async function main() {
  const ownerId = await adminCreateUser(ctx, { email: uniqueEmail("btok-owner"), password: PW, role: "business" });
  cleanup.users.push(ownerId);
  const biz = await seed("businesses", { owner_id: ownerId, name: "Token Test Cafe" });
  if (!biz) { R.check("fixture: business seeded", false); return; }

  // Probe once for the RPC itself so an unapplied migration reads as SKIP, not FAIL.
  const probe = await consume("service", {
    p_business_id: biz.id, p_token_hash: fakeHash(), p_action: "subscription_checkout",
  });
  if (probe.status === 404 || /PGRST202|Could not find the function/i.test(probe.text)) {
    R.skip("ALL checks", "consume_billing_token missing — apply migration 20260813120000 to the TEST project first");
    return;
  }
  R.check("RPC exists and returns concrete false for unknown hash", probe.json === false,
    { detail: `HTTP ${probe.status}, body=${probe.text}`,
      onFail: "RPC must return exactly false (never null) when nothing matches — check GET DIAGNOSTICS body." });

  // --- 1. race: max_uses=1, 10 concurrent consumers, exactly one winner ---
  const hash1 = fakeHash();
  const tok1 = await seed("billing_tokens", {
    business_id: biz.id, token_hash: hash1, action: "subscription_checkout",
    max_uses: 1, expires_at: inMinutes(30),
  });
  if (tok1) {
    const args = { p_business_id: biz.id, p_token_hash: hash1, p_action: "subscription_checkout" };
    const results = await Promise.all(Array.from({ length: 10 }, () => consume("service", args)));
    const wins = results.filter((r) => r.json === true).length;
    const losses = results.filter((r) => r.json === false).length;
    R.check("race: exactly one of 10 concurrent consumes wins (max_uses=1)", wins === 1 && losses === 9,
      { detail: `wins=${wins}, losses=${losses}`,
        onFail: "More than one winner = the F-006 race still exists (app bug); zero winners = setup/test bug." });
    const after1 = await tokenRow(tok1.id);
    R.check("race: use_count settled at exactly 1", after1?.use_count === 1,
      { detail: `use_count=${after1?.use_count}` });
  }

  // --- 2. negative matrix: each case must return exactly false ---
  const negatives = [];
  const mkTok = (label, body) => seed("billing_tokens", body).then((row) => negatives.push([label, row, body]));
  await mkTok("expired", { business_id: biz.id, token_hash: fakeHash(), action: "subscription_checkout", max_uses: 1, expires_at: inMinutes(-5) });
  await mkTok("revoked", { business_id: biz.id, token_hash: fakeHash(), action: "subscription_checkout", max_uses: 1, expires_at: inMinutes(30), revoked_at: new Date().toISOString() });
  await mkTok("exhausted", { business_id: biz.id, token_hash: fakeHash(), action: "subscription_checkout", max_uses: 1, use_count: 1, expires_at: inMinutes(30) });
  for (const [label, row, body] of negatives) {
    if (!row) continue;
    const r = await consume("service", { p_business_id: biz.id, p_token_hash: body.token_hash, p_action: "subscription_checkout" });
    R.check(`negative: ${label} token returns exactly false`, r.json === false,
      { detail: `body=${r.text}`, onFail: "A consumable invalid token breaks the billing-link invariant (app bug)." });
  }

  const hashLive = fakeHash();
  const tokLive = await seed("billing_tokens", {
    business_id: biz.id, token_hash: hashLive, action: "subscription_checkout", max_uses: 1, expires_at: inMinutes(30),
  });
  if (tokLive) {
    const wrongAction = await consume("service", { p_business_id: biz.id, p_token_hash: hashLive, p_action: "customer_portal" });
    R.check("negative: wrong action returns exactly false", wrongAction.json === false, { detail: `body=${wrongAction.text}` });
    const bogusAction = await consume("service", { p_business_id: biz.id, p_token_hash: hashLive, p_action: "not_a_real_action" });
    R.check("negative: unknown action returns exactly false (guard clause)", bogusAction.json === false, { detail: `body=${bogusAction.text}` });
    const wrongBiz = await consume("service", { p_business_id: randomUUID(), p_token_hash: hashLive, p_action: "subscription_checkout" });
    R.check("negative: wrong business_id returns exactly false", wrongBiz.json === false, { detail: `body=${wrongBiz.text}` });
    const still = await tokenRow(tokLive.id);
    R.check("negative: failed attempts did not consume a use", still?.use_count === 0, { detail: `use_count=${still?.use_count}` });
  }

  // --- 3. privilege: anon + authenticated are denied ---
  const privArgs = { p_business_id: biz.id, p_token_hash: fakeHash(), p_action: "subscription_checkout" };
  const anonCall = await consume("anon", privArgs);
  R.check("privilege: anon cannot execute consume_billing_token", !anonCall.ok,
    { detail: `HTTP ${anonCall.status} ${anonCall.text}`,
      onFail: "Anon EXECUTE grant leaked — REVOKE FROM anon missing in the migration (app bug)." });
  const userEmail = uniqueEmail("btok-user");
  const userId = await adminCreateUser(ctx, { email: userEmail, password: PW, role: "customer" });
  cleanup.users.push(userId);
  const { token: userJwt } = await signIn(ctx, userEmail, PW);
  const authedCall = await consume("anon", privArgs, userJwt);
  R.check("privilege: authenticated user cannot execute consume_billing_token", !authedCall.ok,
    { detail: `HTTP ${authedCall.status} ${authedCall.text}`,
      onFail: "Authenticated EXECUTE grant leaked — REVOKE FROM authenticated missing (app bug)." });

  // --- 4. multi-use: max_uses=3 under 10 concurrent calls -> exactly 3 wins ---
  const hash3 = fakeHash();
  const tok3 = await seed("billing_tokens", {
    business_id: biz.id, token_hash: hash3, action: "customer_portal", max_uses: 3, expires_at: inMinutes(30),
  });
  if (tok3) {
    const args = { p_business_id: biz.id, p_token_hash: hash3, p_action: "customer_portal" };
    const results = await Promise.all(Array.from({ length: 10 }, () => consume("service", args)));
    const wins = results.filter((r) => r.json === true).length;
    R.check("multi-use: exactly 3 of 10 concurrent consumes win (max_uses=3)", wins === 3,
      { detail: `wins=${wins}` });
    const after3 = await tokenRow(tok3.id);
    R.check("multi-use: use_count settled at exactly 3", after3?.use_count === 3,
      { detail: `use_count=${after3?.use_count}` });
  }
}

main()
  .catch((err) => {
    console.error("Unexpected error:", err);
    R.check("suite ran to completion", false, { detail: String(err) });
  })
  .finally(async () => {
    for (const [table, id] of cleanup.rows) {
      await rest(ctx, "service", `${table}?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" }).catch(() => {});
    }
    for (const u of cleanup.users) await adminDeleteUser(ctx, u);
    const { failed } = R.summary();
    process.exit(failed ? 1 : 0);
  });
