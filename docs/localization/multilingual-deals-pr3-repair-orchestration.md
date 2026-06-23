# Multilingual Deals PR 3 - Repair Orchestration

Status: implemented locally behind default-off PR3 flags.

## Scope

This slice wires targeted repair results into the deterministic localization bundle builder.

- `buildQaCheckedAdLocalizationBundle()` now accepts `repairedTargetCreatives`.
- A repaired target creative is considered only after the original target creative returns a deterministic QA `repair` decision.
- Passing target locales ignore repair candidates, so a repair path cannot regenerate or replace already accepted locales.
- Blocked, non-repairable target creatives ignore repair candidates and use deterministic target-language fallback.
- Failed repair attempts also use deterministic target-language fallback.

## Bundle Metadata

Each localized creative now records:

- `repairAttempted`;
- `repairStatus`;
- `repairReasonCodes`.

These fields are included in the localization bundle hash so future approval/storage work can distinguish:

- no repair needed;
- repair attempted and accepted;
- repair attempted but fallback used;
- repair skipped because the failure was non-repairable.

## Safety Guarantees

- Source-locale creative is never repaired.
- A repair candidate cannot replace a locale that already passed QA.
- Non-repairable failures such as unsupported claims or offer-fact drift cannot be patched around by providing repaired copy.
- Deterministic target-language fallback remains the final safe output when repair is absent, skipped, or fails QA.

## Remaining Work

- The live `ai-generate-ad-variants` endpoint still does not call the transcreation provider or repair provider.
- Independent semantic translation QA remains future work.
- Database storage, publish enforcement, and approval binding remain future work and may require gated migration/deploy steps.
