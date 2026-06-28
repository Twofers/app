-- Customer-safe projection for approved native poster creative.
--
-- Drafted for the production poster workflow plan. Do not apply without Dan's
-- explicit migration approval. Depends on:
-- - 20260723120000_offer_versions_foundation.sql
-- - 20260724120000_offer_version_publish_rpc.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.customer_deal_poster_specs(
  p_deal_ids uuid[]
)
RETURNS TABLE (
  deal_id uuid,
  offer_version_id uuid,
  poster_spec jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    d.id AS deal_id,
    ov.id AS offer_version_id,
    ov.ad_spec->'poster' AS poster_spec
  FROM public.deals d
  JOIN public.offer_versions ov
    ON ov.id = d.offer_version_id
  WHERE p_deal_ids IS NOT NULL
    AND d.id = ANY(p_deal_ids)
    AND d.is_active IS TRUE
    AND (d.end_time IS NULL OR d.end_time >= now())
    AND ov.status = 'published'
    AND ov.ad_spec IS NOT NULL
    AND ov.ad_spec->>'creative_format' = 'poster_v1'
    AND jsonb_typeof(ov.ad_spec->'poster') = 'object'
    AND ov.ad_spec->'poster'->>'enabled' = 'true'
    AND ov.ad_spec->'poster'->>'aspect_ratio' = '4:5'
    AND ov.ad_spec->'poster'->>'rendered_asset_path' IS NULL
    AND ov.ad_spec->'poster'->'content_policy'->>'no_app_brand_token' = 'true'
    AND ov.ad_spec->'poster'->'content_policy'->>'no_cta' = 'true'
    AND ov.ad_spec->'poster'->'content_policy'->>'no_scarcity' = 'true'
    AND ov.ad_spec->'poster'->'content_policy'->>'no_mutable_live_facts' = 'true'
    AND ov.ad_spec->'poster'->'content_policy'->>'image_text_free' = 'true'
    AND ov.ad_spec->'poster'->'layout_policy'->>'text_align' = 'center';
$$;

COMMENT ON FUNCTION public.customer_deal_poster_specs(uuid[]) IS
  'Returns customer-safe native poster specs for active published deals without granting direct access to offer_versions.';

REVOKE ALL ON FUNCTION public.customer_deal_poster_specs(uuid[])
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.customer_deal_poster_specs(uuid[])
  TO anon, authenticated;

COMMIT;
