# App Privacy Disclosure Draft

Date: 2026-07-01

Final App Store Connect answers must be reviewed against the exact submitted build and hosted backend. This draft is based on local code, `app.json`, dependencies, and the selected launch posture: no mobile Stripe Checkout or mobile subscription purchase.

| Data Category | Collected | Linked to User | Tracking | Purpose | Evidence |
|---|---:|---:|---:|---|---|
| Name | Yes | Yes | No | Account/profile, business contact | Auth/profile/business setup |
| Email address | Yes | Yes | No | Login, support, business contact | Supabase Auth, profiles |
| Phone number | Business only | Yes | No | Business profile/contact | Business setup/account |
| Physical address | Business only | Yes | No | Business profile/location display | Business profile/location fields |
| Coarse location | Yes | Yes | No | Nearby offers, ZIP fallback | Consumer prefs, ZIP/location code |
| Precise location | Optional | Yes | No | Nearby sorting when permission allowed | `expo-location`, app permissions |
| User ID / identifiers | Yes | Yes | No | Auth, claims, analytics, security | Supabase Auth, app analytics |
| Device ID / push token | Optional | Yes | No | Push notifications after opt-in | `push_tokens`, notifications |
| Product interaction / usage data | Yes | Yes | No | Analytics, claims, redemptions, quality | `app_analytics_events`, claims |
| User content | Yes | Yes | No | Business offer copy/images, reports, support | Deals, reports, AI create |
| Photos/videos | Business only | Yes | No | Offer/menu/photo upload and AI tools | Image picker/upload code |
| Audio data | Optional business input | Yes while processed | No | AI Compose voice transcription | Microphone permission, AI compose |
| Purchases / subscription status | Merchant status only | Yes | No | Merchant access authority | Entitlements/billing status; mobile purchase UI hidden |
| Payment information | No in mobile app | No | No | Web/admin Stripe billing outside app | Stripe handled outside mobile build |
| Diagnostics | Yes | No/limited | No | Reliability/debugging | App config/privacy manifest |

## Third Parties / Processors To Review

- Supabase: auth, database, storage, Edge Functions.
- Stripe: approved web/admin business billing only; no mobile checkout in the submitted app.
- Expo/Apple/Google push notification infrastructure.
- Map/location provider where configured.
- AI providers used by Edge Functions for merchant AI tools.
- Diagnostics, analytics, email, or support tools if enabled in production.

## App Store Connect Recommendations

- Do not mark payment information as collected by the mobile app for this launch posture unless the exact submitted build or review workflow collects it in-app.
- Do disclose purchase/subscription or merchant entitlement status if App Store Connect's taxonomy is interpreted to include backend merchant access status.
- Mark tracking as No unless a separate production analytics/subprocessor review identifies cross-company tracking.
- Ensure privacy policy and App Store privacy labels match the exact build and deployed backend configuration.
