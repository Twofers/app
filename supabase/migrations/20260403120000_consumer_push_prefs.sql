-- Server-side consumer location + notification preferences for push targeting.
-- Edge function "send-deal-push" uses these to find consumers within radius or by favorites.

ALTER TABLE public.consumer_profiles
  ADD COLUMN IF NOT EXISTS last_latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS last_longitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS notification_mode TEXT NOT NULL DEFAULT 'all_nearby',
  ADD COLUMN IF NOT EXISTS radius_miles INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS location_updated_at TIMESTAMPTZ;

ALTER TABLE public.consumer_profiles
  DROP CONSTRAINT IF EXISTS consumer_profiles_notification_mode_check;

ALTER TABLE public.consumer_profiles
  ADD CONSTRAINT consumer_profiles_notification_mode_check CHECK (
    notification_mode IN ('all_nearby', 'favorites_only', 'none')
  );

ALTER TABLE public.consumer_profiles
  DROP CONSTRAINT IF EXISTS consumer_profiles_radius_miles_check;

ALTER TABLE public.consumer_profiles
  ADD CONSTRAINT consumer_profiles_radius_miles_check CHECK (
    radius_miles IN (1, 3, 5, 10)
  );

CREATE INDEX IF NOT EXISTS idx_consumer_profiles_location
  ON public.consumer_profiles (last_latitude, last_longitude)
  WHERE last_latitude IS NOT NULL AND last_longitude IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_consumer_profiles_notification_mode
  ON public.consumer_profiles (notification_mode)
  WHERE notification_mode != 'none';
