# Open questions and blocked checks

## Product/engineering questions

1. What exact business states are public, and must verification be per business, per location, or both?
2. Should billing ineligibility hide existing deals, prevent new claims only, or allow redemption of already claimed offers?
3. Is direct client editing of `deals` still an intended compatibility path, or can all publication mutations move behind a canonical RPC/function?
4. What is the intended secure replacement for the business invite: one-time invitations, admin-reviewed application, domain verification, or another proof?
5. During claim grace, should a shopper be prohibited from all new claims, and is release intentionally disallowed or treated as redemption abandonment?
6. Is `ai-refine-ad-copy` still called by any released client or admin workflow? Where is its authoritative source?
7. Which billing purchase surfaces are intentionally enabled in production, given server billing is on while mobile public flags are off?
8. What are the approved App Store/Play listing URLs and release timing?
9. What monitoring vendor/ownership/on-call expectations are approved for v1?

## Blocked or deliberately unexecuted checks

1. Production database catalog/policy definition dump: no approved direct production DB inspection path was used.
2. Hosted Auth settings and email delivery: requires dashboard/API access and may expose configuration.
3. Authenticated production success paths: would create/change customer, business, claim, redemption, billing, or admin data.
4. RLS integration/probe scripts: may write test rows and require credentials; not run against production.
5. Stripe Checkout/webhooks/portal/refund: financial and external-state changes.
6. AI provider success paths: incur cost and may transmit content; live bundle parity is unverified.
7. Push, wallet, deep links, camera/location, QR, and redemption devices: require controlled real devices/accounts.
8. Account deletion: destructive by design.
9. Android/iOS release builds and store installs: explicit hard gate; iOS also requires EAS/real iPhone from Windows.
10. Website form submissions and deployment: would write external data or change live state.
11. Admin MFA/role/mutation matrix: requires dedicated credentials and may mutate records.
12. Full accessibility/assistive-tech and performance/load testing: requires device/browser matrix and agreed targets.

## Safe production checks completed

The hosted migration ledger and function names/status were read; public website routes were loaded without submission; and synthetic unauthenticated failure-path calls returned expected 410/401 statuses. These checks did not read customer rows or change production state.

