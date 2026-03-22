-- Add recurring window fields + defaults to deals (idempotent)
ALTER TABLE IF EXISTS deals
  ADD COLUMN IF NOT EXISTS is_recurring BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS days_of_week INTEGER[],
  ADD COLUMN IF NOT EXISTS window_start_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS window_end_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'America/Chicago';

-- Ensure claim_cutoff_buffer_minutes exists and defaults to 15
ALTER TABLE IF EXISTS deals
  ADD COLUMN IF NOT EXISTS claim_cutoff_buffer_minutes INTEGER NOT NULL DEFAULT 15;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'deals' AND column_name = 'claim_cutoff_buffer_minutes'
  ) THEN
    EXECUTE 'ALTER TABLE public.deals ALTER COLUMN claim_cutoff_buffer_minutes SET DEFAULT 15';
  END IF;
END
$$;

-- Ensure max_claims exists and defaults to 100
ALTER TABLE IF EXISTS deals
  ADD COLUMN IF NOT EXISTS max_claims INTEGER NOT NULL DEFAULT 100;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'deals' AND column_name = 'max_claims'
  ) THEN
    EXECUTE 'UPDATE public.deals SET max_claims = 100 WHERE max_claims IS NULL';
    EXECUTE 'ALTER TABLE public.deals ALTER COLUMN max_claims SET DEFAULT 100';
    EXECUTE 'ALTER TABLE public.deals ALTER COLUMN max_claims SET NOT NULL';
  END IF;
END
$$;

-- Ensure start_time exists and is not null
ALTER TABLE IF EXISTS deals
  ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ NOT NULL DEFAULT NOW();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'deals' AND column_name = 'start_time'
  ) THEN
    EXECUTE 'ALTER TABLE public.deals ALTER COLUMN start_time SET DEFAULT NOW()';
    EXECUTE 'ALTER TABLE public.deals ALTER COLUMN start_time SET NOT NULL';
  END IF;
END
$$;

-- Ensure end_time exists
ALTER TABLE IF EXISTS deals
  ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ;

-- Ensure common deal columns exist
ALTER TABLE IF EXISTS deals
  ADD COLUMN IF NOT EXISTS price DECIMAL(10, 2),
  ADD COLUMN IF NOT EXISTS poster_url TEXT,
  ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS title TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'deals' AND column_name = 'is_active'
  ) THEN
    EXECUTE 'ALTER TABLE public.deals ALTER COLUMN is_active SET DEFAULT true';
  END IF;
END
$$;

-- Ensure deal_claims has redeemed_at
ALTER TABLE IF EXISTS deal_claims
  ADD COLUMN IF NOT EXISTS redeemed_at TIMESTAMPTZ;

-- Ensure businesses.owner_id is NOT NULL
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'businesses' AND column_name = 'owner_id'
  ) THEN
    EXECUTE 'ALTER TABLE public.businesses ALTER COLUMN owner_id SET NOT NULL';
  END IF;
END
$$;

-- Templates table
CREATE TABLE IF NOT EXISTS deal_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  title TEXT,
  description TEXT,
  price DECIMAL(10, 2),
  poster_url TEXT,
  max_claims INTEGER NOT NULL DEFAULT 50,
  claim_cutoff_buffer_minutes INTEGER NOT NULL DEFAULT 15,
  is_recurring BOOLEAN NOT NULL DEFAULT false,
  days_of_week INTEGER[],
  window_start_minutes INTEGER,
  window_end_minutes INTEGER,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_deal_templates_business_id ON deal_templates(business_id);

ALTER TABLE deal_templates ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'deal_templates' AND policyname = 'Businesses can read their templates'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "Businesses can read their templates"
        ON deal_templates FOR SELECT
        USING (
          EXISTS (
            SELECT 1 FROM businesses
            WHERE businesses.id = deal_templates.business_id
            AND businesses.owner_id = auth.uid()
          )
        )
    $pol$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'deal_templates' AND policyname = 'Businesses can insert their templates'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "Businesses can insert their templates"
        ON deal_templates FOR INSERT
        WITH CHECK (
          EXISTS (
            SELECT 1 FROM businesses
            WHERE businesses.id = deal_templates.business_id
            AND businesses.owner_id = auth.uid()
          )
        )
    $pol$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'deal_templates' AND policyname = 'Businesses can update their templates'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "Businesses can update their templates"
        ON deal_templates FOR UPDATE
        USING (
          EXISTS (
            SELECT 1 FROM businesses
            WHERE businesses.id = deal_templates.business_id
            AND businesses.owner_id = auth.uid()
          )
        )
    $pol$;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'deal_templates' AND policyname = 'Businesses can delete their templates'
  ) THEN
    EXECUTE $pol$
      CREATE POLICY "Businesses can delete their templates"
        ON deal_templates FOR DELETE
        USING (
          EXISTS (
            SELECT 1 FROM businesses
            WHERE businesses.id = deal_templates.business_id
            AND businesses.owner_id = auth.uid()
          )
        )
    $pol$;
  END IF;
END
$$;
