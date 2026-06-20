-- Brand profile, approved media library, and durable ad-generation records.
--
-- Drafted for the AI ad generation master plan. Do not apply without Dan's
-- explicit migration approval. This migration is intentionally additive and
-- does not change the current deal publish path.

BEGIN;

CREATE TABLE IF NOT EXISTS public.business_brand_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  website_url text,
  logo_asset_id uuid,
  primary_color text,
  secondary_color text,
  voice_attributes text[] NOT NULL DEFAULT ARRAY[]::text[],
  avoid_phrases text[] NOT NULL DEFAULT ARRAY[]::text[],
  preferred_phrases text[] NOT NULL DEFAULT ARRAY[]::text[],
  copy_examples jsonb NOT NULL DEFAULT '{}'::jsonb,
  website_summary text,
  brand_facts jsonb NOT NULL DEFAULT '{}'::jsonb,
  punctuation_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  emoji_preference text,
  source_version text NOT NULL DEFAULT 'brand_profile_v1',
  owner_approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_brand_profiles_business_unique UNIQUE (business_id),
  CONSTRAINT business_brand_profiles_copy_examples_object_check CHECK (jsonb_typeof(copy_examples) = 'object'),
  CONSTRAINT business_brand_profiles_brand_facts_object_check CHECK (jsonb_typeof(brand_facts) = 'object'),
  CONSTRAINT business_brand_profiles_punctuation_object_check CHECK (jsonb_typeof(punctuation_preferences) = 'object'),
  CONSTRAINT business_brand_profiles_emoji_preference_check CHECK (
    emoji_preference IS NULL OR emoji_preference IN ('none', 'rare', 'ok')
  )
);

CREATE TABLE IF NOT EXISTS public.business_social_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  provider text NOT NULL,
  external_account_id text NOT NULL,
  display_name text,
  token_reference text,
  scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  access_status text NOT NULL DEFAULT 'active',
  last_synced_at timestamptz,
  source_revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_social_connections_provider_check CHECK (provider IN ('instagram', 'facebook')),
  CONSTRAINT business_social_connections_access_status_check CHECK (
    access_status IN ('active', 'revoked', 'expired', 'disabled')
  ),
  CONSTRAINT business_social_connections_external_unique UNIQUE (provider, external_account_id)
);

CREATE TABLE IF NOT EXISTS public.business_media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  social_connection_id uuid REFERENCES public.business_social_connections(id) ON DELETE SET NULL,
  external_source_id text,
  origin_url text,
  storage_path text NOT NULL,
  thumbnail_storage_path text,
  mime_type text NOT NULL,
  width integer,
  height integer,
  byte_size bigint,
  sha256 text,
  perceptual_hash text,
  owner_approved boolean NOT NULL DEFAULT false,
  rights_confirmed boolean NOT NULL DEFAULT false,
  auto_use_eligible boolean NOT NULL DEFAULT false,
  approval_status text NOT NULL DEFAULT 'pending',
  moderation_status text NOT NULL DEFAULT 'pending',
  quality_score numeric,
  ad_usefulness_score numeric,
  visual_relevance_floor numeric,
  detected_items jsonb NOT NULL DEFAULT '[]'::jsonb,
  tags text[] NOT NULL DEFAULT ARRAY[]::text[],
  dominant_colors jsonb NOT NULL DEFAULT '[]'::jsonb,
  contains_logo boolean,
  contains_text boolean,
  last_used_at timestamptz,
  usage_count integer NOT NULL DEFAULT 0,
  license_provider text,
  license_asset_id text,
  license_version text,
  commercial_ad_use_allowed boolean NOT NULL DEFAULT false,
  attribution_required boolean NOT NULL DEFAULT false,
  attribution_text text,
  source_revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT business_media_assets_source_type_check CHECK (
    source_type IN (
      'owner_upload',
      'website_import',
      'instagram_import',
      'facebook_import',
      'prior_approved_creative',
      'twofer_stock',
      'generated'
    )
  ),
  CONSTRAINT business_media_assets_business_scope_check CHECK (
    (source_type = 'twofer_stock' AND business_id IS NULL)
    OR (source_type <> 'twofer_stock' AND business_id IS NOT NULL)
  ),
  CONSTRAINT business_media_assets_approval_status_check CHECK (
    approval_status IN ('pending', 'approved', 'rejected', 'disabled')
  ),
  CONSTRAINT business_media_assets_moderation_status_check CHECK (
    moderation_status IN ('pending', 'approved', 'rejected', 'failed')
  ),
  CONSTRAINT business_media_assets_dimensions_check CHECK (
    (width IS NULL OR width > 0)
    AND (height IS NULL OR height > 0)
    AND (byte_size IS NULL OR byte_size > 0)
  ),
  CONSTRAINT business_media_assets_scores_check CHECK (
    (quality_score IS NULL OR (quality_score >= 0 AND quality_score <= 1))
    AND (ad_usefulness_score IS NULL OR (ad_usefulness_score >= 0 AND ad_usefulness_score <= 1))
    AND (visual_relevance_floor IS NULL OR (visual_relevance_floor >= 0 AND visual_relevance_floor <= 1))
  ),
  CONSTRAINT business_media_assets_detected_items_array_check CHECK (jsonb_typeof(detected_items) = 'array'),
  CONSTRAINT business_media_assets_dominant_colors_array_check CHECK (jsonb_typeof(dominant_colors) = 'array'),
  CONSTRAINT business_media_assets_usage_count_check CHECK (usage_count >= 0),
  CONSTRAINT business_media_assets_auto_use_gate_check CHECK (
    auto_use_eligible = false
    OR (
      owner_approved = true
      AND rights_confirmed = true
      AND approval_status = 'approved'
      AND moderation_status = 'approved'
      AND source_revoked_at IS NULL
    )
  ),
  CONSTRAINT business_media_assets_stock_license_check CHECK (
    source_type <> 'twofer_stock'
    OR (
      commercial_ad_use_allowed = true
      AND license_provider IS NOT NULL
      AND license_asset_id IS NOT NULL
      AND license_version IS NOT NULL
    )
  )
);

