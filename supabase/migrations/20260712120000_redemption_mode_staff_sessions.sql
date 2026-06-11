-- Redemption Mode: restricted staff-device sessions and database-enforced redemption.
--
-- This migration is intentionally additive. It does not apply a custom auth hook;
-- staff devices are represented by restricted Supabase Auth users whose JWT
-- app_metadata contains:
--   app_role = 'redeemer'
--   business_id = <businesses.id>
--   redemption_device_id = <redemption_devices.id>

BEGIN;

CREATE TABLE IF NOT EXISTS public.redemption_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  staff_user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  install_id text NOT NULL,
  device_label text NOT NULL,
  pin_hash text NOT NULL,
  exit_token_hash text NOT NULL,
  active boolean NOT NULL DEFAULT false,
  pin_failed_attempts integer NOT NULL DEFAULT 0 CHECK (pin_failed_attempts >= 0),
  pin_locked_until timestamptz,
  activated_at timestamptz,
  deactivated_at timestamptz,
  removed_at timestamptz,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT redemption_devices_install_id_check
    CHECK (length(trim(install_id)) BETWEEN 8 AND 128),
  CONSTRAINT redemption_devices_label_check
    CHECK (length(trim(device_label)) BETWEEN 1 AND 80),
  UNIQUE (business_id, install_id)
);

CREATE INDEX IF NOT EXISTS idx_redemption_devices_business_active
  ON public.redemption_devices (business_id, active, removed_at);

