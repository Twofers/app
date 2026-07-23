# Mobile app audit

## Startup, routing, and identity

Expo Router separates auth/onboarding, shopper tabs, business dashboard/create/billing/account, deal/business detail, redemption, diagnostics, and AI creation routes. The app routes from the stored/derived profile role; no soft shopper/business switch or social/guest authentication path was found. Unconfirmed-email resend UX exists in `app/auth-landing.tsx:315-430`.

The locked product configuration is visible in source: app version 1.0.0, production package/bundle `com.unvmex2.twoforone`, iPad support off, and Share Deal flags configured. Android versionCode is 49 at `app.json:208`, not the 31 stated in current-state docs.

## Customer flows

Browse/map/search consume public business data and inherit F-002. Deal detail, favorites, wallet, claim, release, share, settings, notification permission, logout, and deletion surfaces exist. The core claim flow inherits F-004. Share recipients inherit F-009/F-010 outside the app.

## Owner flows

Business setup inherits F-003. AI creation uses the reviewed versioned publish function, but existing edit performs a direct `deals.update` at `app/create/ai.tsx:3380-3402`; all clients inherit the database-boundary defect F-001. Billing surfaces are enabled in code while production EAS mobile billing flags remain off, requiring an explicit channel decision.

## Native/configuration quality

F-007: Expo Doctor found duplicate React Native versions (root 0.81.5 and nested 0.86.0) and reports `react-native-launch-arguments` untested on the New Architecture. No build was run under the repository hard gate, so exact build/runtime impact remains unverified.

## Manual gaps

No real-device camera/location, deep link, push, wallet, QR, offline, background/resume, account deletion, small-screen accessibility, Android release, or iOS/TestFlight flow was run. These require explicit approval and controlled accounts/devices.

