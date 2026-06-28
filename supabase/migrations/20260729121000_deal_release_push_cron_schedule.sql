-- Schedule due customer deal release pushes.
--
-- The shared cron secret is generated in 20260729120000 and stays in Supabase
-- Vault. This migration only reads it inside Postgres when pg_cron invokes the
-- Edge Function; it does not expose or commit the secret.
-- Do not apply without Dan's explicit migration approval.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.deal_release_push_cron_status()
RETURNS TABLE (jobname text, schedule text, active boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jobname, schedule, active
  FROM cron.job
  WHERE jobname = 'send-due-deal-release-pushes';
$$;

REVOKE ALL ON FUNCTION public.deal_release_push_cron_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.deal_release_push_cron_status() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-due-deal-release-pushes') THEN
    PERFORM cron.unschedule('send-due-deal-release-pushes');
  END IF;

  PERFORM cron.schedule(
    'send-due-deal-release-pushes',
    '*/5 * * * *',
    $cron$
      SELECT net.http_post(
        url := 'https://kvodhiqhdqnptqovovia.supabase.co/functions/v1/send-deal-push',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'x-cron-secret', (
            SELECT decrypted_secret
            FROM vault.decrypted_secrets
            WHERE name = 'deal_release_push_cron_secret'
          )
        ),
        body := '{"dispatch_due":true}'::jsonb
      );
    $cron$
  );
END
$$;

COMMENT ON FUNCTION public.deal_release_push_cron_status()
  IS 'Service-role helper for verifying the scheduled deal release push cron job.';

COMMIT;
