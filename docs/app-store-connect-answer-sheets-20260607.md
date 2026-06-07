# App Store Connect answer sheets

Date: 2026-06-07

Scope: iOS App Store submission draft answers for the free v1 pilot. These are
drafts for Dan to paste into App Store Connect. They match the trimmed privacy
manifest in `app.json` and `docs/privacy-manifest-reconciliation-20260607.md`.

## App Privacy

### Tracking

Answer: No, this app does not use data for tracking.

Notes:
- `NSPrivacyTracking` is false.
- No advertising identifier, cross-app advertising network, or third-party ad SDK is used.
- No purchase or payment data is collected in v1 because paid billing is gated off.

### Data Linked to the User

| App Store category | Data type | Purpose | Notes |
| --- | --- | --- | --- |
| Contact Info | Name | App Functionality | Business name and owner/contact name for business profiles. |
| Contact Info | Email Address | App Functionality | Email/password login and business contact email. |
| Contact Info | Phone Number | App Functionality | Business phone number shown in business profiles. |
| Contact Info | Physical Address | App Functionality | Business address/location for profiles, maps, and directions. |
| Location | Precise Location | App Functionality, Product Personalization | Optional GPS coordinates for nearby sorting, maps, and alerts. |
| Location | Coarse Location | App Functionality, Product Personalization | ZIP code and general area for nearby sorting and alerts. |
| User Content | Photos or Videos | App Functionality | Business logos, deal photos, menu scan photos, and AI ad photo workflows. |
| User Content | Audio Data | App Functionality | Voice input for AI Compose. Audio is sent to an AI transcription service. |
| User Content | Other User Content | App Functionality | Deal copy, menu items, business descriptions, reports, favorites, claims, and related app content. |
| Identifiers | User ID | App Functionality, Analytics | Supabase auth user ID links profiles, businesses, claims, favorites, push tokens, and analytics rows. |
| Identifiers | Device ID | App Functionality | Expo push token stored with `user_id` for deal alerts. |
| Usage Data | Product Interaction | Analytics | First-party analytics for deal views, opens, claims, wallet activity, redemption events, and onboarding events through `trackAppAnalyticsEvent` and the Supabase `ingest-analytics-event` function. |
| Other Data | Other Data Types | Analytics | Optional consumer birthdate for aggregate age-band analytics. Legacy `age_range` rows may be read for old accounts, but the shipping app writes `age_range: null`. |

### Data Not Linked to the User

| App Store category | Data type | Purpose | Notes |
| --- | --- | --- | --- |
| Diagnostics | Other Diagnostic Data | App Functionality | The custom `ErrorUtils` hook sends sanitized `app_error` telemetry to Supabase with source, fatal flag, error name, error hash, app version, app build, and platform. It does not send raw error messages, raw stack traces, email, phone, address, token, or location. |

### Data Not Collected

Answer No for these unless the app changes before submission:

- Purchases
- Payment Info
- Credit Info
- Advertising Data
- Contacts
- Health and Fitness
- Sensitive Info
- Browsing History
- Search History
- Crash Data
- Performance Data

## Age Rating

Draft posture:
- Not in the Kids category.
- Not directed to children.
- No gambling, simulated gambling, loot boxes, contests, unrestricted web access, ads, mature themes, medical content, violence, sexual content, nudity, drug use, or tobacco content by design.
- User-generated content: Yes. Business users can publish deal text and photos that customers can see.
- Sharing: Yes. Share Deal lets a user share a public deal link through the native share sheet. It does not share private claim codes.
- Location: Yes. The app uses optional GPS or ZIP code for nearby sorting, maps, and alerts.
- User reports: Yes. Customers can report a business, and businesses can report a customer tied to a redemption flow.
- Blocking users: Not currently exposed as a user-facing feature.
- Chat or open messaging: No.
- Unrestricted web access: No.

Recommended draft answers:

