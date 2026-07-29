CREATE TABLE IF NOT EXISTS public.anonymous_endpoint_attempts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  surface text NOT NULL,
  actor_hash text NOT NULL,
  attempted_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS anonymous_endpoint_attempts_lookup_idx
  ON public.anonymous_endpoint_attempts(surface, actor_hash, attempted_at DESC);
CREATE INDEX IF NOT EXISTS anonymous_endpoint_attempts_global_idx
  ON public.anonymous_endpoint_attempts(surface, attempted_at DESC);

ALTER TABLE public.anonymous_endpoint_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.anonymous_endpoint_attempts FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.anonymous_endpoint_attempts FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.anonymous_endpoint_attempts TO service_role;

CREATE OR REPLACE FUNCTION public.consume_anonymous_endpoint_attempt(
  p_surface text,
  p_actor_hash text,
  p_actor_limit integer,
  p_global_limit integer,
  p_window_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  v_actor_count integer;
  v_global_count integer;
  v_window interval;
BEGIN
  IF p_surface !~ '^[a-z0-9_-]{3,80}$'
    OR p_actor_hash !~ '^[a-f0-9]{64}$'
    OR p_actor_limit < 1 OR p_actor_limit > 1000
    OR p_global_limit < p_actor_limit OR p_global_limit > 100000
    OR p_window_seconds < 60 OR p_window_seconds > 86400
  THEN
    RETURN false;
  END IF;

  v_window := make_interval(secs => p_window_seconds);
  PERFORM pg_advisory_xact_lock(hashtextextended('anon-global:' || p_surface, 0));
  PERFORM pg_advisory_xact_lock(hashtextextended('anon-actor:' || p_surface || ':' || p_actor_hash, 0));

  DELETE FROM public.anonymous_endpoint_attempts
  WHERE attempted_at < now() - interval '2 days';

  SELECT count(*)::integer INTO v_global_count
  FROM public.anonymous_endpoint_attempts
  WHERE surface = p_surface
    AND attempted_at >= now() - v_window;

  SELECT count(*)::integer INTO v_actor_count
  FROM public.anonymous_endpoint_attempts
  WHERE surface = p_surface
    AND actor_hash = p_actor_hash
    AND attempted_at >= now() - v_window;

  IF v_global_count >= p_global_limit OR v_actor_count >= p_actor_limit THEN
    RETURN false;
  END IF;

  INSERT INTO public.anonymous_endpoint_attempts(surface, actor_hash)
  VALUES (p_surface, p_actor_hash);
  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.consume_anonymous_endpoint_attempt(text, text, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.consume_anonymous_endpoint_attempt(text, text, integer, integer, integer)
  TO service_role;
