-- Server-side idempotency for impressions.
--
-- The old consumer feed re-emitted `deal_viewed` for every visible deal on every
-- list recompute (search keystroke, favorite toggle, radius/segment change), which
-- inflated the "Impressions" number shown to paying cafes. The client now counts a
-- deal at most once per session via real viewport visibility; this migration adds a
-- durable backstop so repeat sessions in the same day cannot re-inflate the count.
--
-- Dedupe key: (user_id, deal_id, device_platform, UTC day). "Device" is the coarsest
-- signal we currently capture (device_platform); a user on two platforms still counts
-- once per platform per day, which matches "per user/device + deal + day".

-- 1) Collapse historical duplicate deal_viewed rows so the unique index below can be
--    built, and so existing dashboards deflate to honest numbers. Keeps the earliest
--    row per group (lowest occurred_at, then lowest id).
DELETE FROM public.app_analytics_events a
USING public.app_analytics_events b
WHERE a.event_name = 'deal_viewed'
  AND b.event_name = 'deal_viewed'
  AND a.user_id IS NOT NULL
  AND a.deal_id IS NOT NULL
  AND a.user_id = b.user_id
  AND a.deal_id = b.deal_id
  AND COALESCE(a.device_platform, '') = COALESCE(b.device_platform, '')
  AND (a.occurred_at AT TIME ZONE 'UTC')::date = (b.occurred_at AT TIME ZONE 'UTC')::date
  AND (
    a.occurred_at > b.occurred_at
    OR (a.occurred_at = b.occurred_at AND a.id > b.id)
  );

-- 2) Enforce one deal_viewed per (user, deal, device_platform, UTC day) going forward.
--    Partial + expression index; the edge function treats a 23505 here as a no-op.
CREATE UNIQUE INDEX IF NOT EXISTS uq_app_analytics_deal_viewed_daily
  ON public.app_analytics_events (
    user_id,
    deal_id,
    COALESCE(device_platform, ''),
    ((occurred_at AT TIME ZONE 'UTC')::date)
  )
  WHERE event_name = 'deal_viewed'
    AND user_id IS NOT NULL
    AND deal_id IS NOT NULL;

COMMENT ON INDEX public.uq_app_analytics_deal_viewed_daily IS
  'Idempotency backstop: collapses repeat deal_viewed impressions to one per user/device/deal/UTC-day.';
