-- Ad localization storage for verified multilingual ad bundles.
--
-- Drafted for the multilingual deals plan. Do not apply without Dan's
-- explicit migration approval. Depends on:
-- - 20260723120000_offer_versions_foundation.sql
-- - 20260724120000_offer_version_publish_rpc.sql

BEGIN;

ALTER TABLE public.offer_versions
  ADD COLUMN IF NOT EXISTS source_locale text;

ALTER TABLE public.offer_versions
  ADD COLUMN IF NOT EXISTS enabled_locales text[] NOT NULL DEFAULT ARRAY['en-US']::text[];

ALTER TABLE public.offer_versions
  ADD COLUMN IF NOT EXISTS localization_bundle_hash text;

ALTER TABLE public.offer_versions
  ADD COLUMN IF NOT EXISTS localized_term_snapshot jsonb;

ALTER TABLE public.offer_versions
  ADD COLUMN IF NOT EXISTS locale_presentation_overrides jsonb;

ALTER TABLE public.offer_versions
  ADD COLUMN IF NOT EXISTS translation_qa_summary jsonb;

ALTER TABLE public.offer_versions
  ADD COLUMN IF NOT EXISTS deterministic_fallback_locales text[] NOT NULL DEFAULT ARRAY[]::text[];

ALTER TABLE public.offer_versions
  ADD COLUMN IF NOT EXISTS locale_renderer_version text;

ALTER TABLE public.offer_versions
  DROP CONSTRAINT IF EXISTS offer_versions_source_locale_check;

ALTER TABLE public.offer_versions
  ADD CONSTRAINT offer_versions_source_locale_check CHECK (
    source_locale IS NULL OR source_locale IN ('en-US', 'es-US', 'ko-KR')
  );

ALTER TABLE public.offer_versions
  DROP CONSTRAINT IF EXISTS offer_versions_enabled_locales_check;

ALTER TABLE public.offer_versions
  ADD CONSTRAINT offer_versions_enabled_locales_check CHECK (
    enabled_locales <@ ARRAY['en-US', 'es-US', 'ko-KR']::text[]
  );

ALTER TABLE public.offer_versions
  DROP CONSTRAINT IF EXISTS offer_versions_localization_bundle_hash_check;

ALTER TABLE public.offer_versions
  ADD CONSTRAINT offer_versions_localization_bundle_hash_check CHECK (
    localization_bundle_hash IS NULL OR localization_bundle_hash ~ '^adloc_[0-9a-f]{8}$'
  );

ALTER TABLE public.offer_versions
  DROP CONSTRAINT IF EXISTS offer_versions_localized_term_snapshot_object_check;

ALTER TABLE public.offer_versions
  ADD CONSTRAINT offer_versions_localized_term_snapshot_object_check CHECK (
    localized_term_snapshot IS NULL OR jsonb_typeof(localized_term_snapshot) = 'object'
  );

ALTER TABLE public.offer_versions
  DROP CONSTRAINT IF EXISTS offer_versions_locale_presentation_overrides_object_check;

ALTER TABLE public.offer_versions
  ADD CONSTRAINT offer_versions_locale_presentation_overrides_object_check CHECK (
    locale_presentation_overrides IS NULL OR jsonb_typeof(locale_presentation_overrides) = 'object'
  );

ALTER TABLE public.offer_versions
  DROP CONSTRAINT IF EXISTS offer_versions_translation_qa_summary_object_check;

ALTER TABLE public.offer_versions
  ADD CONSTRAINT offer_versions_translation_qa_summary_object_check CHECK (
    translation_qa_summary IS NULL OR jsonb_typeof(translation_qa_summary) = 'object'
  );

ALTER TABLE public.offer_versions
  DROP CONSTRAINT IF EXISTS offer_versions_deterministic_fallback_locales_check;

ALTER TABLE public.offer_versions
  ADD CONSTRAINT offer_versions_deterministic_fallback_locales_check CHECK (
    deterministic_fallback_locales <@ ARRAY['en-US', 'es-US', 'ko-KR']::text[]
  );

COMMENT ON COLUMN public.offer_versions.source_locale IS
  'Source creative locale for the verified multilingual ad bundle.';

COMMENT ON COLUMN public.offer_versions.enabled_locales IS
  'Locales enabled for the verified multilingual ad bundle.';

COMMENT ON COLUMN public.offer_versions.localization_bundle_hash IS
  'Exact hash of the verified localization bundle approved with this offer version.';

COMMENT ON COLUMN public.offer_versions.localized_term_snapshot IS
  'Localized term/template snapshot ids used to render exact offer mechanics.';

