-- Consumer profiles (Supabase-backed; complements auth.users)
CREATE TABLE IF NOT EXISTS public.consumer_profiles (
  user_id UUID PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
  zip_code TEXT NOT NULL,
  age_range TEXT NOT NULL,
  gender TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT consumer_profiles_age_range_check CHECK (
    age_range IN (
      'under_18',
      '18_24',
      '25_34',
      '35_44',
      '45_54',
      '55_64',
      '65_plus'
    )
  ),
  CONSTRAINT consumer_profiles_gender_check CHECK (
    gender IS NULL
    OR gender IN ('female', 'male', 'non_binary', 'prefer_not', 'other')
  )
);

COMMENT ON TABLE public.consumer_profiles IS 'Shopper profile; one row per auth user who completes consumer setup.';

CREATE INDEX IF NOT EXISTS idx_consumer_profiles_zip ON public.consumer_profiles (zip_code);

ALTER TABLE public.consumer_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "consumer_profiles_select_own"
  ON public.consumer_profiles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "consumer_profiles_insert_own"
  ON public.consumer_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "consumer_profiles_update_own"
  ON public.consumer_profiles FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Business contact & public fields (nullable for legacy rows)
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS contact_name TEXT,
  ADD COLUMN IF NOT EXISTS business_email TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT;

COMMENT ON COLUMN public.businesses.contact_name IS 'Owner or primary contact name';
COMMENT ON COLUMN public.businesses.business_email IS 'Public business email for customers';
COMMENT ON COLUMN public.businesses.address IS 'Street or full address for profile and maps';
