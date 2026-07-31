-- Restore the #variable_conflict fix for claim_approved_business_application_for_user.
--
-- See the in-function comment: the 42702 ambiguity blocked every approved
-- merchant from claiming a workspace. It was reverted earlier today after a
-- misdiagnosis -- the 500 that followed came from the missing
-- business_locations.updated_at column (fixed in 20260822150000), not from this
-- pragma. The trial_active widening is deliberately NOT restored: on the
-- link-existing-business path the claim rewrites businesses.status and would
-- downgrade a live trialing business, which was reproduced on the test project.
-- F-21 therefore stays open pending a claim that leaves activated businesses alone.

BEGIN;

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
-- Resolve ambiguous identifiers to the COLUMN, not the OUT parameter.
--
-- RETURNS TABLE declares application_id / onboarding_request_id / business_id as
-- PL/pgSQL variables, and this body's INSERT column lists and ON CONFLICT
-- (business_id) targets name those same columns, so Postgres raises
-- 42702 "column reference business_id is ambiguous" and the claim dies before it
-- can materialize a workspace. That blocked EVERY newly approved merchant.
--
-- This was briefly applied and then reverted on 2026-07-24 because the merchant
-- dashboard started returning 500. That 500 was NOT this pragma: it was
-- business_locations.updated_at, a column the dashboard has always selected but
-- which never existed (added in 20260822150000). The pragma merely let the claim
-- succeed for the first time, which is what finally reached the broken query.
-- With the column in place the whole path works, so the fix is restored here.
--
-- Safe: every ambiguous site in this body is an INSERT column list or an
-- ON CONFLICT target that means the column, and the OUT parameters are only
-- assigned (:=) at the very end, which this pragma does not affect.
#variable_conflict use_column
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

COMMIT;
