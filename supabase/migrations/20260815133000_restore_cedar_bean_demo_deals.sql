-- Restore the five canonical Cedar & Bean sample offers for 45 days.
--
-- These rows are intentionally marked is_demo=true. The app labels them as
-- sample content, and claim-deal rejects demo offers, so they remain visible
-- for browsing without being represented as redeemable real-world offers.
--
-- This migration is idempotent by (business_id, title), does not delete rows,
-- and does not consume deal credits for the internal demo business.

BEGIN;

DO $$
DECLARE
  v_enabled_trigger_count integer;
BEGIN
  SELECT count(*)
  INTO v_enabled_trigger_count
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND t.tgenabled = 'O'
    AND (
      (c.relname = 'businesses' AND t.tgname IN (
        'businesses_require_invite_trg',
        'businesses_protect_server_columns'
      ))
      OR
      (c.relname = 'deals' AND t.tgname IN (
        'deals_set_deal_credit_location_before_insert',
        'deals_charge_deal_credit_after_insert',
        'deals_block_suspended_location_write'
      ))
    );

  IF v_enabled_trigger_count <> 5 THEN
    RAISE EXCEPTION
      'Cedar & Bean restoration stopped: expected five enabled safety triggers, found %.',
      v_enabled_trigger_count;
  END IF;
END;
$$;

-- A migration runs as the database role, not as a service-role JWT. Temporarily
-- bypass the client-only business insert/protected-column guards so the internal
-- sample row can retain its server-owned demo/lifecycle markers.
ALTER TABLE public.businesses DISABLE TRIGGER businesses_require_invite_trg;
ALTER TABLE public.businesses DISABLE TRIGGER businesses_protect_server_columns;

-- Demo rows must not consume merchant deal credits or be blocked by a stale
-- billing entitlement on the legacy disabled owner account.
ALTER TABLE public.deals DISABLE TRIGGER deals_set_deal_credit_location_before_insert;
ALTER TABLE public.deals DISABLE TRIGGER deals_charge_deal_credit_after_insert;
ALTER TABLE public.deals DISABLE TRIGGER deals_block_suspended_location_write;

DO $$
DECLARE
  v_demo_owner_id uuid;
  v_business_id uuid;
  v_offer record;
