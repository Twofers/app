-- Prevent a single user from holding multiple business_profiles rows via the dual-key
-- (user_id, owner_id) pattern.
--
-- Existing constraints: separate UNIQUE on user_id and on owner_id. A user_id-only row
-- and an owner_id-only row for the same auth user are both legal today, leading to
-- duplicate billing state and non-deterministic LIMIT 1 reads.

-- Pre-check: refuse to apply if existing data already has duplicates.
DO $$
DECLARE
  v_dupes integer;
BEGIN
  SELECT count(*)
    INTO v_dupes
    FROM (
      SELECT COALESCE(user_id, owner_id) AS auth_user, count(*) AS n
        FROM public.business_profiles
        WHERE user_id IS NOT NULL OR owner_id IS NOT NULL
        GROUP BY COALESCE(user_id, owner_id)
        HAVING count(*) > 1
    ) AS dupes;

  IF v_dupes > 0 THEN
    RAISE EXCEPTION
      'Cannot create unique index: % auth users own multiple business_profiles rows. Merge them before applying this migration.',
      v_dupes;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS business_profiles_one_per_auth_user
  ON public.business_profiles (COALESCE(user_id, owner_id))
  WHERE user_id IS NOT NULL OR owner_id IS NOT NULL;

COMMENT ON INDEX public.business_profiles_one_per_auth_user
  IS 'Ensures a single business_profiles row per auth user regardless of whether it is keyed by user_id, owner_id, or both. Companion to the existing UNIQUE constraints on each column individually.';
