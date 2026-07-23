# Edge Functions audit

## Inventory

The repository has 72 local function directories; the hosted project reports all 72 active plus one remote-only active function, `ai-refine-ad-copy` (F-013). Function “active” status does not establish deployed bundle/source parity.

## Authentication failure paths

Safe unauthenticated live POSTs returned:

- `ai-create-deal`: 410, as intentionally disabled in source.
- `admin-dashboard-summary`: 401.
- `claim-deal`: 401.
- `redeem-token`: 401.

No success path or data mutation was attempted.

## High-risk function findings

- F-004: `claim-deal` and `release-claim` use nominal expiration instead of shared grace semantics.
- F-005: `stripe-create-checkout-session` trusts request source/price before charging.
- F-006: the same function consumes a billing token with a read-then-update race.
- F-013: remote-only AI behavior cannot be reviewed from source.

`publish-offer-version` checks owner, terms, suspension, and verification, but database writes remain separately reachable and its checks do not fully match the central publication eligibility helper (F-001).

## Cross-cutting requirements

Service-role functions must derive object authorization, validate all transitions, constrain payload size/type, rate-limit safely behind the actual proxy chain, sanitize upstream errors, avoid secret/code logging, use idempotency where external calls occur, and emit stable privacy-safe audit/error codes. Hosted secrets/provider modes and bundle hashes were not inspected.

