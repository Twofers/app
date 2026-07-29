-- These SECURITY DEFINER functions are contractually service-role-only, but
-- live ACL drift still exposes them to anon and authenticated. Remove only the
-- client-role grants; preserve service_role execution and all function bodies.

BEGIN;

REVOKE EXECUTE ON FUNCTION public.admin_account_directory(text, text, text, integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.admin_grant_location_trial(uuid, uuid, text, boolean)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.billing_trial_reminder_cron_status()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_business_location_trial_reuse(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.commit_location_deal_credit(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_location_deal_credit(uuid, text, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.consume_trial_no_card_exemption_code(text, timestamptz)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.deal_release_push_cron_status()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.end_expired_deals(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.end_expired_deals_cron_status()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.expire_billing_access_cron_status()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_business_verification_required_for_publish()
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_business_location_publish_verified(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_business_demand_signal(
  uuid,
  uuid,
  uuid,
  text,
  text,
  text,
  numeric,
  text
)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_business_location_identity(uuid)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_expired_deal_credit_reservations(integer)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.release_location_deal_credit(uuid, text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reserve_location_deal_credit(
  uuid,
  text,
  text,
  integer,
  uuid,
  uuid,
  uuid
)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_billing_reminder_secret(text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_deal_release_push_secret(text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.verify_weekly_digest_secret(text)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.weekly_digest_cron_status()
  FROM PUBLIC, anon, authenticated;

COMMIT;
