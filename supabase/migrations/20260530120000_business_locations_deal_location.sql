-- Multi-location foundation (billing v4): per-location rows + deal.location_id.
-- Menu library: soft-archive + optional description for manager UI.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS subscription_tier TEXT NOT NULL DEFAULT 'pro';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'businesses_subscription_tier_check'
  ) THEN
    ALTER TABLE public.businesses
      ADD CONSTRAINT businesses_subscription_tier_check
      CHECK (subscription_tier IN ('pro', 'premium'));
  END IF;
END $$;

COMMENT ON COLUMN public.businesses.subscription_tier IS 'pro = 1 location cap; premium = up to 3 (see billing handoff)';

CREATE TABLE IF NOT EXISTS public.business_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES public.businesses (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_business_locations_business_id
  ON public.business_locations (business_id);

ALTER TABLE public.business_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Owners can read their business locations"
  ON public.business_locations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_locations.business_id AND b.owner_id = auth.uid()
    )
  );

CREATE POLICY "Owners can insert their business locations"
  ON public.business_locations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_locations.business_id AND b.owner_id = auth.uid()
    )
  );

CREATE POLICY "Owners can update their business locations"
  ON public.business_locations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_locations.business_id AND b.owner_id = auth.uid()
    )
  );

CREATE POLICY "Owners can delete their business locations"
  ON public.business_locations FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_locations.business_id AND b.owner_id = auth.uid()
    )
  );

COMMENT ON TABLE public.business_locations IS 'Physical locations for a business; deals reference one location_id each.';

ALTER TABLE public.business_menu_items
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS description TEXT;

CREATE INDEX IF NOT EXISTS idx_business_menu_items_active
  ON public.business_menu_items (business_id, sort_order)
  WHERE archived_at IS NULL;

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES public.business_locations (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deals_location_id ON public.deals (location_id);

COMMENT ON COLUMN public.deals.location_id IS 'Store / pickup location for this deal (QR, copy, billing).';

INSERT INTO public.business_locations (business_id, name, address, phone, lat, lng)
SELECT
  b.id,
  COALESCE(NULLIF(trim(b.name), ''), 'Primary location'),
  COALESCE(
    NULLIF(trim(b.address), ''),
    NULLIF(trim(b.location), ''),
    'See business profile'
  ),
  NULLIF(trim(b.phone), ''),
  b.latitude,
  b.longitude
FROM public.businesses b
WHERE NOT EXISTS (
  SELECT 1 FROM public.business_locations bl WHERE bl.business_id = b.id
);

UPDATE public.deals d
SET location_id = sub.loc_id
FROM (
  SELECT DISTINCT ON (business_id)
    business_id,
    id AS loc_id
  FROM public.business_locations
  ORDER BY business_id, created_at ASC, id ASC
) sub
WHERE d.business_id = sub.business_id
  AND d.location_id IS NULL;

INSERT INTO public.business_locations (business_id, name, address)
SELECT b.id, 'Primary location', 'See business profile'
FROM public.businesses b
WHERE EXISTS (SELECT 1 FROM public.deals d WHERE d.business_id = b.id AND d.location_id IS NULL)
  AND NOT EXISTS (SELECT 1 FROM public.business_locations bl WHERE bl.business_id = b.id);

UPDATE public.deals d
SET location_id = (
  SELECT bl.id FROM public.business_locations bl
  WHERE bl.business_id = d.business_id
  ORDER BY bl.created_at ASC, bl.id ASC
  LIMIT 1
)
WHERE d.location_id IS NULL;
