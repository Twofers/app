# Twofer production app 1.0.2 update plan

Date: 2026-08-01  
Status: DRAFT / NO-GO until every release gate below passes  
Current public version: 1.0.1 on iOS and Android  
Target version: 1.0.2  
Updated 2026-08-01: reviewed against actual repo state; QA scope expanded to
match the real binary diff since 1.0.1 (sections 1, 4, 6, 7, 8).  
Founder decisions on iOS Checkout, Apple Wallet, demo teardown, and the Apple
title recorded 2026-08-01 — see the end of the Founder decisions section.

## Objective

Ship a small, low-risk production update focused on reliability, account
security, support, and merchant activation. Do not add unrelated product
features to this release. Website, admin-console, database, and Edge Function
deployments remain separately controlled even when their source lives in the
same repository.

## Founder decisions

1. Android must not initiate or link to Stripe Checkout from the native app.
2. iOS may offer the merchant trial Checkout path only when all of the
   following are true:
   - the build is explicitly configured with a dedicated iOS Checkout flag;
   - the release is limited to an Apple storefront where the link is allowed;
   - the exact behavior is disclosed in App Review notes and the public privacy
     policy;
   - a server-controlled kill switch can disable Checkout immediately without
     requiring another store release.
3. The iOS allowance does not automatically ship. If storefront eligibility,
   policy wording, privacy disclosure, or the kill switch is incomplete,
   Checkout stays disabled on iOS too.
4. Approved merchants must always retain a non-payment fallback: instructions
   to use their approval email and a working Contact Support action.
5. No additional features are required for 1.0.2. The release succeeds by
   making the existing customer and merchant loops more dependable.

Decisions recorded 2026-08-01:

- iOS Checkout ships capability-dark: the 1.0.2 binary sets the dedicated
  iOS flag true, the server kill switch ships OFF, and enabling later is a
  server-side action only — no new binary required. All four conditions in
  item 2 must therefore be completed BEFORE submission, not before
  enablement: the submitted binary contains the reachable feature, App
  Review notes must disclose it (including that it is remotely disabled at
  launch), and the privacy policy must already be accurate. Hiding it from
  review is not an option.
- Apple Wallet: unpark it. Complete the Apple pass type registration and
  signing certificate before the build so the iOS wallet button produces a
  working pass. If that work cannot finish in time, hide the iOS wallet
  button for this release rather than shipping a dead-end tap; do not ship
  it broken.
- Demo accounts and demo deals stay for this release. Reviewer accounts ship
  anyway; revisit teardown once real merchant deal supply grows.
- Fix the Apple listing title spacing this release.

## Platform-specific Checkout contract

### Android — required behavior

- Direct trial Checkout is fail-closed.
- No Stripe Checkout URL, billing website URL, pricing page, subscription CTA,
  or external-payment call to action may be opened from an Android merchant
  screen.
- An approved-but-not-activated merchant sees neutral activation guidance:
  check the approval email or contact support.
- Android behavior must remain disabled even if the iOS Checkout flag or a
  generic billing flag is accidentally enabled.

### iOS — conditional behavior

- Use a dedicated flag such as
  `EXPO_PUBLIC_ENABLE_IOS_TRIAL_CHECKOUT=true`; do not reuse a broad mobile
  billing flag.
- Require `Platform.OS === "ios"` and the dedicated flag before requesting a
  Checkout URL.
- Add a server-side release/kill flag. Client permission and server permission
  must both be true.
- A failed Checkout request or failed URL open must return the merchant to
  approval-email/support guidance. It must not silently route to another
  payment page.
- Do not infer App Store storefront eligibility from device locale, GPS, SIM,
  or language. Confirm distribution in App Store Connect or use an approved
  storefront-aware implementation.

### Required tests

- Android never invokes `stripe-create-checkout-session`.
- Android never opens a billing or pricing URL.
- iOS with the flag absent/false never invokes Checkout.
- iOS with the flag true but the server kill switch false never receives a
  usable Checkout URL.
