-- Server-side revise path for an ALREADY PUBLISHED OfferVersion deal.
--
-- Drafted for the regenerated-ad-never-reaches-the-live-deal fix. Do not apply
-- without Dan's explicit migration approval. Depends on:
-- - 20260723120000_offer_versions_foundation.sql
-- - 20260724120000_offer_version_publish_rpc.sql
--
-- Why this exists: publish_offer_versioned_deal only INSERTs. The merchant "Edit
-- deal" flow therefore had no way to persist regenerated creative — it fell back
-- to a plain UPDATE on public.deals, which cannot touch offer_versions.ad_spec,
-- and the customer poster projection reads the spec through
-- deals.offer_version_id. A merchant could regenerate an ad, see the new creative
-- in the editor preview, save successfully, and have the live deal keep the old
-- poster forever.
--
-- Shape of a revision:
-- - The offer DEFINITION is the mutable source of record, so it is updated in
--   place with the merchant's current facts.
-- - A NEW immutable offer_versions row is appended (version_number = max + 1)
--   carrying the newly approved ad_spec.
-- - public.deals is repointed at that new version in the same transaction as the
--   listing/schedule column writes, so "save succeeded" and "the live creative
--   changed" can no longer disagree.
--
-- Two deliberate non-actions:
-- - The previous version is NOT retired. Outstanding deal_claims and redemptions
--   reference it by id and must keep resolving to the exact terms the customer
--   claimed under.
-- - The new version's source_deal_id stays NULL. That column is the legacy
--   backfill bridge and carries a unique index (offer_versions_source_deal_unique),
--   so exactly one version per deal may claim it; deals.offer_version_id is the
--   real pointer to the current version.

BEGIN;

