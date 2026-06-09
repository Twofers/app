# TWOFER — Store Release Prep (Google Play + Apple App Store / TestFlight)

This is the single store-submission prep doc for TWOFER. It collects everything needed to
publish to Google Play and the Apple App Store/TestFlight, plus the open risks to resolve
before a public store build.

It does **not** replace the other release docs — it points at them:

- Build & submit commands: [`store-assets/EAS-BUILD.md`](../store-assets/EAS-BUILD.md)
- Store listing copy (full descriptions, keywords, screenshot sizes): [`store-assets/app-store-copy.md`](../store-assets/app-store-copy.md)
- Repeatable release smoke / report template: [`docs/beta-release-checklist.md`](./beta-release-checklist.md)
- Billing (Stripe) bring-up: [`docs/stripe-setup.md`](./stripe-setup.md)
- Reviewer demo account: [`docs/DEMO_SEED.md`](./DEMO_SEED.md)

> Never paste secret values (API keys, service-role keys, Stripe secrets, passwords other
> than the documented demo account) into this file, tickets, chat, or screenshots.

---

## 1. Current Owner-Demo Candidate

| Field | Value |
|---|---|
| Git tag | `owner-demo-v15` |
| HEAD commit | `bf9e73d` (Validate final owner demo polish) |
| Branch | `fix/production-clean-copy` |
| versionName | `1.0.0` |
| versionCode | `15` (owner-demo candidate) |
| App package / bundle ID | `com.unvmex2.twoforone` (Android `package` and iOS `bundleIdentifier` match) |
| EAS project ID | `cf448cfe-fabd-4c32-8afd-88104bb59cbe` (owner `unvmex2`) |
| App display name | TWOFER |

> **versionCode note:** `eas.json` sets `appVersionSource: "remote"` and the `production`
> profile uses `autoIncrement: true`, so the store build's Android versionCode is managed by
> EAS and may advance past `15`. `15` is the current owner-demo APK candidate; the actual
> store-build number comes from EAS at build time. iOS uses the same remote version source.

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
- [ ] Content rating questionnaire completed (target: Everyone).
- [ ] **Data safety** form completed (see §7).
- [ ] App access: reviewer demo login + instructions provided (see §6 / §9).
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
- [ ] iPad screenshots uploaded **if** `supportsTablet` stays `true` (it is currently `true` in `app.json`) — otherwise set `supportsTablet: false` to avoid the iPad screenshot requirement.
- [ ] Name, subtitle, keywords, description filled in (see §6).
- [ ] Privacy Policy URL entered (see §4).
- [ ] Support URL entered (see §4).
- [ ] Age rating questionnaire completed (target: 4+).
- [ ] **App Privacy ("nutrition label")** completed (see §7).
- [ ] Export compliance: `ITSAppUsesNonExemptEncryption: false` is already set in `app.json` (standard HTTPS only).
- [ ] Sign in with Apple: only required if a third-party social login is offered. TWOFER uses email/password only → **not required**.
- [ ] Reviewer demo login + notes provided in "App Review Information" (see §6 / §9).
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

The `production` EAS profile carries **no** demo/debug flags (`EXPO_PUBLIC_ENABLE_DEMO_AUTH_HELPER`,
`EXPO_PUBLIC_SHOW_DEBUG_PANEL`, `EXPO_PUBLIC_DEBUG_BOOT_LOG`, `EXPO_PUBLIC_PREVIEW_MATCHES_DEV` are
dev/preview-only). Full build/submit/credentials guide: `store-assets/EAS-BUILD.md`.

---

## 6. Store Metadata Checklist

Authoritative copy lives in `store-assets/app-store-copy.md`. Key values:

| Field | Value / Source |
|---|---|
| App name | **TWOFER** (iOS) · **TWOFER — Live BOGO Deals** (Play) |
| Short description | iOS subtitle (≤30): "Live BOGO deals from local cafes" · Play (≤80): "Claim live BOGO deals from local cafes and bakeries in one tap." |
| Full description | See `store-assets/app-store-copy.md` (≤4000 chars, per-store) |
| Category | **Food & Drink** |
| Content rating | Everyone (Play) / 4+ (iOS) |
| Keywords (iOS, ≤100) | `bogo,deals,local,cafe,coffee,bakery,discount,coupon,food,nearby,wallet,qr` |
| Support email | **TODO — not yet configured** (see §10) |
| Support URL | `https://www.twoferapp.com/support` |
| Privacy Policy URL | `https://www.twoferapp.com/privacy` |
| Terms URL | `https://www.twoferapp.com/terms` |
| App icon | iOS 1024×1024 (no alpha); Play 512×512. Source: `assets/images/icon.png` + adaptive icon assets |
| Google feature graphic | 1024×500 — **needs to be produced** (no source asset found in repo) |
| Android screenshots | Phone min 1080×1920; tablet 1200×1920 optional |
| iOS screenshots | 6.9" 1320×2868 / 6.7" 1290×2796; iPad 13" 2064×2752 if tablet support stays on |
| Reviewer demo login | `demo@demo.com` / `demo12345` (see §9 and `docs/DEMO_SEED.md`) |
| Reviewer instructions | See §9 reviewer notes draft |

Recommended 8-screenshot flow (consumer + business) is listed in `store-assets/app-store-copy.md`.

