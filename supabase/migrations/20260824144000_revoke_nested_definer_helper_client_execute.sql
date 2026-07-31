-- Remove direct client EXECUTE from three helpers that are only ever reached
-- through other SECURITY DEFINER functions.
--
-- Continues the pattern established by the separately approved migrations
-- 20260824141000 and 20260824142000: close a Security Advisor
-- "client role can execute SECURITY DEFINER function" finding only where the
-- function has no client, policy, or trigger caller of its own.
--
-- LIVE EVIDENCE (approved test project catalog, 2026-07-29)
--
--   public.admin_role()
--     callers: admin_can, is_admin, is_owner_admin — all prosecdef = true
--     referenced by RLS policy: none
--     app / website / Edge caller: none
--
--   public.business_member_role(uuid)
--     callers: is_business_member — prosecdef = true
--     referenced by RLS policy: none
--     app / website / Edge caller: none
--
--   public.get_runtime_billing_config()
--     callers: activate_business_trial_from_checkout, admin_grant_location_trial,
--              get_location_billing_summary, reserve_location_deal_credit —
--              all prosecdef = true
--     referenced by RLS policy: none
--     Edge caller: supabase/functions/_shared/deal-translate-limit.ts, on the
--       service-role `admin` client (`admin.rpc("get_runtime_billing_config")`)
--
-- WHY THIS IS SAFE
--   A nested call inside a SECURITY DEFINER function executes as that
--   function's owner, so the calling role's EXECUTE privilege is not consulted.
--   Every caller above is a definer, none of these three appears in any RLS
--   policy qual/with_check, and the only application caller uses the service
--   role — which is unaffected. The wrapper functions that clients do call
--   (`admin_can`, `is_admin`, `is_owner_admin`, `is_business_member`,
--   `get_location_billing_summary`) keep their existing grants.
--
-- NOT INCLUDED: public.validate_business_invite(text). It holds authenticated
-- EXECUTE and no caller was found in the app, website, Edge functions, other
-- SQL function bodies, or any RLS policy. "No caller found" is not the same
-- evidence as "reached only through definers", so it is left alone pending a
-- product decision on the invite gate (20260706120000).
--
-- ROLLBACK
--   GRANT EXECUTE ON FUNCTION public.admin_role() TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.business_member_role(uuid) TO anon, authenticated;
--   GRANT EXECUTE ON FUNCTION public.get_runtime_billing_config() TO anon, authenticated;
--
-- This migration only removes execution privileges. It does not change any
-- function body, signature, ownership, trigger, cron job, policy, or row.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.admin_role()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.business_member_role(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_runtime_billing_config()
  FROM PUBLIC, anon, authenticated;

COMMIT;
