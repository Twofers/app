-- Trigger functions are invoked by their bound triggers, not through PostgREST
-- RPC calls. Remove the direct client-role EXECUTE grants that expose these
-- SECURITY DEFINER functions while preserving their trigger bindings.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.audit_app_runtime_config()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.block_suspended_location_deal_write()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.businesses_require_invite()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.charge_deal_credit_after_insert()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_business_menu_capability()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_business_workspace_capability()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_credit_reservation_business_capability()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_live_deal_business_capability()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_new_claim_business_capability()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.enforce_profiles_role_immutable()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.ensure_location_entitlement()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.pause_recurring_deals_on_billing_suspension()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_deal_credit_location_before_insert()
  FROM PUBLIC, anon, authenticated;

COMMIT;
