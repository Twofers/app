-- Allow reviewed website/admin onboarding to materialize a business server-side.
-- The client-side pilot invite gate remains in force for normal authenticated
-- users; Edge Functions using the service role already perform their own
-- authorization and audit checks before inserting business rows.

BEGIN;

CREATE OR REPLACE FUNCTION public.businesses_require_invite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(auth.role(), current_setting('request.jwt.claim.role', true), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.business_invite_validations
    WHERE user_id = COALESCE(NEW.owner_id, auth.uid())
  ) THEN
    RAISE EXCEPTION 'business invite required' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

COMMIT;
