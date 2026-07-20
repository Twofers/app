-- Business name lock + admin-reviewed name change requests.
--
-- ⚠️  APPLY TO THE TEST PROJECT FIRST, then run `node scripts/probe-rls-smoke.mjs`
--     and `npm run test:db` (suite 2f) before any gated production apply.
--     RLS/trigger-sensitive.
--
-- Bug: after approval, a business owner could rename their business to any
-- other brand ("Joe's Diner" → a competitor) and the new name propagated
-- instantly to every consumer surface — the deal feed, deal detail, wallet
-- claims, and posters all live-join businesses(name). A verified account
-- could therefore impersonate another business with full retroactive effect.
--
-- Fix (defense in both layers, per the 2026-07-17 plan):
--   1. DB: the existing enforce_businesses_protected_columns() trigger now
--      REJECTS a name change by a non-privileged writer once the business is
--      publicly visible (same canonical status list as
--      is_publicly_visible_business from 20260814120000). This closes the
--      direct PostgREST path — RLS "update own business" has no column limits.
--   2. A business_name_change_requests table holds owner-proposed renames.
--      The verified name stays public until an admin approves the request
--      through the service-role admin function (which records who decided,
--      old/new values, reason, and when). Proposed names are NOT stored on
--      the businesses row because that row is publicly SELECTable once
--      visible — a pending_name column would leak unreviewed names.
--
-- The status list lives in ONE SQL helper (is_public_business_status) shared
-- by is_publicly_visible_business and the trigger, mirrored in TypeScript by
-- supabase/functions/_shared/business-identity-lock.ts and
-- lib/business-name-change.ts; business-name-lock-source.test.ts asserts the
-- three copies stay in sync.
--
-- The edge function update-business-profile-section writes as service_role
-- and therefore bypasses this trigger — it enforces the same rule in its own
-- code (see its business_name_locked check).

BEGIN;

-- 1) Canonical "is this lifecycle status publicly visible" predicate ---------
-- Extracted from is_publicly_visible_business (20260814120000) so the
-- businesses row policy, the deals publish gate, and the name-lock trigger
-- all share one status list.
CREATE OR REPLACE FUNCTION public.is_public_business_status(p_status text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_status IS NOT NULL
    AND p_status NOT IN ('draft', 'pending_verification', 'rejected');
$$;

REVOKE ALL ON FUNCTION public.is_public_business_status(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_public_business_status(text) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.is_public_business_status(text) IS
  'Single source of truth for which businesses.status values are publicly visible (pre-approval states draft/pending_verification/rejected are not). Shared by is_publicly_visible_business and the business name lock trigger; mirrored in _shared/business-identity-lock.ts and lib/business-name-change.ts.';

-- Re-point the existing visibility helper at the shared predicate. Behavior
-- is identical to 20260814120000; only the status list moves into one place.
CREATE OR REPLACE FUNCTION public.is_publicly_visible_business(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT p_business_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = p_business_id
        AND public.is_public_business_status(b.status)
    );
$$;

-- 2) Name lock in the protected-columns trigger ------------------------------
-- Full replacement of the 20260804120000 function body; the only change is
-- the business_name_locked check at the top of the UPDATE branch. RAISE (not
-- a silent freeze like the other columns) so a rename attempt fails loudly:
-- the app compares NEW.name IS DISTINCT FROM OLD.name, so saves that merely
-- resend the unchanged name (older installed builds) keep working.
CREATE OR REPLACE FUNCTION public.enforce_businesses_protected_columns()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  -- service_role (edge functions using the service key) and real admins are
  -- the only callers allowed to move billing/lifecycle/trust fields. Everyone
  -- else (owner sessions, redeemer sessions, anon) is frozen to safe values.
  v_privileged boolean := (COALESCE(auth.role(), '') = 'service_role') OR COALESCE(public.is_admin(), false);
BEGIN
  IF v_privileged THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Client-created rows always start with no access and no admin trust
    -- signal; the onboarding/billing/admin server paths elevate them later
    -- as service_role.
    NEW.access_level := 'none';
    NEW.status := 'pending_verification';
    NEW.can_publish_cached := false;
    NEW.is_demo := false;
    NEW.verification_status := 'not_started';
    NEW.risk_score := NULL;
    NEW.risk_level := NULL;
    NEW.first_approved_at := NULL;
    NEW.approved_by := NULL;
    NEW.suspended_at := NULL;
    NEW.suspended_by := NULL;
    NEW.suspension_reason := NULL;
    NEW.admin_notes := NULL;
    NEW.source := NULL;
    NEW.launch_area_id := NULL;
    NEW.source_onboarding_request_id := NULL;
    NEW.current_profile_version := 1;
    NEW.profile_completion_score := 0;
    NEW.last_profile_completed_at := NULL;
    NEW.last_sensitive_edit_at := NULL;
    RETURN NEW;
  END IF;

  -- Identity lock: once the business is publicly visible its name is frozen
  -- for the owner. Renames go through business_name_change_requests and are
  -- applied by an admin via service_role after review.
  IF NEW.name IS DISTINCT FROM OLD.name AND public.is_public_business_status(OLD.status) THEN
    RAISE EXCEPTION 'business_name_locked'
      USING ERRCODE = '42501',
            HINT = 'The business name is locked once the business is publicly visible. Submit a name change request for review.';
  END IF;

  -- UPDATE: freeze protected columns to their current values regardless of
  -- what the client sent.
  NEW.owner_id                     := OLD.owner_id;
  NEW.access_level                 := OLD.access_level;
  NEW.status                       := OLD.status;
  NEW.can_publish_cached           := OLD.can_publish_cached;
  NEW.is_demo                      := OLD.is_demo;
  NEW.verification_status          := OLD.verification_status;
  NEW.risk_score                   := OLD.risk_score;
  NEW.risk_level                   := OLD.risk_level;
  NEW.first_approved_at            := OLD.first_approved_at;
  NEW.approved_by                  := OLD.approved_by;
  NEW.suspended_at                 := OLD.suspended_at;
  NEW.suspended_by                 := OLD.suspended_by;
  NEW.suspension_reason            := OLD.suspension_reason;
  NEW.admin_notes                  := OLD.admin_notes;
  NEW.source                       := OLD.source;
  NEW.launch_area_id               := OLD.launch_area_id;
  NEW.source_onboarding_request_id := OLD.source_onboarding_request_id;
  NEW.current_profile_version      := OLD.current_profile_version;
  NEW.profile_completion_score     := OLD.profile_completion_score;
  NEW.last_profile_completed_at    := OLD.last_profile_completed_at;
  NEW.last_sensitive_edit_at       := OLD.last_sensitive_edit_at;
  RETURN NEW;
END;
$$;

-- (Trigger businesses_protect_server_columns from 20260804120000 already
-- points at this function; replacing the body is enough.)

-- 3) Name change request queue ------------------------------------------------
-- Generic shape (field_key) so logo/address/website can reuse the same queue
-- later; phase 1 only allows the display name.
CREATE TABLE IF NOT EXISTS public.business_name_change_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  requested_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  field_key text NOT NULL DEFAULT 'business.display_name'
    CHECK (field_key = 'business.display_name'),
  current_value text,
  proposed_value text NOT NULL
    CHECK (char_length(btrim(proposed_value)) BETWEEN 2 AND 120),
  reason text CHECK (reason IS NULL OR char_length(reason) <= 500),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'canceled')),
  decided_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decided_at timestamptz,
  decision_reason text CHECK (decision_reason IS NULL OR char_length(decision_reason) <= 500),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- One open request per business per field: blocks queue spamming.
