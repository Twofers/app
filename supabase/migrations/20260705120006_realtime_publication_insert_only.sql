-- Restrict the supabase_realtime publication to INSERT events only.
--
-- Before: 20260704120000_enable_deals_realtime.sql added the deals table with the default
-- publish list (insert, update, delete, truncate). Consumer clients subscribed to INSERT
-- only, but every UPDATE on a deal (e.g. is_active toggles, claim count updates if those
-- are added later, merchant edits to title/description) was still broadcast over the
-- replication slot to all subscribed sessions, leaking merchant draft state.
--
-- The publication currently contains only `deals`, so applying the filter at the
-- publication level (instead of per-table) is safe today. If other tables are added to
-- the realtime publication later, this filter will affect them too — verify before adding.

ALTER PUBLICATION supabase_realtime SET (publish = 'insert');

COMMENT ON PUBLICATION supabase_realtime
  IS 'Realtime publication for client subscriptions. Restricted to INSERT only — UPDATE/DELETE/TRUNCATE events are not broadcast. This avoids leaking merchant edits and soft-delete updates to consumer feeds. If tables that need UPDATE broadcasts are added later, switch to per-table publish filters (PG15+).';
