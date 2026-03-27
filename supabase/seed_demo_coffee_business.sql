-- Repeatable PREVIEW/DEV seed: demo coffee business + deals for demo@demo.com
-- Run in Supabase SQL Editor after the user exists (in-app Demo login or Auth UI).

DO $$
DECLARE
  demo_uid uuid;
  bid uuid;
  preferred_id constant uuid := 'a0000000-0000-4000-8000-00000000c0de'::uuid;
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
      category
    )
    VALUES (
      preferred_id,
      demo_uid,
      'Demo Roasted Bean Coffee',
      '1234 Commerce St',
      'Dallas, TX',
      32.7831,
      -96.8067,
      '(214) 555-0100',
      'Mon–Fri 7:00–19:00 · Sat–Sun 8:00–18:00',
      'Neighborhood espresso bar for Twofer preview testers.',
      'Coffee shop'
    );
    bid := preferred_id;
  ELSE
    UPDATE public.businesses
    SET
      name = 'Demo Roasted Bean Coffee',
      address = '1234 Commerce St',
      location = 'Dallas, TX',
      latitude = 32.7831,
      longitude = -96.8067,
      phone = '(214) 555-0100',
      hours_text = 'Mon–Fri 7:00–19:00 · Sat–Sun 8:00–18:00',
      short_description = 'Neighborhood espresso bar for Twofer preview testers.',
      category = 'Coffee shop',
      updated_at = NOW()
    WHERE id = bid;
  END IF;

  DELETE FROM public.deals WHERE business_id = bid;

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
    poster_url,
    poster_storage_path,
    quality_tier
  )
  VALUES
    (
      bid,
      '2-for-1 oat milk lattes',
      'Bring a friend — two lattes for the price of one.',
      6.50,
      NOW(),
      NOW() + INTERVAL '14 days',
      30,
      200,
      true,
      'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=1200&q=80',
      NULL,
      'acceptable'
    ),
    (
      bid,
      'BOGO pastry + drip before 10am',
      'Buy one pastry and coffee, get one free before 10am.',
      4.25,
      NOW(),
      NOW() + INTERVAL '10 days',
      30,
      150,
      true,
      'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=1200&q=80',
      NULL,
      'acceptable'
    ),
    (
      bid,
      '2-for-1 cold brew flight',
      'Two single-origin cold brew samples for the price of one.',
      8.00,
      NOW(),
      NOW() + INTERVAL '21 days',
      30,
      80,
      true,
      'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=1200&q=80',
      NULL,
      'acceptable'
    );

  RAISE NOTICE 'Demo coffee business % seeded for user %', bid, demo_uid;
END $$;
