-- Expand the service-role account directory search without returning phone
-- numbers or redemption codes in result rows.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_account_directory(
  p_query text DEFAULT NULL,
  p_role text DEFAULT NULL,
  p_status text DEFAULT NULL,
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
)
RETURNS TABLE (
  user_id uuid,
  email text,
  role text,
  account_status text,
  auth_created_at timestamptz,
  last_sign_in_at timestamptz,
  banned_until timestamptz,
  business_id uuid,
  business_name text,
  business_status text,
  zip_code text,
  total_count bigint
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
SET row_security = off
AS $$
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  RETURN QUERY
  WITH rows AS (
    SELECT
      u.id AS user_id,
      u.email::text AS email,
      COALESCE(p.role, CASE WHEN b.id IS NOT NULL THEN 'business' ELSE 'customer' END)::text AS role,
      COALESCE(p.account_status, 'active')::text AS account_status,
      u.created_at AS auth_created_at,
      u.last_sign_in_at,
      u.banned_until,
      b.id AS business_id,
      b.name::text AS business_name,
      b.status::text AS business_status,
      cp.zip_code::text AS zip_code,
      u.phone::text AS auth_phone,
      b.phone::text AS business_phone
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    LEFT JOIN public.businesses b ON b.owner_id = u.id
    LEFT JOIN public.consumer_profiles cp ON cp.user_id = u.id
    LEFT JOIN public.admin_users au ON au.id = u.id
    WHERE au.id IS NULL
      AND COALESCE(u.raw_app_meta_data ->> 'app_role', '') <> 'redeemer'
  ),
  filtered AS (
    SELECT *
    FROM rows r
    WHERE (NULLIF(trim(p_role), '') IS NULL OR r.role = trim(p_role))
      AND (NULLIF(trim(p_status), '') IS NULL OR r.account_status = trim(p_status))
      AND (
        NULLIF(trim(p_query), '') IS NULL
        OR r.email ILIKE '%' || trim(p_query) || '%'
        OR r.business_name ILIKE '%' || trim(p_query) || '%'
        OR r.auth_phone ILIKE '%' || trim(p_query) || '%'
        OR r.business_phone ILIKE '%' || trim(p_query) || '%'
        OR r.user_id::text = trim(p_query)
        OR r.business_id::text = trim(p_query)
        OR EXISTS (
          SELECT 1
          FROM public.deal_claims dc
          WHERE dc.user_id = r.user_id
            AND upper(dc.short_code) = upper(regexp_replace(trim(p_query), '[^a-zA-Z0-9]', '', 'g'))
        )
      )
  )
  SELECT
    f.user_id,
    f.email,
    f.role,
    f.account_status,
    f.auth_created_at,
    f.last_sign_in_at,
    f.banned_until,
    f.business_id,
    f.business_name,
    f.business_status,
    f.zip_code,
    count(*) OVER () AS total_count
  FROM filtered f
  ORDER BY f.auth_created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200)
  OFFSET GREATEST(COALESCE(p_offset, 0), 0);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_account_directory(text, text, text, integer, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_account_directory(text, text, text, integer, integer) TO service_role;

COMMENT ON FUNCTION public.admin_account_directory(text, text, text, integer, integer) IS
  'Service-role-only account search by business, email, phone, IDs, or exact redemption short code. Sensitive lookup inputs are never returned.';

COMMIT;
