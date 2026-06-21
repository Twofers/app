-- Schedule the deal-credit reservation sweep via pg_cron.
--
-- The sweep only releases expired reservations created by the server-owned credit
-- helpers. Credit enforcement remains disabled by default through
-- app_runtime_config.deal_credit_enforcement_enabled=false.

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;

DO $$
BEGIN
  PERFORM cron.unschedule('deal-credit-reservation-sweep');
EXCEPTION
  WHEN OTHERS THEN NULL;
END $$;

-- Run every 5 minutes so 15-minute reservations do not drift far beyond TTL.
SELECT cron.schedule(
  'deal-credit-reservation-sweep',
  '*/5 * * * *',
  $$ SELECT public.release_expired_deal_credit_reservations(500); $$
);

