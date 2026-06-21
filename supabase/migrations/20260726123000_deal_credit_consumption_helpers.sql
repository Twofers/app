-- Deal-credit reserve, commit, release, and one-time deal insert enforcement.
--
-- The enforcement flag defaults off so carrying this migration does not change
-- the free pilot behavior. When enabled server-side, new non-recurring deal rows
-- consume one location credit transactionally after the row is inserted.

BEGIN;

ALTER TABLE public.app_runtime_config
  ADD COLUMN IF NOT EXISTS deal_credit_enforcement_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE public.deal_credit_reservations
  ADD COLUMN IF NOT EXISTS recurring_occurrence_id uuid NULL;

COMMENT ON COLUMN public.app_runtime_config.deal_credit_enforcement_enabled IS
  'Server-owned safety switch for deal-credit enforcement. Defaults false until billing rollout approval.';

CREATE OR REPLACE FUNCTION public.get_deal_credit_enforcement_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT COALESCE(
    (SELECT deal_credit_enforcement_enabled FROM public.app_runtime_config WHERE id = 1),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.resolve_deal_credit_location(
  p_business_id uuid,
  p_location_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_location_id uuid;
BEGIN
  IF p_business_id IS NULL THEN
    RAISE EXCEPTION 'BUSINESS_REQUIRED_FOR_DEAL_CREDIT' USING ERRCODE = 'P0001';
  END IF;

  IF p_location_id IS NOT NULL THEN
    SELECT bl.id
      INTO v_location_id
    FROM public.business_locations bl
    WHERE bl.id = p_location_id
      AND bl.business_id = p_business_id;

    IF v_location_id IS NULL THEN
      RAISE EXCEPTION 'LOCATION_NOT_FOUND_FOR_BUSINESS' USING ERRCODE = 'P0001';
    END IF;

    RETURN v_location_id;
  END IF;

  SELECT bl.id
    INTO v_location_id
  FROM public.business_locations bl
  WHERE bl.business_id = p_business_id
  ORDER BY bl.created_at ASC, bl.id ASC
  LIMIT 1;

  IF v_location_id IS NULL THEN
    RAISE EXCEPTION 'LOCATION_REQUIRED_FOR_DEAL_CREDIT' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_location_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.reserve_location_deal_credit(
  p_business_location_id uuid,
  p_purpose text,
  p_idempotency_key text,
  p_amount integer DEFAULT 1,
  p_deal_id uuid DEFAULT NULL,
  p_recurring_occurrence_id uuid DEFAULT NULL,
  p_correlation_id uuid DEFAULT gen_random_uuid()
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_existing public.deal_credit_reservations%ROWTYPE;
  v_entitlement public.location_entitlements%ROWTYPE;
  v_period public.deal_credit_periods%ROWTYPE;
  v_reservation_id uuid;
  v_reserved_at timestamptz := now();
  v_expires_at timestamptz;
  v_ttl_minutes integer;
  v_available integer;
BEGIN
  IF NOT public.get_deal_credit_enforcement_enabled() THEN
    RETURN NULL;
  END IF;

  IF p_business_location_id IS NULL THEN
    RAISE EXCEPTION 'LOCATION_REQUIRED_FOR_DEAL_CREDIT' USING ERRCODE = 'P0001';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'DEAL_CREDIT_AMOUNT_INVALID' USING ERRCODE = 'P0001';
  END IF;

  IF NULLIF(trim(COALESCE(p_idempotency_key, '')), '') IS NULL THEN
    RAISE EXCEPTION 'DEAL_CREDIT_IDEMPOTENCY_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_existing
  FROM public.deal_credit_reservations
  WHERE idempotency_key = trim(p_idempotency_key);

  IF v_existing.id IS NOT NULL THEN
    RETURN v_existing.id;
  END IF;

  SELECT *
    INTO v_entitlement
  FROM public.location_entitlements
  WHERE business_location_id = p_business_location_id
  FOR UPDATE;

  IF v_entitlement.id IS NULL THEN
    RAISE EXCEPTION 'LOCATION_ENTITLEMENT_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  IF v_entitlement.suspended_at IS NOT NULL OR v_entitlement.status NOT IN (
    'trial_active',
    'trial_canceling',
    'admin_trial_active',
    'pro_active',
    'pro_canceling',
    'paid_active',
    'paid_canceling'
  ) THEN
    RAISE EXCEPTION 'LOCATION_NOT_ACTIVE_FOR_DEAL_CREDIT' USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_period
  FROM public.deal_credit_periods
  WHERE business_location_id = p_business_location_id
    AND status = 'active'
    AND starts_at <= now()
    AND ends_at > now()
  ORDER BY starts_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_period.id IS NULL THEN
    RAISE EXCEPTION 'ACTIVE_DEAL_CREDIT_PERIOD_REQUIRED' USING ERRCODE = 'P0001';
  END IF;

  v_available := v_period.credits_granted - v_period.credits_used - v_period.credits_reserved;
  IF v_available < p_amount THEN
    RAISE EXCEPTION 'DEAL_CREDIT_LIMIT_REACHED' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(credit_reservation_ttl_minutes, 15)
    INTO v_ttl_minutes
  FROM public.get_runtime_billing_config()
  LIMIT 1;
  v_expires_at := v_reserved_at + make_interval(mins => COALESCE(v_ttl_minutes, 15));

  INSERT INTO public.deal_credit_reservations (
    business_location_id,
    credit_period_id,
    purpose,
    amount,
    status,
    idempotency_key,
    correlation_id,
    deal_id,
    reserved_at,
    expires_at,
    recurring_occurrence_id
  )
  VALUES (
    p_business_location_id,
    v_period.id,
    p_purpose,
    p_amount,
    'reserved',
    trim(p_idempotency_key),
    p_correlation_id,
    p_deal_id,
    v_reserved_at,
    v_expires_at,
    p_recurring_occurrence_id
  )
  RETURNING id INTO v_reservation_id;

  UPDATE public.deal_credit_periods
  SET credits_reserved = credits_reserved + p_amount,
      updated_at = now()
  WHERE id = v_period.id;

  INSERT INTO public.deal_credit_ledger (
    business_location_id,
    credit_period_id,
    reservation_id,
    event_type,
    purpose,
    amount,
    idempotency_key,
    correlation_id,
    deal_id,
    recurring_occurrence_id,
    metadata
  )
  VALUES (
    p_business_location_id,
    v_period.id,
    v_reservation_id,
    'reserve',
    p_purpose,
    p_amount,
    trim(p_idempotency_key) || ':reserve',
    p_correlation_id,
    p_deal_id,
    p_recurring_occurrence_id,
    jsonb_build_object('expires_at', v_expires_at)
  );

  RETURN v_reservation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.commit_location_deal_credit(
  p_reservation_id uuid,
  p_deal_id uuid DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_reservation public.deal_credit_reservations%ROWTYPE;
BEGIN
  IF p_reservation_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT *
    INTO v_reservation
  FROM public.deal_credit_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_reservation.id IS NULL THEN
    RAISE EXCEPTION 'DEAL_CREDIT_RESERVATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_reservation.status = 'committed' THEN
    RETURN true;
  END IF;

  IF v_reservation.status = 'released' THEN
    RAISE EXCEPTION 'DEAL_CREDIT_RESERVATION_RELEASED' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.deal_credit_periods
  SET credits_reserved = GREATEST(credits_reserved - v_reservation.amount, 0),
      credits_used = credits_used + v_reservation.amount,
      updated_at = now()
  WHERE id = v_reservation.credit_period_id;

  UPDATE public.deal_credit_reservations
  SET status = 'committed',
      deal_id = COALESCE(p_deal_id, deal_id),
      committed_at = now(),
      updated_at = now()
  WHERE id = v_reservation.id;

  INSERT INTO public.deal_credit_ledger (
    business_location_id,
    credit_period_id,
    reservation_id,
    event_type,
    purpose,
    amount,
    idempotency_key,
    correlation_id,
    deal_id,
    recurring_occurrence_id,
    metadata
  )
  VALUES (
    v_reservation.business_location_id,
    v_reservation.credit_period_id,
    v_reservation.id,
    'commit',
    v_reservation.purpose,
    v_reservation.amount,
    v_reservation.idempotency_key || ':commit',
    v_reservation.correlation_id,
    COALESCE(p_deal_id, v_reservation.deal_id),
    v_reservation.recurring_occurrence_id,
    '{}'::jsonb
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_location_deal_credit(
  p_reservation_id uuid,
  p_reason text DEFAULT 'released'
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_reservation public.deal_credit_reservations%ROWTYPE;
BEGIN
  IF p_reservation_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT *
    INTO v_reservation
  FROM public.deal_credit_reservations
  WHERE id = p_reservation_id
  FOR UPDATE;

  IF v_reservation.id IS NULL THEN
    RAISE EXCEPTION 'DEAL_CREDIT_RESERVATION_NOT_FOUND' USING ERRCODE = 'P0001';
  END IF;

  IF v_reservation.status = 'released' THEN
    RETURN true;
  END IF;

  IF v_reservation.status = 'committed' THEN
    RETURN false;
  END IF;

  UPDATE public.deal_credit_periods
  SET credits_reserved = GREATEST(credits_reserved - v_reservation.amount, 0),
      updated_at = now()
  WHERE id = v_reservation.credit_period_id;

  UPDATE public.deal_credit_reservations
  SET status = 'released',
      released_at = now(),
      release_reason = COALESCE(NULLIF(trim(p_reason), ''), 'released'),
      updated_at = now()
  WHERE id = v_reservation.id;

  INSERT INTO public.deal_credit_ledger (
    business_location_id,
    credit_period_id,
    reservation_id,
    event_type,
    purpose,
    amount,
    idempotency_key,
    correlation_id,
    deal_id,
    recurring_occurrence_id,
    metadata
  )
  VALUES (
    v_reservation.business_location_id,
    v_reservation.credit_period_id,
    v_reservation.id,
    'release',
    v_reservation.purpose,
    v_reservation.amount,
    v_reservation.idempotency_key || ':release',
    v_reservation.correlation_id,
    v_reservation.deal_id,
    v_reservation.recurring_occurrence_id,
    jsonb_build_object('reason', COALESCE(NULLIF(trim(p_reason), ''), 'released'))
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_location_deal_credit(
  p_business_location_id uuid,
  p_purpose text,
  p_idempotency_key text,
  p_deal_id uuid DEFAULT NULL,
  p_recurring_occurrence_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_reservation_id uuid;
BEGIN
  v_reservation_id := public.reserve_location_deal_credit(
    p_business_location_id,
    p_purpose,
    p_idempotency_key,
    1,
    p_deal_id,
    p_recurring_occurrence_id
  );

  IF v_reservation_id IS NOT NULL THEN
    PERFORM public.commit_location_deal_credit(v_reservation_id, p_deal_id);
  END IF;

  RETURN v_reservation_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_expired_deal_credit_reservations(
  p_limit integer DEFAULT 500
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  FOR v_row IN
    SELECT id
    FROM public.deal_credit_reservations
    WHERE status = 'reserved'
      AND expires_at <= now()
    ORDER BY expires_at ASC
    LIMIT GREATEST(COALESCE(p_limit, 500), 1)
  LOOP
    PERFORM public.release_location_deal_credit(v_row.id, 'expired');
    v_count := v_count + 1;
  END LOOP;

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_deal_credit_location_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
BEGIN
  IF NOT public.get_deal_credit_enforcement_enabled() THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.is_recurring, false) THEN
    RETURN NEW;
  END IF;

  NEW.location_id := public.resolve_deal_credit_location(NEW.business_id, NEW.location_id);
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.charge_deal_credit_after_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_location_id uuid;
BEGIN
  IF NOT public.get_deal_credit_enforcement_enabled() THEN
    RETURN NEW;
  END IF;

  -- A recurring row is the schedule in the current app model. Per v1.3,
  -- schedule creation is free; future occurrence materialization must charge.
  IF COALESCE(NEW.is_recurring, false) THEN
    RETURN NEW;
  END IF;

  v_location_id := public.resolve_deal_credit_location(NEW.business_id, NEW.location_id);

  PERFORM public.consume_location_deal_credit(
    v_location_id,
    'new_deal',
    'new_deal:' || v_location_id::text || ':' || NEW.id::text,
    NEW.id,
    NULL
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS deals_set_deal_credit_location_before_insert ON public.deals;
CREATE TRIGGER deals_set_deal_credit_location_before_insert
  BEFORE INSERT ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.set_deal_credit_location_before_insert();

DROP TRIGGER IF EXISTS deals_charge_deal_credit_after_insert ON public.deals;
CREATE TRIGGER deals_charge_deal_credit_after_insert
  AFTER INSERT ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.charge_deal_credit_after_insert();

REVOKE ALL ON FUNCTION public.get_deal_credit_enforcement_enabled() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_deal_credit_location(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reserve_location_deal_credit(uuid, text, text, integer, uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commit_location_deal_credit(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_location_deal_credit(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_location_deal_credit(uuid, text, text, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_expired_deal_credit_reservations(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_deal_credit_location_before_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.charge_deal_credit_after_insert() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.reserve_location_deal_credit(uuid, text, text, integer, uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.commit_location_deal_credit(uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_location_deal_credit(uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.consume_location_deal_credit(uuid, text, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.release_expired_deal_credit_reservations(integer) TO service_role;

COMMIT;
