-- Deletes all consumer data owned by a given auth user.
--
-- Used by the delete-user-account edge function. Before this migration, that function
-- only called auth.admin.deleteUser() and relied on FK ON DELETE CASCADE — but several
-- tables (consumer_profiles, push_tokens, app_analytics_events, favorites, deal_claims)
-- have ON DELETE SET NULL or no cascade defined, so PII (birthdate, lat/lng, push tokens)
-- survived the auth deletion.
--
-- This RPC is the explicit purge step. Call it from delete-user-account BEFORE deleting
-- the auth row. Wrapped as SECURITY DEFINER so the edge function can call it without
-- needing direct table-level DELETE grants.

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
        location_source_at_claim = NULL
    WHERE user_id = p_user_id;

  -- Anonymize raw analytics events (keep the row for merchant dashboards but drop the link).
  UPDATE public.app_analytics_events
    SET user_id = NULL,
        session_id = NULL
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

REVOKE EXECUTE ON FUNCTION public.purge_user_data(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_user_data(uuid) TO service_role;

COMMENT ON FUNCTION public.purge_user_data(uuid)
  IS 'Anonymizes or deletes all rows tied to a given auth user. Called by delete-user-account before auth.admin.deleteUser. Service role only.';
