-- Language for AI ad output and create-flow validation copy (en | es | ko). NULL = follow app UI locale on client.
ALTER TABLE IF EXISTS public.businesses
  ADD COLUMN IF NOT EXISTS preferred_locale TEXT;

COMMENT ON COLUMN public.businesses.preferred_locale IS 'en | es | ko — AI ad language & deal-quality messages; null = use consumer app locale';
