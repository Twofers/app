-- Menu items table: stores business menu items extracted via AI or entered manually
CREATE TABLE menu_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  price DECIMAL(10,2),
  image_url TEXT,
  sort_order INTEGER DEFAULT 0,
  is_available BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE menu_items ENABLE ROW LEVEL SECURITY;

-- Business owners manage their own menu items
CREATE POLICY "menu_items_owner_all" ON menu_items FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = menu_items.business_id
        AND businesses.owner_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = menu_items.business_id
        AND businesses.owner_id = auth.uid()
    )
  );

-- Consumers can read available menu items (for deal context)
CREATE POLICY "menu_items_public_read" ON menu_items FOR SELECT
  USING (is_available = true);

CREATE INDEX idx_menu_items_business_id ON menu_items(business_id);
CREATE INDEX idx_menu_items_category ON menu_items(business_id, category);
