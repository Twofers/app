# Multilingual Deals Plan Completion Audit

Date: 2026-06-23

Branch: `codex/multilingual-plan-completion-audit`

Safety checkpoint: `07f6e0ba` (`Align multilingual deployment docs`)

Source plan: `TWOFER_MULTILINGUAL_DEALS_CODEX_PLAN_V1_1.md`

Current status: local implementation checkpoint with Spanish and Korean reviewer sign-off recorded. Not deployed to production.

## Purpose

This audit maps the v1.1 multilingual deals plan to current repo evidence. It is intentionally stricter than a green test run: tests prove specific behavior, while this document records which plan requirements are locally implemented, which are externally blocked, and which production-changing actions remain hard-gated.

No Supabase migration was applied, no Edge Function was redeployed, no hosted feature flag was changed, no push notification was sent, and no release build was started for this audit.

## Status Vocabulary

- Local evidence present: code, tests, docs, or scripts in this repo support the requirement for local/internal validation.
- Operationally blocked: the remaining work needs Dan-owned store, hosted backend, deployment, or production actions.
- Hard-gated: the action requires explicit approval before Codex can run it, such as applying migrations, redeploying Edge Functions, changing hosted flags, or building a release.

## Overall Result

| Area | Status | Evidence |
| --- | --- | --- |
| PR 1 locale foundation | Local evidence present; production wording has Spanish and Korean reviewer sign-off recorded. | `lib/supported-locales.ts`, `lib/localized-offer-renderer.ts`, `lib/korean-counter-registry.ts`, `lib/offer-locale-templates.ts`, `docs/localization/native-review-log.md` |
| PR 2 owner UI and customer switching | Local evidence present; real-device typography remains operationally blocked. | `docs/localization/multilingual-deals-pr2-locale-switching.md`, `app/create/ai.tsx`, `app/deal/[id].tsx`, `app/(tabs)/wallet.tsx`, `lib/localized-deal-display.ts` |
| PR 3 source creative and transcreation | Local evidence present behind default-off flags; hosted activation remains hard-gated. | `supabase/functions/_shared/ai-localization-provider.ts`, `lib/ad-localization.ts`, `lib/ad-translation-qa.ts`, `lib/ad-locale-presentation-resolver.ts`, `lib/ad-localization-storage.ts` |
| PR 4 approval binding and cleanup | Local evidence present for approval, publish enforcement, customer rendering, rollout dashboards, acceptance packet, reviewer sign-off, and viewer-language push/Share Deal guards. | `lib/ad-localization-approval.ts`, `supabase/functions/publish-offer-version/index.ts`, `lib/customer-deal-localizations.ts`, `scripts/check-localization-rollout-gates.mjs`, `scripts/generate-localization-rollout-dashboard.mjs`, `docs/localization/multilingual-deals-native-acceptance-packet.md` |
| Broad localization readiness | Reviewer blockers cleared locally. | `LOCALIZATION_BROAD_PRODUCTION_ROLLOUT=true npm run gate:localization-rollout` is expected to pass after Juan and June sign-off records are present. Production deployment still requires explicit approval. |

## PR 1 Matrix

| Plan item | Status | Evidence |
| --- | --- | --- |
| Supported locale types | Local evidence present | `SUPPORTED_LOCALES` and metadata in `lib/supported-locales.ts`; coverage in `lib/ad-locale-resolver.test.ts` and `lib/localized-offer-renderer.test.ts`. |
| Customer locale resolver | Local evidence present | `lib/ad-locale-resolver.ts`, `lib/localized-deal-display.ts`, `lib/deal-localization.test.ts`. |
| Merchant localization profile | Local evidence present | `lib/merchant-localization-profile.ts`, `lib/merchant-localization-profile.test.ts`. |
| Localized term model | Local evidence present | `lib/localized-offer-terms.ts`, `lib/ad-localization-storage.ts`. |
| Deterministic offer renderers | Local evidence present | `lib/localized-offer-renderer.ts`, `lib/localized-offer-renderer.test.ts`. |
| Native-reviewed template versioning | Local evidence present for versioning; Spanish/Korean reviewer sign-off recorded | `lib/offer-locale-templates.ts`, `docs/localization/native-review-log.md`, `lib/localization-rollout-gate.ts`. |
| Korean counter registry and fallback | Local evidence present; Korean approval recorded | `lib/korean-counter-registry.ts`, `docs/localization/korean-counter-registry.md`, `lib/localization-rollout-gate.test.ts`. |
| UTF-8 and font checks | Local source/test evidence present; real-device QA blocked | `lib/localized-offer-renderer.test.ts`, `lib/ad-locale-presentation-resolver.test.ts`, `docs/localization/multilingual-deals-pr4-locale-screenshot-qa.md`. |
| Feature flags | Local evidence present | `.env.example`, `lib/runtime-env.ts`, `lib/runtime-env.test.ts`, `docs/localization/multilingual-deals-production-approval-runbook.md`. |

