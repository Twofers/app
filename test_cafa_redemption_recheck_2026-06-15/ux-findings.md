# Test Cafa Claim + Redemption Recheck - 2026-06-15

Branch: `codex/customer-account-qa-fixes`
Runtime tested: Android emulator dev-client bundle plus Supabase edge function calls.

## Remote Data Confirmed

- `Test Cafa` is owned by the provided business account.
- `Test Cafa` is non-demo.
- Two live non-demo deals are available.

## Verified

- Opened the live `Afternoon 20% off at Test Cafa` deal from the customer account.
- Customer claim succeeded.
- The claim count for that deal increased from zero to one.
- Business owner redemption via the deployed `redeem-token` edge function succeeded.
- The claimed ticket is now marked redeemed.
- The business owner PIN is enabled, present, and verifies successfully.

## Safety Notes

- No QR token, claim code, password, PIN, auth token, or redemption code is included in these recheck notes.
- A prior Cedar & Bean QA claim on the same customer account was canceled to satisfy the one-active-claim-at-a-time rule before claiming Test Cafa.
