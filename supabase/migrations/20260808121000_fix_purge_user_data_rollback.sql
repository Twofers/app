-- purge_user_data has silently no-opped since it shipped.
--
-- The function ends with
--   EXECUTE 'DELETE FROM public.consumer_push_prefs WHERE user_id = $1'
-- but consumer_push_prefs has never been a table in any environment:
-- 20260403120000_consumer_push_prefs.sql adds push-pref COLUMNS to
-- consumer_profiles instead of creating a table. The dynamic DELETE therefore
-- raises undefined_table on EVERY call — and because a plpgsql EXCEPTION
-- handler rolls back all work done inside its block before handling, the
-- WHEN undefined_table "ignore" handler undoes the entire purge (deal_claims /
-- app_analytics_events anonymization and the favorites / push_tokens /
-- consumer_profiles deletes) while the function still returns success.
-- The 20260714120000 corrective rewrite fixed the 42703 session_id raise but
-- kept this same handler layout, so the no-op persisted.
-- Found by scripts/db-tests/2a-purge-user-data.mjs on the test project.
--
-- Fix (everything else preserved verbatim from 20260714120000): isolate the
-- optional-table delete in its own nested block, so a missing optional table
-- skips only that statement and can never roll back the purge itself.
--
-- Second, independent defect found by the same suite: deal_claims.user_id has
-- been NOT NULL since the initial schema and no migration ever relaxed it, so
-- the anonymizing UPDATE ... SET user_id = NULL raises 23502 for ANY user who
-- ever claimed a deal. delete-user-account then logs the error and falls back
-- to auth-delete + FK CASCADE, which HARD-DELETES the user's deal_claims —
-- silently shrinking merchant claim/redemption history, the exact outcome the
-- anonymize-not-delete design was built to avoid. Anonymized rows (NULL
-- user_id) are safe: every user-facing policy/lookup matches user_id =
-- auth.uid(), which NULL never satisfies.
--
-- DO NOT APPLY to production without Dan's explicit approval (hard gate).
-- After applying, run npm run test:db (suite 2a must go green).

ALTER TABLE public.deal_claims
  ALTER COLUMN user_id DROP NOT NULL;

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

  -- Optional: consumer_push_prefs if it ever becomes a real table. Isolated in
  -- a nested block so undefined_table skips ONLY this statement — an exception
  -- handler on the outer block would roll back the whole purge above.
  BEGIN
    EXECUTE 'DELETE FROM public.consumer_push_prefs WHERE user_id = $1'
      USING p_user_id;
  EXCEPTION
    WHEN undefined_table THEN
      NULL;
  END;
END;
$$;

-- Supabase default privileges grant EXECUTE to anon/authenticated on every new
-- function, and REVOKE FROM PUBLIC does not remove those explicit grants.
REVOKE EXECUTE ON FUNCTION public.purge_user_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.purge_user_data(uuid) TO service_role;

COMMENT ON FUNCTION public.purge_user_data(uuid)
  IS 'Anonymizes or deletes all rows tied to a given auth user. Called by delete-user-account before auth.admin.deleteUser. Service role only.';
