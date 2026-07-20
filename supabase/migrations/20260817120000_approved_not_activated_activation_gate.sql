-- Approved-not-activated lifecycle and capability gate.
--
-- Local migration file only until explicitly approved for a Supabase project.
-- This is additive/compatible: it expands lifecycle constraints, adds immutable
-- activation markers, provides an app/server capability helper, and creates the
-- race-safe application claim primitive used by get-business-onboarding-context.

BEGIN;

ALTER TABLE public.business_applications
  ADD COLUMN IF NOT EXISTS claimed_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_email_normalized text;

UPDATE public.business_applications
SET approved_email_normalized = lower(btrim(email))
WHERE approved_email_normalized IS NULL
  AND status IN (
    'approved_not_activated',
    'trial_limited',
    'trial_active',
    'approved_not_billed',
    'active'
  );

ALTER TABLE public.business_applications
  DROP CONSTRAINT IF EXISTS business_applications_approved_email_normalized_check,
  ADD CONSTRAINT business_applications_approved_email_normalized_check
    CHECK (
      approved_email_normalized IS NULL
      OR approved_email_normalized = lower(btrim(approved_email_normalized))
    );

CREATE OR REPLACE FUNCTION public.protect_business_application_approved_email()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.approved_email_normalized IS NOT NULL
    AND NEW.approved_email_normalized IS DISTINCT FROM OLD.approved_email_normalized
  THEN
    RAISE EXCEPTION 'APPROVED_APPLICATION_EMAIL_IS_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_business_application_approved_email
  ON public.business_applications;
CREATE TRIGGER protect_business_application_approved_email
  BEFORE UPDATE ON public.business_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_business_application_approved_email();

ALTER TABLE public.business_applications
  DROP CONSTRAINT IF EXISTS business_applications_status_check,
  ADD CONSTRAINT business_applications_status_check
    CHECK (status IN (
      'pending_review',
      'pending_verification',
      'review_required',
      'approved_not_activated',
      'trial_limited',
      'trial_active',
      'approved_not_billed',
      'active',
      'waitlisted',
      'rejected',
      'suspended',
      'expired',
      'canceled',
      'archived'
    ));

ALTER TABLE public.business_applications
  DROP CONSTRAINT IF EXISTS business_applications_access_tier_check,
  ADD CONSTRAINT business_applications_access_tier_check
    CHECK (access_tier IN (
      'pending',
      'pending_verification',
      'field_invited',
      'approved_not_activated',
      'trial_limited',
      'trialing',
      'active',
      'review_required',
      'waitlisted',
      'rejected',
      'suspended',
      'expired',
      'canceled'
    ));

DROP INDEX IF EXISTS public.idx_business_applications_claimed_once;
CREATE UNIQUE INDEX idx_business_applications_claimed_once
  ON public.business_applications (claimed_by_user_id)
  WHERE claimed_by_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_applications_approved_email_claim
  ON public.business_applications (
    COALESCE(approved_email_normalized, lower(btrim(email))),
    reviewed_at DESC,
    created_at DESC
  )
  WHERE status = 'approved_not_activated';

ALTER TABLE public.business_onboarding_requests
  DROP CONSTRAINT IF EXISTS business_onboarding_requests_status_check,
  ADD CONSTRAINT business_onboarding_requests_status_check
    CHECK (status IN (
      'submitted',
      'materialized',
      'pending_verification',
      'approved_not_activated',
      'trial_limited',
      'waitlisted',
      'rejected',
      'suspended',
      'archived'
    ));

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_status_check,
  ADD CONSTRAINT businesses_status_check
    CHECK (status IN (
      'draft',
      'pending_verification',
      'approved_not_activated',
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
      'approved_not_activated',
      'limited_trial',
      'full_trial',
      'paid',
      'admin_comped',
      'partner_comped',
      'internal_test'
    ));

ALTER TABLE public.business_subscriptions
  ADD COLUMN IF NOT EXISTS activated_at timestamptz,
  ADD COLUMN IF NOT EXISTS activation_checkout_session_id text,
  ADD COLUMN IF NOT EXISTS activation_provider_event_id text,
  ADD COLUMN IF NOT EXISTS last_provider_event_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_provider_event_id text,
  ADD COLUMN IF NOT EXISTS access_locked_at timestamptz,
  ADD COLUMN IF NOT EXISTS access_locked_reason text;

ALTER TABLE public.business_subscriptions
  DROP CONSTRAINT IF EXISTS business_subscriptions_billing_status_check,
  ADD CONSTRAINT business_subscriptions_billing_status_check
    CHECK (billing_status IN (
      'none', 'trialing', 'active', 'past_due', 'unpaid', 'canceled',
      'incomplete', 'incomplete_expired', 'paused', 'chargeback',
      'admin_comped', 'partner_comped'
    ));

ALTER TABLE public.business_subscriptions
  DROP CONSTRAINT IF EXISTS business_subscriptions_app_access_status_check,
  ADD CONSTRAINT business_subscriptions_app_access_status_check
    CHECK (app_access_status IN (
      'pending',
      'approved_not_activated',
      'trial_limited',
      'trialing',
      'active',
      'past_due_grace',
      'expired',
      'blocked',
      'suspended',
      'canceled',
      'comped'
    ));

ALTER TABLE public.deal_credit_ledger
  DROP CONSTRAINT IF EXISTS deal_credit_ledger_purpose_check,
  ADD CONSTRAINT deal_credit_ledger_purpose_check
    CHECK (purpose IN (
      'new_deal',
      'duplicate_deal',
      'recurring_occurrence',
      'extra_image_revision',
      'admin_adjustment',
      'admin_trial',
      'stripe_trial'
    ));

ALTER TABLE public.business_subscriptions
  DROP CONSTRAINT IF EXISTS business_subscriptions_activation_requires_trialing,
  ADD CONSTRAINT business_subscriptions_activation_requires_trialing
    CHECK (
      activated_at IS NULL
      OR (
        activation_checkout_session_id IS NOT NULL
        AND activation_provider_event_id IS NOT NULL
        AND app_access_status IN ('trialing', 'active', 'past_due_grace', 'expired', 'blocked', 'suspended', 'canceled')
      )
    );

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_subscriptions_activation_checkout_session
  ON public.business_subscriptions (activation_checkout_session_id)
  WHERE activation_checkout_session_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_subscriptions_activation_provider_event
  ON public.business_subscriptions (activation_provider_event_id)
  WHERE activation_provider_event_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.protect_business_subscription_activation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF OLD.activated_at IS NOT NULL AND (
    NEW.activated_at IS DISTINCT FROM OLD.activated_at
    OR NEW.activation_checkout_session_id IS DISTINCT FROM OLD.activation_checkout_session_id
    OR NEW.activation_provider_event_id IS DISTINCT FROM OLD.activation_provider_event_id
  ) THEN
    RAISE EXCEPTION 'BUSINESS_ACTIVATION_FIELDS_ARE_IMMUTABLE' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_business_subscription_activation
  ON public.business_subscriptions;
