-- Server-side geo filtering for the consumer feed.
--
-- The home feed loaded every business page-by-page and filtered by distance in JS,
-- which does not scale past a few hundred shops. These RPCs push the radius filter
-- (and ordering + pagination) into Postgres using an indexed bounding-box pre-filter
-- refined by a great-circle distance. No PostGIS extension required, so this works on
-- any Supabase project; swap to geography/ST_DWithin later if desired.
--
-- Favorites override distance: callers pass p_favorite_ids and those rows are always
-- included regardless of radius (matches the existing client behavior).

-- Btree index backs the latitude/longitude range scan in the bounding-box pre-filter.
CREATE INDEX IF NOT EXISTS idx_businesses_lat_lng
  ON public.businesses (latitude, longitude)
  WHERE latitude IS NOT NULL AND longitude IS NOT NULL;

-- Great-circle distance in statute miles. IMMUTABLE so it can be inlined/indexed.
CREATE OR REPLACE FUNCTION public.haversine_miles(
  lat1 double precision,
  lng1 double precision,
  lat2 double precision,
  lng2 double precision
) RETURNS double precision
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT 3958.7558657441 * 2 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  ));
$$;

-- Businesses within p_radius_miles of (p_lat, p_lng), nearest first, plus any favorites.
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
      -- guard against div-by-zero near the poles; DFW is ~33N so cos is ~0.84
      p_radius_miles / (69.0 * GREATEST(cos(radians(p_lat)), 0.01)) AS dlng
  )
  SELECT
    b.id, b.name, b.location, b.latitude, b.longitude,
    public.haversine_miles(p_lat, p_lng, b.latitude::double precision, b.longitude::double precision) AS distance_miles
  FROM public.businesses b, bounds
  WHERE b.latitude IS NOT NULL AND b.longitude IS NOT NULL
    AND (
      b.id = ANY(p_favorite_ids)
      OR (
        b.latitude BETWEEN p_lat - bounds.dlat AND p_lat + bounds.dlat
        AND b.longitude BETWEEN p_lng - bounds.dlng AND p_lng + bounds.dlng
        AND public.haversine_miles(p_lat, p_lng, b.latitude::double precision, b.longitude::double precision) <= p_radius_miles
      )
    )
  ORDER BY distance_miles ASC
  LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0);
$$;

-- Active deal IDs whose business is within radius (or favorited), nearest first.
-- Returns IDs only so callers hydrate full rows with their existing select (keeping
-- the deal shape in one place); recurring-window refinement stays client-side.
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
      p_radius_miles / (69.0 * GREATEST(cos(radians(p_lat)), 0.01)) AS dlng
  )
  SELECT
    d.id, d.business_id,
    public.haversine_miles(p_lat, p_lng, b.latitude::double precision, b.longitude::double precision) AS distance_miles
  FROM public.deals d
  JOIN public.businesses b ON b.id = d.business_id
  , bounds
  WHERE d.is_active = true
    AND d.end_time >= now()
    AND b.latitude IS NOT NULL AND b.longitude IS NOT NULL
    AND (
      b.id = ANY(p_favorite_ids)
      OR (
        b.latitude BETWEEN p_lat - bounds.dlat AND p_lat + bounds.dlat
        AND b.longitude BETWEEN p_lng - bounds.dlng AND p_lng + bounds.dlng
        AND public.haversine_miles(p_lat, p_lng, b.latitude::double precision, b.longitude::double precision) <= p_radius_miles
      )
    )
  ORDER BY distance_miles ASC, d.end_time ASC
  LIMIT GREATEST(p_limit, 0) OFFSET GREATEST(p_offset, 0);
$$;

GRANT EXECUTE ON FUNCTION public.haversine_miles(double precision, double precision, double precision, double precision) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nearby_businesses(double precision, double precision, double precision, integer, integer, uuid[]) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.nearby_deals(double precision, double precision, double precision, integer, integer, uuid[]) TO anon, authenticated;
