-- Schedule the billing access expiry sweep Edge Function (expire-billing-access).
--
-- Reuses the same cron secret and verify_billing_reminder_secret() RPC created
-- in 20260726130000 for send-trial-ending-reminders — no new Vault secret.
--
-- This sweep closes two gaps that nothing else covers:
--  - Admin card-free trials have no Stripe subscription driving expiry, so a
--    trial whose owner never converts would otherwise stay active forever.
--  - Stripe past-due grace periods (PAST_DUE_GRACE_DAYS) had no expiry check,
--    so a business that never recovers payment would keep paid access forever.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.expire_billing_access_cron_status()
RETURNS TABLE (jobname text, schedule text, active boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jobname, schedule, active
  FROM cron.job
  WHERE jobname = 'expire-billing-access';
$$;

REVOKE ALL ON FUNCTION public.expire_billing_access_cron_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.expire_billing_access_cron_status() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'expire-billing-access') THEN
    PERFORM cron.unschedule('expire-billing-access');
  END IF;

  PERFORM cron.schedule(
    'expire-billing-access',
    '*/15 * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://kvodhiqhdqnptqovovia.supabase.co/functions/v1/expire-billing-access',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'billing_reminder_cron_secret'
          )
        ),
        body := '{}'::jsonb
      );
    $cron$
  );
END
$$;

COMMENT ON FUNCTION public.expire_billing_access_cron_status()
  IS 'Service-role helper for verifying the scheduled billing access expiry sweep cron job.';

COMMIT;
