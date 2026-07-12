-- Finding 06 (money & trust audit), Option 1 (Dan confirmed 2026-07-06): visual
-- redeem stays customer-completed for the pilot, but must share the same
-- append-only audit trail as staff/owner redemptions and bind to a location.
--
-- public.redemptions currently only allows redeem_method IN ('staff_qr',
-- 'staff_manual') and code_type IN ('token', 'short_code') -- both written only
-- by confirm_staff_redemption. Widen both to a 'visual' value so
-- complete-visual-redeem can insert one row per completed visual redemption
-- (claim_id stays UNIQUE, so this still can't double-count a redemption).

BEGIN;

ALTER TABLE public.redemptions
  DROP CONSTRAINT IF EXISTS redemptions_redeem_method_check,
  ADD CONSTRAINT redemptions_redeem_method_check
    CHECK (redeem_method IN ('staff_qr', 'staff_manual', 'visual'));

ALTER TABLE public.redemptions
  DROP CONSTRAINT IF EXISTS redemptions_code_type_check,
  ADD CONSTRAINT redemptions_code_type_check
    CHECK (code_type IN ('token', 'short_code', 'visual'));

COMMENT ON COLUMN public.redemptions.redeem_method IS
  'staff_qr | staff_manual (confirm_staff_redemption) | visual (complete-visual-redeem, customer-completed).';
COMMENT ON COLUMN public.redemptions.code_type IS
  'token | short_code (staff lookup method) | visual (no code lookup -- claim already known to the caller).';

COMMIT;
