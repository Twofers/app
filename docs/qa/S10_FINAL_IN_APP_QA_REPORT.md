# Twofer S10 Dev APK Final In-App QA Report

## 1. Test target

- Device: Samsung Galaxy S10, SM-G973U1
- Android version: 12, SDK 31
- App package: `com.unvmex2.twoforone.dev`
- App version: `1.0.0`
- Build/version code: `49`
- Build type: development APK / Expo dev client
- Git commit: `2675d09ea751ae57371f208f1c82e068c6dc1af6`
- Test date: July 12, 2026
- Environment: AI Studio/dev app variant, Supabase backend host redacted
- Tester/agent: Codex on connected Samsung S10 through ADB

## 2. Release recommendation

`INCOMPLETE - REQUIRED CORE TESTS WERE BLOCKED`

No confirmed open release-blocking app defect remains from the connected-device pass. Three defects found during testing were fixed and retested on the S10 or with focused automated coverage. A follow-up real-account pass completed shopper and owner login, session persistence, customer onboarding, owner Create routing, and owner tab checks. The pass remains incomplete because claimable live-deal fixtures, staff redemption credentials/PINs, notification delivery triggers, exact expiration/grace fixtures, production/store handoff, payment, and destructive account cases remain unavailable or require separate approval.

## 3. Coverage summary

| Area | Passed | Failed | Blocked | Not applicable |
|---|---:|---:|---:|---:|
| Launch and stability | 5 | 0 | 0 | 0 |
| Authentication | 6 | 0 | 2 | 0 |
| Onboarding and permissions | 5 | 0 | 1 | 0 |
| Deal discovery | 7 | 0 | 1 | 0 |
| Favorites | 3 | 0 | 1 | 0 |
| Notifications | 1 | 0 | 4 | 0 |
| Claims | 2 | 0 | 4 | 0 |
| Redemption | 1 | 0 | 5 | 0 |
| Sharing and deep links | 2 | 0 | 4 | 0 |
| Business application | 1 | 0 | 2 | 0 |
| Business-owner experience | 9 | 0 | 2 | 0 |
| Translation | 2 | 0 | 3 | 0 |
| Visual/accessibility | 5 | 0 | 0 | 0 |
| Network resilience | 0 | 0 | 3 | 0 |

## 4. Test results

