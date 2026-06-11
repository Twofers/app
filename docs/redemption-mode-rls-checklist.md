# Redemption Mode RLS Checklist

Migration draft: `supabase/migrations/20260712120000_redemption_mode_staff_sessions.sql`

Do not apply this migration until Dan explicitly approves it. The checks below are written for Supabase SQL editor / staging after the migration and new Edge Functions are deployed.

## Policies Added

- `redeemer_deals_select_guard`: redeemer JWTs can select only active deals for their own `business_id`.
- `redeemer_businesses_select_guard`: redeemer JWTs can select only their own public business row, still subject to existing column grants.
- `redeemer_*_block_all`: redeemer JWTs are blocked from direct table access to `deal_claims`, `profiles`, `consumer_profiles`, `push_tokens`, `favorites`, `business_profiles`, `business_locations`, `business_menu_items`, `deal_templates`, `app_analytics_events`, `ai_generation_logs`, `subscription_history`, reports, shares, invite validations, `app_config`, `rate_limits`, failed redemption attempts, and `redemptions` itself.
- `redemptions_owner_read`: owners can read redemption audit rows for their business — backed by an explicit `GRANT SELECT ON redemptions TO authenticated` (R1); without the grant the policy is dead.
- No direct redeemer insert policy is granted on `redemptions`; `confirm_staff_redemption` is the only staff insert path so the server can validate the claim first.
- `owner_redemption_security` stores the normal owner Redeem-tab PIN hash and is not directly granted to `anon` or `authenticated`; owner status/enable/disable/verify goes through `owner-redemption-security`. Setting a PIN while one exists requires the current PIN (R2); disable clears the hash.
- `failed_redeem_attempts` gains `redemption_device_id` (R4): the staff path's brute-force lockout is scoped per counter device, not per IP.
- All new/replaced functions revoke EXECUTE `FROM PUBLIC, anon` inside the migration itself (R1) — Supabase default privileges grant anon EXECUTE on every new function and `REVOKE FROM PUBLIC` alone does not remove it.
- `app_analytics_events_backup_20260708` is RLS-enabled and revoked from `anon` / `authenticated`.

> **Rule for every future table:** the `redeemer_*_block_all` loop only covers tables that exist when the migration runs. Any table created after `20260712120000` MUST add its own `redeemer_<table>_block_all` restrictive policy in its own migration, or redeemer JWTs fall through to whatever its normal authenticated policies allow.

## Required Manual Tests

Use a restricted staff session created by `activate-redemption-mode`.

1. Active own deals are visible:
   `select id, business_id, title from public.deals;`
   Expect only active rows for the staff JWT `business_id`.

2. Other business deals are not visible:
   `select id from public.deals where business_id = '<other-business-id>';`
   Expect zero rows.

3. Deal editing is denied:
   `update public.deals set title = title where id = '<own-deal-id>';`
   Expect RLS denial / zero rows updated.

4. Raw claim data is denied:
   `select * from public.deal_claims limit 1;`
   Expect zero rows or permission denial.

5. Payout, billing, analytics, and settings tables are denied:
   Try `select *` from `business_profiles`, `subscription_history`, `app_analytics_events`, `app_config`, and `ai_generation_logs`.
   Expect zero rows or permission denial.

6. Expired claim cannot redeem:
   Call `staff-redemption` with `action: "confirm"` for a claim past `expires_at + grace_period_minutes`.
   Expect `ok: false`, status `expired`.

7. Already redeemed claim cannot redeem again:
   Call `staff-redemption` twice for the same active claim.
   Expect first call `ok: true`, second call `ok: false`, status `already_redeemed`.

8. Different business claim cannot redeem:
   Call `staff-redemption` for a token/code whose deal belongs to another business.
   Expect `ok: false`, status `not_found` or HTTP 404.

9. Deactivated device token stops working:
   Activate a device, then call `manage-redemption-devices` with `action: "deactivate"`.
   Reuse the old staff JWT against `staff-redemption`.
   Expect `ok: false`, status `unauthorized`.

10. PIN exit failure modes:
    Enter five wrong PINs through `exit-redemption-mode`.
    Expect lockout. Enter the correct PIN after lockout expires.
    Expect device `active = false` and the app to land on the login screen —
    the device stores no owner session, so a successful exit ALWAYS ends
    signed out (R3). No owner restore should ever happen.

11. Owner Redeem-tab PIN setting:
    Enable the owner PIN with `owner-redemption-security` and a 4-6 digit PIN.
    Expect `owner_redemption_security.pin_hash` to be populated server-side and no plain PIN stored in the database.

12. Owner Redeem-tab PIN access:
    Open the merchant Redeem tab after enabling the owner PIN.
    Expect the QR scanner and manual redeem controls to stay hidden until `owner-redemption-security` verifies the PIN.

13. Owner PIN session lifetime:
    Enter the correct owner PIN once and redeem/scan normally.
    Background/foreground navigation should stay unlocked for that app process. Kill/restart the app and reopen the Redeem tab.
    Expect the PIN prompt again.

14. Owner PIN disable:
    Try turning the owner PIN off with an incorrect PIN.
    Expect denial and lockout after repeated failures. Turn it off with the correct PIN.
    Expect the Redeem tab to open without the PIN gate, and `pin_hash` to be
    cleared server-side (R2) — `status` should report `has_pin: false` and
    re-enabling should behave as a fresh setup.

15. Owner PIN change:
    Change the owner redemption PIN with an incorrect current PIN.
    Expect denial and failed-attempt tracking. Change it with the correct current PIN and a new 4-6 digit PIN.
    Expect the current app session to remain unlocked, the old PIN to fail after app restart, and the new PIN to unlock the Redeem tab.

16. Owner PIN rotation guard (R2):
    With a PIN enabled, call `owner-redemption-security` with `action: "enable"` and a new `pin` but no `current_pin` (or a wrong one).
    Expect the failed-verify shape (`PIN_INCORRECT` / 403, or `PIN_LOCKED` / 429 after 5 tries) and `pin_failed_attempts` to increment — NOT a silent overwrite, and NOT a lockout reset.
    Repeat with the correct `current_pin`. Expect the PIN to rotate and the counters to reset.

17. Staff redemption lockout (R4):
    From an active staff session, submit 10 unknown short codes within 5 minutes.
    Expect the 11th attempt to return 429 before any lookup. Verify the rows in `failed_redeem_attempts` carry this device's `redemption_device_id`.
    Re-scan an already-redeemed code repeatedly: expect `already_redeemed` responses and NO new failed-attempt rows (honest re-scans never count).
    A second activated device for the same business must remain unaffected (per-device scope).

18. Owner deletion sweep (R5):
    With a device locked in Redemption Mode, delete the owner's account through the app.
    Expect the linked staff auth user to be gone (sweep runs before the owner delete) and the business's `redemption_devices` / `redemptions` rows to cascade away.
    On the orphaned locked device, enter any exit PIN: `exit-redemption-mode` returns 404, and the app must clear its redemption state and land on the login screen instead of staying bricked.

## Edge Function Allow-List

Redeemer JWTs are accepted by:

- `staff-redemption`

Redeemer exit does not require a live staff JWT; `exit-redemption-mode` verifies `device_id`, SecureStore `exit_token`, and server-side PIN hash. A successful exit always ends signed out at the login screen — the device stores no owner session to restore (R3). A 404 (device row gone) makes the app self-clear to logged out (R5).

Normal owner/customer functions now reject redeemer JWTs with `REDEEMER_FORBIDDEN`.
