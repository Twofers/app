-- Internal admin dashboard foundation.
-- This is additive and web/admin-only. It does not add mobile billing,
-- checkout links, pricing screens, Apple Pay, or Google Pay.

BEGIN;

CREATE TABLE IF NOT EXISTS public.admin_users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL UNIQUE,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'support', 'sales', 'finance', 'moderator', 'developer', 'read_only')),
  is_active boolean NOT NULL DEFAULT true,
  require_mfa boolean NOT NULL DEFAULT true,
  display_name text,
  last_admin_login_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_email text,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id uuid,
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  before_value jsonb,
  after_value jsonb,
  reason text,
  ip_address text,
  user_agent text,
  request_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.admin_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note_type text NOT NULL DEFAULT 'general',
  body text NOT NULL,
  visibility text NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal', 'merchant_visible')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.launch_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  city text,
  state text,
  country text NOT NULL DEFAULT 'US',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'waitlist', 'disabled')),
  center_lat numeric,
  center_lng numeric,
  radius_miles numeric,
  timezone text NOT NULL DEFAULT 'America/Chicago',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.feature_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  description text,
  enabled boolean NOT NULL DEFAULT false,
  rules jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.system_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'error', 'critical')),
  source text NOT NULL,
  message text,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending_verification',
  ADD COLUMN IF NOT EXISTS access_level text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS verification_status text NOT NULL DEFAULT 'not_started',
  ADD COLUMN IF NOT EXISTS launch_area_id uuid REFERENCES public.launch_areas(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS website_url text,
  ADD COLUMN IF NOT EXISTS instagram_url text,
  ADD COLUMN IF NOT EXISTS public_email text,
  ADD COLUMN IF NOT EXISTS address_line1 text,
  ADD COLUMN IF NOT EXISTS address_line2 text,
  ADD COLUMN IF NOT EXISTS city text,
  ADD COLUMN IF NOT EXISTS state text,
  ADD COLUMN IF NOT EXISTS postal_code text,
  ADD COLUMN IF NOT EXISTS country text DEFAULT 'US',
  ADD COLUMN IF NOT EXISTS risk_score numeric,
  ADD COLUMN IF NOT EXISTS risk_level text,
  ADD COLUMN IF NOT EXISTS can_publish_cached boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS first_approved_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suspension_reason text,
  ADD COLUMN IF NOT EXISTS admin_notes text,
  ADD COLUMN IF NOT EXISTS source text;

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_status_check,
  ADD CONSTRAINT businesses_status_check
    CHECK (status IN (
      'draft',
      'pending_verification',
      'limited_trial',
      'trialing',
      'active',
      'past_due',
      'trial_expired',
      'canceled',
      'rejected',
      'suspended',
      'disabled',
      'archived'
    ));

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_access_level_check,
  ADD CONSTRAINT businesses_access_level_check
    CHECK (access_level IN (
      'none',
      'pending',
      'limited_trial',
      'full_trial',
      'paid',
      'admin_comped',
      'partner_comped',
      'internal_test'
    ));

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_verification_status_check,
  ADD CONSTRAINT businesses_verification_status_check
    CHECK (verification_status IN (
      'not_started',
      'email_verified',
      'phone_verified',
      'basic_verified',
      'ai_verified',
      'manual_verified',
      'failed',
      'needs_more_info'
    ));

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_risk_level_check,
  ADD CONSTRAINT businesses_risk_level_check
    CHECK (risk_level IS NULL OR risk_level IN ('low', 'medium', 'high', 'blocked'));

CREATE INDEX IF NOT EXISTS idx_admin_users_role_active
  ON public.admin_users(role, is_active);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_created
  ON public.admin_audit_log(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_admin_audit_log_business_created
  ON public.admin_audit_log(business_id, created_at DESC)
  WHERE business_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_admin_notes_business_created
  ON public.admin_notes(business_id, created_at DESC)
  WHERE business_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_businesses_admin_status_updated
  ON public.businesses(status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_businesses_launch_area_status
  ON public.businesses(launch_area_id, status)
  WHERE launch_area_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_admin_dashboard_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS admin_users_set_updated_at ON public.admin_users;
CREATE TRIGGER admin_users_set_updated_at
  BEFORE UPDATE ON public.admin_users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_admin_dashboard_updated_at();

DROP TRIGGER IF EXISTS launch_areas_set_updated_at ON public.launch_areas;
CREATE TRIGGER launch_areas_set_updated_at
  BEFORE UPDATE ON public.launch_areas
  FOR EACH ROW
  EXECUTE FUNCTION public.set_admin_dashboard_updated_at();

DROP TRIGGER IF EXISTS feature_flags_set_updated_at ON public.feature_flags;
CREATE TRIGGER feature_flags_set_updated_at
  BEFORE UPDATE ON public.feature_flags
  FOR EACH ROW
  EXECUTE FUNCTION public.set_admin_dashboard_updated_at();

CREATE OR REPLACE FUNCTION public.admin_role()
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.admin_users
  WHERE id = auth.uid()
    AND is_active = true
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.admin_role() IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.is_owner_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.admin_role() = 'owner';
$$;

CREATE OR REPLACE FUNCTION public.admin_can(p_permission text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := public.admin_role();
  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  IF v_role = 'owner' THEN
    RETURN true;
  END IF;

  IF p_permission IN ('admin.read', 'business.read', 'trial_request.read', 'offer.read', 'audit.read') THEN
    RETURN v_role IN ('admin', 'support', 'sales', 'finance', 'moderator', 'developer', 'read_only');
  END IF;

  IF p_permission IN ('business.approve', 'business.reject', 'trial.extend', 'offer.moderate') THEN
    RETURN v_role IN ('admin', 'moderator');
  END IF;

  IF p_permission IN ('billing.read', 'billing.portal') THEN
    RETURN v_role IN ('admin', 'finance');
  END IF;

  IF p_permission = 'support.write' THEN
    RETURN v_role IN ('admin', 'support');
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_business_publish(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_business record;
  v_entitlement record;
  v_now timestamptz := now();
  v_can_publish boolean := false;
  v_reason text := 'not_authorized';
  v_limits jsonb := jsonb_build_object(
    'maxActiveOffers', 0,
    'maxClaimsPerOffer', 0,
    'canNotifyNearbyUsers', false,
    'requiresOfferReview', true
  );
BEGIN
  SELECT id, status, access_level, can_publish_cached
    INTO v_business
  FROM public.businesses
  WHERE id = p_business_id;

  IF v_business.id IS NULL THEN
    RETURN jsonb_build_object('canPublish', false, 'reason', 'not_authorized', 'limits', v_limits);
  END IF;

  IF COALESCE(auth.role(), '') <> 'service_role'
    AND NOT public.is_admin()
    AND NOT EXISTS (
      SELECT 1
      FROM public.businesses owner_check
      WHERE owner_check.id = p_business_id
        AND owner_check.owner_id = auth.uid()
    )
  THEN
    RETURN jsonb_build_object('canPublish', false, 'reason', 'not_authorized', 'limits', v_limits);
  END IF;

  IF v_business.status IN ('suspended', 'disabled', 'rejected', 'archived') THEN
    RETURN jsonb_build_object('canPublish', false, 'reason', v_business.status, 'limits', v_limits);
  END IF;

  SELECT le.status, le.trial_ends_at, le.current_period_ends_at, le.suspended_at
    INTO v_entitlement
  FROM public.business_locations bl
  JOIN public.location_entitlements le
    ON le.business_location_id = bl.id
  WHERE bl.business_id = p_business_id
  ORDER BY
    CASE
      WHEN le.status IN ('paid_active', 'pro_active') THEN 0
      WHEN le.status IN ('trial_active', 'admin_trial_active') THEN 1
      ELSE 2
    END,
    le.updated_at DESC
  LIMIT 1;

  IF v_entitlement.suspended_at IS NOT NULL THEN
    v_reason := 'suspended';
  ELSIF v_business.access_level IN ('admin_comped', 'partner_comped', 'internal_test') THEN
    v_can_publish := true;
    v_reason := CASE v_business.access_level
      WHEN 'admin_comped' THEN 'admin_comped'
      WHEN 'partner_comped' THEN 'partner_comped'
      ELSE 'active_trial'
    END;
    v_limits := jsonb_build_object('maxActiveOffers', 3, 'maxClaimsPerOffer', 50, 'canNotifyNearbyUsers', true, 'requiresOfferReview', false);
  ELSIF v_entitlement.status IN ('paid_active', 'pro_active') THEN
    v_can_publish := true;
    v_reason := 'active_paid';
    v_limits := jsonb_build_object('maxActiveOffers', 3, 'maxClaimsPerOffer', 100, 'canNotifyNearbyUsers', true, 'requiresOfferReview', false);
  ELSIF v_entitlement.status IN ('trial_active', 'admin_trial_active') AND COALESCE(v_entitlement.trial_ends_at, v_entitlement.current_period_ends_at, v_now + interval '1 second') > v_now THEN
    v_can_publish := true;
    v_reason := CASE
      WHEN v_business.access_level = 'limited_trial' THEN 'limited_trial'
      ELSE 'active_trial'
    END;
    v_limits := CASE
      WHEN v_business.access_level = 'limited_trial'
        THEN jsonb_build_object('maxActiveOffers', 1, 'maxClaimsPerOffer', 25, 'canNotifyNearbyUsers', false, 'requiresOfferReview', true)
      ELSE jsonb_build_object('maxActiveOffers', 3, 'maxClaimsPerOffer', 50, 'canNotifyNearbyUsers', true, 'requiresOfferReview', false)
    END;
  ELSIF v_business.status = 'pending_verification' THEN
    v_reason := 'pending_verification';
  ELSIF v_business.status = 'trial_expired' OR v_entitlement.status IN ('trial_expired_suspended', 'admin_trial_expired_suspended') THEN
    v_reason := 'trial_expired';
  ELSIF v_entitlement.status IN ('payment_failed_suspended', 'canceled_suspended', 'refunded_suspended') THEN
    v_reason := 'payment_failed';
  END IF;

  RETURN jsonb_build_object('canPublish', v_can_publish, 'reason', v_reason, 'limits', v_limits);
END;
$$;

ALTER TABLE public.admin_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.launch_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_users_owner_read ON public.admin_users;
CREATE POLICY admin_users_owner_read
  ON public.admin_users FOR SELECT
  TO authenticated
  USING (public.is_owner_admin() OR id = auth.uid());

DROP POLICY IF EXISTS admin_users_owner_update ON public.admin_users;
CREATE POLICY admin_users_owner_update
  ON public.admin_users FOR UPDATE
  TO authenticated
  USING (public.is_owner_admin())
  WITH CHECK (public.is_owner_admin());

DROP POLICY IF EXISTS active_admins_read_audit ON public.admin_audit_log;
CREATE POLICY active_admins_read_audit
  ON public.admin_audit_log FOR SELECT
  TO authenticated
  USING (public.admin_can('audit.read'));

DROP POLICY IF EXISTS active_admins_read_notes ON public.admin_notes;
CREATE POLICY active_admins_read_notes
  ON public.admin_notes FOR SELECT
  TO authenticated
  USING (public.admin_can('business.read'));

DROP POLICY IF EXISTS active_admins_read_launch_areas ON public.launch_areas;
CREATE POLICY active_admins_read_launch_areas
  ON public.launch_areas FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS active_admins_read_feature_flags ON public.feature_flags;
CREATE POLICY active_admins_read_feature_flags
  ON public.feature_flags FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS active_admins_read_system_events ON public.system_events;
CREATE POLICY active_admins_read_system_events
  ON public.system_events FOR SELECT
  TO authenticated
  USING (public.is_admin());

REVOKE ALL ON TABLE public.admin_users FROM anon, authenticated;
REVOKE ALL ON TABLE public.admin_audit_log FROM anon, authenticated;
REVOKE ALL ON TABLE public.admin_notes FROM anon, authenticated;
REVOKE ALL ON TABLE public.launch_areas FROM anon, authenticated;
REVOKE ALL ON TABLE public.feature_flags FROM anon, authenticated;
REVOKE ALL ON TABLE public.system_events FROM anon, authenticated;

GRANT SELECT ON TABLE public.admin_users TO authenticated;
GRANT SELECT ON TABLE public.admin_audit_log TO authenticated;
GRANT SELECT ON TABLE public.admin_notes TO authenticated;
GRANT SELECT ON TABLE public.launch_areas TO authenticated;
GRANT SELECT ON TABLE public.feature_flags TO authenticated;
GRANT SELECT ON TABLE public.system_events TO authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.admin_users TO service_role;
GRANT SELECT, INSERT ON TABLE public.admin_audit_log TO service_role;
GRANT SELECT, INSERT ON TABLE public.admin_notes TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.launch_areas TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.feature_flags TO service_role;
GRANT SELECT, INSERT ON TABLE public.system_events TO service_role;

REVOKE ALL ON FUNCTION public.admin_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_owner_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_can(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_business_publish(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.admin_role() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_owner_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_can(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_business_publish(uuid) TO authenticated, service_role;

COMMENT ON TABLE public.admin_users
  IS 'Internal Twofer admin allowlist. Dashboard access must also be checked by server-side admin functions.';

COMMENT ON TABLE public.admin_audit_log
  IS 'Immutable append-only audit log for sensitive web/admin actions. Normal admin UI must not delete rows.';

COMMENT ON FUNCTION public.can_business_publish(uuid)
  IS 'Central publish eligibility helper for admin, web, server publishing, and mobile business flows.';

COMMIT;
