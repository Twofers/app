-- Remove the untracked pilot-era cross-tenant read policy on
-- public.business_locations.
--
-- WHAT WAS FOUND (live catalog, approved test project, 2026-07-29)
--   pg_policies reports a PERMISSIVE SELECT policy that exists in no migration
--   in this repository:
--
--     tablename  = business_locations
--     policyname = 'Auth users can read business locations (pilot)'
--     cmd        = SELECT
--     roles      = {public}
--     qual       = (auth.uid() IS NOT NULL)
--
--   Permissive policies are OR'd, so this one defeats the owner-scoped
--   'Owners can read their business locations' policy
--   (USING user_owns_business(business_id)) that sits beside it. Behavioral
--   proof from scripts/db-tests/2c-rls-cross-tenant.mjs: owner A reads owner B's
--   business_locations row (HTTP 200, rows=1) while every other private table in
--   the same suite correctly returns zero rows.
--
-- WHY IT MATTERS
--   The nine granted columns are premises data — name, address, phone, lat, lng
--   plus ids and timestamps. Merchants publish that for live storefronts, so the
--   exposure is not consumer PII. The defect is that this policy ignores every
--   visibility rule the product deliberately enforces on `businesses`: the
--   public-status predicate (20260814120000), hidden businesses
--   (20260810120000), and suspension. Any signed-in account can therefore
--   enumerate the address and phone of businesses that are still pre-approval,
--   hidden, or suspended, and correlate them by business_id.
--
--   Anonymous callers are unaffected: the policy requires auth.uid() IS NOT
--   NULL, and a live anon probe against both projects returns [].
--
-- WHY REMOVAL IS SAFE
--   The owner-scoped SELECT policy remains, so merchants keep reading their own
--   locations. hooks/use-business-locations.ts and components/map/
--   map-native-screen.tsx read locations for the caller's own business.
--   Discovery for shoppers does not depend on this table: public browse goes
--   through public.nearby_businesses() / public.nearby_deals()
--   (20260802141000), which read businesses.{id,name,location,latitude,
--   longitude}. Service-role callers bypass RLS and are unaffected.
--
-- ROLLBACK
--   CREATE POLICY "Auth users can read business locations (pilot)"
--     ON public.business_locations FOR SELECT
--     USING (auth.uid() IS NOT NULL);
--
-- This migration drops one policy. It creates nothing, changes no grant, no
-- policy body, no function, no table shape, and touches no row.

BEGIN;

DROP POLICY IF EXISTS "Auth users can read business locations (pilot)"
  ON public.business_locations;

COMMIT;
