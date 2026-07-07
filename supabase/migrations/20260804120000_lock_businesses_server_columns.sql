-- Finding 01 (money & trust audit): a business owner can PATCH their own
-- `businesses` row directly (no column-level revoke ever existed on
-- UPDATE/INSERT, only 20260705120000 revoked SELECT for PII) and self-grant
-- `access_level='admin_comped'` for free permanent publish access, or tamper
-- with admin-only trust/audit fields added across later migrations
-- (verification_status, risk_level, suspended_at, admin_notes, etc).
--
-- Fix: a BEFORE INSERT OR UPDATE trigger that freezes every server-owned
-- column to a safe value (INSERT) or its prior value (UPDATE) unless the
-- caller is service_role or a verified admin. Mirrors the existing
-- deals_block_suspended_location_write trigger pattern. RLS `WITH CHECK`
-- cannot do this: it only sees the NEW row, not OLD, so it cannot express
-- "this column must not change."
--
-- Column list is the full set of non-profile columns added to public.businesses
-- across every migration that touches the table (20260730125000_admin_dashboard
-- _foundation.sql, 20260730126000_website_app_onboarding_sync.sql,
-- 20260719120000_demo_content_marker.sql), cross-checked against the client
-- (grep -rn "from('businesses')" app lib hooks components) to confirm none of
-- them are ever written directly by the app. The client's only direct writes
-- are business-setup.tsx (name/phone/address/location/short_description/
-- category/hours_text/latitude/longitude/logo_url) and account/index.tsx
-- (claim_notifications_enabled, repeat_claim_policy_type,
-- repeat_claim_cooldown_days) -- none of those are frozen here.

BEGIN;

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

REVOKE ALL ON FUNCTION public.enforce_businesses_protected_columns() FROM PUBLIC, anon;

DROP TRIGGER IF EXISTS businesses_protect_server_columns ON public.businesses;
CREATE TRIGGER businesses_protect_server_columns
  BEFORE INSERT OR UPDATE ON public.businesses
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_businesses_protected_columns();

COMMENT ON FUNCTION public.enforce_businesses_protected_columns() IS
  'Freezes billing/lifecycle/trust columns on public.businesses for non-privileged (non service_role, non admin) writers. See findings/01-businesses-self-grant-access.md.';

COMMIT;
