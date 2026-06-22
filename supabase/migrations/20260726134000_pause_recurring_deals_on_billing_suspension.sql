-- Pause recurring deals when a billed location becomes suspended.
--
-- The deal write guard allows deactivation-only updates for suspended
-- locations, so this trigger can pause recurring schedules without permitting
-- owners to resume or edit them until billing is restored.

CREATE OR REPLACE FUNCTION public.is_location_entitlement_suspended(
  p_status text,
  p_suspended_at timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT COALESCE(
    p_suspended_at IS NOT NULL
    OR p_status IN (
      'trial_expired_payment_failed_suspended',
      'trial_expired_suspended',
      'payment_failed_suspended',
      'canceled_suspended',
      'refunded_suspended',
      'admin_trial_expired_suspended'
    ),
    false
  );
$$;

CREATE OR REPLACE FUNCTION public.pause_recurring_deals_on_billing_suspension()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_was_suspended boolean := false;
  v_now_suspended boolean := false;
BEGIN
  v_now_suspended := public.is_location_entitlement_suspended(NEW.status, NEW.suspended_at);

  IF TG_OP = 'UPDATE' THEN
    v_was_suspended := public.is_location_entitlement_suspended(OLD.status, OLD.suspended_at);
  END IF;

  IF v_now_suspended AND NOT v_was_suspended THEN
    UPDATE public.deals
    SET is_active = false,
        deal_status = 'PAUSED',
        updated_at = now()
    WHERE location_id = NEW.business_location_id
      AND COALESCE(is_recurring, false) = true
      AND COALESCE(is_active, false) = true
      AND COALESCE(deal_status, 'LIVE') <> 'ENDED';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS location_entitlements_pause_recurring_deals_on_suspension
  ON public.location_entitlements;
CREATE TRIGGER location_entitlements_pause_recurring_deals_on_suspension
  AFTER INSERT OR UPDATE OF status, suspended_at ON public.location_entitlements
  FOR EACH ROW
  EXECUTE FUNCTION public.pause_recurring_deals_on_billing_suspension();

REVOKE ALL ON FUNCTION public.is_location_entitlement_suspended(text, timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pause_recurring_deals_on_billing_suspension() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_location_entitlement_suspended(text, timestamptz) TO service_role;

COMMENT ON FUNCTION public.pause_recurring_deals_on_billing_suspension()
  IS 'Automatically pauses active recurring deal schedules when a location entitlement first enters a suspended billing state.';
