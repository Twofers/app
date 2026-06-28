# Multilingual Deals PR 3 - Generation Bundle Wiring

Status: implemented locally behind default-off PR3 flags.

## Scope

This slice wires the existing transcreation, deterministic QA, targeted repair, and deterministic fallback pieces into the `ai-generate-ad-variants` response.

- When `AI_V5_DETERMINISTIC_LANGUAGE_FALLBACK_ENABLED` or `AI_V5_PERSUASIVE_TRANSCRATION_ENABLED` is enabled, ad generation builds a three-locale `localization_bundle`.
- The source locale is derived from the owner generation language: English -> `en-US`, Spanish -> `es-US`, Korean -> `ko-KR`.
- The source creative is the selected winning ad copy, not all candidate lanes.
- Exact offer facts come from the existing `DealOfferContract` and `OfferDefinitionV1` path.
- Provider transcreation runs only when `AI_V5_PERSUASIVE_TRANSCRATION_ENABLED=true`.
- One targeted repair pass runs only when `AI_V5_TRANSLATION_QA_ENABLED=true` and deterministic QA marks a target locale repairable.
- If provider transcreation is disabled, unavailable, missing a locale, blocked, or still invalid after repair, the affected locale uses deterministic target-language fallback.

## Returned Data

Generated ads may now include:

- `localization_bundle`;
- `localization_status`.

The generation log payload records:

- source locale;
- source creative hash;
- localization bundle hash;
- deterministic fallback locales;
- transcreation provider/model/attempt metadata;
- deterministic QA decisions;
- repair target locales and repair attempt metadata.

## Safety Boundaries

- Current production behavior is unchanged while the PR3 flags remain off.
- No customer view-time model call was added.
- No Supabase migration was created or applied.
- No Edge Function was deployed.
- No publish enforcement or approval binding was added in this slice.
- The existing publish path still uses current deal title/description localization until a later storage/publish slice binds the verified bundle.

## Remaining Work

- Independent semantic translation QA.
- Locale-specific presentation resolver and fit overrides.
- Persisting the localization bundle with offer/ad versions.
- Server-side publish enforcement and approval hash binding.
- Native reviewer sign-off before broad Spanish or Korean production rollout.
