-- Break RLS recursion between `deals` and `deal_claims`.
--
-- Policy "Users can read deals they claimed" on `deals` evaluates EXISTS (SELECT ... deal_claims).
-- For each candidate `deal_claims` row, Postgres also evaluates that table's SELECT policies,
-- including "Businesses can read claims for their deals", which subqueries `deals` again → infinite recursion.
--
-- Replace the business-owner branch with a SECURITY DEFINER helper that reads `deals`/`businesses`
-- with row_security disabled, so it does not re-enter `deals` RLS.

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
    WHERE d.id = p_deal_id
      AND b.owner_id = (SELECT auth.uid())
  );
$$;

REVOKE ALL ON FUNCTION public.deal_claim_visible_to_business_owner(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deal_claim_visible_to_business_owner(uuid) TO anon;
GRANT EXECUTE ON FUNCTION public.deal_claim_visible_to_business_owner(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.deal_claim_visible_to_business_owner(uuid) TO service_role;

DROP POLICY IF EXISTS "Businesses can read claims for their deals" ON public.deal_claims;
CREATE POLICY "Businesses can read claims for their deals"
  ON public.deal_claims FOR SELECT
  USING (public.deal_claim_visible_to_business_owner(deal_id));

DROP POLICY IF EXISTS "Businesses can update claims for their deals" ON public.deal_claims;
CREATE POLICY "Businesses can update claims for their deals"
  ON public.deal_claims FOR UPDATE
  USING (public.deal_claim_visible_to_business_owner(deal_id));
