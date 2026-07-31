-- Enable the approved production Stripe billing runtime after the live
-- product, customer portal, receipts, and webhook have been configured.
-- The Stripe secret and webhook signing secret remain hosted Edge secrets;
-- this migration stores only the non-secret live Price ID and runtime flags.

BEGIN;

DO $$
BEGIN
  UPDATE public.app_runtime_config
  SET
    purchase_surface = 'web_only',
    billing_environment = 'production',
    twofer_business_monthly_price_id_live = 'price_1TxfqL1k90plY1fz9RvlCtD6',
    require_card_for_trial = true,
    updated_at = now()
  WHERE id = 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'app_runtime_config row id=1 is required';
  END IF;
END
$$;

COMMIT;
