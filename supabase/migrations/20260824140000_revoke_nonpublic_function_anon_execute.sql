-- These SECURITY DEFINER functions are not part of the anonymous application
-- surface, but live ACL drift grants anon direct execution. Remove only
-- PUBLIC/anon execution while preserving authenticated and service-role access.
--
-- location_cap_for_current_user() is production baseline drift rather than a
-- repository-defined function, so its ACL is corrected only when it exists.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.admin_can(text)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_role()
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.ai_compose_quota_status(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.business_location_count(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.business_member_role(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.can_business_publish(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.cleanup_stale_push_tokens()
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_business_capabilities(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_deal_credit_enforcement_enabled()
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_location_billing_summary(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_my_business()
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.get_runtime_billing_config()
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_admin()
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_business_member(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_location_billing_suspended(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_location_entitlement_suspended(text, timestamptz)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_owner_admin()
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.is_suspended_deal_deactivation_only(
  boolean,
  boolean,
  timestamptz,
  timestamptz,
  text,
  text,
  jsonb,
  jsonb
)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.merchant_business_insights(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.merchant_deal_insights(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.resolve_deal_credit_location(uuid, uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_owns_business(uuid)
  FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.user_owns_business_location(uuid, uuid)
  FROM PUBLIC, anon;

DO $$
BEGIN
  IF to_regprocedure('public.location_cap_for_current_user()') IS NOT NULL THEN
    EXECUTE
      'REVOKE EXECUTE ON FUNCTION public.location_cap_for_current_user() FROM PUBLIC, anon';
  END IF;
END;
$$;

COMMIT;
