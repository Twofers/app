-- Unified admin lifecycle controls for business and customer accounts.
--
-- This migration is intentionally additive. Applying it is production-changing
-- and requires explicit approval. After any apply, run the RLS smoke probes.

BEGIN;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS account_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS suspended_at timestamptz,
  ADD COLUMN IF NOT EXISTS suspended_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS suspension_reason text,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS archive_reason text;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_account_status_check,
  ADD CONSTRAINT profiles_account_status_check
    CHECK (account_status IN ('active', 'suspended', 'archived'));

CREATE INDEX IF NOT EXISTS idx_profiles_account_status_updated
  ON public.profiles (account_status, updated_at DESC);

-- Some legacy Auth users never created public.profiles. Account management
-- needs one lifecycle row for every login, without changing the locked role
-- decision for users that already have a role.
INSERT INTO public.profiles (id, role, account_status)
SELECT
  u.id,
  CASE
    WHEN EXISTS (SELECT 1 FROM public.businesses b WHERE b.owner_id = u.id)
      THEN 'business'
    ELSE 'customer'
  END,
  'active'
FROM auth.users u
WHERE COALESCE(u.raw_app_meta_data ->> 'app_role', '') <> 'redeemer'
  AND NOT EXISTS (SELECT 1 FROM public.admin_users au WHERE au.id = u.id)
ON CONFLICT (id) DO NOTHING;

-- Exact pre-suspension state is service-role only. It lets Reactivate restore
-- the statuses and only the offers that were live before suspension.
CREATE TABLE IF NOT EXISTS public.account_lifecycle_state (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  previous_businesses jsonb NOT NULL DEFAULT '[]'::jsonb,
  previous_subscriptions jsonb NOT NULL DEFAULT '[]'::jsonb,
  previous_active_deal_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
  captured_at timestamptz NOT NULL DEFAULT now(),
  captured_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.account_lifecycle_state ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.account_lifecycle_state FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.account_lifecycle_state TO service_role;

-- Account lifecycle columns are server-owned. Existing client RLS allows a
-- user to update their own profiles row, so freeze these fields for every
-- non-service-role write.
CREATE OR REPLACE FUNCTION public.protect_profile_account_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF COALESCE(auth.role(), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.account_status := 'active';
    NEW.suspended_at := NULL;
    NEW.suspended_by := NULL;
    NEW.suspension_reason := NULL;
    NEW.archived_at := NULL;
    NEW.archived_by := NULL;
    NEW.archive_reason := NULL;
  ELSE
    NEW.account_status := OLD.account_status;
    NEW.suspended_at := OLD.suspended_at;
    NEW.suspended_by := OLD.suspended_by;
    NEW.suspension_reason := OLD.suspension_reason;
    NEW.archived_at := OLD.archived_at;
    NEW.archived_by := OLD.archived_by;
    NEW.archive_reason := OLD.archive_reason;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_protect_account_lifecycle ON public.profiles;
CREATE TRIGGER profiles_protect_account_lifecycle
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.protect_profile_account_lifecycle();

-- Public discovery now excludes every intentionally hidden lifecycle state.
-- Owners and customers with an existing claim retain narrow read paths.
CREATE OR REPLACE FUNCTION public.is_public_business_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_status IN (
    'limited_trial',
    'trialing',
    'active',
    'past_due',
    'trial_expired'
  );
$$;

CREATE OR REPLACE FUNCTION public.user_has_business_claim(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.deal_claims dc
      JOIN public.deals d ON d.id = dc.deal_id
      WHERE dc.user_id = auth.uid()
        AND d.business_id = p_business_id
    );
$$;

REVOKE ALL ON FUNCTION public.user_has_business_claim(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.user_has_business_claim(uuid) TO authenticated;

DROP POLICY IF EXISTS "businesses_public_read" ON public.businesses;
CREATE POLICY "businesses_public_read"
  ON public.businesses FOR SELECT
  USING (
    public.is_publicly_visible_business(id)
    OR owner_id = (SELECT auth.uid())
    OR public.user_has_business_claim(id)
  );

DROP POLICY IF EXISTS "deals_public_read" ON public.deals;
CREATE POLICY "deals_public_read"
  ON public.deals FOR SELECT
  USING (
    is_active = true
    AND start_time <= now()
    AND end_time > now()
    AND public.is_publicly_visible_business(business_id)
  );

-- Read-only account directory. Reading auth.users through this service-role
-- RPC avoids auth.admin.listUsers, which is known to fail on a malformed
-- legacy Auth row in production.
CREATE OR REPLACE FUNCTION public.admin_account_directory(
  p_query text DEFAULT NULL,
  p_role text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  user_id uuid,
  email text,
  role text,
  account_status text,
  auth_created_at timestamptz,
  last_sign_in_at timestamptz,
  banned_until timestamptz,
  business_id uuid,
  business_name text,
  business_status text,
  zip_code text,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
SET row_security = off
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  RETURN QUERY
  WITH rows AS (
    SELECT
      u.id AS user_id,
      u.email::text AS email,
      COALESCE(
        p.role,
        CASE WHEN b.id IS NOT NULL THEN 'business' ELSE 'customer' END
      )::text AS role,
      COALESCE(p.account_status, 'active')::text AS account_status,
      u.created_at AS auth_created_at,
      u.last_sign_in_at,
      u.banned_until,
      b.id AS business_id,
      b.name::text AS business_name,
      b.status::text AS business_status,
      cp.zip_code::text AS zip_code
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    LEFT JOIN public.businesses b ON b.owner_id = u.id
    LEFT JOIN public.consumer_profiles cp ON cp.user_id = u.id
    LEFT JOIN public.admin_users au ON au.id = u.id
    WHERE au.id IS NULL
      AND COALESCE(u.raw_app_meta_data ->> 'app_role', '') <> 'redeemer'
  ),
  filtered AS (
    SELECT *
    FROM rows r
    WHERE (NULLIF(trim(p_role), '') IS NULL OR r.role = trim(p_role))
      AND (NULLIF(trim(p_status), '') IS NULL OR r.account_status = trim(p_status))
      AND (
        NULLIF(trim(p_query), '') IS NULL
        OR r.email ILIKE '%' || trim(p_query) || '%'
        OR r.business_name ILIKE '%' || trim(p_query) || '%'
        OR r.user_id::text = trim(p_query)
      )
  )
  SELECT
    f.user_id,
    f.email,
    f.role,
    f.account_status,
    f.auth_created_at,
    f.last_sign_in_at,
    f.banned_until,
    f.business_id,
    f.business_name,
    f.business_status,
    f.zip_code,
    count(*) OVER () AS total_count
  FROM filtered f
  ORDER BY f.auth_created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_account_directory(text, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_account_directory(text, text, text, integer, integer) TO service_role;

COMMENT ON TABLE public.account_lifecycle_state IS
  'Service-role-only snapshots used to restore an admin-suspended account without guessing its prior business, billing-access, or offer state.';
COMMENT ON FUNCTION public.admin_account_directory(text, text, text, integer, integer) IS
  'Service-role-only paginated business/customer account directory, including Auth login state.';

COMMIT;