COMMENT ON COLUMN public.offer_versions.locale_presentation_overrides IS
  'Safe per-locale presentation overrides approved with the composed card.';

COMMENT ON COLUMN public.offer_versions.translation_qa_summary IS
  'Per-locale deterministic and semantic translation QA summary.';

COMMENT ON COLUMN public.offer_versions.deterministic_fallback_locales IS
  'Locales published with deterministic target-language fallback copy.';

COMMENT ON COLUMN public.offer_versions.locale_renderer_version IS
  'Localized offer renderer version used for this offer version.';

CREATE TABLE IF NOT EXISTS public.ad_localizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ad_version_id uuid NOT NULL REFERENCES public.offer_versions(id) ON DELETE CASCADE,
  locale text NOT NULL,
  source_locale text NOT NULL,
  headline text NOT NULL,
  supporting_copy text,
  image_alt_text text NOT NULL,
  source_copy_hash text NOT NULL,
  localization_hash text NOT NULL,
  translation_status text NOT NULL,
  qa_decision text NOT NULL,
  qa_reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  provider text,
  model text,
  prompt_version text,
  preserved_terms jsonb NOT NULL DEFAULT '[]'::jsonb,
  repair_attempted boolean NOT NULL DEFAULT false,
  repair_status text NOT NULL DEFAULT 'not_required',
  repair_reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ad_localizations_locale_check CHECK (locale IN ('en-US', 'es-US', 'ko-KR')),
  CONSTRAINT ad_localizations_source_locale_check CHECK (source_locale IN ('en-US', 'es-US', 'ko-KR')),
  CONSTRAINT ad_localizations_source_copy_hash_check CHECK (source_copy_hash ~ '^adsrc_[0-9a-f]{8}$'),
  CONSTRAINT ad_localizations_localization_hash_check CHECK (localization_hash ~ '^adlocrow_[0-9a-f]{8}$'),
  CONSTRAINT ad_localizations_translation_status_check CHECK (
    translation_status IN ('source_creative', 'persuasive_transcreation', 'deterministic_fallback')
  ),
  CONSTRAINT ad_localizations_qa_decision_check CHECK (
    qa_decision IN ('not_required', 'pass', 'repair', 'block', 'unavailable')
  ),
  CONSTRAINT ad_localizations_qa_reason_codes_array_check CHECK (jsonb_typeof(qa_reason_codes) = 'array'),
  CONSTRAINT ad_localizations_preserved_terms_array_check CHECK (jsonb_typeof(preserved_terms) = 'array'),
  CONSTRAINT ad_localizations_repair_status_check CHECK (
    repair_status IN (
      'not_required',
      'not_needed',
      'not_attempted',
      'attempted_pass',
      'attempted_failed',
      'skipped_non_repairable'
    )
  ),
  CONSTRAINT ad_localizations_repair_reason_codes_array_check CHECK (jsonb_typeof(repair_reason_codes) = 'array'),
  UNIQUE (ad_version_id, locale)
);

CREATE INDEX IF NOT EXISTS idx_ad_localizations_locale
  ON public.ad_localizations(locale);

CREATE INDEX IF NOT EXISTS idx_ad_localizations_ad_version
  ON public.ad_localizations(ad_version_id);

ALTER TABLE public.ad_localizations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.ad_localizations FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_localizations TO service_role;

COMMENT ON TABLE public.ad_localizations IS
  'Service-role-only localized persuasive ad copy rows for immutable offer versions. Exact offer mechanics are rendered from offer_versions, not stored here.';

COMMENT ON COLUMN public.ad_localizations.headline IS
  'Localized persuasive headline. Must not contain generated changes to offer mechanics.';

COMMENT ON COLUMN public.ad_localizations.supporting_copy IS
  'Optional localized persuasive supporting copy. Exact offer lines are intentionally not stored in this table.';

COMMENT ON COLUMN public.ad_localizations.localization_hash IS
  'Hash of the persisted non-mechanical localized creative row.';

