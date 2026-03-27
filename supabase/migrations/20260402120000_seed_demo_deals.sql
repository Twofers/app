-- Seed 3 demo deals for feed testing.
-- Idempotent: skips if demo business already exists.
-- Run from Supabase SQL editor (service-role context) or via `npx supabase db push`.

DO $$
DECLARE
  v_user_id   UUID := 'a0000000-0000-4000-8000-000000000001';
  v_biz_id    UUID := 'a0000000-0000-4000-8000-00000000c0de';
  v_now       TIMESTAMPTZ := NOW();
BEGIN

  -- 1. Demo auth user (idempotent)
  INSERT INTO auth.users (
    id, aud, role, email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin, is_sso_user,
    created_at, updated_at
  ) VALUES (
    v_user_id, 'authenticated', 'authenticated', 'demo@demo.com',
    crypt('demo12345', gen_salt('bf')),
    v_now,
    '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
    false, false,
    v_now, v_now
  )
  ON CONFLICT (id) DO NOTHING;

  -- 2. Demo business (idempotent)
  INSERT INTO businesses (
    id, owner_id, name, location, latitude, longitude,
    category, short_description, phone, hours_text,
    contact_name, business_email
  ) VALUES (
    v_biz_id, v_user_id,
    'Demo Roasted Bean Coffee',
    'Irving, TX',
    32.8141, -96.9489,
    'Coffee shop',
    'Neighborhood espresso bar for Twofer preview testers.',
    '(214) 555-0100',
    'Mon–Fri 7:00–19:00 · Sat–Sun 8:00–18:00',
    'Demo Owner',
    'hello@demo.twofer.app'
  )
  ON CONFLICT (id) DO NOTHING;

  -- 3. Delete any stale demo deals on this business before re-seeding
  DELETE FROM deals WHERE business_id = v_biz_id;

  -- 4. Insert 3 strong deals (all pass the guardrail)
  INSERT INTO deals (
    business_id, title, description, price,
    start_time, end_time,
    claim_cutoff_buffer_minutes, max_claims,
    is_active, poster_url, poster_storage_path,
    is_recurring, quality_tier
  ) VALUES
  (
    v_biz_id,
    '2-for-1 oat milk lattes',
    'Bring a friend — buy one oat milk latte, get one free.',
    6.50,
    v_now, v_now + INTERVAL '14 days',
    30, 200,
    true,
    'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=1200&q=80',
    null, false, 'strong'
  ),
  (
    v_biz_id,
    'Buy one pastry, get one free before 10am',
    'Second pastry free every morning with any hot coffee.',
    4.25,
    v_now, v_now + INTERVAL '10 days',
    30, 150,
    true,
    'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=1200&q=80',
    null, false, 'strong'
  ),
  (
    v_biz_id,
    'BOGO cold brew — second one free',
    'Two single-origin cold brews for the price of one. Weekend special.',
    8.00,
    v_now, v_now + INTERVAL '21 days',
    30, 80,
    true,
    'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=1200&q=80',
    null, false, 'strong'
  );

  RAISE NOTICE 'Demo seed complete: 3 deals on business %', v_biz_id;
END $$;
