# businesses column-grant repair

Status: **built, not applied.** Every migration below is authored and validated
locally. Applying migrations and deploying edge functions are hard gates that
need Dan's explicit approval.

Found 2026-07-19 while working the business_locations RLS/FK repair.

> **Rebase note (2026-07-19).** The first version of this plan was authored on a
> branch that was **36 migrations behind `main`**, so its policy audit described a
> schema that no longer existed. It would have reverted a deliberate decision (see
> "deals" below). Everything here has been re-derived against `origin/main`, which
> matches production. If you are reading an older copy, discard it.

## The finding

`supabase/migrations/20260705120000_businesses_pii_column_grants.sql` revoked
table-level SELECT on `public.businesses` from `anon`/`authenticated` and
re-granted a non-PII column subset, deliberately withholding `owner_id`,
`business_email`, `contact_name`, `tone`. Owners read their own full row through
`get_my_business()` (SECURITY DEFINER).

In production that hardening is defeated: `authenticated` holds a **table-level**
SELECT grant on `businesses`.

### Evidence (read-only, 2026-07-19)

Confirmed behaviourally — there is no `SUPABASE_DB_URL` in the local env, and
`information_schema` is not reachable through PostgREST. Signed in as
`TWOFER_SMOKE_EMAIL` and issued column-scoped REST reads:

| column | `anon` | `authenticated` |
| --- | --- | --- |
| `id`, `name` | readable (intended) | readable (intended) |
| `owner_id` | 42501 | **readable, all rows** |
| `business_email` | 42501 | **readable, all rows** |
| `contact_name` | 42501 | **readable, all rows** |
| `tone` | 42501 | **readable, all rows** |

`anon` is in the intended state, which is what makes this table-level SELECT on
`authenticated` specifically. Across all 137 migrations only **four** statements
touch SELECT on `businesses` (the 17-column grant in `20260705120000`, plus
`claim_notifications_enabled` and `is_demo`), and none restores a table-level
grant — so this is prod-only drift from a hand-run statement.

### Wider than the original four columns

All 55 live columns were enumerated and diffed against what the migrations grant.
**36 columns have never appeared in any GRANT**, and are readable in production
today. Beyond the PII four this includes the internal governance set —
`admin_notes`, `risk_score`, `risk_level`, `suspension_reason`, `suspended_by`,
`approved_by`, `status`, `access_level`, `verification_status` — corroborated by
`20260804120000_lock_businesses_server_columns.sql`, whose write-freeze list is
nearly the same set.

Any signed-in shopper can currently read merchant risk scores, admin notes and
suspension reasons. Blast radius today is small (3 business rows) but the
disclosure class is worse than the original report.

## Why this could not be a one-line fix

**28 live RLS policies** inline:

```sql
EXISTS (SELECT 1 FROM public.businesses b
        WHERE b.id = <tbl>.business_id AND b.owner_id = auth.uid())
```

A policy expression is evaluated with the invoking role's column privileges, so
every one works in production *only* because of the over-grant. Re-asserting the
grants alone would immediately 42501: `deal_templates` (4), `business_menu_items`
(4), `redemptions` (1), `app_analytics_events` (1), `business_media_import_jobs`
(1), the AI ad / media-library cluster (11), deal-photos storage (3) and
**business-logos storage (3)**.

## Sequence

Apply strictly in this order. Steps 1 and 2 must not be split across deploys.

### Step 1 — `20260820120000_route_business_ownership_through_definer_helper.sql`

Rewrites all 28 policies onto the **existing** `public.is_business_owner(uuid)`
helper (`20260812130000:47`, already live in production). Behaviour-preserving:
each rewritten predicate computes exactly what it replaces, and every
non-ownership predicate is carried over verbatim.

Adds one small function, `is_business_owner_for_object_path(text)`. The storage
policies key off the first path segment of `storage.objects.name` rather than a
`business_id` column, so they need a uuid before they can call
`is_business_owner()`. A bare cast would raise 22P02 on the deliberate
`business-logos/app/` infra prefix, where the original text comparison returned
false. The helper regex-guards the prefix (`CASE`, not `AND` — SQL does not
guarantee short-circuit order) and delegates the ownership decision wholly to
`is_business_owner()`. It is intentionally **not** SECURITY DEFINER: it touches no
table itself.

#### Deliberately not in step 1