CREATE INDEX IF NOT EXISTS idx_redemption_devices_staff_user
  ON public.redemption_devices (staff_user_id)
  WHERE staff_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  claim_id uuid UNIQUE REFERENCES public.deal_claims(id) ON DELETE SET NULL,
  deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  redemption_device_id uuid REFERENCES public.redemption_devices(id) ON DELETE SET NULL,
  redeemer_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  device_label text NOT NULL,
  redeemed_at timestamptz NOT NULL DEFAULT now(),
  redeem_method text NOT NULL DEFAULT 'staff_qr'
    CHECK (redeem_method IN ('staff_qr', 'staff_manual')),
  code_type text NOT NULL
    CHECK (code_type IN ('token', 'short_code')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_redemptions_business_redeemed
  ON public.redemptions (business_id, redeemed_at DESC);

CREATE INDEX IF NOT EXISTS idx_redemptions_device_redeemed
  ON public.redemptions (redemption_device_id, redeemed_at DESC);

CREATE TABLE IF NOT EXISTS public.owner_redemption_security (
  business_id uuid PRIMARY KEY REFERENCES public.businesses(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled boolean NOT NULL DEFAULT false,
  pin_hash text,
  pin_failed_attempts integer NOT NULL DEFAULT 0 CHECK (pin_failed_attempts >= 0),
  pin_locked_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT owner_redemption_security_pin_when_enabled
    CHECK (enabled = false OR pin_hash IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_owner_redemption_security_owner
  ON public.owner_redemption_security (owner_id);

ALTER TABLE public.redemption_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.redemptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.owner_redemption_security ENABLE ROW LEVEL SECURITY;

-- These tables include PIN and exit-token hashes. Owner/device management is
-- exposed through Edge Functions that return a safe shape.
REVOKE ALL ON public.redemption_devices FROM anon, authenticated;
REVOKE ALL ON public.redemptions FROM anon, authenticated;
REVOKE ALL ON public.owner_redemption_security FROM anon, authenticated;

-- Owners read their own redemption history directly (no secret columns live on
-- redemptions). Without this grant the redemptions_owner_read policy below is
-- dead: RLS policies filter rows but cannot substitute for a missing GRANT.
GRANT SELECT ON public.redemptions TO authenticated;

COMMENT ON TABLE public.redemption_devices
  IS 'Restricted staff/counter devices for Redemption Mode. Contains secret hashes; read/write through owner Edge Functions only.';

COMMENT ON TABLE public.redemptions
  IS 'Append-only staff redemption audit trail. claim_id remains unique so one-time claim codes cannot be redeemed twice.';

COMMENT ON TABLE public.owner_redemption_security
  IS 'Server-verified owner PIN gate for normal merchant redemption tools. The app keeps successful unlocks in memory only.';

CREATE OR REPLACE FUNCTION public.redemption_claim_input_kind(
  p_token text,
  p_short_code text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN nullif(trim(coalesce(p_short_code, '')), '') IS NOT NULL THEN 'short_code'
    WHEN nullif(trim(coalesce(p_token, '')), '') IS NOT NULL THEN 'token'
    ELSE 'none'
  END;
$$;

CREATE OR REPLACE FUNCTION public.is_redeemer_session()
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    auth.jwt() ->> 'app_role',
    auth.jwt() -> 'app_metadata' ->> 'app_role'
  ) = 'redeemer';
$$;

CREATE OR REPLACE FUNCTION public.redeemer_business_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  WITH raw_claim(value) AS (
    SELECT COALESCE(
      auth.jwt() ->> 'business_id',
      auth.jwt() -> 'app_metadata' ->> 'business_id'
    )
  )
  SELECT CASE
    WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN value::uuid
    ELSE NULL::uuid
  END
  FROM raw_claim;
$$;

CREATE OR REPLACE FUNCTION public.redeemer_device_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  WITH raw_claim(value) AS (
    SELECT COALESCE(
      auth.jwt() ->> 'redemption_device_id',
      auth.jwt() -> 'app_metadata' ->> 'redemption_device_id'
    )
  )
  SELECT CASE
    WHEN value ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      THEN value::uuid
    ELSE NULL::uuid
  END
  FROM raw_claim;
$$;

CREATE OR REPLACE FUNCTION public.is_active_redeemer_for_business(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT public.is_redeemer_session()
    AND p_business_id IS NOT NULL
    AND p_business_id = public.redeemer_business_id()
    AND EXISTS (
      SELECT 1
      FROM public.redemption_devices rd
      WHERE rd.id = public.redeemer_device_id()
        AND rd.business_id = p_business_id
        AND rd.staff_user_id = (SELECT auth.uid())
        AND rd.active = true
        AND rd.removed_at IS NULL
        AND rd.deactivated_at IS NULL
    );
$$;

-- Supabase default privileges grant EXECUTE to anon/authenticated on every new
-- function, and REVOKE FROM PUBLIC alone does NOT remove those explicit grants
-- (prod-verified 2026-06-10 for purge_user_data / deal_claim_counts, fd1e98e).
-- authenticated keeps EXECUTE: is_redeemer_session / is_active_redeemer_for_business
-- run inside RLS policy expressions evaluated as the calling role, and the
-- claim helpers only echo the caller's own JWT.
REVOKE ALL ON FUNCTION public.redemption_claim_input_kind(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_redeemer_session() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.redeemer_business_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.redeemer_device_id() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_active_redeemer_for_business(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.redemption_claim_input_kind(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_redeemer_session() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.redeemer_business_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.redeemer_device_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_active_redeemer_for_business(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS redemptions_owner_read ON public.redemptions;
CREATE POLICY redemptions_owner_read
  ON public.redemptions FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.businesses b
      WHERE b.id = redemptions.business_id
        AND b.owner_id = auth.uid()
    )
  );

-- Redeemer sessions can read only active deals for their own business.
DROP POLICY IF EXISTS redeemer_deals_select_guard ON public.deals;
CREATE POLICY redeemer_deals_select_guard
  ON public.deals AS RESTRICTIVE FOR SELECT
  TO authenticated
  USING (
    NOT public.is_redeemer_session()
    OR (
      public.is_active_redeemer_for_business(deals.business_id)
      AND deals.is_active = true
      AND deals.start_time <= now()
      AND deals.end_time > now()
    )
  );

DROP POLICY IF EXISTS redeemer_deals_insert_guard ON public.deals;
CREATE POLICY redeemer_deals_insert_guard
  ON public.deals AS RESTRICTIVE FOR INSERT
  TO authenticated
  WITH CHECK (NOT public.is_redeemer_session());

DROP POLICY IF EXISTS redeemer_deals_update_guard ON public.deals;
CREATE POLICY redeemer_deals_update_guard
  ON public.deals AS RESTRICTIVE FOR UPDATE
  TO authenticated
  USING (NOT public.is_redeemer_session())
  WITH CHECK (NOT public.is_redeemer_session());

DROP POLICY IF EXISTS redeemer_deals_delete_guard ON public.deals;
CREATE POLICY redeemer_deals_delete_guard
  ON public.deals AS RESTRICTIVE FOR DELETE
  TO authenticated
  USING (NOT public.is_redeemer_session());

-- Business rows already have column-level grants that hide PII from
-- authenticated clients. Redeemer sessions only get their own public row.
DROP POLICY IF EXISTS redeemer_businesses_select_guard ON public.businesses;
CREATE POLICY redeemer_businesses_select_guard
  ON public.businesses AS RESTRICTIVE FOR SELECT
  TO authenticated
  USING (
    NOT public.is_redeemer_session()
    OR public.is_active_redeemer_for_business(businesses.id)
  );

DROP POLICY IF EXISTS redeemer_businesses_insert_guard ON public.businesses;
CREATE POLICY redeemer_businesses_insert_guard
  ON public.businesses AS RESTRICTIVE FOR INSERT
  TO authenticated
  WITH CHECK (NOT public.is_redeemer_session());

DROP POLICY IF EXISTS redeemer_businesses_update_guard ON public.businesses;
CREATE POLICY redeemer_businesses_update_guard
  ON public.businesses AS RESTRICTIVE FOR UPDATE
  TO authenticated
  USING (NOT public.is_redeemer_session())
  WITH CHECK (NOT public.is_redeemer_session());

DROP POLICY IF EXISTS redeemer_businesses_delete_guard ON public.businesses;
CREATE POLICY redeemer_businesses_delete_guard
  ON public.businesses AS RESTRICTIVE FOR DELETE
  TO authenticated
  USING (NOT public.is_redeemer_session());

-- Block redeemer sessions from all other authenticated table policies. The
-- staff redemption RPC below is the validated write path.
DO $$
DECLARE
  tbl text;
  policy_name text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'deal_claims',
    'favorites',
    'consumer_profiles',
    'profiles',
    'push_tokens',
    'business_profiles',
    'business_menu_items',
    'business_locations',
    'deal_templates',
    'app_analytics_events',
    'ai_generation_logs',
    'subscription_history',
    'business_invite_validations',
    'business_reports',
    'user_reports',
    'deal_shares',
    'failed_redeem_attempts',
    'owner_redemption_security',
    'redemptions',
    'app_config',
    'rate_limits'
  ]
  LOOP
    IF to_regclass('public.' || tbl) IS NOT NULL THEN
      policy_name := 'redeemer_' || tbl || '_block_all';
      EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, tbl);
      EXECUTE format(
        'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (NOT public.is_redeemer_session()) WITH CHECK (NOT public.is_redeemer_session())',
        policy_name,
        tbl
      );
    END IF;
  END LOOP;
END $$;

-- Staff redemption brute-force lockout (Batch 6 parity for the staff path).
-- Counter devices sit behind one shop IP, so the existing (business_id, ip)
-- scoping cannot tell devices apart; scope per device instead. The column is
-- added here because failed_redeem_attempts is already applied in prod and
-- redemption_devices first exists in this migration.
ALTER TABLE public.failed_redeem_attempts
  ADD COLUMN IF NOT EXISTS redemption_device_id uuid
    REFERENCES public.redemption_devices(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_failed_redeem_attempts_device_lookup
  ON public.failed_redeem_attempts (redemption_device_id, attempted_at DESC)
  WHERE redemption_device_id IS NOT NULL;

COMMENT ON COLUMN public.failed_redeem_attempts.redemption_device_id
  IS 'Set by staff-redemption: failed guesses are counted per counter device, not per IP.';

DO $$
BEGIN
  IF to_regclass('public.app_analytics_events_backup_20260708') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.app_analytics_events_backup_20260708 ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON public.app_analytics_events_backup_20260708 FROM anon, authenticated';
  END IF;
END $$;

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
    OR (v_kind = 'token' AND dc.token = v_token)
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
    OR (v_kind = 'token' AND dc.token = v_token)
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

COMMENT ON FUNCTION public.preview_staff_redemption(text, text)
  IS 'Redeemer-only claim preview. Returns minimum confirmation fields and no token/user identifiers.';

COMMENT ON FUNCTION public.confirm_staff_redemption(text, text)
  IS 'Redeemer-only validated redemption. Atomically marks the claim redeemed and writes redemptions audit.';

-- SECURITY DEFINER RPCs granted to authenticated users must explicitly reject
-- redeemer JWTs when they are outside Redemption Mode's allow list.
CREATE OR REPLACE FUNCTION public.validate_business_invite(invite_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid;
  normalized text;
BEGIN
  IF public.is_redeemer_session() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  uid := auth.uid();
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  normalized := lower(trim(coalesce(invite_code, '')));
  IF normalized <> 'penguin' THEN
    RAISE EXCEPTION 'invalid invite code' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.business_invite_validations(user_id, validated_at, code_used)
  VALUES (uid, now(), normalized)
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.report_business(
  target_business_id uuid,
  report_reason text,
  report_comment text DEFAULT NULL,
  related_deal_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid;
  new_id uuid;
BEGIN
  IF public.is_redeemer_session() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  uid := auth.uid();
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.businesses WHERE id = target_business_id) THEN
    RAISE EXCEPTION 'business not found' USING ERRCODE = '23503';
  END IF;
  INSERT INTO public.business_reports(business_id, deal_id, reporter_user_id, reason, comment)
  VALUES (target_business_id, related_deal_id, uid, report_reason, NULLIF(trim(report_comment), ''))
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.report_user(
  related_claim_id uuid,
  report_reason text,
  report_comment text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid;
  claim_user uuid;
  claim_business uuid;
  reporter_business uuid;
  new_id uuid;
BEGIN
  IF public.is_redeemer_session() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  uid := auth.uid();
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  SELECT dc.user_id, d.business_id
    INTO claim_user, claim_business
  FROM public.deal_claims dc
  JOIN public.deals d ON d.id = dc.deal_id
  WHERE dc.id = related_claim_id;

  IF claim_user IS NULL THEN
    RAISE EXCEPTION 'claim not found' USING ERRCODE = '23503';
  END IF;

  SELECT id INTO reporter_business
  FROM public.businesses
  WHERE id = claim_business
    AND owner_id = uid;

  IF reporter_business IS NULL THEN
    RAISE EXCEPTION 'not authorized to report this claim' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.user_reports(
    reported_user_id, reporter_business_id, reporter_user_id, claim_id, reason, comment
  )
  VALUES (
    claim_user, reporter_business, uid, related_claim_id, report_reason, NULLIF(trim(report_comment), '')
  )
  RETURNING id INTO new_id;
  RETURN new_id;
END;
$$;

-- CREATE OR REPLACE preserves whatever ACL prod already has on these three, so
-- strip anon explicitly here too (their original migrations only revoked PUBLIC).
REVOKE ALL ON FUNCTION public.validate_business_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_business_invite(text) TO authenticated;
REVOKE ALL ON FUNCTION public.report_business(uuid, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_business(uuid, text, text, uuid) TO authenticated;
REVOKE ALL ON FUNCTION public.report_user(uuid, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_user(uuid, text, text) TO authenticated;

COMMIT;
