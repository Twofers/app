# Multilingual Deals PR4 No Multilingual Push

Date: 2026-06-23

Status update 2026-07-03: this v1 launch decision is superseded for future localization work by `docs/localization/viewer-language-invariant-plan.md`. The old PR4 behavior remains useful historical context, but it no longer satisfies the product rule that customer-visible deal and notification copy must render in the viewer's language.

Scope: this slice originally recorded and guarded the v1 launch decision that push delivery was not multilingual. It did not change notification copy, deploy an Edge Function, send any push notifications, change feature flags, start a release build, or apply a Supabase migration.

Historical policy:

- Keep the existing `send-deal-push` behavior for v1.
- Do not claim push notifications are multilingual in release notes, dashboards, or store copy.
- Do not call translation, transcreation, semantic QA, or customer localization storage during notification send.
- Feed and deal-detail localization remain independent from push delivery.
- A future multilingual push plan should be separate and should come after feed, detail, owner UI, native review, and real-device QA are stable.

Superseding local implementation:

- `supabase/functions/send-deal-push/index.ts` now builds customer deal-release push copy per recipient locale with `buildDealReleasePushCopy()`.
- `supabase/functions/weekly-deal-digest/index.ts` now builds digest push copy per recipient locale with `buildDigestPushCopy()`.
- `supabase/functions/deal-link/index.ts` now resolves `lang`/`Accept-Language` and renders localized Share Deal landing copy.
- `supabase/migrations/20260801121000_profiles_app_locale.sql` adds `profiles.app_locale` for server-rendered recipient-language copy. Applying it remains hard-gated.
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

- Hosted production cannot claim recipient-language push until the `profiles.app_locale` migration is applied and `send-deal-push`, `weekly-deal-digest`, and `deal-link` are redeployed with approval.
- Owner-facing claim push has its own static owner-locale catalog and is not part of the customer multilingual deal rollout.
- Real-device/native reviewer QA should cover the new push/share fallback strings before broad rollout claims.
