# Multilingual Deals PR4 No Multilingual Push

Date: 2026-06-23

Scope: this slice records and guards the v1 launch decision that push delivery is not multilingual. It does not change notification copy, deploy an Edge Function, send any push notifications, change feature flags, start a release build, or apply a Supabase migration.

Policy:

- Keep the existing `send-deal-push` behavior for v1.
- Do not claim push notifications are multilingual in release notes, dashboards, or store copy.
- Do not call translation, transcreation, semantic QA, or customer localization storage during notification send.
- Feed and deal-detail localization remain independent from push delivery.
- A future multilingual push plan should be separate and should come after feed, detail, owner UI, native review, and real-device QA are stable.

Current source guard:

- `supabase/functions/send-deal-push/index.ts` builds copy from structured offer facts with `buildDeterministicDealChannelCopy()`.
- It does not select legacy translated title/description columns.
- It does not query `customer_deal_localizations`.
- It does not call the AI translation provider, transcreation provider, semantic QA, or any localization bundle lookup.

Regression test:

```bash
npx vitest run supabase/functions/_shared/send-deal-push-source.test.ts
```

Rollout gate:

```bash
npm run gate:localization-rollout
```

Remaining limitations:

- Existing push copy is intentionally not localized by customer locale.
- Owner-facing claim push has its own static owner-locale catalog and is not part of the customer multilingual deal rollout.
- A future multilingual push feature would need a separate privacy, QA, reviewer, telemetry, and delivery plan.
