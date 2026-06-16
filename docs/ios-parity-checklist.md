# iOS Parity Checklist

Date: 2026-06-16
Branch: `release/ios-testflight`

Status meanings:

- `PASS`: Verified from source/config or existing local static evidence.
- `FIXED`: Changed in this release pass.
- `NEEDS HUMAN QA`: Requires a real iPhone/TestFlight or account-backed manual flow.
- `BLOCKED`: Cannot be performed from this Windows workspace.
- `NOT APPLICABLE`: Not part of the v1 shipped surface or not relevant to iOS.

| # | Area | Status | Notes |
| --- | --- | --- | --- |
| 1 | App startup | NEEDS HUMAN QA | Source startup path is intact in `app/_layout.tsx`; iOS launch must be checked in TestFlight. |
| 2 | App icon | PASS | iOS and Android point to `assets/images/twofer-icon-1024.png`. |
| 3 | Splash screen | PASS | `expo-splash-screen` uses `assets/images/twofer-splash-1024.png`. |
| 4 | Auth screen logo | PASS | Latest checkpoint is the penguin icon/splash asset fix. |
| 5 | Auth/session persistence | PASS | Supabase auth uses SecureStore on native in `lib/supabase.ts`; auth provider is wired in `app/_layout.tsx`. |
| 6 | Consumer onboarding | NEEDS HUMAN QA | Source supports GPS/ZIP and favorites in `app/onboarding.tsx`; iOS keyboard and permission UI need device QA. |
| 7 | Business/owner onboarding | NEEDS HUMAN QA | `app/business-setup.tsx` is present; account-backed iOS QA required. |
| 8 | Business profile setup | NEEDS HUMAN QA | `app/business-setup.tsx`, `hooks/use-business.ts`, and account tab paths exist; needs real account QA. |
| 9 | Location permission request | NEEDS HUMAN QA | `expo-location` plugin and onboarding request exist; system prompt must be checked on iOS. |
| 10 | Location denied state | PASS | Denied/error paths in `app/onboarding.tsx` fall back to ZIP messaging. |
| 11 | Map discovery | NEEDS HUMAN QA | `components/map/map-native-screen.tsx` and map helpers exist; native iOS map layout needs device QA. |
| 12 | Radius filtering | PASS | Consumer radius options and sync paths exist in onboarding/settings. |
| 13 | Live deals list | NEEDS HUMAN QA | `app/(tabs)/index.tsx` present; real Supabase data QA required. |
| 14 | Deal cards | PASS | Card/poster source exists in `components/deal-card-poster.tsx`. |
| 15 | Deal detail page | NEEDS HUMAN QA | `app/deal/[id].tsx` exists; claim/share states need real data QA. |
| 16 | Favorite/unfavorite flow | NEEDS HUMAN QA | Flow exists in Home/Settings, but Supabase-backed iOS QA is required. |
| 17 | Favorite deal alerts | NEEDS HUMAN QA | Consent and sync paths exist; push delivery needs real-device QA. |
| 18 | Push notification registration | NEEDS HUMAN QA | Expo push token path exists in `lib/push-token.ts`; iOS APNs/EAS credentials need human credential check and device QA. |
| 19 | Push notification permission explanation | PASS | Home and Settings show branded pre-permission messaging before OS request. |
| 20 | Push notification tap/deep-link behavior | NEEDS HUMAN QA | `components/notification-deeplink-handler.tsx` exists; tap behavior requires real push on iOS. |
| 21 | Claim deal flow | NEEDS HUMAN QA | `supabase/functions/claim-deal` and mobile claim paths exist; live-account QA required. |
| 22 | One active deal in wallet rule | PASS | Latest checkpoint includes `920c46a Implement deal wallet redemption rules`; wallet logic present in `app/(tabs)/wallet.tsx`. |
| 23 | Business cannot redeem another business's deal | PASS | API messages and edge functions enforce wrong-business errors; real QR QA still recommended. |
| 24 | Business/location-level redemption enforcement | NEEDS HUMAN QA | Staff redemption has new/legacy location-aware selects; hosted schema drift means live QA is required. |
| 25 | QR/code display | NEEDS HUMAN QA | Wallet renders token/code states; QR brightness/legibility must be checked on iPhone. |
| 26 | QR/code scanning | NEEDS HUMAN QA | `app/(tabs)/redeem.tsx` and `app/redemption-mode.tsx` use `expo-camera`; iOS camera permission/device QA required. |
| 27 | Manual redemption fallback | PASS | Manual 6-character code paths exist in redeem screens. |
| 28 | Redeemed state | PASS | Redeemed state/status rendering exists in wallet and status pill components. |
| 29 | Expired deal state | PASS | Expired status handling exists in wallet/detail/feed paths. |
| 30 | Sold-out deal state | PASS | Claim/max-claims handling is present server-side and in deal UI states. |
| 31 | Owner AI offer creation | NEEDS HUMAN QA | `app/create/ai.tsx` exists; AI edge function availability is server-side and account-backed. |
| 32 | Owner custom text editing | PASS | AI create form supports editable title/promo/CTA/description fields. |
| 33 | Offer draft validation | PASS | Draft validation and deal-quality helpers are present. |
| 34 | Time limit controls | NEEDS HUMAN QA | iOS-specific picker modal branches exist; device keyboard/modal QA required. |
| 35 | Quantity limit controls | PASS | Max-claim controls and server claim limits exist. |
| 36 | Minimum customer value rule | PASS | Deal quality/value validation helpers exist in `lib/deal-quality.ts` and create flows. |
| 37 | Offer publishing | NEEDS HUMAN QA | Publish paths exist; live Supabase insert and edge effects need account QA. |
| 38 | Owner metrics/dashboard | NEEDS HUMAN QA | `app/(tabs)/dashboard.tsx` exists; live data QA required. |
| 39 | Owner redemption history | NEEDS HUMAN QA | Dashboard/redeem history paths exist; live data QA required. |
| 40 | Account/settings screens | NEEDS HUMAN QA | Consumer and business settings/account screens exist; iOS safe-area/keyboard QA required. |
| 41 | Delete account flow | NEEDS HUMAN QA | In-app and website URLs exist; destructive account QA must be owner-controlled. |
| 42 | Support/privacy/terms links | PASS | Defaults and EAS production variable names are configured in `lib/legal-urls.ts`. |
| 43 | Share Deal feature | PASS | `EXPO_PUBLIC_ENABLE_SHARE_DEAL` is configured in EAS profiles and read only by `lib/runtime-env.ts`; share link helpers exist. |
| 44 | Deep links and universal links | NEEDS HUMAN QA | Schemes and associated domain configured; real universal-link open requires device/TestFlight QA. |
| 45 | Error states | PASS | Branded banners, empty states, and friendly auth/API messages are present across key flows. |
| 46 | Empty states | PASS | Empty-state components and dashboard/feed/wallet empty states are present. |
| 47 | Loading states | PASS | Loading skeleton/spinner patterns exist across feed/settings/dashboard flows. |
| 48 | Offline/no-network behavior | NEEDS HUMAN QA | Supabase fetch wrapper normalizes network failures; airplane-mode/device behavior still needs iOS QA. |
| 49 | Slow-network behavior | NEEDS HUMAN QA | Loading states exist, but slow-network UX needs real or throttled device QA. |
| 50 | Android regression risk | FIXED | `preview` is now standalone internal for iOS; `dev-client-apk` explicitly keeps `developmentClient: true` so Android dev-client behavior is preserved. Static Android behavior still needs lint/type/test coverage. |

## Required Human QA Matrix

These cannot be completed from this Windows workspace:

- Fresh iPhone install through TestFlight.
- Upgrade install from prior TestFlight build.
- Logged-out, consumer, and owner account runs.
- Location allowed/denied system prompts.
- Notifications allowed/denied and push-tap deep links.
- Camera allowed/denied QR scanner.
- Slow-network/no-network behavior on iOS.
- Active, claimed, redeemed, expired, and sold-out deal states using live data.
- Liquid Glass/native-control appearance.
- Safe area, Dynamic Island, bottom tabs, keyboard, modal dismissal, and back gesture checks.

## Files Changed

- `.easignore`
- `eas.json`
- `docs/ios-release-audit.md`
- `docs/ios-parity-checklist.md`
