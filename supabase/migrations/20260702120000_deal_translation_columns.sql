-- Add translation columns for multilingual deal display (es = Spanish, ko = Korean).
-- English title/description remain canonical; these are populated asynchronously
-- by the ai-translate-deal edge function after publish.

ALTER TABLE deals ADD COLUMN IF NOT EXISTS title_es TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS title_ko TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS description_es TEXT;
ALTER TABLE deals ADD COLUMN IF NOT EXISTS description_ko TEXT;
