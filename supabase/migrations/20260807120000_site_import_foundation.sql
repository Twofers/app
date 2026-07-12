-- Website Import at Business Onboarding — foundation (WI-1).
-- Additive only: allow a new menu-item source and add a service-role-only
-- rate-limit event log. Touches no existing RLS policy or policy helper.

-- 1) Allow 'import' as a menu-item source (website import at onboarding).
--    The original inline CHECK in 20260429120000_business_menu_items.sql is
--    named business_menu_items_source_check by Postgres. Drop it defensively
--    (whatever its name) and recreate with the expanded allow-list.
DO $$
DECLARE
  con_name text;
BEGIN
  SELECT c.conname
    INTO con_name
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
   WHERE n.nspname = 'public'
     AND t.relname = 'business_menu_items'
     AND c.contype = 'c'
     AND pg_get_constraintdef(c.oid) ILIKE '%source%'
   LIMIT 1;

  IF con_name IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.business_menu_items DROP CONSTRAINT %I',
      con_name
    );
  END IF;
END $$;

ALTER TABLE public.business_menu_items
  ADD CONSTRAINT business_menu_items_source_check
  CHECK (source IN ('scan', 'manual', 'import'));

-- 2) Per-user scan-event log for rate limiting (service-role only).
--    Stores no content — only the hostname and a timestamp per scan so the
--    edge function can enforce a daily cap. Never store full URLs (they may
--    carry tokens or paths).
CREATE TABLE IF NOT EXISTS public.site_import_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  website_host TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_site_import_events_user_time
  ON public.site_import_events (user_id, created_at DESC);

-- RLS enabled with NO policies + revoked grants = only the service role can
-- read or write this table. No client ever touches it.
ALTER TABLE public.site_import_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.site_import_events FROM anon, authenticated;

COMMENT ON TABLE public.site_import_events IS
  'Service-role-only per-user website-import scan log for rate limiting; hostname + timestamp only, no content.';
