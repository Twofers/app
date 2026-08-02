# Twofer production app 1.0.2 update plan

Date: 2026-08-01  
Status: INTERNAL-CANDIDATE GO / PUBLIC-RELEASE NO-GO until the remaining
physical-device, wallet, TestFlight Checkout, rollout, and monitoring gates
below pass
Current public version: 1.0.1 on iOS and Android  
Target version: 1.0.2  
Updated 2026-08-01: reviewed against actual repo state; QA scope expanded to
match the real binary diff since 1.0.1 (sections 1, 4, 6, 7, 8).  
Execution update 2026-08-01: replacement Android version code 61 and iOS build
33 were built from `2451ff39fe22f97d730a0e25cde1bced2bce2497`, uploaded
successfully, and the exact Android payload completed the shared functional QA
listed below. Public release remains blocked on the unchecked gates.
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
- [x] Merge `website/homepage-redesign-2026-08-01` into protected `main` via
      PR, then cut `release/1.0.2` from `main`. Mobile source is identical on
      both today — the seven branch-only commits are website, docs, and Edge
      Function hardening — so basing on `main` loses nothing mobile.
- [x] Remove unrelated website files, plans, fonts, screenshots, and local QA
      artifacts from the mobile release candidate and EAS upload context.
      `.easignore` already excludes keystores, `key.txt`, certificates, PDFs,
      and QA artifact directories; verify it still covers everything present
      in the working tree at build time.
- [x] Ship the accumulated mobile commits as they sit on the release base. Do
      not cherry-pick a subset; that would produce a combination no one has
      tested.
- [x] Identify the exact 1.0.1 build commit from EAS build metadata (no git
      tag exists for it) and attach the commit inventory since that SHA to
      the build report. This inventory is what makes section 4 checkable.
- [x] Diff `eas.json`'s production profile between the 1.0.1 SHA and the
      release SHA and record the `EXPO_PUBLIC_*` flag changes that will bake
      into this binary.
- [x] Confirm `git status --short` is empty immediately before each EAS build.
- [x] Record the release commit SHA in the build report and git-tag it
      `v1.0.2`, so the next release can answer "what changed since the last
      binary" without EAS archaeology.

## 2. Version and build configuration

- [x] Set `expo.version` in `app.json` to `1.0.2`.
- [x] Set the root package version in `package.json` and `package-lock.json` to
      `1.0.2`.
- [x] Regenerate release-state after the version bump (`npm run
      release:state`) before running the gate; a stale generated state has
      failed submission before.
- [x] Keep EAS remote app-version management and auto-increment enabled.
- [x] Keep debug, dev-client, QA publishing, and screenshot flags absent from
      production builds.
- [x] Confirm production Supabase, legal/support URLs, Google Maps key, social
      auth client ids, bundle id, and Android package resolve as expected
      without printing secret values.
- [x] Add the dedicated iOS Checkout flag with Android fail-closed behavior.
      Per the recorded decision, production sets
      `EXPO_PUBLIC_ENABLE_IOS_TRIAL_CHECKOUT=true`; launch behavior is
      controlled entirely by the server kill switch, which ships OFF.
- [x] Add and verify the server kill switch before the build. It ships OFF
      and is the only control that enables iOS Checkout later without a new
      binary.

## 3. Required code and policy corrections

- [x] Implement the platform-specific Checkout contract above.
- [x] Update the public privacy policy before submission — required, not
      conditional, because the submitted binary carries the Checkout
      capability even while the server switch is off. Remove any statement
      that incorrectly says the submitted app cannot initiate web Checkout.
- [x] Update Apple review notes to explain that consumer use is free, merchant
      accounts are reviewed, what the merchant subscription enables, where the
      purchase occurs, and how reviewers can test without making a payment.
      State plainly that the Checkout path exists in the binary and is
      remotely disabled at launch.
