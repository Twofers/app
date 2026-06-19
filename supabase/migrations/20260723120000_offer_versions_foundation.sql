-- OfferDefinition / OfferVersion foundation for deterministic AI ad generation.
--
-- Drafted for the AI ad generation master plan. Do not apply without Dan's
-- explicit migration approval. This migration is intentionally additive:
-- existing deals, claims, and redemptions keep working while Edge Functions are
-- updated to write immutable offer versions on new publishes.

BEGIN;

CREATE TABLE IF NOT EXISTS public.offer_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.business_locations(id) ON DELETE SET NULL,
  source_deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  schema_version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft',
  source text NOT NULL DEFAULT 'offer_definition_v1',
  offer_type text NOT NULL,
  canonical_offer_sentence text NOT NULL,
  disclosure_line text NOT NULL,
  offer_definition jsonb NOT NULL,
  per_user_claim_limit integer NOT NULL DEFAULT 1,
  total_claim_limit integer,
  starts_at timestamptz,
  ends_at timestamptz,
  time_zone text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offer_definitions_schema_version_check CHECK (schema_version = 1),
  CONSTRAINT offer_definitions_status_check CHECK (
    status IN ('draft', 'ready', 'published', 'archived', 'legacy_snapshot')
  ),
  CONSTRAINT offer_definitions_source_check CHECK (
    source IN ('offer_definition_v1', 'legacy_deal_backfill')
  ),
  CONSTRAINT offer_definitions_offer_type_check CHECK (
    offer_type IN (
      'buy_one_get_one',
      'buy_one_get_reward_item',
      'percent_off_single_item',
      'legacy_deal'
    )
  ),
  CONSTRAINT offer_definitions_claim_limits_check CHECK (
    per_user_claim_limit >= 1
    AND (total_claim_limit IS NULL OR total_claim_limit > 0)
  ),
  CONSTRAINT offer_definitions_snapshot_object_check CHECK (
    jsonb_typeof(offer_definition) = 'object'
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS offer_definitions_source_deal_unique
  ON public.offer_definitions(source_deal_id)
  WHERE source_deal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_offer_definitions_business_created
  ON public.offer_definitions(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_offer_definitions_location_status
  ON public.offer_definitions(location_id, status);

CREATE TABLE IF NOT EXISTS public.offer_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_definition_id uuid NOT NULL REFERENCES public.offer_definitions(id) ON DELETE CASCADE,
  version_number integer NOT NULL,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  location_id uuid REFERENCES public.business_locations(id) ON DELETE SET NULL,
  source_deal_id uuid REFERENCES public.deals(id) ON DELETE SET NULL,
  schema_version integer NOT NULL DEFAULT 1,
  status text NOT NULL DEFAULT 'draft',
  canonical_offer_sentence text NOT NULL,
  disclosure_line text NOT NULL,
  offer_snapshot jsonb NOT NULL,
  total_claim_limit integer,
  starts_at timestamptz,
  ends_at timestamptz,
  time_zone text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offer_versions_schema_version_check CHECK (schema_version = 1),
  CONSTRAINT offer_versions_version_number_check CHECK (version_number >= 1),
  CONSTRAINT offer_versions_status_check CHECK (
    status IN ('draft', 'published', 'retired', 'legacy_snapshot')
  ),
  CONSTRAINT offer_versions_total_claim_limit_check CHECK (
    total_claim_limit IS NULL OR total_claim_limit > 0
  ),
  CONSTRAINT offer_versions_snapshot_object_check CHECK (
    jsonb_typeof(offer_snapshot) = 'object'
  ),
  UNIQUE (offer_definition_id, version_number)
);

CREATE UNIQUE INDEX IF NOT EXISTS offer_versions_source_deal_unique
  ON public.offer_versions(source_deal_id)
  WHERE source_deal_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_offer_versions_business_created
  ON public.offer_versions(business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_offer_versions_definition_status
  ON public.offer_versions(offer_definition_id, status);

ALTER TABLE public.offer_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offer_versions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.offer_definitions FROM anon, authenticated;
REVOKE ALL ON public.offer_versions FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON public.offer_definitions TO service_role;
GRANT SELECT, INSERT, UPDATE ON public.offer_versions TO service_role;

COMMENT ON TABLE public.offer_definitions IS
  'Authoritative draft/source offer facts. New publishes create immutable offer_versions from this table.';
COMMENT ON TABLE public.offer_versions IS
  'Immutable offer snapshots used by ads, claims, QR redemption, and analytics.';
COMMENT ON COLUMN public.offer_definitions.source_deal_id IS
  'Backfill bridge to the legacy deals row. New publish flow should create the offer first, then the deal.';
COMMENT ON COLUMN public.offer_versions.source_deal_id IS
  'Backfill bridge to the legacy deals row. One legacy deal maps to one version 1 snapshot.';

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS offer_definition_id uuid REFERENCES public.offer_definitions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS offer_version_id uuid REFERENCES public.offer_versions(id) ON DELETE SET NULL;

ALTER TABLE public.deal_claims
  ADD COLUMN IF NOT EXISTS offer_definition_id uuid REFERENCES public.offer_definitions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS offer_version_id uuid REFERENCES public.offer_versions(id) ON DELETE SET NULL;

ALTER TABLE public.redemptions
  ADD COLUMN IF NOT EXISTS offer_definition_id uuid REFERENCES public.offer_definitions(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS offer_version_id uuid REFERENCES public.offer_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deals_offer_version
  ON public.deals(offer_version_id)
  WHERE offer_version_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deal_claims_offer_version
  ON public.deal_claims(offer_version_id, claim_status)
  WHERE offer_version_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_redemptions_offer_version
  ON public.redemptions(offer_version_id, redeemed_at DESC)
  WHERE offer_version_id IS NOT NULL;

COMMENT ON COLUMN public.deals.offer_version_id IS
  'Immutable offer snapshot used by the published deal. Nullable during legacy backfill and staged rollout.';
COMMENT ON COLUMN public.deal_claims.offer_version_id IS
  'Immutable offer snapshot the customer claimed. Claim and QR validation should prefer this over mutable deals.';
COMMENT ON COLUMN public.redemptions.offer_version_id IS
  'Immutable offer snapshot redeemed by staff/merchant tools.';

WITH deal_snapshots AS (
  SELECT
    d.id AS deal_id,
    d.business_id,
    d.location_id,
    CASE d.deal_type
      WHEN 'BUY_ONE_GET_ONE_FREE' THEN 'buy_one_get_one'
      WHEN 'BUY_ONE_GET_SOMETHING_FREE' THEN 'buy_one_get_reward_item'
      WHEN 'PERCENT_OFF_SINGLE_ITEM' THEN 'percent_off_single_item'
      ELSE 'legacy_deal'
    END AS offer_type,
    COALESCE(NULLIF(trim(d.title), ''), 'Legacy offer') AS canonical_line,
    COALESCE(NULLIF(trim(d.description), ''), NULLIF(trim(d.title), ''), 'Legacy offer') AS disclosure_base,
    d.max_claims,
    d.start_time,
    d.end_time,
    d.timezone,
    d.deal_type,
    d.applies_to,
    d.discount_percent,
    d.required_purchase_quantity,
    d.free_item_quantity,
    d.required_item_description,
    d.free_item_description,
    d.free_item_discount_percent,
    d.item_description,
    d.customer_value_percent
  FROM public.deals d
),
prepared AS (
  SELECT
    ds.*,
    concat_ws(
      ' ',
      ds.disclosure_base,
      CASE
        WHEN ds.max_claims IS NOT NULL AND ds.max_claims > 0
          THEN format('Limited to %s available.', ds.max_claims)
        ELSE NULL
      END
    ) AS disclosure_line
  FROM deal_snapshots ds
)
INSERT INTO public.offer_definitions (
  business_id,
  location_id,
  source_deal_id,
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
SELECT
  p.business_id,
  p.location_id,
  p.deal_id,
  1,
  'legacy_snapshot',
  'legacy_deal_backfill',
  p.offer_type,
  p.canonical_line,
  p.disclosure_line,
  jsonb_strip_nulls(jsonb_build_object(
    'schemaVersion', 1,
    'status', 'legacy_snapshot',
    'source', 'legacy_deal_backfill',
    'dealId', p.deal_id,
    'merchantId', p.business_id,
    'locationId', p.location_id,
    'offerType', p.offer_type,
    'canonicalOfferLine', p.canonical_line,
    'canonicalOfferSentence', p.canonical_line,
    'disclosureLine', p.disclosure_line,
    'perUserClaimLimit', 1,
    'totalClaimLimit', p.max_claims,
    'startsAt', p.start_time,
    'endsAt', p.end_time,
    'timeZone', p.timezone,
    'dealEligibility', jsonb_strip_nulls(jsonb_build_object(
      'dealType', p.deal_type,
      'appliesTo', p.applies_to,
      'discountPercent', p.discount_percent,
      'requiredPurchaseQuantity', p.required_purchase_quantity,
      'freeItemQuantity', p.free_item_quantity,
      'requiredItemDescription', p.required_item_description,
      'freeItemDescription', p.free_item_description,
      'freeItemDiscountPercent', p.free_item_discount_percent,
      'itemDescription', p.item_description,
      'customerValuePercent', p.customer_value_percent
    ))
  )),
  1,
  CASE WHEN p.max_claims IS NOT NULL AND p.max_claims > 0 THEN p.max_claims ELSE NULL END,
  p.start_time,
  p.end_time,
  p.timezone
FROM prepared p
WHERE NOT EXISTS (
  SELECT 1 FROM public.offer_definitions od WHERE od.source_deal_id = p.deal_id
);

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
  total_claim_limit,
  starts_at,
  ends_at,
  time_zone,
  published_at
)
SELECT
  od.id,
  1,
  od.business_id,
  od.location_id,
  od.source_deal_id,
  od.schema_version,
  'legacy_snapshot',
  od.canonical_offer_sentence,
  od.disclosure_line,
  od.offer_definition || jsonb_build_object(
    'offerDefinitionId', od.id,
    'offerVersion', 1
  ),
  od.total_claim_limit,
  od.starts_at,
  od.ends_at,
  od.time_zone,
  od.created_at
FROM public.offer_definitions od
WHERE od.source_deal_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.offer_versions ov WHERE ov.source_deal_id = od.source_deal_id
  );

UPDATE public.deals d
SET
  offer_definition_id = od.id,
  offer_version_id = ov.id
FROM public.offer_definitions od
JOIN public.offer_versions ov
  ON ov.offer_definition_id = od.id
WHERE od.source_deal_id = d.id
  AND (d.offer_definition_id IS NULL OR d.offer_version_id IS NULL);

UPDATE public.deal_claims dc
SET
  offer_definition_id = d.offer_definition_id,
  offer_version_id = d.offer_version_id
FROM public.deals d
WHERE d.id = dc.deal_id
  AND (dc.offer_definition_id IS NULL OR dc.offer_version_id IS NULL);

UPDATE public.redemptions r
SET
  offer_definition_id = COALESCE(dc.offer_definition_id, d.offer_definition_id),
  offer_version_id = COALESCE(dc.offer_version_id, d.offer_version_id)
FROM public.deals d
LEFT JOIN public.deal_claims dc
  ON dc.id = r.claim_id
WHERE d.id = r.deal_id
  AND (r.offer_definition_id IS NULL OR r.offer_version_id IS NULL);

COMMIT;
