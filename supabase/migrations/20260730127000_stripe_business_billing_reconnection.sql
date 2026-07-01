-- Stripe business billing reconnection.
--
-- Adds a business-level billing mirror for web/admin/server Stripe flows.
-- This does not expose mobile checkout, payment links, pricing, Apple Pay, or
-- Google Pay. Applying this migration is production-changing and requires
-- explicit approval.

BEGIN;

CREATE TABLE IF NOT EXISTS public.business_billing_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  stripe_customer_id text UNIQUE,
  stripe_customer_livemode boolean,
  billing_name text,
  billing_email text,
  billing_phone text,
  billing_address_line1 text,
  billing_address_line2 text,
  billing_city text,
  billing_state text,
  billing_postal_code text,
  billing_country text DEFAULT 'US',
  public_profile_source_business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  billing_contact_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  billing_contact_name text,
  billing_contact_role text,
  tax_exempt text,
  tax_id_status text,
  tax_id_last4 text,
  tax_collection_enabled boolean NOT NULL DEFAULT false,
  onboarding_source text,
  referral_source text,
  launch_area_slug text,
  preferred_plan text DEFAULT 'twofer_pro_monthly',
  pricing_version text,
  stripe_sync_status text NOT NULL DEFAULT 'not_synced'
    CHECK (stripe_sync_status IN ('not_synced', 'pending', 'synced', 'failed', 'manual_review')),
  stripe_sync_error text,
  last_synced_to_stripe_at timestamptz,
  last_synced_from_stripe_at timestamptz,
  billing_fields_source jsonb NOT NULL DEFAULT '{}'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id)
);

CREATE INDEX IF NOT EXISTS idx_business_billing_profiles_business
  ON public.business_billing_profiles(business_id);

CREATE INDEX IF NOT EXISTS idx_business_billing_profiles_customer
  ON public.business_billing_profiles(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.business_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  stripe_customer_id text,
  stripe_subscription_id text UNIQUE,
  stripe_product_id text,
  stripe_price_id text,
  plan_key text NOT NULL DEFAULT 'twofer_pro',
  plan_name text NOT NULL DEFAULT 'Twofer Pro',
  plan_interval text DEFAULT 'month',
  billing_mode text NOT NULL DEFAULT 'web_stripe'
    CHECK (billing_mode IN ('none', 'web_stripe', 'admin_stripe', 'manual_invoice', 'admin_comp', 'partner_comp')),
  billing_status text NOT NULL DEFAULT 'none'
    CHECK (billing_status IN (
      'none', 'trialing', 'active', 'past_due', 'unpaid', 'canceled',
      'incomplete', 'incomplete_expired', 'paused', 'admin_comped', 'partner_comped'
    )),
  app_access_status text NOT NULL DEFAULT 'pending'
    CHECK (app_access_status IN (
      'pending', 'trial_limited', 'trialing', 'active', 'past_due_grace',
      'expired', 'blocked', 'suspended', 'canceled', 'comped'
    )),
  trial_type text CHECK (trial_type IN ('field_full', 'remote_limited', 'remote_full', 'stripe_trial', 'admin_comp', 'paid')),
  trial_start timestamptz,
  trial_end timestamptz,
  current_period_start timestamptz,
  current_period_end timestamptz,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  canceled_at timestamptz,
  ended_at timestamptz,
  grace_period_until timestamptz,
  past_due_since timestamptz,
  payment_method_status text NOT NULL DEFAULT 'unknown'
    CHECK (payment_method_status IN ('unknown', 'none', 'present', 'requires_action', 'failed')),
  default_payment_method_id text,
  default_payment_method_brand text,
  default_payment_method_last4 text,
  default_payment_method_exp_month integer,
  default_payment_method_exp_year integer,
  last_invoice_id text,
  last_invoice_url text,
  last_invoice_pdf text,
  last_invoice_status text,
  last_invoice_amount_due_cents integer,
  last_invoice_amount_paid_cents integer,
  last_payment_error text,
  admin_override_status text,
  admin_override_until timestamptz,
  admin_override_reason text,
  admin_override_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_override_at timestamptz,
  source text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_id)
);

CREATE INDEX IF NOT EXISTS idx_business_subscriptions_business_status
  ON public.business_subscriptions(business_id, app_access_status);

