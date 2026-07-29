-- Public object URLs do not require SELECT policies on storage.objects.
-- These broad policies expose bucket metadata and allow full path enumeration.
-- Keep both buckets public so existing logo/poster URLs continue to work, and
-- preserve the owner-scoped INSERT/UPDATE/DELETE policies unchanged.

BEGIN;

DROP POLICY IF EXISTS "Public read business-logos objects"
  ON storage.objects;
DROP POLICY IF EXISTS "Public read deal-photos objects"
  ON storage.objects;

COMMIT;
