-- Keep business discovery searchable when a business row has not been geocoded yet.
--
-- The original nearby RPCs filtered out every row with a missing latitude or
-- longitude before applying the favorites override. That made a real/favorited
-- business searchable through notifications/favorites but invisible in the Shops
-- list. Preserve nearby ordering for geocoded rows, append unlocated businesses
-- for shop search, and let favorited unlocated businesses surface their live deals.

CREATE OR REPLACE FUNCTION public.nearby_businesses(
  p_lat double precision,
  p_lng double precision,
  p_radius_miles double precision DEFAULT 15,
  p_limit integer DEFAULT 50,
  p_offset integer DEFAULT 0,
  p_favorite_ids uuid[] DEFAULT '{}'
) RETURNS TABLE (
  id uuid,
  name text,
  location text,
  latitude numeric,
  longitude numeric,
  distance_miles double precision
)
LANGUAGE sql STABLE AS $$
  WITH bounds AS (
    SELECT
      p_radius_miles / 69.0 AS dlat,
      p_radius_miles / (69.0 * GREATEST(cos(radians(p_lat)), 0.01)) AS dlng,
      COALESCE(p_favorite_ids, '{}'::uuid[]) AS favorite_ids
  )
  SELECT
    b.id,
    b.name,
    b.location,
    b.latitude,
    b.longitude,
    CASE
      WHEN b.latitude IS NOT NULL AND b.longitude IS NOT NULL THEN
        public.haversine_miles(p_lat, p_lng, b.latitude::double precision, b.longitude::double precision)
      ELSE NULL
    END AS distance_miles
  FROM public.businesses b, bounds
  WHERE
    b.id = ANY(bounds.favorite_ids)
    OR b.latitude IS NULL
    OR b.longitude IS NULL
    OR (
      b.latitude BETWEEN p_lat - bounds.dlat AND p_lat + bounds.dlat
      AND b.longitude BETWEEN p_lng - bounds.dlng AND p_lng + bounds.dlng
      AND public.haversine_miles(p_lat, p_lng, b.latitude::double precision, b.longitude::double precision) <= p_radius_miles
    )
  ORDER BY distance_miles ASC NULLS LAST, b.name ASC
  LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0);
$$;

CREATE OR REPLACE FUNCTION public.nearby_deals(
  p_lat double precision,
  p_lng double precision,
  p_radius_miles double precision DEFAULT 15,
  p_limit integer DEFAULT 80,
  p_offset integer DEFAULT 0,
  p_favorite_ids uuid[] DEFAULT '{}'
) RETURNS TABLE (
  id uuid,
  business_id uuid,
  distance_miles double precision
)
LANGUAGE sql STABLE AS $$
  WITH bounds AS (
    SELECT
      p_radius_miles / 69.0 AS dlat,
      p_radius_miles / (69.0 * GREATEST(cos(radians(p_lat)), 0.01)) AS dlng,
      COALESCE(p_favorite_ids, '{}'::uuid[]) AS favorite_ids
  )
  SELECT
    d.id,
    d.business_id,
    CASE
      WHEN b.latitude IS NOT NULL AND b.longitude IS NOT NULL THEN
        public.haversine_miles(p_lat, p_lng, b.latitude::double precision, b.longitude::double precision)
      ELSE NULL
    END AS distance_miles
  FROM public.deals d
  JOIN public.businesses b ON b.id = d.business_id
  , bounds
  WHERE d.is_active = true
    AND d.end_time >= now()
    AND (
      b.id = ANY(bounds.favorite_ids)
      OR (
        b.latitude IS NOT NULL
        AND b.longitude IS NOT NULL
        AND b.latitude BETWEEN p_lat - bounds.dlat AND p_lat + bounds.dlat
        AND b.longitude BETWEEN p_lng - bounds.dlng AND p_lng + bounds.dlng
        AND public.haversine_miles(p_lat, p_lng, b.latitude::double precision, b.longitude::double precision) <= p_radius_miles
      )
    )
  ORDER BY distance_miles ASC NULLS LAST, d.end_time ASC
  LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0);
$$;

GRANT EXECUTE ON FUNCTION public.nearby_businesses(double precision, double precision, double precision, integer, integer, uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nearby_deals(double precision, double precision, double precision, integer, integer, uuid[]) TO anon, authenticated;
