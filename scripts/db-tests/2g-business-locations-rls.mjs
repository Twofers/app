// D2.2g — business_locations owner RLS + foreign key.
//
// Covers migration 20260819120000_fix_business_locations_owner_rls_and_fk.sql
// (plan: docs/plans/business-locations-rls-fk-repair-plan.md).
//
// The bug this guards against: every owner policy on business_locations joined
// `business_profiles.id = business_locations.business_id`, but the column holds
// `businesses.id`. The join was always false, so owners could never write a
// location from the client and the pro=1 / premium=3 cap enforced nothing.
// Separately, prod carried NO foreign key on the column at all.
//
// PRE-APPLY this suite is EXPECTED TO FAIL on "owner can INSERT their first
// location" and on the FK checks — that failure is the bug reproducing, and it
// proves the suite can detect the broken state. POST-APPLY everything passes.
//
// Run: node scripts/db-tests/2g-business-locations-rls.mjs   (service_role required)

import { assertTestDb } from "../assert-test-db.mjs";
import { loadTestEnv, makeReporter, rest, signIn,
         adminCreateUser, adminDeleteUser, uniqueEmail, isDenied, randomUUID } from "./_shared.mjs";

const ctx = loadTestEnv();
assertTestDb(ctx.url); // GUARD — first action, before any DB call.

const R = makeReporter("2g business_locations RLS + FK");
const PW = `Test!${randomUUID().slice(0, 10)}`;
const cleanup = { rows: [], users: [] };

async function seed(table, body) {
  const r = await rest(ctx, "service", table, { method: "POST", body });
  const row = Array.isArray(r.json) ? r.json[0] : null;
  if (row?.id) cleanup.rows.unshift([table, row.id]);
  if (!row) R.skip(`seed ${table}`, `HTTP ${r.status} ${r.text}`);
  return row;
}

/** Insert a location as `token`'s user. Returns the raw rest() result. */
function insertLocation(token, businessId, name) {
  return rest(ctx, "anon", "business_locations", {
    token,
    method: "POST",
    body: { business_id: businessId, name, address: `${name} St` },
  });
}

