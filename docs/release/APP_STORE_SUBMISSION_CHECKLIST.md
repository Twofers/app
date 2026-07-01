# Twofer App Store Submission Checklist

Date: 2026-06-30

Supersession note, 2026-07-01: the iOS merchant payment-path blocker listed below was addressed locally by choosing the no-in-app-paid-unlock launch posture. Mobile Stripe checkout, mobile subscription CTAs, mobile pricing pages, mobile billing links, and mobile merchant self-serve billing are now fail-closed behind production-safe flags. Use `docs/release/APP_STORE_SUBMISSION_IMPLEMENTATION_REPORT.md` and `docs/release/APP_STORE_REVIEW_GAP_MATRIX.md` as the current release-readiness evidence before submission.

## App Store Connect

- [ ] Select final iOS build - Needs App Store Connect manual action.
- [ ] Verify selected build matches intended commit and clean release branch - Needs App Store Connect manual action.
- [ ] Complete app name, subtitle, promotional text, description, keywords - Needs App Store Connect manual action.
- [ ] Upload final iPhone screenshots - Needs App Store Connect manual action.
- [ ] Add support URL - Needs App Store Connect manual action.
- [ ] Add privacy policy URL - Needs App Store Connect manual action.
- [ ] Add terms/marketing URL if used - Needs App Store Connect manual action.
- [ ] Complete App Privacy nutrition label - Needs App Store Connect manual action.
- [ ] Complete age rating - Needs App Store Connect manual action.
- [ ] Complete export compliance/encryption answer - Needs App Store Connect manual action.
- [ ] Add consumer demo account - Needs App Store Connect manual action.
- [ ] Add merchant demo account - Needs App Store Connect manual action.
- [ ] Add review notes - Needs App Store Connect manual action.
- [ ] Choose manual release or automatic release - Needs App Store Connect manual action.

## Repo Evidence

- [x] App version `1.0.0` present - Done in repo.
- [x] iOS bundle id `com.unvmex2.twoforone` present - Done in repo.
- [x] iPhone-only config (`supportsTablet: false`) present - Done in repo.
- [x] Legal/support URLs wired with production defaults - Done in repo.
- [x] Privacy manifest present in `app.json` - Done in repo.
- [x] In-app account deletion wired for consumer/business - Done in repo.
- [x] Location purpose string and ZIP fallback code present - Done in repo.
- [x] Push opt-in/settings code present - Done in repo.
- [x] QR claim/redeem Edge Function code present - Done in repo.
- [x] Store copy/answer drafts exist - Done in repo.

## Needs Code Or Config Decision

- [ ] Decide iOS merchant payment path - Needs business/legal decision.
- [ ] If paid merchant access is in the iOS app, implement StoreKit/IAP/subscription - Needs code work.
- [ ] If submitting without IAP, hide/disable Stripe checkout and paid unlock CTAs in the exact iOS review build - Needs code work.
- [ ] Confirm production localization flags match approved broad rollout state - Needs business/legal decision.
- [ ] Confirm final App Privacy answers include or exclude purchases based on exact build - Needs business/legal decision.

## Backend And Operations

- [ ] Verify hosted Supabase migrations match repo chain - Needs manual action.
- [ ] Verify Edge Functions deployed for claim/redeem/delete/push/AI/billing posture - Needs manual action.
- [ ] Verify required secret names only; do not expose values - Needs manual action.
- [ ] Verify storage buckets/policies - Needs manual action.
- [ ] Verify reviewer demo accounts and seeded claimable deal - Needs manual action.
- [ ] Run iOS TestFlight smoke on a real iPhone - Needs manual action.

## IAP / Subscription

- [ ] If StoreKit subscription is used, create auto-renewable subscription in App Store Connect - Needs App Store Connect manual action.
- [ ] Submit first subscription/IAP with the app version - Needs App Store Connect manual action.
- [ ] If Stripe remains web-only/outside-app, remove in-app purchase CTAs/links from iOS review build or document approved US storefront posture - Needs business/legal decision.

## Final Pre-Submit Gate

- [x] `npm run typecheck` passes - Done for this audit on 2026-07-01.
- [x] `npm run lint` passes - Done for this audit on 2026-07-01.
- [x] `npm test` passes - Done for this audit on 2026-07-01.
- [x] `npx expo-doctor` passes - Done for this audit on 2026-07-01.
- [ ] App Store Connect build, backend, and reviewer notes all point at the same environment - Needs manual action.
