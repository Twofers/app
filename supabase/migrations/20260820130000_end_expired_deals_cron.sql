-- Expire LIVE deals whose end_time has passed: flip deal_status to ENDED and
-- deactivate them.
--
-- Bug: nothing ever transitioned a deal out of deal_status='LIVE' when its
-- end_time passed. One-time and recurring campaigns stayed LIVE/is_active=true
-- forever once expired (41 of 58 deals as of 2026-07-20). The consumer feed and
-- merchant dashboard were unaffected because both derive effective status from
-- end_time at read time, but every server-side consumer that trusts the
-- deal_status column directly (admin views, analytics, the billing pause sweep)
-- saw stale data.
--
-- Fix: a small idempotent SQL sweep on the existing pg_cron infrastructure
-- (mirrors deal-credit-reservation-sweep), plus a one-time backfill of the rows
-- that already drifted. deals has no updated_at column (see
-- 20260803122000_fix_pause_recurring_deals_updated_at_bug), so we touch only
-- is_active / deal_status — the same columns the pause trigger writes.
--
-- Drafted for the db-guardrails QA pass. Do not apply without Dan's explicit
-- migration approval.

BEGIN;

CREATE OR REPLACE FUNCTION public.end_expired_deals(p_limit integer DEFAULT 1000)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH expired AS (
    SELECT id
    FROM public.deals
    WHERE COALESCE(deal_status, 'LIVE') = 'LIVE'
      AND end_time IS NOT NULL
      AND end_time < now()
    ORDER BY end_time ASC
    LIMIT GREATEST(p_limit, 1)
  )
  UPDATE public.deals d
  SET deal_status = 'ENDED',
      is_active = false
  FROM expired
  WHERE d.id = expired.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.end_expired_deals(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.end_expired_deals(integer) TO service_role;

COMMENT ON FUNCTION public.end_expired_deals(integer)
  IS 'Sweeps LIVE deals whose end_time has passed into deal_status=ENDED, is_active=false. Idempotent; safe to run repeatedly. Scheduled every 10 min via pg_cron job end-expired-deals.';

-- Service-role helper for verifying the scheduled sweep (parity with
-- expire_billing_access_cron_status()).
CREATE OR REPLACE FUNCTION public.end_expired_deals_cron_status()
RETURNS TABLE (jobname text, schedule text, active boolean)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT jobname, schedule, active
  FROM cron.job
  WHERE jobname = 'end-expired-deals';
$$;

REVOKE ALL ON FUNCTION public.end_expired_deals_cron_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.end_expired_deals_cron_status() TO service_role;

-- Schedule the sweep on the existing pg_cron infra. Every 10 minutes: expiry is
-- not second-sensitive because the feed already hides past-end_time deals.
CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'end-expired-deals') THEN
    PERFORM cron.unschedule('end-expired-deals');
  END IF;
  PERFORM cron.schedule(
    'end-expired-deals',
    '*/10 * * * *',
    $cron$ SELECT public.end_expired_deals(1000); $cron$
  );
END $$;

-- One-time backfill of rows that already drifted.
SELECT public.end_expired_deals(100000);

COMMIT;
