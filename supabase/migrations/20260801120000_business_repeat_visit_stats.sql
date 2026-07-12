-- Return-path: redemption-confirmed repeat-visit stats for the business dashboard.
--
-- "Repeat customer" here means a customer with 2+ REDEEMED claims at this
-- business — an actual confirmed return, unlike the claims-based
-- new/returning split in merchant_business_insights. Aggregate counts only:
-- no user ids or per-customer rows leave the function. Access mirrors
-- business_saved_customers_count: owner or active business member, own
-- business only.

CREATE OR REPLACE FUNCTION public.business_repeat_visit_stats(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  r jsonb;
BEGIN
  SELECT b.owner_id INTO v_owner FROM public.businesses b WHERE b.id = p_business_id;
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_owner IS DISTINCT FROM auth.uid()
    AND NOT COALESCE(public.is_business_member(p_business_id), false)
  THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH per_customer AS (
    SELECT c.user_id, COUNT(*)::int AS redemptions
    FROM public.deal_claims c
    JOIN public.deals d ON d.id = c.deal_id
    WHERE d.business_id = p_business_id
      AND c.redeemed_at IS NOT NULL
    GROUP BY c.user_id
  )
  SELECT jsonb_build_object(
    'redeemed_customers', COUNT(*)::int,
    'repeat_customers', COUNT(*) FILTER (WHERE redemptions >= 2)::int,
    'total_redemptions', COALESCE(SUM(redemptions), 0)::int,
    'repeat_redemptions', COALESCE(SUM(redemptions) FILTER (WHERE redemptions >= 2), 0)::int
  )
  INTO r
  FROM per_customer;

  RETURN r;
END;
$$;

REVOKE ALL ON FUNCTION public.business_repeat_visit_stats(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.business_repeat_visit_stats(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.business_repeat_visit_stats(uuid) TO authenticated;