CREATE INDEX IF NOT EXISTS idx_business_subscriptions_customer
  ON public.business_subscriptions(stripe_customer_id)
  WHERE stripe_customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.billing_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  stripe_event_id text UNIQUE,
  stripe_customer_id text,
  stripe_subscription_id text,
  stripe_checkout_session_id text,
  stripe_invoice_id text,
  stripe_payment_intent_id text,
  stripe_setup_intent_id text,
  event_source text NOT NULL DEFAULT 'stripe'
    CHECK (event_source IN ('stripe', 'admin', 'system', 'migration', 'website')),
  event_type text NOT NULL,
  event_created_at timestamptz,
  status_before text,
  status_after text,
  app_access_before text,
  app_access_after text,
  processing_status text NOT NULL DEFAULT 'processed'
    CHECK (processing_status IN ('received', 'processed', 'ignored_duplicate', 'failed', 'needs_review')),
  error_message text,
  raw_event jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_billing_events_business_created
  ON public.billing_events(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_billing_events_customer_created
  ON public.billing_events(stripe_customer_id, created_at DESC)
  WHERE stripe_customer_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.stripe_checkout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  requested_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_by_admin_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  stripe_customer_id text NOT NULL,
  stripe_checkout_session_id text UNIQUE,
  stripe_subscription_id text,
  stripe_setup_intent_id text,
  session_type text NOT NULL
    CHECK (session_type IN ('subscription_checkout', 'setup_payment_method', 'one_time_invoice_payment')),
  mode text NOT NULL CHECK (mode IN ('subscription', 'setup', 'payment')),
  price_id text,
  success_url text,
  cancel_url text,
  return_url text,
  url_expires_at timestamptz,
  status text NOT NULL DEFAULT 'created'
    CHECK (status IN ('created', 'opened', 'completed', 'expired', 'canceled', 'failed')),
  source text NOT NULL DEFAULT 'website'
    CHECK (source IN ('admin', 'website', 'email', 'sms', 'migration', 'test')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stripe_checkout_sessions_business_created
  ON public.stripe_checkout_sessions(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.stripe_portal_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  stripe_customer_id text NOT NULL,
  stripe_portal_session_id text UNIQUE,
  requested_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  requested_by_admin_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('admin', 'merchant_web', 'email')),
  return_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stripe_portal_sessions_business_created
  ON public.stripe_portal_sessions(business_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.stripe_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  onboarding_request_id uuid REFERENCES public.business_onboarding_requests(id) ON DELETE SET NULL,
  business_application_id uuid REFERENCES public.business_applications(id) ON DELETE SET NULL,
  job_type text NOT NULL CHECK (job_type IN ('ensure_customer', 'sync_customer', 'backfill_customer')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'succeeded', 'failed', 'skipped', 'manual_review')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  next_attempt_at timestamptz,
  last_attempted_at timestamptz,
  completed_at timestamptz,
  reason text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_stripe_sync_jobs_status_next_attempt
  ON public.stripe_sync_jobs(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS public.billing_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  reminder_type text NOT NULL CHECK (reminder_type IN ('trial_ending', 'payment_failed', 'past_due_grace', 'admin_digest')),
  channel text NOT NULL DEFAULT 'email' CHECK (channel IN ('email', 'sms', 'admin')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  idempotency_key text UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_reminders_status_scheduled
  ON public.billing_reminders(status, scheduled_for);

CREATE TABLE IF NOT EXISTS public.billing_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  action text NOT NULL CHECK (action IN ('subscription_checkout', 'setup_payment_method', 'customer_portal')),
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  use_count integer NOT NULL DEFAULT 0 CHECK (use_count >= 0),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_admin_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_billing_tokens_business_action
  ON public.billing_tokens(business_id, action, expires_at DESC);

ALTER TABLE public.business_billing_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_checkout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_portal_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_sync_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_tokens ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
  policy_name text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'business_billing_profiles',
    'business_subscriptions',
    'billing_events',
    'stripe_checkout_sessions',
    'stripe_portal_sessions',
    'stripe_sync_jobs',
    'billing_reminders',
    'billing_tokens'
  ] LOOP
    policy_name := 'redeemer_' || tbl || '_block_all';
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (NOT public.is_redeemer_session()) WITH CHECK (NOT public.is_redeemer_session())',
      policy_name,
      tbl
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS business_billing_profiles_member_read ON public.business_billing_profiles;
CREATE POLICY business_billing_profiles_member_read
  ON public.business_billing_profiles FOR SELECT
  TO authenticated
  USING (public.is_business_member(business_id) OR public.admin_can('billing.read'));

DROP POLICY IF EXISTS business_subscriptions_member_read ON public.business_subscriptions;
CREATE POLICY business_subscriptions_member_read
  ON public.business_subscriptions FOR SELECT
  TO authenticated
  USING (public.is_business_member(business_id) OR public.admin_can('billing.read'));

DROP POLICY IF EXISTS billing_events_admin_read ON public.billing_events;
CREATE POLICY billing_events_admin_read
  ON public.billing_events FOR SELECT
  TO authenticated
  USING (public.admin_can('billing.read'));

DROP POLICY IF EXISTS stripe_checkout_sessions_admin_read ON public.stripe_checkout_sessions;
CREATE POLICY stripe_checkout_sessions_admin_read
  ON public.stripe_checkout_sessions FOR SELECT
  TO authenticated
  USING (public.admin_can('billing.read'));

DROP POLICY IF EXISTS stripe_portal_sessions_admin_read ON public.stripe_portal_sessions;
CREATE POLICY stripe_portal_sessions_admin_read
  ON public.stripe_portal_sessions FOR SELECT
  TO authenticated
  USING (public.admin_can('billing.read'));

DROP POLICY IF EXISTS stripe_sync_jobs_admin_read ON public.stripe_sync_jobs;
CREATE POLICY stripe_sync_jobs_admin_read
  ON public.stripe_sync_jobs FOR SELECT
  TO authenticated
  USING (public.admin_can('billing.read'));

DROP POLICY IF EXISTS billing_reminders_admin_read ON public.billing_reminders;
CREATE POLICY billing_reminders_admin_read
  ON public.billing_reminders FOR SELECT
  TO authenticated
  USING (public.admin_can('billing.read'));

DROP POLICY IF EXISTS billing_tokens_admin_read ON public.billing_tokens;
CREATE POLICY billing_tokens_admin_read
  ON public.billing_tokens FOR SELECT
  TO authenticated
  USING (public.admin_can('billing.read'));

REVOKE ALL ON TABLE public.business_billing_profiles FROM anon, authenticated;
REVOKE ALL ON TABLE public.business_subscriptions FROM anon, authenticated;
REVOKE ALL ON TABLE public.billing_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.stripe_checkout_sessions FROM anon, authenticated;
REVOKE ALL ON TABLE public.stripe_portal_sessions FROM anon, authenticated;
REVOKE ALL ON TABLE public.stripe_sync_jobs FROM anon, authenticated;
REVOKE ALL ON TABLE public.billing_reminders FROM anon, authenticated;
REVOKE ALL ON TABLE public.billing_tokens FROM anon, authenticated;

GRANT SELECT ON TABLE public.business_billing_profiles TO authenticated;
GRANT SELECT ON TABLE public.business_subscriptions TO authenticated;
GRANT SELECT ON TABLE public.billing_events TO authenticated;
GRANT SELECT ON TABLE public.stripe_checkout_sessions TO authenticated;
GRANT SELECT ON TABLE public.stripe_portal_sessions TO authenticated;
GRANT SELECT ON TABLE public.stripe_sync_jobs TO authenticated;
GRANT SELECT ON TABLE public.billing_reminders TO authenticated;
GRANT SELECT ON TABLE public.billing_tokens TO authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.business_billing_profiles TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.business_subscriptions TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.billing_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.stripe_checkout_sessions TO service_role;
GRANT SELECT, INSERT ON TABLE public.stripe_portal_sessions TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.stripe_sync_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.billing_reminders TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.billing_tokens TO service_role;

CREATE OR REPLACE FUNCTION public.can_business_publish(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_business record;
  v_subscription record;
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
    RETURN jsonb_build_object('canPublish', false, 'can_publish', false, 'reason', 'not_authorized', 'reason_code', 'not_authorized', 'limits', v_limits);
  END IF;

  IF COALESCE(auth.role(), '') <> 'service_role'
    AND NOT public.is_admin()
    AND v_business.owner_id IS DISTINCT FROM auth.uid()
    AND NOT public.is_business_member(p_business_id)
  THEN
    RETURN jsonb_build_object('canPublish', false, 'can_publish', false, 'reason', 'not_authorized', 'reason_code', 'not_authorized', 'limits', v_limits);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.business_profile_field_sources bfs
    WHERE bfs.business_id = p_business_id
      AND bfs.requires_review = true
      AND bfs.review_status = 'needs_review'
  ) THEN
    RETURN jsonb_build_object('canPublish', false, 'can_publish', false, 'reason', 'profile_review_required', 'reason_code', 'profile_review_required', 'limits', v_limits);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.terms_acceptances ta
    WHERE ta.business_id = p_business_id
      AND ta.document_type = 'business_terms'
  ) THEN
    RETURN jsonb_build_object('canPublish', false, 'can_publish', false, 'reason', 'terms_required', 'reason_code', 'terms_required', 'limits', v_limits);
  END IF;

  IF v_business.status IN ('suspended', 'disabled', 'rejected', 'archived') THEN
    RETURN jsonb_build_object('canPublish', false, 'can_publish', false, 'reason', v_business.status, 'reason_code', v_business.status, 'limits', v_limits);
  END IF;

  SELECT bs.*
    INTO v_subscription
  FROM public.business_subscriptions bs
  WHERE bs.business_id = p_business_id
  ORDER BY bs.updated_at DESC
  LIMIT 1;

  IF v_subscription.id IS NOT NULL THEN
    IF v_subscription.admin_override_status IN ('admin_comped', 'partner_comped')
      AND COALESCE(v_subscription.admin_override_until, v_now + interval '1 second') > v_now THEN
      v_can_publish := true;
      v_reason := v_subscription.admin_override_status;
      v_limits := jsonb_build_object('maxActiveOffers', 3, 'maxClaimsPerOffer', 100, 'canNotifyNearbyUsers', true, 'requiresOfferReview', false);
    ELSIF v_subscription.app_access_status = 'active'
      AND v_subscription.billing_status = 'active' THEN
      v_can_publish := true;
      v_reason := 'active_paid';
      v_limits := jsonb_build_object('maxActiveOffers', 3, 'maxClaimsPerOffer', 100, 'canNotifyNearbyUsers', true, 'requiresOfferReview', false);
    ELSIF v_subscription.app_access_status IN ('trialing', 'trial_limited')
      AND COALESCE(v_subscription.trial_end, v_subscription.current_period_end, v_now + interval '1 second') > v_now THEN
      v_can_publish := true;
      v_reason := CASE WHEN v_subscription.app_access_status = 'trial_limited' THEN 'limited_trial' ELSE 'active_trial' END;
      v_limits := CASE
        WHEN v_subscription.app_access_status = 'trial_limited'
          THEN jsonb_build_object('maxActiveOffers', 1, 'maxClaimsPerOffer', 25, 'canNotifyNearbyUsers', false, 'requiresOfferReview', true)
        ELSE jsonb_build_object('maxActiveOffers', 3, 'maxClaimsPerOffer', 50, 'canNotifyNearbyUsers', true, 'requiresOfferReview', false)
      END;
    ELSIF v_subscription.app_access_status = 'past_due_grace'
      AND COALESCE(v_subscription.grace_period_until, v_now - interval '1 second') > v_now THEN
      v_can_publish := true;
      v_reason := 'past_due_grace';
      v_limits := jsonb_build_object('maxActiveOffers', 1, 'maxClaimsPerOffer', 25, 'canNotifyNearbyUsers', false, 'requiresOfferReview', true);
    ELSIF v_subscription.app_access_status IN ('expired', 'canceled') THEN
      v_reason := v_subscription.app_access_status;
    ELSIF v_subscription.app_access_status IN ('blocked', 'suspended')
      OR v_subscription.billing_status IN ('past_due', 'unpaid', 'paused') THEN
      v_reason := 'payment_failed';
    END IF;

    IF v_can_publish OR v_reason <> 'not_authorized' THEN
      RETURN jsonb_build_object('canPublish', v_can_publish, 'can_publish', v_can_publish, 'reason', v_reason, 'reason_code', v_reason, 'limits', v_limits);
    END IF;
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

  RETURN jsonb_build_object('canPublish', v_can_publish, 'can_publish', v_can_publish, 'reason', v_reason, 'reason_code', v_reason, 'limits', v_limits);
END;
$$;

REVOKE ALL ON FUNCTION public.can_business_publish(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_business_publish(uuid) TO authenticated, service_role;

COMMENT ON TABLE public.business_billing_profiles
  IS 'Safe business billing identity mirror synced to Stripe Customer. No raw card data is stored.';

COMMENT ON TABLE public.business_subscriptions
  IS 'Business-level app access state derived from trial/admin/Stripe events. Mobile reads publish/access status only through safe helpers.';

COMMENT ON TABLE public.billing_events
  IS 'Idempotent Stripe/admin/system billing event history. Raw Stripe payloads are not exposed to normal business users.';

COMMIT;
