-- Seed file for initial test data
-- Note: This requires a user to exist first (created via auth.signUp)
-- For testing, you can manually create a business and deal via Supabase Studio
-- or run this after creating a test user

-- Example: Create a test business (replace 'USER_ID_HERE' with actual auth user UUID)
-- INSERT INTO businesses (owner_id, name)
-- VALUES ('USER_ID_HERE', 'Test Coffee Shop')
-- ON CONFLICT (owner_id) DO NOTHING;

-- Example: Create a test deal (replace 'BUSINESS_ID_HERE' with actual business UUID)
-- INSERT INTO deals (business_id, title, description, price, end_time, claim_cutoff_buffer_minutes, max_claims, is_active)
-- VALUES (
--   'BUSINESS_ID_HERE',
--   '2-for-1 Lattes',
--   'Get two lattes for the price of one!',
--   5.99,
--   NOW() + INTERVAL '7 days',
--   30,
--   100,
--   true
-- );

-- For now, this file is empty - deals should be created via the app or Supabase Studio
