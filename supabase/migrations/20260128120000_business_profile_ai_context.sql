-- Optional fields for AI ad context and future profile (nullable — never blocks MVP flows)
ALTER TABLE IF EXISTS public.businesses
  ADD COLUMN IF NOT EXISTS category TEXT,
  ADD COLUMN IF NOT EXISTS tone TEXT,
  ADD COLUMN IF NOT EXISTS location TEXT,
  ADD COLUMN IF NOT EXISTS short_description TEXT;

COMMENT ON COLUMN public.businesses.category IS 'e.g. Coffee shop, bakery — optional, improves AI ads';
COMMENT ON COLUMN public.businesses.tone IS 'e.g. friendly, local, premium — optional';
COMMENT ON COLUMN public.businesses.location IS 'City, neighborhood, or address hint — optional';
COMMENT ON COLUMN public.businesses.short_description IS '1–2 sentences about the business — optional';
