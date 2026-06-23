-- Customer-safe projection for approved localized deal creative.
--
-- Drafted for the multilingual deals plan. Do not apply without Dan's
-- explicit migration approval. Depends on:
-- - 20260723120000_offer_versions_foundation.sql
-- - 20260724120000_offer_version_publish_rpc.sql
-- - 20260728120000_ad_localization_storage.sql

BEGIN;

CREATE OR REPLACE FUNCTION public.customer_deal_localizations(
  p_deal_ids uuid[],
  p_locale text
)
RETURNS TABLE (
  deal_id uuid,
  offer_version_id uuid,
  locale text,
  source_locale text,
  enabled_locales text[],
  headline text,
  supporting_copy text,
  image_alt_text text,
  localization_hash text,
  localization_bundle_hash text,
  translation_status text,
  qa_decision text,
  qa_reason_codes jsonb,
  deterministic_fallback boolean,
  locale_renderer_version text,
  localized_term_snapshot jsonb,
  locale_presentation_overrides jsonb
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT
    d.id AS deal_id,
    ov.id AS offer_version_id,
    al.locale,
    al.source_locale,
    ov.enabled_locales,
    al.headline,
    al.supporting_copy,
    al.image_alt_text,
    al.localization_hash,
    ov.localization_bundle_hash,
    al.translation_status,
    al.qa_decision,
    al.qa_reason_codes,
    al.translation_status = 'deterministic_fallback'
      OR al.locale = ANY(ov.deterministic_fallback_locales) AS deterministic_fallback,
    ov.locale_renderer_version,
    ov.localized_term_snapshot,
    ov.locale_presentation_overrides
  FROM public.deals d
  JOIN public.offer_versions ov
    ON ov.id = d.offer_version_id
  JOIN public.ad_localizations al
    ON al.ad_version_id = ov.id
   AND al.locale = p_locale
  WHERE p_deal_ids IS NOT NULL
    AND d.id = ANY(p_deal_ids)
    AND p_locale IN ('en-US', 'es-US', 'ko-KR')
    AND d.is_active IS TRUE
    AND (d.end_time IS NULL OR d.end_time >= now())
    AND ov.status = 'published'
    AND p_locale = ANY(ov.enabled_locales)
    AND ov.localization_bundle_hash IS NOT NULL
    AND al.localization_hash IS NOT NULL
    AND al.translation_status IN ('source_creative', 'persuasive_transcreation', 'deterministic_fallback')
    AND al.qa_decision IN ('not_required', 'pass');
$$;

COMMENT ON FUNCTION public.customer_deal_localizations(uuid[], text) IS
  'Returns customer-safe localized creative for active published deals without granting direct access to offer_versions or ad_localizations.';

REVOKE ALL ON FUNCTION public.customer_deal_localizations(uuid[], text)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.customer_deal_localizations(uuid[], text)
  TO anon, authenticated;

COMMIT;
