# Apple Review Notes Draft

Do not put real passwords in this file. Enter real credentials only in App Store Connect.

## Reviewer Accounts

Consumer demo account:

- Email: `[ADD REVIEWER CONSUMER EMAIL]`
- Password: `[ADD IN APP STORE CONNECT ONLY]`

Merchant demo account:

- Email: `[ADD REVIEWER MERCHANT EMAIL]`
- Password: `[ADD IN APP STORE CONNECT ONLY]`
- Required backend state: active merchant entitlement such as `trial_active`, `admin_trial_active`, `pro_active`, or `paid_active`.

## Overview

Twofer uses email/password login. Consumers discover live local offers, claim offers, and redeem in person by QR or staff verification. The first launch is Dallas-first, so the supplied reviewer accounts should be used to see seeded sample content.

Twofer is free for consumers. Business accounts are created through direct merchant onboarding and are reviewed before activation. This iOS build does not include in-app subscription purchase, Stripe Checkout, pricing, or external payment links. The merchant demo account is already active so App Review can test business tools without billing.

## Consumer Test Steps

1. Open the app and log in with the consumer reviewer account.
2. If prompted for location, deny permission to verify ZIP fallback or allow location to test nearby sorting.
3. Browse the sample Dallas-area live offers.
4. Open a deal detail screen.
5. Claim the offer.
6. Open Wallet and view the active ticket QR/code.
7. Optionally favorite a business and enable alerts; notifications are optional.
8. Use Settings to verify notification controls, legal links, and account deletion entry point.

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
- Reporting: customers can report an offer from the deal detail screen.
- Billing: mobile billing, Stripe Checkout, pricing, subscription purchase, and external payment links are hidden/disabled in this review build.

## Manual Verification Before Pasting

- [ ] Consumer reviewer login works.
- [ ] Merchant reviewer login works.
- [ ] Merchant reviewer entitlement is active.
- [ ] Consumer account sees at least one claimable live deal.
- [ ] Claim to Wallet QR/code works.
- [ ] Merchant redeem works.
- [ ] Support/privacy/terms URLs open successfully.
- [ ] No billing/pricing/checkout CTA appears in the iOS build.
