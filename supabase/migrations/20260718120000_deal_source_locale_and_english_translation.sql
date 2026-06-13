-- Track the language a business owner used to create a deal and store all
-- customer-facing deal copy in English, Spanish, and Korean.
--
-- Existing rows are treated as English source because the previous schema used
-- `title` / `description` as canonical English copy and only stored es/ko
-- translations.

ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS source_locale TEXT NOT NULL DEFAULT 'en';
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS title_en TEXT;
ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS description_en TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'deals_source_locale_check'
  ) THEN
    ALTER TABLE public.deals
      ADD CONSTRAINT deals_source_locale_check
      CHECK (source_locale IN ('en', 'es', 'ko'));
  END IF;
END $$;

UPDATE public.deals
SET
  source_locale = COALESCE(NULLIF(source_locale, ''), 'en'),
  title_en = COALESCE(NULLIF(title_en, ''), title),
  description_en = COALESCE(NULLIF(description_en, ''), description)
WHERE
  source_locale IS DISTINCT FROM COALESCE(NULLIF(source_locale, ''), 'en')
  OR title_en IS NULL
  OR title_en = ''
  OR description_en IS NULL
  OR description_en = '';

COMMENT ON COLUMN public.deals.source_locale
  IS 'Owner source language for editable deal copy: en, es, or ko.';
COMMENT ON COLUMN public.deals.title_en
  IS 'Customer-facing English deal title. For English source deals this mirrors title.';
COMMENT ON COLUMN public.deals.description_en
  IS 'Customer-facing English deal description. For English source deals this mirrors description.';
