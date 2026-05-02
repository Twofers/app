-- Schedule the push token cleanup function to run weekly via pg_cron.
--
-- The cleanup_stale_push_tokens() function (migration 20260703120001) was created but
-- never scheduled, so stale tokens (e.g. uninstalled apps, rotated device IDs) accumulate
-- forever. This migration enables pg_cron and schedules a weekly purge.

-- Enable pg_cron in the extensions schema (required by Supabase). Idempotent.
CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

-- Unschedule any existing version of this job before re-creating (so the migration is
-- safe to re-run during local development resets).
DO $$
BEGIN
  PERFORM cron.unschedule('cleanup_stale_push_tokens_weekly');
EXCEPTION
  WHEN OTHERS THEN NULL; -- job didn't exist
END $$;

-- Run every Sunday at 04:00 UTC (low-traffic window).
SELECT cron.schedule(
  'cleanup_stale_push_tokens_weekly',
  '0 4 * * 0',
  $$ SELECT public.cleanup_stale_push_tokens(); $$
);

COMMENT ON EXTENSION pg_cron IS 'Used to schedule cleanup_stale_push_tokens weekly (purges push tokens unused for 90+ days).';
