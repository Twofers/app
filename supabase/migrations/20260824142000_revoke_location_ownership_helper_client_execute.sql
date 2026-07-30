-- This SECURITY DEFINER ownership helper accepts an explicit user ID and is
-- reached only through trusted service-role billing flows or another definer
-- helper. Remove direct client execution while preserving those trusted paths.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.user_owns_business_location(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

COMMIT;