CREATE INDEX IF NOT EXISTS idx_business_brand_profiles_business
  ON public.business_brand_profiles(business_id);

CREATE INDEX IF NOT EXISTS idx_business_social_connections_business
  ON public.business_social_connections(business_id, provider);

CREATE INDEX IF NOT EXISTS idx_business_media_assets_business_status
  ON public.business_media_assets(business_id, approval_status, auto_use_eligible);

CREATE INDEX IF NOT EXISTS idx_business_media_assets_stock
  ON public.business_media_assets(source_type, auto_use_eligible, approval_status)
  WHERE source_type = 'twofer_stock';

CREATE INDEX IF NOT EXISTS idx_business_media_assets_hash
  ON public.business_media_assets(business_id, sha256)
  WHERE sha256 IS NOT NULL;

ALTER TABLE public.business_brand_profiles
  DROP CONSTRAINT IF EXISTS business_brand_profiles_logo_asset_fk;

ALTER TABLE public.business_brand_profiles
  ADD CONSTRAINT business_brand_profiles_logo_asset_fk
  FOREIGN KEY (logo_asset_id)
  REFERENCES public.business_media_assets(id)
  ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.ad_generation_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  owner_user_id uuid,
  request_group_id uuid NOT NULL DEFAULT gen_random_uuid(),
  idempotency_key text NOT NULL,
  pipeline_version text NOT NULL DEFAULT 'ad_pipeline_v3',
  status text NOT NULL DEFAULT 'queued',
  stage text NOT NULL DEFAULT 'queued',
  offer_definition_id uuid REFERENCES public.offer_definitions(id) ON DELETE SET NULL,
  offer_version_id uuid REFERENCES public.offer_versions(id) ON DELETE SET NULL,
  input_offer jsonb NOT NULL DEFAULT '{}'::jsonb,
  eligible_media_count integer NOT NULL DEFAULT 0,
  selected_media_asset_id uuid REFERENCES public.business_media_assets(id) ON DELETE SET NULL,
  generated_fallback_reason text,
  error_code text,
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_generation_jobs_idempotency_unique UNIQUE (business_id, idempotency_key),
  CONSTRAINT ad_generation_jobs_status_check CHECK (
    status IN ('queued', 'running', 'ready', 'failed', 'canceled')
  ),
  CONSTRAINT ad_generation_jobs_stage_check CHECK (
    stage IN (
      'queued',
      'reading_deal',
      'finding_photo',
      'creating_visual',
      'writing_ad',
      'building_design',
      'final_review',
      'ready',
      'failed',
      'canceled'
    )
  ),
  CONSTRAINT ad_generation_jobs_input_offer_object_check CHECK (jsonb_typeof(input_offer) = 'object'),
  CONSTRAINT ad_generation_jobs_media_count_check CHECK (eligible_media_count >= 0),
  CONSTRAINT ad_generation_jobs_generated_reason_check CHECK (
    generated_fallback_reason IS NULL OR generated_fallback_reason = 'NO_ELIGIBLE_MEDIA'
  )
);

