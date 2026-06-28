# Multilingual Deals PR 3 - Locale Presentation Overrides

Status: implemented locally as an unused deterministic resolver contract.

## Scope

This slice adds the locale-aware presentation contract and deterministic resolver needed before localized ads can render safely in customer-facing cards.

- `AdPresentationSpec` now supports optional per-locale presentation overrides.
- Overrides are partial and are only stored for locales that need a different safe layout, supporting-copy behavior, or review-worthy reason code.
- Overrides can change `templateId`, `textPanel`, and `showSupportingCopy`.
- Overrides cannot change the image identity, image source type, offer facts, localization bundle, or creative mechanics.
- The resolver consumes a verified `AdLocalizationBundle`, merchant display identity, localized CTA/status labels, and the existing deterministic text-fit estimator.
- The resolver runs at generation or approval time only. It adds no customer view-time model call.

## Resolver Policy

The resolver follows the plan's presentation repair order:

1. Use the base presentation when localized copy fits.
2. Prefer a compatible safe split presentation when localized text is long or script-specific font metrics require guardrails.
3. Remove optional supporting copy before allowing a cramped layout.
4. Use a stronger native text panel for split presentations.
5. Flag exact-offer overflow for screenshot QA and human review rather than shortening offer mechanics.

Locale-specific deterministic guards currently include:

- long U.S. Spanish headline, supporting copy, or exact offer line can switch to `split_offer_panel`;
- Korean or Hangul-containing copy can switch to `split_offer_panel` with `HANGUL_FONT_METRICS_GUARD`;
- exact localized offer lines are treated as locked mechanics and are never compacted by this resolver.

## Returned Data

`resolveLocalePresentationOverrides()` returns:

- the normalized presentation spec with any safe `localeOverrides`;
- the partial locale override map;
- reason codes by locale;
- locales that should trigger rendered screenshot QA.

## Safety Boundaries

- Current production behavior is unchanged because this resolver is not wired into native/customer rendering in this slice.
- No Supabase migration was created or applied.
- No Edge Function was deployed.
- No hosted feature flag was changed or enabled.
- No storage, publish enforcement, approval binding, or owner preview UI was added here.
- Native review and real-device screenshot QA are still required before broad Spanish or Korean production rollout.

## Test Coverage

- no override is created when localized copy fits the base presentation;
- long Spanish copy may switch to split panel;
- Korean font metrics guard can switch Hangul copy to split panel;
- exact offer overflow is flagged for screenshot QA instead of shortening mechanics;
- locale overrides do not change image identity;
- presentation hashes change when locale overrides change.

## Remaining Work

- Wire approved overrides into the native composed-card renderer.
- Persist localization bundles and presentation overrides with offer/ad versions.
- Add server-side publish enforcement and approval hash binding.
- Add owner language preview consumption.
- Complete real-device screenshot QA and native reviewer sign-off before broad rollout.
