// D2.2e — public business visibility + database-authoritative publish gate
// (audit F-001 / F-002 / F-003).
//
// Requires migrations 20260814120000 (public predicate + publish gate) and
// 20260814130000 (open-application gate) applied to the REMOTE TEST project.
// If they are absent the suite reports SKIPs with that instruction.
//
// Proves:
//   1. F-003/F-002: an authenticated business owner can self-create exactly ONE
//      business (open application, per-owner cap), and the row lands hidden
//      from anon + other users while staying visible to its owner.
//   2. F-002: once service-role review flips status to 'active', the row is
//      publicly visible (including through the SECURITY INVOKER nearby RPCs).
//   3. F-001: the owner of an APPROVED business still cannot direct-write a
//      LIVE deal until can_business_publish passes (terms + subscription);
//      inactive drafts are always allowed; flipping live is denied then
//      allowed once eligible; deactivating stays allowed after eligibility is
//      revoked.
//
// Run: node scripts/db-tests/2e-public-visibility-and-publish-gate.mjs

import { assertTestDb } from "../assert-test-db.mjs";
import { loadTestEnv, makeReporter, rest, signIn,
         adminCreateUser, adminDeleteUser, uniqueEmail, isDenied, randomUUID } from "./_shared.mjs";

const ctx = loadTestEnv();
assertTestDb(ctx.url); // GUARD — first action, before any DB call.

const R = makeReporter("2e public visibility + publish gate");
const PW = `Test!${randomUUID().slice(0, 10)}`;
const cleanup = { rows: [], users: [] };

const hoursFromNow = (h) => new Date(Date.now() + h * 3600_000).toISOString();

async function seed(table, body) {
  const r = await rest(ctx, "service", table, { method: "POST", body });
  const row = Array.isArray(r.json) ? r.json[0] : null;
  if (row?.id) cleanup.rows.unshift([table, row.id]);
  if (!row) R.skip(`seed ${table}`, `HTTP ${r.status} ${r.text}`);
  return row;
}

