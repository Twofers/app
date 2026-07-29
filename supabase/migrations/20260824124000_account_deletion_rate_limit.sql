-- Customer-initiated account deletion remains available, but repeated attempts
-- are recorded and atomically capped before billing/Auth side effects begin.

CREATE TABLE IF NOT EXISTS public.account_deletion_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS account_deletion_attempts_user_time_idx
  ON public.account_deletion_attempts(user_id, attempted_at DESC);
CREATE INDEX IF NOT EXISTS account_deletion_attempts_global_time_idx
  ON public.account_deletion_attempts(attempted_at DESC);

ALTER TABLE public.account_deletion_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_deletion_attempts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.account_deletion_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.account_deletion_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.consume_account_deletion_attempt(
  p_user_id uuid,
  p_max_attempts integer DEFAULT 3,
  p_global_max integer DEFAULT 50
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_count integer;
  v_global_count integer;
BEGIN
  IF p_user_id IS NULL
    OR p_max_attempts < 1 OR p_max_attempts > 10
    OR p_global_max < p_max_attempts OR p_global_max > 1000
  THEN
    RETURN false;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('account-deletion-global', 0));
  PERFORM pg_advisory_xact_lock(hashtextextended(p_user_id::text, 0));

  DELETE FROM public.account_deletion_attempts
  WHERE attempted_at < now() - interval '30 days';

  SELECT count(*)::integer
  INTO v_global_count
  FROM public.account_deletion_attempts
  WHERE attempted_at >= now() - interval '24 hours';

  IF v_global_count >= p_global_max THEN
    RETURN false;
  END IF;

  SELECT count(*)::integer
  INTO v_count
  FROM public.account_deletion_attempts
  WHERE user_id = p_user_id
    AND attempted_at >= now() - interval '24 hours';

  IF v_count >= p_max_attempts THEN
    RETURN false;
  END IF;

  INSERT INTO public.account_deletion_attempts(user_id)
  VALUES (p_user_id);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_account_deletion_attempt(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_account_deletion_attempt(uuid, integer, integer)
  TO service_role;
