-- Fix the day-series column alias used by the QR analytics aggregate.
-- A table alias alone is a record value in PostgreSQL; naming its output
-- column lets the daily report cast and compare the generated timestamp.
BEGIN;

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
          scan_day::date AS scan_date,
          count(e.id)::integer AS scan_count,
          count(e.id) FILTER (WHERE NOT e.is_likely_bot)::integer AS likely_human_scan_count,
          count(e.id) FILTER (WHERE e.is_likely_bot)::integer AS likely_bot_scan_count
        FROM generate_series(v_since::date, current_date, interval '1 day') AS series(scan_day)
        LEFT JOIN public.qr_scan_events e ON e.scanned_at >= scan_day
          AND e.scanned_at < scan_day + interval '1 day'
        GROUP BY scan_day
      ) AS row
    ), '[]'::jsonb)
  );
END;
$$;

COMMIT;
