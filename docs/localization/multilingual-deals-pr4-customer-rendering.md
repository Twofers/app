# Multilingual Deals PR 4c - Customer Localization Rendering

Date: 2026-06-23

Branch: `codex/multilingual-deals-pr4-customer-rendering`

Checkpoint: `d27027fa`

## Scope

This slice connects approved localization storage to the customer render path without opening direct table access to `offer_versions` or `ad_localizations`.

## What Changed

- Added migration draft `20260728123000_customer_deal_localization_projection.sql`.
- Added `customer_deal_localizations(p_deal_ids uuid[], p_locale text)`, a `SECURITY DEFINER` RPC that returns only customer-safe localized creative for active published approved deals.
- Kept `offer_versions` and `ad_localizations` service-role-only; app roles receive RPC execution only.
- Added `fetchCustomerDealLocalizations()` for non-blocking client hydration. If the RPC is not deployed, the app falls back to existing deterministic/legacy rendering.
- Updated `buildLocalizedDealDisplay()` to prefer approved customer localization rows, then approval-bound `ad_spec` snapshots, then deterministic exact rendering, then legacy localized fields.
- Preserved exact mechanics: stored creative can supply the localized headline and supporting copy, while the exact offer line and terms still come from structured deal facts.
- Wired Home feed cards and Deal Detail to hydrate the approved row for the resolved customer locale.
- Passed localized locked-offer content into the composed-card offer facts so the visible exact offer line follows the selected customer language.

## Guardrails

- No Supabase migration was applied.
- No release build, submission, push, merge, tag, or deploy was performed.
- No secrets were printed.
- The RPC filters to active deals, published offer versions, enabled locales, approved QA decisions, and known localization statuses.
- Customer language switching still uses the same deal ID, offer version, claim pool, and inventory.

## Remaining PR4 Cleanup

- Business profile, wallet, and map preview still have legacy title-only paths and should move to the shared localized display helper in a follow-up slice.
- Real-device screenshot QA and native-speaker acceptance review remain operational gates before broad production launch.
- The migration must be explicitly approved and applied before production can read approved localization rows.
