// D2.2h — promotional-materials authorization: RLS, grant/revoke, isolation.
//
// Covers migration 20260819130000_promo_materials_authorizations.sql and the
// set-promo-materials-authorization edge function
// (plan: docs/plans/promo-materials-authorization-plan.md).
//
// The properties that matter:
//   - consent is opt-in: a business with no rows reads as NOT authorized
//   - one tenant can never read or write another tenant's consent
//   - clients cannot INSERT/UPDATE/DELETE directly; only the edge fn writes
//   - revoke flips the status but PRESERVES the row (history is never lost)
//   - the publish gate returns the same answer with and without authorization
//
// PRE-APPLY this suite is EXPECTED TO FAIL (the table does not exist yet).
//
// Run: node scripts/db-tests/2h-promo-materials-authorization.mjs   (service_role required)

import { assertTestDb } from "../assert-test-db.mjs";
import { loadTestEnv, makeReporter, rest, fn, signIn,
         adminCreateUser, adminDeleteUser, uniqueEmail, isDenied, randomUUID } from "./_shared.mjs";

const ctx = loadTestEnv();
assertTestDb(ctx.url); // GUARD — first action, before any DB call.

const R = makeReporter("2h promo materials authorization");
const PW = `Test!${randomUUID().slice(0, 10)}`;
const cleanup = { rows: [], users: [] };

async function seed(table, body) {
  const r = await rest(ctx, "service", table, { method: "POST", body });
  const row = Array.isArray(r.json) ? r.json[0] : null;
  if (row?.id) cleanup.rows.unshift([table, row.id]);
  if (!row) R.skip(`seed ${table}`, `HTTP ${r.status} ${r.text}`);
  return row;
}

/** Rows visible to `token` for a business. */
function readAuthorizations(token, businessId) {
  return rest(
    ctx,
    "anon",
    `promo_materials_authorizations?select=id,location_id,revoked_at,source&business_id=eq.${businessId}`,
    { token },
  );
}

/** Active (un-revoked) rows for a location, read with service role. */
async function activeCount(locationId) {
  const r = await rest(
    ctx,
    "service",
    `promo_materials_authorizations?select=id&location_id=eq.${locationId}&revoked_at=is.null`,
  );
  return r.json?.length ?? 0;
}

/** All rows for a location regardless of revocation, read with service role. */
async function totalCount(locationId) {
  const r = await rest(ctx, "service", `promo_materials_authorizations?select=id&location_id=eq.${locationId}`);
  return r.json?.length ?? 0;
}

