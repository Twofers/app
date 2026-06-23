# Multilingual Deals PR 3 - Translation QA Foundation

Status: implemented locally behind default-off PR3 flags.

## Scope

This slice adds deterministic translation QA and per-locale fallback selection for future provider-backed transcreation.

- `lib/ad-translation-qa.ts` validates a proposed target-locale persuasive creative before it can be accepted into a localization bundle.
- `lib/ad-localization-schema.ts` now records the QA decision, hard-fail reason codes, scores, and concise feedback shape required by the PR3 plan.
- `lib/ad-localization.ts` can accept passing target-locale transcreations while falling back only failed or missing target locales.
- Provider transcreation, independent semantic model review, targeted repair calls, database storage, and publish enforcement remain outside this slice.

## Deterministic Checks

The QA gate verifies:

- target-language signal after protected terms are removed;
- exact preservation of protected terms used by the source creative;
- banned BOGO shorthand;
- unsupported quality, ranking, guarantee, and dietary claims from known policy;
- unexpected numeric mechanics not present in source creative or structured offer facts;
- mobile field budgets;
- required field completeness;
- unexpected English/Spanish/Korean mixing beyond protected terms.

## Fallback Behavior

When target copy is absent or fails deterministic QA, the localization bundle uses deterministic target-language fallback for that locale only. Passing locales remain persuasive transcreations. Failed target reason codes are retained beside `DETERMINISTIC_TARGET_FALLBACK` so later provider repair and telemetry can identify what failed.

## Review Gate

Spanish and Korean production use remains blocked until named native reviewers sign off on the deterministic QA policy, fallback wording, representative transcreations, and real-device screenshots.
