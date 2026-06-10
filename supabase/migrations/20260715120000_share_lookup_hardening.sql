-- Share Deal hardening (audit follow-ups). Two changes:
--
-- 1. lookup_deal_share: throttle the anonymous opened_count increment to one
--    bump per share row per 30 seconds. The RPC is anon-callable, so without
--    this any visitor could spam-inflate a sender's open counter. The preview
--    itself is unaffected — when the bump is throttled the row is re-read and
--    the response is identical, just without the counter write.
-- 2. deal_shares insert policy: senders can only mint codes for live deals
--    (active, started, not ended). Previously any authenticated user could
--    insert a share row for ANY deal id, including not-yet-live deals.
--
-- Function body is otherwise identical to 20260710120000_deal_shares.sql.

BEGIN;

CREATE OR REPLACE FUNCTION public.lookup_deal_share(lookup_code text)
RETURNS TABLE (
  share_status text,
  share_code text,
  deal_id uuid,
  deal_title text,
  deal_description text,
  deal_start_time timestamptz,
  deal_end_time timestamptz,
  deal_max_claims integer,
  deal_price numeric,
  deal_poster_url text,
  deal_poster_storage_path text,
  business_name text,
  business_address text,
  business_location text,
  business_phone text,
  business_hours_text text,
  business_logo_url text,
  opened_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  normalized_code text := upper(trim(coalesce(lookup_code, '')));
  share_row public.deal_shares%ROWTYPE;
BEGIN
  IF normalized_code !~ '^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{7}$' THEN
    RETURN QUERY
    SELECT
      'invalid'::text,
      normalized_code,
      NULL::uuid,
      NULL::text,
      NULL::text,
      NULL::timestamptz,
      NULL::timestamptz,
      NULL::integer,
      NULL::numeric,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::integer;
    RETURN;
  END IF;

  -- Throttled counter bump: at most one increment per row per 30 seconds.
  UPDATE public.deal_shares ds
  SET
    opened_count = ds.opened_count + 1,
    first_opened_at = coalesce(ds.first_opened_at, now()),
    last_opened_at = now()
  WHERE ds.share_code = normalized_code
    AND (ds.last_opened_at IS NULL OR ds.last_opened_at < now() - interval '30 seconds')
  RETURNING ds.*
  INTO share_row;

  -- Throttled (row exists but was bumped recently) or genuinely missing —
  -- re-read so the preview still works when only the bump was skipped.
  IF NOT FOUND THEN
    SELECT ds.* INTO share_row
    FROM public.deal_shares ds
    WHERE ds.share_code = normalized_code;
  END IF;

  IF share_row.id IS NULL THEN
    RETURN QUERY
    SELECT
      'not_found'::text,
      normalized_code,
      NULL::uuid,
      NULL::text,
      NULL::text,
      NULL::timestamptz,
      NULL::timestamptz,
      NULL::integer,
      NULL::numeric,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::integer;
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    CASE
      WHEN d.is_active IS DISTINCT FROM true
        OR d.start_time > now()
        OR d.end_time <= now()
        THEN 'expired'::text
      ELSE 'valid'::text
    END AS share_status,
    share_row.share_code,
    d.id,
    d.title,
    d.description,
    d.start_time,
    d.end_time,
    d.max_claims,
    d.price,
    d.poster_url,
    d.poster_storage_path,
    b.name,
    b.address,
    b.location,
    b.phone,
    b.hours_text,
    b.logo_url,
    share_row.opened_count
  FROM public.deals d
  JOIN public.businesses b ON b.id = d.business_id
  WHERE d.id = share_row.deal_id;

  IF NOT FOUND THEN
    RETURN QUERY
    SELECT
      'not_found'::text,
      share_row.share_code,
      NULL::uuid,
      NULL::text,
      NULL::text,
      NULL::timestamptz,
      NULL::timestamptz,
      NULL::integer,
      NULL::numeric,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      NULL::text,
      share_row.opened_count;
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.lookup_deal_share(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_deal_share(text) TO anon;

COMMENT ON FUNCTION public.lookup_deal_share(text)
  IS 'Public Share Deal preview lookup. Normalizes a share code, increments open counters (throttled to one bump per 30s per share) for found shares, and returns only public-safe deal/business preview fields.';

-- Senders can only mint share codes for live deals they can see.
DROP POLICY IF EXISTS deal_shares_self_insert ON public.deal_shares;
CREATE POLICY deal_shares_self_insert
  ON public.deal_shares FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = shared_by_user_id
    AND EXISTS (
      SELECT 1 FROM public.deals d
      WHERE d.id = deal_id
        AND d.is_active = true
        AND (d.start_time IS NULL OR d.start_time <= now())
        AND d.end_time > now()
    )
  );

COMMIT;
