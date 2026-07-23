# Reliability and data correctness audit

## State-machine correctness

F-004 proves inconsistent effective expiration across claim/redeem/release/wallet paths. F-001 proves publication state can be changed outside the strongest eligibility path. F-005/F-006 show Checkout initiation and token state are not one authoritative, atomic server decision.

Required cross-domain invariants:

1. One atomic transition owns draft-to-live publication.
2. One grace-aware timestamp owns claim validity everywhere.
3. One idempotent decision owns redemption completion across retries/devices.
4. One server-selected product owns Checkout and entitlement mapping.
5. Webhook processing is idempotent and safe under duplicate/out-of-order events.
6. External push/email/wallet/AI failure is retryable and cannot corrupt the authoritative transaction.
7. Cleanup jobs expose last-success, rows-processed, failure, and retry state.

## Concurrency and time

Add explicit tests for double claim, claim-vs-release, double redeem, visual begin/complete races, checkout-token replay, webhook reordering, subscription expiry vs publish/claim, and admin-vs-owner updates. Exercise exact timestamps before/at/after nominal expiration, grace expiration, trial end, daylight-saving changes, and business time zones.

## Data recovery

Backup/restore objectives, point-in-time recovery, job replay, provider outage behavior, and incident rollback were not evidenced. Database migrations should be forward-only; fixes involving RLS need immediate post-apply smoke tests. External financial corrections require reconciliation, not database rollback alone.

