-- Billing v4 (Stripe subscriptions): app_config + subscription fields + gating.
-- Implements the required v4 section 5 intent:
-- - app_config for pricing (no hard-coded tier prices in the app)
-- - business_profiles subscription fields (trial/active + stripe ids)
-- - active/trial gating in RLS and analytics RPCs
--
-- Note: this repo already contains a "business_locations" migration that references
-- businesses(id). This migration updates the FK/RLS to match the v4 model where
-- business_locations.business_id points at business_profiles(id), without dropping data.

BEGIN;

-- 1) Pricing config table (monthly prices + add-on location price)
CREATE TABLE IF NOT EXISTS app_config (
  id integer PRIMARY KEY DEFAULT 1,
  pro_monthly_price integer DEFAULT 30,
  premium_monthly_price integer DEFAULT 79,
  extra_location_price integer DEFAULT 15,
  updated_at timestamptz DEFAULT now()
);

INSERT INTO app_config (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

-- 2) Add subscription fields to business_profiles (v4)
ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text;

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS subscription_status text DEFAULT 'trial'; -- trial, active, past_due, canceled

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS subscription_tier text DEFAULT 'pro';     -- pro, premium

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz;

ALTER TABLE business_profiles
  ADD COLUMN IF NOT EXISTS current_period_ends_at timestamptz;

-- Backfill + enforce safe defaults for existing rows.
UPDATE public.business_profiles
SET subscription_status = 'trial'
WHERE subscription_status IS NULL;

UPDATE public.business_profiles
SET subscription_tier = 'pro'
WHERE subscription_tier IS NULL;

UPDATE public.business_profiles
SET trial_ends_at = now() + interval '30 days'
WHERE trial_ends_at IS NULL
  AND subscription_status = 'trial';

UPDATE public.business_profiles
SET current_period_ends_at = COALESCE(trial_ends_at, now() + interval '30 days')
WHERE current_period_ends_at IS NULL;

ALTER TABLE public.business_profiles
  ALTER COLUMN subscription_status SET NOT NULL;

ALTER TABLE public.business_profiles
  ALTER COLUMN subscription_tier SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'business_profiles_subscription_status_check'
  ) THEN
    ALTER TABLE public.business_profiles
      ADD CONSTRAINT business_profiles_subscription_status_check
      CHECK (subscription_status IN ('trial', 'active', 'past_due', 'canceled'));
  END IF;
END
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'business_profiles_subscription_tier_check'
  ) THEN
    ALTER TABLE public.business_profiles
      ADD CONSTRAINT business_profiles_subscription_tier_check
      CHECK (subscription_tier IN ('pro', 'premium'));
  END IF;
END
$$;

-- 3) Update business_locations FK to point at business_profiles(id) (v4 expectation).
--    Keep the existing table/rows; just swap the foreign key target.
DO $$
DECLARE
  v_old_fk text;
BEGIN
  SELECT tc.constraint_name
    INTO v_old_fk
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = tc.constraint_name
   AND kcu.table_schema = tc.table_schema
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'business_locations'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'business_id'
  LIMIT 1;

  IF v_old_fk IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.business_locations DROP CONSTRAINT %I', v_old_fk);
  END IF;
END
$$;

-- Add FK (if business_locations exists and schema supports it).
ALTER TABLE public.business_locations
  ADD CONSTRAINT business_locations_business_id_fkey
  FOREIGN KEY (business_id)
  REFERENCES public.business_profiles(id)
  ON DELETE CASCADE;