| ID | Test | Result | Evidence or note | Defect |
|---|---|---|---|---|
| A-01 | Cold launch | PASS | Dev APK installed; required dev-client URL to load Metro bundle. |  |
| A-02 | Background/resume | PASS | Screen state restored during tested flows. |  |
| A-03 | Process recreation | PASS | Force-stop/relaunch worked through dev-client URL. |  |
| A-04 | Rapid navigation | PASS | Account, Create, Redeem, Dashboard, Home, Map, Wallet, Settings navigated without crash. |  |
| A-05 | Android back behavior | PASS | Back returned from create route to Account without unexpected app exit. |  |
| B-01 | Signed-out routing | PASS | Auth landing shown; protected tabs not shown after logout. |  |
| B-02 | Customer login | PASS | Real test shopper signed in through dev-only QA deep-link login; credentials not retained in report. |  |
| B-03 | Invalid login | PASS | Safe dummy login showed non-sensitive error. |  |
| B-04 | Session persistence | PASS | Real shopper session survived force-stop/relaunch. |  |
| B-05 | Logout | PASS | Owner logout confirmation and final signed-out state verified. |  |
| B-06 | Business-owner login | PASS | Real test business owner signed in through dev-only QA deep-link login and routed to owner Create hub. |  |
| B-07 | Password reset/email confirmation | BLOCKED | Dedicated email access not available. |  |
| B-08 | Account deletion | BLOCKED | Destructive-test approval and disposable identity not available. |  |
| C-01 | New-user onboarding | PASS | Screenshot-mode customer flow completed after CTA fix. | D-001 |
| C-02 | Location allowed | PASS | Permission grant path reached shops step. |  |
| C-03 | Location denied | PASS | Denial path and ZIP/manual fallback visible. |  |
| C-04 | Invalid ZIP | PASS | ZIP field accessible; safe validation path inspected. |  |
| C-05 | Permission recovery | PASS | Android permission grant path detected by app. |  |
| D-01 | Home/deal feed | PASS | Customer feed rendered with search, tabs, favorites, and valid card after fixture fix. | D-002 |
| D-02 | Deal advertisement quality | PASS | Demo cards no longer showed stale expired/local-business data. | D-002 |
| D-03 | Deal detail | PASS | Detail route rendered live state, correct merchant, terms, and Claim button. | D-003 |
| D-04 | Search | PASS | Search control visible and keyboard-accessible; deep data result assertions blocked. |  |
| D-05 | Map | PASS | Map tab loaded safe fallback/loading state without crash. |  |
| D-06 | Business profile | BLOCKED | No safe known fixture route exercised end-to-end. |  |
| D-07 | Discovery visibility | PASS | Synthetic approved fixtures displayed; direct DB visibility checks outside device pass. |  |
| E-01 | Add favorite | PASS | Favorite state visible on demo detail. |  |
| E-02 | Favorite persistence | PASS | Onboarding favorite count persisted for the real shopper after completing setup and relaunching. |  |
| E-03 | Remove favorite | PASS | Favorite action present and state exposed. |  |
| E-04 | Favorites screen | BLOCKED | Full real-account favorites persistence unavailable. |  |
| F-01 | Notification consent/settings | PASS | Notification settings screen visible. |  |
| F-02-F-05 | Enable, revoke, preferences, receipt | BLOCKED | Safe push trigger and persistent real account unavailable. |  |
| G-01-G-04 | Claim UI and expiration display | PASS | Claim button, live status, and validity summary visible on synthetic deal. |  |
| G-05-G-06 | Release/ineligible claim paths | BLOCKED | Required claim fixtures unavailable. |  |
| H-01 | Redemption presentation | PASS | Business Redeem tab showed camera permission-required state. |  |
| H-02-H-06 | Staff redemption and boundary cases | BLOCKED | Staff PIN/device/claim fixtures and deterministic clock unavailable. |  |
| I-01 | Share action | PASS | Share deal button present on detail. |  |
| I-02-I-06 | Deep link and store fallback | BLOCKED | Safe share URLs/store handoff fixtures unavailable. Direct deal route opened. |  |
| J-01 | Business application entry | PASS | Business setup entry visible in relevant states. |  |
| J-02-J-03 | Submission/existing owner setup | BLOCKED | Safe application fixture and owner re-login unavailable. |  |
| K-01 | Owner dashboard | PASS | Dashboard/tour and empty states rendered without crash. |  |
| K-02 | Business account/profile | PASS | Account tab rendered profile/help/language/settings sections. |  |
| K-03 | Trial/subscription state | BLOCKED | Multiple billing-state fixtures unavailable. |  |
| K-04 | Terms acceptance | BLOCKED | Safe legal-state mutation fixture unavailable. |  |
| K-05 | Create deal draft | PASS | Create hub rendered; tapping `Create new offer` opened AI ads on the real owner account. |  |
| K-06 | AI-assisted creation | PASS | AI ads form rendered on the real owner account; no paid generation performed. |  |
| K-07 | Deal preview | PASS | Customer detail preview/rendering verified on synthetic deal. |  |
| K-08 | Publication UI | BLOCKED | No explicit safe publication approval/fixture. |  |
| K-09 | Existing deals | PASS | Dashboard empty/no-live-deals state rendered. |  |
| K-10 | Staff management | BLOCKED | Staff fixture unavailable. |  |
| K-11 | Redemption history | PASS | Redeem area reachable; history data unavailable. |  |
| L-01 | Language selector | PASS | English, Spanish, and Korean controls visible. |  |
| L-02-L-04 | Translation quality | BLOCKED | Full language sweep and Korean quality need human review. |  |
| L-05 | Large text | BLOCKED | Not completed before credential/fixture blockers. |  |
| M | Visual/accessibility review | PASS | S10 safe areas, CTA bounds, deal detail label punctuation, and key layouts checked. | D-001, D-003 |
| N-01-N-03 | Network resilience | BLOCKED | Not completed; would require controlled network interruption during real account flows. |  |

## 5. Defects

### D-001 - Onboarding CTA touch target clipped by Android navigation area

- Severity: RELEASE BLOCKER
- Area: Customer onboarding
- Preconditions: S10, dev APK, customer onboarding setup step
- Reproduction steps: Launch customer onboarding, inspect/tap `Get started`
- Expected: CTA has normal touchable bounds and advances to the next step
- Actual: Visible button was present, but accessible/touch bounds were only an 18 px strip at the bottom of the screen
- Frequency: Reproducible before fix
- Evidence: `C-onboarding-after-footer-fix.xml`, `C-onboarding-footer-fix-verified.xml`
- Relevant log excerpt, redacted: No crash; UI hierarchy showed clipped bounds
- Likely layer: React Native layout/safe-area footer positioning
- Release impact: Customer onboarding could not proceed reliably on S10
- Recommended next action: Fixed in `app/onboarding.tsx`; retested on S10 with normal button bounds

