-- Deal-analytics 'busiest hour' reported UTC while labelling it 'local'.
--
-- Observed on device 2026-08-07: a deal whose claims were made ~10:40 PM
-- America/Chicago rendered "Busiest around 3:00 AM local" (03:40 UTC).
--
-- Chain:
--   1. app/create/ai.tsx persists 'timezone: isRecurring ? timezone : null',
--      so ONE-TIME deals store a NULL timezone (only recurring deals set one).
--   2. merchant_deal_insights / merchant_business_insights resolved the
--      reporting timezone as COALESCE(NULLIF(trim(<deal>.timezone),''),'UTC'),
--      so that NULL silently became UTC.
--   3. merchant-insights-panel.tsx then labels the result 'local'.
--
-- There is no business-level timezone column to fall back to: businesses has
-- none, and business_profiles.timezone was never created (the guard in
-- 20260703120004_timezone_validation.sql always takes its 'column does not
-- exist - skipping' branch). The best available signal is the same business's
-- other deals, which DO carry a timezone whenever one was recurring or took
-- the deals.timezone column default.
--
-- Fix: resolve through deal tz -> that business's most recent non-null deal
-- tz -> 'UTC'. This repairs historical one-time deals too, not just new ones.
-- Both RPC overloads are replaced with byte-identical bodies except the
-- timezone resolution (extracted from 20260601153000 to avoid drift).
--
-- Idempotent: CREATE OR REPLACE only, no signature change (so no PGRST203
-- overload split), no data migration.
--
-- Do not apply to production without Dan's explicit migration approval.

BEGIN;

-- deal tz -> business's last known deal tz -> UTC.
-- STABLE + SECURITY INVOKER: only ever called from the two SECURITY DEFINER
-- RPCs below, which have already authorized the caller.
CREATE OR REPLACE FUNCTION public.resolve_reporting_timezone(
  p_deal_timezone text,
  p_business_id uuid
)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $fn$
  SELECT COALESCE(
    NULLIF(trim(p_deal_timezone), ''),
    (
      SELECT NULLIF(trim(d2.timezone), '')
      FROM public.deals d2
      WHERE d2.business_id = p_business_id
        AND NULLIF(trim(d2.timezone), '') IS NOT NULL
      ORDER BY d2.created_at DESC
      LIMIT 1
    ),
    'UTC'
  );
$fn$;

REVOKE ALL ON FUNCTION public.resolve_reporting_timezone(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_reporting_timezone(text, uuid) FROM anon, authenticated;


CREATE OR REPLACE FUNCTION public.merchant_deal_insights(p_deal_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_business_id uuid;
  v_tz text;
  v_owner uuid;
  v_sub_status text;
  r jsonb;
BEGIN
  -- Resolve the reporting timezone through the shared helper: the deal's own
  -- tz, else this business's last known tz, else UTC (see migration header).
  SELECT d.business_id, public.resolve_reporting_timezone(d.timezone, d.business_id)
  INTO v_business_id, v_tz
  FROM public.deals d
  WHERE d.id = p_deal_id;

  IF v_business_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT b.owner_id INTO v_owner FROM public.businesses b WHERE b.id = v_business_id;
  IF v_owner IS NULL OR v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT bp.subscription_status INTO v_sub_status
  FROM public.business_profiles bp
  WHERE (bp.user_id = v_owner OR bp.owner_id = v_owner)
  LIMIT 1;

  IF v_sub_status IS NULL OR v_sub_status NOT IN ('trial','active') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  WITH base AS (
    SELECT
      c.id,
      c.user_id,
      c.created_at,
      c.redeemed_at,
      c.expires_at,
      COALESCE(c.grace_period_minutes, 10) AS grace_m,
      c.age_band_at_claim,
      c.acquisition_source,
      c.zip_at_claim,
      c.redeem_method,
      (c.expires_at + (COALESCE(c.grace_period_minutes, 10) || ' minutes')::interval) AS redeem_by
    FROM public.deal_claims c
    WHERE c.deal_id = p_deal_id
  ),
  flagged AS (
    SELECT
      b.*,
      EXISTS (
        SELECT 1
        FROM public.deal_claims c2
        JOIN public.deals d2 ON d2.id = c2.deal_id
        WHERE c2.user_id = b.user_id
          AND d2.business_id = v_business_id
          AND c2.created_at < b.created_at
      ) AS is_returning
    FROM base b
  ),
  agg AS (
    SELECT
      COUNT(*)::int AS claims,
      COUNT(*) FILTER (WHERE redeemed_at IS NOT NULL)::int AS redeems,
      COUNT(*) FILTER (
        WHERE redeemed_at IS NULL AND redeem_by < now()
      )::int AS expired_unredeemed,
      AVG(EXTRACT(EPOCH FROM (redeemed_at - created_at))) FILTER (WHERE redeemed_at IS NOT NULL) AS avg_secs,
      COUNT(*) FILTER (WHERE NOT is_returning)::int AS new_customers,
      COUNT(*) FILTER (WHERE is_returning)::int AS returning_customers
    FROM flagged
  ),
  age_mix AS (
    SELECT COALESCE(jsonb_object_agg(age_key, cnt), '{}'::jsonb) AS j
    FROM (
      SELECT COALESCE(age_band_at_claim, 'unknown') AS age_key, COUNT(*)::int AS cnt
      FROM flagged
      GROUP BY 1
    ) s
  ),
  acq_mix AS (
    SELECT COALESCE(jsonb_object_agg(src, cnt), '{}'::jsonb) AS j
    FROM (
      SELECT COALESCE(acquisition_source, 'unknown') AS src, COUNT(*)::int AS cnt
      FROM flagged
      GROUP BY 1
    ) s
  ),
  method_mix AS (
    SELECT COALESCE(jsonb_object_agg(m, cnt), '{}'::jsonb) AS j
    FROM (
      SELECT COALESCE(redeem_method, 'pending') AS m, COUNT(*)::int AS cnt
      FROM flagged
      WHERE redeemed_at IS NOT NULL
      GROUP BY 1
    ) s
  ),
  zip_mix AS (
    SELECT COALESCE(jsonb_object_agg(zk, cnt), '{}'::jsonb) AS j
    FROM (
      SELECT
        CASE
          WHEN zip_at_claim IS NULL OR trim(zip_at_claim) = '' THEN 'unknown'
          ELSE left(trim(zip_at_claim), 3) || '**'
        END AS zk,
        COUNT(*)::int AS cnt
      FROM flagged
      GROUP BY 1
    ) s
  ),
  hour_mix AS (
    SELECT COALESCE(
      (
        SELECT jsonb_agg(cnt ORDER BY hr)
        FROM (
          SELECT hr::int AS hr,
            (
              SELECT COUNT(*)::int FROM flagged f
              WHERE EXTRACT(hour FROM (f.created_at AT TIME ZONE v_tz))::int = hr
            ) AS cnt
          FROM generate_series(0, 23) hr
        ) q
      ),
      '[]'::jsonb
    ) AS arr
  )
  SELECT jsonb_build_object(
    'claims', (SELECT claims FROM agg),
    'redeems', (SELECT redeems FROM agg),
    'expired_unredeemed', (SELECT expired_unredeemed FROM agg),
    'avg_claim_to_redeem_seconds',
      CASE WHEN (SELECT avg_secs FROM agg) IS NULL THEN NULL
      ELSE round((SELECT avg_secs FROM agg)::numeric, 2) END,
    'new_customer_claims', (SELECT new_customers FROM agg),
    'returning_customer_claims', (SELECT returning_customers FROM agg),
    'age_band_mix', (SELECT j FROM age_mix),
    'zip_cluster_mix', (SELECT j FROM zip_mix),
    'acquisition_mix', (SELECT j FROM acq_mix),
    'redeem_method_mix', (SELECT j FROM method_mix),
    'claims_by_hour_local', (SELECT arr FROM hour_mix)
  )
  INTO r;

  RETURN r;
END;
$$;

CREATE OR REPLACE FUNCTION public.merchant_business_insights(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  v_sub_status text;
  v_fallback_tz text;
  r jsonb;
BEGIN
  SELECT b.owner_id INTO v_owner FROM public.businesses b WHERE b.id = p_business_id;
  IF v_owner IS NULL OR v_owner IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT bp.subscription_status INTO v_sub_status
  FROM public.business_profiles bp
  WHERE (bp.user_id = v_owner OR bp.owner_id = v_owner)
  LIMIT 1;

  IF v_sub_status IS NULL OR v_sub_status NOT IN ('trial','active') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  -- One lookup for the whole aggregate rather than a per-claim subquery.
  SELECT public.resolve_reporting_timezone(NULL, p_business_id) INTO v_fallback_tz;

  WITH base AS (
    SELECT
      c.id,
      c.user_id,
      c.created_at,
      c.redeemed_at,
      c.expires_at,
      COALESCE(c.grace_period_minutes, 10) AS grace_m,
      c.age_band_at_claim,
      c.acquisition_source,
      c.zip_at_claim,
      c.redeem_method,
      d.timezone,
      (c.expires_at + (COALESCE(c.grace_period_minutes, 10) || ' minutes')::interval) AS redeem_by
    FROM public.deal_claims c
    JOIN public.deals d ON d.id = c.deal_id
    WHERE d.business_id = p_business_id
  ),
  flagged AS (
    SELECT
      b.*,
      COALESCE(NULLIF(trim(b.timezone), ''), v_fallback_tz) AS tz,
      EXISTS (
        SELECT 1
        FROM public.deal_claims c2
        JOIN public.deals d2 ON d2.id = c2.deal_id
        WHERE c2.user_id = b.user_id
          AND d2.business_id = p_business_id
          AND c2.created_at < b.created_at
      ) AS is_returning
    FROM base b
  ),
  agg AS (
    SELECT
      COUNT(*)::int AS claims,
      COUNT(*) FILTER (WHERE redeemed_at IS NOT NULL)::int AS redeems,
      COUNT(*) FILTER (
        WHERE redeemed_at IS NULL AND redeem_by < now()
      )::int AS expired_unredeemed,
      AVG(EXTRACT(EPOCH FROM (redeemed_at - created_at))) FILTER (WHERE redeemed_at IS NOT NULL) AS avg_secs,
      COUNT(*) FILTER (WHERE NOT is_returning)::int AS new_customers,
      COUNT(*) FILTER (WHERE is_returning)::int AS returning_customers
    FROM flagged
  ),
  age_mix AS (
    SELECT COALESCE(jsonb_object_agg(age_key, cnt), '{}'::jsonb) AS j
    FROM (
      SELECT COALESCE(age_band_at_claim, 'unknown') AS age_key, COUNT(*)::int AS cnt
      FROM flagged
      GROUP BY 1
    ) s
  ),
  acq_mix AS (
    SELECT COALESCE(jsonb_object_agg(src, cnt), '{}'::jsonb) AS j
    FROM (
      SELECT COALESCE(acquisition_source, 'unknown') AS src, COUNT(*)::int AS cnt
      FROM flagged
      GROUP BY 1
    ) s
  ),
  method_mix AS (
    SELECT COALESCE(jsonb_object_agg(m, cnt), '{}'::jsonb) AS j
    FROM (
      SELECT COALESCE(redeem_method, 'pending') AS m, COUNT(*)::int AS cnt
      FROM flagged
      WHERE redeemed_at IS NOT NULL
      GROUP BY 1
    ) s
  ),
  zip_mix AS (
    SELECT COALESCE(jsonb_object_agg(zk, cnt), '{}'::jsonb) AS j
    FROM (
      SELECT
        CASE
          WHEN zip_at_claim IS NULL OR trim(zip_at_claim) = '' THEN 'unknown'
          ELSE left(trim(zip_at_claim), 3) || '**'
        END AS zk,
        COUNT(*)::int AS cnt
      FROM flagged
      GROUP BY 1
    ) s
  ),
  hour_mix AS (
    SELECT COALESCE(
      (
        SELECT jsonb_agg(cnt ORDER BY hr)
        FROM (
          SELECT hr::int AS hr,
            (
              SELECT COUNT(*)::int FROM flagged f
              WHERE EXTRACT(hour FROM (f.created_at AT TIME ZONE f.tz))::int = hr
            ) AS cnt
          FROM generate_series(0, 23) hr
        ) q
      ),
      '[]'::jsonb
    ) AS arr
  )
  SELECT jsonb_build_object(
    'claims', (SELECT claims FROM agg),
    'redeems', (SELECT redeems FROM agg),
    'expired_unredeemed', (SELECT expired_unredeemed FROM agg),
    'avg_claim_to_redeem_seconds',
      CASE WHEN (SELECT avg_secs FROM agg) IS NULL THEN NULL
      ELSE round((SELECT avg_secs FROM agg)::numeric, 2) END,
    'new_customer_claims', (SELECT new_customers FROM agg),
    'returning_customer_claims', (SELECT returning_customers FROM agg),
    'age_band_mix', (SELECT j FROM age_mix),
    'zip_cluster_mix', (SELECT j FROM zip_mix),
    'acquisition_mix', (SELECT j FROM acq_mix),
    'redeem_method_mix', (SELECT j FROM method_mix),
    'claims_by_hour_local', (SELECT arr FROM hour_mix)
  )
  INTO r;

  RETURN r;
END;
$$;

COMMIT;
