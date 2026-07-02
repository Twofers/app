-- Return-path phase 1: business-facing "saved customers" count.
--
-- Businesses cannot read the favorites table directly (RLS scopes rows to the
-- favoriting user), so this SECURITY DEFINER RPC exposes an aggregate count only:
-- no user ids, timestamps, or any per-customer data. Access mirrors
-- merchant_business_insights: the business owner (or an active business member)
-- may read the count for their own business only.

CREATE OR REPLACE FUNCTION public.business_saved_customers_count(p_business_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_count integer;
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

  SELECT COUNT(*)::int INTO v_count
  FROM public.favorites f
  WHERE f.business_id = p_business_id;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.business_saved_customers_count(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.business_saved_customers_count(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.business_saved_customers_count(uuid) TO authenticated;
