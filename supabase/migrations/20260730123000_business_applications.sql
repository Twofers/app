-- Public business access requests for web-only onboarding.
-- Apply only after approval; this migration is additive and does not touch
-- existing merchant, billing, claim, or deal rows.

BEGIN;

CREATE TABLE IF NOT EXISTS public.business_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_name text NOT NULL,
  contact_name text NOT NULL,
  email text NOT NULL,
  phone text,
  address text,
  business_type text,
  website_or_instagram text,
  slow_hours text,
  offer_interests text,
  launch_area text,
  terms_accepted boolean NOT NULL DEFAULT false,
  privacy_acknowledged boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'pending_review'
    CHECK (status IN ('pending_review','approved_not_billed','trial_active','active','rejected','archived')),
  admin_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_applications_status_created_at
  ON public.business_applications(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_applications_email_created_at
  ON public.business_applications(lower(email), created_at DESC);

CREATE OR REPLACE FUNCTION public.set_business_applications_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS business_applications_set_updated_at ON public.business_applications;
CREATE TRIGGER business_applications_set_updated_at
  BEFORE UPDATE ON public.business_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.set_business_applications_updated_at();

ALTER TABLE public.business_applications ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.business_applications FROM anon, authenticated;

COMMENT ON TABLE public.business_applications
  IS 'Web-submitted business access requests. Public users submit through the submit-business-application Edge Function; client roles cannot read applications.';

COMMIT;
