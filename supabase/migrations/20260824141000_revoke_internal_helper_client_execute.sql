-- These SECURITY DEFINER helpers are reached only by pg_cron, trusted
-- service-role Edge code, or internal SECURITY DEFINER trigger functions.
-- Remove direct client execution while preserving every trusted path.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.cleanup_stale_push_tokens()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_deal_credit_enforcement_enabled()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_location_billing_suspended(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_location_entitlement_suspended(text, timestamptz)
  FROM PUBLIC, anon, authenticated;
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
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_deal_credit_location(uuid, uuid)
  FROM PUBLIC, anon, authenticated;

COMMIT;
