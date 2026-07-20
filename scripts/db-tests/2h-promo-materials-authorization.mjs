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
  const granted = await fn(ctx, "set-promo-materials-authorization", {
    token: owner.token,
    body: { business_id: bizOwner.id, location_id: locOwner.id, action: "authorize", source: "app_settings" },
  });
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
  const crossRead = await readAuthorizations(other.token, bizOwner.id);
  R.check("another tenant CANNOT read this business's consent rows",
    crossRead.ok ? (crossRead.json?.length ?? 0) === 0 : isDenied(crossRead),
    { detail: `HTTP ${crossRead.status} rows=${crossRead.json?.length}`,
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
  const beforeTotal = await totalCount(locOwner.id);
  const revoked = await fn(ctx, "set-promo-materials-authorization", {
    token: owner.token,
    body: { business_id: bizOwner.id, location_id: locOwner.id, action: "revoke", source: "app_settings" },
  });
  R.check("owner CAN revoke through the edge function",
    revoked.ok && revoked.json?.authorized === false,
    { detail: `HTTP ${revoked.status} ${revoked.text}`,
      onFail: "Revoke path broken (app bug)." });
  R.check("after revoke the location reads as NOT authorized",
    (await activeCount(locOwner.id)) === 0,
    { onFail: "revoked_at was not stamped — status would stay Authorized (app bug)." });
  R.check("revoke PRESERVES the historical row (never deletes)",
    (await totalCount(locOwner.id)) === beforeTotal,
    { detail: `before=${beforeTotal} after=${await totalCount(locOwner.id)}`,
      onFail: "Revoke deleted the row — consent history must be preserved for audit (app bug)." });

  // Re-granting after a revoke adds a NEW row rather than reviving the old one.
  await fn(ctx, "set-promo-materials-authorization", {
    token: owner.token,
    body: { business_id: bizOwner.id, location_id: locOwner.id, action: "authorize", source: "app_settings" },
  });
  R.check("re-granting after revoke appends a new row",
    (await totalCount(locOwner.id)) === beforeTotal + 1 && (await activeCount(locOwner.id)) === 1,
    { onFail: "Re-grant rewrote history instead of appending (app bug)." });

  // --- client-supplied source can never claim the admin path ----------------
  const forged = await fn(ctx, "set-promo-materials-authorization", {
    token: owner.token,
    body: { business_id: bizOther.id, location_id: locOther.id, action: "authorize", source: "admin_assisted" },
  });
  // The call is forbidden anyway (wrong tenant); the point is that no
  // admin_assisted row can originate from a client token.
  const forgedRows = await rest(
    ctx,
    "service",
    `promo_materials_authorizations?select=id&source=eq.admin_assisted&business_id=eq.${bizOther.id}`,
  );
  R.check("a client token can never produce an admin_assisted row",
    (forgedRows.json?.length ?? 0) === 0,
    { detail: `HTTP ${forged.status} rows=${forgedRows.json?.length}`,
      onFail: "The source whitelist regressed — clients could forge admin provenance (security bug)." });

  // --- case 9: publish gate is unaffected -----------------------------------
  async function canPublish(businessId) {
    const r = await rest(ctx, "service", "rpc/can_business_publish", {
      method: "POST",
      body: { p_business_id: businessId },
    });
    return r.ok ? JSON.stringify(r.json) : `ERR ${r.status}`;
  }
  // bizOwner currently HAS an active authorization; bizOther has none.
  const withAuth = await canPublish(bizOwner.id);
  await fn(ctx, "set-promo-materials-authorization", {
    token: owner.token,
    body: { business_id: bizOwner.id, location_id: locOwner.id, action: "revoke", source: "app_settings" },
  });
  const withoutAuth = await canPublish(bizOwner.id);
  R.check("can_business_publish returns the same result with and without authorization",
    withAuth === withoutAuth,
    { detail: `with=${withAuth} without=${withoutAuth}`,
      onFail: "The publish gate now depends on promotional-materials consent — it must stay fully isolated (app bug)." });
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
