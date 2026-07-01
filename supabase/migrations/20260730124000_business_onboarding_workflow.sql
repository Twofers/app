-- Add reviewed business onboarding workflow metadata to website intake.
-- This is additive and does not create mobile checkout, pricing links, or
-- subscription purchase surfaces.

BEGIN;

ALTER TABLE public.business_applications
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'website_business',
  ADD COLUMN IF NOT EXISTS access_tier text NOT NULL DEFAULT 'review_required',
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'in_progress',
  ADD COLUMN IF NOT EXISTS risk_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS risk_reasons text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS trial_days integer,
  ADD COLUMN IF NOT EXISTS trial_offer_limit integer,
  ADD COLUMN IF NOT EXISTS trial_claim_limit integer,
  ADD COLUMN IF NOT EXISTS field_invite_token_hash text,
  ADD COLUMN IF NOT EXISTS field_invite_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS field_invite_accepted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by uuid;

ALTER TABLE public.business_applications
  DROP CONSTRAINT IF EXISTS business_applications_status_check,
  ADD CONSTRAINT business_applications_status_check
    CHECK (status IN (
      'pending_review',
      'pending_verification',
      'review_required',
      'trial_limited',
      'trial_active',
      'approved_not_billed',
      'active',
      'waitlisted',
      'rejected',
      'suspended',
      'expired',
      'archived'
    ));

ALTER TABLE public.business_applications
  DROP CONSTRAINT IF EXISTS business_applications_access_tier_check,
  ADD CONSTRAINT business_applications_access_tier_check
    CHECK (access_tier IN (
      'pending_verification',
      'field_invited',
      'trial_limited',
      'trialing',
      'active',
      'review_required',
      'waitlisted',
      'rejected',
      'suspended',
      'expired'
    ));

ALTER TABLE public.business_applications
  DROP CONSTRAINT IF EXISTS business_applications_verification_status_check,
  ADD CONSTRAINT business_applications_verification_status_check
    CHECK (verification_status IN (
      'not_started',
      'in_progress',
      'verified_low_risk',
      'needs_review',
      'rejected',
      'waitlisted'
    ));

ALTER TABLE public.business_applications
  DROP CONSTRAINT IF EXISTS business_applications_trial_limits_check,
  ADD CONSTRAINT business_applications_trial_limits_check
    CHECK (
      (trial_days IS NULL OR trial_days BETWEEN 1 AND 120)
      AND (trial_offer_limit IS NULL OR trial_offer_limit BETWEEN 1 AND 10)
      AND (trial_claim_limit IS NULL OR trial_claim_limit BETWEEN 1 AND 500)
    );

CREATE INDEX IF NOT EXISTS idx_business_applications_access_tier_created_at
  ON public.business_applications(access_tier, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_applications_verification_created_at
  ON public.business_applications(verification_status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_applications_field_invite_token_hash
  ON public.business_applications(field_invite_token_hash)
  WHERE field_invite_token_hash IS NOT NULL;

COMMENT ON COLUMN public.business_applications.access_tier
  IS 'Reviewed onboarding tier used by website/admin workflows. Mobile billing/checkout is intentionally not exposed.';

COMMENT ON COLUMN public.business_applications.risk_reasons
  IS 'Deterministic intake reasons for admin review; do not store secrets, OTPs, or raw provider responses.';

COMMIT;
