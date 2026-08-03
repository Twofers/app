# Apple Review Notes Draft

Do not put real passwords in this file. Enter real credentials only in App Store Connect.

## Reviewer Accounts

Consumer demo account:

- Email: `[ADD REVIEWER CONSUMER EMAIL]`
- Password: `[ADD IN APP STORE CONNECT ONLY]`

Merchant demo account (active, no purchase needed):

- Email: `[ADD REVIEWER MERCHANT EMAIL]`
- Password: `[ADD IN APP STORE CONNECT ONLY]`
- Required backend state: active merchant entitlement such as `trial_active`, `admin_trial_active`, `pro_active`, or `paid_active`.

Second merchant account, approved but not yet activated (optional — only needed if the reviewer wants to see the trial-activation Checkout entry point described below):

- Email: `[ADD REVIEWER MERCHANT EMAIL 2]`
- Password: `[ADD IN APP STORE CONNECT ONLY]`
- Required backend state: `approved_not_activated` with a claimed business application.

## Overview

Twofer uses email/password login. Consumers discover live local offers, claim offers, and redeem in person by QR or staff verification. The first launch is Dallas-first, so the supplied reviewer accounts should be used to see seeded sample content.

Twofer is free for consumers. Business accounts are manually reviewed and approved before they can activate. Deals are real-world, in-person food and retail offers redeemed at the merchant's physical location — Twofer's own service to the merchant (offer creation, publishing, analytics, and redemption tooling) is a business subscription, not a digital unlock consumed inside the app by the end consumer, so it is sold outside Apple's In-App Purchase system per Guideline 3.1.3(a)/(b) (real-world services and business-to-business tools). Payment-card entry and subscription Checkout occur entirely on Stripe's hosted website; Twofer's app never collects or stores card numbers.

An approved-but-not-activated merchant can start their subscription in one of two ways: a single-use activation link emailed at approval time, or — as of this build — an in-app "Activate" action visible on both iOS and Android that opens the same Stripe-hosted Checkout in the device browser/webview and returns to the app on completion. This in-app path is gated by a server-side switch (`ios_trial_checkout`, historically iOS-only in name, now shared by both platforms) that Twofer can disable remotely at any time without a new binary; it is currently enabled in production. The primary merchant reviewer account supplied above is already active, so App Review can test every business tool (offer creation, publishing, redemption, analytics) without going through Checkout or entering any payment details at all. The optional second account lets a reviewer see the in-app Checkout entry point itself if desired; tapping it opens Stripe's hosted page, and no purchase is required to complete the review.

## Consumer Test Steps

1. Open the app and log in with the consumer reviewer account.
2. If prompted for location, deny permission to verify ZIP fallback or allow location to test nearby sorting.
3. Browse the sample Dallas-area live offers.
4. Open a deal detail screen.
5. Claim the offer.
6. Open Wallet and view the active ticket QR/code.
7. Open the second live offer to verify claim-conflict and repeat-restriction messaging while the first claim is active.
8. Optionally favorite a business and enable alerts; notifications are optional.
9. Use Settings to verify notification controls, legal links, and account deletion entry point.

## Merchant Test Steps

1. Log in with the active merchant reviewer account.
2. Open Dashboard to view sample offer status and metrics.
3. Open Create and draft an offer with the merchant tools.
4. If AI creation is enabled in the review build, enter typed offer details and review/edit generated copy before publishing.
5. Open Redeem to test QR or claim-code validation with the sample claim flow.
6. Open Account to view business profile, support/legal links, and account deletion controls.

## Notes For Review

- Dallas-first availability: reviewer accounts should have sample content so review is not blocked by physical location.
- Location: used to show nearby live local offers; ZIP fallback works if permission is denied.
- Notifications: optional and can be turned off in Settings.
- Account deletion: available in-app under consumer Settings and merchant Account.
- AI-assisted offer creation: merchants review generated copy before publishing; deal facts remain authoritative.
- Objectionable content & user safety: see "Content Moderation (Guideline 1.2)" below — report, hide/block, moderation queue, and terms acceptance are all in the build.
- Billing: Stripe-hosted merchant activation Checkout is available in-app on both iOS and Android for approved-but-not-activated merchants only, behind a remote server switch Twofer can disable at any time. The supplied primary merchant account is already active and requires no purchase to review any business feature. Deals themselves are real-world, in-person offers; the merchant subscription is a business tool, not a consumer digital unlock, so it is intentionally outside Apple's In-App Purchase system (Guideline 3.1.3).

## Content Moderation (Guideline 1.2)

Twofer's content producers are verified business owners, not anonymous users; customers do not post content to one another. We address the user-generated-content requirements as follows:

- Filtering objectionable material: businesses are manually vetted and approved before they can publish, and all AI-assisted offer copy passes automated validation before publication. Admins can remove any offer or business immediately from the internal admin console.
- Reporting: every offer has a "Report this offer" action (deal detail screen) and every business page has a "Report this business" action. Reports are written to a moderation queue.
- Timely response: reports appear in an internal admin Reports queue (`/admin/reports`) and on the admin home screen's "Open reports" counter. We review reports daily and act on them within 24 hours, including removing content and suspending or terminating offending accounts.
- Blocking abusive users: every offer and every business page has a "Hide this business" action that removes that business's offers from the user's feed and map. Hidden businesses can be reviewed and unhidden under consumer Settings → Hidden businesses.
- Terms of use: account creation requires agreeing to a Terms of Service that prohibits objectionable content and abusive behavior (required checkbox on the sign-up screen). Terms: https://www.twoferapp.com/terms
- Contact: support@twoferapp.com (also published at https://www.twoferapp.com/support).

## Manual Verification Before Pasting

- [ ] Consumer reviewer login works.
- [ ] Merchant reviewer login works.
- [ ] Merchant reviewer entitlement is active.
- [ ] Consumer account sees at least two claimable live deals outside physical Dallas location.
- [ ] Claim to Wallet QR/code works.
- [ ] Merchant redeem works.
- [ ] Support/privacy/terms URLs open successfully.
- [ ] Merchant reviewer access works without purchase or payment credentials.
- [ ] (Optional) With the approved-not-activated second account, the in-app "Activate" action opens Stripe-hosted Checkout on both iOS and Android and does not require completing a purchase to finish review.
- [ ] `ios_trial_checkout` is confirmed enabled in production before pasting this draft — if Dan has disabled it since this build shipped, remove the second-account section above and revert to the emailed-link-only description.
