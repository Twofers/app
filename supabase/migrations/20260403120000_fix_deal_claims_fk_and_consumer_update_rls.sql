-- Fix missing FK constraints on deal_claims.
-- The initial migration used CREATE TABLE IF NOT EXISTS, which was a no-op
-- if the table already existed without these FKs.

ALTER TABLE public.deal_claims
  DROP CONSTRAINT IF EXISTS deal_claims_deal_id_fkey;

ALTER TABLE public.deal_claims
  ADD CONSTRAINT deal_claims_deal_id_fkey
  FOREIGN KEY (deal_id) REFERENCES public.deals(id) ON DELETE CASCADE;

ALTER TABLE public.deal_claims
  DROP CONSTRAINT IF EXISTS deal_claims_user_id_fkey;

ALTER TABLE public.deal_claims
  ADD CONSTRAINT deal_claims_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

-- Allow consumers to update their own claims (needed for visual redeem flow).
-- Without this, begin-visual-redeem and complete-visual-redeem fail because
-- the consumer cannot update claim_status on their own rows.

DROP POLICY IF EXISTS users_update_own_claims ON public.deal_claims;
CREATE POLICY users_update_own_claims
  ON public.deal_claims FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Refresh PostgREST schema cache so the new FK is picked up for joins.
NOTIFY pgrst, 'reload schema';