**`public.deals`.** `20260812130000_consolidate_deals_rls_policies.sql` already
did this work for deals — it introduced `is_business_owner()` and consolidated the
owner policies under the canonical `deals_owner_*` names. Re-creating the older
`"Businesses can ... their own deals"` names would resurrect the superseded set
**and** re-introduce the `business_profiles` trial/active gate that decision (a)
in that migration explicitly turned OFF. deals is correct; leave it alone.

**`public.user_owns_business(uuid)`** is neither created nor dropped. It already
exists in production (hand-applied 2026-07-19 as part of `20260819120000`;
verified live — `rpc/user_owns_business` returns 200/`false`, not PGRST202), and
the `business_locations` policies from that migration depend on it, so dropping it
would break them. It is a near-duplicate of `is_business_owner()` with a weaker
contract (no NULL guard, no `row_security = off`). New work uses
`is_business_owner()`; consolidating the two is follow-up.

Because `20260819120000` was hand-applied there is no `schema_migrations` row for
it, so `supabase db push` may try to run that file again.

### Step 2 — `20260820121000_reassert_businesses_column_grants.sql`

`REVOKE SELECT` then re-`GRANT` **21 columns**: the original 17, plus `is_demo`,
`repeat_claim_policy_type` and `repeat_claim_cooldown_days` to both roles, and
`claim_notifications_enabled` to `authenticated` only (matching its original grant
in `20260713120000` — the re-assert must not silently widen it to `anon`).

`repeat_claim_policy_type` / `repeat_claim_cooldown_days` were added by
`20260721120000` and never granted. They are read by
`lib/repeat-claim-visibility.ts:79`, `app/(tabs)/account/index.tsx:351`, and —
critically — by `supabase/functions/claim-deal/index.ts:267`, which embeds
`businesses(repeat_claim_policy_type, repeat_claim_cooldown_days)` on a caller-JWT
client. **That is the claim path for every shopper.** Its `dealSelectLegacy`
fallback does not save it: `isMissingNewDealSelectColumn` only matches
`PGRST200 / PGRST204 / 42703`, so a 42501 skips the fallback and every claim hard
fails. They are claim rules, not PII.

**Anon dependency:** `nearby_businesses()` and `nearby_deals()`
(`20260802141000`) are SECURITY INVOKER with EXECUTE granted to `anon`, and read
`businesses.{id, name, location, latitude, longitude}`. All five are in the grant
list; removing any would 42501 logged-out browse.

The other 34 columns stay ungranted. No code path running as `anon`/
`authenticated` reads any of them. Per Dan's 2026-07-19 decision, the internal
governance columns stay ungranted **even if** a client is later found to read one
— that would be a UI leak to fix, not a grant to preserve.

### Step 3 — `20260820122000_revoke_ddl_privileges_from_client_roles.sql`

Independent of steps 1–2; can ship separately.

Both `anon` and `authenticated` hold TRUNCATE/REFERENCES/TRIGGER on ~18 tables
inherited from the hosted project baseline — nothing in this repo grants them, and
there is no `ALTER DEFAULT PRIVILEGES` anywhere in `supabase/`, `scripts/` or
`docs/`. Revokes those three privileges and adds an `ALTER DEFAULT PRIVILEGES` so
the fix does not decay with the next migration.

**Honest scoping:** TRUNCATE is not subject to RLS, but it is also not reachable
through PostgREST. Reaching it needs a SQL-injectable SECURITY INVOKER function
running as a client role, and this repo's RPCs are overwhelmingly SECURITY DEFINER
with pinned `search_path`. Defence in depth, not incident response.

## Deliberately out of scope

The same ~18 tables still hold default **INSERT/UPDATE/DELETE** for `anon`/
`authenticated`, gated only by RLS. Those are the privileges an RLS policy bug
would actually expose — a bigger issue than TRUNCATE — but they are load-bearing:
many client paths write through PostgREST under RLS. **Tracked here, not fixed
here.**

## Code changes (ship with steps 1–2)

| file | change |
| --- | --- |
| `supabase/functions/ai-generate-deal-copy/index.ts:253` | `.eq("owner_id", …)` → `rpc("get_my_business")` |
| `supabase/functions/redeem-token/index.ts:128` | `supabase` → `supabaseAdmin` (already in scope); still scoped to `user.id` |
| `lib/owner-business.ts` | removed the legacy direct-select fallback (see below) |
| `scripts/pilot-smoke-test.ts`, `scripts/probe-subscription.mjs` | routed through `get_my_business()` |

