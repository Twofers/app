-- Make the current Cedar & Bean QA live deal claimable while keeping the
-- remaining seeded sample offers marked as demo-only.
--
-- The previous demo-content marker migration correctly made sample content
-- unredeemable. Cedar & Bean now has one live QA deal that Dan wants to use for
-- customer claim/QR testing, so unmark only that surfaced offer and its parent
-- business. Other Cedar & Bean deals keep their per-deal is_demo=true marker.

DO $$
DECLARE
  v_business_count integer;
  v_deal_count integer;
BEGIN
  UPDATE public.businesses
  SET is_demo = false
  WHERE name = 'Cedar & Bean Cafe';

  GET DIAGNOSTICS v_business_count = ROW_COUNT;
  IF v_business_count = 0 THEN
    RAISE EXCEPTION 'Expected Cedar & Bean Cafe business row was not found.';
  END IF;

  UPDATE public.deals d
  SET
    is_demo = false,
    is_active = true,
    start_time = LEAST(d.start_time, now() - interval '1 hour'),
    end_time = GREATEST(d.end_time, now() + interval '7 days')
  FROM public.businesses b
  WHERE b.id = d.business_id
    AND b.name = 'Cedar & Bean Cafe'
    AND d.title = 'Buy One Latte, Get One Free';

  GET DIAGNOSTICS v_deal_count = ROW_COUNT;
  IF v_deal_count = 0 THEN
    RAISE EXCEPTION 'Expected Cedar & Bean live QA deal was not found.';
  END IF;
END $$;
