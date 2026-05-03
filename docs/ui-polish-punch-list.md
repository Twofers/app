# UI Polish Punch List (No Redesign)

Focused on reliability and clarity for the pilot path. Recommendations are smallest-safe fixes.

## Empty States

- `app/create/menu-scan.tsx`: empty state is generic; keep current behavior but ensure messages distinguish "no readable lines" vs "config not set" vs "oversized image" (partially addressed for synthetic/config cases).
- `app/create/menu-offer.tsx`: verify empty menu copy always directs owners to `Scan menu` with one clear CTA.
- `app/(tabs)/dashboard.tsx`: confirm empty analytics state explains next best action (publish first deal / get first claim).

## Loading States

- `app/create/menu-scan.tsx`: scan progress is present; keep this pattern for all multi-step AI operations.
- `app/create/ai.tsx` and `app/create/ai-compose.tsx`: ensure loading copy does not imply success before response arrives.
- `app/(tabs)/billing.tsx`: loading/error transitions should avoid flicker between pricing fetch and fallback copy.

## Error Messages

- Replace any raw `error.message` shown in UI with translated, plain-language copy via existing helpers (`translateKnownApiMessage`, `parseFunctionError` improvements).
- Specifically verify create flow, billing checkout, and AI generation errors never surface RLS/Postgres/internal text to owners.

## Button and Header Consistency

- `app/create/ad-refine.tsx`: route now exists as a safe placeholder and sends users to `/create/ai`; keep this message plain and temporary until a real refine flow is restored.
- Ensure primary actions in create flow consistently use `PrimaryButton`, with one clear next step per screen.
- Normalize secondary labels such as "Scan menu", "Build an offer", and "Generate ad" for consistent owner language.

## Form Labels and Spacing

- `app/create/menu-scan.tsx`: field placeholders are clear; keep spacing and border style consistent with other create forms.
- Audit mixed-language labels in locales where some strings are still English (`es.json`, `ko.json`) to avoid pilot confusion.
- Confirm tab and screen headers map to owner mental model (Create, Wallet, Dashboard, Billing).

## Demo/Test Language Audit

- Confirm no demo-only copy appears for non-demo users in production builds.
- Keep demo helper messaging scoped to explicit demo accounts and preview modes.
- Validate diagnostics/debug screens are not surfaced as default user paths.

## Owner Create-Path Confusion

- Current create routes include multiple entry points (`quick`, `ai`, `ai-compose`, `reuse`, `menu-scan`, `menu-manager`, `menu-offer`), which can fragment behavior.
- For pilot, direct owners toward one documented primary path and treat other paths as secondary/deferred (see `docs/create-flow-simplification.md`).
