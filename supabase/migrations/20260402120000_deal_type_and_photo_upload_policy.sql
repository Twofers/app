-- Add structured deal_type column to deals.
-- Allowed values: 'bogo', 'buy2get1', 'free_item', 'percentage_off' (or NULL for legacy rows).
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS deal_type TEXT;

COMMENT ON COLUMN public.deals.deal_type IS
  'Structured deal type chosen at creation: bogo | buy2get1 | free_item | percentage_off. '
  'When set to a strong type (bogo/buy2get1/free_item) the text-based guardrail is bypassed.';

-- Update the guardrail trigger to honour explicit strong deal types.
-- Priority:
--   0. Explicit strong type (bogo/buy2get1/free_item) → always pass.
--   1–5. Existing text-based rules (free-item phrase, conditional discount, percent floor,
--         strong language, otherwise reject).
CREATE OR REPLACE FUNCTION public.enforce_strong_deal_only_guardrail()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- 0. Explicit structural types are inherently strong — bypass text check.
  IF NEW.deal_type IN ('bogo', 'buy2get1', 'free_item') THEN
    RETURN NEW;
  END IF;

  -- 1–5. Fall back to text-based guardrail for percentage_off and untyped legacy rows.
  IF NOT public.is_strong_deal_offer(NEW.title, NEW.description) THEN
    RAISE EXCEPTION
      'Every Twofer deal must be at least 40%% off or give something free — '
      'e.g. ''Buy a coffee, get a muffin free'' or ''2-for-1 lattes''. '
      'Conditional deals like ''buy X + 40%% off Y'' don''t qualify.';
  END IF;

  RETURN NEW;
END;
$$;

-- Re-attach trigger so deal_type changes also fire the check.
DROP TRIGGER IF EXISTS trg_enforce_strong_deal_only_guardrail ON public.deals;
CREATE TRIGGER trg_enforce_strong_deal_only_guardrail
BEFORE INSERT OR UPDATE OF title, description, deal_type ON public.deals
FOR EACH ROW
EXECUTE FUNCTION public.enforce_strong_deal_only_guardrail();

-- ── Storage: let business owners upload deal poster images ───────────────────
-- Bucket was created in migration 20260331; ensure it exists here too.
INSERT INTO storage.buckets (id, name, public)
VALUES ('deal-photos', 'deal-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Business owners may upload files whose path starts with their business UUID.
-- Path convention: {business_id}/{timestamp}.{ext}
DROP POLICY IF EXISTS "Business owners can upload deal photos" ON storage.objects;
CREATE POLICY "Business owners can upload deal photos"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'deal-photos'
  AND auth.uid() IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.businesses
    WHERE businesses.owner_id = auth.uid()
    AND businesses.id::text = split_part(name, '/', 1)
  )
);
