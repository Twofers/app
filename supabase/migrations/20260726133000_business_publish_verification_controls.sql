-- Dormant-by-default business verification gate for live publishing.

ALTER TABLE public.app_runtime_config
  ADD COLUMN IF NOT EXISTS business_verification_required_for_publish boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.app_runtime_config.business_verification_required_for_publish IS
  'When true, server-owned publish paths require a verified business location or active billing-backed verification.';

CREATE OR REPLACE FUNCTION public.get_business_verification_required_for_publish()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT COALESCE(
    (SELECT business_verification_required_for_publish FROM public.app_runtime_config WHERE id = 1),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.is_business_location_publish_verified(
  p_business_location_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_required boolean;
BEGIN
  SELECT public.get_business_verification_required_for_publish()
    INTO v_required;

  IF NOT COALESCE(v_required, false) THEN
    RETURN true;
  END IF;

  PERFORM public.refresh_business_location_identity(p_business_location_id);

  RETURN EXISTS (
    SELECT 1
    FROM public.business_location_identity bli
    WHERE bli.business_location_id = p_business_location_id
      AND bli.verification_status = 'verified'
  )
  OR EXISTS (
    SELECT 1
    FROM public.location_entitlements le
    WHERE le.business_location_id = p_business_location_id
      AND le.status IN (
        'trial_active',
        'trial_canceling',
        'pro_active',
        'pro_canceling',
        'paid_active',
        'paid_canceling',
        'admin_trial_active'
      )
      AND le.entitlement_provider IN ('stripe', 'admin_grant')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_business_verification_required_for_publish() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_business_location_publish_verified(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.get_business_verification_required_for_publish() TO service_role;
GRANT EXECUTE ON FUNCTION public.is_business_location_publish_verified(uuid) TO service_role;

COMMENT ON FUNCTION public.is_business_location_publish_verified(uuid) IS
  'Returns whether a business location can publish live deals when the runtime verification gate is enabled.';
