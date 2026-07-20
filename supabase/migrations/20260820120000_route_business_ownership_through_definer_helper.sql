-- Step 1 of 3 in the businesses column-grant repair.
--
-- WHY THIS EXISTS
-- ---------------
-- 20260705120000_businesses_pii_column_grants.sql revoked table-level SELECT on
-- public.businesses from anon/authenticated and re-granted a non-PII column
-- subset, deliberately withholding owner_id, business_email, contact_name, tone.
--
-- In production that hardening is currently DEFEATED: `authenticated` holds a
-- table-level SELECT grant on public.businesses (prod-only drift — across all
-- migrations only four statements touch SELECT on this table, and none of them
-- restores a table-level grant; the approved test project is in the intended
-- state). Verified 2026-07-19 by an authenticated REST read: a signed-in
-- non-owner can read owner_id / business_email / contact_name / tone for every
-- business row, plus 30 further columns no migration ever granted.
--
-- 28 live RLS policies still inline this shape:
--
--     EXISTS (SELECT 1 FROM public.businesses b
--             WHERE b.id = <tbl>.business_id AND b.owner_id = auth.uid())
--
-- A policy expression is evaluated with the INVOKING role's column privileges,
-- so every one of them works in production ONLY because of the over-grant.
-- Re-asserting the column grants without this migration first would 42501 deal
-- templates, menu items, poster upload, LOGO upload, redemption history,
-- merchant analytics and the whole AI ad / media-library surface.
--
-- This migration removes that dependency by routing every ownership test through
-- the existing SECURITY DEFINER helper. It is behaviour-preserving on its own:
-- each rewritten predicate computes exactly what it replaces, and every
-- non-ownership predicate is carried over verbatim. Applying this alone changes
-- nothing observable; it only makes step 2 (20260820121000) safe.
--
-- WHAT IS DELIBERATELY *NOT* HERE
-- -------------------------------
-- public.deals. 20260812130000_consolidate_deals_rls_policies.sql already did
-- this exact work for deals — it introduced is_business_owner() and consolidated
-- the owner policies under the canonical deals_owner_* names. Re-creating the
-- older "Businesses can ... their own deals" names here would resurrect the
-- superseded policy set AND re-introduce the business_profiles trial/active gate
-- that decision (a) in that migration explicitly turned OFF. deals is correct;
-- leave it alone.
--
-- public.user_owns_business(uuid) is NOT created or dropped here. It already
-- exists in production (hand-applied 2026-07-19 as part of 20260819120000;
-- verified live — rpc/user_owns_business returns 200/false, not PGRST202) and
-- the business_locations policies from that migration depend on it, so dropping
-- it would break them. It is a near-duplicate of is_business_owner() with a
-- weaker contract (no NULL guard, no row_security = off). New work should use
-- is_business_owner(); consolidating the two is follow-up, not this migration.
--
-- WHY is_business_owner() AND NOT A NEW HELPER
-- -------------------------------------------
-- 20260812130000:47 already defines it, it is already granted to authenticated,
-- and it carries two properties this repair needs: a `p_business_id IS NOT NULL`
-- guard, and `SET row_security = off` which prevents recursion against the
-- RESTRICTIVE redeemer_businesses_*_guard policies on businesses.

BEGIN;

-- ---------------------------------------------------------------------------
-- Storage path helper
--
-- The storage policies key off the first path segment of storage.objects.name
-- (<business_id>/<file>) rather than a business_id column, so they need a uuid
-- before they can call is_business_owner(). A bare cast would raise 22P02 on any
-- object whose prefix is not a uuid — notably the deliberate `business-logos/app/`
-- infra prefix from 20260812140000 — where the original text comparison simply
-- returned false. The regex guard reproduces that: a non-uuid prefix yields NULL,
-- and is_business_owner()'s NULL guard turns NULL into false.
--
-- CASE, not `AND`, because SQL does not guarantee short-circuit evaluation order,
-- so a guard expressed as `prefix ~ '...' AND prefix::uuid = ...` could still
-- evaluate the cast.
--
-- This is a parsing wrapper, not a second ownership rule: the ownership decision
-- is delegated wholly to is_business_owner(). It is intentionally NOT SECURITY
-- DEFINER — it touches no table itself, so it needs no elevated privilege.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.is_business_owner_for_object_path(p_object_name text)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT public.is_business_owner(
    CASE
      WHEN split_part(p_object_name, '/', 1) ~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
      THEN split_part(p_object_name, '/', 1)::uuid
    END
  );
$$;

COMMENT ON FUNCTION public.is_business_owner_for_object_path(text)
  IS 'Ownership test for storage.objects policies keyed on <business_id>/<file> paths. Parses the prefix and delegates to is_business_owner(); a non-uuid prefix (e.g. the business-logos/app/ infra folder) returns false rather than raising 22P02.';

