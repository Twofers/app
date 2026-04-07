-- Prevent race condition where concurrent claim requests bypass the
-- "one active claim at a time" check (TOCTOU in claim-deal edge function).
-- If two concurrent INSERTs both try to create an active claim for the same
-- user, the partial unique index causes the second to fail with a unique
-- violation, which the retry loop in claim-deal handles gracefully.

CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_claims_one_active_per_user
  ON deal_claims (user_id)
  WHERE claim_status = 'active' AND redeemed_at IS NULL;
