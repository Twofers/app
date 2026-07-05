# Multilingual Deals PR4 Rollout Dashboard

Date: 2026-06-23

Scope: this slice adds a local rollout dashboard command for Dan's release review. It does not deploy analytics, read hosted production data, change feature flags, start a release build, or apply a Supabase migration.

Use:

```bash
npm run dashboard:localization-rollout
```

To save a local artifact for review:

```bash
npm run dashboard:localization-rollout -- --out artifacts/localization-rollout-dashboard.md
```

The generated dashboard is sourced from checked-in local files:

- `lib/localization-rollout-gate.ts`
- `docs/localization/native-review-log.md`
- `docs/localization/multilingual-deals-native-acceptance-packet.md`
- `lib/offer-locale-templates.ts`
- `lib/korean-counter-registry.ts`
- `supabase/functions/publish-offer-version/index.ts`

It reports:

- per-locale reviewer status, screenshot QA status, template review counts, Korean counter review counts, and broad-production blocker state;
- publish telemetry field coverage for the `ai_ad_versioned_publish` event;
- native review log row counts and final sign-off counts;
- native acceptance packet scenario and reviewer-question coverage;
- Korean counter review items;
- operator notes for broad Spanish and Korean rollout.

Current expected local state:

- English is allowed through the localization-specific gate.
- U.S. Spanish is allowed through the localization-specific gate because Juan signed off, Spanish templates are reviewed, and screenshot QA is recorded.
- Korean is allowed through the localization-specific gate because June signed off, Korean templates are reviewed, Korean counters are approved, and screenshot QA is recorded.

Remaining limitations:

- This is a source/readiness dashboard, not a live analytics dashboard.
- Hosted analytics will not include the new localization publish fields until Dan explicitly approves redeploying `publish-offer-version`.
- Reviewer sign-off has been recorded from Juan and June. Future new localized surfaces still need reviewer evidence before they inherit this approval.
- Do not commit local generated artifacts unless they are intentionally sanitized and approved for source control.
