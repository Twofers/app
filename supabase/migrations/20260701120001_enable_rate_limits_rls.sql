-- Lock down backend-only rate limiting table.
DO $$
BEGIN
  IF to_regclass('public.rate_limits') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.rate_limits FROM anon, authenticated';
  END IF;
END
$$;