- [ ] App name, short + full description entered per store.
- [ ] Category set to Food & Drink.
- [ ] Support email set (after §10 is resolved) and matches the in-app value.
- [ ] Support / Privacy / Terms URLs entered and verified live.
- [ ] App icon uploaded (correct size + no alpha on iOS).
- [ ] Google feature graphic produced and uploaded.
- [ ] Android + iOS screenshots captured and uploaded.
- [ ] Reviewer demo login + instructions entered in store review fields.

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
- [ ] Apple App Privacy: declare data types + whether linked to identity / used for tracking (TWOFER does **not** track users across other apps → "Not used for tracking").
- [ ] Confirm no secrets/PII beyond the above are logged (analytics sanitize context server-side per Task 10).

---

## 8. Billing Policy Risk Note (read before enabling billing in a store build)

**Merchant billing screens must remain demo/pilot only unless the payment flow is both
production-ready and store-policy-ready.**

Current state (`docs/stripe-setup.md`): Stripe Checkout / webhook / customer-portal functions are
built, but the pilot runs Stripe in **test mode** (no real money moves). The Premium card and live
charging are intentionally gated for the pilot.

Store-policy risk to resolve before shipping billing in a public store build:

- Apple Guideline 3.1.1 and Google Play Payments policy generally require **in-app purchase (IAP)**
  for digital subscriptions that unlock in-app functionality. A Stripe Checkout subscription that
  unlocks app features can be rejected unless it qualifies for an exception (e.g., B2B / "reader" /
  physical-service positioning), which is **not yet confirmed** for TWOFER.
- Until that is resolved, keep billing **demo/pilot-only** (Stripe test mode, Premium gated), or
  hide/disable the Subscribe path for store-review builds.
- Production guardrails already expected (per `docs/beta-release-checklist.md`):
  `BILLING_SIMULATE_SUBSCRIBE` absent/false, and Stripe in the intended mode for the build.

- [ ] Decide billing posture for this store build: **demo/pilot-only** (recommended now) vs. **live**.
- [ ] If live: confirm IAP-vs-Stripe policy path with each store before submission.

---

## 9. Reviewer Notes Draft

Paste into Google Play "App access" and App Store Connect "App Review Information".

> TWOFER is a local deals marketplace for businesses and customers. Customers browse and claim
> live buy-one-get-one (BOGO) offers from nearby cafes and bakeries and redeem them in person with
> a QR code. Businesses post offers and redeem customer codes at the counter.
>
> **Reviewer test account**
> Email: `demo@demo.com`
> Password: `demo12345`
> Demo business: **Cedar & Bean Cafe**
>
> **Testing steps**
> 1. Log in using the reviewer account (normal email/password form on the login screen).
> 2. In consumer mode, view Home, Shops, Wallet, and Map.
> 3. Use **Cedar & Bean Cafe** as the demo business.
> 4. Switch to Business mode from Settings.
> 5. Open Dashboard, Create, Redeem, Billing, and Account.
> 6. Merchant billing screens are demo/pilot access only. No real payment is required for review.
> 7. Location is used to show nearby offers and map results (you may allow or deny location;
>    the app still works without it).

Reviewer-login caveats (verify before submitting):

- [ ] The **demo-login helper button is hidden in production builds** (by design). Reviewers sign
  in with the email/password above via the normal login form — confirm this works on the exact
  store build.
- [ ] The demo account must be **seeded and claim-clean** on the production Supabase project before
  review (`npm run seed:demo`, see `docs/DEMO_SEED.md`). The account is owner **and** shopper and
  can create only **one fresh claim per local day** (America/Chicago) due to the claim guard — if a
  reviewer wants to exercise the full claim→redeem flow twice in a day, note that a second same-day
  claim is expected to be blocked.
- [ ] Credentials are the canonical demo values from `docs/DEMO_SEED.md` / `lib/demo-account.ts` —
  re-verify there before submission in case they change.

---

## 10. Open Release Items / Risks Found

Documented, not changed (this pass is store-prep docs only):

1. **Support email not configured.** `getSupportEmail()` reads `EXPO_PUBLIC_SUPPORT_EMAIL`, which is
   unset, so the in-app Help row is hidden and store metadata has no support email. Both stores want
   a support email. → Set `EXPO_PUBLIC_SUPPORT_EMAIL` (e.g. a `@twoferapp.com` address) and use the
   same address in store listings.
2. **Legal/support/delete pages must be live.** URLs are configured but must be publicly reachable
   at `twoferapp.com` before review (§4).
3. **Google feature graphic missing.** No 1024×500 source asset in the repo; required by Play (§6).
4. **Billing store-policy risk** (§8) — resolve posture before any live-billing store build.
5. **iPad screenshots** required while `supportsTablet: true`; either produce them or set
   `supportsTablet: false` (§3).
6. **versionCode is EAS-remote/auto-increment** — the store build number will come from EAS, not
   necessarily `15` (§1).
7. **Reviewer demo account** must be seeded claim-clean on production Supabase and works via the
   normal login form, not the (hidden) demo button (§9).

No code/behavior, secrets, identifiers, or build numbers were changed in this pass.

---

## 11. Testing Guidance (test track first)

- **Android:** upload to **Google Play internal testing** (or closed testing) first; smoke on a real
  device; then promote to production.
- **iOS:** upload to **TestFlight** (internal, then external if desired) first; smoke; then submit
  for App Store review.
- Run `docs/beta-release-checklist.md` against the exact store build (git clean, no demo/debug flags,
  typecheck/lint/test, Android smoke, Supabase migrations/secrets by name, versionCode/build URL,
  known issues) and record the result before promoting to public release.
