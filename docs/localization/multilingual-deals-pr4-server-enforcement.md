# Multilingual Deals PR 4 - Server Enforcement

Status: implemented locally behind `AI_V5_EXACT_LOCALIZATION_APPROVAL_ENABLED`.

## Scope

This slice adds server-side validation for the exact localization approval payload that PR4a embeds under `ad_spec.localization.approval`.

When the flag is enabled, `publish-offer-version` rejects publish requests unless the localization snapshot includes an approval that still matches:

- the top-level offer-definition hash;
- source locale and enabled locales;
- source creative hash;
- localization bundle hash;
- deterministic fallback locale list;
- selected composed-card presentation hash;
- selected image asset ID;
- localized term snapshot hash;
- locale presentation override hash;
- per-locale localization row hashes;
- approval policy and review policy versions.

## Blocked States

The server-side validator rejects:

- missing approval payloads;
- stale localization rows;
- changed localized term snapshots;
- changed localization bundle hashes;
- changed selected image or presentation hash;
- protected-term failures;
- non-passing persuasive QA;
- invalid source-locale QA;
- unsupported translation states;
- locale presentation overrides that still require text-fit review.

## Safety Boundaries

- No Supabase migration was applied.
- No Edge Function was deployed.
- No hosted feature flag was changed or enabled.
- No release build was started.
- Native reviewer sign-off and real-device screenshot QA are still separate rollout gates.
- Customer rendering still does not consume approved localization storage in this slice.

## Test Coverage

- client-built PR4a approval snapshots pass the server validator;
- exact approval is required only when the PR4 server flag is enabled;
- stale presentation, image, bundle, term snapshot, and localization rows are rejected;
- protected-term and non-passing persuasive QA states are rejected;
- `publish-offer-version` source guards pin the flag and validator wiring.

## Remaining Work

- Deploy `publish-offer-version` only after Dan explicitly approves a Supabase deploy.
- Add selective per-locale screenshot QA.
- Add reviewer sign-off workflow and rollout dashboards.
- Wire customer-facing native rendering to approved localization storage.
