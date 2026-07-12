-- Website-to-app business onboarding sync.
-- Additive only: website intake, mobile business setup, and admin dashboard all
-- share public.businesses as the app-visible merchant profile.

BEGIN;

ALTER TABLE public.business_applications
  ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS onboarding_request_id uuid;

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS source_onboarding_request_id uuid,
  ADD COLUMN IF NOT EXISTS current_profile_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS profile_completion_score integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_profile_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_sensitive_edit_at timestamptz;

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_profile_completion_score_check,
  ADD CONSTRAINT businesses_profile_completion_score_check
    CHECK (profile_completion_score BETWEEN 0 AND 100);

CREATE TABLE IF NOT EXISTS public.business_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_email text NOT NULL,
  display_name text,
  role text NOT NULL DEFAULT 'pending_owner',
  status text NOT NULL DEFAULT 'invited',
  source text NOT NULL DEFAULT 'website_signup',
  linked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (role IN ('owner', 'pending_owner', 'manager', 'staff', 'redeemer')),
  CHECK (status IN ('invited', 'active', 'disabled', 'removed'))
);

CREATE UNIQUE INDEX IF NOT EXISTS business_members_business_invited_email_key
  ON public.business_members(business_id, invited_email);

CREATE INDEX IF NOT EXISTS idx_business_members_business_invited_email_lower
  ON public.business_members(business_id, lower(invited_email));

CREATE UNIQUE INDEX IF NOT EXISTS business_members_business_user_key
  ON public.business_members(business_id, user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_members_user_id
  ON public.business_members(user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_members_invited_email
  ON public.business_members(lower(invited_email));

CREATE TABLE IF NOT EXISTS public.business_onboarding_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  application_id uuid REFERENCES public.business_applications(id) ON DELETE SET NULL,
  request_type text NOT NULL DEFAULT 'remote',
  source text NOT NULL DEFAULT 'website',
  submitted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  owner_name text,
  owner_email text NOT NULL,
  phone text,
  business_name text NOT NULL,
  business_address text,
  business_type text,
  website_or_instagram text,
  best_slow_hours text,
  promote_text text,
  launch_area_confirmed boolean,
  accepted_business_terms boolean NOT NULL DEFAULT false,
  accepted_privacy_policy boolean NOT NULL DEFAULT false,
  accepted_business_terms_version text,
  accepted_privacy_policy_version text,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  normalized_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'submitted',
  risk_score integer,
  risk_level text,
  admin_review_status text NOT NULL DEFAULT 'not_reviewed',
  ip_address text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status IN ('submitted', 'materialized', 'pending_verification', 'trial_limited', 'waitlisted', 'rejected', 'archived')),
  CHECK (risk_level IS NULL OR risk_level IN ('low', 'medium', 'high', 'blocked'))
);

CREATE INDEX IF NOT EXISTS idx_business_onboarding_requests_email_created
  ON public.business_onboarding_requests(lower(owner_email), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_onboarding_requests_business_created
  ON public.business_onboarding_requests(business_id, created_at DESC)
  WHERE business_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.business_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  onboarding_request_id uuid REFERENCES public.business_onboarding_requests(id) ON DELETE SET NULL,
  invited_email text NOT NULL,
  role text NOT NULL DEFAULT 'pending_owner',
  status text NOT NULL DEFAULT 'pending',
  source text NOT NULL DEFAULT 'website_signup',
  accepted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (role IN ('owner', 'pending_owner', 'manager', 'staff', 'redeemer')),
  CHECK (status IN ('pending', 'accepted', 'expired', 'revoked'))
);

CREATE INDEX IF NOT EXISTS idx_business_invites_email_created
  ON public.business_invites(lower(invited_email), created_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_invites_request
  ON public.business_invites(onboarding_request_id)
  WHERE onboarding_request_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'business_applications_onboarding_request_id_fkey'
  ) THEN
    ALTER TABLE public.business_applications
      ADD CONSTRAINT business_applications_onboarding_request_id_fkey
      FOREIGN KEY (onboarding_request_id)
      REFERENCES public.business_onboarding_requests(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.business_contact_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  type text NOT NULL,
  label text,
  value text NOT NULL,
  normalized_value text,
  is_public boolean NOT NULL DEFAULT true,
  is_primary boolean NOT NULL DEFAULT false,
  verification_status text NOT NULL DEFAULT 'unverified',
  source text NOT NULL DEFAULT 'website_signup',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (type IN ('email', 'phone', 'website', 'instagram', 'facebook', 'tiktok', 'other')),
  CHECK (verification_status IN ('unverified', 'verified', 'needs_reverification'))
);