BEGIN
  SELECT u.id
  INTO v_demo_owner_id
  FROM auth.users u
  WHERE lower(u.email) IN ('demo@demo.com', 'demo@twofer.app')
  ORDER BY CASE lower(u.email)
    WHEN 'demo@demo.com' THEN 0
    ELSE 1
  END
  LIMIT 1;

  IF v_demo_owner_id IS NULL THEN
    RAISE EXCEPTION
      'Cedar & Bean restoration stopped: the retained legacy demo owner was not found.';
  END IF;

  SELECT b.id
  INTO v_business_id
  FROM public.businesses b
  WHERE b.owner_id = v_demo_owner_id
     OR (
       b.name = 'Cedar & Bean Cafe'
       AND b.is_demo = true
     )
  ORDER BY CASE WHEN b.owner_id = v_demo_owner_id THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_business_id IS NULL THEN
    INSERT INTO public.businesses (
      owner_id,
      name,
      contact_name,
      business_email,
      address,
      location,
      latitude,
      longitude,
      phone,
      hours_text,
      short_description,
      category,
      subscription_tier,
      is_demo,
      status,
      access_level,
      verification_status,
      can_publish_cached,
      first_approved_at,
      updated_at
    )
    VALUES (
      v_demo_owner_id,
      'Cedar & Bean Cafe',
      'Maya Patel',
      'hello@cedarbean.cafe',
      '120 S Main St',
      'Grapevine, TX',
      32.9407,
      -97.0781,
      '555-0100',
      'Mon-Fri 7 AM-7 PM; Sat-Sun 8 AM-6 PM',
      'A sample cafe used to demonstrate Twofer offers. This is not a real merchant listing.',
      'Cafe & Bakery',
      'pro',
      true,
      'active',
      'internal_test',
      'manual_verified',
      true,
      now(),
      now()
    )
    RETURNING id INTO v_business_id;
  ELSE
    UPDATE public.businesses
    SET
      name = 'Cedar & Bean Cafe',
      contact_name = 'Maya Patel',
      business_email = 'hello@cedarbean.cafe',
      address = '120 S Main St',
      location = 'Grapevine, TX',
      latitude = 32.9407,
      longitude = -97.0781,
      phone = '555-0100',
      hours_text = 'Mon-Fri 7 AM-7 PM; Sat-Sun 8 AM-6 PM',
      short_description = 'A sample cafe used to demonstrate Twofer offers. This is not a real merchant listing.',
      category = 'Cafe & Bakery',
      subscription_tier = 'pro',
      is_demo = true,
      status = 'active',
      access_level = 'internal_test',
      verification_status = 'manual_verified',
      can_publish_cached = true,
      first_approved_at = COALESCE(first_approved_at, now()),
      updated_at = now()
    WHERE id = v_business_id;
  END IF;

  FOR v_offer IN
    SELECT *
    FROM (
      VALUES
        (
          'Buy One Latte, Get One Free',
          'Bring a friend: buy any handcrafted latte and get a second latte free.',
          6.50::numeric,
          220,
          'https://images.unsplash.com/photo-1461023058943-07fcbe16d735?w=1200&q=80',
          false,
          NULL::integer[],
          NULL::integer,
          NULL::integer,
          'handcrafted latte',
          650
        ),
        (
          '2-for-1 Pastry Pair Before Noon',
          'Buy one fresh-baked pastry before noon and get a second pastry free.',
          4.75::numeric,
          180,
          'https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=1200&q=80',
          false,
          NULL::integer[],
          NULL::integer,
          NULL::integer,
          'fresh-baked pastry',
          475
        ),
        (
          'BOGO Iced Tea Launch Special',
          'Buy one house iced tea and get a second house iced tea free.',
          4.50::numeric,
          140,
          'https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=1200&q=80',
          false,
          NULL::integer[],
          NULL::integer,
          NULL::integer,
          'house iced tea',
          450
        ),
        (
          'Weekday Cold Brew 2-for-1',
          'Monday-Friday from 2-5 PM, buy one cold brew and get a second cold brew free.',
          5.75::numeric,
          260,
          'https://images.unsplash.com/photo-1517701550927-30cf4ba1dba5?w=1200&q=80',
          true,
          ARRAY[1, 2, 3, 4, 5]::integer[],
          840,
          1020,
          'cold brew',
          575
        ),
        (
          'Saturday Bakery Box BOGO',
          'Every Saturday from 8 AM-noon, buy one pastry box and get a second pastry box free.',
          12.00::numeric,
          120,
          'https://images.unsplash.com/photo-1483695028939-5bb13f8648b0?w=1200&q=80',
          true,
          ARRAY[6]::integer[],
          480,
          720,
          'pastry box',
          1200
        )
    ) AS offer(
      title,
      description,
      price,
      max_claims,
      poster_url,
      is_recurring,
      days_of_week,
      window_start_minutes,
      window_end_minutes,
      item_description,
      item_value_cents
    )
  LOOP
    UPDATE public.deals
    SET
      description = v_offer.description,
      source_locale = 'en',
      title_en = v_offer.title,
      description_en = v_offer.description,
      price = v_offer.price,
      start_time = now() - interval '1 hour',
      end_time = now() + interval '45 days',
      claim_cutoff_buffer_minutes = 30,
      max_claims = v_offer.max_claims,
      is_active = true,
      is_demo = true,
      poster_url = v_offer.poster_url,
      poster_storage_path = NULL,
      is_recurring = v_offer.is_recurring,
      days_of_week = v_offer.days_of_week,
      window_start_minutes = v_offer.window_start_minutes,
      window_end_minutes = v_offer.window_end_minutes,
      timezone = 'America/Chicago',
      deal_status = 'LIVE',
      eligibility_status = 'VALID',
      eligibility_reason_code = NULL,
      eligibility_message = NULL,
      customer_value_percent = 50,
      deal_type = 'BUY_ONE_GET_ONE_FREE',
      applies_to = 'SECOND_ITEM',
      discount_percent = NULL,
      required_purchase_quantity = 1,
      free_item_quantity = 1,
      required_item_description = v_offer.item_description,
      required_item_retail_value_cents = v_offer.item_value_cents,
      free_item_description = v_offer.item_description,
      free_item_retail_value_cents = v_offer.item_value_cents,
      free_item_discount_percent = 100,
      item_description = v_offer.item_description,
      item_retail_value_cents = v_offer.item_value_cents
    WHERE business_id = v_business_id
      AND title = v_offer.title;

    IF NOT FOUND THEN
      INSERT INTO public.deals (
        business_id,
        title,
        description,
        source_locale,
        title_en,
        description_en,
        price,
        start_time,
        end_time,
        claim_cutoff_buffer_minutes,
        max_claims,
        is_active,
        is_demo,
        poster_url,
        poster_storage_path,
        is_recurring,
        days_of_week,
        window_start_minutes,
        window_end_minutes,
        timezone,
        deal_status,
        eligibility_status,
        customer_value_percent,
        deal_type,
        applies_to,
        required_purchase_quantity,
        free_item_quantity,
        required_item_description,
        required_item_retail_value_cents,
        free_item_description,
        free_item_retail_value_cents,
        free_item_discount_percent,
        item_description,
        item_retail_value_cents
      )
      VALUES (
        v_business_id,
        v_offer.title,
        v_offer.description,
        'en',
        v_offer.title,
        v_offer.description,
        v_offer.price,
        now() - interval '1 hour',
        now() + interval '45 days',
        30,
        v_offer.max_claims,
        true,
        true,
        v_offer.poster_url,
        NULL,
        v_offer.is_recurring,
        v_offer.days_of_week,
        v_offer.window_start_minutes,
        v_offer.window_end_minutes,
        'America/Chicago',
        'LIVE',
        'VALID',
        50,
        'BUY_ONE_GET_ONE_FREE',
        'SECOND_ITEM',
        1,
        1,
        v_offer.item_description,
        v_offer.item_value_cents,
        v_offer.item_description,
        v_offer.item_value_cents,
        100,
        v_offer.item_description,
        v_offer.item_value_cents
      );
    END IF;
  END LOOP;
END;
$$;

ALTER TABLE public.deals ENABLE TRIGGER deals_block_suspended_location_write;
ALTER TABLE public.deals ENABLE TRIGGER deals_charge_deal_credit_after_insert;
ALTER TABLE public.deals ENABLE TRIGGER deals_set_deal_credit_location_before_insert;

ALTER TABLE public.businesses ENABLE TRIGGER businesses_protect_server_columns;
ALTER TABLE public.businesses ENABLE TRIGGER businesses_require_invite_trg;

COMMIT;
