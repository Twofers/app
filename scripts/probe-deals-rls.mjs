// READ-mostly probe for the `deals` SELECT RLS drift (proposal:
// docs/plans/deals-select-rls-drift-fix-proposal.md). Run it BEFORE and AFTER
// applying the consolidation migration to the TEST project to prove the fix.
//
// It creates one throwaway confirmed auth user, performs a few PostgREST reads
// as that user (and as anon), then deletes the user. No schema changes, no deal
// seeding. Guarded by assertTestDb — it can ONLY touch the approved test project.
//
// The key invariant: an authenticated client must be able to run a plain
// `SELECT ... FROM deals` without a blanket 403. On the drifted/migrations-only
// schema this fails because the owner-read policy references businesses.owner_id,
// which clients cannot read since the PII column-grants migration (finding F3).
//
// Run:  node scripts/probe-deals-rls.mjs
// Exit: 0 = the authenticated deals read is healthy (not blanket-denied).

import {
  assertTestDb,
  loadTestEnv,
  rest,
  signIn,
  adminCreateUser,
  adminDeleteUser,
  makeReporter,
  uniqueEmail,
} from "./db-tests/_shared.mjs";

const ctx = loadTestEnv();
assertTestDb(ctx.url); // fail-closed: refuses anything but the test project

const report = makeReporter("deals-rls");
const PASSWORD = "Test!12345-deals-rls";
let userId = null;

try {
  const email = uniqueEmail("dealsrls");
  userId = await adminCreateUser(ctx, { email, password: PASSWORD, role: "customer" });
  const { token } = await signIn(ctx, email, PASSWORD);

  // 1) The core check: a plain authenticated SELECT on deals must not be a
  //    blanket denial. A 42501/permission-denied here is finding F3.
  const anyRead = await rest(ctx, "anon", "deals?select=id&limit=1", { token });
  const blanketDenied =
    anyRead.status === 403 || /42501|permission denied/i.test(anyRead.text);
  report.check(
    "authenticated plain `SELECT id FROM deals LIMIT 1` is not blanket-denied",
    !blanketDenied,
    {
      detail: `HTTP ${anyRead.status}`,
      onFail:
        "F3 reproduced: owner-read policy references ungranted businesses.owner_id — apply the consolidation (SECURITY DEFINER is_business_owner helper).",
    },
  );

  // 2) Reading only live deals should also work (public-read policies).
  const liveRead = await rest(ctx, "anon", "deals?select=id&is_active=eq.true&limit=1", {
    token,
  });
  const liveDenied =
    liveRead.status === 403 || /42501|permission denied/i.test(liveRead.text);
  report.check("authenticated live-deals read is not blanket-denied", !liveDenied, {
    detail: `HTTP ${liveRead.status}`,
  });

  // 3) Anon baseline — unauthenticated live-deals read (public discovery).
  const anonLive = await rest(ctx, "anon", "deals?select=id&is_active=eq.true&limit=1");
  const anonDenied =
    anonLive.status === 403 || /42501|permission denied/i.test(anonLive.text);
  report.check("anon live-deals discovery is not blanket-denied", !anonDenied, {
    detail: `HTTP ${anonLive.status}`,
  });
} finally {
  await adminDeleteUser(ctx, userId);
}

const { failed } = report.summary();
process.exit(failed ? 1 : 0);
