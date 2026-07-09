// D2.2b — role enforcement (Shopper must not act as a Business).
//
// With a shopper-role (customer) JWT:
//   - reads on business-PRIVATE tables leak nothing (denied or empty)
//   - writes to business-owned tables are denied
//   - business edge functions do not succeed
//   - the shopper cannot flip its own profiles.role to 'business'
//
// Public catalog tables (businesses, deals) are world-readable BY DESIGN
// (initial_schema.sql: "Anyone can read businesses" / active deals) and are
// therefore NOT treated as role violations for READs — only writes are.
//
// Run: node scripts/db-tests/2b-role-enforcement.mjs   (service_role required)

import { assertTestDb } from "../assert-test-db.mjs";
import { loadTestEnv, makeReporter, rest, fn, signIn,
         adminCreateUser, adminDeleteUser, uniqueEmail, isDenied, randomUUID } from "./_shared.mjs";

const ctx = loadTestEnv();
assertTestDb(ctx.url); // GUARD — first action, before any DB call.

const R = makeReporter("2b role enforcement");
const PW = `Test!${randomUUID().slice(0, 10)}`;
const FAKE_BIZ = randomUUID(); // a business this shopper does not own
const users = [];

// Business-private tables: a shopper must see NO rows (owner-scoped RLS).
const PRIVATE_READ_TABLES = [
  "business_locations", "offer_versions", "business_media_assets",
  "business_media_import_jobs", "billing_accounts", "business_billing_profiles",
];

// Owner-only write targets (arbitrary business_id the shopper does not own).
const WRITE_DENY = [
  ["deals", { business_id: FAKE_BIZ, title: "Buy one get one free", end_time: new Date(Date.now() + 864e5).toISOString() }],
  ["business_locations", { business_id: FAKE_BIZ, name: "x", address: "y" }],
  ["business_media_import_jobs", { business_id: FAKE_BIZ, source_type: "website", requested_url: "https://example.com" }],
];

// Clearly business-only edge functions — a shopper must not get a 2xx success.
const BUSINESS_FUNCTIONS = [
  ["update-business-profile-section", { section: "identity", values: {} }],
  ["publish-offer-version", { offer_version_id: randomUUID() }],
  ["import-business-website", { url: "https://example.com" }],
  ["manage-redemption-devices", { action: "list" }],
  ["accept-business-terms", {}],
];

async function main() {
  const email = uniqueEmail("shopper");
  const shopperId = await adminCreateUser(ctx, { email, password: PW, role: "customer" });
  users.push(shopperId);
  // Ensure a profiles row exists with the customer role for the flip test.
  await rest(ctx, "service", "profiles", { method: "POST",
    prefer: "resolution=merge-duplicates,return=representation",
    body: { id: shopperId, app_tab_mode: "customer", role: "customer" } });
  const { token } = await signIn(ctx, email, PW);

  // 1. Private reads leak nothing.
  for (const table of PRIVATE_READ_TABLES) {
    const r = await rest(ctx, "anon", `${table}?select=*&limit=1`, { token });
    const leaked = r.ok && Array.isArray(r.json) && r.json.length > 0;
    R.check(`read ${table} leaks nothing to shopper`, isDenied(r) || (r.ok && (r.json?.length ?? 0) === 0),
      { detail: `HTTP ${r.status}, rows=${Array.isArray(r.json) ? r.json.length : "?"}`,
        onFail: leaked ? "Shopper can READ business-private rows — RLS leak (app bug)."
                       : "Unexpected status; verify the table/policy (may be a test bug)." });
  }

  // 2. Writes to business-owned tables are denied.
  for (const [table, body] of WRITE_DENY) {
    const r = await rest(ctx, "anon", table, { token, method: "POST", body });
    R.check(`write ${table} denied for shopper`, !r.ok,
      { detail: `HTTP ${r.status} ${r.text}`,
        onFail: "Shopper could WRITE a business-owned row — RLS/role gap (app bug)." });
  }

  // 3. Business edge functions do not succeed for a shopper.
  for (const [name, body] of BUSINESS_FUNCTIONS) {
    const r = await fn(ctx, name, { token, body });
    // A platform 404 means the function isn't deployed on the test project at
    // all — that proves nothing about authorization, so don't count it as a pass.
    if (r.status === 404 && r.json?.code === "NOT_FOUND") {
      R.skip(`edge fn ${name} not authorized for shopper`, "function not deployed on test project — authz unverified");
      continue;
    }
    const succeeded = r.status >= 200 && r.status < 300 && !r.json?.error;
    R.check(`edge fn ${name} not authorized for shopper`, !succeeded,
      { detail: `HTTP ${r.status} ${r.text}`,
        onFail: "Shopper got a success from a business-only function — authz gap (app bug). "
              + "If the status is 400 it may be input validation, not role denial — check manually (possible test bug)." });
  }

  // 4. Shopper cannot self-promote via profiles.role.
  const patch = await rest(ctx, "anon", `profiles?id=eq.${shopperId}`, {
    token, method: "PATCH", body: { role: "business" } });
  const after = await rest(ctx, "service", `profiles?select=role&id=eq.${shopperId}`);
  const roleNow = after.json?.[0]?.role;
  R.check("shopper cannot flip own profiles.role to business", roleNow === "customer",
    { detail: `patch HTTP ${patch.status}; role now = ${roleNow}`,
      onFail: "profiles_update_own has no column-level guard on role — a customer can self-promote to business, "
            + "defeating the hard role split. App bug (needs a role-immutability RLS/column REVOKE/trigger)." });
}

try {
  await main();
} catch (e) {
  R.check("2b ran without throwing", false, { detail: e.message });
} finally {
  for (const u of users) await adminDeleteUser(ctx, u); // cascade removes profiles row
}

const { failed } = R.summary();
process.exit(failed ? 1 : 0);
