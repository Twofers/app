# Twofer — Store Release Prep (Google Play + Apple App Store / TestFlight)

This is the single store-submission prep doc for Twofer. It collects everything needed to
publish to Google Play and the Apple App Store/TestFlight, plus the open risks to resolve
before a public store build.

It does **not** replace the other release docs — it points at them:

- Build & submit commands: [`store-assets/EAS-BUILD.md`](../store-assets/EAS-BUILD.md)
- Store listing copy (full descriptions, keywords, screenshot sizes): [`store-assets/app-store-copy.md`](../store-assets/app-store-copy.md)
- Repeatable release smoke / report template: [`docs/beta-release-checklist.md`](./beta-release-checklist.md)
- Billing (Stripe) bring-up: [`docs/stripe-setup.md`](./stripe-setup.md)
- Reviewer accounts: create one consumer reviewer account and one business reviewer account in Supabase; do not commit passwords.

> Never paste secret values (API keys, service-role keys, Stripe secrets, reviewer passwords, or tokens)
> into this file, tickets, chat, or screenshots.

---

## 1. Current V1 Rollout State

| Field | Value |
|---|---|
| Repo checkpoint | `feature/ai-deal-studio-dev-foundation` at `e2d6207a` (`Fix AI poster copy revision flow`) |
| Working tree | Active local changes and untracked QA/store artifacts are present. This is **not** a clean release-candidate snapshot. |
| versionName | `1.0.0` |
| Local Android versionCode | `31` in `app.json` |
| App package / bundle ID | `com.unvmex2.twoforone` (Android `package` and iOS `bundleIdentifier` match) |
| EAS project ID | `cf448cfe-fabd-4c32-8afd-88104bb59cbe` (owner `unvmex2`) |
| App display name | Twofer |
| Stack | Expo SDK 54, React Native 0.81.5, React 19.1.0, Expo Router 6.0.24 |
| Share Deal | Enabled in production/apk/preview EAS profiles through `EXPO_PUBLIC_ENABLE_SHARE_DEAL=true` |
| Billing posture | Billing UI is enabled in code (`PAID_BILLING_ENABLED=true`), while pilot enforcement is bypassed (`PILOT_DISABLE_BILLING_GATE=true`). Do not describe the current app as having all billing surfaces hidden. |
| AI Deal Studio dev variant | Separate Android dev package `com.unvmex2.twoforone.dev`; publishing disabled by `EXPO_PUBLIC_DISABLE_AI_STUDIO_PUBLISHING=true` |
| Localization | English, U.S. Spanish, and Korean code paths exist. Broad Spanish/Korean production remains blocked until native review and screenshot QA gates pass. |

> **versionCode note:** `eas.json` sets `appVersionSource: "remote"` and the `production`
> profile uses `autoIncrement: true`, so the store build's Android versionCode is managed by
> EAS and may advance past the local `app.json` value. Treat `30` as the current local config,
> not a promise about the next Play build number. iOS uses the same remote version source.
>
> Historical note: `owner-demo-v15` was the June 5 owner-demo APK checkpoint. It is no longer
> the current rollout state.

---

## 2. Google Play Checklist

Console: <https://play.google.com/console>

- [ ] Google Play Developer account active ($25 one-time).
- [ ] App created in Play Console; package `com.unvmex2.twoforone` registered.
- [ ] Production build is an **AAB** (`eas build -p android --profile production` outputs `.aab`).
- [ ] App signing: let Google Play manage signing, or upload the EAS keystore. **Save the EAS keystore** (`eas credentials` → Android → download) — required for every future update.
- [ ] Store listing text filled in (see §6 and `store-assets/app-store-copy.md`).
- [ ] App icon (512×512 PNG) uploaded.
- [ ] Feature graphic (1024×500 PNG/JPG) uploaded.
- [ ] Phone screenshots uploaded (min 2; 1080×1920 or 9:16 recommended).
- [ ] Privacy Policy URL entered (see §4).
- [ ] Content rating questionnaire completed (target: 13+).
- [ ] **Data safety** form completed (see §7).
- [ ] App access: consumer and business reviewer logins + instructions provided (see §6 / §9).
- [ ] Ads declaration: app currently has **no third-party ads** → declare "No ads".
- [ ] Target audience / families: not directed at children.
- [ ] Account deletion: data-deletion URL provided (`/delete-account`) — required by Play.
- [ ] Permissions justified: camera, microphone, location, photos (see §7).
- [ ] First release uploaded to **internal testing** (or closed testing) before production (see §11).

