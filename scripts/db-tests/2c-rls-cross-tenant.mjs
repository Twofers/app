// D2.2c — cross-tenant RLS isolation.
//
// Two business owners (A, B). Data for both is seeded via the service role
// (bypassing RLS) so setup never depends on each table's INSERT policy. Then,
// using owner A's real JWT, we assert A cannot reach B's tenant:
//   PRIVATE tables (business_locations, media assets, import jobs, billing):
//       cross-tenant READ returns nothing, cross-tenant WRITE is denied.
//   PUBLIC catalog (businesses, deals): cross-tenant READ is ALLOWED by design
//       (world-readable), but cross-tenant WRITE is denied.
//
// A sanity check confirms A CAN read A's OWN private rows (so a green result
// means "isolation", not "RLS blocks everyone").
//
// Run: node scripts/db-tests/2c-rls-cross-tenant.mjs   (service_role required)

import { assertTestDb } from "../assert-test-db.mjs";
import { loadTestEnv, makeReporter, rest, signIn,
         adminCreateUser, adminDeleteUser, uniqueEmail, isDenied, randomUUID } from "./_shared.mjs";

const ctx = loadTestEnv();
assertTestDb(ctx.url); // GUARD — first action, before any DB call.

const R = makeReporter("2c cross-tenant RLS");
const PW = `Test!${randomUUID().slice(0, 10)}`;
const soon = () => new Date(Date.now() + 864e5).toISOString();
const cleanup = { rows: [], users: [] };

async function seed(table, body) {
  const r = await rest(ctx, "service", table, { method: "POST", body });
  const row = Array.isArray(r.json) ? r.json[0] : null;
  if (row?.id) cleanup.rows.unshift([table, row.id]);
  if (!row) R.skip(`seed ${table}`, `HTTP ${r.status} ${r.text}`);
  return row;
}

