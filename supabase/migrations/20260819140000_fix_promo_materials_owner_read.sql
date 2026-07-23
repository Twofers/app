-- Fix: business owners could not read their own promotional-materials consent.
--
-- 20260819130000 gated the SELECT policy on public.is_business_member() alone,
-- which resolves ONLY through public.business_members. It never consults
-- businesses.owner_id. Owners who have no membership row therefore could not
-- read their own consent history.
--
-- That is not a hypothetical: app/business-setup.tsx creates a business with a
-- bare `insert({ owner_id, ... })` and never writes business_members. (The
-- other onboarding path, claim_approved_business_application_for_user, does
-- insert one -- which is why the gap only affects some owners.)
--
-- Symptom: such an owner authorizes successfully (the edge function writes with
-- the service role, so the row lands), but the Account settings status read
-- returns zero rows and the toggle shows "Not authorized" forever.
--
-- Caught by scripts/db-tests/2h-promo-materials-authorization.mjs, which asserts
-- the owner CAN read their row as the precondition for the cross-tenant leak
-- check -- "the other tenant sees nothing" only means something when there is
-- something to see.

-- Ownership test for RLS. Must be SECURITY DEFINER: `authenticated` holds no
-- SELECT grant on public.businesses (20260705120000 replaced it with
-- column-level grants), so a policy that read the table directly would deny
-- rather than allow.
--
-- Deliberately identical to the definition in
-- 20260819120000_fix_business_locations_owner_rls_and_fk.sql, which lives on a
-- separate workstream. CREATE OR REPLACE is idempotent and the two bodies are
-- byte-identical, so whichever applies second is a no-op. Duplicated rather
-- than depended upon so this migration stands alone if the two are ever applied
-- out of order or replayed onto a fresh database.
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

-- Add the owner check the original policy omitted. Membership and admin arms
-- are unchanged; this only widens SELECT to the business's own owner, and only
-- for rows belonging to a business they own. COALESCE on every arm per the
-- RESTRICTIVE-policy NULL incident.
DROP POLICY IF EXISTS promo_materials_authorizations_member_read ON public.promo_materials_authorizations;
CREATE POLICY promo_materials_authorizations_member_read
  ON public.promo_materials_authorizations FOR SELECT
  TO authenticated
  USING (
    COALESCE(public.user_owns_business(business_id), false)
    OR COALESCE(public.is_business_member(business_id), false)
    OR COALESCE(public.admin_can('business.read'), false)
  );

-- Unchanged and restated for clarity: still SELECT-only for authenticated.
-- Writes continue to go exclusively through the service-role edge functions,
-- and no role holds DELETE, so consent history remains append-only.
