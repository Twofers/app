-- Dedicated server kill switch for the capability-dark iOS trial Checkout
-- path in app version 1.0.2. The submitted client carries its iOS capability
-- flag, but this server flag intentionally ships OFF.

BEGIN;

ALTER TABLE public.stripe_checkout_sessions
  DROP CONSTRAINT IF EXISTS stripe_checkout_sessions_source_check;

ALTER TABLE public.stripe_checkout_sessions
  ADD CONSTRAINT stripe_checkout_sessions_source_check
  CHECK (source IN ('admin', 'website', 'email', 'sms', 'migration', 'test', 'native_ios'));

INSERT INTO public.feature_flags (key, description, enabled, rules)
VALUES (
  'ios_trial_checkout',
  'Server kill switch for native iOS merchant trial Checkout. App 1.0.2 ships with this disabled and may be enabled only after storefront and disclosure reconfirmation.',
  false,
  '{"platform":"ios","client_flag":"EXPO_PUBLIC_ENABLE_IOS_TRIAL_CHECKOUT","launch_state":"off"}'::jsonb
)
ON CONFLICT (key)
DO UPDATE SET
  description = EXCLUDED.description,
  enabled = false,
  rules = EXCLUDED.rules,
  updated_at = now();

COMMIT;