CREATE TABLE IF NOT EXISTS public.ad_creatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_generation_job_id uuid NOT NULL REFERENCES public.ad_generation_jobs(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  offer_definition_id uuid REFERENCES public.offer_definitions(id) ON DELETE SET NULL,
  offer_version_id uuid REFERENCES public.offer_versions(id) ON DELETE SET NULL,
  media_asset_id uuid REFERENCES public.business_media_assets(id) ON DELETE SET NULL,
  concept_label text NOT NULL,
  rank integer NOT NULL DEFAULT 1,
  ad_spec jsonb NOT NULL,
  text_provenance jsonb NOT NULL DEFAULT '{}'::jsonb,
  quality jsonb NOT NULL DEFAULT '{}'::jsonb,
  selected_by_owner boolean NOT NULL DEFAULT false,
  owner_selected_at timestamptz,
  owner_rejected_at timestamptz,
  owner_feedback text,
  published_deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_creatives_concept_label_check CHECK (
    concept_label IN ('recommended', 'alternative_a', 'alternative_b', 'revision')
  ),
  CONSTRAINT ad_creatives_rank_check CHECK (rank >= 1),
  CONSTRAINT ad_creatives_ad_spec_object_check CHECK (jsonb_typeof(ad_spec) = 'object'),
  CONSTRAINT ad_creatives_text_provenance_object_check CHECK (jsonb_typeof(text_provenance) = 'object'),
  CONSTRAINT ad_creatives_quality_object_check CHECK (jsonb_typeof(quality) = 'object')
);

