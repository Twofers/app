-- Bring two production-only reporting views under migration control.
-- They previously ran with the view owner's privileges and were directly
-- selectable by anon/authenticated, bypassing the callers' RLS context.

BEGIN;

CREATE OR REPLACE VIEW public.business_performance_hourly
WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  d.business_id,
  EXTRACT(dow FROM c.claimed_at)::integer AS dow,
  EXTRACT(hour FROM c.claimed_at)::integer AS hour,
  COUNT(*) AS claims,
  COUNT(*) FILTER (WHERE c.status = 'redeemed') AS redeemed,
  CASE
    WHEN COUNT(*) = 0 THEN 0::numeric
    ELSE ROUND(
      COUNT(*) FILTER (WHERE c.status = 'redeemed')::numeric
      / COUNT(*)::numeric,
      3
    )
  END AS conversion
FROM public.claims AS c
JOIN public.deals AS d
  ON d.id = c.deal_id
WHERE c.claimed_at >= now() - interval '30 days'
GROUP BY
  d.business_id,
  EXTRACT(dow FROM c.claimed_at)::integer,
  EXTRACT(hour FROM c.claimed_at)::integer;

CREATE OR REPLACE VIEW public.deal_stats
WITH (security_invoker = true, security_barrier = true)
AS
SELECT
  d.id AS deal_id,
  d.business_id,
  COUNT(c.*) AS claims_count,
  COUNT(*) FILTER (WHERE c.status = 'redeemed') AS redeemed_count,
  COUNT(*) FILTER (WHERE c.status = 'expired') AS expired_count,
  COUNT(*) FILTER (WHERE c.status = 'claimed') AS active_claims_count
FROM public.deals AS d
LEFT JOIN public.claims AS c
  ON c.deal_id = d.id
GROUP BY d.id, d.business_id;

REVOKE ALL ON TABLE public.business_performance_hourly
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.deal_stats
  FROM PUBLIC, anon, authenticated;

GRANT SELECT ON TABLE public.business_performance_hourly TO service_role;
GRANT SELECT ON TABLE public.deal_stats TO service_role;

COMMENT ON VIEW public.business_performance_hourly IS
  'Service-role-only 30-day claim conversion metrics. Uses caller RLS context.';
COMMENT ON VIEW public.deal_stats IS
  'Service-role-only per-deal claim status counts. Uses caller RLS context.';

COMMIT;
