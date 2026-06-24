# Multilingual Deals Production Approval Runbook

Date: 2026-06-23

Scope: this runbook is the local handoff for moving the multilingual deal system from implemented code to a production rollout decision. It does not approve, apply, deploy, build, submit, or enable anything by itself.

## Current State

- English (`en-US`) has internal ownership recorded under Dan / Twofer admin.
- U.S. Spanish (`es-US`) and Korean (`ko-KR`) are available for internal code QA, but broad production is blocked.
- No Supabase migration has been applied from this multilingual rollout.
- No Edge Function has been redeployed from this multilingual rollout.
- No hosted multilingual feature flag has been enabled.
- Push notifications are intentionally not multilingual in this release.

## Hard Gates Before Broad Production

Do not enable broad Spanish production until all of these are true:

- A named U.S. Spanish reviewer is recorded in `docs/localization/native-review-log.md`.
- Spanish templates, UI strings, accessibility labels, prompt policies, deterministic fallback wording, and representative screenshots are signed off.
- `lib/localization-rollout-gate.ts` marks `es-US` as signed off with screenshot QA passed.
- `lib/offer-locale-templates.ts` marks Spanish launch templates reviewed.

Do not enable broad Korean production until all of these are true:

- A named Korean reviewer is recorded in `docs/localization/native-review-log.md`.
- Korean templates, UI strings, accessibility labels, prompt policies, fallback wording, counters, and representative screenshots are signed off.
- `lib/localization-rollout-gate.ts` marks `ko-KR` as signed off with screenshot QA passed.
- `lib/offer-locale-templates.ts` marks Korean launch templates reviewed.
- `lib/korean-counter-registry.ts` marks approved Korean counters with reviewer metadata.

Do not apply migrations, redeploy Edge Functions, set hosted secrets, create builds, submit stores, push, merge, tag, or reset without Dan's explicit approval.

## Required Local Verification Before Asking For Approval

Run these from the repo root and keep the output with the release notes:

```powershell
npx tsc --noEmit
npm run lint
npx vitest run
npm run typecheck:functions
npm run copy:evaluate
npm run gate:ai-ad
npm run gate:localization-rollout
npm run dashboard:localization-rollout
npx expo export --platform android --output-dir C:\tmp\twofer-metro-probe-multilingual-approval
```

For a broad-production readiness assertion, this command must fail while reviewers or screenshot QA are still pending, and must pass only after the review records are updated:

```powershell
$env:LOCALIZATION_BROAD_PRODUCTION_ROLLOUT='true'
npm run gate:localization-rollout
Remove-Item Env:\LOCALIZATION_BROAD_PRODUCTION_ROLLOUT
```

## Supabase Migration Approval Packet

Before any `db push`, compare local migrations with hosted history:

```powershell
npx supabase migration list
```

The multilingual rollout depends on the hosted project being current through the repo migration chain, including these localization-specific migrations:

- `20260728120000_ad_localization_storage.sql`
- `20260728123000_customer_deal_localization_projection.sql`

The second migration exposes only the customer-safe `customer_deal_localizations(p_deal_ids uuid[], p_locale text)` RPC. It must not grant direct app-role access to `ad_localizations`.

Applying migrations is production-changing:

```powershell
npx supabase db push
```

After any approved migration that touches RLS policies or policy helper functions, immediately run:

```powershell
node scripts/probe-rls-smoke.mjs
```

## Edge Function Redeploy Approval Packet

After Dan approves deployment, redeploy functions that contain or depend on the multilingual rollout code:

```powershell
npx supabase functions deploy ai-generate-ad-variants
npx supabase functions deploy publish-offer-version
npx supabase functions deploy ai-extract-menu
```

Reasons:

- `ai-generate-ad-variants` creates source-locale creative, persuasive transcreation bundles, semantic QA, repair, deterministic fallbacks, and localization telemetry.
- `publish-offer-version` validates localization snapshots, exact approval payloads, and rollout telemetry.
- `ai-extract-menu` should be redeployed if the current Edge bundle includes the provider-router menu path and the typecheck fix checkpoint.

Do not deploy `send-deal-push` to claim multilingual push support. The v1 policy is that push delivery remains non-multilingual.

## Hosted Feature Flag Order

Keep every flag false until migrations, function deploys, native review, and screenshot QA are complete for the target rollout stage.

Internal QA may enable selected flags in a non-production environment only after the relevant code and migrations are deployed there:

```text
AI_V5_MULTILINGUAL_FOUNDATION_ENABLED
AI_V5_LOCALIZED_OFFER_RENDERER_ENABLED
AI_V5_KOREAN_COUNTER_REGISTRY_ENABLED
AI_V5_LOCALIZED_OWNER_UI_ENABLED
AI_V5_CUSTOMER_LOCALE_RESOLUTION_ENABLED
AI_V5_DEAL_LANGUAGE_SWITCH_ENABLED
AI_V5_SOURCE_LOCALE_CREATIVE_ENABLED
AI_V5_PERSUASIVE_TRANSCRATION_ENABLED
AI_V5_TRANSLATION_QA_ENABLED
AI_V5_DETERMINISTIC_LANGUAGE_FALLBACK_ENABLED
AI_V5_LOCALE_PRESENTATION_OVERRIDES_ENABLED
AI_V5_LOCALE_SCREENSHOT_QA_ENABLED
AI_V5_AUTOMATIC_VERIFIED_BUNDLE_APPROVAL_ENABLED
AI_V5_EXACT_LOCALIZATION_APPROVAL_ENABLED
```

Use the matching `EXPO_PUBLIC_` aliases only for client-read flags listed in `.env.example`. `AI_V5_EXACT_LOCALIZATION_APPROVAL_ENABLED` is server-only and is read by `publish-offer-version`.

## Manual Acceptance Checks

For each supported owner language, create one deal in a production-like internal test environment:

- English owner creates and approves a deal.
- Spanish owner creates and approves a deal.
- Korean owner creates and approves a deal.

For the same approved deal and inventory pool, verify customers can view:

- English rendering.
- U.S. Spanish rendering.
- Korean rendering.

Each customer view must use the same deal ID, offer version, claim inventory, price, schedule, location, and redemption behavior. Customer viewing must not make a model call.

## Rollback

Rollback hosted flags first:

```text
AI_V5_MULTILINGUAL_FOUNDATION_ENABLED=false
AI_V5_LOCALIZED_OFFER_RENDERER_ENABLED=false
AI_V5_KOREAN_COUNTER_REGISTRY_ENABLED=false
AI_V5_LOCALIZED_OWNER_UI_ENABLED=false
AI_V5_CUSTOMER_LOCALE_RESOLUTION_ENABLED=false
AI_V5_DEAL_LANGUAGE_SWITCH_ENABLED=false
AI_V5_SOURCE_LOCALE_CREATIVE_ENABLED=false
AI_V5_PERSUASIVE_TRANSCRATION_ENABLED=false
AI_V5_TRANSLATION_QA_ENABLED=false
AI_V5_DETERMINISTIC_LANGUAGE_FALLBACK_ENABLED=false
AI_V5_LOCALE_PRESENTATION_OVERRIDES_ENABLED=false
AI_V5_LOCALE_SCREENSHOT_QA_ENABLED=false
AI_V5_AUTOMATIC_VERIFIED_BUNDLE_APPROVAL_ENABLED=false
AI_V5_EXACT_LOCALIZATION_APPROVAL_ENABLED=false
```

Do not delete immutable offer facts, approved offer versions, localization bundle hashes, exact approval hashes, or customer-safe projection history without a separate recovery plan.
