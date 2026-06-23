# Multilingual Deals PR 3 - Localization Storage Contract

Status: implemented locally as an unapplied storage contract and migration draft.

## Scope

This slice adds the local storage contract for verified multilingual ad bundles.

- Generated ads that carry a verified `localization_bundle` now publish an immutable `ad_spec.localization` snapshot.
- The snapshot includes source locale, enabled locales, source creative hash, localization bundle hash, deterministic fallback locales, locale renderer version, term/template snapshot IDs, translation QA summary, semantic QA summary, and safe locale presentation overrides.
- Per-locale storage rows include persuasive creative fields and hashes only: headline, optional supporting copy, image alt text, source copy hash, localization row hash, QA fields, repair fields, preserved terms, and nullable provider/model metadata.
- Exact offer lines and terms lines are intentionally excluded from per-locale localization rows. Those mechanics still come from the authoritative offer version and localized renderer.
- The publish Edge Function validates optional localization snapshots and rejects exact-offer fields inside per-locale localization rows.
- The migration draft creates service-role-only `ad_localizations` rows and offer-version metadata columns, then syncs rows from the immutable `ad_spec.localization` snapshot by trigger.

## Data Boundaries

Stored on `offer_versions` by the migration draft:

- `source_locale`;
- `enabled_locales`;
- `localization_bundle_hash`;
- `localized_term_snapshot`;
- `locale_presentation_overrides`;
- `translation_qa_summary`;
- `deterministic_fallback_locales`;
- `locale_renderer_version`.

Stored on `ad_localizations` by the migration draft:

- localized persuasive headline;
- optional localized persuasive supporting copy;
- localized image alt text;
- source and localization hashes;
- translation status;
- QA and repair state;
- preserved terms;
- nullable provider/model/prompt metadata.

Not stored on `ad_localizations`:

- exact localized offer line;
- exact localized terms line;
- inventory, claim limits, prices, or eligibility facts.

## Safety Boundaries

- No Supabase migration was applied.
- No Edge Function was deployed.
- No hosted feature flag was changed or enabled.
- Customer rendering still does not read from `ad_localizations` in this slice.
- Publish enforcement and automatic verified-bundle approval remain PR4 work.

## Test Coverage

- localization storage rows omit exact offer and terms fields;
- deterministic fallback supporting copy is not persisted as persuasive copy when it is the locked offer line;
- offer-version ad specs embed localization snapshots when the generated ad has a verified bundle;
- publish validation rejects exact-offer fields in localization rows;
- the migration draft is approval-gated, service-role-only, and creates the expected columns, table, constraints, and triggers.

## Remaining Work

- Apply the migration only after explicit approval.
- Redeploy `publish-offer-version` after the storage contract is approved.
- Wire customer/native rendering to approved localization storage.
- Add server-side publish enforcement for exact localization bundle hashes.
- Add owner language previews and automatic verified-bundle approval.
