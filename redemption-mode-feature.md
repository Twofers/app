# Redemption Mode (Staff Device Lock)

**Status:** Planned
**Added:** June 10, 2026

## Problem

A business owner needs to let a cashier redeem customer deals at the counter without giving that person access to the full business account. Without this, anyone holding the counter device could edit deals, view payouts and analytics, or change account settings.

## Solution

A Redemption Mode built into the existing merchant app. No separate app. The owner flips the counter device into a locked single-purpose state where the only available action is redeeming deals. Security is enforced at the database level with Supabase Row Level Security, not just by hiding screens in the UI.

## How it works

1. The owner logs into the business account on a counter device (cheap phone or tablet that stays at the register).
2. In merchant settings, the owner activates Redemption Mode and sets a 4-6 digit exit PIN.
3. The app calls a Supabase Edge Function that swaps the device to a restricted session with a `redeemer` role claim scoped to that business_id.
4. The device locks to a single screen: QR scan or manual code entry, deal confirmation card, confirm button. No navigation out.
5. Exiting requires the PIN, which restores the owner session.

## Concurrent sessions

Supabase allows the same account to be signed in on multiple devices at once. The counter device stays in Redemption Mode all day while the owner manages deals from a personal phone or laptop. Changes sync, so pausing a deal from anywhere stops redemptions on the counter device within seconds. Sign-out uses scope local so logging out on one device never kills the session on another.

## Security model (RLS)

A session with the `redeemer` claim can only:

- SELECT active deals belonging to its own business_id (to validate scans)
- SELECT the minimum customer-facing fields needed to confirm a redemption
- INSERT into the redemptions table for its own business_id

Everything else is denied at the database level: no updates or deletes anywhere, no access to payouts, analytics, business settings, deal editing, or other merchants' data. Even a jailbroken UI can't get past this because the database itself refuses the queries.

Redemption inserts are validated server-side through a database function or Edge Function: deal must be active, within its redemption window, not already redeemed (one-time codes), and belong to the requesting business.

## Device behavior

- The mode flag and restricted session persist in AsyncStorage, so the device stays locked through app restarts.
- The exit PIN is verified server-side or stored hashed, never in plain text.
- Each redemption is logged with timestamp, deal id, business id, and an owner-set device label (e.g. "Front Counter iPad") for an audit trail.

## Future consideration (v2)

Individual staff accounts with a redeemer role under each business. Adds per-employee audit trails but requires invitation flows, role management UI, and password resets. Deferred until merchants ask for it.

## Test checklist before done

The restricted token must fail when attempting to: read another business's deals, edit any deal, read payout or settings tables, redeem an expired or already-used code, or redeem for a different business_id.