- iOS with both gates true opens only an allowlisted HTTPS Stripe Checkout URL.
- Network failure, denied URL opening, missing business id, already-active
  business, expired approval, and server denial all produce a recoverable,
  localized support/email path.

## 1. Release-candidate isolation

- [x] Finish, commit, or separately preserve the in-progress website redesign.
      Done 2026-08-01: committed, pushed, and deployed from
      `website/homepage-redesign-2026-08-01`.
- [ ] Merge `website/homepage-redesign-2026-08-01` into protected `main` via
      PR, then cut `release/1.0.2` from `main`. Mobile source is identical on
      both today — the seven branch-only commits are website, docs, and Edge
      Function hardening — so basing on `main` loses nothing mobile.
- [ ] Remove unrelated website files, plans, fonts, screenshots, and local QA
      artifacts from the mobile release candidate and EAS upload context.
      `.easignore` already excludes keystores, `key.txt`, certificates, PDFs,
      and QA artifact directories; verify it still covers everything present
      in the working tree at build time.
- [ ] Ship the accumulated mobile commits as they sit on the release base. Do
      not cherry-pick a subset; that would produce a combination no one has
      tested.
- [ ] Identify the exact 1.0.1 build commit from EAS build metadata (no git
      tag exists for it) and attach the commit inventory since that SHA to
      the build report. This inventory is what makes section 4 checkable.
- [ ] Diff `eas.json`'s production profile between the 1.0.1 SHA and the
      release SHA and record the `EXPO_PUBLIC_*` flag changes that will bake
      into this binary.
- [ ] Confirm `git status --short` is empty immediately before each EAS build.
- [ ] Record the release commit SHA in the build report and git-tag it
      `v1.0.2`, so the next release can answer "what changed since the last
      binary" without EAS archaeology.

## 2. Version and build configuration

- [ ] Set `expo.version` in `app.json` to `1.0.2`.
- [ ] Set the root package version in `package.json` and `package-lock.json` to
      `1.0.2`.
- [ ] Regenerate release-state after the version bump (`npm run
      release:state`) before running the gate; a stale generated state has
      failed submission before.
- [ ] Keep EAS remote app-version management and auto-increment enabled.
- [ ] Keep debug, dev-client, QA publishing, and screenshot flags absent from
      production builds.
- [ ] Confirm production Supabase, legal/support URLs, Google Maps key, social
      auth client ids, bundle id, and Android package resolve as expected
      without printing secret values.
- [ ] Add the dedicated iOS Checkout flag with Android fail-closed behavior.
      Per the recorded decision, production sets
      `EXPO_PUBLIC_ENABLE_IOS_TRIAL_CHECKOUT=true`; launch behavior is
      controlled entirely by the server kill switch, which ships OFF.
- [ ] Add and verify the server kill switch before the build. It ships OFF
      and is the only control that enables iOS Checkout later without a new
      binary.

## 3. Required code and policy corrections

- [ ] Implement the platform-specific Checkout contract above.
- [ ] Update the public privacy policy before submission — required, not
      conditional, because the submitted binary carries the Checkout
      capability even while the server switch is off. Remove any statement
      that incorrectly says the submitted app cannot initiate web Checkout.
- [ ] Update Apple review notes to explain that consumer use is free, merchant
      accounts are reviewed, what the merchant subscription enables, where the
      purchase occurs, and how reviewers can test without making a payment.
      State plainly that the Checkout path exists in the binary and is
      remotely disabled at launch.
- [ ] Confirm App Store availability is limited to eligible storefronts before
      submission, and reconfirm before the server switch is ever turned on.
      If eligibility fails, the kill switch stays off.
- [ ] Complete the Apple Wallet pass type registration and signing certificate
      (currently parked) so the iOS wallet button yields a valid pass.
      Fallback if this slips: hide the iOS wallet button for 1.0.2.
