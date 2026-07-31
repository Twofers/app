# Authenticated database probe results — 2026-07-29

Closes the Phase 4 item "Refresh throwaway QA credentials; rerun the
authenticated RLS, cross-tenant, and normal-business-rejection probes" in
`docs/plans/founder-security-hardening-plan-2026-07-29.md`.

The blocker recorded in that plan — stale saved QA credentials — did not apply to
this suite. `scripts/db-tests/*` **mints its own throwaway users** through the
service role (`adminCreateUser` + `uniqueEmail` in `_shared.mjs`) and deletes
them afterwards, so it needs no long-lived identity. `scripts/assert-test-db.mjs`
is called first in every suite and fails closed: with no environment it refuses,
and it only proceeds for the allowlisted ref `zsuzrerdailvylccqtds`. Both
behaviors were re-proved before the run.

All nine suites were run against the approved test project **after** SSL
enforcement was enabled there, which also re-confirms that HTTPS/PostgREST
clients are unaffected by database SSL enforcement.

## Result

| Suite | First run | After the fixes below |
| --- | --- | --- |
| 2a purge_user_data | 12 pass / 0 fail / 2 skip | unchanged |
| 2b role enforcement | 15 / 0 / 0 | unchanged |
| 2c cross-tenant RLS | 8 / **1** / 1 | unchanged — real defect, see finding 2 |
| 2d billing-token consume | 14 / 0 / 0 | unchanged |
| 2e visibility + publish gate | 12 / **1** / 0 | **13 / 0 / 0** |
| 2f business name lock | 6 / **3** / 0 | **9 / 0 / 0** |
| 2h promo-materials authorization | 21 / 0 / 0 | unchanged |
| 2i claim links activated business | 19 / 0 / 0 | unchanged |
| 2j repeat-claim push audience | 13 / 0 / 0 | unchanged |

## Finding 1 — the test project is 19 migrations behind production

`supabase migration list` against the test project's pooler shows local-only (not
applied to test): `20260822190000`, `20260822191000`, `20260823120000`,
`20260824120000`, `120500`, `121000`, `122000`, `123000`, `124000`, `125000`,
`130000`, and all twelve of the newly approved hardening migrations
`20260824131000`–`142000`. Nothing is remote-only, so there is no reverse drift.

Consequence: the test project is currently a valid target for *behavioral* RLS
and capability probes, but it is **not** a mirror of production's hardened grant
and execution surface. Catching it up is a separate approval (it is a real
mutation of a real project, even though it is not production).

Both of the failures fixed below were also verified as *not* caused by this drift
— neither is touched by any of the 19.

## Finding 2 — confirmed cross-tenant read exposure on `business_locations`

2c's failing check: `A cannot read B's business_locations — HTTP 200, rows=1`,
while the sanity check `A can read A's OWN business_locations` also returns 1 row
(so the failure is isolation, not a blanket-deny artifact), and `A cannot INSERT
a business_location under B` correctly returns 42501.

Live catalog root cause (`pg_policies`, test project):

```
tablename  = business_locations
policyname = Auth users can read business locations (pilot)
cmd        = SELECT
roles      = {public}
qual       = (auth.uid() IS NOT NULL)
```

This policy exists in **no migration in this repository** — it is untracked
drift, the same class of defect as the two untracked reporting views found
earlier in this pass. Permissive policies are OR'd, so it overrides the
owner-scoped `Owners can read their business locations`
(`USING user_owns_business(business_id)`) sitting next to it.

Severity assessment. The nine granted columns are `id, business_id, name,
address, phone, lat, lng, created_at, updated_at` — merchant premises data, not
consumer PII, and published anyway for live storefronts. Anonymous callers are
**not** affected: a live anon probe returns `[]` on both projects because the
predicate requires a session. The real defect is that the policy ignores every
visibility rule the product deliberately enforces on `businesses` — the
public-status predicate (`20260814120000`), hidden businesses
(`20260810120000`), and suspension — so any signed-in account can enumerate the
address and phone of pre-approval, hidden, or suspended merchants and correlate
them by `business_id`.

A sweep for the same shape found **no other instance**: exactly one permissive
`SELECT`/`ALL` policy in `public` has a `true`-equivalent or
"any authenticated user" qualifier, and it is this one.

