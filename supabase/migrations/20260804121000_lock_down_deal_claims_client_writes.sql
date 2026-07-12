-- Finding 02 (money & trust audit): a customer can PATCH their own deal_claims
-- row directly to self-redeem (no staff, no timer, no location check), and can
-- even reverse a redeemed claim back to active and redeem it again, because no
-- migration in this repo ever revoked the default table-level INSERT/UPDATE
-- grant on deal_claims, and an end-user UPDATE policy (not present in any
-- migration -- prod drift, see findings/00-recon-notes.md) apparently exists
-- live to let begin/complete-visual-redeem and release-claim work at all.
--
-- Fix: every deal_claims write now goes through a service-role edge function
-- (claim-deal insert, redeem-token, the SECURITY DEFINER staff RPCs,
-- begin/complete-visual-redeem, release-claim -- all already moved to
-- supabaseAdmin in this same change). Clients get SELECT only.
--
-- DEPLOY ORDER: the edge functions in this change (begin-visual-redeem,
-- complete-visual-redeem, release-claim, redeem-token) must be deployed
-- BEFORE this migration is applied. Applying this migration first breaks
-- those flows until the functions ship, because they would still be
-- attempting to write deal_claims through the (now revoked) user-scoped grant.

BEGIN;

REVOKE INSERT, UPDATE, DELETE ON public.deal_claims FROM anon, authenticated;

-- Remove the out-of-band end-user UPDATE policy if it exists in prod (drift;
-- not present in any migration here, dropped defensively), plus the now-dead
-- business-owner UPDATE policy (owner redeem is service-role now via
-- redeem-token's supabaseAdmin client).
DROP POLICY IF EXISTS "Users can update their own claims" ON public.deal_claims;
DROP POLICY IF EXISTS "Businesses can update claims for their deals" ON public.deal_claims;

-- SELECT policies stay untouched:
--   "Users can read their own claims"            (auth.uid() = user_id)
--   "Businesses can read claims for their deals" (deal_claim_visible_to_business_owner)

COMMIT;
