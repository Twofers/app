-- Repeatable PREVIEW/DEV seed: polished demo business + menu + mixed-status deals.
-- Run in Supabase SQL Editor after the user exists (in-app Demo login or Auth UI).

DO $$
DECLARE
  demo_uid uuid;
  bid uuid;
  loc_id uuid;
  deal_live_1 uuid;
  deal_live_2 uuid;
  preferred_id constant uuid := 'a0000000-0000-4000-8000-00000000c0de'::uuid;
  trial_ends timestamptz := NOW() + INTERVAL '30 days';
BEGIN
  SELECT id INTO demo_uid
  FROM auth.users
  WHERE lower(email) = lower('demo@demo.com')
  LIMIT 1;

  IF demo_uid IS NULL THEN
    RAISE EXCEPTION 'No auth user demo@demo.com — sign up or use Demo login in the app first.';
  END IF;

  SELECT id INTO bid FROM public.businesses WHERE owner_id = demo_uid LIMIT 1;

  IF bid IS NULL THEN
    INSERT INTO public.businesses (
      id,
      owner_id,
      name,
      address,
      location,
      latitude,
      longitude,
      phone,
      hours_text,
      short_description,
      category,
      contact_name,
      business_email,
      subscription_tier
    )
    VALUES (
      preferred_id,
      demo_uid,
      'Cedar & Bean Cafe',
      '120 S Main St',
      'Grapevine, TX',
      32.9407,
      -97.0781,
      '(817) 555-0148',
      'Mon-Fri 7 AM - 7 PM | Sat-Sun 8 AM - 6 PM',
      'Neighborhood cafe serving espresso, scratch pastries, and quick lunch plates in downtown Grapevine.',
      'Cafe & Bakery',
      'Maya Patel',
      'hello@cedarbean.cafe',
      'pro'
    );
    bid := preferred_id;
  ELSE
    UPDATE public.businesses
    SET
      name = 'Cedar & Bean Cafe',
      address = '120 S Main St',
      location = 'Grapevine, TX',
      latitude = 32.9407,
      longitude = -97.0781,
      phone = '(817) 555-0148',
      hours_text = 'Mon-Fri 7 AM - 7 PM | Sat-Sun 8 AM - 6 PM',
      short_description = 'Neighborhood cafe serving espresso, scratch pastries, and quick lunch plates in downtown Grapevine.',
      category = 'Cafe & Bakery',
      contact_name = 'Maya Patel',
      business_email = 'hello@cedarbean.cafe',
      subscription_tier = 'pro',
      updated_at = NOW()
    WHERE id = bid;
  END IF;

  INSERT INTO public.business_profiles (
    user_id,
    owner_id,
    name,
    address,
    category,
    setup_completed,
    subscription_status,
    subscription_tier,
    trial_ends_at,
    current_period_ends_at
  )
  VALUES (
    demo_uid,
    demo_uid,
    'Cedar & Bean Cafe',
    '120 S Main St',
    'Cafe & Bakery',
    true,
    'trial',
    'pro',
    trial_ends,
    trial_ends
  )
  ON CONFLICT (user_id) DO UPDATE
  SET
    owner_id = EXCLUDED.owner_id,
    name = EXCLUDED.name,
    address = EXCLUDED.address,
    category = EXCLUDED.category,
    setup_completed = EXCLUDED.setup_completed,
    subscription_status = EXCLUDED.subscription_status,
    subscription_tier = EXCLUDED.subscription_tier,
    trial_ends_at = EXCLUDED.trial_ends_at,
    current_period_ends_at = EXCLUDED.current_period_ends_at;

  BEGIN
    SELECT id INTO loc_id
    FROM public.business_locations
    WHERE business_id = bid
    ORDER BY created_at ASC
    LIMIT 1;

    IF loc_id IS NULL THEN
      INSERT INTO public.business_locations (business_id, name, address, phone, lat, lng)
      VALUES (
        bid,
        'Grapevine Main Street',
        '120 S Main St, Grapevine, TX 76051',
        '(817) 555-0148',
        32.9407,
        -97.0781
      )
      RETURNING id INTO loc_id;
    ELSE
      UPDATE public.business_locations
      SET
        name = 'Grapevine Main Street',
        address = '120 S Main St, Grapevine, TX 76051',
        phone = '(817) 555-0148',
        lat = 32.9407,
        lng = -97.0781
      WHERE id = loc_id;
    END IF;
  EXCEPTION WHEN undefined_table THEN
    loc_id := NULL;
  END;

  BEGIN
    DELETE FROM public.business_menu_items
    WHERE business_id = bid
      AND source = 'manual'
      AND name IN (
        'Oat Milk Latte',
        'Vanilla Cortado',
        'Single-Origin Cold Brew',
        'Matcha Latte',
        'Butter Croissant',
        'Blueberry Muffin'
      );

    INSERT INTO public.business_menu_items (business_id, name, category, price_text, sort_order, source, description, archived_at)
    VALUES
      (bid, 'Oat Milk Latte', 'Coffee', '$6.50', 1, 'manual', 'Double shot with house oat milk.', NULL),
      (bid, 'Vanilla Cortado', 'Coffee', '$5.25', 2, 'manual', 'Short milk-forward espresso drink.', NULL),
      (bid, 'Single-Origin Cold Brew', 'Cold Coffee', '$5.75', 3, 'manual', 'Rotating seasonal single-origin brew.', NULL),
      (bid, 'Matcha Latte', 'Tea', '$6.00', 4, 'manual', 'Ceremonial matcha with choice of milk.', NULL),
      (bid, 'Butter Croissant', 'Pastry', '$4.25', 5, 'manual', 'Flaky all-butter morning pastry.', NULL),
      (bid, 'Blueberry Muffin', 'Pastry', '$4.50', 6, 'manual', 'Baked in-house with lemon sugar top.', NULL);
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  DELETE FROM public.deals
  WHERE business_id = bid
    AND (
      title IN (
        'Buy One Latte, Get One Free',
        '2-for-1 Pastry Pair Before Noon',
        'BOGO Iced Tea Launch Special',
        'Weekday Cold Brew 2-for-1',
        'Saturday Bakery Box BOGO',
        '2-for-1 oat milk lattes (live)',
        'Morning pastry pair + drip (live)',
        'After-school iced latte happy hour (scheduled)',
        'Weekday 2-for-1 cold brew window (recurring)',
        'Saturday bakery box bogo (recurring)',
        '2-for-1 Latte Pair'
      )
      OR title LIKE 'BOGO: 2-for-1 Cold Brew Pair%'
    );

  INSERT INTO public.deals (
    business_id,
    location_id,
    title,
    description,
    price,
    start_time,
    end_time,
    claim_cutoff_buffer_minutes,
    max_claims,
    is_active,
    poster_url,
    poster_storage_path,
    quality_tier,
    is_recurring,
    days_of_week,
    window_start_minutes,
    window_end_minutes,
    timezone
  )
  VALUES
    (
      bid,
      loc_id,
      'Buy One Latte, Get One Free',
      'Bring a friend: buy any handcrafted latte and get a second latte free.',
      6.50,
      NOW(),
      NOW() + INTERVAL '20 days',
      30,
      220,
      true,
      'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=1200&q=80',
      NULL,
      'acceptable',
      false,
      NULL,
      NULL,
      NULL,
      NULL
    ),
    (
      bid,
      loc_id,
      '2-for-1 Pastry Pair Before Noon',
      'Buy one fresh-baked pastry before noon and get a second pastry free.',
      4.75,
      NOW(),
      NOW() + INTERVAL '16 days',
      30,
      180,
      true,
      'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=1200&q=80',
      NULL,
      'acceptable',
      false,
      NULL,
      NULL,
      NULL,
      NULL
    ),
    (
      bid,
      loc_id,
      'BOGO Iced Tea Launch Special',
      'Starts this week: buy one house iced tea and get a second free.',
      4.50,
      NOW() + INTERVAL '2 days',
      NOW() + INTERVAL '12 days',
      30,
      140,
      true,
      'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1200&q=80',
      NULL,
      'acceptable',
      false,
      NULL,
      NULL,
      NULL,
      NULL
    ),
    (
      bid,
      loc_id,
      'Weekday Cold Brew 2-for-1',
      'Monday-Friday from 2-5 PM, buy one cold brew and get one free.',
      5.75,
      NOW(),
      NOW() + INTERVAL '30 days',
      30,
      260,
      true,
      'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=1200&q=80',
      NULL,
      'acceptable',
      true,
      ARRAY[1,2,3,4,5],
      840,
      1020,
      'America/Chicago'
    ),
    (
      bid,
      loc_id,
      'Saturday Bakery Box BOGO',
      'Every Saturday morning, buy one pastry box and get a second box free.',
      12.00,
      NOW(),
      NOW() + INTERVAL '45 days',
      30,
      120,
      true,
      'https://images.unsplash.com/photo-1483695028939-5bb13f8648b0?w=1200&q=80',
      NULL,
      'acceptable',
      true,
      ARRAY[6],
      480,
      720,
      'America/Chicago'
    );

  SELECT id INTO deal_live_1 FROM public.deals WHERE business_id = bid AND title = 'Buy One Latte, Get One Free' LIMIT 1;
  SELECT id INTO deal_live_2 FROM public.deals WHERE business_id = bid AND title = '2-for-1 Pastry Pair Before Noon' LIMIT 1;

  BEGIN
    DELETE FROM public.deal_claims
    WHERE user_id = demo_uid
      AND deal_id IN (deal_live_1, deal_live_2);

    INSERT INTO public.deal_claims (
      deal_id,
      user_id,
      token,
      expires_at,
      redeemed_at,
      claim_status,
      redeem_method,
      grace_period_minutes,
      acquisition_source,
      device_platform_at_claim
    )
    VALUES
      (
        deal_live_1,
        demo_uid,
        left(md5(random()::text || clock_timestamp()::text), 24),
        NOW() + INTERVAL '10 days',
        NOW() - INTERVAL '5 hours',
        'redeemed',
        'visual',
        10,
        'demo_seed',
        'demo'
      ),
      (
        deal_live_2,
        demo_uid,
        left(md5(random()::text || clock_timestamp()::text), 24),
        NOW() + INTERVAL '8 days',
        NULL,
        'active',
        NULL,
        10,
        'demo_seed',
        'demo'
      );
  EXCEPTION WHEN undefined_column THEN
    NULL;
  END;

  BEGIN
    DELETE FROM public.app_analytics_events
    WHERE business_id = bid
      AND context @> '{"seed":"demo_business_seed_v2"}'::jsonb;

    INSERT INTO public.app_analytics_events (
      event_name,
      user_id,
      business_id,
      deal_id,
      context,
      app_version,
      device_platform
    )
    SELECT
      e.event_name,
      demo_uid,
      bid,
      e.deal_id,
      jsonb_build_object('source', 'demo_seed', 'seed', 'demo_business_seed_v2', 'ordinal', e.ordinal),
      'demo-seed',
      'demo'
    FROM (
      SELECT 'deal_viewed'::text AS event_name, deal_live_1 AS deal_id, gs AS ordinal FROM generate_series(1, 36) gs
      UNION ALL
      SELECT 'deal_opened'::text, deal_live_1, gs FROM generate_series(1, 18) gs
      UNION ALL
      SELECT 'deal_viewed'::text, deal_live_2, gs FROM generate_series(1, 24) gs
      UNION ALL
      SELECT 'deal_opened'::text, deal_live_2, gs FROM generate_series(1, 11) gs
    ) e;
  EXCEPTION WHEN undefined_table THEN
    NULL;
  END;

  RAISE NOTICE 'Polished demo business % seeded for user %', bid, demo_uid;
END $$;
