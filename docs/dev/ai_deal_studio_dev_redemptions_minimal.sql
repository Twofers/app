-- Dev-only minimal redemptions table for offer-version foreign keys.
-- This avoids pulling redemption-mode/staff-session migrations into AI Studio setup.

CREATE TABLE IF NOT EXISTS public.redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid REFERENCES public.deal_claims(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  redeemed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_redemptions_claim_id
  ON public.redemptions(claim_id);

CREATE INDEX IF NOT EXISTS idx_redemptions_deal_id
  ON public.redemptions(deal_id);

CREATE INDEX IF NOT EXISTS idx_redemptions_business_redeemed_at
  ON public.redemptions(business_id, redeemed_at DESC);

ALTER TABLE public.redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Business owners can read their redemptions" ON public.redemptions;
CREATE POLICY "Business owners can read their redemptions"
  ON public.redemptions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.businesses b
      WHERE b.id = redemptions.business_id
        AND b.owner_id = auth.uid()
    )
  );
