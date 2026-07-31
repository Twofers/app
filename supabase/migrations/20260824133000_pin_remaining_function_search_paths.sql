-- Pin every function currently reported by Security Advisor for a mutable
-- search_path. The live definitions only use pg_catalog, public, or explicitly
-- qualified auth objects, so this changes name resolution without changing
-- business behavior, function bodies, signatures, ownership, or grants.

BEGIN;

ALTER FUNCTION public.cleanup_stale_push_tokens()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.enforce_deal_max_claims()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.enforce_strong_deal_only_guardrail()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.get_best_time_day(uuid)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.get_business_dashboard(uuid, text)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.haversine_miles(
  double precision,
  double precision,
  double precision,
  double precision
)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.is_public_business_status(text)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.is_redeemer_session()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.is_strong_deal_offer(
  text,
  text,
  text,
  numeric,
  numeric,
  numeric
)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.is_valid_iana_timezone(text)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.nearby_businesses(
  double precision,
  double precision,
  double precision,
  integer,
  integer,
  uuid[]
)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.nearby_deals(
  double precision,
  double precision,
  double precision,
  integer,
  integer,
  uuid[]
)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.normalize_business_identity_domain(text)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.normalize_business_identity_phone(text)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.normalize_business_identity_text(text)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.prospect_public_label_text(text)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.rate_limit_hit(text, integer, integer)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.redeemer_business_id()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.redeemer_device_id()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.redemption_claim_input_kind(text, text)
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_admin_ai_prompts_updated_at()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_claim_status_changed_at()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_quality_tier_on_deal()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.set_updated_at()
  SET search_path = pg_catalog, public;
ALTER FUNCTION public.structured_offer_is_strong(
  text,
  numeric,
  numeric,
  numeric
)
  SET search_path = pg_catalog, public;

COMMIT;
