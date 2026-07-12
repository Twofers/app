# App Store Connect answer sheets

Date: 2026-06-07
Updated: 2026-06-29

Scope: iOS App Store submission answer drafts for v1. These are **not paste-ready until the
exact review build's billing posture is confirmed**. Current code has billing surfaces enabled
(`PAID_BILLING_ENABLED=true`) and pilot enforcement bypassed (`PILOT_DISABLE_BILLING_GATE=true`),
so old "no payment path is exposed" language is only valid for a build that has billing hidden or
disabled by a verified review-build mechanism. They match the trimmed privacy manifest in
`app.json` and `docs/privacy-manifest-reconciliation-20260607.md` for non-billing data.

## App Privacy

### Tracking

Answer: No, this app does not use data for tracking.

Notes:
- `NSPrivacyTracking` is false.
- No advertising identifier, cross-app advertising network, or third-party ad SDK is used.
- Purchase/payment answers depend on the exact build: current app code includes billing surfaces.
  If a review build exposes subscriptions, update App Privacy answers for purchase/subscription
  status even though card data is handled by Stripe Checkout and not stored by the app.

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
| Diagnostics | Other Diagnostic Data | App Functionality | The custom `ErrorUtils` hook sends sanitized `app_error` telemetry to Supabase with source, fatal flag, error name, error hash, app version, app build, and platform. It is not linked to the user's identity, is not used for tracking, and is used only to diagnose errors and improve reliability. It does not send raw error messages, raw stack traces, email, phone, address, token, or location. |

### Data Not Collected

Answer No for these unless the exact review build exposes a related flow:

- Credit Info
- Advertising Data
- Contacts
- Health and Fitness
- Sensitive Info
- Browsing History
- Search History
- Crash Data
- Performance Data

Billing caveat:
- `Payment Info`: normally No for the app itself if card entry happens only in Stripe Checkout and
  card numbers are not stored by Twofer.
- `Purchases`: Conditional. If subscription, trial, plan, or Stripe customer/subscription status is
  reachable in the review build, do not answer "No" without a fresh privacy/legal review.

## Age Rating

Draft posture:
- Not in the Kids category.
- Not directed to children.
- No gambling, simulated gambling, loot boxes, contests, unrestricted web access, ads, mature themes, medical content, violence, sexual content, nudity, or tobacco/drug content by design.
- Alcohol-related deal references are allowed on the platform, but expected to be infrequent.
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
| Commerce or payments | Conditional. Current code has billing surfaces enabled; answer No only for a build where payment/subscription paths are verified hidden or disabled. |
| Alcohol, tobacco, drug references | Infrequent or Mild. Alcohol-related deal references are allowed on the platform, but expected to be infrequent. Tobacco and drug references remain No by design. |
| Gambling or contests | No. |
| Profanity or crude humor | No by design. UGC could contain inappropriate text, so reports are available. |
| Medical or wellness content | No. |
| Sexual content or nudity | No. |
| Violence, weapons, horror, fear themes | No. |

Rating confirmation:
- Alcohol-related deals are allowed on the platform, but will be infrequent.
- The expected Apple global age rating is 13+ on the current App Store age-rating scale.
- No other current draft answer is expected to push the rating higher.
- If App Store Connect asks for the age rating result, use 13+.

## Export Compliance

Draft answer:

The app uses standard HTTPS/TLS connections to Supabase, Firebase/Expo push services, maps, and AI services. It does not include proprietary encryption, custom cryptography, VPN, DRM, secure messaging, or other non-exempt encryption features.

Recommended App Store Connect posture:
- Uses only exempt encryption through standard platform networking.
- `ITSAppUsesNonExemptEncryption` is set to `false` in `app.json`.
- If App Store Connect asks whether the app uses non-exempt encryption, answer No.

## Reviewer App Access Notes

Use dedicated reviewer accounts. Do not use personal accounts.

Paste-ready draft:

```
Twofer uses email and password login. There is no social login.
There is no email link login or one-time code login for reviewer access.

This first iOS release is intended as a pilot. Billing/pricing surfaces are pilot-only unless Dan
explicitly approves a live billing review path for this exact build. Do not use real payment
credentials during review unless that approval exists.

Please use these reviewer logins:

Consumer email: [DAN_TO_PASTE_CONSUMER_REVIEWER_EMAIL]
Consumer password: [DAN_TO_PASTE_CONSUMER_REVIEWER_PASSWORD]

Business email: [DAN_TO_PASTE_BUSINESS_REVIEWER_EMAIL]
Business password: [DAN_TO_PASTE_BUSINESS_REVIEWER_PASSWORD]

The consumer login reaches the shopper side. The business login reaches the owner side and has a pilot business with posted deals for review.

Suggested review path:
1. Log in with the consumer reviewer account through the normal email and password form.
2. On the consumer side, browse nearby deals, open a deal, claim it, view it in Wallet, and use Share Deal if desired.
3. Sign out, then log in with the business reviewer account.
4. Open Dashboard to view posted deals and performance basics.
5. Open Create to draft a deal. The AI draft flow can use typed text, a photo, or a short voice note.
6. If you use voice input, the audio is sent to an AI transcription service and the transcript is shown for review before publishing.
7. Account deletion is available in the app. Please do not delete the reviewer accounts unless requested. We can provide a separate deletion-test account if needed.

Business accounts are invite-only during the pilot, so please use the supplied business reviewer login rather than creating a new account.
```

Before pasting:
- Verify both reviewer accounts work on the review environment with their reviewer passwords.
- Verify the consumer account can browse/claim and the business account has posted deals.
- Paste the reviewer passwords into App Store Connect.
- Provide the support contact email and phone used in App Store Connect.

## Other Declarations

| Declaration | Draft answer |
| --- | --- |
| Content rights | The app displays business-provided deal text, photos, logos, and AI-assisted drafts. Business users are responsible for content they publish. |
| Ads | No. |
| Third-party content | Yes, user/business-generated deal content. |
| In-app purchases | Conditional for the exact build. Current code enables billing surfaces; confirm before answering. |
| Financial services | No. |
| Health data | No. |
| Government services | No. |

## References

- Apple App Store Connect age rating help: https://developer.apple.com/help/app-store-connect/manage-app-information/set-an-app-age-rating/
- Apple age rating values and definitions: https://developer.apple.com/help/app-store-connect/reference/age-ratings-values-and-definitions/
- Apple privacy manifest data type docs: https://developer.apple.com/documentation/bundleresources/app-privacy-configuration/nsprivacycollecteddatatypes/nsprivacycollecteddatatype
