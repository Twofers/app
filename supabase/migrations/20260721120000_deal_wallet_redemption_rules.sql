-- Deal eligibility, global wallet limit, exact-location redemption audit, and
-- business-level repeat-customer controls.
--
-- Drafted for the deal-wallet-redemption-rules work. Do not apply without Dan's
-- explicit migration approval.

BEGIN;

-- Deal eligibility / invalid draft metadata.
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS deal_status text NOT NULL DEFAULT 'LIVE',
  ADD COLUMN IF NOT EXISTS eligibility_status text NOT NULL DEFAULT 'UNKNOWN',
  ADD COLUMN IF NOT EXISTS eligibility_reason_code text,
  ADD COLUMN IF NOT EXISTS eligibility_message text,
  ADD COLUMN IF NOT EXISTS customer_value_percent numeric(5,2),
  ADD COLUMN IF NOT EXISTS deal_type text,
  ADD COLUMN IF NOT EXISTS applies_to text,
  ADD COLUMN IF NOT EXISTS discount_percent numeric(5,2),
  ADD COLUMN IF NOT EXISTS required_purchase_quantity integer,
  ADD COLUMN IF NOT EXISTS free_item_quantity integer,
  ADD COLUMN IF NOT EXISTS required_item_description text,
  ADD COLUMN IF NOT EXISTS required_item_retail_value_cents integer,
  ADD COLUMN IF NOT EXISTS free_item_description text,
  ADD COLUMN IF NOT EXISTS free_item_retail_value_cents integer,
  ADD COLUMN IF NOT EXISTS free_item_discount_percent numeric(5,2),
  ADD COLUMN IF NOT EXISTS item_description text,
  ADD COLUMN IF NOT EXISTS item_retail_value_cents integer,
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.business_locations(id) ON DELETE SET NULL;

ALTER TABLE public.deals
  DROP CONSTRAINT IF EXISTS deals_deal_status_check,
  ADD CONSTRAINT deals_deal_status_check
    CHECK (deal_status IN ('DRAFT', 'DRAFT_INVALID', 'READY', 'SCHEDULED', 'LIVE', 'PAUSED', 'ENDED')),
  DROP CONSTRAINT IF EXISTS deals_eligibility_status_check,
  ADD CONSTRAINT deals_eligibility_status_check
    CHECK (eligibility_status IN ('VALID', 'INVALID', 'UNKNOWN')),
  DROP CONSTRAINT IF EXISTS deals_deal_type_check,
  ADD CONSTRAINT deals_deal_type_check
    CHECK (
      deal_type IS NULL OR deal_type IN (
        'BUY_ONE_GET_ONE_FREE',
        'BUY_ONE_GET_SOMETHING_FREE',
        'PERCENT_OFF_SINGLE_ITEM'
      )
    ),
  DROP CONSTRAINT IF EXISTS deals_applies_to_check,
  ADD CONSTRAINT deals_applies_to_check
    CHECK (applies_to IS NULL OR applies_to IN ('SINGLE_ITEM', 'ENTIRE_ORDER', 'SECOND_ITEM')),
  DROP CONSTRAINT IF EXISTS deals_customer_value_percent_check,
  ADD CONSTRAINT deals_customer_value_percent_check
    CHECK (customer_value_percent IS NULL OR customer_value_percent >= 0),
  DROP CONSTRAINT IF EXISTS deals_discount_percent_check,
  ADD CONSTRAINT deals_discount_percent_check
    CHECK (discount_percent IS NULL OR (discount_percent >= 0 AND discount_percent <= 100)),
  DROP CONSTRAINT IF EXISTS deals_free_item_discount_percent_check,
  ADD CONSTRAINT deals_free_item_discount_percent_check
    CHECK (free_item_discount_percent IS NULL OR (free_item_discount_percent >= 0 AND free_item_discount_percent <= 100)),
  DROP CONSTRAINT IF EXISTS deals_item_values_positive_check,
  ADD CONSTRAINT deals_item_values_positive_check
    CHECK (
      (required_item_retail_value_cents IS NULL OR required_item_retail_value_cents > 0)
      AND (free_item_retail_value_cents IS NULL OR free_item_retail_value_cents > 0)
      AND (item_retail_value_cents IS NULL OR item_retail_value_cents > 0)
    ),
  DROP CONSTRAINT IF EXISTS deals_quantities_positive_check,
  ADD CONSTRAINT deals_quantities_positive_check
    CHECK (
      (required_purchase_quantity IS NULL OR required_purchase_quantity >= 1)
      AND (free_item_quantity IS NULL OR free_item_quantity >= 1)
    );

