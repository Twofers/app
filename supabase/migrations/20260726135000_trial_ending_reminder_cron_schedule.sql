-- Schedule the 24-hour billing trial-ending reminder Edge Function.
--
-- The shared cron secret is generated in 20260726130000 and stays in Supabase
-- Vault. This migration only reads it inside Postgres when pg_cron invokes the
-- Edge Function; it does not expose or commit the secret.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.billing_trial_reminder_cron_status()
RETURNS TABLE (jobname text, schedule text, active boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jobname, schedule, active
  FROM cron.job
  WHERE jobname = 'send-trial-ending-reminders';
$$;

REVOKE ALL ON FUNCTION public.billing_trial_reminder_cron_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.billing_trial_reminder_cron_status() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-trial-ending-reminders') THEN
    PERFORM cron.unschedule('send-trial-ending-reminders');
  END IF;

  PERFORM cron.schedule(
    'send-trial-ending-reminders',
    '*/30 * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://kvodhiqhdqnptqovovia.supabase.co/functions/v1/send-trial-ending-reminders',
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

COMMENT ON FUNCTION public.billing_trial_reminder_cron_status()
  IS 'Service-role helper for verifying the scheduled billing trial-ending reminder cron job.';

COMMIT;
