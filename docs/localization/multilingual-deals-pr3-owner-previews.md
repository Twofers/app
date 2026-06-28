# Multilingual Deals PR 3 - Owner Language Previews

Status: implemented locally behind the existing localized owner UI and generated localization bundle gates.

## Scope

This slice wires optional owner preview language controls into the generated-ad review surface.

- Owner previews now derive card copy from a single `OwnerLanguagePreview` result.
- The composed ad card and legacy generated preview card use the same preview locale, localized headline, supporting copy, CTA, image alt text, exact offer line, and terms line.
- Language controls appear only when the generated ad includes a verified `localization_bundle`.
- Source-language preview keeps the approved source creative and source CTA.
- Target-language previews use the verified bundle's persuasive headline, supporting copy, and image alt text.
- Exact offer line and terms line continue to come from the structured offer definition and localized renderer when available.

## Approval Disclosure

The existing owner disclosure remains the UI contract:

> This preview changes only the customer-facing language. The deal mechanics, image, schedule, and inventory stay tied to the same approved offer.

The copy intentionally tells the owner that the language tab is a presentation preview, not a second deal definition.

## Safety Boundaries

- No Supabase migration was applied.
- No Edge Function was deployed.
- No hosted feature flag was changed or enabled.
- No release build was started.
- Customer rendering still does not consume stored localizations in this slice.
- Approval remains manual; automatic verified-bundle approval remains future work.

## Test Coverage

- Target locale preview uses verified bundle creative and localized CTA.
- Exact target offer facts stay tied to the localized offer renderer.
- Source locale preview keeps source creative and source CTA.
- Disabled localized preview mode falls back to the legacy source-copy behavior.
- Source-level wiring guards both composed and legacy preview card paths.

## Remaining Work

- Wire customer-facing native deal/feed rendering to approved localization storage.
- Add server-side publish enforcement for exact localization bundle hashes.
- Add server-side exact approval enforcement after owner acceptance.
- Run native visual QA for Spanish and Korean previews before broad production rollout.