-- Fix RLS policies for business_locations.
-- Existing policies (from earlier migrations) may still point at `public.businesses`,
-- which no longer matches the updated foreign key target.
DROP POLICY IF EXISTS "Owners can read their business locations" ON public.business_locations;
CREATE POLICY "Owners can read their business locations"
  ON public.business_locations FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_profiles bp
      WHERE bp.id = business_locations.business_id
        AND (bp.user_id = auth.uid() OR bp.owner_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Owners can insert their business locations" ON public.business_locations;
CREATE POLICY "Owners can insert their business locations"
  ON public.business_locations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.business_profiles bp
      WHERE bp.id = business_locations.business_id
        AND (bp.user_id = auth.uid() OR bp.owner_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Owners can update their business locations" ON public.business_locations;
CREATE POLICY "Owners can update their business locations"
  ON public.business_locations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_profiles bp
      WHERE bp.id = business_locations.business_id
        AND (bp.user_id = auth.uid() OR bp.owner_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS "Owners can delete their business locations" ON public.business_locations;
CREATE POLICY "Owners can delete their business locations"
  ON public.business_locations FOR DELETE
  USING (
    EXISTS (
      SELECT 1
      FROM public.business_profiles bp
      WHERE bp.id = business_locations.business_id
        AND (bp.user_id = auth.uid() OR bp.owner_id = auth.uid())
    )
  );

-- 4) Ensure deals.location_id has the v4 ON DELETE CASCADE behavior.
DO $$
DECLARE
  v_old_fk text;
BEGIN
  SELECT tc.constraint_name
    INTO v_old_fk
  FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON kcu.constraint_name = tc.constraint_name
   AND kcu.table_schema = tc.table_schema
  WHERE tc.table_schema = 'public'
    AND tc.table_name = 'deals'
    AND tc.constraint_type = 'FOREIGN KEY'
    AND kcu.column_name = 'location_id'
  LIMIT 1;

  IF v_old_fk IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.deals DROP CONSTRAINT %I', v_old_fk);
  END IF;
END
$$;

ALTER TABLE public.deals
  ADD CONSTRAINT deals_location_id_fkey
  FOREIGN KEY (location_id)
  REFERENCES public.business_locations(id)
  ON DELETE CASCADE;

-- 5) RLS gating: only trial/active businesses can create deals and read analytics.
--    We enforce this by updating:
--    - deals INSERT/UPDATE/SELECT policies (merchant own deals)
--    - deal_claims merchant SELECT policy
--    - app_analytics_events merchant SELECT policy

-- Helper check (inline in policies for clarity).
-- subscription_status lives in business_profiles.

DROP POLICY IF EXISTS "Businesses can insert their own deals" ON public.deals;
CREATE POLICY "Businesses can insert their own deals"
  ON public.deals FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = deals.business_id
        AND b.owner_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.business_profiles bp
      WHERE (bp.user_id = auth.uid() OR bp.owner_id = auth.uid())
        AND bp.subscription_status IN ('trial','active')
    )
  );

DROP POLICY IF EXISTS "Businesses can read their own deals" ON public.deals;
CREATE POLICY "Businesses can read their own deals"
  ON public.deals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = deals.business_id
        AND b.owner_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.business_profiles bp
      WHERE (bp.user_id = auth.uid() OR bp.owner_id = auth.uid())
        AND bp.subscription_status IN ('trial','active')
    )
  );

DROP POLICY IF EXISTS "Businesses can update their own deals" ON public.deals;
CREATE POLICY "Businesses can update their own deals"
  ON public.deals FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = deals.business_id
        AND b.owner_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.business_profiles bp
      WHERE (bp.user_id = auth.uid() OR bp.owner_id = auth.uid())
        AND bp.subscription_status IN ('trial','active')
    )
  );

DROP POLICY IF EXISTS "Businesses can read claims for their deals" ON public.deal_claims;
CREATE POLICY "Businesses can read claims for their deals"
  ON public.deal_claims FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.deals
      JOIN public.businesses ON businesses.id = deals.business_id
      JOIN public.business_profiles bp ON (bp.user_id = auth.uid() OR bp.owner_id = auth.uid())
      WHERE deals.id = deal_claims.deal_id
        AND businesses.owner_id = auth.uid()
        AND bp.subscription_status IN ('trial','active')
    )
  );

-- Update analytics select policy to include subscription gating.
DROP POLICY IF EXISTS "app_analytics_events_select_deal_owner" ON public.app_analytics_events;
CREATE POLICY "app_analytics_events_select_deal_owner"
  ON public.app_analytics_events FOR SELECT
  TO authenticated
  USING (
    deal_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.deals d
      INNER JOIN public.businesses b ON b.id = d.business_id
      INNER JOIN public.business_profiles bp ON (bp.user_id = auth.uid() OR bp.owner_id = auth.uid())
      WHERE d.id = deal_id
        AND b.owner_id = auth.uid()
        AND bp.subscription_status IN ('trial','active')
    )
  );

-- 6) Update analytics RPCs to deny non-active businesses.
--    Patch: require bp.subscription_status in ('trial','active') for the owner.

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

COMMIT;

