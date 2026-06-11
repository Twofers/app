-- Restrict consumer read access on the public `businesses` table to non-PII columns.
--
-- Before this migration, the policy "Anyone can read businesses" USING (true) let any
-- authenticated session read every column, including business_email, contact_name, tone,
-- and the owner's auth.users uuid. The consumer feed and business detail page only need a
-- safe subset; owners need full read access via a separate SECURITY DEFINER function.
--
-- Strategy:
--   1. Keep the row-level policy permissive (consumers still see all rows).
--   2. Add column-level GRANTs that exclude PII from anon/authenticated.
--   3. Provide get_my_business() for owners to read their own row in full.

REVOKE SELECT ON public.businesses FROM anon, authenticated;

GRANT SELECT (
  id,
  name,
  address,
  location,
  latitude,
  longitude,
  phone,
  hours_text,
  short_description,
  category,
  preferred_locale,
  logo_url,
  website,
  instagram_handle,
  facebook_url,
  pickup_note,
  created_at
) ON public.businesses TO anon, authenticated;

-- Note: business_email, contact_name, tone, owner_id remain ungranted to anon/authenticated.

-- Owners read their own row (including PII) via this SECURITY DEFINER function.
CREATE OR REPLACE FUNCTION public.get_my_business()
RETURNS SETOF public.businesses
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT * FROM public.businesses WHERE owner_id = auth.uid() LIMIT 1;
$$;

-- Supabase default privileges grant EXECUTE to anon on every new function, and
-- REVOKE FROM PUBLIC does not remove that explicit grant (verified live on
-- 2026-06-10 with purge_user_data / deal_claim_counts). Revoke anon explicitly.
REVOKE EXECUTE ON FUNCTION public.get_my_business() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_business() TO authenticated;

COMMENT ON FUNCTION public.get_my_business()
  IS 'Returns the caller''s business row with all columns (including PII). Bypasses column-level GRANT restrictions via SECURITY DEFINER. Use this in owner-side code instead of querying `businesses` directly.';
