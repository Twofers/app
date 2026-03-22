-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Businesses table (owned by auth users)
CREATE TABLE IF NOT EXISTS businesses (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(owner_id)
);

-- Deals table
CREATE TABLE IF NOT EXISTS deals (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT,
  price DECIMAL(10, 2),
  start_time TIMESTAMPTZ DEFAULT NOW(),
  end_time TIMESTAMPTZ NOT NULL,
  claim_cutoff_buffer_minutes INTEGER DEFAULT 30, -- Buffer before deal ends
  max_claims INTEGER, -- NULL = unlimited
  is_active BOOLEAN DEFAULT true,
  poster_url TEXT, -- Public URL for deal poster/ad
  ad_url TEXT, -- Alternative ad URL
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Deal claims table
CREATE TABLE IF NOT EXISTS deal_claims (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  deal_id UUID NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  redeemed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Favorites table
CREATE TABLE IF NOT EXISTS favorites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, business_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_deals_business_id ON deals(business_id);
CREATE INDEX IF NOT EXISTS idx_deals_end_time ON deals(end_time);
CREATE INDEX IF NOT EXISTS idx_deals_is_active ON deals(is_active);
CREATE INDEX IF NOT EXISTS idx_deal_claims_deal_id ON deal_claims(deal_id);
CREATE INDEX IF NOT EXISTS idx_deal_claims_user_id ON deal_claims(user_id);
CREATE INDEX IF NOT EXISTS idx_deal_claims_token ON deal_claims(token);
CREATE INDEX IF NOT EXISTS idx_deal_claims_expires_at ON deal_claims(expires_at);
CREATE INDEX IF NOT EXISTS idx_deal_claims_redeemed_at ON deal_claims(redeemed_at);
CREATE INDEX IF NOT EXISTS idx_favorites_user_id ON favorites(user_id);
CREATE INDEX IF NOT EXISTS idx_favorites_business_id ON favorites(business_id);

-- RLS Policies

-- Enable RLS
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE deals ENABLE ROW LEVEL SECURITY;
ALTER TABLE deal_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE favorites ENABLE ROW LEVEL SECURITY;

-- Businesses: Users can read all, but only insert/update their own
CREATE POLICY "Anyone can read businesses"
  ON businesses FOR SELECT
  USING (true);

CREATE POLICY "Users can insert their own business"
  ON businesses FOR INSERT
  WITH CHECK (auth.uid() = owner_id);

CREATE POLICY "Users can update their own business"
  ON businesses FOR UPDATE
  USING (auth.uid() = owner_id);

-- Deals: Customers can read active deals, businesses can manage their own
CREATE POLICY "Anyone can read active deals"
  ON deals FOR SELECT
  USING (is_active = true AND end_time > NOW());

CREATE POLICY "Businesses can read their own deals"
  ON deals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = deals.business_id
      AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Businesses can insert their own deals"
  ON deals FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = deals.business_id
      AND businesses.owner_id = auth.uid()
    )
  );

CREATE POLICY "Businesses can update their own deals"
  ON deals FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM businesses
      WHERE businesses.id = deals.business_id
      AND businesses.owner_id = auth.uid()
    )
  );

-- Deal claims: Users can read their own claims, businesses can read claims for their deals
CREATE POLICY "Users can read their own claims"
  ON deal_claims FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Businesses can read claims for their deals"
  ON deal_claims FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM deals
      JOIN businesses ON businesses.id = deals.business_id
      WHERE deals.id = deal_claims.deal_id
      AND businesses.owner_id = auth.uid()
    )
  );

-- Note: Insert/update of deal_claims should be done via Edge Functions only
-- We'll allow insert for now but Edge Function will validate
CREATE POLICY "Users can insert their own claims"
  ON deal_claims FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Businesses can update (redeem) claims for their deals
CREATE POLICY "Businesses can update claims for their deals"
  ON deal_claims FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM deals
      JOIN businesses ON businesses.id = deals.business_id
      WHERE deals.id = deal_claims.deal_id
      AND businesses.owner_id = auth.uid()
    )
  );

-- Favorites: Users can manage their own favorites
CREATE POLICY "Users can read their own favorites"
  ON favorites FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own favorites"
  ON favorites FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete their own favorites"
  ON favorites FOR DELETE
  USING (auth.uid() = user_id);