CREATE TABLE IF NOT EXISTS public.ad_creative_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_creative_id uuid NOT NULL REFERENCES public.ad_creatives(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  feedback_type text NOT NULL,
  rating integer,
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_creative_feedback_type_check CHECK (
    feedback_type IN ('published', 'selected_alternative', 'edited_copy', 'changed_visual', 'rejected', 'rated')
  ),
  CONSTRAINT ad_creative_feedback_rating_check CHECK (rating IS NULL OR (rating >= 1 AND rating <= 5)),
  CONSTRAINT ad_creative_feedback_metadata_object_check CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX IF NOT EXISTS idx_ad_generation_jobs_business_created
  ON public.ad_generation_jobs(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_generation_jobs_request_group
  ON public.ad_generation_jobs(request_group_id);

CREATE INDEX IF NOT EXISTS idx_ad_creatives_job_rank
  ON public.ad_creatives(ad_generation_job_id, rank);

CREATE INDEX IF NOT EXISTS idx_ad_creatives_business_created
  ON public.ad_creatives(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ad_creative_feedback_creative
  ON public.ad_creative_feedback(ad_creative_id, created_at DESC);

ALTER TABLE public.business_brand_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_social_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.business_media_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_generation_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_creatives ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_creative_feedback ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.business_brand_profiles FROM anon, authenticated;
REVOKE ALL ON public.business_social_connections FROM anon, authenticated;
REVOKE ALL ON public.business_media_assets FROM anon, authenticated;
REVOKE ALL ON public.ad_generation_jobs FROM anon, authenticated;
REVOKE ALL ON public.ad_creatives FROM anon, authenticated;
REVOKE ALL ON public.ad_creative_feedback FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON public.business_brand_profiles TO authenticated;
GRANT SELECT (
  id,
  business_id,
  provider,
  external_account_id,
  display_name,
  scopes,
  access_status,
  last_synced_at,
  source_revoked_at,
  created_at,
  updated_at
) ON public.business_social_connections TO authenticated;
GRANT SELECT ON public.business_media_assets TO authenticated;
GRANT INSERT (
  business_id,
  source_type,
  storage_path,
  thumbnail_storage_path,
  mime_type,
  width,
  height,
  byte_size,
  sha256,
  owner_approved,
  rights_confirmed,
  auto_use_eligible,
  approval_status,
  tags
) ON public.business_media_assets TO authenticated;
GRANT UPDATE (
  owner_approved,
  rights_confirmed,
  auto_use_eligible,
  approval_status,
  updated_at
) ON public.business_media_assets TO authenticated;
GRANT SELECT ON public.ad_generation_jobs TO authenticated;
GRANT SELECT ON public.ad_creatives TO authenticated;
GRANT SELECT, INSERT ON public.ad_creative_feedback TO authenticated;

GRANT SELECT, INSERT, UPDATE ON public.business_brand_profiles TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.business_social_connections TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.business_media_assets TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.ad_generation_jobs TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.ad_creatives TO service_role;
GRANT SELECT, INSERT ON public.ad_creative_feedback TO service_role;

DROP POLICY IF EXISTS "Owners can read their brand profile" ON public.business_brand_profiles;
CREATE POLICY "Owners can read their brand profile"
ON public.business_brand_profiles FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = business_brand_profiles.business_id
      AND b.owner_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Owners can upsert their brand profile" ON public.business_brand_profiles;
CREATE POLICY "Owners can upsert their brand profile"
ON public.business_brand_profiles FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = business_brand_profiles.business_id
      AND b.owner_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Owners can update their brand profile" ON public.business_brand_profiles;
CREATE POLICY "Owners can update their brand profile"
ON public.business_brand_profiles FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = business_brand_profiles.business_id
      AND b.owner_id = auth.uid()
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = business_brand_profiles.business_id
      AND b.owner_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Owners can read their social connections" ON public.business_social_connections;
CREATE POLICY "Owners can read their social connections"
ON public.business_social_connections FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = business_social_connections.business_id
      AND b.owner_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Owners can read approved media and stock" ON public.business_media_assets;
CREATE POLICY "Owners can read approved media and stock"
ON public.business_media_assets FOR SELECT
TO authenticated
USING (
  (
    business_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_media_assets.business_id
        AND b.owner_id = auth.uid()
    )
  )
  OR (
    source_type = 'twofer_stock'
    AND approval_status = 'approved'
    AND auto_use_eligible = true
    AND commercial_ad_use_allowed = true
  )
);

DROP POLICY IF EXISTS "Owners can insert owner uploaded media" ON public.business_media_assets;
CREATE POLICY "Owners can insert owner uploaded media"
ON public.business_media_assets FOR INSERT
TO authenticated
WITH CHECK (
  source_type = 'owner_upload'
  AND business_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = business_media_assets.business_id
      AND b.owner_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Owners can approve or disable their media" ON public.business_media_assets;
CREATE POLICY "Owners can approve or disable their media"
ON public.business_media_assets FOR UPDATE
TO authenticated
USING (
  business_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = business_media_assets.business_id
      AND b.owner_id = auth.uid()
  )
)
WITH CHECK (
  business_id IS NOT NULL
  AND source_type <> 'twofer_stock'
  AND EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = business_media_assets.business_id
      AND b.owner_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Owners can read their ad generation jobs" ON public.ad_generation_jobs;
CREATE POLICY "Owners can read their ad generation jobs"
ON public.ad_generation_jobs FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = ad_generation_jobs.business_id
      AND b.owner_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Owners can read their ad creatives" ON public.ad_creatives;
CREATE POLICY "Owners can read their ad creatives"
ON public.ad_creatives FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = ad_creatives.business_id
      AND b.owner_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Owners can read their ad feedback" ON public.ad_creative_feedback;
CREATE POLICY "Owners can read their ad feedback"
ON public.ad_creative_feedback FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = ad_creative_feedback.business_id
      AND b.owner_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Owners can add ad feedback" ON public.ad_creative_feedback;
CREATE POLICY "Owners can add ad feedback"
ON public.ad_creative_feedback FOR INSERT
TO authenticated
WITH CHECK (
  created_by_user_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM public.businesses b
    WHERE b.id = ad_creative_feedback.business_id
      AND b.owner_id = auth.uid()
  )
);

COMMENT ON TABLE public.business_brand_profiles IS
  'Owner-approved brand voice and visual identity context for the v3 ad pipeline.';
COMMENT ON TABLE public.business_social_connections IS
  'Owner-authorized social account references. Stores token references only, not raw OAuth tokens.';
COMMENT ON TABLE public.business_media_assets IS
  'Approved, rights-confirmed media assets for ad generation, including global licensed Twofer stock.';
COMMENT ON TABLE public.ad_generation_jobs IS
  'Durable ad-generation job state for idempotency, stage recovery, and pipeline telemetry.';
COMMENT ON TABLE public.ad_creatives IS
  'Reviewable ad concepts produced by the v3 pipeline. AdSpec JSON separates creative from locked offer facts.';
COMMENT ON TABLE public.ad_creative_feedback IS
  'Structured owner feedback and selection signals for ad creative quality learning.';
COMMENT ON COLUMN public.business_social_connections.token_reference IS
  'Opaque pointer to a secret/token store. Raw social access tokens must never be stored in this table.';
COMMENT ON COLUMN public.business_media_assets.auto_use_eligible IS
  'True only when approval, rights, moderation, and revocation gates pass.';
COMMENT ON COLUMN public.business_media_assets.commercial_ad_use_allowed IS
  'Required for Twofer stock assets before they can be selected for ads.';

COMMIT;
