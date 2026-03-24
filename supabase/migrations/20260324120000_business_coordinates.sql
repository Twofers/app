-- Optional WGS84 coordinates for distance sorting / future map (nullable).

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS latitude DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS longitude DOUBLE PRECISION;

COMMENT ON COLUMN public.businesses.latitude IS 'Optional WGS84 latitude for distance / maps';
COMMENT ON COLUMN public.businesses.longitude IS 'Optional WGS84 longitude for distance / maps';
