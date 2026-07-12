# Multilingual Deals Production Approval Runbook

Date: 2026-06-23
Updated: 2026-06-29

Scope: this runbook is the local handoff for moving the multilingual deal system from implemented code to a production rollout decision. It does not approve, apply, deploy, build, submit, or enable anything by itself.

## Current State

- English (`en-US`) has internal ownership recorded under Dan / Twofer admin.
- U.S. Spanish (`es-US`) and Korean (`ko-KR`) localization reviewer sign-off is recorded as of 2026-07-03.
- No Supabase migration has been applied from this multilingual rollout.
- No Edge Function has been redeployed from this multilingual rollout.
- Several client-readable `EXPO_PUBLIC_AI_V5_*` flags are now set in `eas.json` production-like profiles for localized rendering/code-path QA. That does **not** mean broad Spanish/Korean production is approved.
- Server-side hosted flags that trigger provider transcreation, semantic QA, or exact publish approval enforcement still require the migration, deploy, and release-approval gates below before production activation.
- Viewer-language strictness is tracked in `docs/localization/viewer-language-invariant-plan.md`. Local code now includes recipient-language customer push, localized weekly digest copy, localized Share Deal landing copy, and strict unknown-error fallback. Broad production still requires the migration/deploy/QA gates below.

## Hard Gates Before Broad Production

Spanish localization reviewer gate is clear when all of these are true:

- A named U.S. Spanish reviewer is recorded in `docs/localization/native-review-log.md`.
- The PR4 native acceptance packet in `docs/localization/multilingual-deals-native-acceptance-packet.md` is complete for every Spanish-required scenario.
- Spanish templates, UI strings, accessibility labels, prompt policies, deterministic fallback wording, and representative screenshots are signed off.
- `lib/localization-rollout-gate.ts` marks `es-US` as signed off with screenshot QA passed.
- `lib/offer-locale-templates.ts` marks Spanish launch templates reviewed.

Korean localization reviewer gate is clear when all of these are true:

- A named Korean reviewer is recorded in `docs/localization/native-review-log.md`.
- The PR4 native acceptance packet in `docs/localization/multilingual-deals-native-acceptance-packet.md` is complete for every Korean-required scenario.
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
npm run gate:localization-plan
npm run gate:localization-rollout
npm run dashboard:localization-rollout
npx expo export --platform android --output-dir C:\tmp\twofer-metro-probe-multilingual-approval
```

For a broad-production localization readiness assertion, this command must pass only after the review records are updated:

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
- `20260801121000_profiles_app_locale.sql`

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
npx supabase functions deploy deal-link
npx supabase functions deploy send-deal-push
npx supabase functions deploy weekly-deal-digest
```

Reasons:

- `ai-generate-ad-variants` creates source-locale creative, persuasive transcreation bundles, semantic QA, repair, deterministic fallbacks, and localization telemetry.
- `publish-offer-version` validates localization snapshots, exact approval payloads, and rollout telemetry.
- `ai-extract-menu` should be redeployed if the current Edge bundle includes the provider-router menu path and the typecheck fix checkpoint.
- `deal-link` renders the public Share Deal/open-app landing page in the recipient browser language where available.
- `send-deal-push` builds customer deal-release push copy per recipient `profiles.app_locale`.
- `weekly-deal-digest` builds weekly digest push copy per recipient `profiles.app_locale`.

Do not claim strict viewer-language Share Deal or push support until `profiles.app_locale` is applied, the three Edge Functions above are redeployed, and native/real-device QA covers the new unavailable/fallback strings.

## Hosted Feature Flag Order

Do not turn server-side hosted rollout flags on until migrations, function deploys, native review, and screenshot QA are complete for the target rollout stage. Current `eas.json` may already set matching `EXPO_PUBLIC_` client aliases for internal QA / production-like builds; those aliases should not be treated as deployment approval by themselves.

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

Use `docs/localization/multilingual-deals-native-acceptance-packet.md` as the scenario checklist and evidence manifest. Keep raw screenshots under local `artifacts/` paths unless they are explicitly sanitized for source control. Do not transcribe QR tokens, claim codes, or redemption codes into docs, chat, commits, PRs, or public artifacts.

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
