# Google + Apple sign-in plan — 2026-07-24

**This file is the tracker.** The executing agent updates the checkboxes as work lands and appends findings under each phase. Do not delete sections; strike through and annotate instead.

## Decisions already made by Dan (2026-07-24, in-session — do not re-litigate)

- **Reverses the locked decision** "Email/password sign-in only. No Sign in with Apple, social login." Dan explicitly approved adding **Google sign-in (iOS + Android) and Sign in with Apple (iOS)**.
- **Merchants included.** Social sign-in is for both roles, not shoppers-only. The hard Shopper/Business role split itself is unchanged — role is still picked once and stored in `profiles.role`.
- **`expo-updates` stays OFF.** Explicitly deferred (cold-start pressure, runtimeVersion pinning risk with `version` stuck at 1.0.0, don't debug OTA and new auth in the same build). Do not add it as part of this work.
- **Native SDKs (Path B), not browser OAuth.** `@react-native-google-signin/google-signin` + `expo-apple-authentication`, sessions via `supabase.auth.signInWithIdToken`. Do NOT use `signInWithOAuth`/`WebBrowser` flows; do not build Apple-on-Android (web flow) — out of scope.
- Email confirmation stays on for email/password. OAuth identities arrive with `email_confirmed_at` set by the provider; that is consistent with the locked decision, not a violation.

## Why the design looks like this (context for the executor)

- App is Expo SDK 54 / RN 0.81, **no OTA channel exists** — every JS or native change ships only via a full rebuild + store submission. This feature requires new native modules anyway, so a rebuild was unavoidable regardless.
- `app/auth-landing.tsx` is the only auth screen: role cards (signup mode, ~line 700), `handleLogin` (~380, `signInWithPassword`), `handleSignUp` (~417, role rides in `user_metadata.signup_role` via `SIGNUP_ROLE_META_KEY`).
- `signInWithIdToken` accepts **no user metadata**, so the chosen role cannot ride the token. Role must be carried locally across the native picker (see Phase 1 step 4).
- iOS App Store Guideline 4.8: offering Google requires an equivalent privacy-preserving option. Shipping Sign in with Apple alongside satisfies it definitionally — that is why Apple ships in the same build, not later.
- Merchant claim matching (`supabase/migrations/20260822170000_claim_links_activated_business.sql` line ~129) requires a **confirmed** auth email equal (normalized) to the approved application email. Google emails satisfy the confirmed requirement. Apple **Hide My Email** relay addresses (`@privaterelay.appleid.com`) can never match an application → dedicated guard, Phase 1 step 6.

## Scope / non-goals

In scope: two new sign-in buttons on `auth-landing`, session + role resolution, relay-email guard, i18n (en/es/ko), tests, dev-project verification, prod config, rebuild, QA, store-form drafts.
Non-goals: `expo-updates`; browser OAuth fallback; Apple on Android; merchant onboarding/claim redesign; DB migrations (**none expected — if one turns out to be needed, STOP and report before writing it**); production analytics (note: `lib/auth-path-log.ts` `logAuthPath` is dev-only console logging, not telemetry — extending it is step 7 but promises no prod metrics).

## Phase 0 — Codify the decision ✅ pre-approved — DONE 2026-07-24

- [x] In `CLAUDE.md` "Locked product decisions", replace the sign-in line with:
  > - Email/password sign-in plus native Google sign-in (iOS/Android) and Sign in with Apple (iOS), for both roles, approved by Dan 2026-07-24. No other social providers, no guest or anonymous browsing. Merchant claim still requires the auth email to match the approved application email; Apple private-relay emails cannot claim a business.
- [x] Mirror the exact same edit in `AGENTS.md` (files must stay identical). Verified byte-identical.

**Finding — the AI poster core lock covers these two files.** `npm run pretest` failed on
`check-ai-poster-core-lock` because `CLAUDE.md` and `AGENTS.md` are protected entries.
`docs/ai-poster-core-lock.json` was updated: both hashes `a9781eae…` → `558aa624…`, and
`latestApprovalRef` was **chained** (new note + `Prior ref: <old note>`, never overwritten) recording
this as pre-approved Phase 0, documentation-only, no AI poster/ad behavior impact.
`npm run gate:ai-poster-lock` now reports 30/30 matching.

## Phase 1 — Code (no gates; commit only when Dan asks, never push) — DONE 2026-07-24, UNCOMMITTED

1. [x] **Dependencies.** `npx expo install expo-apple-authentication`; `npm install @react-native-google-signin/google-signin` (latest stable; use only the free classic API — do NOT import anything from the paid "universal" entry points). Run `npx expo-doctor` and report any SDK-54 compatibility complaints before proceeding.
2. [x] **app.json.** Add plugins: `expo-apple-authentication`, and `["@react-native-google-signin/google-signin", { "iosUrlScheme": "com.googleusercontent.apps.<IOS_CLIENT_ID>" }]` (placeholder until Dan's console step delivers the real iOS client ID). Set `ios.usesAppleSignIn: true`. Touch nothing else in app.json (no version bumps — gated, Phase 3).
3. [x] **Client IDs via env, following the existing pattern.** Add `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` and `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` to `eas.json` profiles and read them through `lib/runtime-env.ts` (same pattern as `EXPO_PUBLIC_ENABLE_SHARE_DEAL`). Client IDs are not secrets. Also add `EXPO_PUBLIC_ENABLE_SOCIAL_AUTH` as a kill-switch flag: buttons render only when true. Rationale: this rebuild will carry other parked fixes; if social QA fails late, the train still ships with the flag off.
4. [x] **New module `lib/social-auth.ts`** (+ `lib/social-auth.test.ts`):
   - `signInWithGoogle()`: `GoogleSignin.configure({ webClientId })` (once), `hasPlayServices()`, `signIn()`, then `supabase.auth.signInWithIdToken({ provider: "google", token: idToken })`.
   - `signInWithApple()`: generate raw nonce (`expo-crypto` `randomUUID`), pass its SHA-256 to `AppleAuthentication.signInAsync` (scopes: full name, email), then `signInWithIdToken({ provider: "apple", token: identityToken, nonce: rawNonce })`. Nonce mix-ups (raw vs hashed) are the classic Apple failure — unit-test the shape.
   - `isAppleRelayEmail(email)`: case-insensitive suffix check for `privaterelay.appleid.com`.
   - Pending-role carry: `setPendingSocialRole(role)` / `takePendingSocialRole()` backed by `expo-secure-store` (module-level cache + SecureStore so the choice survives Android process death behind the native picker; `take` clears on read).
   - **User cancellation is silent** — map Google `SIGN_IN_CANCELLED` and Apple `ERR_REQUEST_CANCELED` to a no-op, never an error banner.
5. [x] **Wire `app/auth-landing.tsx`.** Buttons in both login and signup modes, gated by the env flag; Apple button iOS-only and only if `AppleAuthentication.isAvailableAsync()` (use `AppleAuthenticationButton` for brand/locale compliance; Google button follows Google brand guidelines with the official G asset, styled to the design system). Signup mode: tapping a social button requires `termsAccepted` (same rule as `handleSignUp`) and stashes the selected role card via `setPendingSocialRole` before launching the picker. After `signInWithIdToken` returns a session, run one shared completion path:
   - stored `profiles.role` exists (`resolveRoleForUser` order: stored → metadata → derived) → route by it via `resolvePostAuthReplaceHref` (`lib/post-auth-route.ts:61`), exactly like `handleLogin`;
   - no stored role but a pending role → `persistRoleForUser` + `adoptRole` + route (mirrors `handleSignUp` post-session block);
   - neither (brand-new user who tapped social from the **login** tab): show an inline finish-setup state on auth-landing — role cards + terms checkbox — then persist and route. This is the only new UI state; keep it minimal per the UI-copy-minimal rule.
6. [x] **Merchant relay-email guard.** If resolved/pending role is `business` and `isAppleRelayEmail(session.user.email)`: do not proceed into business routing. Show guidance ("Your email is hidden by Apple. A business account must use the email from your application — sign in again and choose Share My Email, or use email and password."), then `supabase.auth.signOut({ scope: "local" })` (repo precedent: global signOut misbehaves on the S10). Also add a pre-warning hint line under the buttons when the business role card is selected, because Apple makes the hide-email choice sticky per Apple ID. Add one sentence to the business-apply flow copy telling applicants to sign in with the application email.
7. [x] **`lib/auth-path-log.ts`:** extend `AuthPath` with `"google_signin" | "apple_signin" | "social_finish_setup"` and call at the entry points (dev-only logging, unchanged behavior).
8. [x] **i18n.** All new strings in `lib/i18n/locales/en.json`, `es.json`, `ko.json`. No bare `defaultValue`-only keys (CI `check:i18n-keys` gate; `defaultValue` masks missing keys per repo history). Spanish must be hand-accented per the website-Spanish precedent.
9. [x] **Tests + validation.** Unit tests for: relay detection, pending-role take-clears semantics, cancellation mapping, finish-setup decision logic (given stored/pending/neither). Extend `lib/auth-error-messages.test.ts` if error mapping grows. Then `npm run typecheck`, `npm run lint`, `npm test`. No edge functions touched → `typecheck:functions` not required. No RLS/migrations → no probe required.

### Phase 1 findings (2026-07-24)

**Versions.** `expo-apple-authentication@8.0.8`, `@react-native-google-signin/google-signin@16.1.2`.
Both installed with `npx expo install` (SDK-54-aware resolution) rather than bare `npm install`; the
Google package has no SDK pin so the result is the same latest stable, just version-checked. Only the
free classic entry point exists in v16 (`GoogleSignin`, `statusCodes`, `GoogleSigninButton` at the
package root) — there is no paid "universal" import to avoid.

**`npx expo-doctor`: 17/18 pass.** The single failure is pre-existing and unrelated — `expo` is at
`54.0.35` while the SDK now expects `~54.0.36`. No complaint about either new module. Not fixed here
(a patch bump to `expo` is its own change and would touch the release train).

**Plugin registration lives in `app.json`, and `expo install` could not auto-write it** ("Cannot
automatically write to dynamic config at: app.config.js"). Added by hand: `expo-apple-authentication`,
`["@react-native-google-signin/google-signin", { "iosUrlScheme": "com.googleusercontent.apps.REPLACE-WITH-IOS-CLIENT-ID" }]`,
and `ios.usesAppleSignIn: true`. Nothing else in `app.json` touched — no version or `versionCode` change.
The plugin runs in "without Firebase" mode when given `iosUrlScheme` (iOS URL scheme only, zero Android
gradle changes), which is what we want: auth is Supabase, not Firebase.

**One place for the iOS client ID.** `app.config.js` now derives the reversed URL scheme from
`EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` (`withGoogleIosUrlScheme`), overriding the `app.json` placeholder
whenever the env var is set. Rationale: the reversed scheme and the client ID must match exactly or
Google sign-in fails on iOS only, and this removes the second hand-edit that would otherwise be easy
to forget. With the env var unset the placeholder survives — the plugin requires *some*
`com.googleusercontent.apps.*` value or prebuild throws.

**Kill switch + client IDs.** `lib/runtime-env.ts` gained `isSocialAuthEnabled()`,
`getGoogleWebClientId()`, `getGoogleIosClientId()`, `isGoogleSignInConfigured()`, and three entries in
`getPublicEnvSnapshot()`. A value containing `REPLACE-WITH` is treated as **unset**, so a
half-configured profile renders no Google button instead of a broken one. `eas.json`:
`EXPO_PUBLIC_ENABLE_SOCIAL_AUTH` is `"true"` on `development` / `preview` / `dev-client-apk` (and
`dev-apk-ai-studio` / `apk` by `extends` merge) and **`"false"` on `production`** — flip it after
Phase 3+4 QA. Both client-ID keys are present with `REPLACE-WITH-…` placeholders so there is one
obvious place for Dan to paste.

**`resolveRoleForUser` could not express "no role".** It always returns a role (derives, then falls
back to `customer`), which would have made the finish-setup branch unreachable and silently filed
every new social user as a shopper. Added `resolveKnownRoleForUser(user)` in `lib/profiles-role.ts`:
same stored → metadata → derived order, returns `null` when nothing identifies the account, still
self-heals `profiles.role` when a role *is* identified. `resolveRoleForUser` is untouched.

**Secure storage goes through the existing wrapper.** `lib/social-auth.ts` uses
`lib/redemption-secure-store.ts` (`secureGetItem/SetItem/DeleteItem`) rather than importing
`expo-secure-store` directly — that file documents a Linux-CI failure where `vi.mock` on the
dynamically imported npm package did not intercept and the real Expo module entered the test graph.
The tests mock the local wrapper, which is the pattern that survives CI.

**Google v16 reports cancellation as a value, not a throw** — `signIn()` resolves
`{ type: 'cancelled', data: null }`. Both shapes are handled: the `cancelled` response *and* a thrown
error carrying `SIGN_IN_CANCELLED` / `ERR_REQUEST_CANCELED`. Either way it is a no-op with no banner.

**Official provider buttons.** `GoogleSigninButton` (SDK) and `AppleAuthentication.AppleAuthenticationButton`
(expo). Apple requires its own button for Sign in with Apple, and Google's brand guidelines want the
official asset rather than a redrawn G, so no logo asset was added to the repo. Sized to
`Controls.buttonHeight` with `Radii.md` corners and light/dark variants driven by the color scheme.

**Nonce shape is pinned by source assertions, not mocks.** Mocking dynamically imported native SDKs is
the exact pattern that broke on CI before, so `lib/social-auth.test.ts` asserts on the module's source
text that Apple gets `nonce: hashedNonce` while Supabase gets `rawNonce`, and that Google sends no
nonce. Every assertion is a single-line substring (never spans `\n`, per the repo's CRLF trap).

**Validation run:** `npm run typecheck` ✅, `npm run lint` ✅, `npm test` ✅ 282 files / 1971 tests,
`npm run check:i18n-keys` ✅, `npm run gate:release-state` ✅, `npm run gate:ai-poster-lock` ✅ 30/30.
No edge functions changed → `typecheck:functions` not required. No migrations, no RLS → no probe.

**Known behavior, not a bug:** if someone abandons the finish-setup step and force-closes the app, the
session persists and the next cold start resolves them through the normal `resolveRoleForUser` path,
which derives `customer`. They cannot be silently made a merchant. Worth watching on device.

**Files changed in Phase 1** (all uncommitted): `CLAUDE.md`, `AGENTS.md`,
`docs/ai-poster-core-lock.json`, `app.json`, `app.config.js`, `eas.json`, `package.json`,
`package-lock.json`, `lib/runtime-env.ts`, `lib/profiles-role.ts`, `lib/auth-path-log.ts`,
`lib/social-auth.ts` (new), `lib/social-auth.test.ts` (new), `lib/auth-landing-source.test.ts`,
`app/auth-landing.tsx`, `app/business-apply.tsx`, `lib/i18n/locales/{en,es,ko}.json`.

## Phase 2 — Dan's console setup (agent drafts exact steps, Dan clicks — store consoles are out of scope for agents)

- [ ] **Google Cloud** (one project): OAuth consent screen, external, basic email/profile scopes only (no verification needed). Create clients: 1 Web (its ID = `webClientId` everywhere), 1 iOS (`com.unvmex2.twoforone`), Android clients for each package+SHA-1 pair: `com.unvmex2.twoforone` × {upload key SHA-1, **Play App Signing SHA-1** (Play Console → App integrity — miss this and Google login fails only in production), local debug keystore SHA-1}, plus `com.unvmex2.twoforone.dev` × debug SHA-1 for the dev client.
- [ ] **Apple Developer portal:** enable Sign in with Apple capability on the App ID. ⛔ Provisioning-adjacent → Dan approves; EAS will re-sync the profile at build time.
- [ ] **Supabase DEV project dashboard:** enable Google provider (authorize the Web client ID and iOS client ID) and Apple provider (authorize bundle ID). Dev testing target.
- [ ] **Supabase PROD dashboard:** same config. ⛔ Production auth config → do only when Phase 2 verification passed.

### Drafted click-by-click steps (written 2026-07-24 — Dan executes, agent does not)

**Before you start — collect three SHA-1 fingerprints.**

Local debug keystore (PowerShell):

```bash
keytool -list -v -keystore "$env:USERPROFILE\.android\debug.keystore" -alias androiddebugkey -storepass android -keypass android
```

EAS upload key:

```bash
npx eas-cli credentials --platform android
```

Play App Signing key: Play Console → your app → **Test and release → Setup → App integrity → App
signing** → copy the **SHA-1 certificate fingerprint** under "App signing key certificate".
⚠️ This is the one that only bites in production — Play re-signs your upload, so a build that works
from a local APK fails after Play promotes it if this fingerprint has no OAuth client.

**A. Google Cloud Console** (console.cloud.google.com) — one project for everything.

1. Create or select a project, e.g. `Twofer`.
2. **APIs & Services → OAuth consent screen** → User type **External** → Create.
   - App name `Twofer`, user support email `support@twoferapp.com`, developer contact email.
   - Scopes: keep only the defaults `openid`, `.../auth/userinfo.email`, `.../auth/userinfo.profile`.
     Add nothing else — sensitive/restricted scopes would trigger Google verification, which we do not
     need and do not want.
   - **Publish the app** (Publishing status → "In production"). While it is in *Testing*, only
     explicitly listed test users can sign in, which will look like a bug during device QA.
3. **APIs & Services → Credentials → Create credentials → OAuth client ID**, six clients total:

   | # | Type | Fill in | Used as |
   |---|------|---------|---------|
   | 1 | Web application | Name `Twofer Web (Supabase audience)`. Authorized redirect URI: `https://kvodhiqhdqnptqovovia.supabase.co/auth/v1/callback` | `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` **and** authorized in Supabase |
   | 2 | iOS | Bundle ID `com.unvmex2.twoforone` | `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` **and** authorized in Supabase |
   | 3 | Android | Package `com.unvmex2.twoforone` + **upload key** SHA-1 | registration only |
   | 4 | Android | Package `com.unvmex2.twoforone` + **Play App Signing** SHA-1 | registration only |
   | 5 | Android | Package `com.unvmex2.twoforone` + **local debug** SHA-1 | registration only |
   | 6 | Android | Package `com.unvmex2.twoforone.dev` + **local debug** SHA-1 | dev-client variant |

   Android client IDs are never pasted into the app — registering the package + fingerprint pair is
   the whole job. Only the Web and iOS IDs are copied anywhere.
4. Paste the **Web** and **iOS** client IDs over the `REPLACE-WITH-GOOGLE-WEB-CLIENT-ID` /
   `REPLACE-WITH-GOOGLE-IOS-CLIENT-ID` placeholders in `eas.json` (development, preview, production,
   dev-client-apk). Nothing else needs the iOS ID — `app.config.js` derives the reversed URL scheme
   from it automatically.
5. For the **local** Phase 3 device build, `expo run:android` reads `.env.development.local`, not
   `eas.json`. Add the same three lines there:
   `EXPO_PUBLIC_ENABLE_SOCIAL_AUTH=true`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID=…`,
   `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID=…`.

**B. Apple Developer portal** (developer.apple.com) ⛔ provisioning-adjacent — Dan approves.

1. **Certificates, Identifiers & Profiles → Identifiers** → `com.unvmex2.twoforone`.
2. Tick **Sign In with Apple** (Enable as a primary App ID) → **Save** → confirm the "modify
   capabilities" prompt.
3. This invalidates the existing provisioning profiles. EAS regenerates them on the next iOS build —
   no manual profile work needed, but the next build must be an EAS build, not a cached one.

**C. Supabase — DEV project first** → Authentication → Sign In / Providers.

1. **Google** → enable.
   - *Client IDs* (comma-separated, no spaces): `<Web client ID>,<iOS client ID>`.
     Both are needed: Android tokens carry the Web ID as `aud`, iOS tokens carry the iOS ID.
   - *Client Secret*: leave empty. It is only used by the browser OAuth flow, which we deliberately
     do not use.
   - If sign-in fails with `Passed nonce and nonce in id_token should either both exist or not`,
     turn on **Skip nonce checks** — the native Google flow sends no nonce. (Apple does send one, and
     that check must stay on.)
2. **Apple** → enable.
   - *Client IDs*: `com.unvmex2.twoforone` (the bundle ID, not a Services ID — native flow).
   - Secret/Services ID fields stay empty for the native flow.
3. Confirm **Authentication → Sign In / Providers → Email** still has *Confirm email* ON. Social
   identities arrive pre-confirmed by the provider; that is not a change to the email policy.

**D. Supabase — PROD project** ⛔ do not touch until Phase 3 passes on dev. Same two provider configs
as step C, against `kvodhiqhdqnptqovovia`.

## Phase 3 — Dev-device verification — RUN 2026-07-25 (S10, `com.unvmex2.twoforone.dev`, **production** Supabase)

**Deviations from plan, both Dan-approved in-session:** (1) there is no schema-complete dev Supabase project — `docs/dev/AI_DEAL_STUDIO_SUPABASE_DEV_SETUP.md` targets production and separates only by package — so providers were enabled on production `kvodhiqhdqnptqovovia` (safe: the shipped production build has `EXPO_PUBLIC_ENABLE_SOCIAL_AUTH=false`, so no real user can reach a social button). (2) The build ran as the `.dev` variant rather than the production package, because the installed `com.unvmex2.twoforone` is EAS-signed (SHA-256 `9E:05:0E:94:…`) and a debug build cannot replace it without an uninstall that would wipe app data; the `.dev` app is debug-signed with the same keystore (`FA:C6:17:45:…`) so it updated in place.



Build a local debug dev-client (`expo prebuild --clean` first — plain prebuild breaks on the `.dev` child package, per repo memory; then `expo run:android`). Then execute and record results for the matrix:

- [ ] ~~New Google user, customer role selected → lands in shopper tabs; `profiles.role = customer`.~~ **NOT TESTED** — only one fresh Google account was available and it was spent on the business case; `profiles.role` is immutable so the role cannot be reset to retry.
- [x] New Google user, business role selected → business context; claim/no-application state renders sanely. **PASS** — pending-role SecureStore carry survived the native picker, `decideSocialCompletion` took the `adopt` branch, routed to `/business-setup`, "Approval needed first" + Apply/Contact/Log out rendered correctly (screenshot captured).
- [ ] Existing **confirmed** email/password user, same email, taps Google → **INCONCLUSIVE.** Routed as a customer with no finish-setup step, which is consistent with identity linking BUT equally consistent with the F-2 race having written a derived `customer` role first. Cannot distinguish without reading `auth.users` (service-role key). **Dan to check:** Supabase → Authentication → Users → `unvmex2@gmail.com` — one row with a Google identity and an old `created_at` means it linked; a row created 2026-07-25 means a duplicate user was made.
- [ ] Existing **unconfirmed** email/password user, same email, taps Google → **NOT TESTED** (no unconfirmed account available).
- [ ] Google-created user later tries password login → **NOT TESTED**.
- [ ] Brand-new user taps Google from the **login** tab → finish-setup state appears. **NEVER OBSERVED.** `social_finish_setup` was not logged once across four sign-ins. The F-2 race is the likely reason it was unreachable; after the fix it should trigger, but that is currently proven only by unit tests, not on device.
- [x] Cancel the Google picker → no error banner, no state corruption. **PASS** — `com.google.android.gms/.common.account.AccountPickerActivity` opened, Back returned to auth-landing with screen text byte-identical to before the tap and no banner.
- [x] `DEVELOPER_ERROR` on Android = SHA-1/package/client mismatch. **Not hit** — the `com.unvmex2.twoforone.dev` + debug-SHA-1 client was correct first time.

### Extra cases covered (not in the original matrix)

- [x] Google button renders only with the kill switch on AND a real web client ID — **PASS**; official multicolor G asset, "or" divider, correct dark/light styling.
- [x] No Apple button on Android — **PASS** (correctly gated to `Platform.OS === "ios"`).
- [x] Terms gate on a signup-tab social tap — **PASS**; tapping Google with terms unchecked showed "Please agree to the Terms of Service to create an account." and never launched the picker.
- [x] Business-role pre-warning hint — **PASS**; "Business accounts must use the email from your application." renders when Business is selected.
- [x] Role persistence across a cold restart — **PASS**; force-stop + relaunch routed straight back to business context, so `profiles.role` really was written.
- [x] Returning social user with a stored role → routes by stored role (the `route` branch) — **PASS**.

### Findings

**F-2 — CRITICAL, introduced by this work, FIXED 2026-07-25.** `TabModeProvider` (`lib/tab-mode.tsx:111`) calls `resolveRoleForUser` on every session change, including the instant `signInWithIdToken` creates one. For a new social account that derived `"customer"` and wrote it, racing the role the user actually picked — and `profiles.role` is immutable (`20260808120000_profiles_role_immutable.sql`, which only rejects a *changed* value), so the first write wins permanently. Observed live on the S10 as `WARN [profiles-role] upsert failed: PROFILES_ROLE_IMMUTABLE`; my `business` write happened to land first, so the account is correct, but the ordering is not guaranteed. Had the derive won, a merchant who tapped **Business** would be permanently a shopper with no in-app remedy. The password flows were immune only because `signUp` puts the role in `user_metadata.signup_role`, so the provider derives the same value — the exact protection `signInWithIdToken` cannot have.
**Fix** (Dan chose "pending-role peek + stop persisting derived customer"): the pending-role carry moved to a new dependency-light `lib/pending-social-role.ts` with a non-consuming `peekPendingSocialRole()`; `resolveRoleForUser` now resolves stored → metadata → **pending social** → derived, so both writers agree; and it no longer persists the bare `customer` fallback, because that is a guess and writing a guess into an immutable column is the root defect. Only `business` (an owned businesses row) is treated as an affirmative signal. Three new regression tests in `lib/profiles-role.test.ts`.

**F-1 — open, minor.** The app's "Log out" does not sign out of Google. `GoogleSignin` keeps its cached credential, so the next tap silently re-authenticates with no account chooser — verified: sign-in completed in under 3 seconds with no picker. Consequences: a logged-out phone re-enters the previous account on one tap, and there is no way to switch Google accounts. `signOutSocialSessionLocally()` already calls `GoogleSignin.signOut()`, but only the relay guard invokes it. Candidate fix: call it from the app's normal sign-out path too.

**F-3 — open, pre-existing, not caused by this work.** A business-role account with no approved application is parked on `/business-setup` with only Apply / Apply on website / Contact support / Log out, so it cannot reach `(tabs)/settings` or `(tabs)/account` — the only places delete-account exists. Such a user cannot delete their own account in-app.

### Environment notes (cost real time, worth recording)

- `expo run:android --device RF8T20X0Z7P` fails with "Could not find device with name"; omit the flag.
- The dev client could not reach Metro over Wi-Fi. `adb reverse tcp:8081 tcp:8081` fixes it, **but the tunnel drops on force-stop/re-enumeration** and must be re-established, otherwise the launcher shows `ConnectException: Failed to connect to localhost/127.0.0.1:8081`.
- The dev launcher's read timeout is shorter than a cold Metro bundle for this app, so it reports `SocketTimeoutException` when the real state is "still bundling". Always pre-warm first: `curl "http://localhost:8081/.expo/.virtual-metro-entry.bundle?platform=android&dev=true&minify=false"`. Needed again after every code change that invalidates the cache.
- A `./statics.js` `UnableToResolveError` inside `@react-native-google-signin` right after `npm install` was a stale Metro cache; it resolved on retry, and `--clear` avoids it.
- `expo run:android` leaves Metro detached when it exits; that orphan reports "Metro and the client are out of sync". Kill the listener on 8081 and start Metro yourself.
- `adb exec-out screencap -p > file.png` **corrupts the PNG** in PowerShell (BOM). Use `adb shell screencap -p /sdcard/x.png` then `adb pull`.
- The dev launcher is Jetpack Compose and reports `bounds="[0,0][0,0]"` to uiautomator — its buttons must be tapped by pixel from a screenshot.
- uiautomator bounds go stale after any state change: clearing an error banner reflows the layout and moved the Google button 179px. Re-dump before every tap.

Apple sign-in cannot be tested here (iOS only) — it is verified in Phase 4 on TestFlight.

**Phase 3 pre-flight (added 2026-07-24).** The dev-client APK currently on the S10 predates this work
and does **not** contain the two new native modules — `app/auth-landing.tsx` imports them statically,
so an old client will fail to load the auth screen against new JS. A rebuild is mandatory, not
optional. Also put `EXPO_PUBLIC_ENABLE_SOCIAL_AUTH` and both client IDs in `.env.development.local`
(local runs do not read `eas.json`), and expect the buttons to be absent — not broken — until the Web
client ID is real, because `REPLACE-WITH…` is treated as unset by design.

## Phase 4 — Prod rollout ⛔ every step gated on Dan's explicit approval

- [ ] **Flip `EXPO_PUBLIC_ENABLE_SOCIAL_AUTH` to `"true"` in the `production` profile of `eas.json`** — it ships `"false"` on purpose so the train can leave with the buttons hidden if QA fails late. Nothing else needs changing to turn the feature on.
- [ ] Prod Supabase providers on (Phase 2 last box). Version bumps (`versionCode` 49 → next, iOS build number) — gated. EAS builds for both platforms — gated, preserve credits, decide first which parked "needs rebuild" items ride this train (Dan's call; list candidates from memory/handoffs before building).
- [ ] TestFlight on Dan's iPhone: full matrix including Apple sign-in, **Hide My Email as a customer** (should work), **Hide My Email attempting business** (guard fires, local sign-out, retry path works), Google-on-iOS.
- [ ] Play internal/closed track first; confirm Google sign-in with the **Play App Signing** signature before promoting.
- [ ] Store forms (Dan, agent drafts text): App Privacy / Play Data Safety updated for Google/Apple auth; privacy policy on the website lists both providers (then run `docs/website-edit-checklist.md`, bump `?v=`).
- [ ] App Review notes: demo email/password account still provided (unchanged reviewer path).

## Known traps (read before coding)

- Play App Signing SHA-1 (prod-only breakage). — Apple raw-vs-hashed nonce. — Google "universal" paid API imports. — `signInWithIdToken` carries no metadata (role must be local). — Sticky Apple hide-email choice per Apple ID. — `signOut` must be `scope: "local"` on device. — CRLF: never `toContain` across `\n` in tests on this repo. — `app/auth-callback.tsx` and `getEmailAuthRedirectUrl` are email-flow only; native social needs no deep link — leave them untouched.

## Estimate

Phase 1 ≈ 1.5–2 days; Phase 3 ≈ half a day on device; Phase 4 dominated by store review (1–2 days). Consoles (Phase 2) are the only external blocker — Dan can do them in parallel with Phase 1.
