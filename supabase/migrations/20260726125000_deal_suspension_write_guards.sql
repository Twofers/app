-- Block direct deal writes for suspended billed locations.
--
-- Edge Functions perform the same check before expensive work, but owners can still
-- write some deal rows directly from the mobile app. This trigger catches those
-- direct inserts/resumes/edits while still allowing pause/end updates so existing
-- claims can be redeemed through their normal expiration path.

CREATE OR REPLACE FUNCTION public.is_location_billing_suspended(
  p_business_location_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT COALESCE(
    (
      SELECT
        le.suspended_at IS NOT NULL
        OR le.status IN (
          'trial_expired_payment_failed_suspended',
          'trial_expired_suspended',
          'payment_failed_suspended',
          'canceled_suspended',
          'refunded_suspended',
          'admin_trial_expired_suspended'
        )
      FROM public.location_entitlements le
      WHERE le.business_location_id = p_business_location_id
      LIMIT 1
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.is_suspended_deal_deactivation_only(
  p_old_is_active boolean,
  p_new_is_active boolean,
  p_old_end_time timestamptz,
  p_new_end_time timestamptz,
  p_old_deal_status text,
  p_new_deal_status text,
  p_old_row jsonb,
  p_new_row jsonb
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT
    COALESCE(p_new_is_active, false) = false
    AND (
      p_old_is_active IS DISTINCT FROM p_new_is_active
      OR p_old_end_time IS DISTINCT FROM p_new_end_time
      OR p_old_deal_status IS DISTINCT FROM p_new_deal_status
    )
    AND (
      p_old_deal_status IS NOT DISTINCT FROM p_new_deal_status
      OR p_new_deal_status IN ('PAUSED', 'ENDED')
    )
    AND (
      p_new_row - 'is_active' - 'end_time' - 'deal_status' - 'updated_at'
    ) = (
      p_old_row - 'is_active' - 'end_time' - 'deal_status' - 'updated_at'
    );
$$;

CREATE OR REPLACE FUNCTION public.block_suspended_location_deal_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_new_location_id uuid;
  v_old_location_id uuid;
  v_location_suspended boolean := false;
BEGIN
  IF TG_OP NOT IN ('INSERT', 'UPDATE') THEN
    RETURN NEW;
  END IF;

  v_new_location_id := public.resolve_deal_credit_location(NEW.business_id, NEW.location_id);
  v_location_suspended := public.is_location_billing_suspended(v_new_location_id);

  IF TG_OP = 'UPDATE' THEN
    v_old_location_id := public.resolve_deal_credit_location(OLD.business_id, OLD.location_id);
    v_location_suspended :=
      v_location_suspended
      OR public.is_location_billing_suspended(v_old_location_id);
  END IF;

  IF NOT v_location_suspended THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND public.is_suspended_deal_deactivation_only(
    OLD.is_active,
    NEW.is_active,
    OLD.end_time,
    NEW.end_time,
    OLD.deal_status,
    NEW.deal_status,
    to_jsonb(OLD),
    to_jsonb(NEW)
  ) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'LOCATION_BILLING_SUSPENDED'
    USING
      ERRCODE = 'P0001',
      HINT = 'Billing must be restored before creating, resuming, editing, scheduling, or recurring deals for this location.';
END;
$$;

DROP TRIGGER IF EXISTS deals_block_suspended_location_write ON public.deals;
CREATE TRIGGER deals_block_suspended_location_write
  BEFORE INSERT OR UPDATE ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.block_suspended_location_deal_write();

REVOKE ALL ON FUNCTION public.is_location_billing_suspended(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_suspended_deal_deactivation_only(
  boolean,
  boolean,
  timestamptz,
  timestamptz,
  text,
  text,
  jsonb,
  jsonb
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.block_suspended_location_deal_write() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_location_billing_suspended(uuid) TO service_role;
