# Executive summary

## Release recommendation

**NO-GO for public launch or expanded beta.**

The application has a substantial, well-tested foundation, but five P1 issues affect authorization, merchant trust, claim correctness, and billing integrity. The most serious issue is architectural: direct database writes can publish deals without the approval, terms, billing, and canonical publish checks that the official UI path performs. This makes UI-only enforcement insufficient against a modified client.

## Finding counts

| Severity | Count | Meaning |
|---|---:|---|
| P0 | 0 | Immediate active compromise or catastrophic loss was not demonstrated |
| P1 | 5 | Release blockers affecting authorization, money, identity/trust, or the core claim flow |
| P2 | 8 | Significant reliability, security, release, or conversion defects |
| P3 | 3 | Lower-risk hardening, dependency, or operational concerns |
| Total | 16 | See `findings.csv` and the detailed reports |

## Top release blockers

1. Owner RLS permits direct deal inserts/updates without canonical publication eligibility checks; new deals default active.
2. Pending or unverified businesses can be returned by public reads and nearby discovery.
3. A single client-embedded business invite value can be used to open arbitrary merchant applications, which compounds the public-discovery and deal-write issues.
4. Claim and release paths expire claims at the nominal expiration timestamp instead of respecting the documented ten-minute redemption grace period.
5. Stripe Checkout accepts a client-controlled `source` and `price_id`, allowing purchase-surface bypass and unsupported/mismatched charges.

## What is healthy

- TypeScript, lint, 1,561 tests in 249 files, Edge Function type checks, promotional-copy evaluation, the AI ad gate, and both localization gates passed.
- The legacy `ai-create-deal` production endpoint correctly returns HTTP 410.
- Unauthenticated live probes of admin, claim, and redeem functions correctly returned HTTP 401.
- The production migration ledger matches all 135 local migrations.
- Secret scanning found no committed leaks.
- The live privacy page and checked public routes loaded without browser console errors.
- The current AI poster lock check passed, and this audit made no changes to locked AI assets.

## Release conditions

At minimum, Batches 1 through 3 in `20_prioritized_remediation_plan.md` must be fixed, regression-tested, reviewed against the deployed schema, and re-audited. Builds, device workflows, hosted Auth settings, real Stripe lifecycle behavior, push/deep links, store links, and destructive account deletion still require the explicitly approved verification described in `21_verification_test_plan.md`.

## Required release questions

1. **Is Twofer safe to release?** No. Five P1 issues make the recommendation NO-GO.
2. **What must be fixed first?** Database-authoritative publication, public business lifecycle filtering, secure business onboarding authority, grace-consistent claims, and server-selected Stripe Checkout.
3. **What could cause financial loss?** F-005 can create a charge for an unsupported caller-selected Stripe price; F-006 can create duplicate Checkout Sessions.
4. **What could allow unauthorized access/action?** F-001 permits an owner to bypass canonical publication policy; F-003 provides reusable merchant-onboarding authority; full admin-role verification remains blocked.
5. **What could expose customer or business data?** F-002 exposes pending/unverified business identity/contact/location fields. Production retention/deletion/provider behavior is unverified.
6. **What could cause incorrect deal claims?** F-004 expires a claim during the documented redemption grace window and can allow a second logical claim.
7. **What could cause duplicate or unauthorized redemptions?** No duplicate redemption was demonstrated, but F-004 destabilizes the prerequisite claim; two-device/idempotency/staff authorization success paths remain mandatory test gaps.
8. **What could break business billing?** F-005/F-006, configuration-channel ambiguity, and unrun webhook/trial/cancel/refund lifecycle tests.
9. **What could break business onboarding?** F-003's shared gate, F-002's premature visibility, and F-008's mobile website friction.
10. **What could prevent customer core flows?** F-004 claim loss, F-007 native risk, F-009 nonfunctional share preview, F-010 absent install links, and unrun device/deep-link/push/wallet checks.
11. **What could prevent owner use?** Publication/billing eligibility inconsistency, Checkout defects, onboarding friction, and native release uncertainty.
12. **Which areas could not be verified?** Live schema definitions, hosted Auth/secrets/config, authenticated production success paths, Stripe lifecycle, AI providers, devices/builds/stores, push/wallet, account deletion, full admin matrix, accessibility/load.
13. **Which findings need production verification?** F-001/F-002 need live catalog confirmation; F-011 hosted Auth settings; F-013 deployed function disposition; F-009/F-010 final live routing/listings. Other blockers should be proven primarily in staging before narrow production smoke.
14. **What are the ten highest-priority actions?** Listed below in order.

## Ten highest-priority next actions

1. Define and enforce one database-authoritative publish transition (F-001).
2. Apply one approved/active/verified public-business predicate everywhere (F-002).
3. Replace the client-embedded shared business invite with scoped server authority/application review (F-003).
4. Centralize grace-aware claim validity and concurrency tests (F-004).
5. Make Stripe product/environment selection server-only (F-005).
6. Atomically consume Checkout tokens (F-006).
7. Resolve Expo Doctor dependency failures before any release build (F-007).
8. Fix mobile business onboarding and align its current release assertions (F-008).
9. Implement safe, state-aware share preview plus approved store fallbacks (F-009/F-010).
10. Reconcile hosted Auth/function inventory and generated release truth (F-011/F-012/F-013).
