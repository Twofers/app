-- Repair business_locations owner RLS policies + restore the missing foreign key.
--
-- Plan: docs/plans/business-locations-rls-fk-repair-plan.md
--
-- WHY
-- `business_locations.business_id` holds `businesses.id` values. That is the
-- deliberate current keying: the client hook writes it that way
-- (hooks/use-business-locations.ts) and the activation-gate RPC inserts it that
-- way server-side (20260817120000).
--
-- But the owner policies in the MIGRATION FILES all join `business_profiles.id =
-- business_locations.business_id`. `business_profiles.id` is an independent
-- gen_random_uuid() PK that no code path ever sets equal to `businesses.id`, so
-- that join is ALWAYS FALSE.
--
-- A pg_policies inventory of prod on 2026-07-19 showed prod has DRIFTED from the
-- migration files -- in the helpful direction, mostly. Live prod state was:
--   * SELECT / UPDATE / DELETE owner policies: already hand-repaired in June to
--     join `businesses.owner_id`. Correct, but recorded nowhere in a migration.
--   * INSERT owner policy: still the dead `business_profiles` join from
--     20260807130000. BROKEN.
--   * UPDATE policy: `with_check` IS NULL, so an owner can re-point their own
--     location at another business's id. Cross-tenant write hole.
--
-- So the consequences in production today are:
--   * owners can never INSERT a location from the client -- the deal-wizard
--     auto-create is RLS-denied every time. It goes unnoticed only because the
--     activation gate creates the primary location as SECURITY DEFINER,
--     bypassing RLS;
--   * the pro=1 / premium=3 location cap is enforced by nothing that works;
--   * a location row can be moved into another tenant via UPDATE;
--   * any environment built from the migration files alone (e.g. the test
--     project) gets ALL FOUR policies dead-joined, plus no shopper read path;
--   * there is NO foreign key on business_id at all -- billing_v4
--     (20260601153000) dropped the original FK->businesses and its replacement
--     ADD CONSTRAINT->business_profiles never took effect in prod (drift-repair
--     era). Verified read-only 2026-07-19: PostgREST returns PGRST200 "no
--     relationship found" for BOTH businesses and business_profiles embeds.
--
-- This migration re-keys the owner policies onto `businesses.owner_id`, cleans
-- up the location rows orphaned by the missing FK, and restores the FK with
-- ON DELETE CASCADE so business deletion once again reaps its locations.
--
-- Against PROD its net effect is narrow: repair the INSERT policy (and with it
-- the cap), add the missing UPDATE WITH CHECK, delete 6 orphan rows, and add the
-- FK. The SELECT/UPDATE/DELETE rewrites are no-ops that simply put prod's
-- hand-made June repairs into version control where they belong.
--
-- Supersedes docs/deferred-supabase-steps.md (its blocks are subsumed here).
--
-- NOT touched by this migration: the redeemer RESTRICTIVE policy
-- `redeemer_business_locations_block_all` (20260712120000), the deals policies,
-- and the entitlement-sync helper functions. No app code changes are required.

-- ---------------------------------------------------------------------------
-- 1. Fail-safe guard: refuse to run if an orphan location carries live state.
-- ---------------------------------------------------------------------------
-- Read-only prod inventory on 2026-07-19 found 6 orphan location rows. All 6
-- carry a `location_entitlements` row, but every one of those is an inert
-- placeholder from the 2026-06-22 backfill: status 'trial_eligible', no billing
-- account, no provider subscription, no trial started, never paid. Those are
-- safe to reap along with their location.
--
-- Anything richer than that -- a started trial, a billing account, a provider
-- subscription, a paid invoice, a deal, or a credit period -- means real money
-- or real content is attached to a row we are about to delete. In that case we
-- RAISE, which rolls the whole migration back. Nothing is half-applied.
DO $$
DECLARE
  v_blocked int := 0;
  v_n int;
BEGIN
  -- Orphans referenced by deals.
  IF to_regclass('public.deals') IS NOT NULL THEN
    SELECT count(*) INTO v_n
    FROM public.business_locations bl
    WHERE NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = bl.business_id)
      AND EXISTS (SELECT 1 FROM public.deals d WHERE d.location_id = bl.id);
    v_blocked := v_blocked + v_n;
  END IF;

  -- Orphans referenced by a NON-INERT entitlement.
  IF to_regclass('public.location_entitlements') IS NOT NULL THEN
    SELECT count(*) INTO v_n
    FROM public.business_locations bl
    WHERE NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = bl.business_id)
      AND EXISTS (
        SELECT 1 FROM public.location_entitlements le
        WHERE le.business_location_id = bl.id
          AND NOT (
            le.status = 'trial_eligible'
            AND le.billing_account_id IS NULL
            AND le.provider_subscription_id IS NULL
            AND le.trial_started_at IS NULL
            AND le.first_paid_at IS NULL
          )
      );
    v_blocked := v_blocked + v_n;
  END IF;

  -- Orphans referenced by a credit period.
  IF to_regclass('public.deal_credit_periods') IS NOT NULL THEN
    SELECT count(*) INTO v_n
    FROM public.business_locations bl
    WHERE NOT EXISTS (SELECT 1 FROM public.businesses b WHERE b.id = bl.business_id)
      AND EXISTS (SELECT 1 FROM public.deal_credit_periods p WHERE p.business_location_id = bl.id);
    v_blocked := v_blocked + v_n;
  END IF;

  IF v_blocked > 0 THEN
    RAISE EXCEPTION
      'business_locations FK repair aborted: % orphan row(s) carry deals, credit periods, or live billing entitlements. Manual review required before this migration can run.',
      v_blocked;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Orphan cleanup.
