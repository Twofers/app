-- Speed up the merchant dashboard "active claims" widget and the analytics rollups
-- that filter by (deal_id, claim_status). At 1000+ claims/day per cafe the existing
-- single-column indexes start to require sequential scans for status-filtered queries.

CREATE INDEX IF NOT EXISTS idx_deal_claims_deal_status
  ON public.deal_claims (deal_id, claim_status)
  WHERE claim_status IN ('active', 'redeeming');

COMMENT ON INDEX public.idx_deal_claims_deal_status
  IS 'Partial index supporting dashboard active-claims queries and the max_claims trigger''s recount.';