`ai-generate-ad-variants` needed no change — **main had already made the same fix**
independently; only a comment conflicted during the rebase.

`lib/owner-business.ts`: the fallback's comment claimed `20260705120000` was
unapplied; it *is* applied, and `get_my_business()` returns the caller's full row
(verified). The fallback only ever worked because of the over-grant and would have
masked the real RPC error behind a second 42501. With it gone the `ownerUserId`
parameter is dead — the RPC is scoped to `auth.uid()` — so
`fetchOwnerBusiness(client)` takes only the client. Five call sites and one test
assertion updated.

Verified **not** at risk — every other edge-function read of a withheld column is
on a pure service-role client with no `Authorization` override:
`activate-redemption-mode`, `manage-redemption-devices`, `owner-redemption-security`,
`delete-user-account`, `publish-offer-version`, `ai-compose-offer`, `ai-extract-menu`,
`ai-translate-deal`, `ai-studio-generate-draft`, `import-business-website`,
`get-business-onboarding-context`, `update-business-profile-section`, the `stripe-*`
family, the `admin-*` family, `send-deal-push`, and `claim-deal:818`.

## Gate

`scripts/rls-inventory.sql` reported these grants but never failed on them — its
only gate keys on `not c.relrowsecurity`, so a table with RLS enabled passes
regardless of what privileges client roles hold. That is exactly how this drift
went unnoticed. Added two assertions: no TRUNCATE/REFERENCES/TRIGGER for client
roles, and no table-level SELECT on `businesses`.

Assertion 2 is reliable because `role_table_grants` lists table-level grants only —
the intended column-level grants never appear there, so any row for
`businesses`/`SELECT` is by definition the over-grant.

## Validation

- `npm run typecheck` — clean
- `npm run lint` — clean
- `npm test` — 1560 passed / 1561. The one failure,
  `supabase/functions/_shared/launch-signup-source.test.ts`, is **pre-existing on
  `origin/main`**: it asserts on the text of `launch-signup/index.ts`, and both
  that function and the test are byte-identical to `origin/main` here. Unrelated
  to this work.
- `npm run typecheck:functions` — 2 pre-existing failures
  (`ai-generate-ad-variants`, `ai-studio-generate-draft`), both `TS2307 Import
  "jpeg-js" not a dependency` at an import line.

## Post-apply verification (Dan-gated)

Run in order after applying, from inside the worktree:

1. `node scripts/probe-rls-smoke.mjs` — mandatory after any RLS policy migration.
2. `psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -f scripts/rls-inventory.sql` — both
   new gates must pass.
3. `node scripts/probe-subscription.mjs`, `scripts/pilot-smoke-test.ts`,
   `node scripts/probe-deals-rls.mjs`.
4. Re-run the column probe: `authenticated` must now 42501 on `owner_id`,
   `business_email`, `contact_name`, `tone`, `admin_notes`, `risk_score` — and must
   still succeed on `repeat_claim_policy_type`.
5. Device QA on the owner paths most at risk: **logo upload**, poster upload,
   create/edit/delete a deal, My offers, redeem a claim, **claim a deal as a
   shopper**, merchant analytics, AI ad generation, menu items, deal templates.

Step 5 matters — the rewrite touches 28 policies, and `probe-rls-smoke` does not
exercise storage uploads or the ad cluster.

## Loose ends

- `TWOFER_QA_OWNER_EMAIL` / `TWOFER_QA_SHOPPER_EMAIL` both fail sign-in (HTTP 400).
  Stale or deleted accounts; only `TWOFER_SMOKE_EMAIL` works. Any QA script
  depending on them is silently broken.
- `anon` can still EXECUTE `get_my_business()` — returns 0 rows (`auth.uid()` is
  null), so no disclosure, but `20260705120000:50` intended to revoke it.
- Two ownership helpers now coexist in production (`is_business_owner`,
  `user_owns_business`). Consolidate once `business_locations` is revisited.
- `business_locations` policies are independently broken: they join
  `business_profiles.id = business_locations.business_id`, but that column holds
  `businesses.id` values — an always-false join. Orthogonal to this repair.
- Own-table policy semantics: the `businesses` INSERT/UPDATE policies
  (`20250127000000:78,82`) reference `owner_id` as an own-table column ref, not a
  cross-table subquery, so no column-privilege check fires. Cheap to confirm on the
  test project after re-asserting: as a non-privileged owner, update a row you own.
