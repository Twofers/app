-- Canonical admin/reporting redemption facts.
-- Read-only surface backed by deal_claims; does not change redemption behavior.

BEGIN;

CREATE OR REPLACE VIEW public.admin_redemption_facts_v1
WITH (security_barrier = true)
AS
SELECT
  dc.id AS claim_id,
  dc.business_id,
  dc.deal_id,
  dc.deal_id AS offer_id,
  dc.user_id AS customer_user_id,
  dc.redeemed_at,
  dc.redeem_method,
  dc.offer_version_id,
  dc.claim_status,
  dc.location_id AS claim_location_id,
  dc.redeemed_by_business_user_id,
  dc.redeemed_at_business_id,
  dc.redeemed_at_location_id,
  dc.created_at AS claimed_at,
  dc.status_changed_at
FROM public.deal_claims dc
WHERE dc.redeemed_at IS NOT NULL
  AND dc.claim_status = 'redeemed';

REVOKE ALL ON TABLE public.admin_redemption_facts_v1 FROM PUBLIC;
REVOKE ALL ON TABLE public.admin_redemption_facts_v1 FROM anon;
REVOKE ALL ON TABLE public.admin_redemption_facts_v1 FROM authenticated;
GRANT SELECT ON TABLE public.admin_redemption_facts_v1 TO service_role;

COMMENT ON VIEW public.admin_redemption_facts_v1 IS
  'Canonical admin reporting surface for redeemed deals. Backed by deal_claims; one row per redeemed claim. Not exposed to normal clients.';

COMMIT;
