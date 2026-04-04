-- Add logo_url column for business logo images.
ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

COMMENT ON COLUMN public.businesses.logo_url IS
  'Public URL or storage path for the business logo image.';

-- Public read bucket for business logos.
INSERT INTO storage.buckets (id, name, public)
VALUES ('business-logos', 'business-logos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Public read business-logos objects" ON storage.objects;
CREATE POLICY "Public read business-logos objects"
ON storage.objects FOR SELECT
USING (bucket_id = 'business-logos');

DROP POLICY IF EXISTS "Business owner upload logo" ON storage.objects;
CREATE POLICY "Business owner upload logo"
ON storage.objects FOR INSERT
WITH CHECK (
  bucket_id = 'business-logos'
  AND auth.uid() IS NOT NULL
);

DROP POLICY IF EXISTS "Business owner update logo" ON storage.objects;
CREATE POLICY "Business owner update logo"
ON storage.objects FOR UPDATE
USING (
  bucket_id = 'business-logos'
  AND auth.uid() IS NOT NULL
);
