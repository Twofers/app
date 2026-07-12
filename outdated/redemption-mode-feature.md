# Redemption Mode (Staff Device Lock)

**Status:** Implemented on `audit/redemption-mode-merge` (migration `20260712120000` written but NOT applied — applying is a hard gate)
**Added:** June 10, 2026 · **Reconciled with code:** June 10, 2026 (post audit batches R1–R5)

## Problem

A business owner needs to let a cashier redeem customer deals at the counter without giving that person access to the full business account. Without this, anyone holding the counter device could edit deals, view payouts and analytics, or change account settings.

## Solution

A Redemption Mode built into the existing merchant app. No separate app. The owner flips the counter device into a locked single-purpose state where the only available action is redeeming deals. Security is enforced at the database level with Supabase Row Level Security, not just by hiding screens in the UI.

## How it works

1. The owner logs into the business account on a counter device (cheap phone or tablet that stays at the register).
2. In merchant settings, the owner activates Redemption Mode and sets a 4-6 digit exit PIN.
3. The app calls a Supabase Edge Function that swaps the device to a restricted session with a `redeemer` role claim scoped to that business_id.
4. The device locks to a single screen: QR scan or manual code entry, deal confirmation card, confirm button. No navigation out.
5. Exiting requires the PIN. A successful exit ends with the device signed out; the owner logs in fresh. The locked device never stores the owner's session.

## Concurrent sessions

The counter device runs its own restricted staff auth user, so it stays in Redemption Mode all day while the owner manages deals from a personal phone or laptop under the owner account. Changes sync, so pausing a deal from anywhere stops redemptions on the counter device within seconds (the database re-checks deal state on every scan). Sign-out uses scope local so logging out on one device never kills the session on another.

## Security model (RLS)

A session with the `redeemer` claim can only:

- SELECT active deals belonging to its own business_id (to validate scans)
- Call the staff redemption RPCs (`preview_staff_redemption` / `confirm_staff_redemption`), which return the deal title and timing only — no customer identifiers, tokens, or claim rows
- Redeem through those RPCs; the redeemer has no direct INSERT on the redemptions table. The RPCs are SECURITY DEFINER and write the audit row themselves after validation

Everything else is denied at the database level: no updates or deletes anywhere, no access to payouts, analytics, business settings, deal editing, or other merchants' data. Even a jailbroken UI can't get past this because the database itself refuses the queries.

Redemptions are validated server-side inside the RPCs: the deal must be active, within its redemption window, not already redeemed (one-time codes; claim_id is UNIQUE in the audit table), and belong to the requesting business. The staff path also has a per-device brute-force lockout: 10 failed code guesses (unknown or expired codes) in 5 minutes returns 429; honest re-scans of an already-redeemed code never count.

The owner-facing Redeem tab can additionally be gated by an owner PIN (server-hashed, PBKDF2). Changing or rotating that PIN always requires the current PIN; disabling it clears the stored hash, so re-enabling is a fresh setup.

## Device behavior

- The non-sensitive mode flag (device id, business id, label) persists in AsyncStorage; the staff session and the exit token live in SecureStore. The device stays locked through app restarts.
- The device holds NO owner login. Removing a device from the owner's settings deletes its staff auth user, which kills its tokens.
- Deleting the owner's account sweeps all linked staff users before the owner delete; an orphaned locked device detects the 404 on exit and releases itself to the login screen.
- The exit PIN and exit token are stored hashed server-side (PBKDF2 / SHA-256 of a 256-bit random token), never in plain text. Exit PIN entry locks for 5 minutes after 5 failures.
- Each redemption is logged with timestamp, deal id, business id, and an owner-set device label (e.g. "Front Counter iPad") for an audit trail the owner can read (and only the owner — staff tokens are blocked from the table).

## Future consideration (v2)

Individual staff accounts with a redeemer role under each business. Adds per-employee audit trails but requires invitation flows, role management UI, and password resets. Deferred until merchants ask for it.

## Test checklist before done

The restricted token must fail when attempting to: read another business's deals, edit any deal, read payout or settings tables, redeem an expired or already-used code, or redeem for a different business_id.
