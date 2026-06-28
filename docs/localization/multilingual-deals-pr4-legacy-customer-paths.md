# Multilingual Deals PR 4d - Legacy Customer Path Cleanup

Date: 2026-06-23

Branch: `codex/multilingual-deals-pr4-legacy-customer-paths`

Checkpoint: `f7ef54b6`

## Scope

This slice removes the remaining direct customer-surface calls to legacy localized deal title/description helpers outside the shared localized display fallback.

## What Changed

- Business profile live-deal cards now resolve the customer deal locale, hydrate approved localization rows, and render through `buildLocalizedDealDisplay()`.
- Wallet claim cards, share copy, pass modals, and deal labels now use the shared localized display helper.
- Map preview deal cards now resolve/hydrate localized rows in the parent screen and pass a localized preview title into the render helper.
- Home claim-expiry reminder titles and Deal Detail share titles now use the same localized display path.
- Added a source-level regression test for Home, Deal Detail, Business, Wallet, and Map customer deal paths.

## Guardrails

- No Supabase migration was applied.
- No release build, submission, push, merge, tag, or deploy was performed.
- Customer claim IDs, redemption state, inventory, map marker selection, and navigation behavior were not changed.
- If the customer localization RPC is unavailable, these surfaces fall back through deterministic exact-offer rendering and then legacy localized fields.

## Remaining PR4 Work

- Real-device screenshot QA is still required before broad production launch.
- Native-speaker acceptance review remains required for U.S. Spanish and Korean.
- The customer localization projection migration still needs explicit approval before it can be applied.
