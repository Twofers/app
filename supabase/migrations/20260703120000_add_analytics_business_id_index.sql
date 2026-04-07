-- Index for merchant analytics queries that filter by business_id
CREATE INDEX IF NOT EXISTS idx_app_analytics_events_business_id
  ON app_analytics_events (business_id);