## PR 2 Matrix

| Plan item | Status | Evidence |
| --- | --- | --- |
| Localized creation interface | Local evidence present | `app/create/ai.tsx`, `lib/resolve-deal-flow-language.locale.test.ts`, locale resources under `lib/i18n`. |
| Saved authoring locale and source selector | Local evidence present | `chooseDraftSourceLocale` and source-locale publish payloads in `app/create/ai.tsx`; source locale tests in `supabase/functions/_shared/ai-generate-ad-variants-telemetry-source.test.ts`. |
| Localized validation and progress states | Local evidence present | `app/create/ai.tsx`, `lib/i18n/api-messages.test.ts`, `lib/runtime-env.test.ts`. |
| Customer preferred locale | Local evidence present | `lib/customer-deal-locale-storage.ts`, `app/deal/[id].tsx`, `app/(tabs)/wallet.tsx`. |
| Automatic feed locale resolution | Local evidence present | `app/business/[id].tsx`, `app/(tabs)/wallet.tsx`, `lib/localized-deal-display.ts`, `lib/customer-localized-paths-source.test.ts`. |
| Deal-detail language selector | Local evidence present | `app/deal/[id].tsx` renders `SUPPORTED_LOCALES` controls and persists selection through customer locale storage. |
| Shared renderer integration | Local evidence present | `lib/localized-deal-display.ts`, `components/composed-ad-card/ComposedAdCard.tsx`, `lib/localized-deal-display.test.ts`. |
| Locale telemetry | Local evidence present | `app/deal/[id].tsx`, `app/create/ai.tsx`, `supabase/functions/publish-offer-version/index.ts`. |
| Real-device typography tests | Local reviewer evidence recorded for the localization gate | Android screenshot QA evidence was packaged under `qa-artifacts/`; iOS release QA remains a separate store-readiness activity. |

## PR 3 Matrix

| Plan item | Status | Evidence |
| --- | --- | --- |
| Locale-aware source creative generation | Local evidence present | `supabase/functions/ai-generate-ad-variants/prompt.ts`, `lib/ad-source-locale-policy.ts`, `docs/localization/multilingual-deals-pr3-source-locale-policy.md`. |
| Winning-candidate-only transcreation | Local evidence present | `supabase/functions/_shared/ai-localization-provider.ts`, `lib/ad-localization.ts`, `docs/localization/multilingual-deals-pr3-generation-bundle.md`. |
| Protected terms | Local evidence present | `docs/localization/protected-term-policy.md`, `lib/ad-translation-qa.ts`, `lib/ad-localization.test.ts`. |
| Independent translation QA | Local evidence present | `AD_LOCALIZATION_SEMANTIC_QA_PROMPT_VERSION` and `reviewAdLocalizationSemanticQa()` in `supabase/functions/_shared/ai-localization-provider.ts`; `docs/localization/multilingual-deals-pr3-independent-qa.md`. |
| Targeted repair | Local evidence present | `buildAdLocalizationRepairPrompt()`, `repairAdLocalizationTranscreation()`, `docs/localization/multilingual-deals-pr3-targeted-repair.md`, `docs/localization/multilingual-deals-pr3-repair-orchestration.md`. |
| Deterministic target-language fallback | Local evidence present | `lib/ad-localization.ts`, `lib/ad-localization.test.ts`. |
| Locale-specific presentation resolver | Local evidence present | `lib/ad-locale-presentation-resolver.ts`, `lib/ad-locale-presentation-resolver.test.ts`. |
| Localization storage and hashes | Local evidence present; migration apply blocked | `lib/ad-localization-storage.ts`, `supabase/migrations/20260728120000_ad_localization_storage.sql`, `supabase/functions/_shared/ad-localization-storage-migration.test.ts`. |
| Optional owner language previews | Local evidence present | `lib/ad-owner-language-preview.ts`, `lib/ad-owner-language-preview.test.ts`, `docs/localization/multilingual-deals-pr3-owner-previews.md`. |

## PR 4 Matrix