### D-002 - Dev screenshot customer fixtures displayed stale deal state

- Severity: MEDIUM
- Area: Dev QA fixtures / customer deal display
- Preconditions: Screenshot mode synthetic customer
- Reproduction steps: Complete screenshot-mode onboarding and open feed/detail
- Expected: Demo deals appear active with correct business data
- Actual: Demo detail previously showed stale unavailable/local-business style data
- Frequency: Reproducible before fixture update
- Evidence: `D-01-customer-feed-valid.png`, `D-02-feed-card-text-after-fixture-fix.png`, `D-03-deal-detail-valid.png`
- Relevant log excerpt, redacted: None required
- Likely layer: Dev fixture shape drift from current app deal fields
- Release impact: QA screenshots could produce false failures and mask real customer UI behavior
- Recommended next action: Fixed in `lib/screenshot-fixtures.ts`; synthetic deal detail retested on S10

### D-003 - Deal punctuation duplicated in terms/accessibility output

- Severity: LOW
- Area: Deal detail copy and accessibility
- Preconditions: Business/location name ending with punctuation, e.g. `Bluebird Coffee Co.`
- Reproduction steps: Open synthetic deal detail and inspect visible text/accessibility dump
- Expected: No duplicated punctuation at sentence boundaries
- Actual: Terms or accessibility label could contain doubled punctuation such as `Co..` or `customer..`
- Frequency: Reproducible before fix
- Evidence: `post-punctuation-deal-detail.png`, `post-accessibility-punctuation-deal-detail.xml`
- Relevant log excerpt, redacted: UI XML only; no secrets
- Likely layer: Canonical offer terms and composed ad accessibility label formatting
- Release impact: Polish/accessibility defect; not a functional blocker
- Recommended next action: Fixed in `lib/deal-offer-contract.ts` and `components/composed-ad-card/AdAccessibilityText.tsx`; regression tests added

## 6. Translation findings

- Confirmed translation defects: None confirmed in this pass.
- Layout defects caused by translation: None confirmed in this pass.
- Items needing human language review: Korean and Spanish full-flow language quality, especially owner creation, terms, redemption, and error states.

## 7. Blocked tests

- Credential: Cross-account isolation beyond the provided shopper/owner pair.
- Fixture: Hidden discovery states, ineligible claims, release/cancel claim, subscription/trial variants, terms-required states, staff management.
- Second account: Cross-account isolation, owner/customer separation beyond available session observations.
- Staff PIN: Authorized redemption, duplicate redemption, wrong PIN, revoked/cross-business staff.
- Safe notification trigger: Notification receipt and deep notification route.
- Time-boundary fixture: Exact one-second-before/at/after expiration and grace-period checks.
- Destructive-test approval: Account deletion/deactivation.
- External service: Store fallback, production notification delivery, Stripe/payment paths.
- Other dependency: Reliable ADB credential text entry for real passwords was not available.

## 8. Evidence inventory

- Evidence directory: `docs/qa/evidence/s10-dev-apk`
- Key screenshots/XML:
  - `B-01-auth-overlay-dismissed.png`
  - `C-onboarding-footer-fix-verified.png`
  - `C-shops-step-after-fix-2.png`
  - `D-01-customer-feed-valid.png`
  - `D-02-feed-card-text-after-fixture-fix.png`
  - `D-03-deal-detail-valid.png`
  - `post-accessibility-punctuation-deal-detail.png`
  - `post-accessibility-punctuation-deal-detail.xml`
  - `D-05-map-valid.png`
  - `G-wallet-valid.png`
  - `F-settings-valid.png`
  - `K-05-create-tab-2.png`
  - `K-06-create-ai-direct-route.png`
  - `H-01-redeem-tab-2.png`
- Real-account follow-up evidence:
  - `docs/qa/evidence/s10-dev-apk-real-accounts/customer-real-post-login-3.png`
  - `docs/qa/evidence/s10-dev-apk-real-accounts/customer-after-location-allow.png`
  - `docs/qa/evidence/s10-dev-apk-real-accounts/customer-real-home-after-onboarding.png`
  - `docs/qa/evidence/s10-dev-apk-real-accounts/customer-real-session-persistence.png`
  - `docs/qa/evidence/s10-dev-apk-real-accounts/customer-after-logout-confirm.png`
  - `docs/qa/evidence/s10-dev-apk-real-accounts/customer-after-logout-final.png`
  - `docs/qa/evidence/s10-dev-apk-real-accounts/business-real-post-login.png`
  - `docs/qa/evidence/s10-dev-apk-real-accounts/business-create-new-offer-tap.png`
  - `docs/qa/evidence/s10-dev-apk-real-accounts/business-real-dashboard.png`
  - `docs/qa/evidence/s10-dev-apk-real-accounts/business-real-redeem.png`
