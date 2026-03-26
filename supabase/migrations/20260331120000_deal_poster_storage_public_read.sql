-- Stable storage path for deal art (optional; legacy rows still parse path from signed URLs in app).
ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS poster_storage_path TEXT;

COMMENT ON COLUMN public.deals.poster_storage_path IS
  'Path inside storage bucket deal-photos. When set, clients build a public object URL so images survive signed-URL expiry.';

-- Public read for deal artwork so authenticated consumers can load images with the anon key.
INSERT INTO storage.buckets (id, name, public)
VALUES ('deal-photos', 'deal-photos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "Public read deal-photos objects" ON storage.objects;
CREATE POLICY "Public read deal-photos objects"
ON storage.objects FOR SELECT
USING (bucket_id = 'deal-photos');
