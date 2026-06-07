# Privacy manifest reconciliation

Date: 2026-06-07

Scope: iOS App Store prep for the free v1 pilot. This note maps the app-level
`ios.privacyManifests.NSPrivacyCollectedDataTypes` entries in `app.json` to real
app flows. Tracking is declared false for every item. No purchase, payment, or
subscription data is declared because paid billing is gated off for v1.

## Declared collected data

| Privacy manifest data type | Linked | Purposes | Real app flow |
| --- | --- | --- | --- |
| `NSPrivacyCollectedDataTypeName` | Yes | App Functionality | Business setup/account profile collects business name and owner/contact name in `businesses` and `business_profiles`. |
| `NSPrivacyCollectedDataTypeEmailAddress` | Yes | App Functionality | Email/password auth uses an email address, and business profiles can store `business_email`. |
| `NSPrivacyCollectedDataTypePhoneNumber` | Yes | App Functionality | Business setup/account profile stores the business phone number shown to customers. |
| `NSPrivacyCollectedDataTypePhysicalAddress` | Yes | App Functionality | Business setup/account profile stores the business street address/location for listings, maps, and directions. |
| `NSPrivacyCollectedDataTypePreciseLocation` | Yes | App Functionality, Product Personalization | Consumer GPS location can be requested in onboarding/settings, resolved to latitude/longitude, stored as last-known coordinates, and used for nearby sorting, maps, and alerts. |
| `NSPrivacyCollectedDataTypeCoarseLocation` | Yes | App Functionality, Product Personalization | Consumers can use ZIP code instead of GPS. The app stores ZIP/location preference and uses it for nearby sorting and alerts. |
| `NSPrivacyCollectedDataTypePhotosorVideos` | Yes | App Functionality | Business logo uploads, deal photos, menu scan photos, and AI ad photo workflows upload images to Supabase storage and AI helper functions. |
| `NSPrivacyCollectedDataTypeAudioData` | Yes | App Functionality | AI Compose voice input records audio, sends it through the Supabase `ai-compose-offer` function, and forwards it to an AI transcription service. |
| `NSPrivacyCollectedDataTypeOtherUserContent` | Yes | App Functionality | Users create deal copy, menu items, business descriptions, reports, favorites, claims, and other app content stored in Supabase. |
| `NSPrivacyCollectedDataTypeUserID` | Yes | App Functionality, Analytics | Supabase auth user IDs link profiles, businesses, claims, favorites, push tokens, and analytics events to the signed-in account. |
| `NSPrivacyCollectedDataTypeDeviceID` | Yes | App Functionality | Expo push tokens are stored in `push_tokens` with `user_id` so the server can send deal alerts. |
| `NSPrivacyCollectedDataTypeProductInteraction` | Yes | Analytics | The app records product analytics such as deal viewed, deal opened, deal claimed, wallet opened, and redemption events in `app_analytics_events`. |
| `NSPrivacyCollectedDataTypeCrashData` | No | Analytics | The custom global error handler records sanitized `app_error` telemetry with error name/hash, fatal flag, app version, and platform. It does not send raw messages, stack traces, tokens, email, phone, address, or location. |
| `NSPrivacyCollectedDataTypeOtherDataTypes` | Yes | Analytics | Consumer profile setup can collect an optional birthdate. The app stores it with the user's consumer profile for age-range analytics. |

## Trimmed from the manifest

| Removed data type | Why removed |
| --- | --- |
| `NSPrivacyCollectedDataTypePerformanceData` | No performance monitoring SDK or app flow collects launch time, latency, frame rate, battery, or similar performance metrics. |

## Notes for App Privacy answers

- Tracking: No.
- Purchases/payment info: No for v1 because paid billing is gated off.
- Audio disclosure must say audio is sent to an AI transcription service.
- Device ID should be answered as linked to the user for push-token storage.
- Crash data should be answered as not linked to the user based on the current sanitized global error flow.
- Other Data should be answered as linked to the user for optional birthdate and age-range analytics.