REVOKE ALL ON FUNCTION public.is_business_owner_for_object_path(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_business_owner_for_object_path(text) TO authenticated;

-- ---------------------------------------------------------------------------
-- public.deal_templates  (created 20260127000001, never replaced)
-- No TO clause in the originals — preserved.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Businesses can read their templates" ON public.deal_templates;
CREATE POLICY "Businesses can read their templates"
  ON public.deal_templates FOR SELECT
  USING (public.is_business_owner(deal_templates.business_id));

DROP POLICY IF EXISTS "Businesses can insert their templates" ON public.deal_templates;
CREATE POLICY "Businesses can insert their templates"
  ON public.deal_templates FOR INSERT
  WITH CHECK (public.is_business_owner(deal_templates.business_id));

DROP POLICY IF EXISTS "Businesses can update their templates" ON public.deal_templates;
CREATE POLICY "Businesses can update their templates"
  ON public.deal_templates FOR UPDATE
  USING (public.is_business_owner(deal_templates.business_id));

DROP POLICY IF EXISTS "Businesses can delete their templates" ON public.deal_templates;
CREATE POLICY "Businesses can delete their templates"
  ON public.deal_templates FOR DELETE
  USING (public.is_business_owner(deal_templates.business_id));

-- ---------------------------------------------------------------------------
-- public.business_menu_items  (created 20260429120000, never replaced)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Owners can read their business menu items" ON public.business_menu_items;
CREATE POLICY "Owners can read their business menu items"
  ON public.business_menu_items FOR SELECT
  USING (public.is_business_owner(business_menu_items.business_id));

DROP POLICY IF EXISTS "Owners can insert their business menu items" ON public.business_menu_items;
CREATE POLICY "Owners can insert their business menu items"
  ON public.business_menu_items FOR INSERT
  WITH CHECK (public.is_business_owner(business_menu_items.business_id));

DROP POLICY IF EXISTS "Owners can update their business menu items" ON public.business_menu_items;
CREATE POLICY "Owners can update their business menu items"
  ON public.business_menu_items FOR UPDATE
  USING (public.is_business_owner(business_menu_items.business_id));

DROP POLICY IF EXISTS "Owners can delete their business menu items" ON public.business_menu_items;
CREATE POLICY "Owners can delete their business menu items"
  ON public.business_menu_items FOR DELETE
  USING (public.is_business_owner(business_menu_items.business_id));

-- ---------------------------------------------------------------------------
-- public.redemptions  (20260712120000)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS redemptions_owner_read ON public.redemptions;
CREATE POLICY redemptions_owner_read
  ON public.redemptions FOR SELECT
  TO authenticated
  USING (public.is_business_owner(redemptions.business_id));

-- ---------------------------------------------------------------------------
-- public.app_analytics_events  (last defined 20260601153000)
-- The original joined deals ⋈ businesses ⋈ business_profiles. The businesses leg
-- becomes the definer helper; the business_profiles leg stays inline (its grants
-- are unaffected, and it was an uncorrelated join, so it is equivalent to a
-- standalone EXISTS). The `deal_id IS NOT NULL` short-circuit is preserved.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "app_analytics_events_select_deal_owner" ON public.app_analytics_events;
CREATE POLICY "app_analytics_events_select_deal_owner"
  ON public.app_analytics_events FOR SELECT
  TO authenticated
  USING (
    deal_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.deals d
      WHERE d.id = app_analytics_events.deal_id
        AND public.is_business_owner(d.business_id)
    )
    AND EXISTS (
      SELECT 1 FROM public.business_profiles bp
      WHERE (bp.user_id = auth.uid() OR bp.owner_id = auth.uid())
        AND bp.subscription_status IN ('trial','active')
    )
  );

-- ---------------------------------------------------------------------------
-- public.business_media_import_jobs  (20260725121000)
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Owners can read their media import jobs" ON public.business_media_import_jobs;
CREATE POLICY "Owners can read their media import jobs"
  ON public.business_media_import_jobs FOR SELECT
  TO authenticated
  USING (public.is_business_owner(business_media_import_jobs.business_id));

-- ---------------------------------------------------------------------------
-- AI ad / media library cluster  (20260725120000) — 11 policies.
-- Every non-ownership predicate below is carried over verbatim.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Owners can read their brand profile" ON public.business_brand_profiles;
CREATE POLICY "Owners can read their brand profile"
  ON public.business_brand_profiles FOR SELECT
  TO authenticated
  USING (public.is_business_owner(business_brand_profiles.business_id));

DROP POLICY IF EXISTS "Owners can upsert their brand profile" ON public.business_brand_profiles;
CREATE POLICY "Owners can upsert their brand profile"
  ON public.business_brand_profiles FOR INSERT
  TO authenticated
  WITH CHECK (public.is_business_owner(business_brand_profiles.business_id));

