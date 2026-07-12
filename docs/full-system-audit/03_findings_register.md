# Findings register

The complete machine-readable register is `findings.csv`.

| ID | Sev | Confidence | Status | Finding | Release effect |
|---|---|---|---|---|---|
| F-001 | P1 | High | Confirmed | Direct deal writes bypass canonical publish eligibility | Blocker |
| F-002 | P1 | High | Confirmed | Pending/unverified businesses are publicly discoverable | Blocker |
| F-003 | P1 | High | Confirmed | Shared client-embedded business invite is not a secure gate | Blocker |
| F-004 | P1 | High | Confirmed | Claim/release paths ignore redemption grace | Blocker |
| F-005 | P1 | High | Confirmed | Checkout trusts client-controlled source/price | Blocker |
| F-006 | P2 | High | Confirmed | Billing token consumption is non-atomic | Before launch |
| F-007 | P2 | High | Confirmed | Expo Doctor fails native dependency checks | Before build |
| F-008 | P2 | High | Confirmed | Website business onboarding checks fail | Before launch |
| F-009 | P2 | High | Confirmed | Share landing never resolves deal/status | Before launch |
| F-010 | P2 | High | Confirmed | Website has no store destinations | Before launch |
| F-011 | P2 | Medium | Configuration drift | Local Auth config conflicts with locked requirements | Verify/fix before release |
| F-012 | P2 | High | Confirmed | Source-of-truth docs and release checks are stale | Before sign-off |
| F-013 | P2 | High | Confirmed | Unmanaged legacy AI function is active remotely | Before release/deploy |
| F-014 | P3 | High | Confirmed | Moderate transitive dependency advisories | Hardening |
| F-015 | P3 | High | Design concern | Public admin shell exposes internal IA | Hardening |
| F-016 | P3 | Medium | Design concern | Monitoring/alert evidence is incomplete | Operational readiness |

## Root-cause chains

- F-003 makes merchant application easy to impersonate; F-002 makes an unapproved row public; F-001 permits owner-authenticated publication outside the canonical path.
- F-005 can create a wrong charge; later webhook validation can deny entitlement but cannot undo the customer harm.
- F-004 lets one function expire a claim that redemption/wallet logic still considers grace-valid.
- F-013 prevents full review/reproduction of the live AI attack, data, and cost surface.

