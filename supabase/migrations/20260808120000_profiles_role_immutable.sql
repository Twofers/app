-- profiles.role is a hard one-time choice (locked decision: hard Shopper/Business
-- role split; role is picked at signup and never changes). Before this migration
-- the "profiles_update_own" RLS policy let any signed-in user PATCH their own row
-- and flip role customer -> business, defeating the split (found by
-- scripts/db-tests/2b-role-enforcement.mjs on the test project).
--
-- Guard: a BEFORE UPDATE trigger rejects any change to an already-set role unless
-- the request runs as service_role (admin/support tooling). The first set
-- (NULL -> value) stays allowed because existing accounts adopt their role lazily
-- at sign-in (lib/profiles-role.ts persistRoleForUser).
--
-- DO NOT APPLY to production without Dan's explicit approval (hard gate).
-- After applying, run: node scripts/probe-rls-smoke.mjs and npm run test:db.

CREATE OR REPLACE FUNCTION public.enforce_profiles_role_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.role IS NOT NULL AND NEW.role IS DISTINCT FROM OLD.role THEN
    -- Fail closed: a missing/unreadable JWT claim counts as NOT service_role.
    IF COALESCE(auth.jwt() ->> 'role', '') <> 'service_role' THEN
      RAISE EXCEPTION 'PROFILES_ROLE_IMMUTABLE'
        USING ERRCODE = 'P0001',
              HINT = 'profiles.role is permanent once set; support tooling (service_role) may correct it.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS profiles_role_immutable ON public.profiles;
CREATE TRIGGER profiles_role_immutable
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_profiles_role_immutable();
