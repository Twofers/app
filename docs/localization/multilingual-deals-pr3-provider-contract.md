# Multilingual Deals PR 3 - Provider Transcreation Contract

Status: implemented locally behind default-off PR3 flags.

## Scope

This slice adds the provider-facing contract for persuasive ad transcreation.

- `supabase/functions/_shared/ai-localization-provider.ts` defines the structured request, prompt, JSON schema, and shared-router call for target-locale persuasive fields.
- The provider request uses the existing structured text provider router with `operation: "translation"`.
- The schema permits only `locale`, `headline`, `supportingCopy`, and `imageAltText`.
- The prompt requests only target locales and explicitly excludes the source locale.
- Exact offer lines, terms, price, timing, quantity mechanics, CTA, eligibility, inventory, and redemption instructions remain outside model output.

## Safety Guarantees

- Only the selected source creative is sent for transcreation; the contract does not translate all candidate variants.
- Protected merchant names, business names, branded item names, and exact item names are passed as protected terms to preserve character-for-character.
- Immutable offer facts are sent only as guardrails so the provider can avoid drift.
- Missing target locales remain detectable by the caller and can use deterministic target-language fallback.
- This slice does not add localization storage, publish enforcement, hosted flag changes, Edge Function deployment, independent semantic QA calls, or targeted repair calls.

## Review Gate

Spanish and Korean production use remains blocked until named native reviewers sign off on provider prompt policy, deterministic QA policy, representative transcreations, and real-device screenshots.
