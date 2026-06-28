# Multilingual Deals PR 4 - Approval Binding

Status: implemented locally behind `AI_V5_AUTOMATIC_VERIFIED_BUNDLE_APPROVAL_ENABLED`.

## Scope

This slice adds the local verified-bundle approval contract.

- A generated localization bundle can produce a deterministic `adlocappr_...` approval hash.
- The approval hash binds the owner approval to:
  - source creative hash;
  - localization bundle hash;
  - selected composed presentation hash;
  - selected image asset ID;
  - exact offer-definition hash;
  - localized term snapshot hash;
  - locale presentation override hash;
  - per-locale localization row hashes;
  - approval and review policy versions.
- The Create AI screen records that hash when the owner accepts a fully verified multilingual preview.
- Publish is blocked locally when automatic approval is enabled and the current multilingual approval hash no longer matches the accepted hash.
- `buildOfferVersionPublishAdSpec()` embeds the approval snapshot under `ad_spec.localization.approval` when the accepted approval still matches.

## Approval Conditions

Automatic bundle approval is granted only when:

- a localization bundle is present;
- all enabled locales are present;
- source, bundle, presentation, image, term, and row hashes are present;
- any supplied localization storage snapshot matches the bundle's source locale, enabled locales, source hash, and bundle hash;
- source locale QA is `not_required`;
- persuasive target locales have `qaDecision: "pass"`;
- deterministic fallback target locales are complete;
- no final localization carries a protected-term-change QA reason;
- no locale presentation override requires additional text-fit review;
- screenshot QA is not required for the selected preview.

## Safety Boundaries

- No Supabase migration was applied.
- No Edge Function was deployed.
- No hosted feature flag was changed or enabled.
- No release build was started.
- Server-side exact localization approval enforcement is documented in the PR4 server-enforcement slice.
- Customer rendering still does not consume localization storage in this slice.

## Test Coverage

- complete bundles produce stable approval hashes;
- presentation changes produce different approval hashes;
- missing locales and screenshot-QA requirements block approval;
- mismatched prebuilt localization snapshots block approval;
- non-passing persuasive QA blocks approval;
- runtime rollout flag defaults off and supports public mobile aliases;
- publish ad specs embed the accepted localization approval snapshot;
- source guards keep Create AI wired to the acceptance and publish stale-hash checks.

## Remaining Work

- Deploy server-side publish enforcement only after explicit approval.
- Add migration or RPC support only after explicit approval.
- Wire customer-facing native rendering to approved localization storage.
- Add selective per-locale screenshot QA and reviewer sign-off workflow.