-- ---------------------------------------------------------------------------
-- Location rows whose business_id matches no `businesses` row. These exist
-- because the FK was missing, so deleting a business left its locations behind.
-- Their inert dependents (entitlements, identity rows, duplicate-review rows)
-- are all declared ON DELETE CASCADE; historical pointers (deal_claims,
-- redemptions, offer-version tables) are ON DELETE SET NULL. Guard 1 above has
-- already proven nothing load-bearing is attached.
DELETE FROM public.business_locations bl
WHERE NOT EXISTS (
  SELECT 1 FROM public.businesses b WHERE b.id = bl.business_id
);

-- ---------------------------------------------------------------------------
-- 3. Restore the foreign key -> businesses(id).
-- ---------------------------------------------------------------------------
-- Idempotent AND target-aware: prod has no FK at all, but a migration-built
-- environment (e.g. the test project) may carry 20260601153000's FK pointing at
-- business_profiles. A name-only existence check would silently leave that
-- wrong-target constraint in place, so inspect confrelid and drop a mismatch.
DO $$
DECLARE
  v_conname text;
  v_target  oid;
BEGIN
  SELECT conname, confrelid INTO v_conname, v_target
  FROM pg_constraint
  WHERE conrelid = 'public.business_locations'::regclass
    AND contype = 'f'
    AND conkey = ARRAY[
      (SELECT attnum FROM pg_attribute
       WHERE attrelid = 'public.business_locations'::regclass
         AND attname = 'business_id')
    ]::smallint[]
  LIMIT 1;

  IF v_conname IS NOT NULL AND v_target IS DISTINCT FROM 'public.businesses'::regclass THEN
    EXECUTE format('ALTER TABLE public.business_locations DROP CONSTRAINT %I', v_conname);
    v_conname := NULL;
  END IF;

  IF v_conname IS NULL THEN
    ALTER TABLE public.business_locations
      ADD CONSTRAINT business_locations_business_id_fkey
      FOREIGN KEY (business_id) REFERENCES public.businesses(id)
      ON DELETE CASCADE;
  END IF;
END $$;

COMMENT ON COLUMN public.business_locations.business_id
  IS 'FK -> businesses(id) (NOT business_profiles). Matches the client hook and the activation-gate RPC. Restored 2026-08-19 after billing_v4 left the column with no FK at all.';

-- ---------------------------------------------------------------------------
-- 4. Codify the shopper read policy.
-- ---------------------------------------------------------------------------
-- Created by hand in the prod SQL editor on 2026-06-10 and never captured in a
-- migration, so migration-built environments have no working read path at all.
-- Shoppers must be able to read locations to render deals. No-op in prod.
--
-- The definition below MIRRORS PROD EXACTLY, verified 2026-07-19 via pg_policies:
-- role `public` with `auth.uid() IS NOT NULL`, not `TO authenticated USING (true)`.
-- The two are behaviorally near-identical (anon has no uid, so it evaluates
-- false), but copying prod verbatim is what keeps other environments honest.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'business_locations'
      AND policyname = 'Auth users can read business locations (pilot)'
  ) THEN
    CREATE POLICY "Auth users can read business locations (pilot)"
      ON public.business_locations FOR SELECT
      TO public
      USING (auth.uid() IS NOT NULL);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. Re-key the four owner policies onto businesses.owner_id.
