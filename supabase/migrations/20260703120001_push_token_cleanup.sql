-- Cleanup function for stale push tokens (not updated in 90+ days).
-- Can be called via pg_cron or a scheduled edge function.
CREATE OR REPLACE FUNCTION cleanup_stale_push_tokens()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM push_tokens
  WHERE updated_at < now() - interval '90 days';
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
