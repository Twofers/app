-- Optional consumer-facing profile fields (hours & phone). Nullable for existing rows.
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS hours_text TEXT;

COMMENT ON COLUMN public.businesses.phone IS 'Optional public phone for maps / business profile';
COMMENT ON COLUMN public.businesses.hours_text IS 'Optional human-readable hours for business profile';
