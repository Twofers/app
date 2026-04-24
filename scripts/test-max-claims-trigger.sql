-- Smoke test: confirm trg_enforce_deal_max_claims blocks over-limit inserts.
-- Returns a single row so the JSON CLI shows a visible PASS/FAIL.

BEGIN;

INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
VALUES
  ('00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'race-test+owner@example.com', crypt('test', gen_salt('bf')), now(), now(), now()),
  ('00000000-0000-0000-0000-000000000043', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'race-test+claimer@example.com', crypt('test', gen_salt('bf')), now(), now(), now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO businesses (id, owner_id, name, created_at)
VALUES ('11111111-1111-1111-1111-111111111111', '00000000-0000-0000-0000-000000000042', 'Race Test Café', now())
ON CONFLICT (id) DO NOTHING;

INSERT INTO deals (id, business_id, title, description, end_time, is_active, max_claims, created_at)
VALUES ('22222222-2222-2222-2222-222222222222', '11111111-1111-1111-1111-111111111111',
        '2-for-1 lattes (race test)', 'Buy one latte, get one free — smoke test for max_claims trigger',
        now() + interval '1 hour', true, 2, now())
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  i int;
  ok_count int := 0;
  blocked_count int := 0;
  other_count int := 0;
  first_other text := '';
  last_err text;
BEGIN
  FOR i IN 1..5 LOOP
    BEGIN
      INSERT INTO deal_claims (deal_id, user_id, token, expires_at, short_code, claim_status, grace_period_minutes, created_at)
      VALUES ('22222222-2222-2222-2222-222222222222', '00000000-0000-0000-0000-000000000043',
              gen_random_uuid(), now() + interval '1 hour',
              'R' || lpad(i::text, 5, '0'), 'active', 10, now());
      ok_count := ok_count + 1;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS last_err = MESSAGE_TEXT;
      IF last_err = 'MAX_CLAIMS_REACHED' THEN
        blocked_count := blocked_count + 1;
      ELSE
        other_count := other_count + 1;
        IF first_other = '' THEN first_other := last_err; END IF;
      END IF;
    END;
  END LOOP;

  -- Persist the result in a temp table we can SELECT from.
  CREATE TEMP TABLE IF NOT EXISTS smoke_result (inserted int, blocked int, other int, first_other text, pass boolean);
  DELETE FROM smoke_result;
  INSERT INTO smoke_result VALUES (
    ok_count, blocked_count, other_count, first_other,
    ok_count = 2 AND blocked_count = 3 AND other_count = 0
  );
END $$;

-- Clean up the test rows so they don't pollute the project.
DELETE FROM deal_claims WHERE deal_id = '22222222-2222-2222-2222-222222222222';
DELETE FROM deals WHERE id = '22222222-2222-2222-2222-222222222222';
DELETE FROM businesses WHERE id = '11111111-1111-1111-1111-111111111111';
DELETE FROM auth.users WHERE id IN ('00000000-0000-0000-0000-000000000042', '00000000-0000-0000-0000-000000000043');

SELECT inserted, blocked, other, first_other, pass FROM smoke_result;

COMMIT;