CREATE TRIGGER protect_business_subscription_activation
  BEFORE UPDATE ON public.business_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_business_subscription_activation();

CREATE OR REPLACE FUNCTION public.protect_business_subscription_provider_order()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_verified_initial_activation boolean :=
    OLD.activated_at IS NULL
    AND NEW.activated_at IS NOT NULL
    AND NEW.activation_checkout_session_id IS NOT NULL
    AND NEW.activation_provider_event_id IS NOT NULL;
  v_introduces_access_lock boolean :=
    OLD.access_locked_at IS NULL
    AND NEW.access_locked_at IS NOT NULL;
  v_would_grant_access boolean :=
    NEW.app_access_status IN ('trial_limited', 'trialing', 'active', 'past_due_grace', 'comped');
  v_old_is_terminal boolean :=
    OLD.app_access_status IN ('expired', 'blocked', 'suspended', 'canceled');
BEGIN
  IF OLD.last_provider_event_created_at IS NOT NULL
    AND NEW.last_provider_event_created_at IS NOT NULL
    AND NEW.last_provider_event_created_at < OLD.last_provider_event_created_at
    AND NOT v_is_verified_initial_activation
    AND NOT v_introduces_access_lock
  THEN
    RAISE EXCEPTION 'STALE_BUSINESS_SUBSCRIPTION_PROVIDER_EVENT' USING ERRCODE = 'P0001';
  END IF;

  IF OLD.last_provider_event_created_at IS NOT NULL
    AND NEW.last_provider_event_created_at = OLD.last_provider_event_created_at
    AND NEW.last_provider_event_id IS DISTINCT FROM OLD.last_provider_event_id
    AND v_old_is_terminal
    AND v_would_grant_access
    AND NOT v_is_verified_initial_activation
  THEN
    RAISE EXCEPTION 'AMBIGUOUS_PROVIDER_EVENT_CANNOT_RESTORE_ACCESS' USING ERRCODE = 'P0001';
  END IF;

  IF OLD.access_locked_at IS NOT NULL
    AND v_would_grant_access
  THEN
    RAISE EXCEPTION 'BUSINESS_SUBSCRIPTION_ACCESS_IS_LOCKED' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_business_subscription_provider_order
  ON public.business_subscriptions;
CREATE TRIGGER protect_business_subscription_provider_order
  BEFORE UPDATE ON public.business_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_business_subscription_provider_order();

CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_checkout_sessions_one_open_trial_start
  ON public.stripe_checkout_sessions (business_id)
  WHERE session_type = 'subscription_checkout'
    AND status IN ('created', 'opened')
    AND COALESCE(metadata ->> 'checkout_purpose', '') = 'trial_start';

INSERT INTO public.feature_flags (key, description, enabled, rules)
VALUES (
  'approved_activation_gate',
  'Rollout switch for approved-not-activated onboarding and Stripe activation. Keep disabled until compatible app, website, migration, and Edge Functions are released together.',
  false,
  '{"enforcement_ready":true}'::jsonb
)
ON CONFLICT (key)
DO UPDATE SET
  description = EXCLUDED.description,
  enabled = false,
  rules = EXCLUDED.rules,
  updated_at = now();

