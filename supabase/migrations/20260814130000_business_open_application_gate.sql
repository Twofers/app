-- Replace the shared "penguin" business invite with reviewed open
-- applications (audit F-003).
--
-- The invite code shipped inside the client bundle AND as a literal in the
-- validate_business_invite RPC, so anyone extracting it could open merchant
-- applications at will — a shared secret is not a gate. Every path that
-- grants real access already runs through admin review (business_applications
-- decide/approve, prospect trials, approval emails), and a client-created
-- business row is inert by construction: enforce_businesses_protected_columns
-- (20260804120000) pins it to status='pending_verification',
-- access_level='none', can_publish_cached=false, and the public-visibility
-- predicate (20260814120000) keeps pending rows out of every public read.
--
-- So the gate becomes: open application, pending by default, admin review
-- decides — with a per-owner cap replacing the abuse friction the code
-- provided. The RPC stays (old clients still call it with "penguin") but now
-- accepts any non-empty code, recording the validation for audit only.
--
-- ⚠️ DEPLOY ORDER: apply this migration BEFORE shipping an app build that
--    drops the invite UI (the old trigger requires a validation row the new
--    client never creates). Old clients keep working against the new trigger.

BEGIN;

-- 1) Invite RPC: keep for old-client compatibility; any non-empty code is
--    accepted and recorded (audit trail), no shared secret compared.
CREATE OR REPLACE FUNCTION public.validate_business_invite(invite_code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  uid uuid;
  normalized text;
BEGIN
  uid := auth.uid();
  IF uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;
  normalized := lower(trim(coalesce(invite_code, '')));
  IF normalized = '' THEN
    RAISE EXCEPTION 'invalid invite code' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.business_invite_validations(user_id, validated_at, code_used)
  VALUES (uid, now(), 'open_application')
  ON CONFLICT (user_id) DO NOTHING;
END;
$$;

REVOKE ALL ON FUNCTION public.validate_business_invite(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.validate_business_invite(text) TO authenticated;

COMMENT ON FUNCTION public.validate_business_invite(text) IS
  'Legacy-compatible no-op gate (audit F-003): accepts any non-empty code and records an open_application validation. Business creation is governed by the per-owner cap trigger + pending-by-default column locks + admin review, not a shared secret.';

-- 2) Businesses INSERT gate v3: drop the validation-row requirement; keep the
--    service-role bypass; add a per-owner self-serve cap so open applications
--    can't be used to mass-create pending rows. Rejected/archived rows don't
--    count toward the cap so a rejected applicant can re-apply.
CREATE OR REPLACE FUNCTION public.businesses_require_invite()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
SET row_security = off
AS $$
DECLARE
  v_owner uuid;
BEGIN
  -- Admin/server onboarding paths manage their own rules.
  IF COALESCE(auth.role(), current_setting('request.jwt.claim.role', true), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  v_owner := COALESCE(NEW.owner_id, auth.uid());
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'not authenticated' USING ERRCODE = '42501';
  END IF;

  -- Serialize concurrent inserts for the same owner: without this, two
  -- parallel requests both read count=0 and both pass the cap (TOCTOU).
  -- Transaction-scoped, so it releases automatically at commit/rollback.
  PERFORM pg_advisory_xact_lock(hashtext('businesses_owner_cap:' || v_owner::text));

  -- Pilot: one self-created business per owner (matches the one-location cap).
  IF (
    SELECT count(*)
    FROM public.businesses b
    WHERE b.owner_id = v_owner
      AND b.status NOT IN ('rejected', 'archived')
  ) >= 1 THEN
    RAISE EXCEPTION 'business limit reached' USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- Trigger itself is unchanged (BEFORE INSERT ON public.businesses,
-- businesses_require_invite_trg) — CREATE OR REPLACE above swaps the body.

COMMIT;
