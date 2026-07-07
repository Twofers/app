-- Customer launch-updates email list (Dan, 2026-07-07): while the apps are
-- not in the stores, the public site's "email me launch updates" fallback
-- becomes a real form that saves the address, instead of a mailto link that
-- silently fails on machines with no mail app. Rows are written only by the
-- submit-launch-signup edge function (service role); the table is not
-- readable or writable by anon/authenticated clients.

BEGIN;

CREATE TABLE IF NOT EXISTS public.launch_signups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stored lowercased by the edge function (cleanEmail), so a plain UNIQUE
  -- gives case-insensitive dedupe and lets PostgREST upsert on this column.
  email text NOT NULL UNIQUE,
  locale text NULL CHECK (locale IN ('en', 'es', 'ko')),
  source text NOT NULL DEFAULT 'website',
  -- Kept only for the edge function's per-IP rate-limit window and abuse
  -- follow-up; not exposed anywhere client-facing.
  ip_address text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS launch_signups_ip_created_idx
  ON public.launch_signups (ip_address, created_at);

ALTER TABLE public.launch_signups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.launch_signups FROM PUBLIC;
REVOKE ALL ON public.launch_signups FROM anon, authenticated;
GRANT SELECT, INSERT ON public.launch_signups TO service_role;

COMMENT ON TABLE public.launch_signups IS
  'Customer emails collected by the public "email me launch updates" form via the submit-launch-signup edge function. Service-role only; no client policies on purpose.';

COMMIT;
