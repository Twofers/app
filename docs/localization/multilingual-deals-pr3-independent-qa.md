# Multilingual Deals PR 3 - Independent Semantic Translation QA

Status: implemented locally behind default-off PR3 flags.

## Scope

This slice adds an independent semantic translation QA pass to the provider-backed ad localization path.

- Provider transcreation still runs only when `AI_V5_PERSUASIVE_TRANSCRATION_ENABLED=true`.
- Independent semantic QA runs only when `AI_V5_TRANSLATION_QA_ENABLED=true`.
- The semantic reviewer uses the Gemini judge model configuration (`GEMINI_JUDGE_MODEL`) with fallback disabled, matching the existing independent candidate-judge pattern.
- The reviewer receives source creative, target creative, offer facts for drift detection, protected terms, and locale rules.
- The reviewer does not receive the transcreation provider identity, model identity, deterministic QA score, or prior decision.
- A target locale must pass deterministic QA and semantic QA before persuasive copy is accepted.
- If semantic QA is unavailable, missing, blocked, or still failing after one repair, the affected locale uses deterministic target-language fallback.
- Semantic QA repair targets only failed locales; passing locales are not regenerated.
- Repaired copy is re-reviewed before acceptance.

## Returned Data

Generated ad localization status now includes:

- `semantic_qa_provider`;
- `semantic_qa_model`;
- `semantic_qa_skipped_reason`.

The private generation log payload records:

- semantic QA provider/model/prompt metadata;
- semantic QA attempt telemetry;
- semantic QA decisions by locale;
- repaired semantic QA decisions by locale;
- semantic QA skipped reasons.

## Safety Boundaries

- Current production behavior is unchanged while PR3 flags remain off.
- No customer view-time model call was added.
- No Supabase migration was created or applied.
- No Edge Function was deployed.
- No hosted feature flag was changed.
- No publish enforcement, approval binding, or database storage was added in this slice.

## Remaining Work

- Locale-specific presentation resolver and fit overrides.
- Persisting the localization bundle with offer/ad versions.
- Server-side publish enforcement and approval hash binding.
- Owner UI consumption of the returned bundle for language previews.
- Native reviewer sign-off before broad Spanish or Korean production rollout.
