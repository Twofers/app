-- Prevent duplicate active claims per (user, deal).
--
-- Before: claim-deal checked "is null redeemed_at" then inserted, but two concurrent
-- requests from the same user (e.g. double-tap claim button) both passed the check and
-- inserted. The edge function's "23505 -> already have an active claim" branch was
-- relying on a constraint that didn't exist.
--
-- This is a partial unique index so it only constrains active/redeeming rows. Canceled
-- and expired claims can pile up indefinitely (existing canceled rows are preserved).

-- Pre-check: refuse to apply if existing data violates the constraint.
DO $$
DECLARE
  v_dupes integer;
BEGIN
  SELECT count(*)
    INTO v_dupes
    FROM (
      SELECT user_id, deal_id, count(*) AS n
        FROM public.deal_claims
        WHERE claim_status IN ('active', 'redeeming')
        GROUP BY user_id, deal_id
        HAVING count(*) > 1
    ) AS dupes;

  IF v_dupes > 0 THEN
    RAISE EXCEPTION
      'Cannot create unique index: % (user_id, deal_id) pairs have duplicate active/redeeming claims. Clean up before applying this migration.',
      v_dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS deal_claims_one_active_per_user_deal
  ON public.deal_claims (user_id, deal_id)
  WHERE claim_status IN ('active', 'redeeming');

COMMENT ON INDEX public.deal_claims_one_active_per_user_deal
  IS 'Prevents the same user from holding multiple active or redeeming claims on the same deal. Enforced at the DB level so concurrent double-tap claims fail cleanly with SQLSTATE 23505.';
