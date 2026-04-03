-- Lock down billing configuration table to backend-only access.
DO $$
BEGIN
  IF to_regclass('public.app_config') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.app_config ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.app_config FROM anon, authenticated';
  END IF;
END
$$;