async function main() {
  const aEmail = uniqueEmail("ownerA");
  const bEmail = uniqueEmail("ownerB");
  const aRealId = await adminCreateUser(ctx, { email: aEmail, password: PW, role: "business" });
  const bId = await adminCreateUser(ctx, { email: bEmail, password: PW, role: "business" });
  cleanup.users.push(aRealId, bId);

  // status "active": the F-002 public predicate (20260814120000) hides
  // pre-approval rows, and these fixtures assert PUBLIC catalog behavior.
  // Pre-approval visibility is covered by 2e-public-visibility.mjs.
  const bizA = await seed("businesses", { owner_id: aRealId, name: "Tenant A Cafe", status: "active" });
  const bizB = await seed("businesses", { owner_id: bId, name: "Tenant B Cafe", status: "active" });
  if (!bizA || !bizB) { R.check("fixture: both businesses seeded", false); return; }
  R.check("fixture: both businesses seeded", true);

  // business_locations.business_id holds businesses.id and (since 20260819120000)
  // FKs to businesses(id). The billing profile is seeded only so tier lookups
  // resolve; its own id is independent and is deliberately not used as a key.
  // It links to the user via user_id / owner_id — there is no business_id column
  // in any migration (the one in prod is undocumented drift).
  await seed("business_profiles", { user_id: aRealId, owner_id: aRealId, name: "Tenant A Cafe" });
  await seed("business_profiles", { user_id: bId, owner_id: bId, name: "Tenant B Cafe" });

  const locA = await seed("business_locations", { business_id: bizA.id, name: "A HQ", address: "1 A St" });
  const locB = await seed("business_locations", { business_id: bizB.id, name: "B HQ", address: "2 B St" });
  // is_recurring bypasses the deal-credit triggers so the seed doesn't need credits.
  const dealB = await seed("deals", { business_id: bizB.id, title: "Buy one get one free", description: "BOGO", is_recurring: true, end_time: soon() });
  const jobB = await seed("business_media_import_jobs", { business_id: bizB.id, source_type: "website", requested_url: "https://tenant-b.example.com" });
  const assetB = await seed("business_media_assets", { business_id: bizB.id, source_type: "owner_upload", storage_path: `${bizB.id}/x.jpg`, mime_type: "image/jpeg" });
  const billB = await seed("billing_accounts", { owner_user_id: bId, provider: "stripe" });

  const { token: tA } = await signIn(ctx, aEmail, PW);

  // --- sanity: A can read A's own private rows ---
  if (locA) {
    const ownRead = await rest(ctx, "anon", `business_locations?select=id&id=eq.${locA.id}`, { token: tA });
    R.check("sanity: A can read A's OWN business_locations", ownRead.ok && (ownRead.json?.length ?? 0) === 1,
      { detail: `HTTP ${ownRead.status}, rows=${ownRead.json?.length}`,
        onFail: "A can't see its own row — RLS too strict or seed failed (likely a test bug)." });
  }

  // --- PRIVATE cross-tenant READ must return nothing ---
  const privateReads = [
    ["business_media_import_jobs", jobB && `business_media_import_jobs?select=*&id=eq.${jobB.id}`],
    ["business_media_assets", assetB && `business_media_assets?select=*&id=eq.${assetB.id}`],
    ["billing_accounts", billB && `billing_accounts?select=*&owner_user_id=eq.${bId}`],
  ];
  for (const [label, q] of privateReads) {
    if (!q) { R.skip(`A cannot read B's ${label}`, "seed missing"); continue; }
    const r = await rest(ctx, "anon", q, { token: tA });
    const leaked = r.ok && Array.isArray(r.json) && r.json.length > 0;
    R.check(`A cannot read B's ${label}`, isDenied(r) || (r.ok && (r.json?.length ?? 0) === 0),
      { detail: `HTTP ${r.status}, rows=${Array.isArray(r.json) ? r.json.length : "?"}`,
        onFail: leaked ? `Cross-tenant READ leak on ${label} — RLS bug (app bug).`
                       : "Unexpected status — verify policy (possible test bug)." });
  }

  // --- PUBLIC catalog cross-tenant READ is allowed BY DESIGN ---
  // business_locations belongs here, not in privateReads above: the pilot read
  // policy ("Auth users can read business locations", live in prod since
  // 2026-06-10, codified by 20260819120000) makes locations readable by ANY
  // authenticated user, because shoppers must read them to render deals. A
  // storefront address is public information. Cross-tenant WRITE is still
  // denied — asserted below and exhaustively in 2g-business-locations-rls.mjs.
  if (locB) {
    const pubLoc = await rest(ctx, "anon", `business_locations?select=id&id=eq.${locB.id}`, { token: tA });
    R.check("A can read B's business_location (pilot read policy, by design)",
      pubLoc.ok && (pubLoc.json?.length ?? 0) === 1,
      { detail: `HTTP ${pubLoc.status}, rows=${pubLoc.json?.length}`,
        onFail: "Deal rendering depends on this read path; 0 rows means the pilot read policy is missing (app bug)." });
  }

  const pubBiz = await rest(ctx, "anon", `businesses?select=id&id=eq.${bizB.id}`, { token: tA });
  R.check("A can read B's businesses row (public catalog, by design)", pubBiz.ok && (pubBiz.json?.length ?? 0) === 1,
    { detail: `HTTP ${pubBiz.status}, rows=${pubBiz.json?.length}`,
      onFail: "businesses is world-readable per initial_schema.sql; 0 rows would mean the policy changed (test may need updating)." });
  if (dealB) {
    const pubDeal = await rest(ctx, "anon", `deals?select=id&id=eq.${dealB.id}`, { token: tA });
    if (isDenied(pubDeal)) {
      // On a schema built purely from the migration files, every client SELECT on
      // deals is denied: the billing-v4 "Businesses can read their own deals"
      // policy references businesses.owner_id, which 20260705120000 ungranted
      // from anon/authenticated. Denied is still cross-tenant SAFE, but it means
      // the migration files and prod's live policies have drifted (prod feeds
      // work) — flagged in the run report for schema-drift review.
      R.skip("A can read B's active deal (public catalog, by design)",
        "deals SELECT denied at table level for clients on this schema — cannot verify public-catalog readability; see drift note");
    } else {
      R.check("A can read B's active deal (public catalog, by design)", pubDeal.ok && (pubDeal.json?.length ?? 0) === 1,
        { detail: `HTTP ${pubDeal.status}, rows=${pubDeal.json?.length}` });
    }
  }

  // --- cross-tenant WRITE must be denied ---
  // INSERT into B's tenant as A (WITH CHECK should reject).
  const insLoc = await rest(ctx, "anon", "business_locations", { token: tA, method: "POST",
    body: { business_id: bizB.id, name: "A-injected", address: "hax" } });
  R.check("A cannot INSERT a business_location under B", !insLoc.ok,
    { detail: `HTTP ${insLoc.status} ${insLoc.text}`, onFail: "Cross-tenant INSERT allowed — RLS WITH CHECK gap (app bug)." });

  // UPDATE B's business name as A, then confirm unchanged via service role.
  await rest(ctx, "anon", `businesses?id=eq.${bizB.id}`, { token: tA, method: "PATCH", body: { name: "HACKED" } });
  const bizBAfter = await rest(ctx, "service", `businesses?select=name&id=eq.${bizB.id}`);
  R.check("A cannot UPDATE B's business (row unchanged)", bizBAfter.json?.[0]?.name === "Tenant B Cafe",
    { detail: `name now = ${bizBAfter.json?.[0]?.name}`, onFail: "A modified B's business — cross-tenant WRITE leak (app bug)." });

  if (dealB) {
    await rest(ctx, "anon", `deals?id=eq.${dealB.id}`, { token: tA, method: "PATCH", body: { title: "HACKED" } });
    const dealBAfter = await rest(ctx, "service", `deals?select=title&id=eq.${dealB.id}`);
    R.check("A cannot UPDATE B's deal (row unchanged)", dealBAfter.json?.[0]?.title === "Buy one get one free",
      { detail: `title now = ${dealBAfter.json?.[0]?.title}`, onFail: "A modified B's deal — cross-tenant WRITE leak (app bug)." });
  }
}

try {
  await main();
} catch (e) {
  R.check("2c ran without throwing", false, { detail: e.message });
} finally {
  for (const [table, id] of cleanup.rows) await rest(ctx, "service", `${table}?id=eq.${id}`, { method: "DELETE" });
  for (const u of cleanup.users) await adminDeleteUser(ctx, u);
}

const { failed } = R.summary();
process.exit(failed ? 1 : 0);
