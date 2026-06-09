# TWOFER iOS App Store Release Plan - 2026-06-07

This handoff captures the updated release strategy for TWOFER after the owner changed priority to
publish iOS first. It is a planning document only. It does not approve store submission, version
changes, signing changes, Supabase migrations, builds, or app behavior changes.

## 1. Current Android/local RC status - background only

The current local release-candidate context is useful for confidence, but it is not the active
release path.

| Item | Status |
|---|---|
| Current branch | `fix/current-app-with-share-isolated` |
| Owner-provided checkpoint | `5bdff9e` - Handle location onboarding denial safely |
| Workspace-observed HEAD on 2026-06-07 | `2feb106` - Document local Android RC handoff |
| Local tag present | `local-android-rc-validated-20260607` |
| Validated posture | Android/local RC validation is background evidence only |

The Android/local RC work should remain available as historical validation, but it should not drive
new Google Play submission work while the release strategy is iOS-first.

## 2. iOS-first release strategy

The next release lane is Apple-first:

- Prepare App Store Connect and TestFlight readiness before any public App Store submission.
- Keep the app positioned as a free pilot: businesses are pilot/free-trial only and consumers are
  free.
- Treat billing as inactive for the App Store build unless the owner separately approves a billing
  policy decision and implementation cleanup.
- Preserve the current app identifiers, signing posture, and version/build metadata until explicit
  approval is given.
- Use the validated Android/local RC only as background quality context, not as a reason to submit
  Google Play artifacts.

## 3. Remaining iOS blockers

These items must be resolved before Apple submission is considered:

- Apple Developer Program membership and App Store Connect app record must be confirmed.
- iOS bundle ID registration must be confirmed without changing the bundle ID.
- iOS signing and EAS credential state must be confirmed without rotating or changing signing.
- A production iOS build and TestFlight pass are still pending; do not build or submit yet.
- Privacy Policy, Terms, Support, and Delete Account URLs must be public, accurate, and reachable.
- App Privacy nutrition-label answers must match actual collection and use:
  account/email, approximate location, claim/redeem history, business profile data, camera/photo
  access, microphone/audio transcription, analytics, crash/error events, and notifications.
- AI/audio disclosure must clearly explain that typed input and audio transcription may be used for
  AI-assisted offer creation.
- Billing posture must be cleaned up so review sees a free pilot with no active in-app billing,
  paid upgrade path, or live Stripe subscription flow.
- Reviewer demo access and reviewer notes must be ready and verified.
- iOS screenshots and store copy must be finalized for the App Store listing.
- iPad screenshot requirements must be confirmed if tablet support remains enabled.
- Any final QA pass must avoid Supabase migrations unless separately approved.

## 4. Google Play work paused

Google Play is not the current submission target. The following work is paused:

- Google Play AAB production build work.
- Google Play closed-testing or internal-testing release setup.
- Google Play Console release-track submission.
- Google Play service-account submit automation.
- Google Play-specific package/release troubleshooting.
- Any versionCode/build-number changes intended only for Google Play.

Do not delete existing Android QA artifacts. Keep them available for later Google Play continuation.

## 5. Work reusable across Apple and Google

The following work still matters because it applies to both Apple and Google:

### Privacy Policy

- Publish and verify a public Privacy Policy URL.
- Cover account data, business profile data, approximate location, claims/redemptions, analytics,
  error/crash events, notifications, camera/photos, microphone/audio transcription, and AI-assisted
  offer creation.
- State that the app is for adults/general users and is not child-directed.

### Delete Account Page

- Publish and verify a public delete-account/data-deletion page.
- Explain how users can request deletion and what data is deleted or retained for legitimate
  operational/legal reasons.
- Keep the page usable for both Apple reviewer expectations and Google Play data-deletion policy.

### Billing Posture Cleanup

- Keep launch posture as free pilot only.
- Ensure businesses are presented as pilot/free-trial users, consumers are free, and no active
  billing is required to use the pilot.
- Remove or clearly gate any live payment/subscription review path until the owner approves a store
  policy approach.

### AI/audio Disclosure

- Disclose that AI offer tools use user-provided typed input and audio transcription.
- Make the disclosure user-friendly and consistent across store copy, privacy policy, and reviewer
  notes.
- Avoid implying that AI is required for basic deal creation if manual creation remains available.

### Screenshots/store Copy

- Reuse the same product story across App Store and Google Play: local BOGO deals, cafe/bakery pilot,
  consumer discovery, claim/redeem flow, and business owner deal creation.
- Prepare Apple-specific screenshot sizes first.
- Keep Google Play screenshots/copy reusable but do not resume Google Play submission work yet.

## 6. Hard constraints

Until the owner explicitly approves otherwise:

- Do not submit to Apple yet.
- Do not submit to Google.
- Do not bump version or buildNumber.
- Do not change the iOS bundle ID.
- Do not change the Android package ID.
- Do not change signing.
- Do not apply Supabase migrations.
- Do not print secrets.
- Do not delete QA artifacts.
- Do not edit app code or app configuration as part of this handoff.
- Do not build, commit, or push.

## 7. Open risks

- The owner-provided checkpoint is `5bdff9e`, while the workspace currently observes HEAD at
  `2feb106`; confirm which commit should be treated as the iOS release-prep base before any future
  build or submission.
- iOS signing, Apple Developer membership, and App Store Connect app-record readiness are not yet
  verified in this handoff.
- Public legal/support/delete-account URLs still need live verification.
- App Privacy answers and AI/audio wording need final review against the exact App Store build.
- Billing must remain visibly inactive for the free pilot unless a separate approved billing path is
  completed.
- Apple screenshot requirements, including any iPad requirement, still need confirmation before
  submission.
