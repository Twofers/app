-- Mark known demo/sample content without changing ownership or deleting data.
-- Apply only after review; app code that selects is_demo expects these columns.

ALTER TABLE public.businesses
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

ALTER TABLE public.deals
  ADD COLUMN IF NOT EXISTS is_demo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.businesses.is_demo
  IS 'True for sample/test businesses shown to testers; not a real public offer source.';

COMMENT ON COLUMN public.deals.is_demo
  IS 'True for sample/test offers shown to testers; not redeemable as real offers.';

GRANT SELECT (is_demo) ON public.businesses TO anon, authenticated;
GRANT SELECT (is_demo) ON public.deals TO anon, authenticated;

UPDATE public.businesses
SET is_demo = true
WHERE id = '658a3ae5-fb8f-4fb5-b360-0d7d16923235';

UPDATE public.deals
SET is_demo = true
WHERE business_id = '658a3ae5-fb8f-4fb5-b360-0d7d16923235'
  AND id IN (
    '5c9be934-5952-4be0-aafb-6c32a0e2d363',
    'd43b5592-feaf-47f6-a18c-73a2a28b8ad6',
    '72f3c64a-7962-4c9f-b71a-2e67e09c44f1',
    'f2b32054-1ea3-423b-8972-0aba737176de',
    '9177c21a-c81f-469f-8a40-52219db96290',
    '1d59e7e8-2d72-45ad-9745-4c244d007a48',
    '1b8e97d2-3233-433c-8e5e-3113c297982d',
    'bb32ef14-8563-4273-99a9-6dabb4ff265c',
    'e72c51b6-9e9f-4a4f-90da-b7047e66336a',
    'd7f74b08-fe65-42aa-8f4b-95746e9d5638'
  );