async function main() {
  // --- fixtures -------------------------------------------------------------
  const ownerEmail = uniqueEmail("bl-owner");
  const otherEmail = uniqueEmail("bl-other");
  const shopperEmail = uniqueEmail("bl-shopper");
  const ownerId = await adminCreateUser(ctx, { email: ownerEmail, password: PW, role: "business" });
  const otherId = await adminCreateUser(ctx, { email: otherEmail, password: PW, role: "business" });
  const shopperId = await adminCreateUser(ctx, { email: shopperEmail, password: PW, role: "shopper" });
  cleanup.users.push(ownerId, otherId, shopperId);

  const bizOwner = await seed("businesses", { owner_id: ownerId, name: "Loc Owner Cafe", status: "active" });
  const bizOther = await seed("businesses", { owner_id: otherId, name: "Loc Other Cafe", status: "active" });
  if (!bizOwner || !bizOther) { R.check("fixture: both businesses seeded", false); return; }
  R.check("fixture: both businesses seeded", true);

  // business_profiles.id is an INDEPENDENT uuid — deliberately NOT equal to
  // businesses.id here. That is the real prod shape, and seeding it that way is
  // what makes this suite able to catch a regression back to the dead join.
  //
  // No `business_id` column is set: it exists in prod but is created by no
  // migration and read by no code (prod-only drift), and it is absent on the
  // test project. The profile is linked to the caller via user_id / owner_id,
  // which is exactly how the cap policy locates it.
  const profOwner = await seed("business_profiles", {
    user_id: ownerId, owner_id: ownerId,
    name: "Loc Owner Cafe", subscription_tier: "pro",
  });
  await seed("business_profiles", {
    user_id: otherId, owner_id: otherId,
    name: "Loc Other Cafe", subscription_tier: "pro",
  });
  if (profOwner) {
    R.check("fixture: business_profiles.id differs from businesses.id (prod shape)",
      profOwner.id !== bizOwner.id,
      { detail: "if these were equal the old dead-join policies would pass by accident" });
  }

  const { token: tOwner } = await signIn(ctx, ownerEmail, PW);
  const { token: tOther } = await signIn(ctx, otherEmail, PW);
  const { token: tShopper } = await signIn(ctx, shopperEmail, PW);

  // --- INSERT ---------------------------------------------------------------
  const first = await insertLocation(tOwner, bizOwner.id, "Primary");
  const firstRow = Array.isArray(first.json) ? first.json[0] : null;
  if (firstRow?.id) cleanup.rows.unshift(["business_locations", firstRow.id]);
  R.check("owner can INSERT their first location", first.ok && !!firstRow,
    { detail: `HTTP ${first.status} ${first.ok ? "" : first.text}`,
      onFail: "This is the original bug: owner policies joined business_profiles.id instead of businesses.id (app bug). Expected to fail PRE-apply." });

  const second = await insertLocation(tOwner, bizOwner.id, "Second");
  const secondRow = Array.isArray(second.json) ? second.json[0] : null;
  if (secondRow?.id) cleanup.rows.unshift(["business_locations", secondRow.id]);
  R.check("pro-tier owner CANNOT INSERT a 2nd location (cap=1)", !second.ok,
    { detail: `HTTP ${second.status}`,
      onFail: "Location cap not enforced — pro tier must be capped at 1 (app bug)." });

  const foreign = await insertLocation(tOther, bizOwner.id, "Injected");
  const foreignRow = Array.isArray(foreign.json) ? foreign.json[0] : null;
  if (foreignRow?.id) cleanup.rows.unshift(["business_locations", foreignRow.id]);
  R.check("non-owner CANNOT INSERT a location under someone else's business", !foreign.ok,
    { detail: `HTTP ${foreign.status}`,
      onFail: "Cross-tenant INSERT allowed — WITH CHECK gap (app bug)." });

  // --- premium cap (3) ------------------------------------------------------
  // Flip the owner's tier as service role, then re-test the cap boundary.
  if (profOwner) {
    const bump = await rest(ctx, "service", `business_profiles?id=eq.${profOwner.id}`, {
      method: "PATCH", body: { subscription_tier: "premium" },
    });
    if (!bump.ok) {
      R.skip("premium cap boundary", `could not set subscription_tier=premium (HTTP ${bump.status})`);
    } else {
      const p2 = await insertLocation(tOwner, bizOwner.id, "Premium2");
      const p2Row = Array.isArray(p2.json) ? p2.json[0] : null;
      if (p2Row?.id) cleanup.rows.unshift(["business_locations", p2Row.id]);
      R.check("premium owner CAN INSERT a 2nd location", p2.ok,
        { detail: `HTTP ${p2.status} ${p2.ok ? "" : p2.text}`,
          onFail: "Premium tier must allow up to 3 locations (app bug)." });

      const p3 = await insertLocation(tOwner, bizOwner.id, "Premium3");
      const p3Row = Array.isArray(p3.json) ? p3.json[0] : null;
      if (p3Row?.id) cleanup.rows.unshift(["business_locations", p3Row.id]);
      R.check("premium owner CAN INSERT a 3rd location", p3.ok,
        { detail: `HTTP ${p3.status} ${p3.ok ? "" : p3.text}` });

      const p4 = await insertLocation(tOwner, bizOwner.id, "Premium4");
      const p4Row = Array.isArray(p4.json) ? p4.json[0] : null;
      if (p4Row?.id) cleanup.rows.unshift(["business_locations", p4Row.id]);
      R.check("premium owner CANNOT INSERT a 4th location (cap=3)", !p4.ok,
        { detail: `HTTP ${p4.status}`,
          onFail: "Premium cap of 3 not enforced (app bug)." });

      await rest(ctx, "service", `business_profiles?id=eq.${profOwner.id}`, {
        method: "PATCH", body: { subscription_tier: "pro" },
      });
    }
  }

  // --- SELECT ---------------------------------------------------------------
  // Locations are readable by ANY authenticated user by design: shoppers must
  // read them to render deals. That is the "Auth users can read business
  // locations (pilot)" policy, hand-created in prod 2026-06-10 and codified by
  // this migration. Confidentiality for locations is not a goal — a location is
  // a public storefront address.
  if (firstRow) {
    const shopperRead = await rest(ctx, "anon", `business_locations?select=id&id=eq.${firstRow.id}`, { token: tShopper });
    R.check("authenticated shopper CAN read a business location (pilot read policy)",
      shopperRead.ok && (shopperRead.json?.length ?? 0) === 1,
      { detail: `HTTP ${shopperRead.status}, rows=${shopperRead.json?.length}`,
        onFail: "Deals cannot render without this read path (app bug)." });

    const ownerRead = await rest(ctx, "anon", `business_locations?select=id&id=eq.${firstRow.id}`, { token: tOwner });
    R.check("owner CAN read their own location", ownerRead.ok && (ownerRead.json?.length ?? 0) === 1,
      { detail: `HTTP ${ownerRead.status}, rows=${ownerRead.json?.length}` });

    // Recorded for prod parity, never asserted — anon access depends on whether
    // the anon key is granted on the table at all, which varies by environment.
    const anonRead = await rest(ctx, "anon", `business_locations?select=id&id=eq.${firstRow.id}`);
    R.skip("anon SELECT (recorded for prod parity, not asserted)",
      `HTTP ${anonRead.status}, rows=${Array.isArray(anonRead.json) ? anonRead.json.length : "?"}`);
  }

  // --- UPDATE / DELETE ------------------------------------------------------
  if (firstRow) {
    const upOwn = await rest(ctx, "anon", `business_locations?id=eq.${firstRow.id}`, {
      token: tOwner, method: "PATCH", body: { name: "Primary renamed" },
    });
    const upOwnAfter = await rest(ctx, "service", `business_locations?select=name&id=eq.${firstRow.id}`);
    R.check("owner CAN UPDATE their own location",
      upOwn.ok && upOwnAfter.json?.[0]?.name === "Primary renamed",
      { detail: `HTTP ${upOwn.status}, name=${upOwnAfter.json?.[0]?.name}`,
        onFail: "Owner UPDATE denied — policy still keyed off the wrong table (app bug)." });

    await rest(ctx, "anon", `business_locations?id=eq.${firstRow.id}`, {
      token: tOther, method: "PATCH", body: { name: "HACKED" },
    });
    const crossAfter = await rest(ctx, "service", `business_locations?select=name&id=eq.${firstRow.id}`);
    R.check("non-owner CANNOT UPDATE someone else's location (row unchanged)",
      crossAfter.json?.[0]?.name === "Primary renamed",
      { detail: `name now = ${crossAfter.json?.[0]?.name}`,
        onFail: "Cross-tenant UPDATE leak (app bug)." });

    // WITH CHECK on UPDATE: an owner must not be able to re-point their own
    // location at a business they do not own.
    await rest(ctx, "anon", `business_locations?id=eq.${firstRow.id}`, {
      token: tOwner, method: "PATCH", body: { business_id: bizOther.id },
    });
    const repointAfter = await rest(ctx, "service", `business_locations?select=business_id&id=eq.${firstRow.id}`);
    R.check("owner CANNOT re-point their location at another business (UPDATE WITH CHECK)",
      repointAfter.json?.[0]?.business_id === bizOwner.id,
      { detail: `business_id now = ${repointAfter.json?.[0]?.business_id}`,
        onFail: "UPDATE policy is missing a WITH CHECK clause — a location can be moved into another tenant (app bug)." });
  }

  // A throwaway row the owner is allowed to delete.
  const doomed = await seed("business_locations", {
    business_id: bizOwner.id, name: "Doomed", address: "9 Gone St",
  });
  if (doomed) {
    const delOther = await rest(ctx, "anon", `business_locations?id=eq.${doomed.id}`, { token: tOther, method: "DELETE" });
    const stillThere = await rest(ctx, "service", `business_locations?select=id&id=eq.${doomed.id}`);
    R.check("non-owner CANNOT DELETE someone else's location",
      (stillThere.json?.length ?? 0) === 1,
      { detail: `HTTP ${delOther.status}, rows remaining=${stillThere.json?.length}`,
        onFail: "Cross-tenant DELETE leak (app bug)." });

    await rest(ctx, "anon", `business_locations?id=eq.${doomed.id}`, { token: tOwner, method: "DELETE" });
    const goneCheck = await rest(ctx, "service", `business_locations?select=id&id=eq.${doomed.id}`);
    R.check("owner CAN DELETE their own location", (goneCheck.json?.length ?? 0) === 0,
      { detail: `rows remaining=${goneCheck.json?.length}`,
        onFail: "Owner DELETE denied — policy still keyed off the wrong table (app bug)." });
  }

  // --- foreign key ----------------------------------------------------------
  // Service role bypasses RLS but NOT referential integrity, so this isolates
  // the FK. 23503 = foreign_key_violation.
  const bogus = await rest(ctx, "service", "business_locations", {
    method: "POST",
    body: { business_id: randomUUID(), name: "No such business", address: "0 Nowhere" },
  });
  const bogusRow = Array.isArray(bogus.json) ? bogus.json[0] : null;
  if (bogusRow?.id) cleanup.rows.unshift(["business_locations", bogusRow.id]);
  R.check("INSERT with a business_id matching no business is rejected (FK 23503)",
    !bogus.ok && /23503/.test(bogus.text),
    { detail: `HTTP ${bogus.status} ${bogus.text}`,
      onFail: "No foreign key on business_locations.business_id — orphan rows can be created (app bug). Expected to fail PRE-apply." });

  // ON DELETE CASCADE: deleting a business must reap its locations.
  const cascadeBizEmail = uniqueEmail("bl-cascade");
  const cascadeUserId = await adminCreateUser(ctx, { email: cascadeBizEmail, password: PW, role: "business" });
  cleanup.users.push(cascadeUserId);
  const cascadeBiz = await seed("businesses", { owner_id: cascadeUserId, name: "Cascade Cafe", status: "active" });
  if (cascadeBiz) {
    const cascadeLoc = await seed("business_locations", {
      business_id: cascadeBiz.id, name: "Cascade HQ", address: "1 Cascade St",
    });
    if (cascadeLoc) {
      await rest(ctx, "service", `businesses?id=eq.${cascadeBiz.id}`, { method: "DELETE" });
      const after = await rest(ctx, "service", `business_locations?select=id&id=eq.${cascadeLoc.id}`);
      R.check("deleting a business CASCADES to its locations",
        (after.json?.length ?? 0) === 0,
        { detail: `rows remaining=${after.json?.length}`,
          onFail: "FK is missing or lacks ON DELETE CASCADE — account purge will leave orphans (app bug)." });
    }
  }
}

try {
  await main();
} catch (e) {
  R.check("2g ran without throwing", false, { detail: e.message });
} finally {
  for (const [table, id] of cleanup.rows) await rest(ctx, "service", `${table}?id=eq.${id}`, { method: "DELETE" });
  for (const u of cleanup.users) await adminDeleteUser(ctx, u);
}

const { failed } = R.summary();
process.exit(failed ? 1 : 0);
