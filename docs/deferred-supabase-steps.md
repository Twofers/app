# Deferred Supabase steps: business_locations keying cleanup — SUPERSEDED

**Status: SUPERSEDED 2026-07-19. Do not run anything from this document.**

Its work is now subsumed by:

- **Plan:** [`docs/plans/business-locations-rls-fk-repair-plan.md`](plans/business-locations-rls-fk-repair-plan.md)
- **Migration:** `supabase/migrations/20260819120000_fix_business_locations_owner_rls_and_fk.sql`
- **Behavioral tests:** `scripts/db-tests/2g-business-locations-rls.mjs`

## Why it was superseded

This document (written 2026-06-10) proposed hand-run SQL blocks to fix the
`business_locations` insert policy and delete two orphan rows. It was never run,
and it has since gone stale in three ways:

1. Its policy rewrite would have been clobbered anyway by
   `20260807130000_fix_business_locations_recursion.sql`, which re-created the
   same policy still keyed off the wrong table (`business_profiles.id`).
2. It only addressed the INSERT policy. The SELECT / UPDATE / DELETE owner
   policies from `20260601153000` carry the identical dead join and are equally
   broken.
3. It assumed two orphan rows. A read-only prod inventory on 2026-07-19 found
   **six**, and it missed the largest finding entirely: prod has **no foreign
   key on `business_locations.business_id` at all**, so nothing was stopping
   orphans from accumulating in the first place.

The replacement migration handles all of it in one transaction — policy rewrite
for all four verbs, generalized orphan cleanup behind a fail-safe guard, and
restoration of the foreign key with `ON DELETE CASCADE`.

The original precondition still holds and is carried into the plan: the client
re-key to `businesses.id` must be in the installed build before applying, or old
installs will start hitting foreign-key violations instead of silently
mis-keying. See §8 of the plan.

_(Historical content removed. The original blocks are recoverable from git
history if ever needed for archaeology.)_
