-- Atomic rate limiting for public business applications and launch signups.
-- The advisory locks close the count-then-insert concurrency gap documented in
-- the 2026-07-13 branch security audit.

CREATE TABLE IF NOT EXISTS public.submission_rate_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  bucket text NOT NULL,
  email_key text,
  ip_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS submission_rate_events_email_idx
  ON public.submission_rate_events(bucket, email_key, created_at DESC)
  WHERE email_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS submission_rate_events_ip_idx
  ON public.submission_rate_events(bucket, ip_key, created_at DESC)
  WHERE ip_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS submission_rate_events_global_idx
  ON public.submission_rate_events(bucket, created_at DESC);

ALTER TABLE public.submission_rate_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submission_rate_events FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.submission_rate_events FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.submission_rate_events TO service_role;

CREATE OR REPLACE FUNCTION public.claim_submission_slot(
  p_bucket text,
  p_email_key text,
  p_ip_key text,
  p_window_minutes integer,
  p_max_email integer,
  p_max_ip integer,
  p_max_global integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_window_start timestamptz;
  v_count integer;
BEGIN
  IF p_bucket NOT IN ('business_application', 'business_application_alert', 'launch_signup')
    OR p_window_minutes < 1 OR p_window_minutes > 1440
    OR p_max_email < 0 OR p_max_email > 1000
    OR p_max_ip < 0 OR p_max_ip > 1000
    OR p_max_global < 0 OR p_max_global > 100000
    OR (p_max_email = 0 AND p_max_ip = 0 AND p_max_global = 0)
    OR (p_email_key IS NOT NULL AND p_email_key !~ '^[a-f0-9]{64}$')
    OR (p_ip_key IS NOT NULL AND p_ip_key !~ '^[a-f0-9]{64}$')
  THEN
    RETURN false;
  END IF;

  v_window_start := now() - make_interval(mins => p_window_minutes);

  IF p_max_global > 0 THEN
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_bucket || ':global', 0)
    );
  END IF;
  IF p_max_email > 0 THEN
    IF p_email_key IS NULL OR p_email_key = '' THEN RETURN false; END IF;
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_bucket || ':email:' || p_email_key, 0)
    );
  END IF;
  IF p_max_ip > 0 THEN
    IF p_ip_key IS NULL OR p_ip_key = '' THEN RETURN false; END IF;
    PERFORM pg_advisory_xact_lock(
      hashtextextended(p_bucket || ':ip:' || p_ip_key, 0)
    );
  END IF;

  DELETE FROM public.submission_rate_events
  WHERE created_at < now() - interval '7 days';

  IF p_max_global > 0 THEN
    SELECT count(*)::integer INTO v_count
    FROM public.submission_rate_events
    WHERE bucket = p_bucket
      AND created_at >= v_window_start;
    IF v_count >= p_max_global THEN RETURN false; END IF;
  END IF;

  IF p_max_email > 0 THEN
    SELECT count(*)::integer INTO v_count
    FROM public.submission_rate_events
    WHERE bucket = p_bucket
      AND email_key = p_email_key
      AND created_at >= v_window_start;
    IF v_count >= p_max_email THEN RETURN false; END IF;
  END IF;

  IF p_max_ip > 0 THEN
    SELECT count(*)::integer INTO v_count
    FROM public.submission_rate_events
    WHERE bucket = p_bucket
      AND ip_key = p_ip_key
      AND created_at >= v_window_start;
    IF v_count >= p_max_ip THEN RETURN false; END IF;
  END IF;

  INSERT INTO public.submission_rate_events(bucket, email_key, ip_key)
  VALUES (p_bucket, p_email_key, p_ip_key);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_submission_slot(text, text, text, integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_submission_slot(text, text, text, integer, integer, integer, integer)
  TO service_role;