Remediation is **staged, not applied**:
`supabase/migrations/20260824143000_remove_pilot_business_location_read_policy.sql`
drops only that policy — no grant, function, body, or row changes — with a
rollback statement in its header and a source test at
`supabase/functions/_shared/pilot-business-location-policy-migration.test.ts`.
Applying it is a separate approval. 2c will pass once it is applied.

**Production status unverified.** Confirming it in production needs either the
production database password (founder-held; the developer must not handle it) or
a throwaway authenticated production identity. The policy is pilot-era and absent
from source control in both projects' migration history, so production almost
certainly carries it too — but that is inference, not evidence, and is recorded
as such.

## Finding 3 — two stale suites, both fixed

Neither was a security defect; both were tests that had not been updated after
intentional hardening landed.

**2e / 2f, `42501 permission denied for table businesses`.** `_shared.mjs`
defaults to `Prefer: return=representation`, which asks PostgREST to echo the
whole row. Migration `20260820121000` deliberately puts `businesses` on a
**column-level** SELECT grant for `authenticated`, withholding 34 of 55 columns
(`owner_id`, `business_email`, `admin_notes`, `risk_score`, …). Echoing the full
row therefore touches ungranted columns. The app never hits this because every
client write narrows — `.update(...).select("id")` or no select at all
(`app/business-setup.tsx`). Fixed by passing `prefer: "return=minimal"` on the
four owner-JWT writes, which is what production actually does.

**2f fixture predated the capability gate.** Its business was seeded
`status='pending_verification', access_level='none'`. Migration `20260817120000`
gates every owner profile write on `can_edit_business_information`, which
requires setup, active, or lapsed access, so that row is now rejected with
`BUSINESS_PROFILE_EDIT_CAPABILITY_REQUIRED` before the name lock is ever reached
— and the two later assertions failed as a cascade off the first. Fixed by
seeding `access_level='approved_not_activated'` (setup access) and holding it
across both phases, so profile edits stay legal while `status` alone drives
public visibility, which is what `is_public_business_status()` — and therefore
the lock — keys on. 2f now proves the lock end to end: pre-approval rename 204,
post-approval rename 403 `business_name_locked`, unchanged-name resend 204,
service-role admin rename 200.

While debugging, 2f's first assertion was also changed to include the response
body in its detail line; without it the failure showed only `HTTP 400`.

## Finding 4 — the founder's `@hotmail.com` identity cannot obtain a token in production

Testing the saved QA credentials against production:

| Credential | Result |
| --- | --- |
| `TWOFER_QA_SHOPPER` (`q***@twoferapp.com`) | HTTP 400 invalid login credentials |
| `TWOFER_QA_BUSINESS` (`t***@test.com`) | HTTP 400 invalid login credentials |
| `QA_CUSTOMER` (`u***@gmail.com`) | HTTP 400 invalid login credentials |
| `TWOFER_QA_OWNER` / `TWOFER_SMOKE` / `QA` (all the same `u***@hotmail.com`) | **HTTP 500 `Database error querying schema`** |

The three 500s are one account, not three. The 400s matter as a control: GoTrue
only reaches "invalid credentials" by querying successfully and finding no match,
so **production authentication is working in general** — this is account-scoped,
not an outage.

Not diagnosed further here. Identifying the cause needs an admin read of that
user's `auth` rows and identities, which is user-account enumeration against
production and is founder-gated. It matters beyond QA convenience: per the plan,
`unvmex2@hotmail.com` is the chosen destination for security alerts, and one of
the two active `admin_users` owner rows. Founder action: sign in to that account
from the dashboard and confirm it works, or have its duplicate/identity state
inspected.

## Finding 5 — remaining coverage gaps (not defects)

- 2a skips two checks with "seed row id not captured" (`deal_claims` anonymization
  via both the direct RPC and `delete-user-account`), so purge behavior for that
  table is unproven.
- 2c skips `seed deals` with `BUSINESS_PUBLISH_CAPABILITY_REQUIRED` — the same
  capability gate as finding 3, meaning cross-tenant assertions on `deals` did
  not run. The `businesses` half of the public-catalog check did run and passed.

Both are test-fixture debt rather than production findings, and neither was in
scope for this pass.

## Reproduce

```bash
npm run test:db
```

Requires `.env.test` (gitignored) with the test project's URL, anon key, and
service-role key. The guard refuses any other project.
