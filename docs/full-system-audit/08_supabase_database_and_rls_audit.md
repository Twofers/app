# Supabase database and RLS audit

## Inventory and migration state

There are 135 local migrations, and the hosted migration ledger has a matching entry for each through `20260812140000`. This proves ledger parity only—not that live policies/functions have no manual drift.

## F-001 — Direct deal publication bypass (P1)

The final owner policies permit insert/update based on ownership alone (`supabase/migrations/20260812130000_consolidate_deals_rls_policies.sql:110-127`) and deliberately omit billing enforcement (`:35-44`, `:104-127`). New deals default active (`supabase/migrations/20250127000000_initial_schema.sql:15-29`). The richer `can_business_publish` function (`supabase/migrations/20260730127000_stripe_business_billing_reconnection.sql:365-523`) is not enforced at the final write boundary.

Verified: current source/policy order, client direct-update reachability, official Edge checks, billing/verification helpers, feature flags, and grants were traced. Inferred pending catalog access: the hosted definitions are expected to reflect the matching ledger but were not independently dumped.

## F-002 — Public business lifecycle filter absent (P1)

Public grants expose business profile/location/contact fields (`supabase/migrations/20260705120000_businesses_pii_column_grants.sql:1-35`). The current nearby RPC lacks approval/verification predicates and includes all unlocated businesses (`supabase/migrations/20260802141000_nearby_geo_rpcs_include_unlocated.sql:24-53`). App RPC/direct fallback routes are reachable.

## Data correctness observations

The schema contains explicit claim/redemption, versioned offers, billing events/subscriptions, AI usage, admin/audit, and public-link domains. Multiple generations of migration policies require reviewers to start from the latest consolidating files. Any fix must be a forward migration; after an approved RLS-related apply, run `node scripts/probe-rls-smoke.mjs` immediately.

## Production verification needed

Read-only catalog queries should compare `pg_policies`, grants, functions, triggers, cron jobs, and storage policies to source. RLS mutation probes were not run because they require credentials and test-row writes.