CREATE OR REPLACE FUNCTION public.revise_offer_versioned_deal(
  p_business_id uuid,
  p_owner_user_id uuid,
  p_deal_id uuid,
  p_offer_definition jsonb,
  p_deal_row jsonb,
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
  v_deal public.deals%ROWTYPE;
  v_row jsonb := p_deal_row;
  v_row_business_id uuid;
  v_location_id uuid;
  v_offer_definition_id uuid;
  v_offer_version_id uuid;
  v_version_number integer;
  v_ad_spec jsonb;
  v_canonical_sentence text;
  v_disclosure_line text;
  v_days_of_week integer[];
  v_has_days_of_week boolean := false;
  v_i integer;
BEGIN
  IF p_business_id IS NULL OR p_owner_user_id IS NULL THEN
    RAISE EXCEPTION 'Missing business or owner id' USING ERRCODE = '22023';
  END IF;

  IF p_deal_id IS NULL THEN
    RAISE EXCEPTION 'Missing deal id' USING ERRCODE = '22023';
  END IF;

  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) < 12 THEN
    RAISE EXCEPTION 'Missing idempotency key' USING ERRCODE = '22023';
  END IF;

  IF p_offer_definition IS NULL OR jsonb_typeof(p_offer_definition) <> 'object' THEN
    RAISE EXCEPTION 'Offer definition must be a JSON object' USING ERRCODE = '22023';
  END IF;

  IF v_row IS NULL OR jsonb_typeof(v_row) <> 'object' THEN
    RAISE EXCEPTION 'Deal row must be a JSON object' USING ERRCODE = '22023';
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

  v_row_business_id := NULLIF(v_row->>'business_id', '')::uuid;
  IF v_row_business_id IS NOT NULL AND v_row_business_id IS DISTINCT FROM p_business_id THEN
    RAISE EXCEPTION 'Deal row business does not match owner business' USING ERRCODE = '42501';
  END IF;

  -- Lock the deal for the life of the transaction: the version append and the
  -- repoint below must not interleave with a second save of the same deal.
  SELECT d.*
  INTO v_deal
  FROM public.deals d
  WHERE d.id = p_deal_id
    AND d.business_id = p_business_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deal not found for business' USING ERRCODE = '42501';
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
    'offer_version_revise_v1',
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

  IF jsonb_typeof(v_row->'days_of_week') = 'array' THEN
    v_has_days_of_week := true;
    SELECT array_agg(value::integer ORDER BY ordinality)
    INTO v_days_of_week
    FROM jsonb_array_elements_text(v_row->'days_of_week') WITH ORDINALITY;
  ELSIF v_row ? 'days_of_week' THEN
    -- Present and null: a one-time deal clearing a previous recurring schedule.
    v_has_days_of_week := true;
    v_days_of_week := NULL;
  END IF;

  v_location_id := COALESCE(NULLIF(v_row->>'location_id', '')::uuid, v_deal.location_id);

  v_canonical_sentence := COALESCE(
    NULLIF(p_offer_definition->>'canonicalOfferSentence', ''),
    NULLIF(v_row->>'title', ''),
    NULLIF(v_deal.title, ''),
    'Offer'
  );
  v_disclosure_line := COALESCE(
    NULLIF(p_offer_definition->>'disclosureLine', ''),
    NULLIF(v_row->>'description', ''),
    NULLIF(v_deal.description, ''),
    'Offer terms apply.'
  );

  -- The definition is the mutable source of record for this offer; refresh it in
  -- place when the deal already has one, so every version keeps hanging off a
  -- single definition row per offer.
  IF v_deal.offer_definition_id IS NOT NULL THEN
    UPDATE public.offer_definitions od
    SET location_id = v_location_id,
        status = 'published',
        offer_type = COALESCE(NULLIF(p_offer_definition->>'offerType', ''), od.offer_type),
        canonical_offer_sentence = v_canonical_sentence,
        disclosure_line = v_disclosure_line,
        offer_definition = p_offer_definition,
        per_user_claim_limit = COALESCE(NULLIF(p_offer_definition->>'perUserClaimLimit', '')::integer, od.per_user_claim_limit),
        total_claim_limit = NULLIF(p_offer_definition->>'totalClaimLimit', '')::integer,
        starts_at = COALESCE(NULLIF(v_row->>'start_time', '')::timestamptz, od.starts_at),
        ends_at = COALESCE(NULLIF(v_row->>'end_time', '')::timestamptz, od.ends_at),
        time_zone = NULLIF(COALESCE(p_offer_definition->>'timeZone', v_row->>'timezone'), ''),
        updated_at = now()
    WHERE od.id = v_deal.offer_definition_id
      AND od.business_id = p_business_id
    RETURNING od.id INTO v_offer_definition_id;
  END IF;

  -- Deals published before the OfferVersion rollout (or whose definition was
  -- detached) get one created now. source_deal_id stays NULL: the backfill may
  -- already hold a row pointing at this deal, and that column is uniquely indexed.
  IF v_offer_definition_id IS NULL THEN
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
      v_canonical_sentence,
      v_disclosure_line,
      p_offer_definition,
      COALESCE(NULLIF(p_offer_definition->>'perUserClaimLimit', '')::integer, 1),
      NULLIF(p_offer_definition->>'totalClaimLimit', '')::integer,
      COALESCE(NULLIF(v_row->>'start_time', '')::timestamptz, v_deal.start_time),
      COALESCE(NULLIF(v_row->>'end_time', '')::timestamptz, v_deal.end_time),
      NULLIF(COALESCE(p_offer_definition->>'timeZone', v_row->>'timezone'), '')
    )
    RETURNING id INTO v_offer_definition_id;
  END IF;

  SELECT COALESCE(MAX(ov.version_number), 0) + 1
  INTO v_version_number
  FROM public.offer_versions ov
  WHERE ov.offer_definition_id = v_offer_definition_id;

  -- A revision that carries no new creative keeps the one already live. Without
  -- this the poster projection (which requires a poster_v1 ad_spec on the deal's
  -- current version) would go dark the moment a merchant edited a schedule.
  v_ad_spec := p_ad_spec;
  IF v_ad_spec IS NULL AND v_deal.offer_version_id IS NOT NULL THEN
    SELECT ov.ad_spec
    INTO v_ad_spec
    FROM public.offer_versions ov
    WHERE ov.id = v_deal.offer_version_id;
  END IF;

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
    v_version_number,
    p_business_id,
    v_location_id,
    NULL,
    1,
    'published',
    v_canonical_sentence,
    v_disclosure_line,
    p_offer_definition || jsonb_build_object(
      'offerDefinitionId', v_offer_definition_id,
      'offerVersion', v_version_number,
      'dealId', p_deal_id
    ),
    v_ad_spec,
    NULLIF(p_offer_definition->>'totalClaimLimit', '')::integer,
    COALESCE(NULLIF(v_row->>'start_time', '')::timestamptz, v_deal.start_time),
    COALESCE(NULLIF(v_row->>'end_time', '')::timestamptz, v_deal.end_time),
    NULLIF(COALESCE(p_offer_definition->>'timeZone', v_row->>'timezone'), ''),
    now()
  )
  RETURNING id INTO v_offer_version_id;

  -- Every column is written only when the caller actually sent the key, so a
  -- partial deal row leaves the rest of the live deal untouched. An explicit
  -- null in the payload still clears the column (e.g. days_of_week when a
  -- recurring deal becomes one-time).
  UPDATE public.deals d
  SET
    title = CASE WHEN v_row ? 'title' THEN COALESCE(NULLIF(v_row->>'title', ''), d.title) ELSE d.title END,
    description = CASE WHEN v_row ? 'description' THEN NULLIF(v_row->>'description', '') ELSE d.description END,
    source_locale = CASE WHEN v_row ? 'source_locale' THEN COALESCE(NULLIF(v_row->>'source_locale', ''), d.source_locale) ELSE d.source_locale END,
    title_en = CASE WHEN v_row ? 'title_en' THEN NULLIF(v_row->>'title_en', '') ELSE d.title_en END,
    title_es = CASE WHEN v_row ? 'title_es' THEN NULLIF(v_row->>'title_es', '') ELSE d.title_es END,
    title_ko = CASE WHEN v_row ? 'title_ko' THEN NULLIF(v_row->>'title_ko', '') ELSE d.title_ko END,
    description_en = CASE WHEN v_row ? 'description_en' THEN NULLIF(v_row->>'description_en', '') ELSE d.description_en END,
    description_es = CASE WHEN v_row ? 'description_es' THEN NULLIF(v_row->>'description_es', '') ELSE d.description_es END,
    description_ko = CASE WHEN v_row ? 'description_ko' THEN NULLIF(v_row->>'description_ko', '') ELSE d.description_ko END,
    price = CASE WHEN v_row ? 'price' THEN NULLIF(v_row->>'price', '')::numeric ELSE d.price END,
    start_time = CASE WHEN v_row ? 'start_time' THEN COALESCE(NULLIF(v_row->>'start_time', '')::timestamptz, d.start_time) ELSE d.start_time END,
    end_time = CASE WHEN v_row ? 'end_time' THEN COALESCE(NULLIF(v_row->>'end_time', '')::timestamptz, d.end_time) ELSE d.end_time END,
    claim_cutoff_buffer_minutes = CASE WHEN v_row ? 'claim_cutoff_buffer_minutes' THEN COALESCE(NULLIF(v_row->>'claim_cutoff_buffer_minutes', '')::integer, d.claim_cutoff_buffer_minutes) ELSE d.claim_cutoff_buffer_minutes END,
    max_claims = CASE WHEN v_row ? 'max_claims' THEN NULLIF(v_row->>'max_claims', '')::integer ELSE d.max_claims END,
    is_active = CASE WHEN v_row ? 'is_active' THEN COALESCE(NULLIF(v_row->>'is_active', '')::boolean, d.is_active) ELSE d.is_active END,
    poster_url = CASE WHEN v_row ? 'poster_url' THEN NULLIF(v_row->>'poster_url', '') ELSE d.poster_url END,
    poster_storage_path = CASE WHEN v_row ? 'poster_storage_path' THEN NULLIF(v_row->>'poster_storage_path', '') ELSE d.poster_storage_path END,
    is_recurring = CASE WHEN v_row ? 'is_recurring' THEN COALESCE(NULLIF(v_row->>'is_recurring', '')::boolean, d.is_recurring) ELSE d.is_recurring END,
    days_of_week = CASE WHEN v_has_days_of_week THEN v_days_of_week ELSE d.days_of_week END,
    window_start_minutes = CASE WHEN v_row ? 'window_start_minutes' THEN NULLIF(v_row->>'window_start_minutes', '')::integer ELSE d.window_start_minutes END,
    window_end_minutes = CASE WHEN v_row ? 'window_end_minutes' THEN NULLIF(v_row->>'window_end_minutes', '')::integer ELSE d.window_end_minutes END,
    timezone = CASE WHEN v_row ? 'timezone' THEN NULLIF(v_row->>'timezone', '') ELSE d.timezone END,
    quality_tier = CASE WHEN v_row ? 'quality_tier' THEN NULLIF(v_row->>'quality_tier', '') ELSE d.quality_tier END,
    location_id = v_location_id,
    deal_status = CASE WHEN v_row ? 'deal_status' THEN COALESCE(NULLIF(v_row->>'deal_status', ''), d.deal_status) ELSE d.deal_status END,
    eligibility_status = CASE WHEN v_row ? 'eligibility_status' THEN COALESCE(NULLIF(v_row->>'eligibility_status', ''), d.eligibility_status) ELSE d.eligibility_status END,
    eligibility_reason_code = CASE WHEN v_row ? 'eligibility_reason_code' THEN NULLIF(v_row->>'eligibility_reason_code', '') ELSE d.eligibility_reason_code END,
    eligibility_message = CASE WHEN v_row ? 'eligibility_message' THEN NULLIF(v_row->>'eligibility_message', '') ELSE d.eligibility_message END,
    customer_value_percent = CASE WHEN v_row ? 'customer_value_percent' THEN NULLIF(v_row->>'customer_value_percent', '')::numeric ELSE d.customer_value_percent END,
    deal_type = CASE WHEN v_row ? 'deal_type' THEN NULLIF(v_row->>'deal_type', '') ELSE d.deal_type END,
    applies_to = CASE WHEN v_row ? 'applies_to' THEN NULLIF(v_row->>'applies_to', '') ELSE d.applies_to END,
    discount_percent = CASE WHEN v_row ? 'discount_percent' THEN NULLIF(v_row->>'discount_percent', '')::numeric ELSE d.discount_percent END,
    required_purchase_quantity = CASE WHEN v_row ? 'required_purchase_quantity' THEN NULLIF(v_row->>'required_purchase_quantity', '')::integer ELSE d.required_purchase_quantity END,
    free_item_quantity = CASE WHEN v_row ? 'free_item_quantity' THEN NULLIF(v_row->>'free_item_quantity', '')::integer ELSE d.free_item_quantity END,
    required_item_description = CASE WHEN v_row ? 'required_item_description' THEN NULLIF(v_row->>'required_item_description', '') ELSE d.required_item_description END,
    required_item_retail_value_cents = CASE WHEN v_row ? 'required_item_retail_value_cents' THEN NULLIF(v_row->>'required_item_retail_value_cents', '')::integer ELSE d.required_item_retail_value_cents END,
    free_item_description = CASE WHEN v_row ? 'free_item_description' THEN NULLIF(v_row->>'free_item_description', '') ELSE d.free_item_description END,
    free_item_retail_value_cents = CASE WHEN v_row ? 'free_item_retail_value_cents' THEN NULLIF(v_row->>'free_item_retail_value_cents', '')::integer ELSE d.free_item_retail_value_cents END,
    free_item_discount_percent = CASE WHEN v_row ? 'free_item_discount_percent' THEN NULLIF(v_row->>'free_item_discount_percent', '')::numeric ELSE d.free_item_discount_percent END,
    item_description = CASE WHEN v_row ? 'item_description' THEN NULLIF(v_row->>'item_description', '') ELSE d.item_description END,
    item_retail_value_cents = CASE WHEN v_row ? 'item_retail_value_cents' THEN NULLIF(v_row->>'item_retail_value_cents', '')::integer ELSE d.item_retail_value_cents END,
    offer_definition_id = v_offer_definition_id,
    offer_version_id = v_offer_version_id,
    updated_at = now()
  WHERE d.id = p_deal_id
    AND d.business_id = p_business_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Deal not found for business' USING ERRCODE = '42501';
  END IF;

  UPDATE public.publish_events
  SET status = 'published',
      offer_definition_ids = ARRAY[v_offer_definition_id],
      offer_version_ids = ARRAY[v_offer_version_id],
      deal_ids = ARRAY[p_deal_id],
      published_at = now()
  WHERE id = v_event_id;

  deal_id := p_deal_id;
  offer_definition_id := v_offer_definition_id;
  offer_version_id := v_offer_version_id;
  idempotency_replayed := false;
  RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION public.revise_offer_versioned_deal(uuid, uuid, uuid, jsonb, jsonb, text, jsonb) IS
  'Appends a new published offer version to an existing deal and repoints the deal at it, so regenerated creative reaches live customers atomically.';

REVOKE ALL ON FUNCTION public.revise_offer_versioned_deal(uuid, uuid, uuid, jsonb, jsonb, text, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revise_offer_versioned_deal(uuid, uuid, uuid, jsonb, jsonb, text, jsonb)
  TO service_role;

COMMIT;