async function main() {
  // --- table presence -------------------------------------------------------
  const probe = await rest(ctx, "service", "promo_materials_authorizations?select=id&limit=1");
  if (probe.status === 404 || /does not exist|PGRST205/i.test(probe.text)) {
    R.check("promo_materials_authorizations table exists", false, {
      detail: `HTTP ${probe.status} ${probe.text}`,
      onFail: "Migration 20260819130000 has not been applied yet. Expected to fail PRE-apply.",
    });
    return;
  }
  R.check("promo_materials_authorizations table exists", true);

  // --- fixtures -------------------------------------------------------------
  const ownerEmail = uniqueEmail("promo-owner");
  const otherEmail = uniqueEmail("promo-other");
  const ownerId = await adminCreateUser(ctx, { email: ownerEmail, password: PW, role: "business" });
  const otherId = await adminCreateUser(ctx, { email: otherEmail, password: PW, role: "business" });
  cleanup.users.push(ownerId, otherId);

  const bizOwner = await seed("businesses", { owner_id: ownerId, name: "Promo Owner Cafe", status: "active" });
  const bizOther = await seed("businesses", { owner_id: otherId, name: "Promo Other Cafe", status: "active" });
  if (!bizOwner || !bizOther) { R.check("fixture: both businesses seeded", false); return; }
  R.check("fixture: both businesses seeded", true);

  const locOwner = await seed("business_locations", {
    business_id: bizOwner.id, name: "Promo Owner HQ", address: "1 Promo St",
  });
  const locOther = await seed("business_locations", {
    business_id: bizOther.id, name: "Promo Other HQ", address: "2 Promo St",
  });
  if (!locOwner || !locOther) { R.check("fixture: both locations seeded", false); return; }
  R.check("fixture: both locations seeded", true);

  const owner = await signIn(ctx, ownerEmail, PW);
  const other = await signIn(ctx, otherEmail, PW);

  // --- case 8: default is NOT authorized ------------------------------------
  const initial = await readAuthorizations(owner.token, bizOwner.id);
  R.check("a business with no consent rows reads as NOT authorized",
    initial.ok && (initial.json?.length ?? 0) === 0,
    { detail: `HTTP ${initial.status} rows=${initial.json?.length}`,
      onFail: "A backfill or default is creating consent rows — opt-in consent must start empty (app bug)." });

  // --- direct client writes must be denied ----------------------------------
  const directInsert = await rest(ctx, "anon", "promo_materials_authorizations", {
    token: owner.token,
    method: "POST",
    body: {
      business_id: bizOwner.id,
      location_id: locOwner.id,
      business_terms_version: "2026-07-19",
      source: "app_settings",
    },
  });
  R.check("owner CANNOT insert a consent row directly (edge fn only)",
    isDenied(directInsert) || !directInsert.ok,
    { detail: `HTTP ${directInsert.status} ${directInsert.text}`,
      onFail: "An authenticated INSERT policy or grant exists — clients could forge consent (security bug)." });

  // --- case 6: grant via the edge function ----------------------------------
  // This call doubles as an availability probe. Every check below depends on a
  // grant actually existing, so if the function is not deployed to THIS project
  // they must SKIP rather than run: with no consent row ever created,
  // "another tenant cannot read", "revoke preserves history", "no admin_assisted
  // row" and the publish-gate parity check would all pass while proving nothing.
  // A suite that reports green because its dependency is absent is worse than
  // one that fails.
  const granted = await fn(ctx, "set-promo-materials-authorization", {
    token: owner.token,
    body: { business_id: bizOwner.id, location_id: locOwner.id, action: "authorize", source: "app_settings" },
  });
  if (granted.status === 404) {
    const why = "set-promo-materials-authorization is not deployed to this project";
    R.skip("owner CAN authorize through the edge function", why);
    for (const name of [
      "grant creates exactly one active row for the location",
      "re-authorizing is idempotent (still one active row)",
      "owner CAN read their own consent row (precondition for the leak check)",
      "another tenant CANNOT read this business's consent rows",
      "another tenant CANNOT revoke this business's consent",
      "cross-tenant revoke attempt left the consent intact",
      "precondition: an active consent row exists before revoking",
      "owner CAN revoke through the edge function",
      "after revoke the location reads as NOT authorized",
      "revoke PRESERVES the historical row (never deletes)",
      "re-granting after revoke appends a new row",
      "precondition: authorization is active before the publish-gate comparison",
      "can_business_publish returns the same result with and without authorization",
      "a client claiming source=admin_assisted is downgraded, never recorded as admin",
      "no admin_assisted row exists for either fixture business",
    ]) {
      R.skip(name, "requires the edge function");
    }
    console.log(`\n  NOTE: deploy set-promo-materials-authorization to this project, then re-run.`);
    return;
  }
  R.check("owner CAN authorize through the edge function",
    granted.ok && granted.json?.authorized === true,
    { detail: `HTTP ${granted.status} ${granted.text}`,
      onFail: "Grant path broken — owner/manager authz or the insert helper regressed (app bug)." });
  R.check("grant creates exactly one active row for the location",
    (await activeCount(locOwner.id)) === 1,
    { onFail: "Partial unique index or idempotency regressed (app bug)." });

  // Idempotent: authorizing twice must not create a second active row.
  await fn(ctx, "set-promo-materials-authorization", {
    token: owner.token,
    body: { business_id: bizOwner.id, location_id: locOwner.id, action: "authorize", source: "app_settings" },
  });
  R.check("re-authorizing is idempotent (still one active row)",
    (await activeCount(locOwner.id)) === 1,
    { onFail: "Duplicate active consent rows — the partial unique index is missing (app bug)." });

  // --- case 5: cross-tenant denial ------------------------------------------
  // Paired with the owner's own read: "the other tenant sees 0 rows" only means
  // something if there IS a row to see. Asserting both sides makes an empty
  // table impossible to mistake for a working policy.
  const ownRead = await readAuthorizations(owner.token, bizOwner.id);
  const ownRows = ownRead.json?.length ?? 0;
  const crossRead = await readAuthorizations(other.token, bizOwner.id);
  R.check("owner CAN read their own consent row (precondition for the leak check)",
    ownRead.ok && ownRows >= 1,
    { detail: `HTTP ${ownRead.status} rows=${ownRows}`,
      onFail: "Member-read policy denies the owner their own consent history (app bug)." });
  R.check("another tenant CANNOT read this business's consent rows",
    ownRows >= 1 && (crossRead.ok ? (crossRead.json?.length ?? 0) === 0 : isDenied(crossRead)),
    { detail: `owner sees ${ownRows}, other sees ${crossRead.json?.length}, HTTP ${crossRead.status}`,
      onFail: "Cross-tenant consent leak — the member-read policy is too broad (security bug)." });

  const crossWrite = await fn(ctx, "set-promo-materials-authorization", {
    token: other.token,
    body: { business_id: bizOwner.id, location_id: locOwner.id, action: "revoke", source: "app_settings" },
  });
  R.check("another tenant CANNOT revoke this business's consent",
    crossWrite.status === 403,
    { detail: `HTTP ${crossWrite.status} ${crossWrite.text}`,
      onFail: "Edge fn authz regressed — a non-member acted for this business (security bug)." });
  R.check("cross-tenant revoke attempt left the consent intact",
    (await activeCount(locOwner.id)) === 1,
    { onFail: "A foreign caller mutated consent state (security bug)." });

  // --- case 7: revoke flips status but preserves history ---------------------
  // Capture the pre-revoke state and assert it is non-empty: "0 active after"
  // and "total unchanged" are both trivially true against an empty table, so
  // without this the two checks below could pass having tested nothing.
  const beforeTotal = await totalCount(locOwner.id);
  const beforeActive = await activeCount(locOwner.id);
  R.check("precondition: an active consent row exists before revoking",
    beforeActive === 1 && beforeTotal >= 1,
    { detail: `active=${beforeActive} total=${beforeTotal}`,
      onFail: "Nothing to revoke — the checks below would pass vacuously (test bug, not an app bug)." });
  const revoked = await fn(ctx, "set-promo-materials-authorization", {
    token: owner.token,
    body: { business_id: bizOwner.id, location_id: locOwner.id, action: "revoke", source: "app_settings" },
  });
  R.check("owner CAN revoke through the edge function",
    revoked.ok && revoked.json?.authorized === false,
    { detail: `HTTP ${revoked.status} ${revoked.text}`,
      onFail: "Revoke path broken (app bug)." });
  R.check("after revoke the location reads as NOT authorized",
    beforeActive === 1 && (await activeCount(locOwner.id)) === 0,
    { onFail: "revoked_at was not stamped — status would stay Authorized (app bug)." });
  const afterTotal = await totalCount(locOwner.id);
  R.check("revoke PRESERVES the historical row (never deletes)",
    beforeTotal >= 1 && afterTotal === beforeTotal,
    { detail: `before=${beforeTotal} after=${afterTotal}`,
      onFail: "Revoke deleted the row — consent history must be preserved for audit (app bug)." });

  // Re-granting after a revoke adds a NEW row rather than reviving the old one.
  await fn(ctx, "set-promo-materials-authorization", {
    token: owner.token,
    body: { business_id: bizOwner.id, location_id: locOwner.id, action: "authorize", source: "app_settings" },
  });
  R.check("re-granting after revoke appends a new row",
    (await totalCount(locOwner.id)) === beforeTotal + 1 && (await activeCount(locOwner.id)) === 1,
    { onFail: "Re-grant rewrote history instead of appending (app bug)." });

  // --- case 9: publish gate is unaffected -----------------------------------
  async function canPublish(businessId) {
    const r = await rest(ctx, "service", "rpc/can_business_publish", {
      method: "POST",
      body: { p_business_id: businessId },
    });
    return r.ok ? JSON.stringify(r.json) : `ERR ${r.status}`;
  }
  // Measure WITH an active authorization, then revoke and measure again. The
  // precondition matters: if no row were active, both sides would measure the
  // same unauthorized state and the comparison would prove nothing.
  const activeBeforeGate = await activeCount(locOwner.id);
  R.check("precondition: authorization is active before the publish-gate comparison",
    activeBeforeGate === 1,
    { detail: `active=${activeBeforeGate}`,
      onFail: "Both sides of the comparison would be unauthorized (test bug, not an app bug)." });
  const withAuth = await canPublish(bizOwner.id);
  await fn(ctx, "set-promo-materials-authorization", {
    token: owner.token,
    body: { business_id: bizOwner.id, location_id: locOwner.id, action: "revoke", source: "app_settings" },
  });
  const withoutAuth = await canPublish(bizOwner.id);
  R.check("can_business_publish returns the same result with and without authorization",
    activeBeforeGate === 1 && withAuth === withoutAuth,
    { detail: `with=${withAuth} without=${withoutAuth}`,
      onFail: "The publish gate now depends on promotional-materials consent — it must stay fully isolated (app bug)." });

  // --- client-supplied source can never claim the admin path ----------------
  // Run against the owner's OWN business, on a location with no active row (the
  // publish-gate step above just revoked it). A cross-tenant attempt would be
  // rejected on authz alone and would never reach the source whitelist, so it
  // could not distinguish a working whitelist from a broken one.
  const forged = await fn(ctx, "set-promo-materials-authorization", {
    token: owner.token,
    body: { business_id: bizOwner.id, location_id: locOwner.id, action: "authorize", source: "admin_assisted" },
  });
  const forgedRow = await rest(
    ctx,
    "service",
    `promo_materials_authorizations?select=id,source&location_id=eq.${locOwner.id}&revoked_at=is.null`,
  );
  const forgedSource = forgedRow.json?.[0]?.source ?? null;
  R.check("a client claiming source=admin_assisted is downgraded, never recorded as admin",
    forged.ok && forgedSource === "app_settings",
    { detail: `HTTP ${forged.status} recorded source=${forgedSource}`,
      onFail: "The source whitelist regressed — clients could forge admin provenance (security bug)." });
  const anyAdminRows = await rest(
    ctx,
    "service",
    `promo_materials_authorizations?select=id&source=eq.admin_assisted&business_id=in.(${bizOwner.id},${bizOther.id})`,
  );
  R.check("no admin_assisted row exists for either fixture business",
    (anyAdminRows.json?.length ?? 0) === 0,
    { detail: `rows=${anyAdminRows.json?.length}`,
      onFail: "An admin_assisted row originated from a client token (security bug)." });
}

try {
  await main();
} catch (e) {
  R.check("2h ran without throwing", false, { detail: e.message });
} finally {
  // Consent rows cascade with their business/location, but clean explicitly in
  // case a fixture insert above was skipped.
  for (const [table, id] of cleanup.rows) await rest(ctx, "service", `${table}?id=eq.${id}`, { method: "DELETE" });
  for (const u of cleanup.users) await adminDeleteUser(ctx, u);
}

const { failed } = R.summary();
process.exit(failed ? 1 : 0);