CREATE UNIQUE INDEX IF NOT EXISTS business_contact_channels_primary_key
  ON public.business_contact_channels(business_id, type, is_primary)
  WHERE is_primary = true;

CREATE TABLE IF NOT EXISTS public.business_slow_hours (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  label text,
  day_of_week integer CHECK (day_of_week BETWEEN 0 AND 6),
  starts_at time,
  ends_at time,
  raw_text text,
  confidence numeric,
  source text NOT NULL DEFAULT 'website_signup',
  confirmed_at timestamptz,
  confirmed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_slow_hours_business
  ON public.business_slow_hours(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.business_promotable_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  category text,
  suggested_offer_type text,
  suggested_discount_text text,
  source_raw_text text,
  source text NOT NULL DEFAULT 'website_signup',
  is_active boolean NOT NULL DEFAULT true,
  needs_policy_review boolean NOT NULL DEFAULT false,
  policy_review_status text NOT NULL DEFAULT 'not_reviewed',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (policy_review_status IN ('not_reviewed', 'approved', 'needs_review', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_business_promotable_items_business_active
  ON public.business_promotable_items(business_id, is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS public.business_profile_field_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  source text NOT NULL,
  source_record_id uuid,
  source_value jsonb,
  current_value jsonb,
  confidence numeric,
  first_imported_at timestamptz NOT NULL DEFAULT now(),
  last_updated_at timestamptz NOT NULL DEFAULT now(),
  last_updated_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requires_review boolean NOT NULL DEFAULT false,
  review_status text NOT NULL DEFAULT 'not_required',
  UNIQUE (business_id, field_key),
  CHECK (review_status IN ('not_required', 'needs_review', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_business_profile_field_sources_review
  ON public.business_profile_field_sources(review_status, last_updated_at DESC)
  WHERE requires_review = true;

CREATE TABLE IF NOT EXISTS public.business_profile_revision_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  actor_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_type text NOT NULL,
  source text NOT NULL,
  section_key text NOT NULL,
  before_value jsonb,
  after_value jsonb,
  reason text,
  requires_review boolean NOT NULL DEFAULT false,
  review_status text NOT NULL DEFAULT 'not_required',
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (actor_type IN ('anonymous_website_user', 'authenticated_business_owner', 'admin', 'system', 'ai', 'stripe')),
  CHECK (review_status IN ('not_required', 'needs_review', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_business_profile_revision_log_business_created
  ON public.business_profile_revision_log(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_profile_revision_log_review
  ON public.business_profile_revision_log(review_status, created_at DESC)
  WHERE requires_review = true;

CREATE TABLE IF NOT EXISTS public.business_setup_checklist (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  label text NOT NULL,
  status text NOT NULL DEFAULT 'not_started',
  is_required boolean NOT NULL DEFAULT true,
  completed_at timestamptz,
  completed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id, item_key),
  CHECK (status IN ('not_started', 'imported', 'in_progress', 'complete', 'needs_review', 'blocked'))
);

CREATE TABLE IF NOT EXISTS public.terms_acceptances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  document_type text NOT NULL,
  document_version text NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  source text NOT NULL,
  ip_address text,
  user_agent text,
  CHECK (document_type IN ('business_terms', 'privacy_policy'))
);

CREATE UNIQUE INDEX IF NOT EXISTS terms_acceptances_business_doc_version_source
  ON public.terms_acceptances(business_id, document_type, document_version, source);

CREATE OR REPLACE FUNCTION public.set_business_onboarding_sync_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'business_members',
    'business_invites',
    'business_onboarding_requests',
    'business_contact_channels',
    'business_slow_hours',
    'business_promotable_items',
    'business_setup_checklist'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON public.%I', tbl || '_set_updated_at', tbl);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.set_business_onboarding_sync_updated_at()',
      tbl || '_set_updated_at',
      tbl
    );
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.business_member_role(p_business_id uuid)
RETURNS text
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT bm.role
  FROM public.business_members bm
  WHERE bm.business_id = p_business_id
    AND bm.status = 'active'
    AND (
      bm.user_id = auth.uid()
      OR lower(bm.invited_email) = lower(COALESCE(auth.jwt() ->> 'email', ''))
    )
  ORDER BY CASE bm.role WHEN 'owner' THEN 0 WHEN 'manager' THEN 1 ELSE 2 END
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_business_member(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT public.business_member_role(p_business_id) IS NOT NULL;
$$;

ALTER TABLE public.business_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_onboarding_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_contact_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_slow_hours ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_promotable_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_profile_field_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_profile_revision_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_setup_checklist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.terms_acceptances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS business_members_admin_read ON public.business_members;
CREATE POLICY business_members_admin_read
  ON public.business_members FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS business_members_self_read ON public.business_members;
CREATE POLICY business_members_self_read
  ON public.business_members FOR SELECT
  TO authenticated
  USING (user_id = auth.uid() OR lower(invited_email) = lower(COALESCE(auth.jwt() ->> 'email', '')));

DROP POLICY IF EXISTS business_invites_admin_read ON public.business_invites;
CREATE POLICY business_invites_admin_read
  ON public.business_invites FOR SELECT
  TO authenticated
  USING (public.is_admin());

DROP POLICY IF EXISTS business_invites_self_read ON public.business_invites;
CREATE POLICY business_invites_self_read
  ON public.business_invites FOR SELECT
  TO authenticated
  USING (accepted_by_user_id = auth.uid() OR lower(invited_email) = lower(COALESCE(auth.jwt() ->> 'email', '')));

DROP POLICY IF EXISTS business_onboarding_requests_admin_read ON public.business_onboarding_requests;
CREATE POLICY business_onboarding_requests_admin_read
  ON public.business_onboarding_requests FOR SELECT
  TO authenticated
  USING (public.admin_can('trial_request.read'));

DROP POLICY IF EXISTS business_contact_channels_member_read ON public.business_contact_channels;
CREATE POLICY business_contact_channels_member_read
  ON public.business_contact_channels FOR SELECT
  TO authenticated
  USING (public.is_business_member(business_id) OR public.admin_can('business.read'));

DROP POLICY IF EXISTS business_slow_hours_member_read ON public.business_slow_hours;
CREATE POLICY business_slow_hours_member_read
  ON public.business_slow_hours FOR SELECT
  TO authenticated
  USING (public.is_business_member(business_id) OR public.admin_can('business.read'));

DROP POLICY IF EXISTS business_promotable_items_member_read ON public.business_promotable_items;
CREATE POLICY business_promotable_items_member_read
  ON public.business_promotable_items FOR SELECT
  TO authenticated
  USING (public.is_business_member(business_id) OR public.admin_can('business.read'));

DROP POLICY IF EXISTS business_setup_checklist_member_read ON public.business_setup_checklist;
CREATE POLICY business_setup_checklist_member_read
  ON public.business_setup_checklist FOR SELECT
  TO authenticated
  USING (public.is_business_member(business_id) OR public.admin_can('business.read'));

DROP POLICY IF EXISTS terms_acceptances_member_read ON public.terms_acceptances;
CREATE POLICY terms_acceptances_member_read
  ON public.terms_acceptances FOR SELECT
  TO authenticated
  USING (public.is_business_member(business_id) OR public.admin_can('business.read'));

DROP POLICY IF EXISTS business_profile_field_sources_admin_read ON public.business_profile_field_sources;
CREATE POLICY business_profile_field_sources_admin_read
  ON public.business_profile_field_sources FOR SELECT
  TO authenticated
  USING (public.admin_can('business.read'));

DROP POLICY IF EXISTS business_profile_revision_log_admin_read ON public.business_profile_revision_log;
CREATE POLICY business_profile_revision_log_admin_read
  ON public.business_profile_revision_log FOR SELECT
  TO authenticated
  USING (public.admin_can('business.read'));

DO $$
DECLARE
  tbl text;
  policy_name text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'business_members',
    'business_invites',
    'business_onboarding_requests',
    'business_contact_channels',
    'business_slow_hours',
    'business_promotable_items',
    'business_profile_field_sources',
    'business_profile_revision_log',
    'business_setup_checklist',
    'terms_acceptances'
  ]
  LOOP
    policy_name := 'redeemer_' || tbl || '_block_all';
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (NOT public.is_redeemer_session()) WITH CHECK (NOT public.is_redeemer_session())',
      policy_name,
      tbl
    );
  END LOOP;
END $$;

REVOKE ALL ON TABLE public.business_members FROM anon, authenticated;
REVOKE ALL ON TABLE public.business_invites FROM anon, authenticated;
REVOKE ALL ON TABLE public.business_onboarding_requests FROM anon, authenticated;
REVOKE ALL ON TABLE public.business_contact_channels FROM anon, authenticated;
REVOKE ALL ON TABLE public.business_slow_hours FROM anon, authenticated;
REVOKE ALL ON TABLE public.business_promotable_items FROM anon, authenticated;
REVOKE ALL ON TABLE public.business_profile_field_sources FROM anon, authenticated;
REVOKE ALL ON TABLE public.business_profile_revision_log FROM anon, authenticated;
REVOKE ALL ON TABLE public.business_setup_checklist FROM anon, authenticated;
REVOKE ALL ON TABLE public.terms_acceptances FROM anon, authenticated;

GRANT SELECT ON TABLE public.business_members TO authenticated;
GRANT SELECT ON TABLE public.business_invites TO authenticated;
GRANT SELECT ON TABLE public.business_contact_channels TO authenticated;
GRANT SELECT ON TABLE public.business_slow_hours TO authenticated;
GRANT SELECT ON TABLE public.business_promotable_items TO authenticated;
GRANT SELECT ON TABLE public.business_setup_checklist TO authenticated;
GRANT SELECT ON TABLE public.terms_acceptances TO authenticated;
GRANT SELECT ON TABLE public.business_onboarding_requests TO authenticated;
GRANT SELECT ON TABLE public.business_profile_field_sources TO authenticated;
GRANT SELECT ON TABLE public.business_profile_revision_log TO authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.business_members TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.business_invites TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.business_onboarding_requests TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.business_contact_channels TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_slow_hours TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_promotable_items TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.business_profile_field_sources TO service_role;
GRANT SELECT, INSERT ON TABLE public.business_profile_revision_log TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.business_setup_checklist TO service_role;
GRANT SELECT, INSERT ON TABLE public.terms_acceptances TO service_role;

REVOKE ALL ON FUNCTION public.business_member_role(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_business_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.business_member_role(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_business_member(uuid) TO authenticated, service_role;

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
  SELECT id, owner_id, status, access_level, can_publish_cached
    INTO v_business
  FROM public.businesses
  WHERE id = p_business_id;

  IF v_business.id IS NULL THEN
    RETURN jsonb_build_object('canPublish', false, 'reason', 'not_authorized', 'limits', v_limits);
  END IF;

  IF COALESCE(auth.role(), '') <> 'service_role'
    AND NOT public.is_admin()
    AND v_business.owner_id IS DISTINCT FROM auth.uid()
    AND NOT public.is_business_member(p_business_id)
  THEN
    RETURN jsonb_build_object('canPublish', false, 'reason', 'not_authorized', 'limits', v_limits);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.business_profile_field_sources bfs
    WHERE bfs.business_id = p_business_id
      AND bfs.requires_review = true
      AND bfs.review_status = 'needs_review'
  ) THEN
    RETURN jsonb_build_object('canPublish', false, 'reason', 'profile_review_required', 'limits', v_limits);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.terms_acceptances ta
    WHERE ta.business_id = p_business_id
      AND ta.document_type = 'business_terms'
  ) THEN
    RETURN jsonb_build_object('canPublish', false, 'reason', 'terms_required', 'limits', v_limits);
  END IF;

  IF v_business.status IN ('suspended', 'disabled', 'rejected', 'archived') THEN
    RETURN jsonb_build_object('canPublish', false, 'reason', v_business.status, 'limits', v_limits);
  END IF;

  SELECT le.status, le.trial_ends_at, le.current_period_ends_at, le.suspended_at
    INTO v_entitlement
  FROM public.business_locations bl
  JOIN public.location_entitlements le
    ON le.business_location_id = bl.id
  JOIN public.business_profiles bp
    ON bp.id = bl.business_id
  WHERE bp.owner_id = v_business.owner_id
     OR bp.user_id = v_business.owner_id
     OR bp.id = p_business_id
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
  ELSIF v_entitlement.status IN ('trial_active', 'admin_trial_active')
    AND COALESCE(v_entitlement.trial_ends_at, v_entitlement.current_period_ends_at, v_now + interval '1 second') > v_now THEN
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

REVOKE ALL ON FUNCTION public.can_business_publish(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_business_publish(uuid) TO authenticated, service_role;

COMMENT ON TABLE public.business_onboarding_requests
  IS 'Raw and normalized website/app business onboarding requests. Business users read safe projections through Edge Functions; admins use the dashboard.';

COMMENT ON TABLE public.business_profile_field_sources
  IS 'Per-field source tracking for website import, app edits, admin edits, and AI suggestions.';

COMMENT ON TABLE public.business_profile_revision_log
  IS 'Append-only profile revision history across website, mobile app, admin, AI, and system edits.';

COMMIT;
