# Multilingual Deals PR 3 - Source Locale Policy Foundation

Status: implemented locally behind default-off flags.

## Scope

This slice adds the source-locale creative policy and deterministic target-language fallback primitives needed before provider-backed transcreation is wired in.

- `lib/ad-source-locale-policy.ts` defines source creative policies for `en-US`, `es-US`, and `ko-KR`.
- `ai-generate-ad-variants` now includes the source-locale policy block and protected terms in the copy-generation prompt.
- `lib/ad-localization-schema.ts` defines the localization bundle shape.
- `lib/ad-localization.ts` can build a deterministic three-locale fallback bundle from one approved source creative and one structured offer definition.
- PR3 rollout flags are documented and default off.

## Safety Guarantees

- Source creative must be written in the merchant-selected source language except protected terms.
- Protected merchant names and item names are preserved by prompt policy and recorded in deterministic bundles.
- Target-language deterministic fallback does not show the source-language persuasive headline by default.
- Exact offer mechanics still come from `renderLocalizedOfferFromDefinition`, not from a translation model.
- This slice does not add provider transcreation, independent translation QA, targeted repair, database storage, or presentation overrides.

## Review Gate

Spanish and Korean production use remains blocked until named native reviewers sign off on source-language policy wording, deterministic fallback labels, UI strings, accessibility labels, and representative screenshots.
