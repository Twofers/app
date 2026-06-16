# iOS Release Audit

Date: 2026-06-16
Branch: `release/ios-testflight`
Safety checkpoint: `a46b6c1` (`Fix Twofer penguin icon and splash assets`)

This audit was prepared from the current repository plus read-only EAS project checks. It does not include real-iPhone TestFlight QA because this Windows workspace cannot run or sign iOS locally and has no physical iPhone attached.

## Release State

| Item | Finding |
| --- | --- |
| Current branch | `release/ios-testflight` |
| Latest commit | `a46b6c1` |
| Expo SDK | `~54.0.35` |
| React Native | `0.81.5` |
| Expo Router | `~6.0.24` |
| TypeScript | `~5.9.2` |
| EAS CLI | `18.5.0`, logged in as the project owner account. CLI reports `20.1.0` is available. |
| EAS project | `@unvmex2/twoforone`, project id configured in `app.json`. |
| App version | `1.0.0` |
| iOS bundle id | `com.unvmex2.twoforone` |
| iOS build number | EAS remote app versioning reports `11`. `app.json` does not set `ios.buildNumber` because `eas.json` uses `appVersionSource: remote`. |
| Android package | `com.unvmex2.twoforone` |
| Android versionCode | Local `app.json` value is `10`; EAS remote app versioning reports `17` and warns the local value is ignored for remote versioning, though it remains visible through `expo-constants`. |
| iPad support | Off: `ios.supportsTablet` is `false`. |
| App icon | `./assets/images/twofer-icon-1024.png` for iOS and Android. |
| Splash | `expo-splash-screen` uses `./assets/images/twofer-splash-1024.png`, white background, contain mode. |
| Scheme | `twoforone`, `twofer`. Existing Metro logs warn about multiple schemes; `lib/auth-password-recovery.ts` chooses the first scheme for generated auth URLs. |
| Universal links | iOS associated domain `applinks:www.twoferapp.com`; Android App Link path prefix `/s`. |
| EAS profiles | `development`, `preview`, `ios-sim`, `production`, `dev-client-apk`, `apk`. |
| Submit profile | `submit.production` exists. |

## Fix Applied

The `preview` build profile was changed from a dev-client build targeting the empty EAS `preview` environment into a standalone internal build targeting the populated EAS `production` environment. This is needed because the app throws at startup if Supabase URL or anon key are missing at bundle time.

To preserve Android dev-client behavior, `dev-client-apk` now sets `developmentClient: true` directly while still extending `preview`.

Files changed:

- `.easignore`
- `eas.json`
- `docs/ios-release-audit.md`
- `docs/ios-parity-checklist.md`

`.easignore` was also tightened so pre-existing local QA screenshot folders are not uploaded to EAS. The folders were preserved locally.

## Environment Variables

Local `.env` contains these variable names only, values intentionally omitted:

- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY`
- `EXPO_PUBLIC_ENABLE_SHARE_DEAL`

EAS production environment is populated with these variable names, values intentionally omitted:

- `EXPO_PUBLIC_DELETE_ACCOUNT_URL`
- `EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY`
- `EXPO_PUBLIC_PRIVACY_POLICY_URL`
- `EXPO_PUBLIC_SUPABASE_ANON_KEY`
- `EXPO_PUBLIC_SUPABASE_URL`
- `EXPO_PUBLIC_SUPPORT_URL`
- `EXPO_PUBLIC_TERMS_OF_SERVICE_URL`

The production build profile adds:

- `EXPO_PUBLIC_ENABLE_SHARE_DEAL=true`

The preview profile now uses the production EAS environment and adds preview-only debug flags plus `EXPO_PUBLIC_ENABLE_SHARE_DEAL=true`. AI provider keys are not app-bundled EAS variables; AI calls go through Supabase edge functions. No checkout or payment provider key is required for v1 because paid billing is disabled.

## iOS App Config

PASS:

- Bundle identifier is set.
- App version is set.
- iPhone-only support is set.
- App icon and splash are configured.
- Universal links are configured.
- Permission strings exist for location, camera, microphone, and photo library.
- `ITSAppUsesNonExemptEncryption` is `false`.
- Privacy manifest data is declared in `app.json`.
- EAS remote build numbering is active.

NEEDS HUMAN QA:

- EAS iOS credentials were not opened interactively in this run because credential output must not be printed into agent logs. Use `docs/EAS_IOS_CREDENTIALS_CHECK.md`.
- APNs push delivery must be checked on a real iPhone/TestFlight build.
- Liquid Glass/native iOS 26 appearance must be checked on a real iPhone or TestFlight-capable device.

## Privacy and Apple Compliance

| Item | Status |
| --- | --- |
| Privacy policy URL | Configured as `https://www.twoferapp.com/privacy`. The handoff notes a website-side support-email text issue that is outside this mobile repo. |
| Terms URL | Configured as `https://www.twoferapp.com/terms`. |
| Support URL | Configured as `https://www.twoferapp.com/support`. |
| Delete account URL | Configured as `https://www.twoferapp.com/delete-account`. |
| App Store privacy answers | Drafted in existing docs; owner must enter/confirm in App Store Connect. |
| Location data | Collected optionally for nearby deals and alerts; ZIP fallback exists. |
| Email/contact info | Collected for auth and business profile flows. |
| Analytics | App activity events are sent to Supabase `app_analytics_events`. |
| Diagnostics | Sanitized app-error telemetry only; no crash SDK found in `package.json`. |
| Push tokens | Expo push tokens stored in `push_tokens` for notification delivery. |
| User IDs/device IDs | Supabase user IDs and Expo push tokens are used for app functionality. |
| Payment/checkout | Paid billing is hidden by `PAID_BILLING_ENABLED=false`; checkout surfaces are not reachable in v1. |
| Privacy manifest file | No checked-in `PrivacyInfo.xcprivacy` file was found, but `ios.privacyManifests` is declared in `app.json` for Expo prebuild. |

## Platform Search Summary

Key source areas reviewed:

- Startup, auth, and deep links: `app/_layout.tsx`, `components/auth-recovery-link-handler.tsx`, `components/deal-deeplink-handler.tsx`, `components/notification-deeplink-handler.tsx`, `lib/auth-password-recovery.ts`.
- Push notifications: `lib/push-token.ts`, `lib/expo-notifications-support.ts`, `lib/notifications.ts`, `app/(tabs)/index.tsx`, `app/(tabs)/settings.tsx`.
- Location and map: `app/onboarding.tsx`, `lib/consumer-location.ts`, `components/map/map-native-screen.tsx`, `lib/map-businesses.ts`, `lib/map-camera-fit.ts`.
- Claim and redemption: `app/(tabs)/wallet.tsx`, `app/(tabs)/redeem.tsx`, `app/redemption-mode.tsx`, `lib/functions.ts`, Supabase edge functions.
- Share Deal: `lib/runtime-env.ts`, `lib/share-deal.ts`, `lib/deal-share-link.ts`, `components/deal-deeplink-handler.tsx`.
- Billing gate: `lib/billing/access.ts`, `app/(tabs)/_layout.tsx`, `components/billing-deeplink-handler.tsx`.

Android-only logic found is intentional:

- Android notification channel setup in `app/_layout.tsx`.
- Android Expo Go push skip in `lib/push-token.ts` and `lib/expo-notifications-support.ts`.
- Android native permissions and blocked permissions in `app.json`.
- Android Google Maps key injection in `app.config.js`.
- Android-specific date/time picker branches in create-deal flows, paired with iOS modal picker branches.

## Known Conflicts or Drift

- The handoff section 2 describes older iOS build 7 as queued, but EAS remote app versioning now reports iOS build number `11`.
- The handoff says demo code paths were removed, but the app still contains demo/sample-offer marker paths such as `lib/demo-content.ts` and `DemoOfferNotice`. These appear to mark seeded/sample content rather than restore demo-login auth, but they should be reviewed before App Store submission if "no demo paths" is meant literally.
- `docs/twofer-developer-handoff-spec.md` is referenced by the spec header, but the actual single source file in this repo root is `twofer-developer-handoff-spec.md`.

## Build and QA Blockers

BLOCKED in this workspace:

- `npx expo run:ios`: Windows machine, no local iOS simulator/signing path.
- Real-device iPhone QA: requires TestFlight on a physical iPhone.
- App Store Connect/TestFlight processing status: requires Apple account/ASC access and cannot be fully verified from source.