---

## 3. Apple App Store / TestFlight Checklist

App Store Connect: <https://appstoreconnect.apple.com>

- [ ] Apple Developer Program membership active ($99/yr).
- [ ] Bundle ID `com.unvmex2.twoforone` registered in the Apple Developer portal.
- [ ] App record created in App Store Connect.
- [ ] Production build uploaded (`eas build -p ios --profile production`, then `eas submit -p ios --latest`).
- [ ] App icon: 1024×1024 PNG, **no transparency, no alpha channel, square** (no rounded corners).
- [ ] iPhone 6.7"/6.9" screenshots uploaded (required; see §6 / `store-assets/app-store-copy.md`).
- [ ] iPad screenshots not required while `ios.supportsTablet` remains `false` in `app.json`.
- [ ] Name, subtitle, keywords, description filled in (see §6).
- [ ] Privacy Policy URL entered (see §4).
- [ ] Support URL entered (see §4).
- [ ] Age rating questionnaire completed (target: 13+).
- [ ] **App Privacy ("nutrition label")** completed (see §7).
- [ ] Export compliance: `ITSAppUsesNonExemptEncryption: false` is already set in `app.json` (standard HTTPS only).
- [ ] Sign in with Apple: only required if a third-party social login is offered. Twofer uses email/password only → **not required**.
- [ ] Reviewer account logins + notes provided in "App Review Information" (see §6 / §9).
- [ ] **TestFlight** internal/external testing pass before App Store review (see §11).

---

## 4. Required Public Legal & Support URLs

All four default to `https://www.twoferapp.com/...` (set in `lib/legal-urls.ts`; overridable via
`EXPO_PUBLIC_*` env). They are linked in-app and required by the stores.

| Page | URL | Used by |
|---|---|---|
| Privacy Policy | `https://www.twoferapp.com/privacy` | Both stores (required), in-app legal links |
| Terms of Service | `https://www.twoferapp.com/terms` | In-app legal links, store metadata |
| Support / Contact | `https://www.twoferapp.com/support` | App Store Support URL, Play listing |
| Account / Data Deletion | `https://www.twoferapp.com/delete-account` | Google Play data-deletion requirement, in-app "Delete account" |

- [ ] **Verify every page above is publicly live and reachable** before submission. The URLs are
  configured, but store review will fail if a page 404s or is behind auth.
- [ ] Privacy Policy must disclose: account/email, location (opt-in), camera, microphone, photos,
  notifications, analytics, crash logging, and (if billing is enabled) Stripe payment processing.

---

## 5. Build Commands

```bash
# Android (AAB for Google Play)
eas build -p android --profile production

# iOS (IPA for App Store / TestFlight)
eas build -p ios --profile production

# Submit latest build to the stores (after the build finishes)
eas submit -p android --latest    # requires Google Play service-account JSON
eas submit -p ios --latest        # requires App Store Connect API key
```

The `production` EAS profile carries no debug flags (`EXPO_PUBLIC_SHOW_DEBUG_PANEL`,
`EXPO_PUBLIC_DEBUG_BOOT_LOG`, `EXPO_PUBLIC_PREVIEW_MATCHES_DEV` are dev/preview-only).
Full build/submit/credentials guide: `store-assets/EAS-BUILD.md`.

---

## 6. Store Metadata Checklist

Authoritative copy lives in `store-assets/app-store-copy.md`. Key values:

| Field | Value / Source |
|---|---|
| App name | **Twofer** (iOS) · **Twofer — Live BOGO Deals** (Play) |
| Short description | iOS subtitle (≤30): "Live BOGO deals from local cafes" · Play (≤80): "Claim live BOGO deals from local cafes and bakeries in one tap." |
| Full description | See `store-assets/app-store-copy.md` (≤4000 chars, per-store) |
| Category | **Food & Drink** |
| Content rating | 13+ target audience / 13+ iOS age rating |
| Keywords (iOS, ≤100) | `bogo,deals,local,cafe,coffee,bakery,discount,coupon,food,nearby,wallet,qr` |
| Support email | `support@twoferapp.com` |
| Support URL | `https://www.twoferapp.com/support` |
| Privacy Policy URL | `https://www.twoferapp.com/privacy` |
| Terms URL | `https://www.twoferapp.com/terms` |
| App icon | iOS 1024×1024 (no alpha); Play 512×512. Source: `assets/images/icon.png` + adaptive icon assets |
| Google feature graphic | 1024×500 local candidate: `store-assets/google-play-feature-graphic-1024x500.png`; still needs human upload/approval |
| Android screenshots | Phone min 1080×1920; tablet 1200×1920 optional |
| iOS screenshots | 6.9" 1320×2868 / 6.7" 1290×2796; iPad screenshots not required while tablet support is off |
| Reviewer accounts | Dan-provided consumer and business reviewer accounts; paste passwords only into store consoles |
| Reviewer instructions | See §9 reviewer notes draft |