- [x] Confirm App Store availability is limited to eligible storefronts before
      submission, and reconfirm before the server switch is ever turned on.
      If eligibility fails, the kill switch stays off. Verified through the
      authenticated App Store Connect API: the United States is available,
      South Korea is unavailable, and automatic availability in new territories
      is disabled. Public storefront lookup agrees (US present, KR absent).
- [x] Complete the Apple Wallet pass type registration and signing certificate
      (currently parked) so the iOS wallet button yields a valid pass.
      Fallback if this slips: hide the iOS wallet button for 1.0.2.
- [x] Keep Google Play listing/review notes free of any Android external-payment
      direction. Verified against the authenticated Play listing and exact
      internal version-code 61 release notes; no Checkout, billing, pricing,
      subscription, Stripe, or external-payment direction is present.
- [x] Fix the seven current Edge Function type errors before merging or
      deploying the web-attack-hardening work. Those errors live in the
      hardening commit on `website/homepage-redesign-2026-08-01`, so
      `npm run typecheck:functions` may already pass on `main`; re-measure on
      the actual release base instead of trusting the snapshot below.
- [x] Fix the two current full-suite test failures.
- [x] Align `react-native-worklets` with the Expo SDK 54 expected version
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

- [x] Verify the section 1 commit inventory contains only reviewed work;
      anything unreviewed gets reviewed now, not silently shipped or reverted
      piecemeal.
- [x] Keep automatic local-session removal for suspended or archived accounts.
- [x] Keep consistent support-email behavior across customer and merchant
      surfaces.
- [x] Confirm all merchant states remain recoverable: pending, approved but not
      activated, active trial, paid, suspended, expired, and archived.
- [x] Do not add Sentry or another new native SDK solely to make this train.
      Existing first-party error reporting and the monitoring runbook remain
      the compensating control unless a separate SDK change is reviewed and
      device-tested.

## 5. Automated release gates

Every command must pass against the exact clean release commit:

- [x] `npm run typecheck`
- [x] `npm run lint`
- [x] `npm test`
- [x] `npm run typecheck:functions`
- [x] `npx expo-doctor`
- [x] `npm run gate:release-state`
- [x] `npm run gate:ai-poster-lock`
- [x] `npm run check:i18n-keys`
- [x] `npm run check:mobile-store-copy`
- [x] `npm run check:website-supabase`
- [x] Relevant hosted Edge Function and RLS smoke gates after any approved
      backend deployment

Final audit on 2026-08-01: every gate above passed against clean exact binary
source commit `2451ff39fe22f97d730a0e25cde1bced2bce2497`. The full suite
passed 320 files / 2,218 tests; Edge Function typechecking passed 163 files;
Expo Doctor passed 18/18; the worklets version is aligned at `0.5.1`.

