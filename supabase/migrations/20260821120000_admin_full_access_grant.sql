-- approve_full_access: let an admin grant working access with no Checkout step.
--
-- Background. Every approve_* decision before this landed the business in
-- `approved_not_activated`: setup only, with AI, publishing, credits, and new
-- claims all waiting on Stripe. There was no way to hand a comp, a partner, a
-- pilot fast-track, or an internal test account real access without payment.
--
-- Why this migration is only three columns. The grant deliberately does NOT
-- change the application's `status`: claim_approved_business_application_for_user
-- (migration 20260817120000) only matches unclaimed applications whose status is
-- 'approved_not_activated', so any other status would strand a grant that was
-- approved before the owner ever signed up. The grant therefore travels on these
-- marker columns, and the live state is applied either immediately (the business
-- already exists — admin-business-applications does it inline) or right after the
-- owner claims (get-business-onboarding-context).
--
-- Nothing here touches RLS, policies, or grants: business_applications is already
-- revoked from anon and authenticated, so the new columns are server-only by
-- inheritance and no policy needs revisiting.

BEGIN;

ALTER TABLE public.business_applications
  ADD COLUMN IF NOT EXISTS full_access_trial_days integer NULL,
  ADD COLUMN IF NOT EXISTS full_access_granted_at timestamptz NULL,
  ADD COLUMN IF NOT EXISTS full_access_granted_by uuid NULL
    REFERENCES auth.users(id) ON DELETE SET NULL;

-- Same 1..120 bound the existing trial_days column uses (20260730124000), so an
-- admin cannot hand out a decade of free access through a typo in the days box.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.business_applications'::regclass
      AND conname = 'business_applications_full_access_trial_days_range'
  ) THEN
    ALTER TABLE public.business_applications
      ADD CONSTRAINT business_applications_full_access_trial_days_range
      CHECK (
        full_access_trial_days IS NULL
        OR (full_access_trial_days >= 1 AND full_access_trial_days <= 120)
      );
  END IF;
END
$$;

COMMENT ON COLUMN public.business_applications.full_access_trial_days IS
  'approve_full_access only: countdown length in days for an admin-granted trial that is live immediately with no Checkout step. NULL on every other decision. Consumed by get-business-onboarding-context when the owner claims an application whose business did not exist at approval time.';

COMMENT ON COLUMN public.business_applications.full_access_granted_at IS
  'When an admin granted full access without payment. NULL on every other decision.';

COMMENT ON COLUMN public.business_applications.full_access_granted_by IS
  'Admin auth user who granted full access without payment. Paired with the admin_business_application_approved_full_access_comp audit row.';

COMMIT;
