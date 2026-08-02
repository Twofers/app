-- Released claims are historical engagement records, not active inventory.
-- Keep every cap-counting surface aligned: the trigger is authoritative, the
-- edge function is a fast path, and deal_claim_counts powers customer UI.

CREATE OR REPLACE FUNCTION public.enforce_deal_max_claims()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  deal_max INTEGER;
  current_count INTEGER;
BEGIN
  -- Serialize concurrent inserts for the same deal before counting inventory.
  SELECT max_claims INTO deal_max
  FROM public.deals
  WHERE id = NEW.deal_id
  FOR UPDATE;

  -- NULL or <= 0 means unlimited (matches claim-deal).
  IF deal_max IS NULL OR deal_max <= 0 THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO current_count
  FROM public.deal_claims
  WHERE deal_id = NEW.deal_id
    AND claim_status NOT IN ('canceled', 'released');

  IF current_count >= deal_max THEN
    RAISE EXCEPTION 'MAX_CLAIMS_REACHED' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.deal_claim_counts(p_deal_ids uuid[])
RETURNS TABLE (deal_id uuid, claim_count integer)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
  SELECT dc.deal_id, count(*)::integer AS claim_count
  FROM public.deal_claims dc
  WHERE cardinality(p_deal_ids) <= 200  -- bound the IN-list; feed asks for <= 80
    AND dc.deal_id = ANY (p_deal_ids)
    AND dc.claim_status NOT IN ('canceled', 'released')
  GROUP BY dc.deal_id;
$$;

-- Re-assert execute grants after replacing the RPC definition.
REVOKE EXECUTE ON FUNCTION public.deal_claim_counts(uuid[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.deal_claim_counts(uuid[]) TO authenticated;

COMMENT ON FUNCTION public.deal_claim_counts(uuid[])
  IS 'Aggregate-only: non-canceled, non-released claim counts per deal id (max 200 ids). Used by the consumer feed and deal detail for scarcity/sold-out display.';