**Re-measured 2026-08-02 on `b45860d5` (clean tree; `main` == `release/1.0.2`
after PR #64). All 11 gates green again**, including the conditional hosted
gate. Results: typecheck, lint, `npm test` (320 files / 2,218 tests),
typecheck:functions, expo-doctor 18/18, gate:release-state,
gate:ai-poster-lock, check:i18n-keys, check:mobile-store-copy,
check:website-supabase, and `gate:edges` (7/7 hosted functions HEALTHY).

**The binary is still accurately represented.** The 8 commits between
`2451ff39` and this re-measurement touch only `website/**`, `docs/**`, three
`*.test.ts` guards, `scripts/check-website-i18n.js`,
`scripts/check-website-supabase-readiness.js`, and the
`submit-business-application` Edge Function — no mobile app source, no
`app.json`, `package.json`, `eas.json`, or native config. So the exact-binary
QA in section 6 is not invalidated by this work and does not need redoing.

Two gates had to be repaired to pass, both fallout from the website CSP work
rather than product defects (commits `21efc019`, `b45860d5`): source-sync
guards that read website HTML were repointed at the externalized
`share-page.js` / `apply.js`, and `check:website-supabase` was stopped from
walking `website/.vercel/output/**`, which now exists locally because deploys
run `vercel build` first.

Backend note: `submit-business-application` was redeployed 2026-08-02 with
re-weighted intake scoring (see the website growth plan). Smoke-verified
hosted: an empty payload returns HTTP 400 `Missing required fields.`, not a
500.

## 6. Exact-binary QA

### Both platforms

- [x] Merchant publish loop end to end: create a deal, AI-generate the ad,
      publish. Include a same-item BOGO, an imageless/provider-refusal
      fallback case, and the promote-from-menu ad-format choice. This path
      changed heavily since 1.0.1 and today appears only in post-release
      monitoring. Exercised on the exact Android v61 payload, including provider
      refusal with manual image recovery, same-item BOGO, menu promotion/ad
      format selection, accepted localization, and successful publication.
- [x] Manual redemption paths new since 1.0.1: double-tap-the-QR redemption
      and the Use Deal pass manual redeem. Exact v61 showed the double-tap
      confirmation/cancel path, generated the Use Deal pass, and completed
      merchant ticket-code redemption to the consumer Redeemed state.
- [x] Claim-conflict messaging and repeat-restriction hiding, using the
      second claimable live deal required by section 7. Exact v61 blocked a
      second active claim with localized conflict copy; releasing the first
      claim made the second offer claimable, and both claims were released.
- [x] Site-import onboarding: one pass through the in-app business
      application with website import (`EXPO_PUBLIC_ENABLE_SITE_IMPORT` is on
      in the production profile, and merchant activation is a release
      objective). Completed with disposable production QA data on exact v61:
      submitted the application in-app, observed the waitlist state, entered
      approved setup, selected a verified Google Places result, and imported
      three logo candidates plus two menu items with rights consent shown.
      The disposable application, business, onboarding request, and auth user
      were then deleted and verified absent.
- [x] Spot-check the new claim/redemption strings on-device in Spanish and
      Korean; the key gate proves existence, not quality, and Spanish has
      regressed on device before. Wallet/settings and conflict/release states
      were visually checked in both languages on exact v61, then English was
      restored.

### Android

- [x] Build an AAB with the production Android configuration.
- [x] Upload to Play internal testing first.
- [x] Prove no merchant surface contains an external-payment CTA or opens a
      payment URL. Inspected the full exact-v61 merchant Account surface in
      dark mode; no Checkout, billing, pricing, subscription, or external-
      payment CTA/URL was present.
- [x] Smoke Google sign-in, Maps, location denial/ZIP fallback, account
      deletion, customer claim/release, merchant QR redemption, push settings,
      deep links, and support contact on a real Android device. The exact v61
      payload passed broad emulator coverage (including ZIP fallback,
      claim/release/redemption, deep links, and support surfaces), but an
      emulator does not satisfy this physical-device gate.
      **CLOSED 2026-08-02 on a real S10 (SM-G973U1, Android 12) running the
      exact Play internal vc61/1.0.2 payload — see
      `docs/qa/S10_PRODUCTION_1.0.2_ANDROID_QA_2026-08-02.md`.** Every item in
      this line passed on device: Google sign-in; Maps (production key renders
      live tiles with correct attribution); location denial → ZIP fallback
      including persistence; account deletion through both confirmation steps
      (irreversible confirm deliberately not tapped, so deletion *execution*
      remains unverified); customer claim **and** release; merchant QR
      redemption; push settings; deep links (`www.twoferapp.com` verified, app
      opens, invalid code gives a clean localized error); and support contact
      (`mailto:` dispatches). No external-payment CTA exists on the consumer
      **or** merchant surface, the latter checked with "+ More options"
      expanded.
      Production had no real claimable deal (all six live offers were Cedar &
      Bean demo with a disabled "Demo offer" button), so a real non-demo deal
      was published in-app from the merchant account to unblock — which also
      re-verified the publish loop, the same-item BOGO acceptance, and poster
      generation on device. Redemption ran through the Ticket code fallback
      (single device, so a phone cannot scan its own QR); the scanner itself
      was confirmed to open a live viewfinder after a clean permission grant.
      Invalid codes and double-redeem were both correctly rejected with
      distinct messages, and merchant dashboard + consumer wallet reconciled.
      **CONFIRMED BUG (not a release blocker, but should be fixed): releasing a
      claim never returns deal inventory, and this also affects cap
      enforcement, not just the displayed count.** Reproduced clean on a fresh
      10-claim deal: 10 available → claim → 9 → release → still 9 (dialog says
      "returns it to the deal"). Root cause in source: `release-claim` writes
      `claim_status = 'released'`
      (`supabase/functions/release-claim/index.ts:119`), added to the
      `deal_claims_claim_status_check` constraint by
      `20260721120000_deal_wallet_redemption_rules.sql:138`, but all three
      counting/enforcement sites still exclude only the no-longer-written
      `'canceled'` status: the `deal_claim_counts` display RPC
      (`20260716120000_deal_claim_counts_rpc.sql:22`), the DB-level cap trigger
      (`20260704130000_enforce_max_claims_atomic.sql:36`), and `claim-deal`'s
      own cap check (`supabase/functions/claim-deal/index.ts:713` and `:873`).
      Because the enforcement path has the same gap, a deal can be fully
      sold out by claim-then-release churn with zero actual redemptions. Not
      fixed — needs a product decision (exclude `'released'` from the counts,
      which changes claim semantics, vs. change the release-dialog copy) before
      code changes.
- [ ] Google Wallet: save the pass and open the app from the saved pass. The
      wallet-to-app route is new since 1.0.1, and the Google issuer was only
      approved after the last binary shipped.
      **Tested on the S10 2026-08-02. SAVE PASSES; PASS-TO-APP FAILED.** The
      "Add to Google Wallet" button saved a correctly branded pass carrying the
      deal, business, redeem-by, QR, and claim code. But the pass's
      **"Open Twofer"** action launched Chrome to the marketing homepage instead
      of the app. Root cause: `wallet-pass-content.ts:269` declared the Android
      package as `com.unvmex2.twoferone`; the real package is
      `com.unvmex2.twoforone` (`app.json:208`, and the typo'd package resolves to
      0 installed matches). Wallet cannot resolve an `appTarget` for a
      non-existent package, so it silently drops the app-link button and falls
      back to the https marketing link. `wallet-pass-content.test.ts:241`
      asserted the same typo, so the guard was vacuous.
      The rest of the route is sound: firing `twofer://wallet?pass=1` directly
      opened the app straight to the staff pass sheet (SHOW STAFF, 24 s scan
      window, QR, "Tap the QR twice to redeem", claim code).
      **Fix applied to both files 2026-08-02**, plus a new cross-file guard in
      `wallet-pass-source.test.ts` asserting the constant equals
      `expo.android.package` in `app.json` (the old unit test asserted the
      hardcoded typo, so it was vacuous). Full suite green after the change.
      This is Edge Function source, **not mobile source — no new binary is
      required**, only a function redeploy.
      **Deploy COMPLETE 2026-08-02, verified via `supabase functions list`:**
      all seven functions embedding the constant are ACTIVE on fixed source —
      wallet-pass-issue v32, claim-deal v111, release-claim v68,
      staff-redemption v67, redeem-token v113, complete-visual-redeem v98,
      finalize-stale-redeems v94. All six lifecycle functions were required,
      not just the issuer: `syncWalletPassForUser` re-upserts the whole Google
      object on every claim/redeem/release, so a stale one would stamp the typo
      back onto a freshly saved pass. `wallet-pass-webservice` (v28) needs no
      redeploy. Post-deploy smoke on the S10 was clean.
      **RETESTED 2026-08-02 — the app-link button still does not render, on a
      genuine fresh pass CREATE (not just a PATCH of an old object). A second,
      deeper bug found, root-caused against Google's live API docs, and it
      changes the scope of this gate materially:**
      `wallet-pass-content.ts:420-431` sets `appTarget.packageName` AND
      `appTarget.targetUri` together inside `androidAppLinkInfo`, but per
      Google's own reference, `appTarget` is a union field — only one may be
      set. Worse, **`androidAppLinkInfo` cannot deep-link to a specific screen
      at all**; Google's docs state plainly that reaching a specific view
      requires `webAppLinkInfo` with a verified `https://` App Link target,
      which the code never sets. The only currently-verified Android App Link
      path is `/s/{code}`; a wallet-specific path (e.g. `/wallet`) would need
      its own `autoVerify: true` intent-filter entry in `app.json`.
      **Intent filters compile into the native AndroidManifest.xml — this
      needs a new mobile binary, not just an Edge Function redeploy.** The
      original "no new binary required" framing was correct only for the
      package-name typo in isolation; it does not hold once this second bug
      is factored in. Not fixed — this is a product/engineering scoping
      decision (new App Link path + binary), not something to patch
      unilaterally mid-QA.
      **A third, smaller bug was found investigating this:** the client-side
      "Add to Google Wallet" badge visibility (`add-to-wallet-button.tsx:48`)
      is gated by a single global AsyncStorage key with no user id
      (`lib/native-wallet-pass-storage.ts:9`), so once any account taps it
      once on a device, every other account on that same device never sees
      the badge again — a real defect, low real-world impact (most users
      hold one account per device), flagged but not fixed.
      **Remediation for this gate and every other QA finding is planned in
      `docs/plans/s10-qa-remediation-plan-2026-08-02.md`** (that file is its
      own tracker). Recommended path: ship vc61 as-is; the server-side
      `appLinkData` schema fix (phase B1 there) may close this gate without a
      binary; the true deep link, badge scoping, and banner copy ride 1.0.3.

### iOS

- [x] Build an IPA with the production iOS configuration.
- [x] Upload to TestFlight first.
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
- [x] Reconfirm storefront availability and review-note/privacy accuracy against
      the exact submitted build. Authenticated App Store Connect metadata for
      iOS build 33 confirms the eligible storefront posture (US available,
      South Korea unavailable), review notes, privacy disclosure, manual
      release, and phased release; the submitted build reports source commit
      `2451ff39`.

## 7. Reviewer and market readiness

- [x] Consumer reviewer account is active and claim-clean.
- [x] Merchant reviewer account is already active and can exercise business
      tools without purchasing.
- [x] Reviewer data contains at least two claimable live offers visible
      outside the user's physical Dallas location when using the provided
      account. Two are required so claim-conflict and repeat-restriction
      behavior is testable; exact v61 exercised two simultaneously claimable
      offers and restored the reviewer consumer to a claim-clean state.
- [x] Privacy, terms, support, delete-account, association, and asset-links URLs
      are public and return the expected content.
- [x] App Store “What's New” and Google Play release notes accurately describe
      the material changes and contain no empty bullet. The exact Play internal
      version-code 61 release received the final broad 1.0.2 note and was
      re-read through the authenticated API.
- [x] Correct the Apple title spacing (`Twofer: Live Local Deals`). Decided
      2026-08-01: fix it this release.
- [x] Reconfirm the intended category alignment between Apple and Google Play.
      Apple primary category and Google Play category both resolve to Food &
      Drink.
- [x] Decide demo-account teardown. Decided 2026-08-01: the demo accounts and
      demo deals stay for this release. Reviewer accounts ship anyway;
      revisit teardown once real merchant deal supply grows.

## 8. Release and rollback

- [ ] Promote Android with a staged rollout, not immediate 100% availability.
- [x] Use Apple's phased release for the iOS update.
- [x] Define halt criteria before promoting: hold the Android rollout at its
      current stage and pause the iOS phased release if sign-in failures,
      crash rate, claim/redemption failures, or support volume regress
      against the 1.0.1 baseline.
- [x] Record EAS build ids, store build numbers, commit SHA, configuration
      decision, and QA evidence.
- [ ] Monitor sign-in failures, merchant activation attempts, Checkout failures
      where enabled, first-deal publication, claims, redemptions, account
      deletion, and support volume.
- [x] If iOS Checkout creates review, policy, or production issues, disable the
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