CREATE UNIQUE INDEX IF NOT EXISTS business_name_change_requests_one_pending
  ON public.business_name_change_requests (business_id, field_key)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS business_name_change_requests_status_created
  ON public.business_name_change_requests (status, created_at DESC);

CREATE OR REPLACE FUNCTION public.business_name_change_requests_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.business_name_change_requests_touch_updated_at() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS business_name_change_requests_touch ON public.business_name_change_requests;
CREATE TRIGGER business_name_change_requests_touch
  BEFORE UPDATE ON public.business_name_change_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.business_name_change_requests_touch_updated_at();

ALTER TABLE public.business_name_change_requests ENABLE ROW LEVEL SECURITY;

-- Supabase default privileges grant ALL on new tables to anon/authenticated;
-- strip anon entirely and leave authenticated with only what the policies
-- below scope (no DELETE — history is kept; admins act via service_role).
REVOKE ALL ON public.business_name_change_requests FROM PUBLIC, anon;
REVOKE DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.business_name_change_requests FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.business_name_change_requests TO authenticated;
GRANT ALL ON public.business_name_change_requests TO service_role;

-- Owners see their own business's requests.
DROP POLICY IF EXISTS business_name_change_requests_owner_select ON public.business_name_change_requests;
CREATE POLICY business_name_change_requests_owner_select
  ON public.business_name_change_requests FOR SELECT
  TO authenticated
  USING (public.is_business_owner(business_id));

-- Owners file requests only for their own business, only as themselves, and
-- only in the open 'pending' shape (no self-decided rows).
DROP POLICY IF EXISTS business_name_change_requests_owner_insert ON public.business_name_change_requests;
CREATE POLICY business_name_change_requests_owner_insert
  ON public.business_name_change_requests FOR INSERT
  TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND public.is_business_owner(business_id)
    AND field_key = 'business.display_name'
    AND status = 'pending'
    AND decided_by IS NULL
    AND decided_at IS NULL
    AND decision_reason IS NULL
  );

-- Owners may edit or cancel a still-pending request; they can never move it
-- to approved/rejected or stamp decision fields (that is the admin function's
-- service-role job).
DROP POLICY IF EXISTS business_name_change_requests_owner_update ON public.business_name_change_requests;
CREATE POLICY business_name_change_requests_owner_update
  ON public.business_name_change_requests FOR UPDATE
  TO authenticated
  USING (
    public.is_business_owner(business_id)
    AND status = 'pending'
  )
  WITH CHECK (
    public.is_business_owner(business_id)
    AND requested_by = auth.uid()
    AND field_key = 'business.display_name'
    AND status IN ('pending', 'canceled')
    AND decided_by IS NULL
    AND decided_at IS NULL
    AND decision_reason IS NULL
  );

COMMENT ON TABLE public.business_name_change_requests IS
  'Owner-proposed identity changes (phase 1: display name) held for admin review. The verified name on public.businesses stays live until an admin approves via admin-business-name-requests (service_role), which records decided_by/decided_at/decision_reason. See 20260816120000.';

COMMIT;
