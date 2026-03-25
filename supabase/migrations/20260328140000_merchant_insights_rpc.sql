-- Aggregated merchant analytics only (no raw user lists). Callable by deal/business owner via RPC.

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
  r jsonb;
BEGIN
  SELECT d.business_id, COALESCE(NULLIF(trim(d.timezone), ''), 'UTC')
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

REVOKE ALL ON FUNCTION public.merchant_deal_insights(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merchant_deal_insights(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.merchant_business_insights(p_business_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner uuid;
  r jsonb;
BEGIN
  SELECT b.owner_id INTO v_owner FROM public.businesses b WHERE b.id = p_business_id;
  IF v_owner IS NULL OR v_owner IS DISTINCT FROM auth.uid() THEN
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
      d.timezone,
      (c.expires_at + (COALESCE(c.grace_period_minutes, 10) || ' minutes')::interval) AS redeem_by
    FROM public.deal_claims c
    JOIN public.deals d ON d.id = c.deal_id
    WHERE d.business_id = p_business_id
  ),
  flagged AS (
    SELECT
      b.*,
      COALESCE(NULLIF(trim(b.timezone), ''), 'UTC') AS tz,
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

REVOKE ALL ON FUNCTION public.merchant_business_insights(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merchant_business_insights(uuid) TO authenticated;
