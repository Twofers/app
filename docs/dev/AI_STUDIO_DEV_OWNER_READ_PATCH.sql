-- Dev-only AI Deal Studio owner read patch.
--
-- Applies only to the separate Supabase development project used by the
-- `com.unvmex2.twoforone.dev` APK. Do not add this to production migrations
-- until it has been reviewed for the production rollout.
--
-- Why this exists:
-- `businesses.owner_id` is intentionally hidden from authenticated clients by
-- column grants. RLS policies that directly join `businesses` can therefore
-- fail with "permission denied for table businesses" even when the owner should
-- be allowed to read their own draft AI Studio rows. This helper keeps owner_id
-- hidden while letting narrowly-scoped policies ask the database to decide
-- whether the current user owns a business.

BEGIN;

CREATE OR REPLACE FUNCTION public.ai_studio_dev_user_owns_business(p_business_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT COALESCE(
    EXISTS (
      SELECT 1
      FROM public.businesses b
      WHERE b.id = p_business_id
        AND b.owner_id = auth.uid()
    ),
    false
  );
$$;

REVOKE ALL ON FUNCTION public.ai_studio_dev_user_owns_business(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_studio_dev_user_owns_business(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.ai_studio_dev_user_owns_business(uuid)
  IS 'Dev-only helper for AI Studio owner-scoped RLS. Checks businesses.owner_id without granting owner_id to app clients.';

DROP POLICY IF EXISTS "Owners can read their brand profile" ON public.business_brand_profiles;
CREATE POLICY "Owners can read their brand profile"
ON public.business_brand_profiles FOR SELECT
TO authenticated
USING (public.ai_studio_dev_user_owns_business(business_id));

DROP POLICY IF EXISTS "Owners can upsert their brand profile" ON public.business_brand_profiles;
CREATE POLICY "Owners can upsert their brand profile"
ON public.business_brand_profiles FOR INSERT
TO authenticated
WITH CHECK (public.ai_studio_dev_user_owns_business(business_id));

DROP POLICY IF EXISTS "Owners can update their brand profile" ON public.business_brand_profiles;
CREATE POLICY "Owners can update their brand profile"
ON public.business_brand_profiles FOR UPDATE
TO authenticated
USING (public.ai_studio_dev_user_owns_business(business_id))
WITH CHECK (public.ai_studio_dev_user_owns_business(business_id));

DROP POLICY IF EXISTS "Owners can read their social connections" ON public.business_social_connections;
CREATE POLICY "Owners can read their social connections"
ON public.business_social_connections FOR SELECT
TO authenticated
USING (public.ai_studio_dev_user_owns_business(business_id));

DROP POLICY IF EXISTS "Owners can read approved media and stock" ON public.business_media_assets;
CREATE POLICY "Owners can read approved media and stock"
ON public.business_media_assets FOR SELECT
TO authenticated
USING (
  (
    business_id IS NOT NULL
    AND public.ai_studio_dev_user_owns_business(business_id)
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
  AND public.ai_studio_dev_user_owns_business(business_id)
);

DROP POLICY IF EXISTS "Owners can approve or disable their media" ON public.business_media_assets;
CREATE POLICY "Owners can approve or disable their media"
ON public.business_media_assets FOR UPDATE
TO authenticated
USING (
  business_id IS NOT NULL
  AND public.ai_studio_dev_user_owns_business(business_id)
)
WITH CHECK (
  business_id IS NOT NULL
  AND source_type <> 'twofer_stock'
  AND public.ai_studio_dev_user_owns_business(business_id)
);

DROP POLICY IF EXISTS "Owners can read their media import jobs" ON public.business_media_import_jobs;
CREATE POLICY "Owners can read their media import jobs"
ON public.business_media_import_jobs FOR SELECT
TO authenticated
USING (public.ai_studio_dev_user_owns_business(business_id));

DROP POLICY IF EXISTS "Owners can read their ad generation jobs" ON public.ad_generation_jobs;
CREATE POLICY "Owners can read their ad generation jobs"
ON public.ad_generation_jobs FOR SELECT
TO authenticated
USING (public.ai_studio_dev_user_owns_business(business_id));

DROP POLICY IF EXISTS "Owners can read their ad creatives" ON public.ad_creatives;
CREATE POLICY "Owners can read their ad creatives"
ON public.ad_creatives FOR SELECT
TO authenticated
USING (public.ai_studio_dev_user_owns_business(business_id));

DROP POLICY IF EXISTS "Owners can read their ad feedback" ON public.ad_creative_feedback;
CREATE POLICY "Owners can read their ad feedback"
ON public.ad_creative_feedback FOR SELECT
TO authenticated
USING (public.ai_studio_dev_user_owns_business(business_id));

DROP POLICY IF EXISTS "Owners can add ad feedback" ON public.ad_creative_feedback;
CREATE POLICY "Owners can add ad feedback"
ON public.ad_creative_feedback FOR INSERT
TO authenticated
WITH CHECK (
  created_by_user_id = auth.uid()
  AND public.ai_studio_dev_user_owns_business(business_id)
);

DROP POLICY IF EXISTS "Owners can read own AI deal assets" ON storage.objects;
CREATE POLICY "Owners can read own AI deal assets"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'ai-deal-assets'
  AND split_part(storage.objects.name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND public.ai_studio_dev_user_owns_business(split_part(storage.objects.name, '/', 1)::uuid)
);

DROP POLICY IF EXISTS "Owners can upload own AI deal assets" ON storage.objects;
CREATE POLICY "Owners can upload own AI deal assets"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'ai-deal-assets'
  AND split_part(storage.objects.name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND public.ai_studio_dev_user_owns_business(split_part(storage.objects.name, '/', 1)::uuid)
);

DROP POLICY IF EXISTS "Owners can update own AI deal assets" ON storage.objects;
CREATE POLICY "Owners can update own AI deal assets"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'ai-deal-assets'
  AND split_part(storage.objects.name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND public.ai_studio_dev_user_owns_business(split_part(storage.objects.name, '/', 1)::uuid)
)
WITH CHECK (
  bucket_id = 'ai-deal-assets'
  AND split_part(storage.objects.name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND public.ai_studio_dev_user_owns_business(split_part(storage.objects.name, '/', 1)::uuid)
);

DROP POLICY IF EXISTS "Owners can delete own AI deal assets" ON storage.objects;
CREATE POLICY "Owners can delete own AI deal assets"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'ai-deal-assets'
  AND split_part(storage.objects.name, '/', 1) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND public.ai_studio_dev_user_owns_business(split_part(storage.objects.name, '/', 1)::uuid)
);

COMMIT;