CREATE INDEX IF NOT EXISTS idx_deals_live_valid_feed
  ON public.deals (is_active, start_time, end_time)
  WHERE is_active = true
    AND deal_status = 'LIVE'
    AND eligibility_status IN ('VALID', 'UNKNOWN');

CREATE INDEX IF NOT EXISTS idx_deals_eligibility_status
  ON public.deals (business_id, deal_status, eligibility_status);

COMMENT ON COLUMN public.deals.deal_status
  IS 'DRAFT | DRAFT_INVALID | READY | SCHEDULED | LIVE | PAUSED | ENDED. Invalid drafts must not be active or customer-visible.';
COMMENT ON COLUMN public.deals.eligibility_status
  IS 'VALID | INVALID | UNKNOWN. New publish paths write VALID before a deal can go live.';
COMMENT ON COLUMN public.deals.customer_value_percent
  IS 'Computed customer value used by the Twofer deal eligibility validator.';

-- Business-level repeat-customer controls.
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS repeat_claim_policy_type text NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS repeat_claim_cooldown_days integer;

ALTER TABLE public.businesses
  DROP CONSTRAINT IF EXISTS businesses_repeat_claim_policy_type_check,
  ADD CONSTRAINT businesses_repeat_claim_policy_type_check
    CHECK (repeat_claim_policy_type IN ('NONE', 'COOLDOWN_DAYS', 'FOREVER')),
  DROP CONSTRAINT IF EXISTS businesses_repeat_claim_cooldown_days_check,
  ADD CONSTRAINT businesses_repeat_claim_cooldown_days_check
    CHECK (
      repeat_claim_cooldown_days IS NULL
      OR (repeat_claim_cooldown_days >= 1 AND repeat_claim_cooldown_days <= 3650)
    ),
  DROP CONSTRAINT IF EXISTS businesses_repeat_claim_policy_shape_check,
  ADD CONSTRAINT businesses_repeat_claim_policy_shape_check
    CHECK (
      (repeat_claim_policy_type = 'COOLDOWN_DAYS' AND repeat_claim_cooldown_days IS NOT NULL)
      OR (repeat_claim_policy_type IN ('NONE', 'FOREVER') AND repeat_claim_cooldown_days IS NULL)
    );

COMMENT ON COLUMN public.businesses.repeat_claim_policy_type
  IS 'NONE | COOLDOWN_DAYS | FOREVER. Enforced at claim time using redeemed claims only.';
COMMENT ON COLUMN public.businesses.repeat_claim_cooldown_days
  IS 'Cooldown length in whole days. Timer starts at the exact prior redemption timestamp.';

