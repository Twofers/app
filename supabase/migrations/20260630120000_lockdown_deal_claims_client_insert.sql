-- Lock down `deal_claims` client INSERTs.
-- Claim creation must go through edge function `supabase/functions/claim-deal`.
BEGIN;

DROP POLICY IF EXISTS "Users can insert their own claims"
  ON public.deal_claims;

COMMIT;

