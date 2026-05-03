-- Let business owners upload deal poster assets into their own bucket folder.
-- The app uploads to deal-photos/<business_id>/<filename> before AI generation
-- and before publishing a photo-backed deal.

INSERT INTO storage.buckets (id, name, public)
VALUES ('deal-photos', 'deal-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Business owners can upload deal photos" ON storage.objects;
CREATE POLICY "Business owners can upload deal photos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'deal-photos'
  AND EXISTS (
    SELECT 1
    FROM public.businesses b
    WHERE b.owner_id = auth.uid()
      AND b.id::text = split_part(storage.objects.name, '/', 1)
  )
);

DROP POLICY IF EXISTS "Business owners can update their deal photos" ON storage.objects;
CREATE POLICY "Business owners can update their deal photos"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'deal-photos'
  AND EXISTS (
    SELECT 1
    FROM public.businesses b
    WHERE b.owner_id = auth.uid()
      AND b.id::text = split_part(storage.objects.name, '/', 1)
  )
)
WITH CHECK (
  bucket_id = 'deal-photos'
  AND EXISTS (
    SELECT 1
    FROM public.businesses b
    WHERE b.owner_id = auth.uid()
      AND b.id::text = split_part(storage.objects.name, '/', 1)
  )
);

DROP POLICY IF EXISTS "Business owners can delete their deal photos" ON storage.objects;
CREATE POLICY "Business owners can delete their deal photos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'deal-photos'
  AND EXISTS (
    SELECT 1
    FROM public.businesses b
    WHERE b.owner_id = auth.uid()
      AND b.id::text = split_part(storage.objects.name, '/', 1)
  )
);

ALTER TABLE public.deal_templates
  ADD COLUMN IF NOT EXISTS poster_storage_path TEXT;

COMMENT ON COLUMN public.deal_templates.poster_storage_path IS
  'Path inside storage bucket deal-photos for reusable deal art.';
