# Claims and redemption audit

## F-004 — Grace-period state corruption (P1)

The shared redemption rule allows `expires_at + 10 minutes` (`supabase/functions/_shared/claim-redeem.ts:3-14`), and wallet/stale-redemption logic recognizes that window. `claim-deal` instead expires active/redeeming claims at raw `expires_at` (`supabase/functions/claim-deal/index.ts:523-530`) and then excludes them from the active set (`:532-551`). `release-claim` also uses raw expiration (`supabase/functions/release-claim/index.ts:91-103`).

Reachable scenario: during grace, a shopper requests another claim or release. The first claim can be marked expired while redemption still expects it valid; the active check can then allow another claim. This can cause lost value, inconsistent wallet state, and disputes. No compensating database constraint/helper was found that restores the original claim after the mutation.

Centralize effective expiration in one database/helper definition and apply it to claim, release, visual/token/staff redeem, wallet, cleanup, reads, and concurrency handling.

## Other controls

Dedicated claim, visual redeem begin/complete/cancel, token redeem, staff redemption, device management, and stale-finalization functions exist. Redeemer-role restrictions are shared. Unauthenticated claim/redeem live probes returned 401.

## Verification gaps

Real-device QR/visual redeem, authorized staff/device boundaries, two-device races, retry/idempotency, offline transitions, push/wallet follow-up, time zones, and DST were not exercised. Sensitive claim/QR/redemption values must never be transcribed during later tests.