- [ ] Keep Google Play listing/review notes free of any Android external-payment
      direction.
- [ ] Fix the seven current Edge Function type errors before merging or
      deploying the web-attack-hardening work. Those errors live in the
      hardening commit on `website/homepage-redesign-2026-08-01`, so
      `npm run typecheck:functions` may already pass on `main`; re-measure on
      the actual release base instead of trusting the snapshot below.
- [ ] Fix the two current full-suite test failures.
- [ ] Align `react-native-worklets` with the Expo SDK 54 expected version
      (`0.5.1` unless Expo's supported version changes before the build).

## 4. Actual 1.0.2 mobile scope

The binary ships every mobile commit landed since the 1.0.1 build — roughly
25 changes, not a hand-picked subset. Beyond claim/redeem reliability and
localization, the known contents include: double-tap-the-QR manual
redemption, the Use Deal pass manual-redeem fix, the Google Wallet
pass-to-app route, same-item BOGO copy acceptance, the imageless-ad fallback,
promote-from-menu ad-format choice, AI ad-copy naturalness, billing and
activation screens (dark behind disabled flags), the in-app business
application, and native dependency bumps including expo-splash-screen.
Section 6 must exercise these paths, and store/review notes must not describe
the release as claim/redeem-only.

- [ ] Verify the section 1 commit inventory contains only reviewed work;
      anything unreviewed gets reviewed now, not silently shipped or reverted
      piecemeal.
- [ ] Keep automatic local-session removal for suspended or archived accounts.
- [ ] Keep consistent support-email behavior across customer and merchant
      surfaces.
- [ ] Confirm all merchant states remain recoverable: pending, approved but not
      activated, active trial, paid, suspended, expired, and archived.
- [ ] Do not add Sentry or another new native SDK solely to make this train.
      Existing first-party error reporting and the monitoring runbook remain
      the compensating control unless a separate SDK change is reviewed and
      device-tested.

## 5. Automated release gates

Every command must pass against the exact clean release commit:

- [ ] `npm run typecheck`
- [ ] `npm run lint`
- [ ] `npm test`
- [ ] `npm run typecheck:functions`
- [ ] `npx expo-doctor`
- [ ] `npm run gate:release-state`
- [ ] `npm run gate:ai-poster-lock`
- [ ] `npm run check:i18n-keys`
- [ ] `npm run check:mobile-store-copy`
- [ ] `npm run check:website-supabase`
- [ ] Relevant hosted Edge Function and RLS smoke gates after any approved
      backend deployment

Current audit snapshot on 2026-08-01: mobile typecheck, lint, release-state,
localization, store-copy, website/Supabase, and poster-lock gates pass. The full
test suite has two failures, Edge Function typechecking has seven errors, and
Expo Doctor reports the `react-native-worklets` patch mismatch. This snapshot
is evidence only, not permission to skip re-running every gate. It was also
taken on `website/homepage-redesign-2026-08-01`, not the release base;
re-measure everything on the release branch.

## 6. Exact-binary QA

### Both platforms

- [ ] Merchant publish loop end to end: create a deal, AI-generate the ad,
      publish. Include a same-item BOGO, an imageless/provider-refusal
      fallback case, and the promote-from-menu ad-format choice. This path
      changed heavily since 1.0.1 and today appears only in post-release
      monitoring.
- [ ] Manual redemption paths new since 1.0.1: double-tap-the-QR redemption
      and the Use Deal pass manual redeem.
- [ ] Claim-conflict messaging and repeat-restriction hiding, using the
      second claimable live deal required by section 7.
- [ ] Site-import onboarding: one pass through the in-app business
      application with website import (`EXPO_PUBLIC_ENABLE_SITE_IMPORT` is on
      in the production profile, and merchant activation is a release
      objective).
- [ ] Spot-check the new claim/redemption strings on-device in Spanish and
      Korean; the key gate proves existence, not quality, and Spanish has
      regressed on device before.

### Android

- [ ] Build an AAB with the production Android configuration.
- [ ] Upload to Play internal testing first.
- [ ] Prove no merchant surface contains an external-payment CTA or opens a
      payment URL.
- [ ] Smoke Google sign-in, Maps, location denial/ZIP fallback, account
      deletion, customer claim/release, merchant QR redemption, push settings,
      deep links, and support contact on a real Android device.
- [ ] Google Wallet: save the pass and open the app from the saved pass. The
      wallet-to-app route is new since 1.0.1, and the Google issuer was only
      approved after the last binary shipped.

### iOS

- [ ] Build an IPA with the production iOS configuration.
- [ ] Upload to TestFlight first.
- [ ] Verify Sign in with Apple, Google sign-in callback, location denial,
      account deletion, claim/release/redeem, push permissions, universal links,
      Apple Wallet presentation, and support contact on a real iPhone.
- [ ] Apple Wallet QA expectation (decided 2026-08-01): the pass side gets
      unparked before the build, so a tap must save and present a valid pass.
      If the unpark work slipped and the button was hidden instead, verify
      the button is absent.
- [ ] Checkout on the TestFlight build: with the server switch off (the
      launch state), verify no usable Checkout URL is returned and the
      merchant lands on approval-email/support guidance. Then temporarily
      enable the server switch against the TestFlight build only and test
      success, cancel, failure, double tap, app background/return, and
      already-active. Turn the switch back off before public release and
      record both states in the QA evidence.
- [ ] Reconfirm storefront availability and review-note/privacy accuracy against
      the exact submitted build.

## 7. Reviewer and market readiness

- [ ] Consumer reviewer account is active and claim-clean.
- [ ] Merchant reviewer account is already active and can exercise business
      tools without purchasing.
- [ ] Reviewer data contains at least two claimable live offers visible
      outside the user's physical Dallas location when using the provided
      account. Two are required so claim-conflict and repeat-restriction
      behavior is testable; today production has one real claimable deal and
      five of the six live deals are demo data.
- [ ] Privacy, terms, support, delete-account, association, and asset-links URLs
      are public and return the expected content.
- [ ] App Store “What's New” and Google Play release notes accurately describe
      the material changes and contain no empty bullet.
- [ ] Correct the Apple title spacing (`Twofer: Live Local Deals`). Decided
      2026-08-01: fix it this release.
- [ ] Reconfirm the intended category alignment between Apple and Google Play.
- [x] Decide demo-account teardown. Decided 2026-08-01: the demo accounts and
      demo deals stay for this release. Reviewer accounts ship anyway;
      revisit teardown once real merchant deal supply grows.

## 8. Release and rollback

- [ ] Promote Android with a staged rollout, not immediate 100% availability.
- [ ] Use Apple's phased release for the iOS update.
- [ ] Define halt criteria before promoting: hold the Android rollout at its
      current stage and pause the iOS phased release if sign-in failures,
      crash rate, claim/redemption failures, or support volume regress
      against the 1.0.1 baseline.
- [ ] Record EAS build ids, store build numbers, commit SHA, configuration
      decision, and QA evidence.
- [ ] Monitor sign-in failures, merchant activation attempts, Checkout failures
      where enabled, first-deal publication, claims, redemptions, account
      deletion, and support volume.
- [ ] If iOS Checkout creates review, policy, or production issues, disable the
      server kill switch immediately and ship a follow-up binary with the client
      flag disabled if needed.

## Go / no-go rule

The build may be created for internal testing only after the repository is a
clean, intentional release candidate and local gates are green. Public
submission requires exact-binary device QA, accurate policy/privacy
disclosures, and reviewer accounts/data. The iOS Checkout decision is
recorded: the capability ships dark behind the server kill switch, and every
disclosure condition must be complete before submission. Any ambiguity
defaults to the kill switch staying off.
