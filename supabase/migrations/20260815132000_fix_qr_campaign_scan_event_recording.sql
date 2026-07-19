-- Qualify qr_scan_events columns inside the scan RPC. The RETURNS TABLE
-- column name campaign_id is also a PL/pgSQL variable, so unqualified
-- references cause the rate-limit query to fail before the insert runs.
BEGIN;

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

  IF p_ip_hash IS NOT NULL THEN
    SELECT count(*)
      INTO v_recent_ip_scans
    FROM public.qr_scan_events AS e
    WHERE e.campaign_id = v_campaign.id
      AND e.ip_hash = p_ip_hash
      AND e.scanned_at >= v_now - interval '1 minute';
  END IF;

  SELECT count(*)
    INTO v_recent_campaign_scans
  FROM public.qr_scan_events AS e
  WHERE e.campaign_id = v_campaign.id
    AND e.scanned_at >= v_now - interval '1 minute';

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

COMMIT;
