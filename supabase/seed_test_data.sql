-- QA customer-flow seed template.
--
-- Manual use only: paste into Supabase SQL Editor after Dan approves database
-- data changes. Do not run as part of local app validation, and do not commit
-- real account passwords or generated claim/QR values.
--
-- Hard role split rule: the customer account must not own a business row.
-- Use two existing Auth users:
--   1. qa_merchant_email owns the business and claimable deals.
--   2. qa_customer_email stays a shopper and receives the expired wallet ticket.

DO $$
DECLARE
  qa_merchant_email TEXT := 'QA_MERCHANT_EMAIL@example.com'; -- CHANGE THIS
  qa_customer_email TEXT := 'QA_CUSTOMER_EMAIL@example.com'; -- CHANGE THIS

  qa_merchant_id UUID;
  qa_customer_id UUID;
  qa_business_id UUID;
  live_deal_id UUID;
  expired_deal_id UUID;
BEGIN
  SELECT id INTO qa_merchant_id
  FROM auth.users
  WHERE email = qa_merchant_email
  LIMIT 1;

  SELECT id INTO qa_customer_id
  FROM auth.users
  WHERE email = qa_customer_email
  LIMIT 1;

  IF qa_merchant_id IS NULL THEN
    RAISE EXCEPTION 'Merchant Auth user not found: %', qa_merchant_email;
  END IF;

  IF qa_customer_id IS NULL THEN
    RAISE EXCEPTION 'Customer Auth user not found: %', qa_customer_email;
  END IF;

  IF qa_merchant_id = qa_customer_id THEN
    RAISE EXCEPTION 'Merchant and customer emails must be different accounts.';
  END IF;

  IF EXISTS (SELECT 1 FROM public.businesses WHERE owner_id = qa_customer_id) THEN
    RAISE EXCEPTION 'Customer account % owns a business row; it would route as Business under the hard role split.', qa_customer_email;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'role'
  ) THEN
    INSERT INTO public.profiles (id, app_tab_mode, role, updated_at)
    VALUES (qa_merchant_id, 'business', 'business', NOW())
    ON CONFLICT (id) DO UPDATE
    SET app_tab_mode = 'business',
        role = 'business',
        updated_at = NOW();

    INSERT INTO public.profiles (id, app_tab_mode, role, updated_at)
    VALUES (qa_customer_id, 'customer', 'customer', NOW())
    ON CONFLICT (id) DO UPDATE
    SET app_tab_mode = 'customer',
        role = 'customer',
        updated_at = NOW();
  ELSE
    INSERT INTO public.profiles (id, app_tab_mode, updated_at)
    VALUES (qa_merchant_id, 'business', NOW())
    ON CONFLICT (id) DO UPDATE
    SET app_tab_mode = 'business',
        updated_at = NOW();

    INSERT INTO public.profiles (id, app_tab_mode, updated_at)
    VALUES (qa_customer_id, 'customer', NOW())
    ON CONFLICT (id) DO UPDATE
    SET app_tab_mode = 'customer',
        updated_at = NOW();
  END IF;

  INSERT INTO public.business_profiles (
    owner_id,
    name,
    address,
    category,
    setup_completed,
    subscription_status,
    subscription_tier,
    trial_ends_at,
    current_period_ends_at,
    updated_at
  )
  VALUES (
    qa_merchant_id,
    'QA Coffee Bar',
    '120 S Main St, Grapevine, TX 76051',
    'cafe',
    true,
    'trial',
    'pro',
    NOW() + INTERVAL '30 days',
    NOW() + INTERVAL '30 days',
    NOW()
  )
  ON CONFLICT (owner_id) DO UPDATE
  SET name = EXCLUDED.name,
      address = EXCLUDED.address,
      category = EXCLUDED.category,
      setup_completed = true,
      subscription_status = 'trial',
      subscription_tier = 'pro',
      trial_ends_at = COALESCE(public.business_profiles.trial_ends_at, EXCLUDED.trial_ends_at),
      current_period_ends_at = COALESCE(public.business_profiles.current_period_ends_at, EXCLUDED.current_period_ends_at),
      updated_at = NOW();

  INSERT INTO public.businesses (
    owner_id,
    name,
    contact_name,
    business_email,
    address,
    phone,
    hours_text,
    latitude,
    longitude,
    subscription_tier,
    updated_at
  )
  VALUES (
    qa_merchant_id,
    'QA Coffee Bar',
    'QA Merchant',
    qa_merchant_email,
    '120 S Main St, Grapevine, TX 76051',
    '555-0100',
    'Mon-Fri 8 AM-4 PM',
    32.9399,
    -97.0781,
    'pro',
    NOW()
  )
  ON CONFLICT (owner_id) DO UPDATE
  SET name = EXCLUDED.name,
      contact_name = EXCLUDED.contact_name,
      business_email = EXCLUDED.business_email,
      address = EXCLUDED.address,
      phone = EXCLUDED.phone,
      hours_text = EXCLUDED.hours_text,
      latitude = EXCLUDED.latitude,
      longitude = EXCLUDED.longitude,
      subscription_tier = EXCLUDED.subscription_tier,
      updated_at = NOW()
  RETURNING id INTO qa_business_id;

  INSERT INTO public.consumer_profiles (
    user_id,
    zip_code,
    age_range,
    gender,
    last_latitude,
    last_longitude,
    notification_mode,
    radius_miles,
    location_updated_at,
    updated_at
  )
  VALUES (
    qa_customer_id,
    '75063',
    '25_34',
    'prefer_not',
    32.9247,
    -96.9598,
    'all_nearby',
    10,
    NOW(),
    NOW()
  )
  ON CONFLICT (user_id) DO UPDATE
  SET zip_code = EXCLUDED.zip_code,
      last_latitude = EXCLUDED.last_latitude,
      last_longitude = EXCLUDED.last_longitude,
      notification_mode = EXCLUDED.notification_mode,
      radius_miles = EXCLUDED.radius_miles,
      location_updated_at = NOW(),
      updated_at = NOW();

  INSERT INTO public.favorites (user_id, business_id)
  VALUES (qa_customer_id, qa_business_id)
  ON CONFLICT (user_id, business_id) DO NOTHING;

  SELECT id INTO live_deal_id
  FROM public.deals
  WHERE business_id = qa_business_id
    AND title = 'QA Claimable BOGO Latte'
  LIMIT 1;

  IF live_deal_id IS NULL THEN
    INSERT INTO public.deals (
      business_id,
      title,
      description,
      price,
      start_time,
      end_time,
      claim_cutoff_buffer_minutes,
      max_claims,
      is_active,
      is_demo,
      timezone,
      poster_url,
      updated_at
    )
    VALUES (
      qa_business_id,
      'QA Claimable BOGO Latte',
      'Buy one latte and get a second latte free.',
      5.99,
      NOW() - INTERVAL '1 hour',
      NOW() + INTERVAL '7 days',
      30,
      100,
      true,
      false,
      'America/Chicago',
      NULL,
      NOW()
    )
    RETURNING id INTO live_deal_id;
  ELSE
    UPDATE public.deals
    SET description = 'Buy one latte and get a second latte free.',
        price = 5.99,
        start_time = NOW() - INTERVAL '1 hour',
        end_time = NOW() + INTERVAL '7 days',
        claim_cutoff_buffer_minutes = 30,
        max_claims = 100,
        is_active = true,
        is_demo = false,
        timezone = 'America/Chicago',
        updated_at = NOW()
    WHERE id = live_deal_id;
  END IF;

  SELECT id INTO expired_deal_id
  FROM public.deals
  WHERE business_id = qa_business_id
    AND title = 'QA Expired Wallet Ticket'
  LIMIT 1;

  IF expired_deal_id IS NULL THEN
    INSERT INTO public.deals (
      business_id,
      title,
      description,
      price,
      start_time,
      end_time,
      claim_cutoff_buffer_minutes,
      max_claims,
      is_active,
      is_demo,
      timezone,
      poster_url,
      updated_at
    )
    VALUES (
      qa_business_id,
      'QA Expired Wallet Ticket',
      'Expired QA ticket for wallet read-only validation.',
      4.50,
      NOW() - INTERVAL '5 days',
      NOW() - INTERVAL '2 days',
      30,
      50,
      false,
      false,
      'America/Chicago',
      NULL,
      NOW()
    )
    RETURNING id INTO expired_deal_id;
  ELSE
    UPDATE public.deals
    SET description = 'Expired QA ticket for wallet read-only validation.',
        price = 4.50,
        start_time = NOW() - INTERVAL '5 days',
        end_time = NOW() - INTERVAL '2 days',
        claim_cutoff_buffer_minutes = 30,
        max_claims = 50,
        is_active = false,
        is_demo = false,
        timezone = 'America/Chicago',
        updated_at = NOW()
    WHERE id = expired_deal_id;
  END IF;

  DELETE FROM public.deal_claims
  WHERE user_id = qa_customer_id
    AND deal_id = expired_deal_id
    AND claim_status = 'expired';

  INSERT INTO public.deal_claims (
    deal_id,
    user_id,
    token,
    expires_at,
    redeemed_at,
    claim_status,
    grace_period_minutes,
    acquisition_source,
    zip_at_claim,
    location_source_at_claim,
    app_version_at_claim,
    device_platform_at_claim,
    status_changed_at
  )
  VALUES (
    expired_deal_id,
    qa_customer_id,
    uuid_generate_v4()::TEXT,
    NOW() - INTERVAL '2 days',
    NULL,
    'expired',
    10,
    'unknown',
    '75063',
    'zip',
    'qa-seed',
    'android',
    NOW()
  );

  RAISE NOTICE 'QA customer seed ready.';
  RAISE NOTICE 'Merchant business: % (%)', 'QA Coffee Bar', qa_business_id;
  RAISE NOTICE 'Claimable deal id: %', live_deal_id;
  RAISE NOTICE 'Expired wallet deal id: %', expired_deal_id;
  RAISE NOTICE 'Customer remains shopper: %', qa_customer_email;
END $$;

SELECT
  'business' AS row_type,
  b.id::TEXT AS id,
  b.name AS label,
  u.email AS account_email
FROM public.businesses b
JOIN auth.users u ON u.id = b.owner_id
WHERE b.name = 'QA Coffee Bar'
UNION ALL
SELECT
  'deal' AS row_type,
  d.id::TEXT AS id,
  d.title AS label,
  u.email AS account_email
FROM public.deals d
JOIN public.businesses b ON b.id = d.business_id
JOIN auth.users u ON u.id = b.owner_id
WHERE b.name = 'QA Coffee Bar'
  AND d.title IN ('QA Claimable BOGO Latte', 'QA Expired Wallet Ticket')
UNION ALL
SELECT
  'customer_role' AS row_type,
  p.id::TEXT AS id,
  COALESCE(to_jsonb(p)->>'role', p.app_tab_mode) AS label,
  u.email AS account_email
FROM public.profiles p
JOIN auth.users u ON u.id = p.id
WHERE u.email = 'QA_CUSTOMER_EMAIL@example.com'; -- CHANGE THIS