| Plan item | Status | Evidence |
| --- | --- | --- |
| Verified-bundle automatic approval | Local evidence present | `lib/ad-localization-approval.ts`, `lib/ad-localization-approval.test.ts`, `docs/localization/multilingual-deals-pr4-approval-binding.md`. |
| Exact localization and term-snapshot hashes | Local evidence present | `lib/ad-localization-storage.ts`, `lib/ad-localization-approval.ts`, `lib/localization-approval-validation.test.ts`. |
| Publish enforcement | Local evidence present; Edge redeploy hard-gated | `supabase/functions/publish-offer-version/index.ts`, `supabase/functions/_shared/publish-offer-version-function.test.ts`, `docs/localization/multilingual-deals-pr4-server-enforcement.md`. |
| Selective per-locale screenshot QA | Local evidence present for trigger/gate; real screenshot capture blocked | `lib/ad-locale-presentation-resolver.ts`, `app/create/ai.tsx`, `docs/localization/multilingual-deals-pr4-locale-screenshot-qa.md`. |
| Native review workflow and logs | Local evidence present; Spanish/Korean sign-off recorded | `docs/localization/native-review-log.md`, `lib/localization-rollout-gate.ts`, `lib/localization-rollout-gate.test.ts`. |
| Full real-device suite | Operationally blocked | Requires Dan-controlled real-device QA. No release build or TestFlight action was started. |
| Rollout dashboards | Local evidence present | `scripts/generate-localization-rollout-dashboard.mjs`, `lib/localization-rollout-dashboard.test.ts`, `docs/localization/multilingual-deals-pr4-rollout-dashboard.md`. |
| Removal of legacy untranslated customer paths | Local evidence present | `docs/localization/multilingual-deals-pr4-legacy-customer-paths.md`, `lib/customer-localized-paths-source.test.ts`. |
| Native-speaker acceptance review | Reviewer sign-off recorded | Juan and June reported no issues on 2026-07-03; Korean counters and Spanish/Korean templates are marked reviewed. |
| Operational handoff | Local evidence present | `docs/localization/multilingual-deals-production-approval-runbook.md`, `docs/localization/multilingual-deals-native-acceptance-packet.md`, `docs/deployment-command-plan.md`, `docs/production-deploy-checklist.md`. |

## Required Automated Test Coverage

| Plan test group | Current evidence |
| --- | --- |
| 28.1 Source locale | `lib/ad-localization.test.ts`, `supabase/functions/_shared/ai-generate-ad-variants-telemetry-source.test.ts`, `lib/offer-version-publish.test.ts`. |
| 28.2 Offer-fact invariance | `lib/deal-offer-contract.test.ts`, `lib/localized-offer-renderer.test.ts`, `lib/ad-translation-qa.test.ts`. |
| 28.3 Localized terms | `lib/ad-localization-storage.test.ts`, `docs/localization/protected-term-policy.md`. |
| 28.4 Korean templates and counters | `lib/localized-offer-renderer.test.ts`, `lib/localization-rollout-gate.test.ts`, `docs/localization/korean-counter-registry.md`. |
| 28.5 Transcreation | `lib/ad-localization.test.ts`, `supabase/functions/_shared/ai-localization-provider.test.ts`, `lib/ad-translation-qa.test.ts`. |
| 28.6 Locale resolution | `lib/ad-locale-resolver.test.ts`, `lib/localized-deal-display.test.ts`, `lib/customer-localized-paths-source.test.ts`. |
| 28.7 Owner UI | `lib/ad-owner-language-preview.test.ts`, `lib/ad-owner-language-preview-source.test.ts`, `app/create/ai.tsx` source guards via existing tests. |
| 28.8 Presentation | `lib/ad-locale-presentation-resolver.test.ts`, `lib/ad-presentation-spec.test.ts`, `lib/ad-text-fit.test.ts`. |
| 28.9 Approval and publishing | `lib/ad-localization-approval.test.ts`, `lib/localization-approval-validation.test.ts`, `supabase/functions/_shared/publish-offer-version-function.test.ts`. |
| 28.10 Viewer-language push and Share Deal | `supabase/functions/_shared/send-deal-push-source.test.ts`, `supabase/functions/_shared/weekly-deal-digest-source.test.ts`, `supabase/functions/_shared/deal-link-viewer-locale-source.test.ts`, `supabase/functions/_shared/viewer-locale.test.ts`, `docs/localization/viewer-language-invariant-plan.md`. |

## Completion Blockers

The localization reviewer blockers are clear. The plan is not deployed to production until all of the following production-changing actions are approved and completed:

1. Dan explicitly approves applying the localization migrations.
2. Dan explicitly approves redeploying affected Edge Functions.
3. Dan explicitly approves hosted feature flag changes.
4. Dan explicitly approves any future release build or store submission.
5. iOS/TestFlight and store-release QA are completed through the release checklist.

With reviewer signoff recorded, `LOCALIZATION_BROAD_PRODUCTION_ROLLOUT=true npm run gate:localization-rollout` should pass. That pass is not deployment approval.

## Audit Command

Run:

```bash
npm run gate:localization-plan
```

This command checks that the audit artifact, the plan evidence anchors, and the production-blocker language remain present in the repo. It does not certify production readiness.