Recommended 8-screenshot flow (consumer + business) is listed in `store-assets/app-store-copy.md`.

- [ ] App name, short + full description entered per store.
- [ ] Category set to Food & Drink.
- [ ] Support email set to `support@twoferapp.com` and matches the in-app value.
- [ ] Support / Privacy / Terms URLs entered and verified live.
- [ ] App icon uploaded (correct size + no alpha on iOS).
- [ ] Google feature graphic reviewed and uploaded.
- [ ] Android + iOS screenshots captured and uploaded.
- [ ] Reviewer account logins + instructions entered in store review fields.

---

## 7. Data Safety / Privacy Checklist

Fill the Google Play **Data safety** form and the Apple **App Privacy** label using the table
below. Sources: `app.json` permissions/usage strings, Task 10 analytics (`docs`/`TASK_QUEUE.md`),
and `lib/legal-urls.ts`.

| Data / capability | Collected? | Purpose | Notes |
|---|---|---|---|
| Email / account login | Yes | Account creation & sign-in | Supabase auth (email + password) |
| Location (coarse + fine) | Yes — opt-in | Sort nearby offers, map results, distance | `ACCESS_COARSE_LOCATION` + `ACCESS_FINE_LOCATION`; not required to browse; not sold |
| Business profile / contact data | Yes | Business listing | Name, address, email, hours — entered by business owners |
| Claim / redeem history | Yes | Wallet, redemption, business analytics | Tied to account |
| App analytics | Yes | Product usage / funnel | First-party `app_analytics_events` via `ingest-analytics-event`; no third-party analytics SDK |
| Crash / error monitoring | Yes | Stability by app version/build | First-party `app_error` event with `app_version`/`app_build` + non-PII `error_hash`; no third-party crash SDK |
| Push notifications | Yes — opt-in | Deal alerts for favorited shops | `expo-notifications`; user can disable in Account |
| Camera | Yes (access) | Scan QR to redeem; menu photo for AI extraction | `NSCameraUsageDescription` set |
| Microphone | Yes (access) | AI Compose voice input only (transcribed) | `NSMicrophoneUsageDescription` set |
| Photos / media | Yes (access) | Attach deal photos; upload menu photo for AI | `NSPhotoLibraryUsageDescription` set |
| Payment / billing (Stripe) | Conditional | Subscription (Pro/Premium) | Only if billing is enabled for the build — see §8. Card data handled by Stripe Checkout, not the app; app stores Stripe customer/subscription IDs |

- [ ] Play Data safety: declare collection, purpose, encryption-in-transit, and deletion method (link `/delete-account`).
- [ ] Apple App Privacy: declare data types + whether linked to identity / used for tracking (Twofer does **not** track users across other apps → "Not used for tracking").
- [ ] Confirm no secrets/PII beyond the above are logged (analytics sanitize context server-side per Task 10).

---

## 8. Billing Policy Risk Note (read before enabling billing in a store build)

**Merchant billing screens are currently enabled in code. Live charging must stay off unless the
payment flow is both production-ready and store-policy-ready.**

Current state: `lib/billing/access.ts` has `PAID_BILLING_ENABLED=true`, and pilot publish
enforcement is bypassed with `PILOT_DISABLE_BILLING_GATE=true`. Stripe Checkout / webhook /
customer-portal functions exist, but Stripe mode, webhook readiness, store-policy posture, and
review-build behavior must be confirmed before any public release. Do not reuse old language that
says billing/pricing/checkout is fully hidden by setting `PAID_BILLING_ENABLED` to false.

Store-policy risk to resolve before shipping billing in a public store build:

- Apple Guideline 3.1.1 and Google Play Payments policy generally require **in-app purchase (IAP)**
  for digital subscriptions that unlock in-app functionality. A Stripe Checkout subscription that
  unlocks app features can be rejected unless it qualifies for an exception (e.g., B2B / "reader" /
  physical-service positioning), which is **not yet confirmed** for Twofer.