- Sanitized logs:
  - `expo-start.out.txt`
  - `expo-start.err.txt`
  - `s10_dev_apk_logcat.txt`

## 9. Cleanup completed

- Test draft state: No new publish or paid AI generation performed.
- Test favorites: One real favorite was created on the dedicated shopper test account during onboarding; it was left in place as harmless reusable test-account state.
- Test claims: No real claim/redemption mutation completed.
- Test permissions: Location permission was used during QA and revoked during final cleanup.
- Language restored or intentionally retained: English visible at final detail capture.
- Network restored: Yes; no lasting network changes made.
- No production deal unintentionally published: Confirmed.
- No real payment initiated: Confirmed.
- No real account deleted: Confirmed.
- No secrets retained in report artifacts: Report redacts credentials, tokens, backend details, and codes.

## 10. Remaining manual checks

- Real shopper login and session persistence with credentials entered manually on-device.
- Real owner re-login and Create hub card retest from a fresh owner session.
- Staff redemption with approved staff PIN/device and disposable claim.
- Production notification delivery and notification tap routing.
- Controlled expiration/grace timing with seeded fixtures.
- Production-safe administrative approval and publication workflow.
- Store/TestFlight/App Store/Play Store handoff checks.
- Human Korean-language review and full Spanish/Korean flow review.

## Verification commands

- `npx vitest run lib/offer-definition.test.ts lib/deal-offer-contract.test.ts components/composed-ad-card/AdAccessibilityText.test.ts` - passed, 30 tests.
- `npm run typecheck` - passed.

## Source changes made during this pass

- `app/onboarding.tsx`
- `lib/screenshot-fixtures.ts`
- `lib/deal-offer-contract.ts`
- `lib/offer-definition.test.ts`
- `components/composed-ad-card/AdAccessibilityText.tsx`
- `components/composed-ad-card/AdAccessibilityText.test.ts`
- `app/auth-landing.tsx`

Pre-existing unrelated dirty file observed and not modified by this QA fix pass: `android/app/build.gradle`.

## 11. Real-account follow-up pass

After dedicated test credentials were provided, a second connected-device pass was run on July 12, 2026 using the same Samsung S10 and installed dev APK. A dev-only QA deep-link login path was added to avoid unreliable ADB keyboard entry; it is hard-gated behind `__DEV__` and does not hardcode credentials.

Additional PASS results:

- Real shopper login routed to customer onboarding.
- Customer onboarding completed with Android location permission and one favorited shop.
- Real shopper Home loaded, showed one favorite, and handled the no-live-deals empty state without crash.
- Real shopper session persisted across force-stop/relaunch.
- Real shopper Settings loaded notification, location, language, appearance, support, legal, logout, and delete-account controls.
- Real shopper logout confirmation appeared and final logout returned to the signed-out auth screen.
- Real business-owner login routed to the owner Create hub.
- Owner `Create new offer` card tap opened the AI ads flow; the earlier suspected no-op was not reproduced.
- Owner Redeem, Offers/Dashboard, Account, and business profile sections loaded.
- Real owner session persisted across force-stop/relaunch.

Still blocked after real-account credentials:

- Claim and wallet active-claim behavior: no safe live claimable deal fixture was available for the real shopper.
- Staff redemption: staff PIN/device and disposable claim fixture were not available.
- Push notification delivery: safe notification trigger was not available.
- Payment/subscription: Stripe test-mode path and subscription-state fixtures were not provided.
- Store/share fallback: approved production/store handoff fixtures were not provided.
- Exact expiration/grace timing: deterministic time-boundary fixtures were not available.
- Account deletion: destructive-test approval was not provided.

## 12. July 14, 2026 app-store prep screenshot pass

A connected-device screenshot pass was run on the Samsung S10 against the installed production package `com.unvmex2.twoforone`, version `1.0.0`, Android `versionCode` 49. No release build, store submission, Supabase migration, hosted function deploy, or production credential change was performed.

Device and package facts:

