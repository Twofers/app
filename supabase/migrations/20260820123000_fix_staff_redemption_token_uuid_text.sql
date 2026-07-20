-- Fix: staff redemption failed for every merchant. Two classes of bug, both only reachable by a
-- live redeemer session (service-role callers bail at the redeemer_business_id() gate before these
-- statements are planned/run, so RLS probes and service-role tests never caught them). Reproduced
-- 2026-07-20 against prod via a real redeemer session (S10 device QA).
--
-- Bug 1 (preview + confirm): prod deal_claims.token is uuid (initial schema declared it text; prod
-- drifted), but the RPCs compared dc.token = v_token (text). Postgres type-checks the whole WHERE at
-- plan time, so even a short-code redemption tripped the dead token branch -> 42883 uuid=text -> 500.
-- Fix: dc.token::text = v_token.
--
-- Bug 2 (confirm only): RETURNS TABLE exposes output variables (redeemed_at, claim_id, deal_id,
-- business_id, device_label ...) that collide with the deal_claims UPDATE and redemptions INSERT
-- column references -> 42702 column-reference-ambiguous. Masked until Bug 1 let confirm reach the
-- write path (preview never writes). Fix: variable_conflict use_column resolves each to the column.
--
-- Bodies are otherwise byte-identical to 20260712120000_redemption_mode_staff_sessions.sql.

