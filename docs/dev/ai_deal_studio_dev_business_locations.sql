-- Dev-only business location foundation for AI Deal Studio testing.
-- This keeps owner/location and deal location support without paid-plan columns.

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

DROP POLICY IF EXISTS "Owners can read their business locations" ON public.business_locations;
CREATE POLICY "Owners can read their business locations"
  ON public.business_locations FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_locations.business_id AND b.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners can insert their business locations" ON public.business_locations;
CREATE POLICY "Owners can insert their business locations"
  ON public.business_locations FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_locations.business_id AND b.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners can update their business locations" ON public.business_locations;
CREATE POLICY "Owners can update their business locations"
  ON public.business_locations FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_locations.business_id AND b.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Owners can delete their business locations" ON public.business_locations;
CREATE POLICY "Owners can delete their business locations"
  ON public.business_locations FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.businesses b
      WHERE b.id = business_locations.business_id AND b.owner_id = auth.uid()
    )
  );

ALTER TABLE public.business_menu_items
  ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS description TEXT;

CREATE INDEX IF NOT EXISTS idx_business_menu_items_active
  ON public.business_menu_items (business_id, sort_order)
  WHERE archived_at IS NULL;

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS location_id UUID REFERENCES public.business_locations (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_deals_location_id ON public.deals (location_id);

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
