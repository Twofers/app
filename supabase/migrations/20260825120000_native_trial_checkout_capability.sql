-- Server-driven visibility for the native merchant trial Checkout button.
--
-- Before this migration, button visibility was decided by a client env flag
-- baked into the binary (EXPO_PUBLIC_ENABLE_IOS_TRIAL_CHECKOUT) while success
-- was decided by the `ios_trial_checkout` feature flag the client never read.
-- The two could disagree, and in 1.0.2 they did: iOS rendered a button that the
-- server refused, and Android rendered nothing at all. Capability-dark should
-- be dark, not broken.
--
-- `get_business_capabilities` now returns `can_activate_trial_checkout`, so the
-- kill switch hides the button instead of breaking it, and works in BOTH
-- directions with no app rebuild.
--
-- NOTE ON THE FLAG KEY: `ios_trial_checkout` is deliberately NOT renamed even
-- though the capability now covers Android too. Renaming while a flip is
-- pending risks enabling one row while deployed code reads another, and
-- rewriting that row via ON CONFLICT would re-trip the `enabled = false` reset
-- hazard in 20260817120000. The iOS-flavored name is historical only.
--
-- This migration does NOT read, write, or reset the feature_flags row.

BEGIN;

-- Android merchants can now mint their own Checkout session, so the native
-- source is recorded per platform. `native_ios` is retained unchanged so
-- existing rows stay valid.
ALTER TABLE public.stripe_checkout_sessions
  DROP CONSTRAINT IF EXISTS stripe_checkout_sessions_source_check;

ALTER TABLE public.stripe_checkout_sessions
  ADD CONSTRAINT stripe_checkout_sessions_source_check
  CHECK (source IN ('admin', 'website', 'email', 'sms', 'migration', 'test', 'native_ios', 'native_android'));

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
  v_trial_checkout_enabled boolean := false;
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
      'can_manage_billing', false,
      'can_activate_trial_checkout', false
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
      'can_manage_billing', false,
      'can_activate_trial_checkout', false
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

  -- Mirrors nativeTrialCheckoutEnabled() in stripe-create-checkout-session so
  -- the button and the endpoint that backs it can never disagree. Missing row
  -- reads as disabled (fail closed).
  SELECT COALESCE(ff.enabled, false)
    INTO v_trial_checkout_enabled
  FROM public.feature_flags ff
  WHERE ff.key = 'ios_trial_checkout';
  v_trial_checkout_enabled := COALESCE(v_trial_checkout_enabled, false);

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
    -- Only an approved-but-not-yet-activated business has anything to check out
    -- for; an already-active or lapsed account must not see a "start trial" CTA.
    'can_activate_trial_checkout', v_setup_access AND v_trial_checkout_enabled,
    'publish', v_publish
  );
END;
$$;

-- CREATE OR REPLACE preserves the existing ACL, but restate it so a replay can
-- never re-widen the surface that 20260824140000 narrowed.
REVOKE ALL ON FUNCTION public.get_business_capabilities(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_business_capabilities(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_business_capabilities(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_business_capabilities(uuid) IS
  'Canonical server capability evaluator for setup/menu/text-draft/AI/publish/claim/redeem/billing gates. approved_not_activated permits setup only; AI, credits, publishing, and new claims require active access. can_activate_trial_checkout drives native Checkout button visibility on both iOS and Android and is gated by the ios_trial_checkout feature flag (historical key name; not iOS-only).';

COMMIT;
