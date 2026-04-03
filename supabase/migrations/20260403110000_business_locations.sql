-- Business locations table: supports multi-location businesses
CREATE TABLE business_locations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  phone TEXT,
  hours_text TEXT,
  is_primary BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE business_locations ENABLE ROW LEVEL SECURITY;

-- Business owners manage their own locations
CREATE POLICY "business_locations_owner_all" ON business_locations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = business_locations.business_id
        AND businesses.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = business_locations.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- Anyone can read locations (for map/deal display)
CREATE POLICY "business_locations_public_read" ON business_locations FOR SELECT
  USING (true);

CREATE INDEX idx_business_locations_business_id ON business_locations(business_id);

-- Migrate existing business addresses to primary locations
INSERT INTO business_locations (business_id, name, address, latitude, longitude, phone, hours_text, is_primary)
SELECT
  id AS business_id,
  name AS name,
  COALESCE(address, 'Main Location') AS address,
  latitude,
  longitude,
  phone,
  hours_text,
  true AS is_primary
FROM businesses
WHERE address IS NOT NULL AND address != '';
