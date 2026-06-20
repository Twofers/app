-- Server-side publish path for OfferDefinition / OfferVersion.
--
-- Drafted for the AI ad generation master plan. Do not apply without Dan's
-- explicit migration approval. Depends on:
-- - 20260721120000_deal_wallet_redemption_rules.sql
-- - 20260723120000_offer_versions_foundation.sql

BEGIN;

CREATE TABLE IF NOT EXISTS public.publish_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  status text NOT NULL DEFAULT 'in_progress',
  source text NOT NULL DEFAULT 'offer_version_publish_v1',
  created_by_user_id uuid,
  offer_definition_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  offer_version_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  deal_ids uuid[] NOT NULL DEFAULT ARRAY[]::uuid[],
  ad_spec jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  CONSTRAINT publish_events_status_check CHECK (status IN ('in_progress', 'published')),
  CONSTRAINT publish_events_idempotency_key_check CHECK (length(trim(idempotency_key)) >= 12),
  CONSTRAINT publish_events_ad_spec_object_check CHECK (
    ad_spec IS NULL OR jsonb_typeof(ad_spec) = 'object'
  ),
  UNIQUE (business_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_publish_events_business_created
  ON public.publish_events(business_id, created_at DESC);

ALTER TABLE public.publish_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.publish_events FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.publish_events TO service_role;

COMMENT ON TABLE public.publish_events IS
  'Service-role-only audit/idempotency records for atomic OfferVersion publish operations.';

ALTER TABLE public.offer_versions
  ADD COLUMN IF NOT EXISTS ad_spec jsonb;

ALTER TABLE public.offer_versions
  DROP CONSTRAINT IF EXISTS offer_versions_ad_spec_object_check;

ALTER TABLE public.offer_versions
  ADD CONSTRAINT offer_versions_ad_spec_object_check CHECK (
    ad_spec IS NULL OR jsonb_typeof(ad_spec) = 'object'
  );

COMMENT ON COLUMN public.offer_versions.ad_spec IS
  'Immutable native-renderer AdSpec approved and published with this offer version.';

CREATE OR REPLACE FUNCTION public.publish_offer_versioned_deal(
  p_business_id uuid,
  p_owner_user_id uuid,
  p_offer_definition jsonb,
  p_deal_rows jsonb,
  p_idempotency_key text,
  p_ad_spec jsonb DEFAULT NULL
)
RETURNS TABLE (
  deal_id uuid,
  offer_definition_id uuid,
  offer_version_id uuid,
  idempotency_replayed boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_event_id uuid;
  v_existing public.publish_events%ROWTYPE;
  v_row jsonb;
  v_row_business_id uuid;
  v_location_id uuid;
  v_offer_definition_id uuid;
  v_offer_version_id uuid;
  v_deal_id uuid;
  v_offer_definition_ids uuid[] := ARRAY[]::uuid[];
  v_offer_version_ids uuid[] := ARRAY[]::uuid[];
  v_deal_ids uuid[] := ARRAY[]::uuid[];
  v_days_of_week integer[];
  v_i integer;
BEGIN
  IF p_business_id IS NULL OR p_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing business or owner id' USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 12 THEN
    RAISE EXCEPTION 'Missing idempotency key' USING ERRCODE = '22023';
  END IF;

  IF p_offer_definition IS NULL OR jsonb_typeof(p_offer_definition) <> 'object' THEN
    RAISE EXCEPTION 'Offer definition must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF p_deal_rows IS NULL OR jsonb_typeof(p_deal_rows) <> 'array' OR jsonb_array_length(p_deal_rows) = 0 THEN
    RAISE EXCEPTION 'Deal rows must be a non-empty JSON array' USING ERRCODE = '22023';
  END IF;

  IF p_ad_spec IS NOT NULL AND jsonb_typeof(p_ad_spec) <> 'object' THEN
    RAISE EXCEPTION 'Ad spec must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.businesses b
    WHERE b.id = p_business_id
      AND b.owner_id = p_owner_user_id
  ) THEN
    RAISE EXCEPTION 'Business not found for owner' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.publish_events (
    business_id,
    idempotency_key,
    status,
    source,
    created_by_user_id,
    ad_spec
  )
  VALUES (
    p_business_id,
    trim(p_idempotency_key),
    'in_progress',
    'offer_version_publish_v1',
    p_owner_user_id,
    p_ad_spec
  )
  ON CONFLICT (business_id, idempotency_key) DO NOTHING
  RETURNING id INTO v_event_id;

  IF v_event_id IS NULL THEN
    SELECT *
    INTO v_existing
    FROM public.publish_events pe
    WHERE pe.business_id = p_business_id
      AND pe.idempotency_key = trim(p_idempotency_key);

    IF v_existing.status = 'published' THEN
      FOR v_i IN 1..COALESCE(array_length(v_existing.deal_ids, 1), 0) LOOP
        deal_id := v_existing.deal_ids[v_i];
        offer_definition_id := v_existing.offer_definition_ids[v_i];
        offer_version_id := v_existing.offer_version_ids[v_i];
        idempotency_replayed := true;
        RETURN NEXT;
      END LOOP;
      RETURN;
    END IF;

    RAISE EXCEPTION 'Publish already in progress for idempotency key' USING ERRCODE = '55P03';
  END IF;

  FOR v_row IN SELECT value FROM jsonb_array_elements(p_deal_rows)
  LOOP
    IF jsonb_typeof(v_row) <> 'object' THEN
      RAISE EXCEPTION 'Each deal row must be a JSON object' USING ERRCODE = '22023';
    END IF;

    v_row_business_id := NULLIF(v_row->>'business_id', '')::uuid;
    IF v_row_business_id IS DISTINCT FROM p_business_id THEN
      RAISE EXCEPTION 'Deal row business does not match owner business' USING ERRCODE = '42501';
    END IF;

    v_location_id := NULLIF(v_row->>'location_id', '')::uuid;
    v_days_of_week := NULL;
    IF jsonb_typeof(v_row->'days_of_week') = 'array' THEN
      SELECT array_agg(value::integer ORDER BY ordinality)
      INTO v_days_of_week
      FROM jsonb_array_elements_text(v_row->'days_of_week') WITH ORDINALITY;
    END IF;

    INSERT INTO public.offer_definitions (
      business_id,
      location_id,
      schema_version,
      status,
      source,
      offer_type,
      canonical_offer_sentence,
      disclosure_line,
      offer_definition,
      per_user_claim_limit,
      total_claim_limit,
      starts_at,
      ends_at,
      time_zone
    )
    VALUES (
      p_business_id,
      v_location_id,
      1,
      'published',
      'offer_definition_v1',
      COALESCE(NULLIF(p_offer_definition->>'offerType', ''), 'legacy_deal'),
      COALESCE(NULLIF(p_offer_definition->>'canonicalOfferSentence', ''), NULLIF(v_row->>'title', ''), 'Offer'),
      COALESCE(NULLIF(p_offer_definition->>'disclosureLine', ''), NULLIF(v_row->>'description', ''), 'Offer terms apply.'),
      p_offer_definition,
      COALESCE(NULLIF(p_offer_definition->>'perUserClaimLimit', '')::integer, 1),
      NULLIF(p_offer_definition->>'totalClaimLimit', '')::integer,
      NULLIF(v_row->>'start_time', '')::timestamptz,
      NULLIF(v_row->>'end_time', '')::timestamptz,
      NULLIF(COALESCE(p_offer_definition->>'timeZone', v_row->>'timezone'), '')
    )
    RETURNING id INTO v_offer_definition_id;

    INSERT INTO public.offer_versions (
      offer_definition_id,
      version_number,
      business_id,
      location_id,
      source_deal_id,
      schema_version,
      status,
      canonical_offer_sentence,
      disclosure_line,
      offer_snapshot,
      ad_spec,
      total_claim_limit,
      starts_at,
      ends_at,
      time_zone,
      published_at
    )
    VALUES (
      v_offer_definition_id,
      1,
      p_business_id,
      v_location_id,
      NULL,
      1,
      'published',
      COALESCE(NULLIF(p_offer_definition->>'canonicalOfferSentence', ''), NULLIF(v_row->>'title', ''), 'Offer'),
      COALESCE(NULLIF(p_offer_definition->>'disclosureLine', ''), NULLIF(v_row->>'description', ''), 'Offer terms apply.'),
      p_offer_definition || jsonb_build_object(
        'offerDefinitionId', v_offer_definition_id,
        'offerVersion', 1
      ),
      p_ad_spec,
      NULLIF(p_offer_definition->>'totalClaimLimit', '')::integer,
      NULLIF(v_row->>'start_time', '')::timestamptz,
      NULLIF(v_row->>'end_time', '')::timestamptz,
      NULLIF(COALESCE(p_offer_definition->>'timeZone', v_row->>'timezone'), ''),
      now()
    )
    RETURNING id INTO v_offer_version_id;

    INSERT INTO public.deals (
      business_id,
      title,
      description,
      source_locale,
      title_en,
      title_es,
      title_ko,
      description_en,
      description_es,
      description_ko,
      price,
      start_time,
      end_time,
      claim_cutoff_buffer_minutes,
      max_claims,
      is_active,
      poster_url,
      poster_storage_path,
      is_recurring,
      days_of_week,
      window_start_minutes,
      window_end_minutes,
      timezone,
      quality_tier,
      location_id,
      deal_status,
      eligibility_status,
      eligibility_reason_code,
      eligibility_message,
      customer_value_percent,
      deal_type,
      applies_to,
      discount_percent,
      required_purchase_quantity,
      free_item_quantity,
      required_item_description,
      required_item_retail_value_cents,
      free_item_description,
      free_item_retail_value_cents,
      free_item_discount_percent,
      item_description,
      item_retail_value_cents,
      offer_definition_id,
      offer_version_id
    )
    VALUES (
      p_business_id,
      COALESCE(NULLIF(v_row->>'title', ''), 'Offer'),
      NULLIF(v_row->>'description', ''),
      COALESCE(NULLIF(v_row->>'source_locale', ''), 'en'),
      NULLIF(v_row->>'title_en', ''),
      NULLIF(v_row->>'title_es', ''),
      NULLIF(v_row->>'title_ko', ''),
      NULLIF(v_row->>'description_en', ''),
      NULLIF(v_row->>'description_es', ''),
      NULLIF(v_row->>'description_ko', ''),
      NULLIF(v_row->>'price', '')::numeric,
      COALESCE(NULLIF(v_row->>'start_time', '')::timestamptz, now()),
      NULLIF(v_row->>'end_time', '')::timestamptz,
      COALESCE(NULLIF(v_row->>'claim_cutoff_buffer_minutes', '')::integer, 15),
      NULLIF(v_row->>'max_claims', '')::integer,
      COALESCE(NULLIF(v_row->>'is_active', '')::boolean, true),
      NULLIF(v_row->>'poster_url', ''),
      NULLIF(v_row->>'poster_storage_path', ''),
      COALESCE(NULLIF(v_row->>'is_recurring', '')::boolean, false),
      v_days_of_week,
      NULLIF(v_row->>'window_start_minutes', '')::integer,
      NULLIF(v_row->>'window_end_minutes', '')::integer,
      NULLIF(v_row->>'timezone', ''),
      NULLIF(v_row->>'quality_tier', ''),
      v_location_id,
      COALESCE(NULLIF(v_row->>'deal_status', ''), 'LIVE'),
      COALESCE(NULLIF(v_row->>'eligibility_status', ''), 'VALID'),
      NULLIF(v_row->>'eligibility_reason_code', ''),
      NULLIF(v_row->>'eligibility_message', ''),
      NULLIF(v_row->>'customer_value_percent', '')::numeric,
      NULLIF(v_row->>'deal_type', ''),
      NULLIF(v_row->>'applies_to', ''),
      NULLIF(v_row->>'discount_percent', '')::numeric,
      NULLIF(v_row->>'required_purchase_quantity', '')::integer,
      NULLIF(v_row->>'free_item_quantity', '')::integer,
      NULLIF(v_row->>'required_item_description', ''),
      NULLIF(v_row->>'required_item_retail_value_cents', '')::integer,
      NULLIF(v_row->>'free_item_description', ''),
      NULLIF(v_row->>'free_item_retail_value_cents', '')::integer,
      NULLIF(v_row->>'free_item_discount_percent', '')::numeric,
      NULLIF(v_row->>'item_description', ''),
      NULLIF(v_row->>'item_retail_value_cents', '')::integer,
      v_offer_definition_id,
      v_offer_version_id
    )
    RETURNING id INTO v_deal_id;

    UPDATE public.offer_definitions
    SET source_deal_id = v_deal_id,
        updated_at = now()
    WHERE id = v_offer_definition_id;

    UPDATE public.offer_versions
    SET source_deal_id = v_deal_id,
        offer_snapshot = offer_snapshot || jsonb_build_object('dealId', v_deal_id)
    WHERE id = v_offer_version_id;

    v_offer_definition_ids := array_append(v_offer_definition_ids, v_offer_definition_id);
    v_offer_version_ids := array_append(v_offer_version_ids, v_offer_version_id);
    v_deal_ids := array_append(v_deal_ids, v_deal_id);

    deal_id := v_deal_id;
    offer_definition_id := v_offer_definition_id;
    offer_version_id := v_offer_version_id;
    idempotency_replayed := false;
    RETURN NEXT;
  END LOOP;

  UPDATE public.publish_events
  SET status = 'published',
      offer_definition_ids = v_offer_definition_ids,
      offer_version_ids = v_offer_version_ids,
      deal_ids = v_deal_ids,
      published_at = now()
  WHERE id = v_event_id;
END;
$$;

REVOKE ALL ON FUNCTION public.publish_offer_versioned_deal(uuid, uuid, jsonb, jsonb, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.publish_offer_versioned_deal(uuid, uuid, jsonb, jsonb, text, jsonb)
  TO service_role;

COMMIT;