- Until that is resolved, keep billing **demo/pilot-only** (Stripe test mode and no real money), or
  hide/disable the Subscribe path for store-review builds with a verified build-specific mechanism.
- Production guardrails already expected (per `docs/beta-release-checklist.md`):
  `BILLING_SIMULATE_SUBSCRIBE` absent/false, and Stripe in the intended mode for the build.

- [ ] Decide billing posture for this store build: **demo/pilot-only** (recommended now) vs. **live**.
- [ ] If live: confirm IAP-vs-Stripe policy path with each store before submission.

---

## 9. Reviewer Notes Draft

Paste into Google Play "App access" and App Store Connect "App Review Information".

> Twofer is a local deals marketplace for businesses and customers. Customers browse and claim
> live buy-one-get-one (BOGO) offers from nearby cafes and bakeries and redeem them in person with
> a QR code. Businesses post offers and redeem customer codes at the counter.
>
> **Reviewer test accounts**
> Consumer email: `[DAN_TO_PASTE_CONSUMER_REVIEWER_EMAIL]`
> Consumer password: `[DAN_TO_PASTE_CONSUMER_REVIEWER_PASSWORD]`
> Business email: `[DAN_TO_PASTE_BUSINESS_REVIEWER_EMAIL]`
> Business password: `[DAN_TO_PASTE_BUSINESS_REVIEWER_PASSWORD]`
> Review business: **[DAN_TO_CONFIRM_REVIEW_BUSINESS]**
>
> **Testing steps**
> 1. Log in using the consumer reviewer account (normal email/password form on the login screen).
> 2. View Home, Map, Wallet, Settings, a deal detail, and Share Deal.
> 3. Claim a posted deal if the account is claim-clean.
> 4. Sign out, then log in using the business reviewer account.
> 5. Open Dashboard, Create, Active Deals, Redeem, Analytics, Business Profile, and Settings.
> 6. Billing/pricing surfaces are pilot-only. Do not enter real payment credentials during review
>    unless Dan has explicitly approved a live billing review path for this exact build.
> 7. Location is used to show nearby offers and map results (you may allow or deny location;
>    the app still works without it).

Reviewer-account caveats (verify before submitting):

- [ ] The deleted demo-login helper is not present in production builds. Reviewers sign in through
  the normal email/password form.
- [ ] The consumer reviewer account must be claim-clean before review. A user can hold only one
  active claim at a time app-wide (claiming the same deal again returns the same ticket), so a second
  claim test is expected to be blocked until the first claim is redeemed, released, or expires.
  There is no per-day limit; see `docs/claim-rules.md` for the full current rules.
- [ ] The business reviewer account owns a pilot business with posted deals and can reach the
  dashboard, create, active-deals, redeem, analytics, profile, and settings flows.
- [ ] Paste reviewer passwords only into the store review fields. Do not commit them.

---

## 10. Open Release Items / Risks Found

Documented, not changed (this pass is store-prep docs only):

1. **Website support email still needs verification.** The mobile app uses `support@twoferapp.com`.
   Before review, verify the live website privacy/support pages show the same public support email.
2. **Legal/support/delete pages must be live.** URLs are configured but must be publicly reachable
   at `twoferapp.com` before review (§4).
3. **Google feature graphic approval/upload.** A local 1024×500 candidate exists under
   `store-assets/`, but Play still needs the final human-approved upload (§6).
4. **Billing store-policy risk** (§8) — paid surfaces are enabled in code and must remain
   demo/pilot-only, hidden for review, or explicitly approved for live billing before submission.
5. **iPad support is off** (`ios.supportsTablet: false`), so iPad screenshots are not part of the
   current iPhone-only submission path.
6. **versionCode is EAS-remote/auto-increment** — the store build number will come from EAS, not
   necessarily the local `app.json` value `30` (§1).
7. **Reviewer accounts** must be created and verified on the review environment: one claim-clean
   consumer account and one business account with posted deals (§9).

No app code/behavior, secrets, identifiers, or build numbers are changed by this document.

---

## 11. Testing Guidance (test track first)

- **Android:** upload to **Google Play internal testing** (or closed testing) first; smoke on a real
  device; then promote to production.
- **iOS:** upload to **TestFlight** (internal, then external if desired) first; smoke; then submit
  for App Store review.
- Run `docs/beta-release-checklist.md` against the exact store build (git clean, no demo/debug flags,
  typecheck/lint/test, Android smoke, Supabase migrations/secrets by name, versionCode/build URL,
  known issues) and record the result before promoting to public release.
