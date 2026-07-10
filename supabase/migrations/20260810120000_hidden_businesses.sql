-- Hidden businesses: a per-user "block / hide this business" preference.
--
-- Apple App Store guideline 1.2 (user-generated content) asks for a user-facing
-- control to block abusive accounts. Twofer's content producers are vetted
-- merchants, so "block" here means "hide this business from my feed": a purely
-- per-user preference that filters that business's deals out of the customer's
-- feed and map. It is not a moderation/security control — server-side removal of
-- a bad merchant is handled by the admin console — so the client reads/writes
-- this table directly under RLS (no RPC needed), mirroring `favorites`.

BEGIN;

CREATE TABLE IF NOT EXISTS public.hidden_businesses (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, business_id)
);

-- Feed/map load the hidden set for the current user; index the lookup by user.
CREATE INDEX IF NOT EXISTS idx_hidden_businesses_user_id
  ON public.hidden_businesses (user_id);

ALTER TABLE public.hidden_businesses ENABLE ROW LEVEL SECURITY;

-- Supabase grants privileges to anon/authenticated by default; REVOKE FROM PUBLIC
-- alone is not enough here (see feedback_rls_null_policy_incident). Lock the table
-- to the authenticated owner only, then let RLS scope every row to auth.uid().
REVOKE ALL ON public.hidden_businesses FROM PUBLIC;
REVOKE ALL ON public.hidden_businesses FROM anon;
GRANT SELECT, INSERT, DELETE ON public.hidden_businesses TO authenticated;

DROP POLICY IF EXISTS hidden_businesses_self_select ON public.hidden_businesses;
CREATE POLICY hidden_businesses_self_select
  ON public.hidden_businesses FOR SELECT
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS hidden_businesses_self_insert ON public.hidden_businesses;
CREATE POLICY hidden_businesses_self_insert
  ON public.hidden_businesses FOR INSERT
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS hidden_businesses_self_delete ON public.hidden_businesses;
CREATE POLICY hidden_businesses_self_delete
  ON public.hidden_businesses FOR DELETE
  USING (auth.uid() = user_id);

COMMENT ON TABLE public.hidden_businesses IS
  'Per-user "hide this business" preference (Apple 1.2 block control). Filters the business''s deals out of the user''s feed/map. Not a security control; client-managed under RLS like favorites.';

COMMIT;
