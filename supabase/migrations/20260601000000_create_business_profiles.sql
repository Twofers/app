-- Create the business_profiles table.
-- This table holds per-business subscription/billing state and a thin
-- denormalised copy of key profile fields used by billing v4 RLS policies
-- and the client-side business-profile-access helper.
--
-- NOTE: Later migrations (billing_v4, enforce_business_locations_cap, etc.)
-- ALTER TABLE and CREATE POLICY against this table.  This migration must run
-- BEFORE any of them.

CREATE TABLE IF NOT EXISTS public.business_profiles (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  owner_id    uuid        UNIQUE REFERENCES auth.users (id) ON DELETE CASCADE,
  name        text,
  address     text,
  category    text,
  setup_completed boolean DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- Ensure at least one ownership key is set.
  CONSTRAINT business_profiles_has_owner
    CHECK (user_id IS NOT NULL OR owner_id IS NOT NULL)
);

COMMENT ON TABLE public.business_profiles
  IS 'Per-business billing / subscription profile. Canonical source for subscription_status and subscription_tier (billing v4).';

-- Indexes for the two ownership lookup patterns used by the app.
CREATE INDEX IF NOT EXISTS idx_business_profiles_user_id
  ON public.business_profiles (user_id);

CREATE INDEX IF NOT EXISTS idx_business_profiles_owner_id
  ON public.business_profiles (owner_id);

-- Row Level Security ---------------------------------------------------------
ALTER TABLE public.business_profiles ENABLE ROW LEVEL SECURITY;

-- SELECT: business owners can read their own profile row.
CREATE POLICY "business_profiles_select_own"
  ON public.business_profiles FOR SELECT
  USING (auth.uid() = user_id OR auth.uid() = owner_id);

-- INSERT: authenticated users can create their own profile row.
CREATE POLICY "business_profiles_insert_own"
  ON public.business_profiles FOR INSERT
  WITH CHECK (auth.uid() = user_id OR auth.uid() = owner_id);

-- UPDATE: business owners can update their own profile row.
CREATE POLICY "business_profiles_update_own"
  ON public.business_profiles FOR UPDATE
  USING (auth.uid() = user_id OR auth.uid() = owner_id)
  WITH CHECK (auth.uid() = user_id OR auth.uid() = owner_id);
