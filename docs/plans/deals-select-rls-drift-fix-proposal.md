# Proposal: reconcile the `deals` SELECT RLS drift (migrations vs prod)

Status: **PROPOSAL — do not apply as-is.** Applying Supabase migrations is
hard-gated (needs Dan's approval), and this is RLS-sensitive. The SQL below is a
starting point for review, **not** a migration file — that's why it lives in
`docs/plans/` and not `supabase/migrations/`. Before anything is applied, the
prod probe in step 1 must confirm what prod's live policy actually is.

Traced entirely from source on 2026-07-11 (no prod touched). Companion notes in
the DB-guardrails session memory.

## Symptom

On a schema built purely from the migration files, **every client SELECT on
`public.deals` returns 403**. The DB-suite (`test:db`, suite 2c) records this as
an explicit skip. Meanwhile the production feed reads deals fine — so **prod's
live RLS has drifted from the migration files**. That means a fresh environment
rebuilt from `supabase/migrations` (or a `supabase db reset`) would ship a broken
consumer feed. This is a migration-fidelity bug, not a live prod bug.

## Root cause (from source)

Two SELECT policies exist on `deals`:

1. `"Anyone can read active deals"` — `20260330120000` / `20260330140000`,
   permissive public discovery:
   ```sql
   USING (is_active = true AND end_time > NOW() AND start_time <= NOW())
   ```
2. `"Businesses can read their own deals"` — `20260601153000` (billing-v4),
   owner + subscription gate:
   ```sql
   USING (
     EXISTS (SELECT 1 FROM public.businesses b
             WHERE b.id = deals.business_id AND b.owner_id = auth.uid())
     AND EXISTS (SELECT 1 FROM public.business_profiles bp
                 WHERE (bp.user_id = auth.uid() OR bp.owner_id = auth.uid())
                   AND bp.subscription_status IN ('trial','active'))
   )
   ```

Migration `20260705120000_businesses_pii_column_grants.sql` then did
`REVOKE SELECT ON public.businesses FROM anon, authenticated` and re-granted only
a non-PII column allowlist — **deliberately leaving `owner_id` ungranted** (its
line 35 says so). Postgres enforces column-level SELECT privileges on columns
referenced **inside an RLS policy's `USING` expression**, so policy (2) can no
longer read `b.owner_id`; evaluating it raises a permission error, which aborts
the whole `deals` SELECT rather than just returning `false`. Policy (1) alone
should still allow public reads, so the fact that a migrations-only schema 403s
outright is consistent with the owner-policy error aborting the query.

`business_profiles` is **not** affected: `20260726120000` only did
`REVOKE UPDATE (...)` on it, so the second `EXISTS` still has SELECT on
`user_id` / `owner_id` / `subscription_status`. The single offending reference is
`businesses.owner_id` in the first `EXISTS`.

## Proposed fix

Mirror the existing `get_my_business()` pattern from the same PII migration: move
the `owner_id` check into a `SECURITY DEFINER` helper so the policy stops
referencing an ungranted column. **Do not** re-grant `owner_id` to clients —
that would undo the PII migration and re-expose the owner's `auth.users` uuid.

```sql
-- Does the caller own this business? SECURITY DEFINER bypasses the column-level
-- GRANT that (correctly) hides businesses.owner_id from anon/authenticated.
CREATE OR REPLACE FUNCTION public.is_business_owner(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = p_business_id
      AND b.owner_id = auth.uid()
  );
$$;

-- Supabase grants EXECUTE to anon by default; REVOKE FROM PUBLIC alone does not
-- remove it (verified live 2026-06-10). Revoke anon explicitly.
REVOKE EXECUTE ON FUNCTION public.is_business_owner(uuid) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.is_business_owner(uuid) TO authenticated;

-- Rewrite the owner-read policy to call the helper instead of touching owner_id.
DROP POLICY IF EXISTS "Businesses can read their own deals" ON public.deals;
CREATE POLICY "Businesses can read their own deals"
  ON public.deals FOR SELECT
  USING (
    public.is_business_owner(deals.business_id)
    AND EXISTS (
      SELECT 1 FROM public.business_profiles bp
      WHERE (bp.user_id = auth.uid() OR bp.owner_id = auth.uid())
        AND bp.subscription_status IN ('trial','active')
    )
  );

-- Belt-and-suspenders: make sure public discovery is present and unchanged.
DROP POLICY IF EXISTS "Anyone can read active deals" ON public.deals;
CREATE POLICY "Anyone can read active deals"
  ON public.deals FOR SELECT
  USING (is_active = true AND end_time > NOW() AND start_time <= NOW());
```

## Before applying — required steps (all Dan-gated)

1. **Probe prod first (read-only).** Capture the real live policy so we're not
   writing against an assumption:
   ```sql
   SELECT policyname, cmd, qual
   FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'deals';
   ```
   Confirm whether prod's owner-read policy already avoids `owner_id` (e.g. was
   hand-edited to a helper or a `business_profiles`-only check). The migration
   must encode **prod's** intended shape, then also fix the file lineage.
2. Decide the target ref (CLI link state is uncertain — could be test
   `zsuzrerdailvylccqtds` or prod `kvodhiqhdqnptqovovia`). Apply to test first.
3. Promote the reviewed SQL into a real timestamped file under
   `supabase/migrations/` only when approved.
4. **After apply, immediately run `node scripts/probe-rls-smoke.mjs`** (per the
   RLS-NULL-policy incident rule) and re-run `npm run test:db` suite 2c to
   confirm the client `deals` SELECT is no longer 403.

## Risk notes

- `SECURITY DEFINER` + `SET search_path = public` + `STABLE` matches the
  existing safe helpers in this repo; the function reads one row and returns a
  boolean, so it cannot leak `owner_id` itself.
- Keep both SELECT policies — they OR together (public discovery + owner read).
- Do not widen the column allowlist on `businesses`.