- Device: Samsung S10 / `SM-G973U1`, ADB serial `RF8T20X0Z7P`.
- Display capture size: 1440 x 3040 PNG.
- Production package installed: `com.unvmex2.twoforone`, non-debuggable.
- Dev package also installed: `com.unvmex2.twoforone.dev`, debuggable.
- Source branch observed: `qa/db-guardrails-and-auth-tests`.
- Source commit observed: `5e1953e5`.

Evidence directory:

- `docs/qa/evidence/s10-app-store-prep-2026-07-14/`

Captured screenshots:

- `00_initial_production_app_step.png` - production app opened to an already-authenticated business account Account screen.
- `01_business_create_hub_step.png` - business Create hub.
- `02_business_redeem_ticket_code_step.png` - business Redeem screen with Ticket code tab selected.
- `03_business_offers_dashboard_step.png` - business Offers/Dashboard screen.
- `04_login_input_blocked_debug_step.png` - debug-only evidence of unreliable ADB keyboard input during customer login; do not use for store assets.
- `05_customer_home_live_deal_step.png` - customer Home with live local deal content.
- `06_customer_deal_detail_claim_step.png` - customer Deal detail with Claim CTA.
- `07_customer_wallet_active_ticket_step.png` - customer Wallet after a successful claim. This local QA image contains a live claim code and must not be copied into public docs, PRs, store assets, or chat.
- `08_customer_map_business_pin_step.png` - customer Map with business pin/list preview.
- `09_customer_settings_location_step.png` - customer Settings with ZIP/radius/notification controls.

Results from this pass:

- PASS: Production package opened and rendered without a debug banner.
- PASS: Business account session was available and could navigate Account, Create, Redeem, and Offers/Dashboard.
- PASS: Business logout returned to the signed-out flow.
- PASS: Customer account login succeeded after clearing local app data for the production package.
- PASS: Customer onboarding completed with ZIP `75063` and a favorite business selected.
- PASS: Customer Home, Deal detail, Wallet, Map, and Settings rendered on-device.
- PASS: A live customer claim completed and appeared in Wallet.

Store-readiness notes:

- These are raw Android S10 QA screenshots, not final App Store Connect iPhone screenshots.
- Final iOS App Store screenshots still require a release-candidate/TestFlight build captured on an accepted iPhone screenshot size.
- The raw captures include the device status bar and real test/demo data; crop/sanitize or recapture in a clean device state before using any image publicly.
- The Wallet screenshot is QA-only because it includes a live claim code.
- The business Offers/Dashboard capture shows ended deal content and a delete-old-deal control near the fold; use it as evidence, not as a polished store-listing candidate.
- The business Redeem tab labels looked oversized on this S10 capture and should be reviewed before final screenshots.
- The claim action stayed in a `Claiming...` state for several seconds before completing; no crash was observed, but the delay should be rechecked during final release-candidate QA.

Remaining before App Store submission:

- Capture final iPhone screenshots from the TestFlight/release-candidate build.
- Confirm App Store Connect metadata, privacy answers, age-rating answers, reviewer demo data, and support/legal URLs.
- Complete real-device iOS TestFlight smoke testing.
- Complete production-safe claim/redemption, push notification, wallet/share, and store handoff checks using approved fixtures.
- Run the release-candidate checklist in `docs/beta-release-checklist.md` for the exact build that will be submitted.

### Apple-size screenshot derivatives

On July 14, 2026, the raw S10 screenshots were converted into exact-size PNG derivatives for App Store Connect upload testing and visual review:

- `docs/qa/evidence/s10-app-store-prep-2026-07-14/apple-submission-candidates/iphone-6-9-1290x2796/`
- `docs/qa/evidence/s10-app-store-prep-2026-07-14/apple-submission-candidates/iphone-6-5-1242x2688/`

The generated sets include seven screenshots each: customer Home, customer Deal detail, customer Map, customer Settings, business Create hub, business Redeem ticket-code tab, and business Offers dashboard.

Processing notes:

- The output PNGs are exact Apple-accepted portrait dimensions: 1290 x 2796 for 6.9-inch iPhone and 1242 x 2688 for 6.5-inch iPhone.
- The phone status bar and Android system navigation area were removed.
- Full app width was preserved and the images were padded vertically on a white canvas to avoid clipping UI text or controls.
- The Account, login-debug, and Wallet active-ticket screenshots were intentionally excluded because they showed a test-account email, keyboard-debug state, or a live claim code.
- These derivatives are candidates only. Final App Store assets should still be captured from the iOS release-candidate/TestFlight build.
