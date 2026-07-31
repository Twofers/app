-- Provide founder-facing account totals and signup velocity from the
-- authoritative auth.users creation timestamp. The RPC is service-role-only
-- because auth.users must never be exposed to browser clients.
BEGIN;

CREATE OR REPLACE FUNCTION public.admin_account_growth_summary(
  p_as_of timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
SET row_security = off
AS $$
DECLARE
  result jsonb;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'service_role required';
  END IF;

  WITH accounts AS (
    SELECT
      u.id,
      u.created_at,
      CASE
        WHEN p.role = 'business' THEN 'business'
        WHEN p.role = 'customer' THEN 'customer'
        WHEN EXISTS (
          SELECT 1
          FROM public.businesses b
          WHERE b.owner_id = u.id
        ) THEN 'business'
        ELSE 'customer'
      END AS account_role
    FROM auth.users u
    LEFT JOIN public.profiles p ON p.id = u.id
    WHERE u.created_at < p_as_of
      AND NOT EXISTS (
        SELECT 1
        FROM public.admin_users au
        WHERE au.id = u.id
      )
      AND COALESCE(u.raw_app_meta_data ->> 'app_role', '') <> 'redeemer'
  ),
  rollup AS (
    SELECT
      COALESCE(account_role, 'combined') AS segment,
      count(*) AS total,
      count(*) FILTER (
        WHERE created_at >= p_as_of - interval '24 hours'
      ) AS day_current,
      count(*) FILTER (
        WHERE created_at >= p_as_of - interval '48 hours'
          AND created_at < p_as_of - interval '24 hours'
      ) AS day_previous,
      count(*) FILTER (
        WHERE created_at >= p_as_of - interval '7 days'
      ) AS week_current,
      count(*) FILTER (
        WHERE created_at >= p_as_of - interval '14 days'
          AND created_at < p_as_of - interval '7 days'
      ) AS week_previous,
      count(*) FILTER (
        WHERE created_at >= p_as_of - interval '30 days'
      ) AS month_current,
      count(*) FILTER (
        WHERE created_at >= p_as_of - interval '60 days'
          AND created_at < p_as_of - interval '30 days'
      ) AS month_previous
    FROM accounts
    GROUP BY GROUPING SETS ((account_role), ())
  ),
  segments AS (
    SELECT
      segment,
      jsonb_build_object(
        'total', total,
        'day', jsonb_build_object(
          'current', day_current,
          'previous', day_previous
        ),
        'week', jsonb_build_object(
          'current', week_current,
          'previous', week_previous
        ),
        'month', jsonb_build_object(
          'current', month_current,
          'previous', month_previous
        )
      ) AS metrics
    FROM rollup
  ),
  zero_metrics AS (
    SELECT jsonb_build_object(
      'total', 0,
      'day', jsonb_build_object('current', 0, 'previous', 0),
      'week', jsonb_build_object('current', 0, 'previous', 0),
      'month', jsonb_build_object('current', 0, 'previous', 0)
    ) AS metrics
  )
  SELECT jsonb_build_object(
    'as_of', p_as_of,
    'definition',
      'Current non-admin customer and business accounts. Signup windows are rolling and compare with the immediately preceding equal-length window.',
    'customers',
      COALESCE(
        (SELECT metrics FROM segments WHERE segment = 'customer'),
        (SELECT metrics FROM zero_metrics)
      ),
    'businesses',
      COALESCE(
        (SELECT metrics FROM segments WHERE segment = 'business'),
        (SELECT metrics FROM zero_metrics)
      ),
    'combined',
      COALESCE(
        (SELECT metrics FROM segments WHERE segment = 'combined'),
        (SELECT metrics FROM zero_metrics)
      )
  )
  INTO result;

  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_account_growth_summary(timestamptz)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_account_growth_summary(timestamptz)
  TO service_role;

COMMENT ON FUNCTION public.admin_account_growth_summary(timestamptz) IS
  'Service-role-only customer/business account totals and rolling signup comparisons for the admin dashboard.';

COMMIT;
