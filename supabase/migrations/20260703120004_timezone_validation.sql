-- Validate that timezone columns contain valid IANA timezone strings.
-- Invalid timezones silently fall back to UTC in date math, causing wrong
-- claim windows, recurring schedules, and analytics aggregation.

CREATE OR REPLACE FUNCTION public.is_valid_iana_timezone(tz TEXT)
RETURNS BOOLEAN LANGUAGE sql IMMUTABLE STRICT AS $$
  SELECT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = tz);
$$;

-- deals.timezone
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'deals' AND column_name = 'timezone'
  ) THEN
    RAISE NOTICE 'deals.timezone column does not exist — skipping constraint';
  ELSE
    -- Only add constraint if all existing rows are valid (or null).
    IF NOT EXISTS (
      SELECT 1 FROM public.deals
      WHERE timezone IS NOT NULL AND NOT public.is_valid_iana_timezone(timezone)
    ) THEN
      ALTER TABLE public.deals
        ADD CONSTRAINT chk_deals_timezone_valid
        CHECK (timezone IS NULL OR public.is_valid_iana_timezone(timezone));
    ELSE
      RAISE NOTICE 'deals table has invalid timezone values — fix them before adding constraint';
    END IF;
  END IF;
END $$;

-- business_profiles.timezone
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'business_profiles' AND column_name = 'timezone'
  ) THEN
    RAISE NOTICE 'business_profiles.timezone column does not exist — skipping constraint';
  ELSE
    IF NOT EXISTS (
      SELECT 1 FROM public.business_profiles
      WHERE timezone IS NOT NULL AND NOT public.is_valid_iana_timezone(timezone)
    ) THEN
      ALTER TABLE public.business_profiles
        ADD CONSTRAINT chk_business_profiles_timezone_valid
        CHECK (timezone IS NULL OR public.is_valid_iana_timezone(timezone));
    ELSE
      RAISE NOTICE 'business_profiles table has invalid timezone values — fix them before adding constraint';
    END IF;
  END IF;
END $$;
