-- Keep the admin-only no-card trial override aligned with the physical-location
-- trial reuse controls introduced after the billing foundation migration.

BEGIN;

CREATE OR REPLACE FUNCTION public.admin_grant_location_trial(
  p_business_location_id uuid,
  p_admin_user_id uuid,
  p_reason text,
  p_override_trial_reuse boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_owner_id uuid;
  v_billing_account_id uuid;
  v_config record;
  v_period_id uuid;
  v_grant_id uuid;
  v_started_at timestamptz := now();
  v_ends_at timestamptz := now() + interval '30 days';
BEGIN
  IF p_admin_user_id IS NULL THEN
    RAISE EXCEPTION 'ADMIN_USER_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  IF p_reason IS NULL OR char_length(trim(p_reason)) < 12 THEN
    RAISE EXCEPTION 'ADMIN_REASON_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(b.owner_id, bp.user_id, bp.owner_id)
    INTO v_owner_id
  FROM public.business_locations bl
  LEFT JOIN public.businesses b
    ON b.id = bl.business_id
  LEFT JOIN public.business_profiles bp
    ON bp.id = bl.business_id
  WHERE bl.id = p_business_location_id
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'LOCATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF NOT p_override_trial_reuse AND EXISTS (
    SELECT 1
    FROM public.deal_credit_periods
    WHERE business_location_id = p_business_location_id
      AND source IN ('trial', 'admin_trial')
  ) THEN
    RAISE EXCEPTION 'TRIAL_ALREADY_USED' USING ERRCODE = 'P0001';
  END IF;

  IF NOT p_override_trial_reuse AND EXISTS (
    SELECT 1
    FROM public.check_business_location_trial_reuse(p_business_location_id) reuse
    WHERE reuse.decision IN ('block', 'review')
  ) THEN
    RAISE EXCEPTION 'TRIAL_LOCATION_ALREADY_USED' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_config
  FROM public.get_runtime_billing_config()
  LIMIT 1;

  INSERT INTO public.billing_accounts (owner_user_id, provider)
  VALUES (v_owner_id, 'admin_grant')
  ON CONFLICT (owner_user_id)
  DO UPDATE SET updated_at = now()
  RETURNING id INTO v_billing_account_id;

  INSERT INTO public.admin_no_card_trial_grants (
    admin_user_id,
    business_location_id,
    reason,
    override_trial_reuse,
    trial_started_at,
    trial_ends_at,
    credits_granted
  )
  VALUES (
    p_admin_user_id,
    p_business_location_id,
    trim(p_reason),
    p_override_trial_reuse,
    v_started_at,
    v_ends_at,
    COALESCE(v_config.trial_deal_credit_allowance, 30)
  )
  RETURNING id INTO v_grant_id;

  UPDATE public.deal_credit_periods
  SET status = 'replaced',
      updated_at = now()
  WHERE business_location_id = p_business_location_id
    AND status = 'active';

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
    p_business_location_id,
    'admin_trial',
    'active',
    v_started_at,
    v_ends_at,
    COALESCE(v_config.trial_deal_credit_allowance, 30),
    jsonb_build_object(
      'trial_deal_credit_allowance', COALESCE(v_config.trial_deal_credit_allowance, 30),
      'credit_reservation_ttl_minutes', COALESCE(v_config.credit_reservation_ttl_minutes, 15),
      'admin_user_id', p_admin_user_id,
      'grant_id', v_grant_id,
      'granted_at', v_started_at
    ),
    'admin_trial:' || p_business_location_id::text || ':' || v_grant_id::text
  )
  RETURNING id INTO v_period_id;

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
    p_business_location_id,
    v_period_id,
    'grant',
    'admin_trial',
    COALESCE(v_config.trial_deal_credit_allowance, 30),
    'admin_trial:' || p_business_location_id::text || ':' || v_grant_id::text,
    jsonb_build_object('admin_user_id', p_admin_user_id, 'reason', trim(p_reason))
  );

  INSERT INTO public.business_location_identity (
    business_location_id,
    trial_used_at,
    trial_started_by_user_id,
    verification_status,
    updated_at
  )
  VALUES (
    p_business_location_id,
    v_started_at,
    v_owner_id,
    'pending_review',
    now()
  )
  ON CONFLICT (business_location_id)
  DO UPDATE SET
    trial_used_at = COALESCE(public.business_location_identity.trial_used_at, EXCLUDED.trial_used_at),
    trial_started_by_user_id = COALESCE(public.business_location_identity.trial_started_by_user_id, EXCLUDED.trial_started_by_user_id),
    updated_at = now();

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
    updated_at
  )
  VALUES (
    p_business_location_id,
    v_billing_account_id,
    'admin_trial_active',
    'admin_grant',
    v_started_at,
    v_ends_at,
    v_started_at,
    v_ends_at,
    false,
    NULL,
    NULL,
    now()
  )
  ON CONFLICT (business_location_id) DO UPDATE
  SET billing_account_id = EXCLUDED.billing_account_id,
      status = 'admin_trial_active',
      entitlement_provider = 'admin_grant',
      trial_started_at = v_started_at,
      trial_ends_at = v_ends_at,
      current_period_started_at = v_started_at,
      current_period_ends_at = v_ends_at,
      cancel_at_period_end = false,
      suspended_at = NULL,
      suspension_reason = NULL,
      updated_at = now();

  RETURN v_grant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_grant_location_trial(uuid, uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_grant_location_trial(uuid, uuid, text, boolean) TO service_role;

COMMIT;
