-- Seed Test Data
-- Run this in Supabase SQL Editor AFTER signing up via the app
-- Replace 'YOUR_USER_EMAIL@example.com' with your actual email

-- Step 1: Get user ID (user must exist - sign up via app first)
DO $$
DECLARE
  test_user_id UUID;
  test_business_id UUID;
  test_deal_id UUID;
  user_email TEXT := 'YOUR_USER_EMAIL@example.com'; -- CHANGE THIS
BEGIN
  -- Get user ID from auth.users
  SELECT id INTO test_user_id
  FROM auth.users
  WHERE email = user_email
  LIMIT 1;

  IF test_user_id IS NULL THEN
    RAISE EXCEPTION 'User not found. Please sign up via the app first with email: %', user_email;
  END IF;

  -- Step 2: Create business (or update if exists)
  INSERT INTO businesses (owner_id, name)
  VALUES (test_user_id, 'Test Coffee Shop')
  ON CONFLICT (owner_id) 
  DO UPDATE SET name = 'Test Coffee Shop', updated_at = NOW()
  RETURNING id INTO test_business_id;

  -- Step 3: Create active deal (ends in 7 days, 30min cutoff buffer)
  INSERT INTO deals (
    business_id,
    title,
    description,
    price,
    start_time,
    end_time,
    claim_cutoff_buffer_minutes,
    max_claims,
    is_active,
    poster_url
  )
  VALUES (
    test_business_id,
    '2-for-1 Lattes',
    'Get two lattes for the price of one! Perfect for sharing.',
    5.99,
    NOW(),
    NOW() + INTERVAL '7 days',
    30,
    100,
    true,
    NULL
  )
  ON CONFLICT DO NOTHING
  RETURNING id INTO test_deal_id;

  RAISE NOTICE '✅ Test data created successfully!';
  RAISE NOTICE '   User ID: %', test_user_id;
  RAISE NOTICE '   Business ID: %', test_business_id;
  RAISE NOTICE '   Deal ID: %', test_deal_id;
  RAISE NOTICE '';
  RAISE NOTICE 'You can now test claiming this deal in the app!';
END $$;

-- Verify the data was created
SELECT 
  'Business' as type,
  b.id::text as id,
  b.name as name,
  u.email as owner_email
FROM businesses b
JOIN auth.users u ON u.id = b.owner_id
WHERE u.email = 'YOUR_USER_EMAIL@example.com' -- CHANGE THIS
UNION ALL
SELECT 
  'Deal' as type,
  d.id::text as id,
  d.title as name,
  d.end_time::text as owner_email
FROM deals d
JOIN businesses b ON b.id = d.business_id
JOIN auth.users u ON u.id = b.owner_id
WHERE u.email = 'YOUR_USER_EMAIL@example.com' -- CHANGE THIS
  AND d.is_active = true;
