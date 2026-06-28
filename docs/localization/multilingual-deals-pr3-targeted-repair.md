# Multilingual Deals PR 3 - Targeted Repair Contract

Status: implemented locally behind default-off PR3 flags.

## Scope

This slice adds a provider-facing contract for one targeted localization repair.

- `repairAdLocalizationTranscreation()` repairs exactly one failed target locale.
- `buildAdLocalizationRepairPrompt()` carries the failed locale, failed fields, QA reason codes, concise QA feedback, protected terms, source creative, failed target creative, and immutable offer facts.
- The repair schema permits only one `localization` object with `locale`, `headline`, `supportingCopy`, and `imageAltText`.
- Passing locales are not sent as repair targets and are not regenerated.

## Repairable Failures

The repair contract allows one provider repair for:

- `WRONG_LANGUAGE`;
- `PROTECTED_TERM_CHANGED`;
- `BANNED_SHORTHAND`;
- `MOBILE_COPY_TOO_LONG`;
- `UNNATURAL_TARGET_LANGUAGE`;
- `INCOMPLETE_FIELDS`;
- `UNEXPECTED_LANGUAGE_MIXING`.

The repair contract skips provider calls for:

- `OFFER_FACT_DRIFT`;
- `UNSUPPORTED_CLAIM`;
- `MEANING_CHANGED`.

Those non-repairable failures should use deterministic target-language fallback unless a future reviewed workflow explicitly handles them.

## Safety Guarantees

- The repair provider still cannot author exact offer lines, terms, price, time, quantity mechanics, CTA, eligibility, inventory, or redemption instructions.
- Protected names remain character-for-character protected terms.
- One repair request cannot touch another locale.
- This slice does not add publish storage, hosted flag changes, Edge Function deployment, independent semantic QA calls, or approval enforcement.

## Review Gate

Spanish and Korean production use remains blocked until named native reviewers sign off on repair prompt policy, QA policy, representative repairs, and real-device screenshots.