DROP POLICY IF EXISTS "Owners can update their brand profile" ON public.business_brand_profiles;
CREATE POLICY "Owners can update their brand profile"
  ON public.business_brand_profiles FOR UPDATE
  TO authenticated
  USING (public.is_business_owner(business_brand_profiles.business_id))
  WITH CHECK (public.is_business_owner(business_brand_profiles.business_id));

DROP POLICY IF EXISTS "Owners can read their social connections" ON public.business_social_connections;
CREATE POLICY "Owners can read their social connections"
  ON public.business_social_connections FOR SELECT
  TO authenticated
  USING (public.is_business_owner(business_social_connections.business_id));

DROP POLICY IF EXISTS "Owners can read approved media and stock" ON public.business_media_assets;
CREATE POLICY "Owners can read approved media and stock"
  ON public.business_media_assets FOR SELECT
  TO authenticated
  USING (
    (
      business_id IS NOT NULL
      AND public.is_business_owner(business_media_assets.business_id)
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
    AND public.is_business_owner(business_media_assets.business_id)
  );

DROP POLICY IF EXISTS "Owners can approve or disable their media" ON public.business_media_assets;
CREATE POLICY "Owners can approve or disable their media"
  ON public.business_media_assets FOR UPDATE
  TO authenticated
  USING (
    business_id IS NOT NULL
    AND public.is_business_owner(business_media_assets.business_id)
  )
  WITH CHECK (
    business_id IS NOT NULL
    AND source_type <> 'twofer_stock'
    AND public.is_business_owner(business_media_assets.business_id)
  );

DROP POLICY IF EXISTS "Owners can read their ad generation jobs" ON public.ad_generation_jobs;
CREATE POLICY "Owners can read their ad generation jobs"
  ON public.ad_generation_jobs FOR SELECT
  TO authenticated
  USING (public.is_business_owner(ad_generation_jobs.business_id));

DROP POLICY IF EXISTS "Owners can read their ad creatives" ON public.ad_creatives;
CREATE POLICY "Owners can read their ad creatives"
  ON public.ad_creatives FOR SELECT
  TO authenticated
  USING (public.is_business_owner(ad_creatives.business_id));

DROP POLICY IF EXISTS "Owners can read their ad feedback" ON public.ad_creative_feedback;
CREATE POLICY "Owners can read their ad feedback"
  ON public.ad_creative_feedback FOR SELECT
  TO authenticated
  USING (public.is_business_owner(ad_creative_feedback.business_id));

DROP POLICY IF EXISTS "Owners can add ad feedback" ON public.ad_creative_feedback;
CREATE POLICY "Owners can add ad feedback"
  ON public.ad_creative_feedback FOR INSERT
  TO authenticated
  WITH CHECK (
    created_by_user_id = auth.uid()
    AND public.is_business_owner(ad_creative_feedback.business_id)
  );

-- ---------------------------------------------------------------------------
-- storage.objects — deal-photos owner policies  (20260706130000)
-- Bucket predicates preserved verbatim; only the businesses lookup changes.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Business owners can upload deal photos" ON storage.objects;
CREATE POLICY "Business owners can upload deal photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'deal-photos'
    AND public.is_business_owner_for_object_path(storage.objects.name)
  );

DROP POLICY IF EXISTS "Business owners can update their deal photos" ON storage.objects;
CREATE POLICY "Business owners can update their deal photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'deal-photos'
    AND public.is_business_owner_for_object_path(storage.objects.name)
  )
  WITH CHECK (
    bucket_id = 'deal-photos'
    AND public.is_business_owner_for_object_path(storage.objects.name)
  );

DROP POLICY IF EXISTS "Business owners can delete their deal photos" ON storage.objects;
CREATE POLICY "Business owners can delete their deal photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'deal-photos'
    AND public.is_business_owner_for_object_path(storage.objects.name)
  );

-- ---------------------------------------------------------------------------
-- storage.objects — business-logos owner policies  (20260812140000)
--
-- The `business-logos/app/` infra prefix stays deniable to every authenticated
-- caller exactly as before: `app` is not a uuid, so the helper returns false and
-- only service_role (which bypasses RLS) can write there. Public read is
-- untouched.
-- ---------------------------------------------------------------------------

DROP POLICY IF EXISTS "Business owner upload logo" ON storage.objects;
CREATE POLICY "Business owner upload logo"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'business-logos'
    AND public.is_business_owner_for_object_path(storage.objects.name)
  );

DROP POLICY IF EXISTS "Business owner update logo" ON storage.objects;
CREATE POLICY "Business owner update logo"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'business-logos'
    AND public.is_business_owner_for_object_path(storage.objects.name)
  )
  WITH CHECK (
    bucket_id = 'business-logos'
    AND public.is_business_owner_for_object_path(storage.objects.name)
  );

DROP POLICY IF EXISTS "Business owner delete logo" ON storage.objects;
CREATE POLICY "Business owner delete logo"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'business-logos'
    AND public.is_business_owner_for_object_path(storage.objects.name)
  );

COMMIT;
