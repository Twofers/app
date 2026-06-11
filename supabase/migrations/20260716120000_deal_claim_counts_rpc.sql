-- Consumer-visible total claim counts, for scarcity UI ("Only N left") and
-- pre-rendered sold-out states.
--
-- deal_claims RLS only lets a user read their OWN claims (plus business owners
-- reading claims on their deals), so a client-side count over deal_claims sees
-- at most the caller's single claim. The deal detail screen's existing
-- "claims remaining" line has therefore always been computed from that
-- under-count. This aggregate-only SECURITY DEFINER function exposes the true
-- per-deal totals — counts only, never claim rows or user ids.

CREATE OR REPLACE FUNCTION public.deal_claim_counts(p_deal_ids uuid[])
RETURNS TABLE (deal_id uuid, claim_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT dc.deal_id, count(*)::integer AS claim_count
  FROM public.deal_claims dc
  WHERE cardinality(p_deal_ids) <= 200  -- bound the IN-list; feed asks for <= 80
    AND dc.deal_id = ANY (p_deal_ids)
    AND dc.claim_status IS DISTINCT FROM 'canceled'  -- match claim-deal's cap counting
  GROUP BY dc.deal_id;
$$;

-- Supabase default privileges grant EXECUTE to anon on every new function,
-- and REVOKE FROM PUBLIC does not remove that explicit grant.
REVOKE EXECUTE ON FUNCTION public.deal_claim_counts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deal_claim_counts(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.deal_claim_counts(uuid[])
  IS 'Aggregate-only: non-canceled claim counts per deal id (max 200 ids). Used by the consumer feed and deal detail for scarcity/sold-out display.';
