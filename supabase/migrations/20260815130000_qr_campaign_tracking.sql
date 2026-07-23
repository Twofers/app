-- QR campaign tracking for physical Twofer marketing materials.
--
-- Public scans are recorded only through qr-campaign-redirect, which uses
-- the service role and derives every foreign key from an active campaign slug.
-- Browser roles receive no table or function access. Do not apply without
-- explicit approval: this migration changes hosted schema, RLS, and pg_cron.

BEGIN;

CREATE TABLE IF NOT EXISTS public.qr_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  slug text NOT NULL UNIQUE,
  source_type text NOT NULL,
  display_name text NOT NULL,
  destination_type text NOT NULL DEFAULT 'app_download',
  is_active boolean NOT NULL DEFAULT true,
  disabled_at timestamptz,
  created_by_admin_id uuid REFERENCES public.admin_users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT qr_campaigns_slug_format_check
    CHECK (slug = lower(slug) AND slug ~ '^[a-z0-9][a-z0-9-]{7,63}$'),
  CONSTRAINT qr_campaigns_source_type_check
    CHECK (source_type IN ('counter_sign', 'window_sticker', 'flyer', 'coaster', 'table_tent', 'other')),
  CONSTRAINT qr_campaigns_display_name_length_check
    CHECK (char_length(display_name) BETWEEN 1 AND 120),
  CONSTRAINT qr_campaigns_destination_type_check
    CHECK (destination_type IN ('app_download', 'website')),
  CONSTRAINT qr_campaigns_active_disabled_consistency_check
    CHECK ((is_active AND disabled_at IS NULL) OR (NOT is_active AND disabled_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS public.qr_scan_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scanned_at timestamptz NOT NULL DEFAULT now(),
  campaign_id uuid NOT NULL REFERENCES public.qr_campaigns(id) ON DELETE CASCADE,
  business_id uuid NOT NULL REFERENCES public.businesses(id) ON DELETE CASCADE,
  source_type text NOT NULL,
  -- Stored only for short-lived diagnostics. The scheduled redaction below
  -- clears it after 30 days while keeping the aggregate-safe event row.
  user_agent text,
  device_type text NOT NULL,
  -- HMAC-SHA-256 only: raw IP addresses never enter this table. Hashes rotate
  -- daily in the Edge Function and are cleared with user-agent metadata.
  ip_hash text,
  ip_hash_day date,
  redirect_target_type text NOT NULL,
  is_likely_bot boolean NOT NULL DEFAULT false,
  metadata_redacted_at timestamptz,
  CONSTRAINT qr_scan_events_source_type_check
    CHECK (source_type IN ('counter_sign', 'window_sticker', 'flyer', 'coaster', 'table_tent', 'other')),
  CONSTRAINT qr_scan_events_user_agent_length_check
    CHECK (user_agent IS NULL OR char_length(user_agent) <= 512),
  CONSTRAINT qr_scan_events_device_type_check
    CHECK (device_type IN ('ios_phone', 'android_phone', 'android_tablet', 'desktop', 'bot', 'unknown')),
  CONSTRAINT qr_scan_events_ip_hash_check
    CHECK (ip_hash IS NULL OR ip_hash ~ '^[a-f0-9]{64}$'),
  CONSTRAINT qr_scan_events_ip_hash_day_check
    CHECK ((ip_hash IS NULL AND ip_hash_day IS NULL) OR (ip_hash IS NOT NULL AND ip_hash_day IS NOT NULL)),
  CONSTRAINT qr_scan_events_redirect_target_type_check
    CHECK (redirect_target_type IN ('ios_app_store', 'android_play_store', 'website')),
  CONSTRAINT qr_scan_events_redaction_consistency_check
    CHECK (metadata_redacted_at IS NULL OR (user_agent IS NULL AND ip_hash IS NULL AND ip_hash_day IS NULL))
);

CREATE INDEX IF NOT EXISTS idx_qr_campaigns_business_created
  ON public.qr_campaigns (business_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_qr_scan_events_business_scanned
  ON public.qr_scan_events (business_id, scanned_at DESC);

CREATE INDEX IF NOT EXISTS idx_qr_scan_events_campaign_scanned
  ON public.qr_scan_events (campaign_id, scanned_at DESC);

CREATE INDEX IF NOT EXISTS idx_qr_scan_events_campaign_ip_scanned
  ON public.qr_scan_events (campaign_id, ip_hash, scanned_at DESC)
  WHERE ip_hash IS NOT NULL;

-- Atomically re-check the active slug and derive campaign/business/source
-- values. Public callers never receive execute permission; the Edge Function
-- is the sole public entry and supplies only privacy-sanitized metadata.
CREATE OR REPLACE FUNCTION public.record_qr_campaign_scan(
  p_slug text,
  p_user_agent text,
  p_device_type text,
  p_ip_hash text,
  p_ip_hash_day date,
  p_redirect_target_type text,
  p_is_likely_bot boolean
)
RETURNS TABLE (
  campaign_id uuid,
  business_id uuid,
  destination_type text,
  scan_recorded boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_campaign public.qr_campaigns%ROWTYPE;
  v_now timestamptz := now();
  v_recent_ip_scans integer := 0;
  v_recent_campaign_scans integer := 0;
BEGIN
  SELECT *
    INTO v_campaign
  FROM public.qr_campaigns
  WHERE slug = lower(trim(p_slug))
    AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- A QR scan must never fail its redirect because an abusive client exceeded
  -- a telemetry write cap. Skip only the event write; still return the valid
  -- campaign so the Edge Function can redirect normally.
  IF p_ip_hash IS NOT NULL THEN
    SELECT count(*)
      INTO v_recent_ip_scans
    FROM public.qr_scan_events
    WHERE campaign_id = v_campaign.id
      AND ip_hash = p_ip_hash
      AND scanned_at >= v_now - interval '1 minute';
  END IF;

  SELECT count(*)
    INTO v_recent_campaign_scans
  FROM public.qr_scan_events
  WHERE campaign_id = v_campaign.id
    AND scanned_at >= v_now - interval '1 minute';

  IF v_recent_campaign_scans >= 2000 OR v_recent_ip_scans >= 30 THEN
    RETURN QUERY SELECT v_campaign.id, v_campaign.business_id, v_campaign.destination_type, false;
    RETURN;
  END IF;

  INSERT INTO public.qr_scan_events (
    campaign_id,
    business_id,
    source_type,
    user_agent,
    device_type,
    ip_hash,
    ip_hash_day,
    redirect_target_type,
    is_likely_bot
  ) VALUES (
    v_campaign.id,
    v_campaign.business_id,
    v_campaign.source_type,
    NULLIF(left(trim(p_user_agent), 512), ''),
    p_device_type,
    p_ip_hash,
    p_ip_hash_day,
    p_redirect_target_type,
    COALESCE(p_is_likely_bot, false)
  );

  RETURN QUERY SELECT v_campaign.id, v_campaign.business_id, v_campaign.destination_type, true;
END;
$$;

-- Aggregate on the database side so the admin endpoint never has to load raw
-- scan rows into memory. The caller is service role after Edge-level admin
-- authorization; no browser role can invoke this function.
CREATE OR REPLACE FUNCTION public.qr_campaign_analytics(p_days integer DEFAULT 30)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_days integer := greatest(1, least(COALESCE(p_days, 30), 90));
  v_since timestamptz := date_trunc('day', now()) - make_interval(days => greatest(1, least(COALESCE(p_days, 30), 90)) - 1);
BEGIN
  RETURN jsonb_build_object(
    'days', v_days,
    'businesses', COALESCE((
      SELECT jsonb_agg(to_jsonb(row) ORDER BY row.scan_count DESC, row.business_name)
      FROM (
        SELECT
          b.id AS business_id,
          b.name AS business_name,
          count(e.id)::integer AS scan_count,
          count(e.id) FILTER (WHERE NOT e.is_likely_bot)::integer AS likely_human_scan_count,
          count(e.id) FILTER (WHERE e.is_likely_bot)::integer AS likely_bot_scan_count
        FROM public.qr_campaigns c
        JOIN public.businesses b ON b.id = c.business_id
        LEFT JOIN public.qr_scan_events e ON e.campaign_id = c.id AND e.scanned_at >= v_since
        GROUP BY b.id, b.name
      ) AS row
    ), '[]'::jsonb),
    'campaigns', COALESCE((
      SELECT jsonb_agg(to_jsonb(row) ORDER BY row.scan_count DESC, row.created_at DESC)
      FROM (
        SELECT
          c.id AS campaign_id,
          c.business_id,
          b.name AS business_name,
          c.slug,
          c.source_type,
          c.display_name,
          c.destination_type,
          c.is_active,
          c.created_at,
          count(e.id)::integer AS scan_count,
          count(e.id) FILTER (WHERE NOT e.is_likely_bot)::integer AS likely_human_scan_count,
          count(e.id) FILTER (WHERE e.is_likely_bot)::integer AS likely_bot_scan_count
        FROM public.qr_campaigns c
        JOIN public.businesses b ON b.id = c.business_id
        LEFT JOIN public.qr_scan_events e ON e.campaign_id = c.id AND e.scanned_at >= v_since
        GROUP BY c.id, b.name
      ) AS row
    ), '[]'::jsonb),
    'sources', COALESCE((
      SELECT jsonb_agg(to_jsonb(row) ORDER BY row.scan_count DESC, row.source_type)
      FROM (
        SELECT
          e.source_type,
          count(*)::integer AS scan_count,
          count(*) FILTER (WHERE NOT e.is_likely_bot)::integer AS likely_human_scan_count,
          count(*) FILTER (WHERE e.is_likely_bot)::integer AS likely_bot_scan_count
        FROM public.qr_scan_events e
        WHERE e.scanned_at >= v_since
        GROUP BY e.source_type
      ) AS row
    ), '[]'::jsonb),
    'daily', COALESCE((
      SELECT jsonb_agg(to_jsonb(row) ORDER BY row.scan_date)
      FROM (
        SELECT
          day::date AS scan_date,
          count(e.id)::integer AS scan_count,
          count(e.id) FILTER (WHERE NOT e.is_likely_bot)::integer AS likely_human_scan_count,
          count(e.id) FILTER (WHERE e.is_likely_bot)::integer AS likely_bot_scan_count
        FROM generate_series(v_since::date, current_date, interval '1 day') AS day
        LEFT JOIN public.qr_scan_events e ON e.scanned_at >= day
          AND e.scanned_at < day + interval '1 day'
        GROUP BY day
      ) AS row
    ), '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.redact_expired_qr_scan_metadata()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_rows integer;
BEGIN
  UPDATE public.qr_scan_events
  SET
    user_agent = NULL,
    ip_hash = NULL,
    ip_hash_day = NULL,
    metadata_redacted_at = now()
  WHERE metadata_redacted_at IS NULL
    AND scanned_at < now() - interval '30 days';

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'redact-expired-qr-scan-metadata') THEN
    PERFORM cron.unschedule('redact-expired-qr-scan-metadata');
  END IF;

  PERFORM cron.schedule(
    'redact-expired-qr-scan-metadata',
    '17 3 * * *',
    'SELECT public.redact_expired_qr_scan_metadata()'
  );
END
$$;

ALTER TABLE public.qr_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.qr_scan_events ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.qr_campaigns FROM PUBLIC;
REVOKE ALL ON TABLE public.qr_scan_events FROM PUBLIC;
REVOKE ALL ON TABLE public.qr_campaigns FROM anon, authenticated;
REVOKE ALL ON TABLE public.qr_scan_events FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE ON TABLE public.qr_campaigns TO service_role;
GRANT SELECT, INSERT, UPDATE ON TABLE public.qr_scan_events TO service_role;

REVOKE ALL ON FUNCTION public.record_qr_campaign_scan(text, text, text, text, date, text, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.qr_campaign_analytics(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.redact_expired_qr_scan_metadata() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_qr_campaign_scan(text, text, text, text, date, text, boolean) TO service_role;
GRANT EXECUTE ON FUNCTION public.qr_campaign_analytics(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.redact_expired_qr_scan_metadata() TO service_role;

COMMENT ON TABLE public.qr_campaigns IS
  'Admin-created tracking records for physical Twofer marketing QR codes. Browser roles have no direct access.';

COMMENT ON TABLE public.qr_scan_events IS
  'Append-only QR scan telemetry derived from active campaign slugs. No raw IP, user identity, cookies, referrer, or precise location are stored.';

COMMENT ON FUNCTION public.record_qr_campaign_scan(text, text, text, text, date, text, boolean) IS
  'Service-role-only atomic active-campaign lookup and privacy-limited QR scan insert.';

COMMIT;
