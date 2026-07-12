-- Tighten write access on the public `business-logos` storage bucket.
--
-- The original bucket policies (20260704120000_business_logo_storage.sql) only
-- required `auth.uid() IS NOT NULL`, so ANY authenticated user (shopper or
-- merchant) could INSERT or UPDATE ANY object in the bucket, including another
-- merchant's logo or the shared infra card logo at `business-logos/app/...`.
--
-- The app uploads logos to `business-logos/<business_id>/logo_<ts>.<ext>`
-- (see app/business-setup.tsx uploadLogo: path = `${businessId}/logo_...`), so
-- we scope writes to objects whose first path segment is a business owned by
-- the caller. This mirrors the proven deal-photos owner policies
-- (20260706130000_deal_photo_owner_upload_policies.sql).
--
-- The `app/` infra prefix (Twofer Card logo, etc.) is intentionally NOT granted
-- to any authenticated user: `app` matches no business id, so only the
-- service_role — which bypasses RLS — can write there. Public read is left
-- unchanged (still open to everyone).

-- Ensure the bucket stays public-read (idempotent, matches original migration).
INSERT INTO storage.buckets (id, name, public)
VALUES ('business-logos', 'business-logos', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- Replace the over-broad INSERT policy with an owner-prefix check.
DROP POLICY IF EXISTS "Business owner upload logo" ON storage.objects;
CREATE POLICY "Business owner upload logo"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'business-logos'
  AND EXISTS (
    SELECT 1
    FROM public.businesses b
    WHERE b.owner_id = auth.uid()
      AND b.id::text = split_part(storage.objects.name, '/', 1)
  )
);

-- Replace the over-broad UPDATE policy with an owner-prefix check on both the
-- existing row (USING) and the proposed row (WITH CHECK). The client uploads
-- with upsert:true, which needs UPDATE to also pass when a name collides.
DROP POLICY IF EXISTS "Business owner update logo" ON storage.objects;
CREATE POLICY "Business owner update logo"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'business-logos'
  AND EXISTS (
    SELECT 1
    FROM public.businesses b
    WHERE b.owner_id = auth.uid()
      AND b.id::text = split_part(storage.objects.name, '/', 1)
  )
)
WITH CHECK (
  bucket_id = 'business-logos'
  AND EXISTS (
    SELECT 1
    FROM public.businesses b
    WHERE b.owner_id = auth.uid()
      AND b.id::text = split_part(storage.objects.name, '/', 1)
  )
);

-- Add an owner-scoped DELETE policy so merchants can clean up their own logos
-- but not anyone else's. The delete-user-account edge function removes logos
-- with the service_role client, which bypasses RLS and is unaffected.
DROP POLICY IF EXISTS "Business owner delete logo" ON storage.objects;
CREATE POLICY "Business owner delete logo"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'business-logos'
  AND EXISTS (
    SELECT 1
    FROM public.businesses b
    WHERE b.owner_id = auth.uid()
      AND b.id::text = split_part(storage.objects.name, '/', 1)
  )
);