-- ---------------------------------------------------------------------------
-- Ownership is `businesses.owner_id = auth.uid()` (hard Shopper/Business role
-- split). Policy names below deliberately match the existing ones from
-- 20260601153000 / 20260807130000 so the DROPs replace rather than accumulate.
-- The 2026-07-19 prod inventory confirmed those four names are the only owner
-- policies present, so the DROP list is complete -- no stray hand-made policy
-- survives this migration.
--
-- One intentional tightening: prod's owner policies currently carry role
-- `public`; these are scoped `TO authenticated`. Safe, because a request with a
-- JWT is already `authenticated`, the service role bypasses RLS entirely, and
-- anon has no grant on this table (verified: anon SELECT returns 401).
--
-- These are PERMISSIVE policies, so plain boolean logic is correct here; the
-- COALESCE(..., false) rule from the RLS-NULL incident applies to RESTRICTIVE
-- policies. The cap subquery still COALESCEs, because a NULL cap would compare
-- as NULL and deny every insert.
--
-- The `public.business_location_count(uuid)` SECURITY DEFINER helper from
-- 20260807130000 is kept as-is: it exists precisely so the cap check can count
-- rows without recursing into this policy.
--
-- CRITICAL: these policies must NOT read `public.businesses` or
-- `public.business_profiles` directly. RLS policy expressions are evaluated with
-- the PRIVILEGES OF THE QUERYING ROLE, and `20260705120000` deliberately revoked
-- SELECT on `businesses` from anon/authenticated as a hardening step. A policy
-- that selects from it fails at the GRANT layer with 42501 "permission denied
-- for table businesses" before RLS is ever consulted -- which is exactly what
-- the 2g suite hit on 2026-07-19.
--
-- So ownership and cap lookups go through SECURITY DEFINER helpers, the same
-- pattern `business_location_count` already established. Restoring the grant
-- would undo an intentional security decision and is not an option.
--
-- NOTE: prod's June hand-repair of the SELECT/UPDATE/DELETE policies reads
-- `businesses` directly and DOES currently execute there -- but only because
-- prod holds a table-level SELECT grant on `businesses` for `authenticated`,
-- which itself defeats 20260705120000's column-level PII restriction (owner_id,
-- business_email, contact_name, tone). That over-grant is tracked as separate
-- follow-up work. Routing through the definer helpers means these policies keep
-- working after it is repaired; direct-reading policies would not.

CREATE OR REPLACE FUNCTION public.user_owns_business(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = p_business_id
      AND b.owner_id = auth.uid()
  );
$$;

COMMENT ON FUNCTION public.user_owns_business(uuid)
  IS 'SECURITY DEFINER ownership test for RLS policies. Needed because authenticated has no SELECT grant on businesses (20260705120000). Discloses nothing: a caller can only learn whether THEY own the id they passed.';

REVOKE ALL ON FUNCTION public.user_owns_business(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.user_owns_business(uuid) TO authenticated;

-- Cap for the CALLING user. Wrapped for the same grant reason, and so the tier
-- rule lives in exactly one place.
CREATE OR REPLACE FUNCTION public.location_cap_for_current_user()
RETURNS integer
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(
    (
      SELECT CASE WHEN bp.subscription_tier = 'premium' THEN 3 ELSE 1 END
      FROM public.business_profiles bp
      WHERE bp.user_id = auth.uid()
         OR bp.owner_id = auth.uid()
      -- Deterministic if a user ever ends up with more than one profile row:
      -- the most recently created one reflects the current subscription.
      ORDER BY bp.created_at DESC
      LIMIT 1
    ),
    1  -- no billing profile yet => pilot default cap of 1
  );
$$;

COMMENT ON FUNCTION public.location_cap_for_current_user()
  IS 'Location cap for the calling user: premium=3, everything else=1. COALESCEs to 1 so a missing billing profile denies nothing by returning NULL.';

REVOKE ALL ON FUNCTION public.location_cap_for_current_user() FROM public;
GRANT EXECUTE ON FUNCTION public.location_cap_for_current_user() TO authenticated;

-- Tier source note: billing v4 makes `business_profiles.subscription_tier`
-- canonical, so that is what the cap reads. The client currently hardcodes
-- `subscription_tier: "pro"` in hooks/use-business.ts (location-level
-- entitlements are the real source of truth) and `maxLocationsForTier` returns 1
-- while paid billing is off -- so under the pilot lock the client never attempts
-- a second location regardless. The premium=3 branch below is the server-side
-- correctness path for when that lock lifts; it is a superset of client
-- behavior, never a conflict.

DROP POLICY IF EXISTS "Owners can read their business locations" ON public.business_locations;
CREATE POLICY "Owners can read their business locations"
  ON public.business_locations FOR SELECT
  TO authenticated
  USING (public.user_owns_business(business_locations.business_id));

DROP POLICY IF EXISTS "Owners can insert their business locations" ON public.business_locations;
CREATE POLICY "Owners can insert their business locations"
  ON public.business_locations FOR INSERT
  TO authenticated
  WITH CHECK (
    public.user_owns_business(business_locations.business_id)
    AND public.business_location_count(business_locations.business_id)
        < public.location_cap_for_current_user()
  );

-- USING picks which rows may be updated; WITH CHECK re-tests the post-update
-- row, which is what stops an owner from re-pointing their location at someone
-- else's business_id.
DROP POLICY IF EXISTS "Owners can update their business locations" ON public.business_locations;
CREATE POLICY "Owners can update their business locations"
  ON public.business_locations FOR UPDATE
  TO authenticated
  USING (public.user_owns_business(business_locations.business_id))
  WITH CHECK (public.user_owns_business(business_locations.business_id));

DROP POLICY IF EXISTS "Owners can delete their business locations" ON public.business_locations;
CREATE POLICY "Owners can delete their business locations"
  ON public.business_locations FOR DELETE
  TO authenticated
  USING (public.user_owns_business(business_locations.business_id));
