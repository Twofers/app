-- Dev-only compatibility columns used by the offer-version legacy backfill.
-- These are inert defaults/placeholders for local AI Deal Studio testing.

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS deal_type text DEFAULT 'LEGACY_DEAL',
  ADD COLUMN IF NOT EXISTS applies_to text,
  ADD COLUMN IF NOT EXISTS discount_percent integer,
  ADD COLUMN IF NOT EXISTS required_purchase_quantity integer,
  ADD COLUMN IF NOT EXISTS free_item_quantity integer,
  ADD COLUMN IF NOT EXISTS required_item_description text,
  ADD COLUMN IF NOT EXISTS free_item_description text,
  ADD COLUMN IF NOT EXISTS free_item_discount_percent integer,
  ADD COLUMN IF NOT EXISTS item_description text,
  ADD COLUMN IF NOT EXISTS customer_value_percent integer;
