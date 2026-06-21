-- Location-level billing, trial, and deal-credit foundation.
--
-- This is forward-only. It does not enable paid checkout, does not apply any
-- live Stripe configuration, and keeps purchase actions controlled by the
-- server-owned purchase_surface value, which defaults to disabled.

BEGIN;

CREATE TABLE IF NOT EXISTS public.app_runtime_config (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  purchase_surface text NOT NULL DEFAULT 'disabled'
    CHECK (purchase_surface IN ('disabled', 'in_app_link', 'web_only')),
  trial_deal_credit_allowance integer NOT NULL DEFAULT 30
    CHECK (trial_deal_credit_allowance >= 0),
  paid_deal_credit_allowance integer NOT NULL DEFAULT 60
    CHECK (paid_deal_credit_allowance >= 0),
  credit_reservation_ttl_minutes integer NOT NULL DEFAULT 15
    CHECK (credit_reservation_ttl_minutes > 0),
  trial_conversion_prompt_days integer[] NOT NULL DEFAULT ARRAY[21,25,28,29],
  refund_max_paid_credits_used integer NULL
    CHECK (refund_max_paid_credits_used IS NULL OR refund_max_paid_credits_used >= 0),
  twofer_business_monthly_price_id_test text NULL,
  twofer_business_monthly_price_id_live text NULL,
  billing_environment text NOT NULL DEFAULT 'test'
    CHECK (billing_environment IN ('test', 'production')),
  entitlement_version text NOT NULL DEFAULT 'location-credit-v1',
  automatic_tax_enabled boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.app_runtime_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.app_runtime_config_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_id integer NOT NULL DEFAULT 1,
  actor_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  previous_value jsonb NULL,
  new_value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.audit_app_runtime_config()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
BEGIN
  BEGIN
    v_actor := NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
  EXCEPTION WHEN others THEN
    v_actor := NULL;
  END;

  NEW.updated_at := now();

  INSERT INTO public.app_runtime_config_audit (
    config_id,
    actor_user_id,
    previous_value,
    new_value
  )
  VALUES (
    NEW.id,
    v_actor,
    to_jsonb(OLD),
    to_jsonb(NEW)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS app_runtime_config_audit_update ON public.app_runtime_config;
CREATE TRIGGER app_runtime_config_audit_update
  BEFORE UPDATE ON public.app_runtime_config
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_app_runtime_config();

CREATE TABLE IF NOT EXISTS public.billing_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  provider text NULL,
  provider_customer_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.location_entitlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_location_id uuid NOT NULL UNIQUE REFERENCES public.business_locations(id) ON DELETE CASCADE,
  billing_account_id uuid NULL REFERENCES public.billing_accounts(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'trial_eligible'
    CHECK (status IN (
      'trial_eligible',
      'trial_checkout_pending',
      'trial_active',
      'trial_canceling',
      'trial_canceled',
      'trial_credit_limit_reached',
      'trial_expired_payment_failed_suspended',
      'trial_expired_suspended',
      'checkout_pending',
      'pro_active',
      'pro_canceling',
      'paid_active',
      'paid_canceling',
      'payment_failed_suspended',
      'canceled_suspended',
      'refunded_suspended',
      'admin_trial_active',
      'admin_trial_expired_suspended'
    )),
  entitlement_provider text NULL,
  trial_started_at timestamptz NULL,
  trial_ends_at timestamptz NULL,
  current_period_started_at timestamptz NULL,
  current_period_ends_at timestamptz NULL,
  cancel_at_period_end boolean NOT NULL DEFAULT false,
  suspended_at timestamptz NULL,
  suspension_reason text NULL,
  provider_subscription_id text NULL,
  provider_price_id text NULL,
  first_paid_invoice_id text NULL,
  first_paid_at timestamptz NULL,
  introductory_refund_used_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_location_entitlements_billing_account_id
  ON public.location_entitlements (billing_account_id);

CREATE TABLE IF NOT EXISTS public.deal_credit_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_location_id uuid NOT NULL REFERENCES public.business_locations(id) ON DELETE CASCADE,
  source text NOT NULL CHECK (source IN ('trial', 'paid_subscription', 'admin_adjustment', 'admin_trial')),
  status text NOT NULL CHECK (status IN ('active', 'replaced', 'expired', 'canceled')),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  credits_granted integer NOT NULL CHECK (credits_granted >= 0),
  credits_reserved integer NOT NULL DEFAULT 0 CHECK (credits_reserved >= 0),
  credits_used integer NOT NULL DEFAULT 0 CHECK (credits_used >= 0),
  configuration_snapshot jsonb NOT NULL,
  external_reference text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  CHECK (credits_reserved + credits_used <= credits_granted)
);

CREATE INDEX IF NOT EXISTS idx_deal_credit_periods_location_status
  ON public.deal_credit_periods (business_location_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_credit_periods_one_active
  ON public.deal_credit_periods (business_location_id)
  WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS idx_deal_credit_periods_external_reference
  ON public.deal_credit_periods (external_reference)
  WHERE external_reference IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.deal_credit_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_location_id uuid NOT NULL REFERENCES public.business_locations(id) ON DELETE CASCADE,
  credit_period_id uuid NOT NULL REFERENCES public.deal_credit_periods(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN (
    'new_deal',
    'duplicate_deal',
    'recurring_occurrence',
    'extra_image_revision',
    'admin_adjustment',
    'admin_trial'
  )),
  amount integer NOT NULL CHECK (amount > 0),
  status text NOT NULL CHECK (status IN ('reserved', 'committed', 'released')),
  idempotency_key text NOT NULL UNIQUE,
  correlation_id uuid NULL,
  deal_id uuid NULL,
  reserved_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  committed_at timestamptz NULL,
  released_at timestamptz NULL,
  release_reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > reserved_at)
);

CREATE INDEX IF NOT EXISTS idx_deal_credit_reservations_expiry
  ON public.deal_credit_reservations (status, expires_at);

CREATE TABLE IF NOT EXISTS public.deal_credit_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_location_id uuid NOT NULL REFERENCES public.business_locations(id) ON DELETE CASCADE,
  credit_period_id uuid NOT NULL REFERENCES public.deal_credit_periods(id) ON DELETE CASCADE,
  reservation_id uuid NULL REFERENCES public.deal_credit_reservations(id) ON DELETE SET NULL,
  event_type text NOT NULL CHECK (event_type IN ('grant', 'reserve', 'commit', 'release', 'expire', 'adjustment')),
  purpose text NOT NULL CHECK (purpose IN (
    'new_deal',
    'duplicate_deal',
    'recurring_occurrence',
    'extra_image_revision',
    'admin_adjustment',
    'admin_trial'
  )),
  amount integer NOT NULL CHECK (amount > 0),
  idempotency_key text NOT NULL UNIQUE,
  correlation_id uuid NULL,
  deal_id uuid NULL,
  recurring_occurrence_id uuid NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_deal_credit_ledger_location_created
  ON public.deal_credit_ledger (business_location_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.billing_provider_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  provider_event_id text NOT NULL,
  environment text NOT NULL,
  event_type text NOT NULL,
  processing_status text NOT NULL,
  payload jsonb NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz NULL,
  error_message text NULL,
  UNIQUE (provider, provider_event_id)
);

CREATE TABLE IF NOT EXISTS public.business_location_identity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_location_id uuid NOT NULL UNIQUE REFERENCES public.business_locations(id) ON DELETE CASCADE,
  google_place_id text NULL,
  normalized_business_name text NULL,
  normalized_address text NULL,
  normalized_phone text NULL,
  website_domain text NULL,
  business_email_domain text NULL,
  tax_id_hash text NULL,
  trial_used_at timestamptz NULL,
  trial_started_by_user_id uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  verification_status text NOT NULL DEFAULT 'unverified'
    CHECK (verification_status IN ('unverified', 'pending_review', 'verified', 'rejected')),
  risk_score numeric NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_location_identity_google_place
  ON public.business_location_identity (google_place_id)
  WHERE google_place_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_location_identity_address_phone
  ON public.business_location_identity (normalized_address, normalized_phone)
  WHERE normalized_address IS NOT NULL AND normalized_phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.trial_checkout_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_location_id uuid NOT NULL REFERENCES public.business_locations(id) ON DELETE CASCADE,
  disclosure_version text NOT NULL,
  locale text NOT NULL,
  displayed_price text NOT NULL,
  displayed_trial_end_date timestamptz NOT NULL,
  displayed_billing_interval text NOT NULL,
  displayed_tax_language text NOT NULL,
  purchase_surface text NOT NULL CHECK (purchase_surface IN ('in_app_link', 'web_only', 'disabled')),
  checkout_session_id text NULL UNIQUE,
  provider text NOT NULL DEFAULT 'stripe',
  consented_at timestamptz NOT NULL DEFAULT now(),
  ip_address inet NULL,
  user_agent text NULL,
  app_version text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trial_checkout_intents_location_created
  ON public.trial_checkout_intents (business_location_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.admin_no_card_trial_grants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  business_location_id uuid NOT NULL REFERENCES public.business_locations(id) ON DELETE CASCADE,
  reason text NOT NULL CHECK (char_length(trim(reason)) >= 12),
  override_trial_reuse boolean NOT NULL DEFAULT false,
  trial_started_at timestamptz NOT NULL,
  trial_ends_at timestamptz NOT NULL,
  credits_granted integer NOT NULL CHECK (credits_granted >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (trial_ends_at > trial_started_at)
);

CREATE OR REPLACE FUNCTION public.user_owns_business_location(
  p_business_location_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.business_locations bl
    LEFT JOIN public.businesses b
      ON b.id = bl.business_id
    LEFT JOIN public.business_profiles bp
      ON bp.id = bl.business_id
    WHERE bl.id = p_business_location_id
      AND p_user_id IS NOT NULL
      AND (
        b.owner_id = p_user_id
        OR bp.user_id = p_user_id
        OR bp.owner_id = p_user_id
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.ensure_location_entitlement()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.location_entitlements (business_location_id, status)
  VALUES (NEW.id, 'trial_eligible')
  ON CONFLICT (business_location_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS business_locations_ensure_entitlement ON public.business_locations;
CREATE TRIGGER business_locations_ensure_entitlement
  AFTER INSERT ON public.business_locations
  FOR EACH ROW
  EXECUTE FUNCTION public.ensure_location_entitlement();

INSERT INTO public.location_entitlements (business_location_id, status)
SELECT bl.id, 'trial_eligible'
FROM public.business_locations bl
ON CONFLICT (business_location_id) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_runtime_billing_config()
RETURNS TABLE (
  purchase_surface text,
  trial_deal_credit_allowance integer,
  paid_deal_credit_allowance integer,
  credit_reservation_ttl_minutes integer,
  trial_conversion_prompt_days integer[],
  refund_max_paid_credits_used integer,
  twofer_business_monthly_price_id_test text,
  twofer_business_monthly_price_id_live text,
  billing_environment text,
  entitlement_version text,
  automatic_tax_enabled boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT
    CASE
      WHEN arc.purchase_surface IN ('disabled', 'in_app_link', 'web_only')
      THEN arc.purchase_surface
      ELSE 'disabled'
    END AS purchase_surface,
    COALESCE(arc.trial_deal_credit_allowance, 30) AS trial_deal_credit_allowance,
    COALESCE(arc.paid_deal_credit_allowance, 60) AS paid_deal_credit_allowance,
    COALESCE(arc.credit_reservation_ttl_minutes, 15) AS credit_reservation_ttl_minutes,
    COALESCE(arc.trial_conversion_prompt_days, ARRAY[21,25,28,29]) AS trial_conversion_prompt_days,
    arc.refund_max_paid_credits_used,
    arc.twofer_business_monthly_price_id_test,
    arc.twofer_business_monthly_price_id_live,
    COALESCE(arc.billing_environment, 'test') AS billing_environment,
    COALESCE(NULLIF(arc.entitlement_version, ''), 'location-credit-v1') AS entitlement_version,
    COALESCE(arc.automatic_tax_enabled, false) AS automatic_tax_enabled
  FROM public.app_runtime_config arc
  WHERE arc.id = 1
  UNION ALL
  SELECT 'disabled', 30, 60, 15, ARRAY[21,25,28,29], NULL, NULL, NULL, 'test', 'location-credit-v1', false
  WHERE NOT EXISTS (SELECT 1 FROM public.app_runtime_config WHERE id = 1)
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.get_location_billing_summary(
  p_business_location_id uuid
)
RETURNS TABLE (
  business_location_id uuid,
  status text,
  trial_started_at timestamptz,
  trial_ends_at timestamptz,
  current_period_started_at timestamptz,
  current_period_ends_at timestamptz,
  cancel_at_period_end boolean,
  suspension_reason text,
  credits_granted integer,
  credits_used integer,
  credits_reserved integer,
  credits_remaining integer,
  refund_eligible boolean,
  purchase_surface text,
  configured_trial_allowance integer,
  configured_paid_allowance integer
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_config record;
BEGIN
  IF NOT public.user_owns_business_location(p_business_location_id, auth.uid()) THEN
    RAISE EXCEPTION 'LOCATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_config
  FROM public.get_runtime_billing_config()
  LIMIT 1;

  RETURN QUERY
  SELECT
    p_business_location_id,
    COALESCE(le.status, 'trial_eligible') AS status,
    le.trial_started_at,
    le.trial_ends_at,
    le.current_period_started_at,
    le.current_period_ends_at,
    COALESCE(le.cancel_at_period_end, false) AS cancel_at_period_end,
    le.suspension_reason,
    COALESCE(dcp.credits_granted, 0) AS credits_granted,
    COALESCE(dcp.credits_used, 0) AS credits_used,
    COALESCE(dcp.credits_reserved, 0) AS credits_reserved,
    GREATEST(
      COALESCE(dcp.credits_granted, 0) -
      COALESCE(dcp.credits_used, 0) -
      COALESCE(dcp.credits_reserved, 0),
      0
    ) AS credits_remaining,
    (
      le.status IN ('pro_active', 'paid_active')
      AND le.first_paid_at IS NOT NULL
      AND le.introductory_refund_used_at IS NULL
      AND now() < le.first_paid_at + interval '7 days'
    ) AS refund_eligible,
    COALESCE(v_config.purchase_surface, 'disabled') AS purchase_surface,
    COALESCE(v_config.trial_deal_credit_allowance, 30) AS configured_trial_allowance,
    COALESCE(v_config.paid_deal_credit_allowance, 60) AS configured_paid_allowance
  FROM (SELECT 1) anchor
  LEFT JOIN public.location_entitlements le
    ON le.business_location_id = p_business_location_id
  LEFT JOIN LATERAL (
    SELECT *
    FROM public.deal_credit_periods period
    WHERE period.business_location_id = p_business_location_id
      AND period.status = 'active'
    ORDER BY period.starts_at DESC
    LIMIT 1
  ) dcp ON true;
END;
$$;

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

CREATE OR REPLACE FUNCTION public.deal_claim_visible_to_business_owner(p_deal_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.deals d
    JOIN public.businesses b ON b.id = d.business_id
    WHERE d.id = p_deal_id
      AND b.owner_id = (SELECT auth.uid())
  );
$$;

DO $$
BEGIN
  IF to_regclass('public.business_profiles') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.business_profiles ALTER COLUMN subscription_status SET DEFAULT ''canceled''';
    EXECUTE 'REVOKE UPDATE (stripe_customer_id, stripe_subscription_id, subscription_status, subscription_tier, trial_ends_at, current_period_ends_at) ON public.business_profiles FROM anon, authenticated';
  END IF;
END;
$$;

ALTER TABLE public.app_runtime_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_runtime_config_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.location_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_credit_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_credit_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.deal_credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_provider_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_location_identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.trial_checkout_intents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.admin_no_card_trial_grants ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.app_runtime_config FROM anon, authenticated;
REVOKE ALL ON TABLE public.app_runtime_config_audit FROM anon, authenticated;
REVOKE ALL ON TABLE public.billing_accounts FROM anon, authenticated;
REVOKE ALL ON TABLE public.location_entitlements FROM anon, authenticated;
REVOKE ALL ON TABLE public.deal_credit_periods FROM anon, authenticated;
REVOKE ALL ON TABLE public.deal_credit_reservations FROM anon, authenticated;
REVOKE ALL ON TABLE public.deal_credit_ledger FROM anon, authenticated;
REVOKE ALL ON TABLE public.billing_provider_events FROM anon, authenticated;
REVOKE ALL ON TABLE public.business_location_identity FROM anon, authenticated;
REVOKE ALL ON TABLE public.trial_checkout_intents FROM anon, authenticated;
REVOKE ALL ON TABLE public.admin_no_card_trial_grants FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.billing_accounts TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.location_entitlements TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.deal_credit_periods TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.deal_credit_reservations TO service_role;
GRANT SELECT, INSERT ON TABLE public.deal_credit_ledger TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.billing_provider_events TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.business_location_identity TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.trial_checkout_intents TO service_role;
GRANT SELECT, INSERT ON TABLE public.admin_no_card_trial_grants TO service_role;

REVOKE ALL ON FUNCTION public.audit_app_runtime_config() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_location_entitlement() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.user_owns_business_location(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_runtime_billing_config() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_location_billing_summary(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_grant_location_trial(uuid, uuid, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.deal_claim_visible_to_business_owner(uuid) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.user_owns_business_location(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_runtime_billing_config() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_location_billing_summary(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_grant_location_trial(uuid, uuid, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.deal_claim_visible_to_business_owner(uuid) TO anon, authenticated, service_role;

COMMENT ON TABLE public.app_runtime_config
  IS 'Server-owned runtime billing and deal-credit configuration. Mobile callers read only through safe RPCs.';

COMMENT ON TABLE public.location_entitlements
  IS 'Provider-neutral per-location billing/trial entitlement state.';

COMMENT ON TABLE public.deal_credit_periods
  IS 'Per-location credit periods with snapshotted allowance configuration.';

COMMENT ON TABLE public.deal_credit_reservations
  IS 'Mutable server-owned credit reservations. Client callers cannot directly reserve, commit, or release credits.';

COMMENT ON TABLE public.deal_credit_ledger
  IS 'Append-only credit ledger for grants, reservations, commits, releases, expirations, and adjustments.';

COMMENT ON TABLE public.trial_checkout_intents
  IS 'Server-owned record of express owner consent before card-required Stripe trial Checkout.';

COMMENT ON TABLE public.admin_no_card_trial_grants
  IS 'Audited admin-only no-card trial override grants. Not reachable from normal owner UI.';

COMMIT;
