# Proposal: reconcile the `deals` RLS drift (migrations vs prod)

Status: **PROPOSAL — do not apply as-is.** Applying Supabase migrations is
hard-gated and this is RLS-sensitive. This doc lives in `docs/plans/` (not
`supabase/migrations/`) on purpose. Updated 2026-07-11 with a **read-only prod
`pg_policies` probe** (Dan-authorized) that replaced the earlier file-only
guesswork — prod's live policy set is very different from the migration files.

## What prod actually has (probe, 2026-07-11, project `kvodhiqhdqnptqovovia`)

`SELECT policyname, cmd, roles, qual FROM pg_policies WHERE tablename='deals'`
returned ~14 policies — far more than the migration files define. Grouped:

**Public read (no `owner_id`) — three overlapping SELECT policies:**
| policy | `USING` | note |
|---|---|---|
| `Anyone can read active deals` | `is_active AND end_time>now() AND start_time<=now()` | correct — hides not-yet-started deals |
| `public view active deals` | `is_active AND start_time<=now() AND end_time>now()` | correct — duplicate of the above |
| `deals_public_read_live` | `is_active AND now()<end_time` | **BUG: no `start_time` gate** |

**Owner read (references `businesses.owner_id`, role `{public}`):**
`Businesses can read their own deals` — `EXISTS(SELECT 1 FROM businesses WHERE
id=deals.business_id AND owner_id=auth.uid())`. This is the **pre-billing-v4
shape** — no `business_profiles` subscription gate, unlike migration
`20260601153000`. So billing-v4's intended replacement never took on prod (or was
overlaid by later manual policies).

**Claim / redeemer:** `Users can read deals they claimed`,
`redeemer_deals_select_guard`.

**Owner CRUD (overlapping):** `deals_owner_crud` (ALL), `business manage own
deals` (ALL), `Businesses can insert/update/delete their own deals`,
`redeemer_deals_{insert,update,delete}_guard`.

PII column grants **are** applied on prod: an anon `select=owner_id` /
`business_email` / `contact_name` on `businesses` returns `42501 permission
denied`, while `select=id` returns 200. So `owner_id` is genuinely ungranted to
clients — the PII migration `20260705120000` is live.

## Findings

### F1 — over-exposure: scheduled deals leak before they start (real)
`deals_public_read_live` grants public SELECT on any `is_active` deal whose
`end_time` is in the future, with **no `start_time <= now()` check**. Because
permissive RLS policies OR together, this is the most permissive branch and it
**defeats the explicit "hide deals that have not started yet" intent** documented
in migration `20260330140000`. A one-time deal scheduled for the future (active,
not yet started) is publicly readable early. Confidence: high (it's literally in
the live policy list). This is the one finding with user-visible impact.

### F2 — policy sprawl / drift (maintainability + fragility)
Three near-identical public-read policies and 4+ overlapping owner-CRUD policies
have accumulated across migrations and manual edits, in three different naming
styles (`Title Case`, `snake_case`, `lower case`). Old policies were never
dropped when new ones were added. Hard to reason about; easy to reintroduce a
leak like F1.

### F3 — latent `owner_id` column-privilege fragility (explains the 403)
The owner-read policy's subquery reads `businesses.owner_id`, which clients can't
SELECT (F1 probe). On a **migrations-only schema** (the test project) *every*
client `deals` SELECT returns 403; prod does not. Most likely mechanism: the OR
of permissive policies short-circuits per row — when a permissive public-read
policy is already TRUE (a currently-live deal), the owner branch isn't evaluated,
so `owner_id` is never read and no permission error fires. Prod always has live
deals, so reads succeed; the freshly-seeded test project had no currently-live
row to short-circuit, so the owner branch ran → `owner_id` permission error →
403. **This means the same latent failure exists on prod** for any read where no
permissive policy matches (e.g. an owner viewing their own not-yet-started or
ended deal). Treat as "most likely" until reproduced on the test project.

## Proposed fix (consolidation migration — gated, validate on test first)

Not the earlier single-policy swap. Consolidate to remove F1 and F3:

1. **Collapse the three public-read policies into one correct definition** (keep
   the `start_time <= now()` gate); drop `deals_public_read_live` and one of the
   duplicates.
   ```sql
   DROP POLICY IF EXISTS "deals_public_read_live"     ON public.deals;
   DROP POLICY IF EXISTS "public view active deals"   ON public.deals;
   DROP POLICY IF EXISTS "Anyone can read active deals" ON public.deals;
   CREATE POLICY "deals_public_read_active" ON public.deals FOR SELECT
     USING (is_active = true AND start_time <= now() AND end_time > now());
   ```
2. **Refactor `owner_id` references behind a SECURITY DEFINER helper** so the
   caller context never reads the ungranted column (removes F3). Mirrors the
   existing `get_my_business()` pattern; do **not** re-grant `owner_id`.
   ```sql
   CREATE OR REPLACE FUNCTION public.is_business_owner(p_business_id uuid)
   RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE
   AS $$ SELECT EXISTS (SELECT 1 FROM public.businesses b
                        WHERE b.id = p_business_id AND b.owner_id = auth.uid()); $$;
   REVOKE EXECUTE ON FUNCTION public.is_business_owner(uuid) FROM PUBLIC, anon;
   GRANT  EXECUTE ON FUNCTION public.is_business_owner(uuid) TO authenticated;
   -- then rewrite the owner read/CRUD policies to call is_business_owner(business_id)
   -- instead of EXISTS(... businesses ... owner_id = auth.uid()).
   ```
3. **De-duplicate the owner-CRUD policies** into one coherent set, deciding
   whether the billing-v4 subscription gate (`trial`/`active`) should apply to
   owner *reads* (prod currently does NOT gate reads — confirm intended).

## Required steps before applying (all Dan-gated)

1. Reproduce the 403 on the **test project** (`zsuzrerdailvylccqtds`, built from
   migrations) and confirm F3's short-circuit theory.
2. Apply the consolidation there first; run `node scripts/probe-rls-smoke.mjs`
   **and** `npm run test:db` (suite 2c) green.
3. Also decide whether prod's extra policies should be encoded back into the
   migration files so the two stop diverging (fixes the root drift, not just the
   symptom).
4. Only then, gated prod apply → immediately re-run `probe-rls-smoke` per the
   RLS-NULL-policy incident rule.

## Risk notes
- F1 is the only finding with live user impact (early exposure of scheduled
  deals) and could ship as a tiny standalone fix (drop `deals_public_read_live`)
  ahead of the larger consolidation, if desired.
- Keep at least one permissive public-read policy at all times so consumer feeds
  never break mid-migration.
- `SECURITY DEFINER` + `SET search_path = public` + `STABLE` matches existing
  safe helpers; the function returns a boolean and cannot leak `owner_id`.
