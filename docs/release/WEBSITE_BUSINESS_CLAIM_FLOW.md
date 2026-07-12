# Website Business Claim Flow

Date: 2026-08-02

## Scope

Adds secure admin-created claim links and a public website claim page without activating a business or creating a live offer from a clicked link.

## Routes And Functions

- Admin function: `admin-claim-link-create`
- Public function: `business-claim-link`
- Public route: `/business/claim/[token]`

## Token Handling

`admin-claim-link-create` returns the raw token once and stores only a SHA-256 `token_hash` in `business_claim_links`. List and revoke responses do not expose token hashes.

## Claim Behavior

The public claim page validates the token server-side and shows only safe preview facts: business name, city, category, public state, and the statement that the profile is not active until claim and setup are complete.

Starting a claim creates reviewed `business_applications` and `business_onboarding_requests` history. It does not materialize a `businesses` row by itself, does not create a live offer, and does not start billing.
