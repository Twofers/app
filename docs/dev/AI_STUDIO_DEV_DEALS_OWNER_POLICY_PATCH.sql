-- Dev-only follow-up for AI Deal Studio owner-read validation.
--
-- The AI Studio owner-read helper in AI_STUDIO_DEV_OWNER_READ_PATCH.sql fixes
-- draft tables, media tables, and private AI asset storage. The general RLS
-- probe also exercises `deals`; its owner policies previously joined
-- `businesses.owner_id` directly, which can fail after owner_id column grants
-- are revoked. Keep public active-deal reads unchanged and replace only the
-- owner branches with the dev helper.

BEGIN;

DROP POLICY IF EXISTS "Businesses can read their own deals" ON public.deals;
CREATE POLICY "Businesses can read their own deals"
ON public.deals FOR SELECT
TO authenticated
USING (public.ai_studio_dev_user_owns_business(business_id));

DROP POLICY IF EXISTS "Businesses can insert their own deals" ON public.deals;
CREATE POLICY "Businesses can insert their own deals"
ON public.deals FOR INSERT
TO authenticated
WITH CHECK (public.ai_studio_dev_user_owns_business(business_id));

DROP POLICY IF EXISTS "Businesses can update their own deals" ON public.deals;
CREATE POLICY "Businesses can update their own deals"
ON public.deals FOR UPDATE
TO authenticated
USING (public.ai_studio_dev_user_owns_business(business_id))
WITH CHECK (public.ai_studio_dev_user_owns_business(business_id));

DROP POLICY IF EXISTS "Businesses can delete ended own deals" ON public.deals;
CREATE POLICY "Businesses can delete ended own deals"
ON public.deals FOR DELETE
TO authenticated
USING (
  end_time <= now()
  AND public.ai_studio_dev_user_owns_business(business_id)
);

COMMIT;