CREATE OR REPLACE FUNCTION public.apply_offer_version_localization_metadata()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_localization jsonb;
BEGIN
  v_localization := NEW.ad_spec->'localization';

  IF v_localization IS NULL OR jsonb_typeof(v_localization) <> 'object' THEN
    RETURN NEW;
  END IF;

  NEW.source_locale := NULLIF(v_localization->>'sourceLocale', '');
  NEW.localization_bundle_hash := NULLIF(v_localization->>'localizationBundleHash', '');
  NEW.localized_term_snapshot := CASE
    WHEN jsonb_typeof(v_localization->'localizedTermSnapshot') = 'object'
      THEN v_localization->'localizedTermSnapshot'
    ELSE NULL
  END;
  NEW.locale_presentation_overrides := CASE
    WHEN jsonb_typeof(v_localization->'localePresentationOverrides') = 'object'
      THEN v_localization->'localePresentationOverrides'
    ELSE NULL
  END;
  NEW.translation_qa_summary := CASE
    WHEN jsonb_typeof(v_localization->'translationQaSummary') = 'object'
      THEN v_localization->'translationQaSummary'
    ELSE NULL
  END;
  NEW.locale_renderer_version := NULLIF(v_localization->>'localeRendererVersion', '');

  IF jsonb_typeof(v_localization->'enabledLocales') = 'array' THEN
    SELECT COALESCE(array_agg(value), ARRAY['en-US']::text[])
    INTO NEW.enabled_locales
    FROM jsonb_array_elements_text(v_localization->'enabledLocales') AS value;
  END IF;

  IF jsonb_typeof(v_localization->'deterministicFallbackLocales') = 'array' THEN
    SELECT COALESCE(array_agg(value), ARRAY[]::text[])
    INTO NEW.deterministic_fallback_locales
    FROM jsonb_array_elements_text(v_localization->'deterministicFallbackLocales') AS value;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_ad_localizations_from_offer_version()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_localization jsonb;
  v_row record;
  v_payload jsonb;
BEGIN
  DELETE FROM public.ad_localizations
  WHERE ad_version_id = NEW.id;

  v_localization := NEW.ad_spec->'localization';

  IF v_localization IS NULL
    OR jsonb_typeof(v_localization) <> 'object'
    OR jsonb_typeof(v_localization->'localizations') <> 'object'
  THEN
    RETURN NEW;
  END IF;

  FOR v_row IN SELECT key, value FROM jsonb_each(v_localization->'localizations')
  LOOP
    v_payload := v_row.value;
    IF jsonb_typeof(v_payload) <> 'object' THEN
      CONTINUE;
    END IF;

    INSERT INTO public.ad_localizations (
      ad_version_id,
      locale,
      source_locale,
      headline,
      supporting_copy,
      image_alt_text,
      source_copy_hash,
      localization_hash,
      translation_status,
      qa_decision,
      qa_reason_codes,
      provider,
      model,
      prompt_version,
      preserved_terms,
      repair_attempted,
      repair_status,
      repair_reason_codes
    )
    VALUES (
      NEW.id,
      v_row.key,
      COALESCE(NULLIF(v_payload->>'sourceLocale', ''), NEW.source_locale),
      NULLIF(v_payload->>'headline', ''),
      NULLIF(v_payload->>'supportingCopy', ''),
      NULLIF(v_payload->>'imageAltText', ''),
      NULLIF(v_payload->>'sourceCopyHash', ''),
      NULLIF(v_payload->>'localizationHash', ''),
      NULLIF(v_payload->>'translationStatus', ''),
      NULLIF(v_payload->>'qaDecision', ''),
      CASE WHEN jsonb_typeof(v_payload->'qaReasonCodes') = 'array' THEN v_payload->'qaReasonCodes' ELSE '[]'::jsonb END,
      NULLIF(v_payload->>'provider', ''),
      NULLIF(v_payload->>'model', ''),
      NULLIF(v_payload->>'promptVersion', ''),
      CASE WHEN jsonb_typeof(v_payload->'preservedTerms') = 'array' THEN v_payload->'preservedTerms' ELSE '[]'::jsonb END,
      COALESCE(NULLIF(v_payload->>'repairAttempted', '')::boolean, false),
      COALESCE(NULLIF(v_payload->>'repairStatus', ''), 'not_required'),
      CASE WHEN jsonb_typeof(v_payload->'repairReasonCodes') = 'array' THEN v_payload->'repairReasonCodes' ELSE '[]'::jsonb END
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS offer_versions_apply_localization_metadata ON public.offer_versions;
CREATE TRIGGER offer_versions_apply_localization_metadata
  BEFORE INSERT OR UPDATE OF ad_spec ON public.offer_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_offer_version_localization_metadata();

DROP TRIGGER IF EXISTS offer_versions_sync_ad_localizations ON public.offer_versions;
CREATE TRIGGER offer_versions_sync_ad_localizations
  AFTER INSERT OR UPDATE OF ad_spec ON public.offer_versions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_ad_localizations_from_offer_version();

REVOKE ALL ON FUNCTION public.apply_offer_version_localization_metadata()
  FROM PUBLIC, anon, authenticated;

REVOKE ALL ON FUNCTION public.sync_ad_localizations_from_offer_version()
  FROM PUBLIC, anon, authenticated;

COMMIT;
