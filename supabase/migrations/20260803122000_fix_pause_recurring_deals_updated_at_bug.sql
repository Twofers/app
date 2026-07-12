-- Fix pause_recurring_deals_on_billing_suspension(): it referenced
-- deals.updated_at, a column that does not exist on public.deals (only
-- created_at does). Every UPDATE/INSERT on location_entitlements that
-- transitioned a row into a suspended status threw 42703 and rolled back the
-- whole calling transaction — including the businesses.access_level /
-- business_subscriptions downgrade that triggered it in the first place.
--
-- This bug predates the billing source-of-truth fix (trigger added in
-- 20260726134000) but was latent: nothing wrote a real business's
-- location_entitlements row into a suspended state until that fix started
-- populating the table. Caught during live billing QA (cancellation
-- downgrade test), not something introduced by this migration.
--
-- Fix: drop the non-existent column assignment. is_active/deal_status are
-- the actual columns that pause a recurring deal; deals has no updated_at
-- to touch.

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
        deal_status = 'PAUSED'
    WHERE location_id = NEW.business_location_id
      AND COALESCE(is_recurring, false) = true
      AND COALESCE(is_active, false) = true
      AND COALESCE(deal_status, 'LIVE') <> 'ENDED';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.pause_recurring_deals_on_billing_suspension()
  IS 'Automatically pauses active recurring deal schedules when a location entitlement first enters a suspended billing state. Fixed 2026: deals has no updated_at column.';