READY TO ATTEMPT after static checks pass:

- `eas build --platform ios --profile preview`
- Real-device QA by Dan/tester
- `eas build --platform ios --profile production`
- `eas submit --platform ios --latest`

## EAS Build Attempt

Preview build command attempted:

```powershell
eas build --platform ios --profile preview --non-interactive --wait --freeze-credentials --message "iOS TestFlight preview preflight"
```

Result: BLOCKED before EAS created a build id.

EAS found remote iOS credentials, but no credentials suitable for `distribution: internal`. Because the command was run non-interactively with credentials frozen, EAS could not create or repair an internal distribution provisioning setup. This preserves signing assets but blocks the plan's required preview/internal iOS build.

No production build or TestFlight submit was attempted after this blocker because the release plan requires the preview/internal build and preview QA before production submission.

Recent iOS EAS build history:

| Build id | Status | Profile | Distribution | App version | Build number | Created |
| --- | --- | --- | --- | --- | --- | --- |
| `ea2385d1-1818-49d9-9cdc-e5818562d3cc` | FINISHED | production | STORE | 1.0.0 | 11 | 2026-06-14 |
| `5568bec8-c2b1-4ced-abea-2e7423469c15` | FINISHED | production | STORE | 1.0.0 | 10 | 2026-06-11 |
| `5d4c10fb-d994-47a1-a1ff-1fb41d47b4bb` | CANCELED | production | STORE | 1.0.0 | 9 | 2026-06-11 |
| `33319418-dd71-40a9-a149-87d29ef2409b` | FINISHED | production | STORE | 1.0.0 | 8 | 2026-06-10 |
| `d99d9604-de95-407e-9b13-288259d32e85` | FINISHED | production | STORE | 1.0.0 | 7 | 2026-06-09 |

Next exact owner step:

```powershell
eas build --platform ios --profile preview
```

Run it interactively if Dan wants an ad hoc/internal iOS preview. Follow EAS prompts to create or repair internal distribution credentials and register a test iPhone if needed. This may change iOS signing/provisioning, so it is intentionally not done by the non-interactive agent command.

Alternative owner decision: skip ad hoc/internal preview and use the TestFlight-only iOS QA path. If Dan chooses that path, run a production STORE build and submit it to TestFlight, then perform real-iPhone QA from TestFlight. That is a process decision because it intentionally bypasses the plan's "preview/internal build first" requirement.

## Validation Results

| Command | Result | Notes |
| --- | --- | --- |
| `npm ci` | PASS | Installed 1128 packages. NPM audit still reports 32 vulnerabilities: 1 low, 25 moderate, 6 high. No broad dependency upgrade was applied during this scoped release pass. |
| `npx expo-doctor` | PASS | 18/18 checks passed. |
| `npx expo install --fix` | PASS | Dependencies already up to date. No package changes. |
| `npm run lint` | PASS | `expo lint` completed without reported errors. |
| `npm run typecheck` | PASS | `tsc --noEmit` completed without errors. |
| `npm test` | PASS | 59 test files passed, 369 tests passed. Expected stderr appears in push failure-safety tests. |
| `npx expo export --platform ios --output-dir .metro-health-check\ios-testflight --clear` | PASS | iOS bundle exported. Existing warnings remain for `country-flag-icons` subpath fallback imports. |

After the `.easignore` packaging update, `npm run lint`, `npm run typecheck`, and `npm test` were rerun and passed again.

## Commands Run During Audit

- `git status --short --branch`
- `git branch --show-current`
- `git log --oneline -20`
- `git switch -c release/ios-testflight`
- package/config inspection via read-only Node scripts
- `rg` platform/config searches
- `eas --version`
- `eas whoami`
- `eas project:info --json`
- `eas build:version:get --platform ios --profile production`
- `eas build:version:get --platform android --profile production`
- `eas build:list --platform ios --limit 5 --json`
- `npm ci`
- `npx expo-doctor`
- `npx expo install --fix`
- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npx expo export --platform ios --output-dir .metro-health-check\ios-testflight --clear`
- `eas build --platform ios --profile preview --non-interactive --wait --freeze-credentials --message "iOS TestFlight preview preflight"`

Secret values are intentionally not included in this document.
