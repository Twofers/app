-- Track when claim_status last changed (audit trail for fraud detection).
ALTER TABLE deal_claims
  ADD COLUMN IF NOT EXISTS status_changed_at TIMESTAMPTZ;

-- Backfill: existing active claims get created_at, redeemed claims get redeemed_at.
UPDATE deal_claims SET status_changed_at = redeemed_at WHERE claim_status = 'redeemed' AND redeemed_at IS NOT NULL;
UPDATE deal_claims SET status_changed_at = created_at WHERE status_changed_at IS NULL;

-- Auto-update on every status change.
CREATE OR REPLACE FUNCTION set_claim_status_changed_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.claim_status IS DISTINCT FROM OLD.claim_status THEN
    NEW.status_changed_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_claim_status_changed ON deal_claims;
CREATE TRIGGER trg_claim_status_changed
  BEFORE UPDATE ON deal_claims
  FOR EACH ROW
  EXECUTE FUNCTION set_claim_status_changed_at();