CREATE TABLE IF NOT EXISTS public.business_setup_ai_allowances (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  menu_extractions_used integer NOT NULL DEFAULT 0 CHECK (menu_extractions_used >= 0),
  menu_extractions_limit integer NOT NULL DEFAULT 1 CHECK (menu_extractions_limit >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.business_setup_ai_allowances ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.business_setup_ai_allowances FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.business_setup_ai_allowances TO service_role;

CREATE TABLE IF NOT EXISTS public.business_deal_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  draft_type text NOT NULL DEFAULT 'text_only' CHECK (draft_type = 'text_only'),
  source text NOT NULL DEFAULT 'merchant_app',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'archived', 'published')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_deal_drafts_one_menu_offer
  ON public.business_deal_drafts (business_id, source)
  WHERE status = 'draft';

ALTER TABLE public.business_deal_drafts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.business_deal_drafts FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE ON TABLE public.business_deal_drafts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.business_deal_drafts TO service_role;

CREATE OR REPLACE FUNCTION public.is_public_business_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_status IS NOT NULL
    AND p_status NOT IN ('draft', 'pending_verification', 'approved_not_activated', 'rejected');
$$;

REVOKE ALL ON FUNCTION public.is_public_business_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_public_business_status(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.is_public_business_status(text) IS
  'Single source of truth for public business visibility. Setup-only approved_not_activated businesses are hidden until Stripe checkout.session.completed activates access.';

CREATE OR REPLACE FUNCTION public.is_publicly_visible_business(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT p_business_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.businesses b
      WHERE b.id = p_business_id
        AND public.is_public_business_status(b.status)
    );
$$;

REVOKE ALL ON FUNCTION public.is_publicly_visible_business(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_publicly_visible_business(uuid)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.is_publicly_visible_business(uuid) IS
  'Canonical public business row predicate. approved_not_activated remains private while the owner can still read it through the owner policy clause.';

CREATE OR REPLACE FUNCTION public.claim_approved_business_application_for_user(
  p_user_id uuid,
  p_email text
)
RETURNS TABLE (
  application_id uuid,
  onboarding_request_id uuid,
  business_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_application record;
  v_match_count integer := 0;
  v_existing_business_id uuid;
  v_existing_owner_id uuid;
  v_onboarding_request_id uuid;
  v_location_id uuid;
  v_subscription record;
  v_location_status text;
BEGIN
  IF p_user_id IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'claim requires user and email' USING ERRCODE = '22023';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('business_application_claim:' || v_email));

  IF NOT EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE u.id = p_user_id
      AND u.email_confirmed_at IS NOT NULL
      AND lower(btrim(coalesce(u.email, ''))) = v_email
  ) THEN
    RAISE EXCEPTION 'CONFIRMED_AUTH_EMAIL_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT count(*)
    INTO v_match_count
  FROM public.business_applications ba
  WHERE ba.claimed_by_user_id = p_user_id
    AND COALESCE(ba.approved_email_normalized, lower(btrim(ba.email))) = v_email
    AND ba.business_id IS NOT NULL;

  IF v_match_count > 1 THEN
    RAISE EXCEPTION 'AMBIGUOUS_CLAIMED_APPLICATIONS_FOR_USER' USING ERRCODE = 'P0001';
  END IF;
  IF v_match_count = 1 THEN
    SELECT ba.*
      INTO v_application
    FROM public.business_applications ba
    WHERE ba.claimed_by_user_id = p_user_id
      AND COALESCE(ba.approved_email_normalized, lower(btrim(ba.email))) = v_email
      AND ba.business_id IS NOT NULL
    FOR UPDATE;

    application_id := v_application.id;
    onboarding_request_id := v_application.onboarding_request_id;
    business_id := v_application.business_id;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT count(*)
    INTO v_match_count
  FROM public.business_applications ba
  WHERE COALESCE(ba.approved_email_normalized, lower(btrim(ba.email))) = v_email
    AND ba.status = 'approved_not_activated'
    AND ba.claimed_by_user_id IS NULL;

  IF v_match_count = 0 THEN
    RETURN;
  END IF;
  IF v_match_count <> 1 THEN
    RAISE EXCEPTION 'AMBIGUOUS_APPROVED_APPLICATION_EMAIL' USING ERRCODE = 'P0001';
  END IF;

  SELECT ba.*
    INTO v_application
  FROM public.business_applications ba
  WHERE COALESCE(ba.approved_email_normalized, lower(btrim(ba.email))) = v_email
    AND ba.status = 'approved_not_activated'
    AND ba.claimed_by_user_id IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_application.business_id IS NOT NULL THEN
    SELECT b.owner_id
      INTO v_existing_owner_id
    FROM public.businesses b
    WHERE b.id = v_application.business_id;

    IF v_existing_owner_id IS NOT NULL AND v_existing_owner_id IS DISTINCT FROM p_user_id THEN
      RETURN;
    END IF;
  END IF;

  v_existing_business_id := v_application.business_id;
  IF v_existing_business_id IS NULL THEN
    SELECT b.id
      INTO v_existing_business_id
    FROM public.businesses b
    WHERE b.owner_id = p_user_id
    ORDER BY b.created_at ASC
    LIMIT 1
    FOR UPDATE;
  END IF;

  IF v_existing_business_id IS NULL THEN
    INSERT INTO public.businesses (
      owner_id,
      name,
      contact_name,
      business_email,
      public_email,
      phone,
      address,
      location,
      category,
      status,
      access_level,
      verification_status,
      source,
      profile_completion_score
    )
    VALUES (
      p_user_id,
      v_application.business_name,
      v_application.contact_name,
      v_email,
      v_email,
      v_application.phone,
      v_application.address,
      v_application.address,
      v_application.business_type,
      'approved_not_activated',
      'approved_not_activated',
      CASE v_application.verification_status
        WHEN 'verified_low_risk' THEN 'basic_verified'
        WHEN 'needs_review' THEN 'needs_more_info'
        WHEN 'rejected' THEN 'failed'
        ELSE 'not_started'
      END,
      'approved_application_claim',
      50
    )
    RETURNING id INTO v_existing_business_id;
  ELSE
    SELECT b.owner_id
      INTO v_existing_owner_id
    FROM public.businesses b
    WHERE b.id = v_existing_business_id
    FOR UPDATE;

    IF v_existing_owner_id IS NULL THEN
      UPDATE public.businesses
        SET owner_id = p_user_id,
            updated_at = now()
      WHERE id = v_existing_business_id
        AND owner_id IS NULL;
    ELSIF v_existing_owner_id IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'APPROVED_APPLICATION_BUSINESS_OWNER_MISMATCH' USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.businesses
      SET name = COALESCE(NULLIF(btrim(v_application.business_name), ''), name),
          contact_name = COALESCE(NULLIF(btrim(v_application.contact_name), ''), contact_name),
          business_email = v_email,
          public_email = COALESCE(public_email, v_email),
          phone = COALESCE(v_application.phone, phone),
          address = COALESCE(v_application.address, address),
          location = COALESCE(v_application.address, location),
          category = COALESCE(v_application.business_type, category),
          status = 'approved_not_activated',
          access_level = 'approved_not_activated',
          verification_status = CASE v_application.verification_status
            WHEN 'verified_low_risk' THEN 'basic_verified'
            WHEN 'needs_review' THEN 'needs_more_info'
            WHEN 'rejected' THEN 'failed'
            ELSE verification_status
          END,
          updated_at = now()
    WHERE id = v_existing_business_id
      AND COALESCE(access_level, 'none') IN ('none', 'pending', 'approved_not_activated');
  END IF;

  v_onboarding_request_id := v_application.onboarding_request_id;
  IF v_onboarding_request_id IS NULL THEN
    INSERT INTO public.business_onboarding_requests (
      business_id,
      application_id,
      request_type,
      source,
      submitted_by_user_id,
      owner_name,
      owner_email,
      phone,
      business_name,
      business_address,
      business_type,
      website_or_instagram,
      best_slow_hours,
      promote_text,
      launch_area_confirmed,
      accepted_business_terms,
      accepted_privacy_policy,
      status,
      admin_review_status
    )
    VALUES (
      v_existing_business_id,
      v_application.id,
      'remote',
      'website',
      p_user_id,
      v_application.contact_name,
      v_email,
      v_application.phone,
      v_application.business_name,
      v_application.address,
      v_application.business_type,
      v_application.website_or_instagram,
      v_application.slow_hours,
      v_application.offer_interests,
      v_application.launch_area IS NOT NULL,
      COALESCE(v_application.terms_accepted, false),
      COALESCE(v_application.privacy_acknowledged, false),
      'approved_not_activated',
      'approved'
    )
    RETURNING id INTO v_onboarding_request_id;
  ELSE
    UPDATE public.business_onboarding_requests
      SET business_id = v_existing_business_id,
          submitted_by_user_id = p_user_id,
          owner_email = v_email,
          status = 'approved_not_activated',
          admin_review_status = 'approved',
          updated_at = now()
    WHERE id = v_onboarding_request_id;
  END IF;

  UPDATE public.business_applications
    SET claimed_by_user_id = p_user_id,
        claimed_at = COALESCE(claimed_at, now()),
        business_id = v_existing_business_id,
        onboarding_request_id = v_onboarding_request_id,
        access_tier = 'approved_not_activated',
        updated_at = now()
  WHERE id = v_application.id;

  UPDATE public.business_members
    SET display_name = v_application.contact_name,
        role = 'owner',
        status = 'active',
        source = 'approved_application_claim',
        linked_at = COALESCE(linked_at, now()),
        updated_at = now()
  WHERE business_id = v_existing_business_id
    AND user_id = p_user_id;

  IF NOT FOUND THEN
    UPDATE public.business_members
      SET user_id = p_user_id,
          display_name = v_application.contact_name,
          role = 'owner',
          status = 'active',
          source = 'approved_application_claim',
          linked_at = COALESCE(linked_at, now()),
          updated_at = now()
    WHERE business_id = v_existing_business_id
      AND lower(btrim(invited_email)) = v_email;
  END IF;

  IF NOT FOUND THEN
    INSERT INTO public.business_members (
      business_id,
      user_id,
      invited_email,
      display_name,
      role,
      status,
      source,
      linked_at
    )
    VALUES (
      v_existing_business_id,
      p_user_id,
      v_email,
      v_application.contact_name,
      'owner',
      'active',
      'approved_application_claim',
      now()
    );
  END IF;

  UPDATE public.business_profiles
    SET user_id = p_user_id,
        owner_id = p_user_id,
        name = v_application.business_name,
        address = v_application.address,
        category = v_application.business_type,
        updated_at = now()
  WHERE user_id = p_user_id OR owner_id = p_user_id;

  IF NOT FOUND THEN
    INSERT INTO public.business_profiles (
      user_id,
      owner_id,
      name,
      address,
      category,
      setup_completed,
      updated_at
    )
    VALUES (
      p_user_id,
      p_user_id,
      v_application.business_name,
      v_application.address,
      v_application.business_type,
      false,
      now()
    );
  END IF;

  INSERT INTO public.business_billing_profiles (
    business_id,
    billing_name,
    billing_email,
    billing_phone,
    billing_address_line1,
    billing_country,
    public_profile_source_business_id,
    billing_contact_user_id,
    billing_contact_name,
    onboarding_source,
    preferred_plan,
    stripe_sync_status,
    updated_at
  )
  VALUES (
    v_existing_business_id,
    v_application.business_name,
    v_email,
    v_application.phone,
    v_application.address,
    'US',
    v_existing_business_id,
    p_user_id,
    v_application.contact_name,
    'approved_application_claim',
    'twofer_pro_monthly',
    'not_synced',
    now()
  )
  ON CONFLICT (business_id)
  DO UPDATE SET
    billing_email = EXCLUDED.billing_email,
    billing_contact_user_id = EXCLUDED.billing_contact_user_id,
    billing_contact_name = EXCLUDED.billing_contact_name,
    updated_at = now();

  INSERT INTO public.business_subscriptions (
    business_id,
    billing_mode,
    billing_status,
    app_access_status,
    source,
    updated_at
  )
  VALUES (
    v_existing_business_id,
    'web_stripe',
    'none',
    'approved_not_activated',
    'approved_application_claim',
    now()
  )
  ON CONFLICT (business_id)
  DO UPDATE SET
    billing_mode = CASE
      WHEN public.business_subscriptions.activated_at IS NULL
        AND public.business_subscriptions.app_access_status IN ('pending', 'approved_not_activated')
        THEN 'web_stripe'
      ELSE public.business_subscriptions.billing_mode
    END,
    billing_status = CASE
      WHEN public.business_subscriptions.activated_at IS NULL
        AND public.business_subscriptions.app_access_status IN ('pending', 'approved_not_activated')
        THEN 'none'
      ELSE public.business_subscriptions.billing_status
    END,
    app_access_status = CASE
      WHEN public.business_subscriptions.activated_at IS NULL
        AND public.business_subscriptions.app_access_status IN ('pending', 'approved_not_activated')
        THEN 'approved_not_activated'
      ELSE public.business_subscriptions.app_access_status
    END,
    updated_at = now();

  SELECT
      bs.app_access_status,
      bs.trial_type,
      bs.trial_start,
      bs.trial_end,
      bs.current_period_start,
      bs.current_period_end,
      bs.cancel_at_period_end
    INTO v_subscription
  FROM public.business_subscriptions bs
  WHERE bs.business_id = v_existing_business_id;

  UPDATE public.business_applications ba
    SET status = CASE bs.app_access_status
          WHEN 'trial_limited' THEN 'trial_limited'
          WHEN 'trialing' THEN 'trial_active'
          WHEN 'active' THEN 'active'
          WHEN 'past_due_grace' THEN 'active'
          WHEN 'expired' THEN 'expired'
          WHEN 'canceled' THEN 'canceled'
          WHEN 'blocked' THEN 'suspended'
          WHEN 'suspended' THEN 'suspended'
          WHEN 'comped' THEN 'active'
          ELSE ba.status
        END,
        access_tier = CASE bs.app_access_status
          WHEN 'trial_limited' THEN 'trial_limited'
          WHEN 'trialing' THEN 'trialing'
          WHEN 'active' THEN 'active'
          WHEN 'past_due_grace' THEN 'active'
          WHEN 'expired' THEN 'expired'
          WHEN 'canceled' THEN 'canceled'
          WHEN 'blocked' THEN 'suspended'
          WHEN 'suspended' THEN 'suspended'
          WHEN 'comped' THEN 'active'
          ELSE ba.access_tier
        END,
        updated_at = now()
  FROM public.business_subscriptions bs
  WHERE ba.id = v_application.id
    AND bs.business_id = v_existing_business_id;

  SELECT bl.id
    INTO v_location_id
  FROM public.business_locations bl
  WHERE bl.business_id = v_existing_business_id
  ORDER BY bl.created_at, bl.id
  LIMIT 1
  FOR UPDATE;

  IF v_location_id IS NULL THEN
    INSERT INTO public.business_locations (business_id, name, address, phone)
    VALUES (
      v_existing_business_id,
      v_application.business_name || ' — main',
      COALESCE(NULLIF(btrim(v_application.address), ''), 'See business profile'),
      v_application.phone
    )
    RETURNING id INTO v_location_id;
  END IF;

  v_location_status := CASE v_subscription.app_access_status
    WHEN 'trial_limited' THEN 'admin_trial_active'
    WHEN 'trialing' THEN CASE
      WHEN v_subscription.trial_type = 'stripe_trial'
        THEN CASE WHEN COALESCE(v_subscription.cancel_at_period_end, false)
          THEN 'trial_canceling' ELSE 'trial_active' END
      ELSE 'admin_trial_active'
    END
    WHEN 'active' THEN CASE WHEN COALESCE(v_subscription.cancel_at_period_end, false)
      THEN 'pro_canceling' ELSE 'pro_active' END
    WHEN 'past_due_grace' THEN 'pro_active'
    WHEN 'expired' THEN 'canceled_suspended'
    WHEN 'canceled' THEN 'canceled_suspended'
    WHEN 'blocked' THEN 'canceled_suspended'
    WHEN 'suspended' THEN 'canceled_suspended'
    WHEN 'comped' THEN NULL
    ELSE 'trial_eligible'
  END;

  IF v_location_status IS NOT NULL THEN
    INSERT INTO public.location_entitlements (
      business_location_id,
      status,
      entitlement_provider,
      trial_started_at,
      trial_ends_at,
      current_period_started_at,
      current_period_ends_at,
      cancel_at_period_end,
      updated_at
    )
    VALUES (
      v_location_id,
      v_location_status,
      'stripe',
      v_subscription.trial_start,
      v_subscription.trial_end,
      v_subscription.current_period_start,
      v_subscription.current_period_end,
      COALESCE(v_subscription.cancel_at_period_end, false),
      now()
    )
    ON CONFLICT (business_location_id)
    DO UPDATE SET
      status = CASE
        WHEN public.location_entitlements.status IN ('trial_eligible', 'trial_checkout_pending')
          THEN EXCLUDED.status
        ELSE public.location_entitlements.status
      END,
      trial_started_at = COALESCE(
        public.location_entitlements.trial_started_at,
        EXCLUDED.trial_started_at
      ),
      trial_ends_at = COALESCE(
        public.location_entitlements.trial_ends_at,
        EXCLUDED.trial_ends_at
      ),
      current_period_started_at = COALESCE(
        public.location_entitlements.current_period_started_at,
        EXCLUDED.current_period_started_at
      ),
      current_period_ends_at = COALESCE(
        public.location_entitlements.current_period_ends_at,
        EXCLUDED.current_period_ends_at
      ),
      cancel_at_period_end = EXCLUDED.cancel_at_period_end,
      updated_at = now();
  END IF;

  INSERT INTO public.business_setup_ai_allowances (business_id)
  VALUES (v_existing_business_id)
  ON CONFLICT (business_id) DO NOTHING;

  application_id := v_application.id;
  onboarding_request_id := v_onboarding_request_id;
  business_id := v_existing_business_id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_approved_business_application_for_user(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_approved_business_application_for_user(uuid, text) TO service_role;

COMMENT ON FUNCTION public.claim_approved_business_application_for_user(uuid, text) IS
  'Service-role only, race-safe claim of exactly one approved_not_activated application for a confirmed auth email. Atomically materializes/links an inert setup workspace, profile, membership, billing shell, and trial-eligible location without trial dates, credits, access, or Stripe objects.';

CREATE OR REPLACE FUNCTION public.get_business_capabilities(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_business record;
  v_subscription record;
  v_publish jsonb;
  v_now timestamptz := now();
  v_is_member boolean := false;
  v_active_access boolean := false;
  v_setup_access boolean := false;
  v_lapsed_access boolean := false;
  v_suspended boolean := false;
  v_setup_menu_extractions_remaining integer := 0;
  v_reason text := 'not_authorized';
BEGIN
  SELECT b.id, b.owner_id, b.status, b.access_level
    INTO v_business
  FROM public.businesses b
  WHERE b.id = p_business_id;

  IF v_business.id IS NULL THEN
    RETURN jsonb_build_object(
      'reason_code', 'not_authorized',
      'can_edit_business_information', false,
      'can_use_setup_tools', false,
      'can_use_menu_tools', false,
      'can_extract_initial_menu', false,
      'can_create_text_draft', false,
      'can_generate_ai', false,
      'can_consume_offer_credits', false,
      'can_publish_offer', false,
      'can_receive_new_claims', false,
      'can_redeem_existing_claims', false,
      'can_manage_billing', false
    );
  END IF;

  IF COALESCE(auth.role(), '') = 'service_role'
    OR public.is_admin()
    OR v_business.owner_id = auth.uid()
    OR public.is_business_member(p_business_id)
  THEN
    v_is_member := true;
  END IF;

  IF NOT v_is_member THEN
    RETURN jsonb_build_object(
      'reason_code', 'not_authorized',
      'can_edit_business_information', false,
      'can_use_setup_tools', false,
      'can_use_menu_tools', false,
      'can_extract_initial_menu', false,
      'can_create_text_draft', false,
      'can_generate_ai', false,
      'can_consume_offer_credits', false,
      'can_publish_offer', false,
      'can_receive_new_claims', false,
      'can_redeem_existing_claims', false,
      'can_manage_billing', false
    );
  END IF;

  SELECT bs.*
    INTO v_subscription
  FROM public.business_subscriptions bs
  WHERE bs.business_id = p_business_id
  ORDER BY bs.updated_at DESC
  LIMIT 1;

  v_suspended := v_business.status IN ('suspended', 'disabled', 'rejected', 'archived')
    OR COALESCE(v_subscription.app_access_status, '') IN ('blocked', 'suspended');

  v_setup_access := NOT v_suspended
    AND (
      v_business.status = 'approved_not_activated'
      OR v_business.access_level = 'approved_not_activated'
      OR v_subscription.app_access_status = 'approved_not_activated'
    );

  v_active_access := NOT v_suspended
    AND NOT v_setup_access
    AND (
      v_business.access_level IN ('admin_comped', 'partner_comped', 'internal_test')
      OR (
        v_subscription.app_access_status IN ('trialing', 'trial_limited')
        AND COALESCE(v_subscription.trial_end, v_subscription.current_period_end) IS NOT NULL
        AND COALESCE(v_subscription.trial_end, v_subscription.current_period_end) > v_now
      )
      OR (
        v_subscription.app_access_status = 'active'
        AND v_subscription.billing_status = 'active'
      )
      OR (
        v_subscription.app_access_status = 'past_due_grace'
        AND COALESCE(v_subscription.grace_period_until, v_now - interval '1 second') > v_now
      )
    );

  v_lapsed_access := NOT v_suspended
    AND (
      v_business.status IN ('trial_expired', 'canceled')
      OR v_subscription.app_access_status IN ('expired', 'canceled')
    );

  v_publish := public.can_business_publish(p_business_id);
  SELECT GREATEST(0, allowance.menu_extractions_limit - allowance.menu_extractions_used)
    INTO v_setup_menu_extractions_remaining
  FROM public.business_setup_ai_allowances allowance
  WHERE allowance.business_id = p_business_id;
  v_setup_menu_extractions_remaining := COALESCE(
    v_setup_menu_extractions_remaining,
    CASE WHEN v_setup_access THEN 1 ELSE 0 END
  );

  v_reason := CASE
    WHEN v_suspended THEN 'suspended'
    WHEN v_active_access THEN 'active'
    WHEN v_setup_access THEN 'approved_not_activated'
    WHEN v_lapsed_access THEN 'lapsed'
    ELSE COALESCE(v_publish ->> 'reason_code', v_publish ->> 'reason', 'pending_verification')
  END;

  RETURN jsonb_build_object(
    'reason_code', v_reason,
    'can_edit_business_information', NOT v_suspended AND (v_setup_access OR v_active_access OR v_lapsed_access),
    'can_use_setup_tools', v_setup_access OR v_active_access,
    'can_use_menu_tools', v_setup_access OR v_active_access OR v_lapsed_access,
    'can_extract_initial_menu', v_active_access OR (v_setup_access AND v_setup_menu_extractions_remaining > 0),
    'setup_menu_extractions_remaining', CASE
      WHEN v_active_access THEN NULL
      ELSE v_setup_menu_extractions_remaining
    END,
    'can_create_text_draft', v_setup_access OR v_active_access OR v_lapsed_access,
    'can_generate_ai', v_active_access,
    'can_consume_offer_credits', v_active_access,
    'can_publish_offer', v_active_access AND COALESCE((v_publish ->> 'canPublish')::boolean, false),
    'can_receive_new_claims', v_active_access AND COALESCE((v_publish ->> 'canPublish')::boolean, false),
    'can_redeem_existing_claims', v_active_access OR v_lapsed_access,
    'can_manage_billing', NOT v_suspended AND (v_setup_access OR v_active_access OR v_lapsed_access),
    'publish', v_publish
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_business_capabilities(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_business_capabilities(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_business_capabilities(uuid) IS
  'Canonical server capability evaluator for setup/menu/text-draft/AI/publish/claim/redeem/billing gates. approved_not_activated permits setup only; AI, credits, publishing, and new claims require active access.';

CREATE OR REPLACE FUNCTION public.enforce_business_workspace_capability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_capabilities jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'authenticated' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    RAISE EXCEPTION 'APPROVED_APPLICATION_CLAIM_REQUIRED'
      USING ERRCODE = 'P0001';
  END IF;

  v_capabilities := public.get_business_capabilities(OLD.id);
  IF NOT COALESCE(
    (v_capabilities ->> 'can_edit_business_information')::boolean,
    false
  ) THEN
    RAISE EXCEPTION 'BUSINESS_PROFILE_EDIT_CAPABILITY_REQUIRED'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_business_workspace_capability
  ON public.businesses;
CREATE TRIGGER enforce_business_workspace_capability
  BEFORE INSERT OR UPDATE ON public.businesses
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_business_workspace_capability();

CREATE OR REPLACE FUNCTION public.enforce_business_menu_capability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_business_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.business_id ELSE NEW.business_id END;
  v_capabilities jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'authenticated' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  v_capabilities := public.get_business_capabilities(v_business_id);
  IF NOT COALESCE((v_capabilities ->> 'can_use_menu_tools')::boolean, false) THEN
    RAISE EXCEPTION 'BUSINESS_MENU_CAPABILITY_REQUIRED'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS enforce_business_menu_capability
  ON public.business_menu_items;
CREATE TRIGGER enforce_business_menu_capability
  BEFORE INSERT OR UPDATE OR DELETE ON public.business_menu_items
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_business_menu_capability();

DROP POLICY IF EXISTS business_deal_drafts_owner_select ON public.business_deal_drafts;
CREATE POLICY business_deal_drafts_owner_select
  ON public.business_deal_drafts
  FOR SELECT TO authenticated
  USING (owner_user_id = auth.uid() AND public.is_business_owner(business_id));
DROP POLICY IF EXISTS business_deal_drafts_owner_insert ON public.business_deal_drafts;
CREATE POLICY business_deal_drafts_owner_insert
  ON public.business_deal_drafts
  FOR INSERT TO authenticated
  WITH CHECK (
    owner_user_id = auth.uid()
    AND public.is_business_owner(business_id)
    AND COALESCE(
      (public.get_business_capabilities(business_id) ->> 'can_create_text_draft')::boolean,
      false
    )
  );
DROP POLICY IF EXISTS business_deal_drafts_owner_update ON public.business_deal_drafts;
CREATE POLICY business_deal_drafts_owner_update
  ON public.business_deal_drafts
  FOR UPDATE TO authenticated
  USING (owner_user_id = auth.uid() AND public.is_business_owner(business_id))
  WITH CHECK (
    owner_user_id = auth.uid()
    AND public.is_business_owner(business_id)
    AND COALESCE(
      (public.get_business_capabilities(business_id) ->> 'can_create_text_draft')::boolean,
      false
    )
  );

CREATE OR REPLACE FUNCTION public.consume_setup_menu_extraction_allowance(p_business_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_capabilities jsonb;
  v_allowance public.business_setup_ai_allowances%ROWTYPE;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('setup_menu_extraction:' || p_business_id::text));
  v_capabilities := public.get_business_capabilities(p_business_id);

  IF COALESCE((v_capabilities ->> 'can_generate_ai')::boolean, false) THEN
    RETURN true;
  END IF;
  IF NOT COALESCE((v_capabilities ->> 'can_extract_initial_menu')::boolean, false) THEN
    RETURN false;
  END IF;

  INSERT INTO public.business_setup_ai_allowances (business_id)
  VALUES (p_business_id)
  ON CONFLICT (business_id) DO NOTHING;

  SELECT *
    INTO v_allowance
  FROM public.business_setup_ai_allowances
  WHERE business_id = p_business_id
  FOR UPDATE;

  IF v_allowance.menu_extractions_used >= v_allowance.menu_extractions_limit THEN
    RETURN false;
  END IF;

  UPDATE public.business_setup_ai_allowances
    SET menu_extractions_used = menu_extractions_used + 1,
        updated_at = now()
  WHERE business_id = p_business_id;
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_setup_menu_extraction_allowance(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_setup_menu_extraction_allowance(uuid)
  TO service_role;

CREATE OR REPLACE FUNCTION public.enforce_live_deal_business_capability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_capabilities jsonb;
BEGIN
  IF COALESCE(NEW.is_active, false) THEN
    v_capabilities := public.get_business_capabilities(NEW.business_id);
    IF NOT COALESCE((v_capabilities ->> 'can_publish_offer')::boolean, false) THEN
      RAISE EXCEPTION 'BUSINESS_PUBLISH_CAPABILITY_REQUIRED'
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_live_deal_business_capability ON public.deals;
CREATE TRIGGER enforce_live_deal_business_capability
  BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_live_deal_business_capability();

CREATE OR REPLACE FUNCTION public.enforce_new_claim_business_capability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_business_id uuid;
  v_capabilities jsonb;
BEGIN
  SELECT d.business_id
    INTO v_business_id
  FROM public.deals d
  WHERE d.id = NEW.deal_id;
  v_capabilities := public.get_business_capabilities(v_business_id);
  IF NOT COALESCE((v_capabilities ->> 'can_receive_new_claims')::boolean, false) THEN
    RAISE EXCEPTION 'BUSINESS_NEW_CLAIM_CAPABILITY_REQUIRED'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_new_claim_business_capability ON public.deal_claims;
CREATE TRIGGER enforce_new_claim_business_capability
  BEFORE INSERT ON public.deal_claims
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_new_claim_business_capability();

CREATE OR REPLACE FUNCTION public.enforce_credit_reservation_business_capability()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_business_id uuid;
  v_capabilities jsonb;
BEGIN
  SELECT bl.business_id
    INTO v_business_id
  FROM public.business_locations bl
  WHERE bl.id = NEW.business_location_id;
  v_capabilities := public.get_business_capabilities(v_business_id);
  IF NOT COALESCE((v_capabilities ->> 'can_consume_offer_credits')::boolean, false) THEN
    RAISE EXCEPTION 'BUSINESS_OFFER_CREDIT_CAPABILITY_REQUIRED'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_credit_reservation_business_capability
  ON public.deal_credit_reservations;
CREATE TRIGGER enforce_credit_reservation_business_capability
  BEFORE INSERT ON public.deal_credit_reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_credit_reservation_business_capability();

CREATE OR REPLACE FUNCTION public.activate_business_trial_from_checkout(
  p_business_id uuid,
  p_application_id uuid,
  p_checkout_session_id text,
  p_provider_event_id text,
  p_provider_event_created_at timestamptz,
  p_stripe_customer_id text,
  p_stripe_subscription_id text,
  p_stripe_product_id text,
  p_stripe_price_id text,
  p_trial_start timestamptz,
  p_trial_end timestamptz,
  p_current_period_start timestamptz,
  p_current_period_end timestamptz,
  p_cancel_at_period_end boolean,
  p_livemode boolean,
  p_checkout_mode text,
  p_checkout_status text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_application public.business_applications%ROWTYPE;
  v_business public.businesses%ROWTYPE;
  v_subscription public.business_subscriptions%ROWTYPE;
  v_checkout public.stripe_checkout_sessions%ROWTYPE;
  v_billing_profile public.business_billing_profiles%ROWTYPE;
  v_location_id uuid;
  v_billing_account_id uuid;
  v_credit_period_id uuid;
  v_config record;
  v_allowance integer;
  v_external_reference text;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = 'P0001';
  END IF;
  IF p_business_id IS NULL
    OR p_application_id IS NULL
    OR nullif(btrim(p_checkout_session_id), '') IS NULL
    OR nullif(btrim(p_provider_event_id), '') IS NULL
    OR nullif(btrim(p_stripe_customer_id), '') IS NULL
    OR nullif(btrim(p_stripe_subscription_id), '') IS NULL
    OR nullif(btrim(p_stripe_price_id), '') IS NULL
  THEN
    RAISE EXCEPTION 'ACTIVATION_IDENTIFIERS_REQUIRED' USING ERRCODE = '22023';
  END IF;
  IF p_checkout_mode <> 'subscription' OR p_checkout_status <> 'complete' THEN
    RAISE EXCEPTION 'INVALID_ACTIVATION_CHECKOUT_STATE' USING ERRCODE = 'P0001';
  END IF;
  IF p_trial_start IS NULL
    OR p_trial_end IS NULL
    OR p_trial_end <= p_trial_start
    OR p_trial_end < p_trial_start + interval '29 days'
    OR p_trial_end > p_trial_start + interval '31 days'
  THEN
    RAISE EXCEPTION 'INVALID_STRIPE_TRIAL_WINDOW' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext('business_trial_activation:' || p_business_id::text));

  SELECT *
    INTO v_business
  FROM public.businesses
  WHERE id = p_business_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'BUSINESS_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_application
  FROM public.business_applications
  WHERE id = p_application_id
    AND business_id = p_business_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_application.status <> 'approved_not_activated'
    OR v_application.claimed_by_user_id IS NULL
    OR v_application.claimed_by_user_id IS DISTINCT FROM v_business.owner_id
  THEN
    RAISE EXCEPTION 'APPROVED_APPLICATION_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_checkout
  FROM public.stripe_checkout_sessions
  WHERE stripe_checkout_session_id = p_checkout_session_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_checkout.business_id <> p_business_id
    OR v_checkout.status NOT IN ('created', 'opened', 'completed')
    OR v_checkout.mode <> 'subscription'
    OR COALESCE(v_checkout.metadata ->> 'checkout_purpose', '') <> 'trial_start'
    OR COALESCE(v_checkout.metadata ->> 'application_id', '') <> p_application_id::text
    OR v_checkout.stripe_customer_id <> p_stripe_customer_id
    OR v_checkout.price_id <> p_stripe_price_id
  THEN
    RAISE EXCEPTION 'LOCAL_CHECKOUT_SESSION_VALIDATION_FAILED' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_billing_profile
  FROM public.business_billing_profiles
  WHERE business_id = p_business_id
  FOR UPDATE;
  IF NOT FOUND
    OR v_billing_profile.stripe_customer_id IS DISTINCT FROM p_stripe_customer_id
    OR v_billing_profile.stripe_customer_livemode IS DISTINCT FROM p_livemode
  THEN
    RAISE EXCEPTION 'STRIPE_CUSTOMER_MISMATCH' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_subscription
  FROM public.business_subscriptions
  WHERE business_id = p_business_id
  FOR UPDATE;

  IF FOUND AND v_subscription.activated_at IS NOT NULL THEN
    IF v_subscription.activation_checkout_session_id = p_checkout_session_id
      AND v_subscription.activation_provider_event_id = p_provider_event_id
    THEN
      RETURN jsonb_build_object(
        'activated', true,
        'duplicate', true,
        'business_id', p_business_id,
        'credit_period_id', (
          SELECT dcp.id
          FROM public.deal_credit_periods dcp
          WHERE dcp.external_reference = 'stripe_trial:' || p_checkout_session_id
        )
      );
    END IF;
    RAISE EXCEPTION 'BUSINESS_TRIAL_ALREADY_ACTIVATED' USING ERRCODE = 'P0001';
  END IF;

  IF v_business.status <> 'approved_not_activated'
    OR v_business.access_level <> 'approved_not_activated'
    OR (FOUND AND v_subscription.app_access_status <> 'approved_not_activated')
  THEN
    RAISE EXCEPTION 'BUSINESS_NOT_APPROVED_FOR_ACTIVATION' USING ERRCODE = 'P0001';
  END IF;

  SELECT bl.id
    INTO v_location_id
  FROM public.business_locations bl
  WHERE bl.business_id = p_business_id
  ORDER BY bl.created_at, bl.id
  LIMIT 1
  FOR UPDATE;
  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'PRIMARY_BUSINESS_LOCATION_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.business_location_identity bli
    WHERE bli.business_location_id = v_location_id
      AND bli.trial_used_at IS NOT NULL
  ) OR EXISTS (
    SELECT 1
    FROM public.deal_credit_periods dcp
    WHERE dcp.business_location_id = v_location_id
      AND dcp.source IN ('trial', 'admin_trial')
  ) THEN
    RAISE EXCEPTION 'TRIAL_ALREADY_USED' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO public.billing_accounts (
    owner_user_id,
    provider,
    provider_customer_id,
    updated_at
  )
  VALUES (
    v_business.owner_id,
    'stripe',
    p_stripe_customer_id,
    now()
  )
  ON CONFLICT (owner_user_id)
  DO UPDATE SET
    provider = 'stripe',
    provider_customer_id = EXCLUDED.provider_customer_id,
    updated_at = now()
  RETURNING id INTO v_billing_account_id;

  INSERT INTO public.business_subscriptions (
    business_id,
    stripe_customer_id,
    stripe_subscription_id,
    stripe_product_id,
    stripe_price_id,
    billing_mode,
    billing_status,
    app_access_status,
    trial_type,
    trial_start,
    trial_end,
    current_period_start,
    current_period_end,
    cancel_at_period_end,
    activated_at,
    activation_checkout_session_id,
    activation_provider_event_id,
    last_provider_event_created_at,
    last_provider_event_id,
    source,
    metadata,
    updated_at
  )
  VALUES (
    p_business_id,
    p_stripe_customer_id,
    p_stripe_subscription_id,
    p_stripe_product_id,
    p_stripe_price_id,
    'web_stripe',
    'trialing',
    'trialing',
    'stripe_trial',
    p_trial_start,
    p_trial_end,
    COALESCE(p_current_period_start, p_trial_start),
    COALESCE(p_current_period_end, p_trial_end),
    COALESCE(p_cancel_at_period_end, false),
    now(),
    p_checkout_session_id,
    p_provider_event_id,
    p_provider_event_created_at,
    p_provider_event_id,
    'stripe_webhook',
    jsonb_build_object('checkout_purpose', 'trial_start'),
    now()
  )
  ON CONFLICT (business_id)
  DO UPDATE SET
    stripe_customer_id = EXCLUDED.stripe_customer_id,
    stripe_subscription_id = EXCLUDED.stripe_subscription_id,
    stripe_product_id = EXCLUDED.stripe_product_id,
    stripe_price_id = EXCLUDED.stripe_price_id,
    billing_mode = EXCLUDED.billing_mode,
    billing_status = EXCLUDED.billing_status,
    app_access_status = EXCLUDED.app_access_status,
    trial_type = EXCLUDED.trial_type,
    trial_start = EXCLUDED.trial_start,
    trial_end = EXCLUDED.trial_end,
    current_period_start = EXCLUDED.current_period_start,
    current_period_end = EXCLUDED.current_period_end,
    cancel_at_period_end = EXCLUDED.cancel_at_period_end,
    activated_at = EXCLUDED.activated_at,
    activation_checkout_session_id = EXCLUDED.activation_checkout_session_id,
    activation_provider_event_id = EXCLUDED.activation_provider_event_id,
    last_provider_event_created_at = EXCLUDED.last_provider_event_created_at,
    last_provider_event_id = EXCLUDED.last_provider_event_id,
    source = EXCLUDED.source,
    metadata = EXCLUDED.metadata,
    updated_at = now();

  UPDATE public.businesses
    SET status = 'trialing',
        access_level = 'full_trial',
        updated_at = now()
  WHERE id = p_business_id;

  UPDATE public.business_applications
    SET status = 'trial_active',
        access_tier = 'trialing',
        updated_at = now()
  WHERE id = p_application_id;

  INSERT INTO public.location_entitlements (
    business_location_id,
    billing_account_id,
    status,
    entitlement_provider,
    trial_started_at,
    trial_ends_at,
    current_period_started_at,
    current_period_ends_at,
    cancel_at_period_end,
    suspended_at,
    suspension_reason,
    provider_subscription_id,
    provider_price_id,
    updated_at
  )
  VALUES (
    v_location_id,
    v_billing_account_id,
    'trial_active',
    'stripe',
    p_trial_start,
    p_trial_end,
    COALESCE(p_current_period_start, p_trial_start),
    COALESCE(p_current_period_end, p_trial_end),
    COALESCE(p_cancel_at_period_end, false),
    NULL,
    NULL,
    p_stripe_subscription_id,
    p_stripe_price_id,
    now()
  )
  ON CONFLICT (business_location_id)
  DO UPDATE SET
    billing_account_id = EXCLUDED.billing_account_id,
    status = EXCLUDED.status,
    entitlement_provider = EXCLUDED.entitlement_provider,
    trial_started_at = EXCLUDED.trial_started_at,
    trial_ends_at = EXCLUDED.trial_ends_at,
    current_period_started_at = EXCLUDED.current_period_started_at,
    current_period_ends_at = EXCLUDED.current_period_ends_at,
    cancel_at_period_end = EXCLUDED.cancel_at_period_end,
    suspended_at = NULL,
    suspension_reason = NULL,
    provider_subscription_id = EXCLUDED.provider_subscription_id,
    provider_price_id = EXCLUDED.provider_price_id,
    updated_at = now();

  INSERT INTO public.business_location_identity (
    business_location_id,
    trial_used_at,
    trial_started_by_user_id,
    updated_at
  )
  VALUES (v_location_id, p_trial_start, v_business.owner_id, now())
  ON CONFLICT (business_location_id)
  DO UPDATE SET
    trial_used_at = COALESCE(public.business_location_identity.trial_used_at, EXCLUDED.trial_used_at),
    trial_started_by_user_id = COALESCE(
      public.business_location_identity.trial_started_by_user_id,
      EXCLUDED.trial_started_by_user_id
    ),
    updated_at = now();

  SELECT *
    INTO v_config
  FROM public.get_runtime_billing_config()
  LIMIT 1;
  v_allowance := COALESCE(v_config.trial_deal_credit_allowance, 30);
  v_external_reference := 'stripe_trial:' || p_checkout_session_id;

  INSERT INTO public.deal_credit_periods (
    business_location_id,
    source,
    status,
    starts_at,
    ends_at,
    credits_granted,
    configuration_snapshot,
    external_reference
  )
  VALUES (
    v_location_id,
    'trial',
    'active',
    p_trial_start,
    p_trial_end,
    v_allowance,
    jsonb_build_object(
      'trial_deal_credit_allowance', v_allowance,
      'provider_subscription_id', p_stripe_subscription_id,
      'checkout_session_id', p_checkout_session_id,
      'provider_event_id', p_provider_event_id,
      'granted_at', now()
    ),
    v_external_reference
  )
  RETURNING id INTO v_credit_period_id;

  INSERT INTO public.deal_credit_ledger (
    business_location_id,
    credit_period_id,
    event_type,
    purpose,
    amount,
    idempotency_key,
    metadata
  )
  VALUES (
    v_location_id,
    v_credit_period_id,
    'grant',
    'stripe_trial',
    v_allowance,
    v_external_reference,
    jsonb_build_object(
      'provider', 'stripe',
      'subscription_id', p_stripe_subscription_id,
      'checkout_session_id', p_checkout_session_id
    )
  );

  UPDATE public.stripe_checkout_sessions
    SET stripe_subscription_id = p_stripe_subscription_id,
        status = 'completed',
        completed_at = now(),
        updated_at = now()
  WHERE id = v_checkout.id;

  UPDATE public.business_billing_profiles
    SET stripe_customer_id = p_stripe_customer_id,
        stripe_customer_livemode = p_livemode,
        stripe_sync_status = 'synced',
        stripe_sync_error = NULL,
        last_synced_from_stripe_at = now(),
        updated_at = now()
  WHERE business_id = p_business_id;

  RETURN jsonb_build_object(
    'activated', true,
    'duplicate', false,
    'business_id', p_business_id,
    'application_id', p_application_id,
    'location_id', v_location_id,
    'credit_period_id', v_credit_period_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.activate_business_trial_from_checkout(
  uuid, uuid, text, text, timestamptz, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, boolean,
  boolean, text, text
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_business_trial_from_checkout(
  uuid, uuid, text, text, timestamptz, text, text, text, text,
  timestamptz, timestamptz, timestamptz, timestamptz, boolean,
  boolean, text, text
) TO service_role;

COMMIT;
