BEGIN;

CREATE UNIQUE INDEX IF NOT EXISTS idx_stripe_checkout_sessions_one_open_admin_trial_conversion
  ON public.stripe_checkout_sessions (business_id)
  WHERE session_type = 'subscription_checkout'
    AND status IN ('created', 'opened')
    AND COALESCE(metadata ->> 'checkout_purpose', '') = 'admin_trial_conversion';

COMMENT ON INDEX public.idx_stripe_checkout_sessions_one_open_admin_trial_conversion IS
  'Prevents concurrent Stripe card-attachment sessions for one admin-granted business trial.';

COMMIT;
