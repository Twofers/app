-- Optional promotional-materials authorization (business onboarding).
--
-- A business may optionally authorize Twofer to place removable promotional
-- materials (countertop displays, window decals, QR signs) at a location.
-- This is DELIBERATELY separate from terms acceptance: accepting the Business
-- Terms must never imply placement permission. Nothing in this migration is
-- referenced by can_business_publish, billing, trial, or verification — the
-- feature is inert with respect to every gate.
--
-- Event model: grant = INSERT, revoke = stamp revoked_at on the open row.
-- Rows are never deleted, so consent history is preserved for audit.

CREATE TABLE IF NOT EXISTS public.promo_materials_authorizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES public.business_locations(id) ON DELETE CASCADE,
  authorized_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  -- Person who made the selection (null for website intake before the owner
  -- account exists, and for admin-assisted rows where the authorizer is
  -- identified by name/role instead).
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  authorizer_name text,
  authorizer_role text,
  -- CURRENT_BUSINESS_TERMS_VERSION at grant time, so we can always tell which
  -- disclosure text the business saw when it authorized.
  business_terms_version text NOT NULL,
  source text NOT NULL,
  recorded_by_admin_user_id uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  -- Admin-assisted path only: the date the business actually gave permission.
  permission_received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT promo_materials_authorizations_source_check
    CHECK (source IN ('app_onboarding', 'app_settings', 'website_onboarding', 'admin_assisted')),
  -- An admin can never record a bare authorization: the authorizing person,
  -- their role, when permission was given, and which admin recorded it are all
  -- mandatory. Enforced at the DB layer so no future caller can bypass it.
  CONSTRAINT promo_materials_authorizations_admin_identity_check
    CHECK (
      source <> 'admin_assisted'
      OR (
        authorizer_name IS NOT NULL
        AND authorizer_role IS NOT NULL
        AND permission_received_at IS NOT NULL
        AND recorded_by_admin_user_id IS NOT NULL
      )
    )
);

-- "Authorized" for a location = an open (un-revoked) row exists. At most one
-- open row per location; a re-grant after revoke inserts a new row.
CREATE UNIQUE INDEX IF NOT EXISTS promo_auth_one_active_per_location
  ON public.promo_materials_authorizations(location_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_promo_materials_authorizations_business_created
  ON public.promo_materials_authorizations(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_promo_materials_authorizations_location
  ON public.promo_materials_authorizations(location_id);

COMMENT ON TABLE public.promo_materials_authorizations IS
  'Optional per-location consent to place removable Twofer promotional materials. Append-only: revoke stamps revoked_at, never deletes. Not referenced by any publish/billing gate.';

ALTER TABLE public.promo_materials_authorizations ENABLE ROW LEVEL SECURITY;

-- Members (and business.read admins) may read their own consent history.
-- All writes go through service-role edge functions — same trust model as
-- terms_acceptances — so there is deliberately no INSERT/UPDATE policy here.
DROP POLICY IF EXISTS promo_materials_authorizations_member_read ON public.promo_materials_authorizations;
CREATE POLICY promo_materials_authorizations_member_read
  ON public.promo_materials_authorizations FOR SELECT
  TO authenticated
  USING (
    COALESCE(public.is_business_member(business_id), false)
    OR COALESCE(public.admin_can('business.read'), false)
  );

-- Redeemer (staff redemption) sessions can never see or touch consent records.
-- COALESCE per the RESTRICTIVE-policy NULL incident: a NULL here would
-- evaluate the whole policy to NULL and deny every authenticated caller.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'is_redeemer_session'
  ) THEN
    DROP POLICY IF EXISTS redeemer_promo_materials_authorizations_block_all
      ON public.promo_materials_authorizations;
    CREATE POLICY redeemer_promo_materials_authorizations_block_all
      ON public.promo_materials_authorizations
      AS RESTRICTIVE FOR ALL TO authenticated
      USING (NOT COALESCE(public.is_redeemer_session(), false))
      WITH CHECK (NOT COALESCE(public.is_redeemer_session(), false));
  END IF;
END $$;

-- Explicit revoke from anon AND authenticated, not just PUBLIC: on Supabase the
-- two roles carry their own grants and REVOKE ... FROM PUBLIC leaves them intact.
REVOKE ALL ON TABLE public.promo_materials_authorizations FROM PUBLIC;
REVOKE ALL ON TABLE public.promo_materials_authorizations FROM anon, authenticated;
GRANT SELECT ON TABLE public.promo_materials_authorizations TO authenticated;
-- UPDATE is needed only to stamp revoked_at. No DELETE to anyone: history stays.
GRANT SELECT, INSERT, UPDATE ON TABLE public.promo_materials_authorizations TO service_role;

-- Website intake carries the optional selection through to onboarding sync.
-- Nullable + default false, so every existing application row reads as "not
-- authorized" without a backfill.
ALTER TABLE public.business_applications
  ADD COLUMN IF NOT EXISTS promo_materials_authorized boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.business_applications.promo_materials_authorized IS
  'Optional website-intake selection; synced into promo_materials_authorizations only when true.';

-- No backfill by design: businesses with no rows read as "Not authorized",
-- which is the required default for an opt-in consent.
