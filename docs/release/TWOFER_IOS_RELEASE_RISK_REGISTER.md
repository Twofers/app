# Twofer iOS Release Risk Register

Date: 2026-06-30

Supersession note, 2026-07-01: the top billing/IAP risk was mitigated locally by removing in-app paid merchant unlock and Stripe payment paths from the mobile launch posture. Stripe remains web/admin/backend only. The risk is not closed until Dan reviews the final build, hosted website, privacy disclosures, reviewer accounts, and App Store Connect answers.

| Risk | Likelihood | Impact | Evidence | Mitigation | Owner | Deadline |
|---|---:|---:|---|---|---|---|
| App rejected due to merchant payment/IAP issue | High | High | `app/(tabs)/account/billing.tsx`, `lib/billing/access.ts`, Stripe checkout Edge Function, no StoreKit | Decide billing path; hide Stripe on iOS or implement StoreKit | Dan | Before submission |
| App rejected because reviewer cannot see a live deal | Med | High | Dallas/Grapevine launch, demo seed docs, no hosted check in audit | Verify reviewer accounts and claimable seeded deal | Dan | Before submission |
| App rejected due to missing account deletion | Low | High | In-app delete exists in consumer settings and business account; Edge deletion exists | Test deletion on disposable accounts in hosted review env | Codex/Dan | Before submission |
| App rejected due to incomplete privacy disclosures | Med | High | Privacy manifest exists; billing/localization/third-party data still conditional | Final legal/privacy review against exact build and SDKs | Dan | Before submission |
| App rejected due to push notification marketing consent | Low | Med | Push opt-in/settings code exists; server sends to opted-in consumers | Test opt-in/out and ensure review notes explain optional alerts | Codex/Dan | Before submission |
| App rejected due to location permission/fallback issue | Low | Med | ZIP fallback exists in onboarding; Apple expects alternatives where possible | Test deny-location path on iPhone and document ZIP fallback | Dan | Before submission |
| App rejected due to unmoderated merchant/AI-generated content | Med | Med | Reports and AI guardrails exist; no full moderation console verified | Add reviewer notes, acceptable-use policy, and admin takedown SOP | Dan/Codex | Before submission |
| App rejected due to broken QR redemption | Med | High | Edge-backed claim/redeem exists; current hosted state not tested in audit | Run TestFlight consumer claim -> merchant redeem smoke | Codex/Dan | Before submission |
| App rejected due to backend/RLS/security issue | Low/Med | High | Business intake migration/function verified live; RLS smoke passes; reviewer/demo paths still need hosted smoke | Continue remote migration/function checks and reviewer-path smoke without exposing secrets | Codex/Dan | Before submission |
| App accepted but users see empty inventory | High | Med | Dallas-first launch and limited pilot supply | Seed/partner enough live offers; improve empty state/reviewer path | Dan | Launch week |
| TestFlight build does not match current repo | Med | High | Dirty working tree; App Store Connect not checked | Verify build SHA/build number and create clean release candidate | Dan/Codex | Before submission |
| Broad Spanish/Korean rollout ships without native review | Med | Med | `eas.json` flags; `native-review-log.md` reviewers TBD | Keep broad rollout blocked or finish native review/screenshot QA | Dan | Before submission |
| Public legal URLs incomplete or stale | Med | High | URLs wired in `lib/legal-urls.ts`; page content not verified live | Open and review privacy/terms/support/delete-account pages | Dan | Before submission |
| Store screenshots mismatch current iOS UI | Med | Med | Many QA screenshots, no final App Store set identified | Capture current iPhone screenshots from final build | Dan | Before submission |
| Merchant billing charges without clear disclosure | Med | High | Trial disclosure in app; Stripe checkout; ASC subscription unknown | Align copy, disclosure, IAP/Stripe posture, and privacy answers | Dan | Before submission |

## Highest Priority Mitigations

1. Resolve billing/IAP posture.
2. Verify reviewer demo path.
3. Verify hosted backend state.
4. Finalize privacy/metadata/screenshots.
5. Run real iPhone TestFlight smoke.
