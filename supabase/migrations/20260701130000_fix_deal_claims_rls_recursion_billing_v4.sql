-- Fix RLS infinite recursion on deal_claims introduced by billing_v4 migration.
--
-- The billing_v4 migration (20260601153000) replaced the SECURITY DEFINER
-- helper `deal_claim_visible_to_business_owner` with an inline JOIN policy
-- on deal_claims that subqueries `deals`. Because `deals` has a SELECT policy
-- "Users can read deals they claimed" that subqueries `deal_claims`, this
-- creates infinite RLS recursion.
--
-- Fix: re-create the SECURITY DEFINER helper (now including the subscription
-- status check from billing_v4) and use it in the policy.

-- 1) Re-create the SECURITY DEFINER helper with subscription gating
CREATE OR REPLACE FUNCTION public.deal_claim_visible_to_business_owner(p_deal_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.deals d
    JOIN public.businesses b ON b.id = d.business_id
    JOIN public.business_profiles bp
      ON (bp.user_id = b.owner_id OR bp.owner_id = b.owner_id)
    WHERE d.id = p_deal_id
      AND b.owner_id = (SELECT auth.uid())
      AND bp.subscription_status IN ('trial', 'active')
  );
$$;

REVOKE ALL ON FUNCTION public.deal_claim_visible_to_business_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deal_claim_visible_to_business_owner(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.deal_claim_visible_to_business_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deal_claim_visible_to_business_owner(uuid) TO service_role;

-- 2) Replace the recursive inline-JOIN policy with the helper
DROP POLICY IF EXISTS "Businesses can read claims for their deals" ON public.deal_claims;
CREATE POLICY "Businesses can read claims for their deals"
  ON public.deal_claims FOR SELECT
  USING (public.deal_claim_visible_to_business_owner(deal_id));

-- 3) Also fix the UPDATE policy (was set in the original 20260330 migration,
--    may have been dropped or overridden)
DROP POLICY IF EXISTS "Businesses can update claims for their deals" ON public.deal_claims;
CREATE POLICY "Businesses can update claims for their deals"
  ON public.deal_claims FOR UPDATE
  USING (public.deal_claim_visible_to_business_owner(deal_id));
