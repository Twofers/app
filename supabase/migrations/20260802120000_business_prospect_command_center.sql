-- Website/admin prospect command center foundation.
--
-- This is additive and keeps unclaimed local prospects separate from claimed
-- businesses and live deals. It exposes public-safe business discovery only
-- through thresholded RPCs and keeps source payloads, enrichment, scoring,
-- sales notes, demand signals, and claim token hashes admin/service-role only.

BEGIN;

CREATE TABLE IF NOT EXISTS public.business_prospects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  display_name text NOT NULL,
  normalized_name text NOT NULL,
  category text,
  subcategory text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text NOT NULL DEFAULT 'US',
  latitude double precision,
  longitude double precision,
  launch_area_id uuid REFERENCES public.launch_areas(id) ON DELETE SET NULL,
  source_type text NOT NULL DEFAULT 'manual',
  source_confidence numeric(5,4) CHECK (source_confidence IS NULL OR source_confidence BETWEEN 0 AND 1),
  public_label_state text NOT NULL DEFAULT 'not_on_twofer_yet'
    CHECK (public_label_state IN ('not_on_twofer_yet', 'on_twofer', 'live_offer_available')),
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN (
      'new',
      'imported',
      'enriched',
      'ready_to_contact',
      'contacted',
      'demo_scheduled',
      'claim_link_sent',
      'claimed',
      'trial_created',
      'active',
      'not_interested',
      'duplicate',
      'stale',
      'archived'
    )),
  review_status text NOT NULL DEFAULT 'needs_review'
    CHECK (review_status IN ('needs_review', 'approved', 'verified', 'rejected', 'duplicate', 'stale')),
  linked_business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  duplicate_of_prospect_id uuid REFERENCES public.business_prospects(id) ON DELETE SET NULL,
  private_contact_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_admin_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz,
  CONSTRAINT business_prospects_reviewed_public_state_check CHECK (
    public_label_state = 'not_on_twofer_yet'
    OR linked_business_id IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS public.business_prospect_sources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES public.business_prospects(id) ON DELETE CASCADE,
  provider text NOT NULL,
  source_url text,
  source_payload_hash text,
  source_payload_json jsonb,
  confidence numeric(5,4) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  fetched_at timestamptz,
  stale_at timestamptz,
  created_by_admin_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.business_prospect_enrichments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES public.business_prospects(id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text,
  prompt_version text,
  enrichment_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  confidence numeric(5,4) CHECK (confidence IS NULL OR confidence BETWEEN 0 AND 1),
  review_status text NOT NULL DEFAULT 'needs_review'
    CHECK (review_status IN ('needs_review', 'approved', 'rejected', 'superseded')),
  reviewed_by_admin_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.business_demand_signals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid REFERENCES public.business_prospects(id) ON DELETE CASCADE,
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  signal_type text NOT NULL CHECK (signal_type IN ('favorite', 'request', 'invite', 'view')),
  source_surface text,
  zip_code text CHECK (zip_code IS NULL OR zip_code ~ '^[0-9]{5}$'),
  radius_miles numeric(6,2) CHECK (radius_miles IS NULL OR radius_miles BETWEEN 0 AND 100),
  created_at timestamptz NOT NULL DEFAULT now(),
  dedupe_key text,
  CONSTRAINT business_demand_signal_target_check CHECK (
    (prospect_id IS NOT NULL AND business_id IS NULL)
    OR (prospect_id IS NULL AND business_id IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_business_demand_signals_dedupe
  ON public.business_demand_signals(dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.business_demand_rollups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid REFERENCES public.business_prospects(id) ON DELETE CASCADE,
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  rollup_date date NOT NULL,
  rollup_window text NOT NULL DEFAULT 'day' CHECK (rollup_window IN ('day', 'week')),
  city text,
  launch_area_id uuid REFERENCES public.launch_areas(id) ON DELETE SET NULL,
  favorites_count integer NOT NULL DEFAULT 0 CHECK (favorites_count >= 0),
  requests_count integer NOT NULL DEFAULT 0 CHECK (requests_count >= 0),
  views_count integer NOT NULL DEFAULT 0 CHECK (views_count >= 0),
  unique_users_count integer NOT NULL DEFAULT 0 CHECK (unique_users_count >= 0),
  notification_enabled_count integer NOT NULL DEFAULT 0 CHECK (notification_enabled_count >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_demand_rollup_target_check CHECK (
    (prospect_id IS NOT NULL AND business_id IS NULL)
    OR (prospect_id IS NULL AND business_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.business_prospect_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES public.business_prospects(id) ON DELETE CASCADE,
  score_version text NOT NULL,
  total_score integer NOT NULL CHECK (total_score BETWEEN 0 AND 100),
  tier text NOT NULL CHECK (tier IN ('A', 'B', 'C', 'D')),
  score_inputs_json jsonb NOT NULL DEFAULT '{}'::jsonb,
  recommended_next_action text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sales_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid REFERENCES public.business_prospects(id) ON DELETE CASCADE,
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  assigned_admin_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  stage text NOT NULL DEFAULT 'new'
    CHECK (stage IN (
      'new',
      'enriched',
      'ready_to_contact',
      'contacted',
      'demo_scheduled',
      'claim_link_sent',
      'claimed',
      'trial_created',
      'active',
      'not_interested',
      'duplicate',
      'stale'
    )),
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  next_action text,
  next_action_at timestamptz,
  last_contact_at timestamptz,
  outcome text,
  objections_json jsonb NOT NULL DEFAULT '[]'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sales_account_target_check CHECK (
    prospect_id IS NOT NULL OR business_id IS NOT NULL
  )
);

CREATE TABLE IF NOT EXISTS public.sales_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sales_account_id uuid REFERENCES public.sales_accounts(id) ON DELETE CASCADE,
  prospect_id uuid REFERENCES public.business_prospects(id) ON DELETE CASCADE,
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  activity_type text NOT NULL CHECK (activity_type IN ('call', 'visit', 'email', 'note', 'script_generated', 'claim_link_sent', 'trial_created')),
  summary text,
  outcome text,
  created_by_admin_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.business_claim_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid REFERENCES public.business_prospects(id) ON DELETE CASCADE,
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  max_uses integer NOT NULL DEFAULT 1 CHECK (max_uses > 0),
  uses_count integer NOT NULL DEFAULT 0 CHECK (uses_count >= 0),
  accepted_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_by_admin_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_claim_link_target_check CHECK (
    (prospect_id IS NOT NULL AND business_id IS NULL)
    OR (prospect_id IS NULL AND business_id IS NOT NULL)
  )
);

CREATE TABLE IF NOT EXISTS public.prospect_to_business_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prospect_id uuid NOT NULL REFERENCES public.business_prospects(id) ON DELETE CASCADE,
  business_application_id uuid REFERENCES public.business_applications(id) ON DELETE SET NULL,
  business_onboarding_request_id uuid REFERENCES public.business_onboarding_requests(id) ON DELETE SET NULL,
  business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  conversion_type text NOT NULL CHECK (conversion_type IN ('claim_started', 'claim_verified', 'trial_created', 'business_linked', 'duplicate_linked')),
  created_by_admin_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_prospects_status_city
  ON public.business_prospects(status, city, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_prospects_review_public
  ON public.business_prospects(review_status, public_label_state, city)
  WHERE status NOT IN ('archived', 'duplicate');

CREATE INDEX IF NOT EXISTS idx_business_prospects_normalized_postal
  ON public.business_prospects(normalized_name, postal_code)
  WHERE postal_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_prospect_sources_prospect_created
  ON public.business_prospect_sources(prospect_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_prospect_enrichments_prospect_created
  ON public.business_prospect_enrichments(prospect_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_business_demand_signals_prospect_created
  ON public.business_demand_signals(prospect_id, created_at DESC)
  WHERE prospect_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_demand_signals_business_created
  ON public.business_demand_signals(business_id, created_at DESC)
  WHERE business_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_demand_rollups_prospect_date
  ON public.business_demand_rollups(prospect_id, rollup_date DESC)
  WHERE prospect_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_business_prospect_scores_prospect_created
  ON public.business_prospect_scores(prospect_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sales_accounts_stage_next_action
  ON public.sales_accounts(stage, next_action_at)
  WHERE stage NOT IN ('active', 'not_interested', 'duplicate');

CREATE UNIQUE INDEX IF NOT EXISTS idx_sales_accounts_unique_prospect
  ON public.sales_accounts(prospect_id);

CREATE INDEX IF NOT EXISTS idx_business_claim_links_prospect_created
  ON public.business_claim_links(prospect_id, created_at DESC)
  WHERE prospect_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_business_prospect_command_center_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS business_prospects_set_updated_at ON public.business_prospects;
CREATE TRIGGER business_prospects_set_updated_at
  BEFORE UPDATE ON public.business_prospects
  FOR EACH ROW
  EXECUTE FUNCTION public.set_business_prospect_command_center_updated_at();

DROP TRIGGER IF EXISTS business_demand_rollups_set_updated_at ON public.business_demand_rollups;
CREATE TRIGGER business_demand_rollups_set_updated_at
  BEFORE UPDATE ON public.business_demand_rollups
  FOR EACH ROW
  EXECUTE FUNCTION public.set_business_prospect_command_center_updated_at();

DROP TRIGGER IF EXISTS sales_accounts_set_updated_at ON public.sales_accounts;
CREATE TRIGGER sales_accounts_set_updated_at
  BEFORE UPDATE ON public.sales_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.set_business_prospect_command_center_updated_at();

CREATE OR REPLACE FUNCTION public.admin_can(p_permission text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  v_role := public.admin_role();
  IF v_role IS NULL THEN
    RETURN false;
  END IF;

  IF v_role = 'owner' THEN
    RETURN true;
  END IF;

  IF p_permission IN (
    'admin.read',
    'business.read',
    'trial_request.read',
    'offer.read',
    'audit.read',
    'prospect.read',
    'sales.read',
    'demand.read',
    'report.read'
  ) THEN
    RETURN v_role IN ('admin', 'support', 'sales', 'finance', 'moderator', 'developer', 'read_only');
  END IF;

  IF p_permission IN (
    'business.approve',
    'business.reject',
    'trial.extend',
    'offer.moderate'
  ) THEN
    RETURN v_role IN ('admin', 'moderator');
  END IF;

  IF p_permission IN (
    'prospect.import',
    'prospect.enrich',
    'prospect.score',
    'sales.write',
    'claim_link.write',
    'trial.create',
    'report.generate'
  ) THEN
    RETURN v_role IN ('admin', 'sales', 'moderator', 'developer');
  END IF;

  IF p_permission IN ('billing.read', 'billing.portal') THEN
    RETURN v_role IN ('admin', 'finance');
  END IF;

  IF p_permission = 'support.write' THEN
    RETURN v_role IN ('admin', 'support');
  END IF;

  RETURN false;
END;
$$;

CREATE OR REPLACE FUNCTION public.prospect_public_label_text(p_state text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_state
    WHEN 'live_offer_available' THEN 'Live offer available'
    WHEN 'on_twofer' THEN 'On Twofer'
    ELSE 'Not on Twofer yet'
  END;
$$;

CREATE OR REPLACE FUNCTION public.public_local_businesses(
  p_city text DEFAULT NULL,
  p_query text DEFAULT NULL,
  p_limit integer DEFAULT 100
)
RETURNS TABLE (
  id uuid,
  record_type text,
  display_name text,
  category text,
  city text,
  state text,
  postal_code text,
  coarse_location text,
  latitude double precision,
  longitude double precision,
  public_label_state text,
  aggregate_demand_count integer,
  linked_business_id uuid
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  WITH prospect_demand AS (
    SELECT
      prospect_id,
      SUM(favorites_count + requests_count + views_count)::integer AS demand_count,
      MAX(unique_users_count)::integer AS unique_users_count
    FROM public.business_demand_rollups
    WHERE prospect_id IS NOT NULL
      AND rollup_date >= current_date - 90
    GROUP BY prospect_id
  ),
  business_demand AS (
    SELECT
      business_id,
      SUM(favorites_count + requests_count + views_count)::integer AS demand_count,
      MAX(unique_users_count)::integer AS unique_users_count
    FROM public.business_demand_rollups
    WHERE business_id IS NOT NULL
      AND rollup_date >= current_date - 90
    GROUP BY business_id
  ),
  safe_prospects AS (
    SELECT
      bp.id,
      'prospect'::text AS record_type,
      bp.display_name,
      bp.category,
      bp.city,
      bp.state,
      bp.postal_code,
      concat_ws(', ', NULLIF(bp.city, ''), NULLIF(bp.state, ''), NULLIF(bp.postal_code, '')) AS coarse_location,
      bp.latitude,
      bp.longitude,
      public.prospect_public_label_text(bp.public_label_state) AS public_label_state,
      CASE WHEN COALESCE(pd.unique_users_count, 0) >= 5 THEN COALESCE(pd.demand_count, 0) ELSE NULL END AS aggregate_demand_count,
      bp.linked_business_id
    FROM public.business_prospects bp
    LEFT JOIN prospect_demand pd ON pd.prospect_id = bp.id
    WHERE bp.review_status IN ('approved', 'verified')
      AND bp.status NOT IN ('archived', 'duplicate')
      AND bp.linked_business_id IS NULL
      AND (p_city IS NULL OR lower(COALESCE(bp.city, '')) = lower(trim(p_city)))
      AND (
        p_query IS NULL
        OR lower(bp.display_name) LIKE '%' || lower(trim(p_query)) || '%'
        OR lower(COALESCE(bp.category, '')) LIKE '%' || lower(trim(p_query)) || '%'
      )
  ),
  safe_businesses AS (
    SELECT
      b.id,
      'business'::text AS record_type,
      b.name AS display_name,
      b.category,
      COALESCE(NULLIF(b.city, ''), NULLIF(b.location, '')) AS city,
      b.state,
      b.postal_code,
      concat_ws(', ', NULLIF(COALESCE(b.city, b.location), ''), NULLIF(b.state, ''), NULLIF(b.postal_code, '')) AS coarse_location,
      b.latitude,
      b.longitude,
      CASE
        WHEN EXISTS (
          SELECT 1
          FROM public.deals d
          WHERE d.business_id = b.id
            AND d.is_active = true
            AND d.start_time <= now()
            AND d.end_time > now()
        ) THEN 'Live offer available'
        ELSE 'On Twofer'
      END AS public_label_state,
      CASE WHEN COALESCE(bd.unique_users_count, 0) >= 5 THEN COALESCE(bd.demand_count, 0) ELSE NULL END AS aggregate_demand_count,
      b.id AS linked_business_id
    FROM public.businesses b
    LEFT JOIN business_demand bd ON bd.business_id = b.id
    WHERE b.status IN ('limited_trial', 'trialing', 'active')
      AND (p_city IS NULL OR lower(COALESCE(b.city, b.location, '')) = lower(trim(p_city)))
      AND (
        p_query IS NULL
        OR lower(b.name) LIKE '%' || lower(trim(p_query)) || '%'
        OR lower(COALESCE(b.category, '')) LIKE '%' || lower(trim(p_query)) || '%'
      )
  )
  SELECT *
  FROM (
    SELECT * FROM safe_businesses
    UNION ALL
    SELECT * FROM safe_prospects
  ) rows
  ORDER BY
    CASE rows.public_label_state
      WHEN 'Live offer available' THEN 0
      WHEN 'On Twofer' THEN 1
      ELSE 2
    END,
    rows.display_name
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 250);
$$;

CREATE OR REPLACE FUNCTION public.record_business_demand_signal(
  p_prospect_id uuid DEFAULT NULL,
  p_business_id uuid DEFAULT NULL,
  p_user_id uuid DEFAULT NULL,
  p_signal_type text DEFAULT 'request',
  p_source_surface text DEFAULT NULL,
  p_zip_code text DEFAULT NULL,
  p_radius_miles numeric DEFAULT NULL,
  p_dedupe_key text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_signal_id uuid;
  v_city text;
  v_launch_area_id uuid;
  v_unique_users integer := 0;
  v_rollup_id uuid;
BEGIN
  IF (p_prospect_id IS NULL AND p_business_id IS NULL)
    OR (p_prospect_id IS NOT NULL AND p_business_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Exactly one demand target is required.';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated user is required.';
  END IF;

  IF p_signal_type NOT IN ('favorite', 'request', 'invite', 'view') THEN
    RAISE EXCEPTION 'Unsupported demand signal type.';
  END IF;

  INSERT INTO public.business_demand_signals (
    prospect_id,
    business_id,
    user_id,
    signal_type,
    source_surface,
    zip_code,
    radius_miles,
    dedupe_key
  )
  VALUES (
    p_prospect_id,
    p_business_id,
    p_user_id,
    p_signal_type,
    NULLIF(trim(COALESCE(p_source_surface, '')), ''),
    NULLIF(trim(COALESCE(p_zip_code, '')), ''),
    p_radius_miles,
    NULLIF(trim(COALESCE(p_dedupe_key, '')), '')
  )
  ON CONFLICT (dedupe_key) WHERE dedupe_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_signal_id;

  IF v_signal_id IS NULL THEN
    RETURN jsonb_build_object('inserted', false, 'deduped', true);
  END IF;

  IF p_prospect_id IS NOT NULL THEN
    SELECT city, launch_area_id
      INTO v_city, v_launch_area_id
    FROM public.business_prospects
    WHERE id = p_prospect_id;

    SELECT COUNT(DISTINCT user_id)::integer
      INTO v_unique_users
    FROM public.business_demand_signals
    WHERE prospect_id = p_prospect_id
      AND created_at >= date_trunc('day', now());
  ELSE
    SELECT city, launch_area_id
      INTO v_city, v_launch_area_id
    FROM public.businesses
    WHERE id = p_business_id;

    SELECT COUNT(DISTINCT user_id)::integer
      INTO v_unique_users
    FROM public.business_demand_signals
    WHERE business_id = p_business_id
      AND created_at >= date_trunc('day', now());
  END IF;

  SELECT id
    INTO v_rollup_id
  FROM public.business_demand_rollups
  WHERE rollup_date = current_date
    AND rollup_window = 'day'
    AND COALESCE(prospect_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(p_prospect_id, '00000000-0000-0000-0000-000000000000'::uuid)
    AND COALESCE(business_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(p_business_id, '00000000-0000-0000-0000-000000000000'::uuid)
  LIMIT 1;

  IF v_rollup_id IS NULL THEN
    INSERT INTO public.business_demand_rollups (
      prospect_id,
      business_id,
      rollup_date,
      rollup_window,
      city,
      launch_area_id,
      favorites_count,
      requests_count,
      views_count,
      unique_users_count
    )
    VALUES (
      p_prospect_id,
      p_business_id,
      current_date,
      'day',
      v_city,
      v_launch_area_id,
      CASE WHEN p_signal_type = 'favorite' THEN 1 ELSE 0 END,
      CASE WHEN p_signal_type IN ('request', 'invite') THEN 1 ELSE 0 END,
      CASE WHEN p_signal_type = 'view' THEN 1 ELSE 0 END,
      v_unique_users
    )
    RETURNING id INTO v_rollup_id;
  ELSE
    UPDATE public.business_demand_rollups
      SET
        favorites_count = favorites_count + CASE WHEN p_signal_type = 'favorite' THEN 1 ELSE 0 END,
        requests_count = requests_count + CASE WHEN p_signal_type IN ('request', 'invite') THEN 1 ELSE 0 END,
        views_count = views_count + CASE WHEN p_signal_type = 'view' THEN 1 ELSE 0 END,
        unique_users_count = GREATEST(unique_users_count, v_unique_users)
    WHERE id = v_rollup_id;
  END IF;

  RETURN jsonb_build_object('inserted', true, 'deduped', false, 'signal_id', v_signal_id, 'rollup_id', v_rollup_id);
END;
$$;

ALTER TABLE public.business_prospects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_prospect_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_prospect_enrichments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_demand_signals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_demand_rollups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_prospect_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_claim_links ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prospect_to_business_links ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl text;
  policy_name text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'business_prospects',
    'business_prospect_sources',
    'business_prospect_enrichments',
    'business_demand_signals',
    'business_demand_rollups',
    'business_prospect_scores',
    'sales_accounts',
    'sales_activities',
    'business_claim_links',
    'prospect_to_business_links'
  ] LOOP
    policy_name := 'redeemer_' || tbl || '_block_all';
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', policy_name, tbl);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO authenticated USING (NOT public.is_redeemer_session()) WITH CHECK (NOT public.is_redeemer_session())',
      policy_name,
      tbl
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS business_prospects_admin_read ON public.business_prospects;
CREATE POLICY business_prospects_admin_read
  ON public.business_prospects FOR SELECT
  TO authenticated
  USING (public.admin_can('prospect.read'));

DROP POLICY IF EXISTS business_prospect_sources_admin_read ON public.business_prospect_sources;
CREATE POLICY business_prospect_sources_admin_read
  ON public.business_prospect_sources FOR SELECT
  TO authenticated
  USING (public.admin_can('prospect.read'));

DROP POLICY IF EXISTS business_prospect_enrichments_admin_read ON public.business_prospect_enrichments;
CREATE POLICY business_prospect_enrichments_admin_read
  ON public.business_prospect_enrichments FOR SELECT
  TO authenticated
  USING (public.admin_can('prospect.read'));

DROP POLICY IF EXISTS business_demand_signals_admin_read ON public.business_demand_signals;
CREATE POLICY business_demand_signals_admin_read
  ON public.business_demand_signals FOR SELECT
  TO authenticated
  USING (public.admin_can('demand.read'));

DROP POLICY IF EXISTS business_demand_rollups_admin_read ON public.business_demand_rollups;
CREATE POLICY business_demand_rollups_admin_read
  ON public.business_demand_rollups FOR SELECT
  TO authenticated
  USING (public.admin_can('demand.read'));

DROP POLICY IF EXISTS business_prospect_scores_admin_read ON public.business_prospect_scores;
CREATE POLICY business_prospect_scores_admin_read
  ON public.business_prospect_scores FOR SELECT
  TO authenticated
  USING (public.admin_can('prospect.read'));

DROP POLICY IF EXISTS sales_accounts_admin_read ON public.sales_accounts;
CREATE POLICY sales_accounts_admin_read
  ON public.sales_accounts FOR SELECT
  TO authenticated
  USING (public.admin_can('sales.read'));

DROP POLICY IF EXISTS sales_activities_admin_read ON public.sales_activities;
CREATE POLICY sales_activities_admin_read
  ON public.sales_activities FOR SELECT
  TO authenticated
  USING (public.admin_can('sales.read'));

DROP POLICY IF EXISTS business_claim_links_admin_read ON public.business_claim_links;
CREATE POLICY business_claim_links_admin_read
  ON public.business_claim_links FOR SELECT
  TO authenticated
  USING (public.admin_can('claim_link.write'));

DROP POLICY IF EXISTS prospect_to_business_links_admin_read ON public.prospect_to_business_links;
CREATE POLICY prospect_to_business_links_admin_read
  ON public.prospect_to_business_links FOR SELECT
  TO authenticated
  USING (public.admin_can('prospect.read'));

REVOKE ALL ON TABLE public.business_prospects FROM anon, authenticated;
REVOKE ALL ON TABLE public.business_prospect_sources FROM anon, authenticated;
REVOKE ALL ON TABLE public.business_prospect_enrichments FROM anon, authenticated;
REVOKE ALL ON TABLE public.business_demand_signals FROM anon, authenticated;
REVOKE ALL ON TABLE public.business_demand_rollups FROM anon, authenticated;
REVOKE ALL ON TABLE public.business_prospect_scores FROM anon, authenticated;
REVOKE ALL ON TABLE public.sales_accounts FROM anon, authenticated;
REVOKE ALL ON TABLE public.sales_activities FROM anon, authenticated;
REVOKE ALL ON TABLE public.business_claim_links FROM anon, authenticated;
REVOKE ALL ON TABLE public.prospect_to_business_links FROM anon, authenticated;

GRANT SELECT ON TABLE public.business_prospects TO authenticated;
GRANT SELECT ON TABLE public.business_prospect_sources TO authenticated;
GRANT SELECT ON TABLE public.business_prospect_enrichments TO authenticated;
GRANT SELECT ON TABLE public.business_demand_signals TO authenticated;
GRANT SELECT ON TABLE public.business_demand_rollups TO authenticated;
GRANT SELECT ON TABLE public.business_prospect_scores TO authenticated;
GRANT SELECT ON TABLE public.sales_accounts TO authenticated;
GRANT SELECT ON TABLE public.sales_activities TO authenticated;
GRANT SELECT ON TABLE public.business_claim_links TO authenticated;
GRANT SELECT ON TABLE public.prospect_to_business_links TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_prospects TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_prospect_sources TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_prospect_enrichments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_demand_signals TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_demand_rollups TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_prospect_scores TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sales_accounts TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sales_activities TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.business_claim_links TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.prospect_to_business_links TO service_role;

REVOKE ALL ON FUNCTION public.prospect_public_label_text(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.public_local_businesses(text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_business_demand_signal(uuid, uuid, uuid, text, text, text, numeric, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_can(text) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.prospect_public_label_text(text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.public_local_businesses(text, text, integer) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_business_demand_signal(uuid, uuid, uuid, text, text, text, numeric, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.admin_can(text) TO authenticated, service_role;

COMMENT ON TABLE public.business_prospects
  IS 'Unclaimed local seed records for network-effect demand collection. These are not claimed businesses and must not create deals.';

COMMENT ON TABLE public.business_prospect_sources
  IS 'Admin-only source/provenance snapshots. Raw source payloads are private and never exposed through public projections.';

COMMENT ON TABLE public.business_prospect_enrichments
  IS 'Admin-only structured enrichment. Review is required before enrichment changes public-safe facts.';

COMMENT ON TABLE public.business_demand_signals
  IS 'Private authenticated demand events for prospect/business requests. Public views use thresholded aggregates only.';

COMMENT ON TABLE public.business_claim_links
  IS 'Admin-created claim links. Stores SHA-256 token hashes only; raw tokens are returned once by the Edge Function.';

COMMENT ON COLUMN public.admin_audit_log.action
  IS 'Free-form admin audit action. Prospect command center actions include admin_prospect_imported, admin_prospect_enriched, admin_prospect_scored, admin_demand_proof_generated, admin_claim_link_created, admin_claim_link_revoked, admin_sales_activity_logged, admin_trial_created_from_prospect, and admin_ai_operating_report_viewed.';

COMMENT ON FUNCTION public.public_local_businesses(text, text, integer)
  IS 'Public-safe local business/prospect projection. Does not expose contacts, notes, source payloads, AI enrichments, scores, sales state, or token data.';

COMMENT ON FUNCTION public.record_business_demand_signal(uuid, uuid, uuid, text, text, text, numeric, text)
  IS 'Service-role demand capture helper with dedupe and daily rollup maintenance.';

COMMIT;