| Question area | Draft answer |
| --- | --- |
| Age Categories and Override | Not Applicable, unless Dan wants to manually require a higher age rating. |
| Kids Category | No. |
| User-generated content | Yes. Business deal listings and photos are user-generated and broadly distributed inside the app. |
| UGC controls | Report tools exist. No user-facing block feature is currently exposed. No open chat. |
| Unrestricted web access | No. External links are limited to policy/support URLs, maps/directions, and share links. |
| Advertising | No. |
| Commerce or payments | No in-app purchase or payment path in v1. |
| Alcohol, tobacco, drug references | No for the current cafe pilot, unless any launch business will publish alcohol, tobacco, or drug-related offers. |
| Gambling or contests | No. |
| Profanity or crude humor | No by design. UGC could contain inappropriate text, so reports are available. |
| Medical or wellness content | No. |
| Sexual content or nudity | No. |
| Violence, weapons, horror, fear themes | No. |

Open confirmation for Dan:
- Confirm whether any launch business will post alcohol-related deals. If yes, update the age-rating answers.
- Confirm whether you want a manual minimum age rating, such as 13+, even if Apple calculates a lower rating.

## Export Compliance

Draft answer:

The app uses standard HTTPS/TLS connections to Supabase, Firebase/Expo push services, maps, and AI services. It does not include proprietary encryption, custom cryptography, VPN, DRM, secure messaging, or other non-exempt encryption features.

Recommended App Store Connect posture:
- Uses only exempt encryption through standard platform networking.
- `ITSAppUsesNonExemptEncryption` is set to `false` in `app.json`.
- If App Store Connect asks whether the app uses non-exempt encryption, answer No.

## Reviewer App Access Notes

Use dedicated review accounts. Do not use personal accounts.

Paste-ready draft:

```
TWOFER uses email and password login. There is no social login.

This first iOS release is a free pilot. No in-app purchase, paid upgrade, external payment, or subscription flow is exposed.

Please use these review accounts:

Consumer account:
Email: [DAN_TO_PROVIDE_CONSUMER_EMAIL]
Password: [DAN_TO_PROVIDE_CONSUMER_PASSWORD]

Business account:
Email: [DAN_TO_PROVIDE_BUSINESS_EMAIL]
Password: [DAN_TO_PROVIDE_BUSINESS_PASSWORD]

Suggested review path:
1. Log in with the consumer account.
2. Browse nearby deals, open a deal, claim it, view it in Wallet, and use Share Deal if desired.
3. Log out.
4. Log in with the business account.
5. Open Dashboard to view active deals and performance basics.
6. Open Create to draft a deal. The AI draft flow can use typed text, a photo, or a short voice note.
7. If you use the voice input, the audio is sent to an AI transcription service and the transcript is shown for review before publishing.
8. Account deletion is available in the app. Please do not delete the main review accounts unless requested. We can provide separate deletion-test accounts if needed.

Business accounts are invite-only during the pilot, so please use the supplied business account rather than creating a new one.
```

Open items for Dan:
- Provide stable consumer reviewer credentials.
- Provide stable business reviewer credentials with seeded demo data.
- Decide whether to provide separate account-deletion test credentials.
- Provide the support contact email and phone used in App Store Connect.

## Other Declarations

| Declaration | Draft answer |
| --- | --- |
| Content rights | The app displays business-provided deal text, photos, logos, and AI-assisted drafts. Business users are responsible for content they publish. |
| Ads | No. |
| Third-party content | Yes, user/business-generated deal content. |
| In-app purchases | No for v1. |
| Financial services | No. |
| Health data | No. |
| Government services | No. |

## References

- Apple App Store Connect age rating help: https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/
- Apple age rating values and definitions: https://developer.apple.com/help/app-store-connect/reference/age-ratings-values-and-definitions/
- Apple privacy manifest data type docs: https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes/nsprivacycollecteddatatype
