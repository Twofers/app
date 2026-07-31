-- The claim LINKS an already-activated business instead of rewriting it.
--
-- Problem this closes (F-21). claim_approved_business_application_for_user has
-- always had two shapes: "the business does not exist yet, so create it" and
-- "the business already exists, so link it". The second shape was implemented by
-- rewriting the business back into setup state -- correct for a business that is
-- genuinely still in setup, actively harmful for one that is trialing, paying or
-- comped.
--
-- Why that is worse than a relabelled row: get_business_capabilities
-- (20260817120000) evaluates setup access FIRST and defines active access as
-- "NOT setup access":
--
--   v_setup_access  := ... business.status = 'approved_not_activated'
--                       OR business.access_level = 'approved_not_activated'
--                       OR subscription.app_access_status = 'approved_not_activated';
--   v_active_access := NOT v_suspended AND NOT v_setup_access AND ( ...trial/paid/comped... );
--
-- The link path set BOTH businesses.status AND businesses.access_level to
-- 'approved_not_activated', so that single UPDATE switched off can_publish_offer,
-- can_generate_ai and can_receive_new_claims for a live business.
--
-- A cleanly activated business was protected by the UPDATE's existing narrow
-- guard (access_level IN none/pending/approved_not_activated), because activation
-- sets access_level to 'full_trial' / 'paid' / a comped level. The businesses that
-- got hurt are the DRIFTED ones -- access_level still NULL or approved_not_activated
-- while the subscription already says trialing/comped -- which is exactly the shape
-- observed in production on 2026-07-24 (businesses.status = trialing, application
-- status = trial_active, claimed_by_user_id NULL).
--
-- That is why the trial_active widening was reverted in 20260822130000 and left
-- out of 20260822160000: widening WHO may reach the link path, while the link path
-- still rewrote state, would have downgraded a live business. This migration fixes
-- the link path first, then restores the widening -- in that order, in one change.
--
-- What changes:
--   1. New v_already_activated flag, derived subscription-first (the billing source
--      of truth that get_business_capabilities itself reads), with businesses
--      access_level/status as a secondary signal for comped and drifted rows.
--   2. When it is TRUE, the claim stamps the linkage and stops: no businesses
--      rewrite, no business_subscriptions write, no location_entitlements write, no
--      onboarding-status rewrite, no access_tier reset, and no overwrite of an
--      existing business_profiles row.
--   3. When it is FALSE, behaviour is byte-identical to 20260822160000. The normal
--      onboarding path -- the one just fixed and verified in production -- does not
--      move at all.
--   4. The fresh-claim predicate now also accepts the four "active-looking"
--      application statuses that admin-dashboard-summary already recognises
--      (trial_active, trial_limited, approved_not_billed, active), so a comped or
--      already-paying owner can claim. Safe only because of (2).
--
-- What deliberately does NOT change:
--   * The already-claimed branch (path 1) and its early return.
--   * The owner-conflict guard (v_existing_owner_id IS DISTINCT FROM p_user_id ->
--     RETURN / OWNER_MISMATCH). This changes WHEN a legitimate owner may claim,
--     never WHO may claim.
--   * The #variable_conflict use_column pragma, which is load-bearing (F-23) --
--     without it every approved merchant's first sign-in dies on
--     42702 "column reference business_id is ambiguous".
--
-- Rollback: re-apply 20260822160000. Function body only -- no tables, columns,
-- policies, grants or data backfill are touched, so rollback is one statement.
--
-- After applying: node scripts/db-tests/2i-claim-links-activated-business.mjs
--                 npm run test:db
-- (probe-rls-smoke.mjs and probe-merchant-surfaces.mjs read .env /
--  .env.development.local, which point at PRODUCTION -- they are prod-verification
--  tools and must NOT be used to validate a test-project apply.)

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
-- The 500 that briefly followed this pragma on 2026-07-24 was NOT the pragma: it
-- was business_locations.updated_at, a column the dashboard has always selected
-- but which never existed (added in 20260822150000). The pragma merely let the
-- claim succeed for the first time, which is what finally reached the broken query.
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
  -- TRUE when the resolved business is already past setup (trialing, paying,
  -- comped, or lapsed). Drives the link-only branch.
  v_already_activated boolean := false;
  v_business_status text;
  v_business_access_level text;
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

  -- Fresh-claim match. The status list also accepts the four "active-looking"
  -- statuses that admin-dashboard-summary treats as active, so a comped or
  -- already-paying owner whose application advanced before their first sign-in
  -- can still claim. Both this count(*) and the SELECT ... FOR UPDATE below must
  -- carry an IDENTICAL predicate.
  SELECT count(*)
    INTO v_match_count
  FROM public.business_applications ba
  WHERE COALESCE(ba.approved_email_normalized, lower(btrim(ba.email))) = v_email
    AND ba.status IN (
      'approved_not_activated',
      'trial_active',
      'trial_limited',
      'approved_not_billed',
      'active'
    )
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
    AND ba.status IN (
      'approved_not_activated',
      'trial_active',
      'trial_limited',
      'approved_not_billed',
      'active'
    )
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

  -- Is the business we are about to link already past setup?
  --
  -- Subscription first: business_subscriptions is the billing source of truth and
  -- is what get_business_capabilities reads. businesses.access_level is the derived
  -- mirror and is precisely the column that drifts, so it is a secondary signal
  -- rather than the primary one -- but it still has to be consulted, because a
  -- comped business can carry a comped access_level with no meaningful subscription
  -- row, and because get_business_capabilities grants active access on access_level
  -- alone for the three comped levels.
  --
  -- Lapsed states (trial_expired / canceled / expired) count as activated on
  -- purpose: a merchant whose trial ended is PAST setup, and silently rewriting
  -- them to approved_not_activated would hand them setup access back and contradict
  -- the billing gate.
  IF v_existing_business_id IS NOT NULL THEN
    SELECT b.status, b.access_level
      INTO v_business_status, v_business_access_level
    FROM public.businesses b
    WHERE b.id = v_existing_business_id;

    SELECT COALESCE(
             bs.activated_at IS NOT NULL
               OR COALESCE(bs.app_access_status, '') NOT IN (
                 '',
                 'pending',
                 'approved_not_activated'
               ),
             false
           )
      INTO v_already_activated
    FROM public.business_subscriptions bs
    WHERE bs.business_id = v_existing_business_id;

    v_already_activated := COALESCE(v_already_activated, false)
      OR COALESCE(v_business_access_level, '') IN (
        'paid',
        'full_trial',
        'limited_trial',
        'admin_comped',
        'partner_comped',
        'internal_test'
      )
      OR COALESCE(v_business_status, '') IN (
        'trialing',
        'active',
        'trial_expired',
        'canceled'
      );
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

    -- Owner adoption and the conflict guard run for BOTH branches: an activated
    -- business with no owner is still adoptable, and someone else's business is
    -- still refused.
    IF v_existing_owner_id IS NULL THEN
      UPDATE public.businesses
        SET owner_id = p_user_id,
            updated_at = now()
      WHERE id = v_existing_business_id
        AND owner_id IS NULL;
    ELSIF v_existing_owner_id IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'APPROVED_APPLICATION_BUSINESS_OWNER_MISMATCH' USING ERRCODE = 'P0001';
    END IF;

    -- LINK-ONLY: never re-seed an activated business from a months-old
    -- application form. Beyond the status/access_level downgrade this also
    -- protected the merchant's own edits -- notably the name, which has a whole
    -- deliberate change-request system behind it (20260816120000).
    IF NOT v_already_activated THEN
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
      -- An activated business is already materialized; saying
      -- 'approved_not_activated' here would describe it as still in setup.
      -- 'materialized' is the value business-onboarding-sync.ts already uses once
      -- a business exists.
      CASE WHEN v_already_activated THEN 'materialized' ELSE 'approved_not_activated' END,
      'approved'
    )
    RETURNING id INTO v_onboarding_request_id;
  ELSIF v_already_activated THEN
    -- Link the request to the business and the claiming user, but leave its
    -- lifecycle status alone.
    UPDATE public.business_onboarding_requests
      SET business_id = v_existing_business_id,
          submitted_by_user_id = p_user_id,
          owner_email = v_email,
          updated_at = now()
    WHERE id = v_onboarding_request_id;
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

  -- The linkage stamp itself -- the entire point of the claim. access_tier is
  -- preserved for an activated application instead of being reset to
  -- approved_not_activated; the subscription-derived block further down sets it
  -- from the real subscription.
  UPDATE public.business_applications
    SET claimed_by_user_id = p_user_id,
        claimed_at = COALESCE(claimed_at, now()),
        business_id = v_existing_business_id,
        onboarding_request_id = v_onboarding_request_id,
        access_tier = CASE
          WHEN v_already_activated THEN access_tier
          ELSE 'approved_not_activated'
        END,
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

  -- For an activated business, ensure a profile exists but never overwrite one:
  -- the merchant's own edits outrank the application form.
  IF v_already_activated THEN
    PERFORM 1
    FROM public.business_profiles bp
    WHERE bp.user_id = p_user_id OR bp.owner_id = p_user_id;
  ELSE
    UPDATE public.business_profiles
      SET user_id = p_user_id,
          owner_id = p_user_id,
          name = v_application.business_name,
          address = v_application.address,
          category = v_application.business_type,
          updated_at = now()
    WHERE user_id = p_user_id OR owner_id = p_user_id;
  END IF;

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
  -- billing_contact_user_id is linkage (who owns this workspace) and is always
  -- stamped. billing_email / billing_contact_name are billing DETAILS: on an
  -- activated account they may have been set through Stripe or edited by the
  -- merchant, and a months-old application form must not overwrite them.
  ON CONFLICT (business_id)
  DO UPDATE SET
    billing_email = CASE
      WHEN v_already_activated THEN public.business_billing_profiles.billing_email
      ELSE EXCLUDED.billing_email
    END,
    billing_contact_user_id = EXCLUDED.billing_contact_user_id,
    billing_contact_name = CASE
      WHEN v_already_activated THEN public.business_billing_profiles.billing_contact_name
      ELSE EXCLUDED.billing_contact_name
    END,
    updated_at = now();

  -- Billing state: an activated business already has one. The upsert's own guard
  -- would have spared it, but the claim has no business writing billing rows for a
  -- live account at all, so skip it outright.
  IF NOT v_already_activated THEN
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
  END IF;

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

  -- Bring the application row into line with the real subscription. This RAISES
  -- an out-of-date application to its true tier; it never downgrades, so it runs
  -- for both branches and is what finally clears the "application says pending
  -- while the business is trialing" split that caused the lockout.
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

  -- Locations and entitlements: an activated business already has both, and its
  -- entitlement carries live trial/period dates. Creating or touching either here
  -- can only drift it away from what Stripe and the admin grant path wrote.
  IF NOT v_already_activated THEN
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
  'Service-role only, race-safe claim of exactly one approved or active-looking application for a confirmed auth email. Materializes an inert setup workspace when none exists; when the business is already activated (trialing, paying, comped or lapsed) it LINKS ONLY -- stamping the application, membership and profile without touching business status, billing, entitlements or locations.';

COMMIT;