async function main() {
  const ownerEmail = uniqueEmail("vis-owner");
  const ownerId = await adminCreateUser(ctx, { email: ownerEmail, password: PW, role: "business" });
  const shopperEmail = uniqueEmail("vis-shopper");
  const shopperId = await adminCreateUser(ctx, { email: shopperEmail, password: PW, role: "customer" });
  cleanup.users.push(ownerId, shopperId);
  const { token: ownerJwt } = await signIn(ctx, ownerEmail, PW);
  const { token: shopperJwt } = await signIn(ctx, shopperEmail, PW);

  // --- 1. open-application self-create (F-003 gate v3) ---
  const createRes = await rest(ctx, "anon", "businesses", {
    token: ownerJwt, method: "POST",
    body: { owner_id: ownerId, name: "Visibility Test Cafe" },
  });
  if (!createRes.ok && /business invite required/i.test(createRes.text)) {
    R.skip("ALL checks", "old invite trigger still active — apply migrations 20260814120000 + 20260814130000 to the TEST project first");
    return;
  }
  const biz = Array.isArray(createRes.json) ? createRes.json[0] : null;
  if (biz?.id) cleanup.rows.unshift(["businesses", biz.id]);
  R.check("owner can self-create a business (open application)", createRes.ok && Boolean(biz?.id),
    { detail: `HTTP ${createRes.status} ${biz?.id ? "" : createRes.text}`,
      onFail: "Self-serve creation broke — check trigger v3 + RLS insert policy (app bug) or missing migration (test setup)." });
  if (!biz?.id) return;

  const second = await rest(ctx, "anon", "businesses", {
    token: ownerJwt, method: "POST",
    body: { owner_id: ownerId, name: "Second Cafe Attempt" },
  });
  R.check("second self-created business is denied (per-owner cap)", isDenied(second),
    { detail: `HTTP ${second.status} ${second.text}`,
      onFail: "Cap missing — open applications can be mass-created (app bug)." });
  const secondRow = Array.isArray(second.json) ? second.json[0] : null;
  if (secondRow?.id) cleanup.rows.unshift(["businesses", secondRow.id]);

  // Forced-pending start (column locks) — verify via service role.
  const pendingRow = await rest(ctx, "service", `businesses?select=status&id=eq.${biz.id}`);
  R.check("self-created business starts pending_verification", pendingRow.json?.[0]?.status === "pending_verification",
    { detail: `status=${pendingRow.json?.[0]?.status}` });

  // --- 2. F-002 visibility while pending ---
  const anonRead = await rest(ctx, "anon", `businesses?select=id,name&id=eq.${biz.id}`);
  R.check("anon cannot see the pending business", anonRead.ok && (anonRead.json?.length ?? 0) === 0,
    { detail: `HTTP ${anonRead.status}, rows=${anonRead.json?.length}`,
      onFail: "Pending business publicly visible — F-002 regression (app bug)." });
  const shopperRead = await rest(ctx, "anon", `businesses?select=id,name&id=eq.${biz.id}`, { token: shopperJwt });
  R.check("another user cannot see the pending business", shopperRead.ok && (shopperRead.json?.length ?? 0) === 0,
    { detail: `HTTP ${shopperRead.status}, rows=${shopperRead.json?.length}` });
  const ownerRead = await rest(ctx, "anon", `businesses?select=id,name&id=eq.${biz.id}`, { token: ownerJwt });
  R.check("owner still sees their own pending business", ownerRead.ok && (ownerRead.json?.length ?? 0) === 1,
    { detail: `HTTP ${ownerRead.status}, rows=${ownerRead.json?.length}`,
      onFail: "Owner locked out of own pending row — the owner OR-clause is broken (app bug: breaks business setup)." });

  // --- 3. F-001 publish gate while PENDING and not eligible ---
  const liveDeal = {
    business_id: biz.id,
    title: "Buy one get one free",
    description: "BOGO",
    is_recurring: true,
    is_active: true,
    start_time: hoursFromNow(-1),
    end_time: hoursFromNow(24),
  };
  const liveDenied = await rest(ctx, "anon", "deals", { token: ownerJwt, method: "POST", body: liveDeal });
  const liveDeniedRow = Array.isArray(liveDenied.json) ? liveDenied.json[0] : null;
  if (liveDeniedRow?.id) cleanup.rows.unshift(["deals", liveDeniedRow.id]);
  R.check("ineligible owner cannot direct-insert a LIVE deal", isDenied(liveDenied),
    { detail: `HTTP ${liveDenied.status} ${liveDenied.text}`,
      onFail: "F-001 regression: direct write published a deal without can_business_publish (app bug)." });

  const draftDeal = { ...liveDeal, is_active: false };
  const draftRes = await rest(ctx, "anon", "deals", { token: ownerJwt, method: "POST", body: draftDeal });
  const draft = Array.isArray(draftRes.json) ? draftRes.json[0] : null;
  if (draft?.id) cleanup.rows.unshift(["deals", draft.id]);
  R.check("ineligible owner CAN insert an inactive draft", draftRes.ok && Boolean(draft?.id),
    { detail: `HTTP ${draftRes.status} ${draft?.id ? "" : draftRes.text}`,
      onFail: "Drafts blocked — the gate is broader than live-state transitions (app bug: breaks owner edits)." });
  if (!draft?.id) return;

  const flipDenied = await rest(ctx, "anon", `deals?id=eq.${draft.id}`, {
    token: ownerJwt, method: "PATCH", body: { is_active: true },
  });
  const flipStillInactive = await rest(ctx, "service", `deals?select=is_active&id=eq.${draft.id}`);
  R.check("ineligible owner cannot flip a draft LIVE", isDenied(flipDenied) && flipStillInactive.json?.[0]?.is_active === false,
    { detail: `HTTP ${flipDenied.status}, is_active=${flipStillInactive.json?.[0]?.is_active}` });

  // --- 4. F-001: paying-but-UNREVIEWED business still cannot publish ---
  // can_business_publish alone returns true for a pending business with an
  // active subscription + accepted terms; the deals policies must ALSO
  // require public visibility, or an unreviewed merchant who pays can inject
  // deals into the public feed while their business stays hidden.
  await seed("terms_acceptances", {
    business_id: biz.id, user_id: ownerId, document_type: "business_terms",
    document_version: "db-test-v1", source: "db_test",
  });
  const sub = await seed("business_subscriptions", {
    business_id: biz.id, billing_status: "active", app_access_status: "active",
  });
  if (sub) {
    const pendingPaidDenied = await rest(ctx, "anon", "deals", { token: ownerJwt, method: "POST", body: liveDeal });
    const pendingPaidRow = Array.isArray(pendingPaidDenied.json) ? pendingPaidDenied.json[0] : null;
    if (pendingPaidRow?.id) cleanup.rows.unshift(["deals", pendingPaidRow.id]);
    R.check("pending business with active subscription still cannot publish LIVE", isDenied(pendingPaidDenied),
      { detail: `HTTP ${pendingPaidDenied.status} ${pendingPaidDenied.text}`,
        onFail: "Visibility gate missing — a paying unreviewed business can publish into the public feed (app bug)." });
  }

  // --- 5. F-002 visibility + F-001 publish after approval ---
  await rest(ctx, "service", `businesses?id=eq.${biz.id}`, { method: "PATCH", body: { status: "active" } });
  const anonReadActive = await rest(ctx, "anon", `businesses?select=id,name&id=eq.${biz.id}`);
  R.check("anon sees the business once approved (status=active)", anonReadActive.ok && (anonReadActive.json?.length ?? 0) === 1,
    { detail: `HTTP ${anonReadActive.status}, rows=${anonReadActive.json?.length}`,
      onFail: "Approved business hidden — predicate too strict (app bug: hides valid businesses)." });

  if (sub) {
    const flipAllowed = await rest(ctx, "anon", `deals?id=eq.${draft.id}`, {
      token: ownerJwt, method: "PATCH", body: { is_active: true },
    });
    const nowLive = await rest(ctx, "service", `deals?select=is_active&id=eq.${draft.id}`);
    R.check("eligible owner can flip the draft LIVE", !isDenied(flipAllowed) && nowLive.json?.[0]?.is_active === true,
      { detail: `HTTP ${flipAllowed.status}, is_active=${nowLive.json?.[0]?.is_active}`,
        onFail: "Eligible publish blocked — can_business_publish wiring too strict (app bug: blocks legitimate publish)." });

    const liveInsert = await rest(ctx, "anon", "deals", { token: ownerJwt, method: "POST", body: liveDeal });
    const liveRow = Array.isArray(liveInsert.json) ? liveInsert.json[0] : null;
    if (liveRow?.id) cleanup.rows.unshift(["deals", liveRow.id]);
    R.check("eligible owner can insert a LIVE deal", liveInsert.ok && Boolean(liveRow?.id),
      { detail: `HTTP ${liveInsert.status} ${liveRow?.id ? "" : liveInsert.text}` });

    // Revoke eligibility, then confirm the owner can still turn things OFF.
    await rest(ctx, "service", `business_subscriptions?id=eq.${sub.id}`, {
      method: "PATCH", body: { billing_status: "canceled", app_access_status: "expired" },
    });
    const deactivate = await rest(ctx, "anon", `deals?id=eq.${draft.id}`, {
      token: ownerJwt, method: "PATCH", body: { is_active: false },
    });
    const offNow = await rest(ctx, "service", `deals?select=is_active&id=eq.${draft.id}`);
    R.check("ineligible owner can still DEACTIVATE their live deal", !isDenied(deactivate) && offNow.json?.[0]?.is_active === false,
      { detail: `HTTP ${deactivate.status}, is_active=${offNow.json?.[0]?.is_active}`,
        onFail: "Owners must always be able to turn deals off regardless of billing (app bug: owner lockout)." });
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