CREATE OR REPLACE FUNCTION public.preview_staff_redemption(
  p_token text DEFAULT NULL,
  p_short_code text DEFAULT NULL
)
RETURNS TABLE (
  ok boolean,
  status text,
  message text,
  claim_id uuid,
  deal_id uuid,
  business_id uuid,
  deal_title text,
  customer_first_name text,
  redeem_by timestamptz,
  redeemed_at timestamptz,
  device_label text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_business_id uuid := public.redeemer_business_id();
  v_device_id uuid := public.redeemer_device_id();
  v_code text := upper(regexp_replace(trim(coalesce(p_short_code, '')), '[^A-Z0-9]', '', 'g'));
  v_token text := trim(coalesce(p_token, ''));
  v_kind text := public.redemption_claim_input_kind(p_token, p_short_code);
  v_now timestamptz := now();
  v_claim record;
  v_redeem_by timestamptz;
  v_device_label text;
BEGIN
  IF v_business_id IS NULL OR NOT public.is_active_redeemer_for_business(v_business_id) THEN
    RETURN QUERY SELECT false, 'unauthorized'::text, 'Redemption session is not active.'::text,
      NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;

  UPDATE public.redemption_devices
  SET last_seen_at = v_now, updated_at = v_now
  WHERE id = v_device_id;

  SELECT rd.device_label
    INTO v_device_label
  FROM public.redemption_devices rd
  WHERE rd.id = v_device_id;

  IF v_kind = 'none' OR (v_kind = 'short_code' AND length(v_code) < 4) THEN
    RETURN QUERY SELECT false, 'invalid_input'::text, 'Enter a QR token or claim code.'::text,
      NULL::uuid, NULL::uuid, v_business_id, NULL::text, NULL::text, NULL::timestamptz, NULL::timestamptz, v_device_label;
    RETURN;
  END IF;

  SELECT
    dc.id,
    dc.deal_id,
    dc.expires_at,
    dc.redeemed_at,
    dc.claim_status,
    dc.grace_period_minutes,
    d.business_id,
    d.title,
    d.is_active,
    d.start_time,
    d.end_time
  INTO v_claim
  FROM public.deal_claims dc
  JOIN public.deals d ON d.id = dc.deal_id
  WHERE (
    (v_kind = 'short_code' AND dc.short_code = v_code)
    OR (v_kind = 'token' AND dc.token::text = v_token)
  )
  LIMIT 1;

  IF v_claim.id IS NULL OR v_claim.business_id IS DISTINCT FROM v_business_id THEN
    RETURN QUERY SELECT false, 'not_found'::text, 'Invalid token or claim code.'::text,
      NULL::uuid, NULL::uuid, v_business_id, NULL::text, NULL::text, NULL::timestamptz, NULL::timestamptz, v_device_label;
    RETURN;
  END IF;

  v_redeem_by := v_claim.expires_at
    + (COALESCE(v_claim.grace_period_minutes, 10) || ' minutes')::interval;

  IF v_claim.is_active IS DISTINCT FROM true
    OR v_claim.start_time > v_now
    OR v_claim.end_time <= v_now THEN
    RETURN QUERY SELECT false, 'deal_inactive'::text, 'This deal is not active.'::text,
      v_claim.id, v_claim.deal_id, v_business_id, v_claim.title, NULL::text, v_redeem_by, v_claim.redeemed_at, v_device_label;
    RETURN;
  END IF;

  IF v_claim.redeemed_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'already_redeemed'::text, 'This token has already been redeemed.'::text,
      v_claim.id, v_claim.deal_id, v_business_id, v_claim.title, NULL::text, v_redeem_by, v_claim.redeemed_at, v_device_label;
    RETURN;
  END IF;

  IF v_claim.claim_status IN ('canceled', 'expired') OR v_redeem_by < v_now THEN
    RETURN QUERY SELECT false, 'expired'::text, 'This token has expired.'::text,
      v_claim.id, v_claim.deal_id, v_business_id, v_claim.title, NULL::text, v_redeem_by, v_claim.redeemed_at, v_device_label;
    RETURN;
  END IF;

  IF v_claim.claim_status NOT IN ('active', 'redeeming') THEN
    RETURN QUERY SELECT false, 'not_redeemable'::text, 'This claim cannot be redeemed.'::text,
      v_claim.id, v_claim.deal_id, v_business_id, v_claim.title, NULL::text, v_redeem_by, v_claim.redeemed_at, v_device_label;
    RETURN;
  END IF;

  RETURN QUERY SELECT true, 'valid'::text, 'Ready to redeem.'::text,
    v_claim.id, v_claim.deal_id, v_business_id, v_claim.title, NULL::text, v_redeem_by, NULL::timestamptz, v_device_label;
END;
$$;

CREATE OR REPLACE FUNCTION public.confirm_staff_redemption(
  p_token text DEFAULT NULL,
  p_short_code text DEFAULT NULL
)
RETURNS TABLE (
  ok boolean,
  status text,
  message text,
  claim_id uuid,
  deal_id uuid,
  business_id uuid,
  deal_title text,
  customer_first_name text,
  redeem_by timestamptz,
  redeemed_at timestamptz,
  device_label text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
#variable_conflict use_column
DECLARE
  v_business_id uuid := public.redeemer_business_id();
  v_device_id uuid := public.redeemer_device_id();
  v_code text := upper(regexp_replace(trim(coalesce(p_short_code, '')), '[^A-Z0-9]', '', 'g'));
  v_token text := trim(coalesce(p_token, ''));
  v_kind text := public.redemption_claim_input_kind(p_token, p_short_code);
  v_method text;
  v_now timestamptz := now();
  v_claim record;
  v_redeem_by timestamptz;
  v_redeemed_at timestamptz;
  v_device_label text;
BEGIN
  IF v_business_id IS NULL OR NOT public.is_active_redeemer_for_business(v_business_id) THEN
    RETURN QUERY SELECT false, 'unauthorized'::text, 'Redemption session is not active.'::text,
      NULL::uuid, NULL::uuid, NULL::uuid, NULL::text, NULL::text, NULL::timestamptz, NULL::timestamptz, NULL::text;
    RETURN;
  END IF;

  UPDATE public.redemption_devices
  SET last_seen_at = v_now, updated_at = v_now
  WHERE id = v_device_id;

  SELECT rd.device_label
    INTO v_device_label
  FROM public.redemption_devices rd
  WHERE rd.id = v_device_id;

  IF v_kind = 'none' OR (v_kind = 'short_code' AND length(v_code) < 4) THEN
    RETURN QUERY SELECT false, 'invalid_input'::text, 'Enter a QR token or claim code.'::text,
      NULL::uuid, NULL::uuid, v_business_id, NULL::text, NULL::text, NULL::timestamptz, NULL::timestamptz, v_device_label;
    RETURN;
  END IF;

  SELECT
    dc.id,
    dc.deal_id,
    dc.expires_at,
    dc.redeemed_at,
    dc.claim_status,
    dc.grace_period_minutes,
    d.business_id,
    d.title,
    d.is_active,
    d.start_time,
    d.end_time
  INTO v_claim
  FROM public.deal_claims dc
  JOIN public.deals d ON d.id = dc.deal_id
  WHERE (
    (v_kind = 'short_code' AND dc.short_code = v_code)
    OR (v_kind = 'token' AND dc.token::text = v_token)
  )
  LIMIT 1
  FOR UPDATE OF dc;

  IF v_claim.id IS NULL OR v_claim.business_id IS DISTINCT FROM v_business_id THEN
    RETURN QUERY SELECT false, 'not_found'::text, 'Invalid token or claim code.'::text,
      NULL::uuid, NULL::uuid, v_business_id, NULL::text, NULL::text, NULL::timestamptz, NULL::timestamptz, v_device_label;
    RETURN;
  END IF;

  v_redeem_by := v_claim.expires_at
    + (COALESCE(v_claim.grace_period_minutes, 10) || ' minutes')::interval;

  IF v_claim.is_active IS DISTINCT FROM true
    OR v_claim.start_time > v_now
    OR v_claim.end_time <= v_now THEN
    RETURN QUERY SELECT false, 'deal_inactive'::text, 'This deal is not active.'::text,
      v_claim.id, v_claim.deal_id, v_business_id, v_claim.title, NULL::text, v_redeem_by, v_claim.redeemed_at, v_device_label;
    RETURN;
  END IF;

  IF v_claim.redeemed_at IS NOT NULL THEN
    RETURN QUERY SELECT false, 'already_redeemed'::text, 'This token has already been redeemed.'::text,
      v_claim.id, v_claim.deal_id, v_business_id, v_claim.title, NULL::text, v_redeem_by, v_claim.redeemed_at, v_device_label;
    RETURN;
  END IF;

  IF v_claim.claim_status IN ('canceled', 'expired') OR v_redeem_by < v_now THEN
    UPDATE public.deal_claims
    SET claim_status = 'expired',
        redeem_started_at = NULL
    WHERE id = v_claim.id
      AND redeemed_at IS NULL;

    RETURN QUERY SELECT false, 'expired'::text, 'This token has expired.'::text,
      v_claim.id, v_claim.deal_id, v_business_id, v_claim.title, NULL::text, v_redeem_by, v_claim.redeemed_at, v_device_label;
    RETURN;
  END IF;

  IF v_claim.claim_status NOT IN ('active', 'redeeming') THEN
    RETURN QUERY SELECT false, 'not_redeemable'::text, 'This claim cannot be redeemed.'::text,
      v_claim.id, v_claim.deal_id, v_business_id, v_claim.title, NULL::text, v_redeem_by, v_claim.redeemed_at, v_device_label;
    RETURN;
  END IF;

  UPDATE public.deal_claims
  SET redeemed_at = v_now,
      claim_status = 'redeemed',
      redeem_method = 'qr',
      redeem_started_at = NULL
  WHERE id = v_claim.id
    AND redeemed_at IS NULL
    AND claim_status IN ('active', 'redeeming')
  RETURNING redeemed_at
  INTO v_redeemed_at;

  IF v_redeemed_at IS NULL THEN
    RETURN QUERY SELECT false, 'already_redeemed'::text, 'This token has already been redeemed.'::text,
      v_claim.id, v_claim.deal_id, v_business_id, v_claim.title, NULL::text, v_redeem_by, v_claim.redeemed_at, v_device_label;
    RETURN;
  END IF;

  v_method := CASE WHEN v_kind = 'short_code' THEN 'staff_manual' ELSE 'staff_qr' END;

  INSERT INTO public.redemptions (
    claim_id,
    deal_id,
    business_id,
    redemption_device_id,
    redeemer_user_id,
    device_label,
    redeemed_at,
    redeem_method,
    code_type
  )
  VALUES (
    v_claim.id,
    v_claim.deal_id,
    v_business_id,
    v_device_id,
    auth.uid(),
    COALESCE(v_device_label, 'Counter device'),
    v_redeemed_at,
    v_method,
    v_kind
  )
  ON CONFLICT (claim_id) DO NOTHING;

  RETURN QUERY SELECT true, 'redeemed'::text, 'Redeemed.'::text,
    v_claim.id, v_claim.deal_id, v_business_id, v_claim.title, NULL::text, v_redeem_by, v_redeemed_at, v_device_label;
END;
$$;

-- anon must not be able to invoke the staff RPCs at all (see grant note above).
REVOKE ALL ON FUNCTION public.preview_staff_redemption(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.confirm_staff_redemption(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_staff_redemption(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.confirm_staff_redemption(text, text) TO authenticated;
