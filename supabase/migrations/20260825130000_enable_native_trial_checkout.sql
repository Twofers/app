-- Flip the native trial Checkout kill switch on. Everything that reads it —
-- stripe-create-checkout-session's nativeTrialCheckoutEnabled() and
-- get_business_capabilities' can_activate_trial_checkout — was deployed and
-- applied in 20260825120000; this is the founder go-ahead to make the button
-- live on both iOS and Android for approved-but-not-activated merchants.

BEGIN;

DO $$
BEGIN
  UPDATE public.feature_flags
  SET enabled = true, updated_at = now()
  WHERE key = 'ios_trial_checkout';

  IF NOT FOUND THEN
    RAISE EXCEPTION 'feature_flags row key=ios_trial_checkout is required';
  END IF;
END
$$;

COMMIT;
