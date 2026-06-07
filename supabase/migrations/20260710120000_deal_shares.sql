-- Share Deal MVP: per-user, per-deal share codes.
--
-- A share is not a transfer. The sender's claim code is never stored here
-- and never sent to friends. Friends use the public share URL to claim their
-- own offer through the separate website repo.

BEGIN;

CREATE TABLE IF NOT EXISTS public.deal_shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  share_code text NOT NULL,
  deal_id uuid NOT NULL REFERENCES public.deals(id) ON DELETE CASCADE,
  shared_by_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  opened_count integer NOT NULL DEFAULT 0,
  first_opened_at timestamptz NULL,
  last_opened_at timestamptz NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'deal_shares_share_code_key'
      AND conrelid = 'public.deal_shares'::regclass
  ) THEN
    ALTER TABLE public.deal_shares
      ADD CONSTRAINT deal_shares_share_code_key UNIQUE (share_code);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'deal_shares_sender_deal_key'
      AND conrelid = 'public.deal_shares'::regclass
  ) THEN
    ALTER TABLE public.deal_shares
      ADD CONSTRAINT deal_shares_sender_deal_key UNIQUE (shared_by_user_id, deal_id);
  END IF;
END $$;

ALTER TABLE public.deal_shares ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.deal_shares FROM anon, authenticated;

GRANT SELECT (
  id,
  share_code,
  deal_id,
  shared_by_user_id,
  created_at,
  opened_count,
  first_opened_at,
  last_opened_at
) ON public.deal_shares TO authenticated;

GRANT INSERT (
  share_code,
  deal_id,
  shared_by_user_id
) ON public.deal_shares TO authenticated;

-- Public previews use lookup_deal_share(); do not expose deal_shares directly.
DROP POLICY IF EXISTS deal_shares_public_preview_read ON public.deal_shares;

-- Senders can read their own share rows.
DROP POLICY IF EXISTS deal_shares_self_read ON public.deal_shares;
CREATE POLICY deal_shares_self_read
  ON public.deal_shares FOR SELECT
  TO authenticated
  USING (auth.uid() = shared_by_user_id);

-- Senders can create their own share rows. Updates and deletes stay blocked.
DROP POLICY IF EXISTS deal_shares_self_insert ON public.deal_shares;
CREATE POLICY deal_shares_self_insert
  ON public.deal_shares FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = shared_by_user_id);

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

  UPDATE public.deal_shares ds
  SET
    opened_count = ds.opened_count + 1,
    first_opened_at = coalesce(ds.first_opened_at, now()),
    last_opened_at = now()
  WHERE ds.share_code = normalized_code
  RETURNING ds.*
  INTO share_row;

  IF NOT FOUND THEN
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
  IS 'Public Share Deal preview lookup. Normalizes a share code, increments open counters for found shares, and returns only public-safe deal/business preview fields.';

COMMIT;