-- Claim copies for faster/auditable business and location checks.
ALTER TABLE public.deal_claims
  ADD COLUMN IF NOT EXISTS business_id uuid REFERENCES public.businesses(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.business_locations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS qr_token_hash text,
  ADD COLUMN IF NOT EXISTS released_at timestamptz,
  ADD COLUMN IF NOT EXISTS redeemed_by_business_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS redeemed_at_business_id uuid REFERENCES public.businesses(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS redeemed_at_location_id uuid REFERENCES public.business_locations(id) ON DELETE SET NULL;

UPDATE public.deal_claims dc
SET
  business_id = d.business_id,
  location_id = d.location_id
FROM public.deals d
WHERE d.id = dc.deal_id
  AND (dc.business_id IS NULL OR dc.location_id IS DISTINCT FROM d.location_id);

ALTER TABLE public.deal_claims
  ALTER COLUMN business_id SET NOT NULL,
  ALTER COLUMN token DROP NOT NULL,
  DROP CONSTRAINT IF EXISTS deal_claims_claim_status_check,
  ADD CONSTRAINT deal_claims_claim_status_check CHECK (
    claim_status IN ('active', 'redeeming', 'redeemed', 'expired', 'canceled', 'released')
  ),
  DROP CONSTRAINT IF EXISTS deal_claims_release_status_check,
  ADD CONSTRAINT deal_claims_release_status_check CHECK (
    (claim_status = 'released' AND released_at IS NOT NULL)
    OR claim_status <> 'released'
  ),
  DROP CONSTRAINT IF EXISTS deal_claims_redemption_audit_check,
  ADD CONSTRAINT deal_claims_redemption_audit_check CHECK (
    (claim_status = 'redeemed' AND redeemed_at IS NOT NULL)
    OR claim_status <> 'redeemed'
  );

CREATE INDEX IF NOT EXISTS idx_deal_claims_business_user_redeemed
  ON public.deal_claims (business_id, user_id, redeemed_at DESC)
  WHERE claim_status = 'redeemed' AND redeemed_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_deal_claims_user_active_global
  ON public.deal_claims (user_id, expires_at)
  WHERE claim_status IN ('active', 'redeeming');

CREATE INDEX IF NOT EXISTS idx_deal_claims_location_active
  ON public.deal_claims (location_id, claim_status)
  WHERE claim_status IN ('active', 'redeeming');

CREATE UNIQUE INDEX IF NOT EXISTS deal_claims_qr_token_hash_unique
  ON public.deal_claims (qr_token_hash)
  WHERE qr_token_hash IS NOT NULL;

-- Pre-check before adding the global one-active-wallet constraint.
DO $$
DECLARE
  v_dupes integer;
BEGIN
  SELECT count(*)
    INTO v_dupes
    FROM (
      SELECT user_id, count(*) AS n
      FROM public.deal_claims
      WHERE claim_status IN ('active', 'redeeming')
      GROUP BY user_id
      HAVING count(*) > 1
    ) AS dupes;

  IF v_dupes > 0 THEN
    RAISE EXCEPTION
      'Cannot create one-active-wallet index: % users have multiple active/redeeming claims. Expire or release stale rows before applying.',
      v_dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS deal_claims_one_active_wallet_claim_per_user
  ON public.deal_claims (user_id)
  WHERE claim_status IN ('active', 'redeeming');

COMMENT ON INDEX public.deal_claims_one_active_wallet_claim_per_user
  IS 'Global wallet constraint: one active/redeeming claim per customer across the app. Edge functions expire stale rows before insert.';
COMMENT ON COLUMN public.deal_claims.qr_token_hash
  IS 'SHA-256/base64url hash of the opaque QR token. Raw token should not be stored after this migration is active.';
COMMENT ON COLUMN public.deal_claims.released_at
  IS 'Set when a customer releases an unredeemed active claim from their wallet.';

-- Exact-location scanner binding and redemption audit.
ALTER TABLE public.redemption_devices
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.business_locations(id) ON DELETE SET NULL;

UPDATE public.redemption_devices rd
SET location_id = loc.id
FROM LATERAL (
  SELECT bl.id
  FROM public.business_locations bl
  WHERE bl.business_id = rd.business_id
  ORDER BY bl.created_at ASC
  LIMIT 1
) loc
WHERE rd.location_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_redemption_devices_location_active
  ON public.redemption_devices (business_id, location_id, active, removed_at);

ALTER TABLE public.redemptions
  ADD COLUMN IF NOT EXISTS location_id uuid REFERENCES public.business_locations(id) ON DELETE SET NULL;

UPDATE public.redemptions r
SET location_id = rd.location_id
FROM public.redemption_devices rd
WHERE rd.id = r.redemption_device_id
  AND r.location_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_redemptions_business_location_redeemed
  ON public.redemptions (business_id, location_id, redeemed_at DESC);

COMMENT ON COLUMN public.redemption_devices.location_id
  IS 'Exact location this scanner account may redeem for. No in-scanner switching in v1.';
COMMENT ON COLUMN public.redemptions.location_id
  IS 'Exact location where the claim was redeemed.';

COMMIT;
