-- For future ranking / notification eligibility (strong vs acceptable). Weak deals never inserted.
ALTER TABLE IF EXISTS public.deals
  ADD COLUMN IF NOT EXISTS quality_tier TEXT;

COMMENT ON COLUMN public.deals.quality_tier IS 'strong | acceptable — set at publish from client heuristics; null for legacy rows';
