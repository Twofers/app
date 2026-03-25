-- Launch: visual redeem lifecycle, claim metadata for analytics, consumer birthdate, append-only events.

-- --- Consumer profile: birthday (age_range optional for legacy rows)
ALTER TABLE public.consumer_profiles
  DROP CONSTRAINT IF EXISTS consumer_profiles_age_range_check;

ALTER TABLE public.consumer_profiles
  ALTER COLUMN age_range DROP NOT NULL;

ALTER TABLE public.consumer_profiles
  ADD CONSTRAINT consumer_profiles_age_range_check CHECK (
    age_range IS NULL
    OR age_range IN (
      'under_18',
      '18_24',
      '25_34',
      '35_44',
      '45_54',
      '55_64',
      '65_plus'
    )
  );

ALTER TABLE public.consumer_profiles
  ADD COLUMN IF NOT EXISTS birthdate DATE;

COMMENT ON COLUMN public.consumer_profiles.birthdate IS 'Consumer DOB; age bands for analytics are derived in app/Edge, not shown raw to merchants';

-- --- deal_claims: status, redeem lifecycle, optional analytics snapshot at claim
ALTER TABLE public.deal_claims
  ADD COLUMN IF NOT EXISTS claim_status TEXT DEFAULT 'active';

UPDATE public.deal_claims
SET claim_status = 'redeemed'
WHERE redeemed_at IS NOT NULL;

UPDATE public.deal_claims
SET claim_status = 'expired'
WHERE redeemed_at IS NULL
  AND expires_at < NOW()
  AND (claim_status IS NULL OR claim_status = 'active');

UPDATE public.deal_claims
SET claim_status = 'active'
WHERE claim_status IS NULL;

ALTER TABLE public.deal_claims
  ALTER COLUMN claim_status SET NOT NULL;

ALTER TABLE public.deal_claims
  DROP CONSTRAINT IF EXISTS deal_claims_claim_status_check;

ALTER TABLE public.deal_claims
  ADD CONSTRAINT deal_claims_claim_status_check CHECK (
    claim_status IN ('active', 'redeeming', 'redeemed', 'expired', 'canceled')
  );

ALTER TABLE public.deal_claims
  ADD COLUMN IF NOT EXISTS redeem_started_at TIMESTAMPTZ;

ALTER TABLE public.deal_claims
  ADD COLUMN IF NOT EXISTS redeem_method TEXT;

ALTER TABLE public.deal_claims
  DROP CONSTRAINT IF EXISTS deal_claims_redeem_method_check;

ALTER TABLE public.deal_claims
  ADD CONSTRAINT deal_claims_redeem_method_check CHECK (
    redeem_method IS NULL OR redeem_method IN ('visual', 'qr')
  );

ALTER TABLE public.deal_claims
  ADD COLUMN IF NOT EXISTS grace_period_minutes INTEGER NOT NULL DEFAULT 10;

ALTER TABLE public.deal_claims
  ADD COLUMN IF NOT EXISTS acquisition_source TEXT;

ALTER TABLE public.deal_claims
  ADD COLUMN IF NOT EXISTS age_band_at_claim TEXT;

ALTER TABLE public.deal_claims
  ADD COLUMN IF NOT EXISTS zip_at_claim TEXT;

ALTER TABLE public.deal_claims
  ADD COLUMN IF NOT EXISTS location_source_at_claim TEXT;

ALTER TABLE public.deal_claims
  ADD COLUMN IF NOT EXISTS app_version_at_claim TEXT;

ALTER TABLE public.deal_claims
  ADD COLUMN IF NOT EXISTS device_platform_at_claim TEXT;

ALTER TABLE public.deal_claims
  ADD COLUMN IF NOT EXISTS session_id_at_claim TEXT;

COMMENT ON COLUMN public.deal_claims.claim_status IS 'active | redeeming | redeemed | expired | canceled';
COMMENT ON COLUMN public.deal_claims.redeem_method IS 'visual (customer pass) or qr (staff scan), set when redeemed';

-- --- Append-only product analytics (no merchant SELECT in app; internal use / future aggregates)
CREATE TABLE IF NOT EXISTS public.app_analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  user_id UUID REFERENCES auth.users (id) ON DELETE SET NULL,
  business_id UUID REFERENCES public.businesses (id) ON DELETE SET NULL,
  deal_id UUID REFERENCES public.deals (id) ON DELETE SET NULL,
  claim_id UUID REFERENCES public.deal_claims (id) ON DELETE SET NULL,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  app_version TEXT,
  device_platform TEXT
);

CREATE INDEX IF NOT EXISTS idx_app_analytics_events_user_occurred
  ON public.app_analytics_events (user_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_analytics_events_name_occurred
  ON public.app_analytics_events (event_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_analytics_events_deal_occurred
  ON public.app_analytics_events (deal_id, occurred_at DESC);

ALTER TABLE public.app_analytics_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app_analytics_events_insert_own" ON public.app_analytics_events;

CREATE POLICY "app_analytics_events_insert_own"
  ON public.app_analytics_events FOR INSERT
  WITH CHECK (auth.uid() = user_id);
