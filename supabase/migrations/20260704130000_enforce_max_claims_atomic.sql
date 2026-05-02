-- Atomically enforce deals.max_claims on INSERT into deal_claims.
--
-- The claim-deal edge function does a SELECT-count followed by an INSERT with no
-- locking in between. Two concurrent claims at the cap boundary can both pass the
-- count check and both insert, overshooting the cap by N-1. This trigger locks
-- the parent deal row with FOR UPDATE during each INSERT, serializing concurrent
-- claim inserts per-deal so the count reflects every committed and in-flight
-- sibling. The edge function's pre-check is kept as a fast path; the trigger is
-- now the authoritative gate.

CREATE OR REPLACE FUNCTION enforce_deal_max_claims()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  deal_max INTEGER;
  current_count INTEGER;
BEGIN
  -- Lock the parent deal row for the duration of this transaction. Concurrent
  -- inserts for the same deal_id serialize here.
  SELECT max_claims INTO deal_max
  FROM deals
  WHERE id = NEW.deal_id
  FOR UPDATE;

  -- NULL or <= 0 means unlimited (matches the edge-function convention at
  -- supabase/functions/claim-deal/index.ts:483).
  IF deal_max IS NULL OR deal_max <= 0 THEN
    RETURN NEW;
  END IF;

  -- Count the same way the edge function counts: everything except 'canceled'.
  SELECT count(*) INTO current_count
  FROM deal_claims
  WHERE deal_id = NEW.deal_id
    AND claim_status != 'canceled';

  IF current_count >= deal_max THEN
    RAISE EXCEPTION 'MAX_CLAIMS_REACHED' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_deal_max_claims ON deal_claims;
CREATE TRIGGER trg_enforce_deal_max_claims
  BEFORE INSERT ON deal_claims
  FOR EACH ROW
  EXECUTE FUNCTION enforce_deal_max_claims();
