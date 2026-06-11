-- Corrective rewrite of purge_user_data (original: 20260705120008_purge_user_data_rpc.sql).
--
-- The original function runs
--   UPDATE public.app_analytics_events SET user_id = NULL, session_id = NULL ...
-- but app_analytics_events has never had a session_id column — not in any repo
-- migration and (prod-probed 2026-06-10, scripts/probe-analytics-schema.mjs)
-- not in production either. Its EXCEPTION handler only catches undefined_table,
-- so the function raises 42703 (undefined_column) on EVERY call, and account
-- deletion always fell through to the FK cascade (hard-deleting deal_claims and
-- shrinking merchant dashboard history) instead of anonymizing.
--
-- Changes from the original, everything else preserved verbatim:
--   1. Drop the nonexistent app_analytics_events.session_id reference.
--   2. Additionally clear deal_claims.session_id_at_claim (a real column, added
--      in 20260327120000) — a pseudonymous identifier the original left behind
--      on anonymized claims.

CREATE OR REPLACE FUNCTION public.purge_user_data(p_user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Anonymize claim history (preserve aggregate analytics; remove personal link).
  UPDATE public.deal_claims
    SET user_id = NULL,
        zip_at_claim = NULL,
        location_source_at_claim = NULL,
        session_id_at_claim = NULL
    WHERE user_id = p_user_id;

  -- Anonymize raw analytics events (keep the row for merchant dashboards but drop the link).
  UPDATE public.app_analytics_events
    SET user_id = NULL
    WHERE user_id = p_user_id;

  -- Hard-delete tables that exist purely for the user.
  DELETE FROM public.favorites WHERE user_id = p_user_id;
  DELETE FROM public.push_tokens WHERE user_id = p_user_id;
  DELETE FROM public.consumer_profiles WHERE user_id = p_user_id;

  -- Optional: app_subscriptions / consumer_push_prefs if they exist.
  EXECUTE 'DELETE FROM public.consumer_push_prefs WHERE user_id = $1'
    USING p_user_id;
EXCEPTION
  WHEN undefined_table THEN
    -- Table may not exist in all environments; ignore.
    NULL;
END;
$$;

-- Supabase default privileges grant EXECUTE to anon/authenticated on every new
-- function, and REVOKE FROM PUBLIC does not remove those explicit grants.
REVOKE EXECUTE ON FUNCTION public.purge_user_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_user_data(uuid) TO service_role;

COMMENT ON FUNCTION public.purge_user_data(uuid)
  IS 'Anonymizes or deletes all rows tied to a given auth user. Called by delete-user-account before auth.admin.deleteUser. Service role only.';
