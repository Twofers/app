# Multilingual Deals Native Acceptance Packet

Date: 2026-06-24

Scope: this packet is the required evidence template for PR4 native-speaker and real-device acceptance. It does not approve production rollout, apply migrations, redeploy Edge Functions, enable hosted flags, start release builds, or submit stores.

Use this packet only after the target internal environment has the approved local code, required migrations, required Edge Function deploys, and gated feature flags available for internal QA. Those production-changing steps still require Dan's explicit approval before they happen.

## Production Block

Broad U.S. Spanish production remains blocked until:

- a named U.S. Spanish reviewer is recorded in `docs/localization/native-review-log.md`;
- Spanish reviewer decisions are recorded for every applicable scenario below;
- Spanish templates, UI strings, accessibility labels, prompt policies, deterministic fallback wording, and representative screenshots are signed off;
- `lib/localization-rollout-gate.ts` marks `es-US` as signed off with native screenshot QA passed.

Broad Korean production remains blocked until:

- a named Korean reviewer is recorded in `docs/localization/native-review-log.md`;
- Korean reviewer decisions are recorded for every applicable scenario below;
- Korean templates, UI strings, accessibility labels, prompt policies, fallback wording, counters, spacing, and representative screenshots are signed off;
- `lib/korean-counter-registry.ts` records reviewer-approved launch counters;
- `lib/localization-rollout-gate.ts` marks `ko-KR` as signed off with native screenshot QA passed.

## Evidence Rules

- Store raw screenshots only under local `artifacts/` folders unless Dan explicitly approves a sanitized source-control artifact.
- Do not transcribe QR tokens, claim codes, redemption codes, push tokens, auth tokens, API keys, claim URLs, or reviewer account credentials into chat, docs, commits, PRs, or public artifacts.
- If a screenshot contains a QR token, claim code, or redemption code, keep it local for visual QA only and redact or delete it before any external sharing.
- Record reviewer answers in `docs/localization/native-review-log.md` after the reviewer completes a scenario. This packet stays as the checklist; the log remains the decision ledger.
- Customer viewing must use approved stored localizations and must not make a model call.

## Scenario Matrix

Each row may be covered by a dedicated deal or by a clearly mapped combined fixture. Do not compress coverage so far that a reviewer cannot tell which scenario they approved.

| ID | Scenario | Required evidence |
| --- | --- | --- |
| NA-001 | English owner -> Spanish and Korean customers | One English-authored approved deal viewed by Spanish and Korean customer locales. |
| NA-002 | Spanish owner -> English and Korean customers | One Spanish-authored approved deal viewed by English and Korean customer locales. |
| NA-003 | Korean owner -> English and Spanish customers | One Korean-authored approved deal viewed by English and Spanish customer locales. |
| NA-004 | Coffee drink | Deal fixture for a coffee drink with exact BOGO mechanics preserved. |
| NA-005 | Pastry | Deal fixture for a pastry with exact BOGO mechanics preserved. |
| NA-006 | Meal with two different items | Deal fixture where the required purchase item and reward item differ. |
| NA-007 | Retail product | Deal fixture for a non-food retail item. |
| NA-008 | Service | Deal fixture for a service-style offer. |
| NA-009 | Branded English item name | Protected English brand or product name stays unchanged where required. |
| NA-010 | Hangul item name | Hangul item text renders correctly and survives storage/display. |
| NA-011 | Spanish item name | Spanish diacritics and grammar render correctly and survive storage/display. |
| NA-012 | Unknown Korean counter | Korean output uses the reviewed counter-free fallback instead of inferred counters. |
| NA-013 | Long Spanish headline | Spanish card remains readable without awkward density or clipped text. |
| NA-014 | Long Korean item term | Korean card remains readable without clipping Hangul or collapsing layout. |
| NA-015 | Mixed protected term | Mixed-language protected term remains accurate across customer locales. |
| NA-016 | Live quantity-limited offer | Same deal ID, claim inventory, remaining quantity, and sold-out behavior across locales. |
| NA-017 | Scheduled offer | Same start/end schedule, not-started state, and expiry behavior across locales. |
| NA-018 | Deterministic fallback | Reviewer sees fallback copy and confirms it is acceptable for launch. |
| NA-019 | No merchant photo | Placeholder or no-photo state is visually acceptable in each locale. |
| NA-020 | Busy merchant photo | Text remains readable over a visually busy merchant photo. |
| NA-021 | Small iPhone | Real-device iPhone screenshot confirms fit and readability. |
| NA-022 | Small Android | Real-device or explicitly approved local Android screenshot confirms fit and readability. |
| NA-023 | Accessibility text size | Increased text size remains understandable without hiding offer mechanics. |

## Reviewer Questions

For every applicable locale and scenario, record one answer for each question:

| Question | es-US reviewer answer | ko-KR reviewer answer | Notes / required changes |
| --- | --- | --- | --- |
| Is the exact offer correct? | Pending | Pending |  |
| Does this sound native rather than translated? | Pending | Pending |  |
| Is the level of politeness appropriate? | Pending | Pending |  |
| Are protected names handled correctly? | Pending | Pending |  |
| Are Korean counters and spacing correct? | Not applicable | Pending |  |
| Can the offer be understood in two seconds? | Pending | Pending |  |
| Does the card fit without awkward density? | Pending | Pending |  |
| Would a business owner be comfortable publishing it? | Pending | Pending |  |

Use `Pass`, `Needs change`, or `Not applicable` when completing the table in a local copy or review export. Do not change these pending source-control defaults until the broad-production evidence is ready to be reviewed as a complete approval packet.

## Evidence Manifest Template

Use one row per scenario, locale, and device form factor that needs review.

| Scenario ID | Owner locale | Customer locale | Deal ID / offer version ID | Device / viewport | Screenshot artifact path | Reviewer | Decision | Required changes | Native-review-log row added |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| NA-001 | en-US | es-US | Local-only / redacted | Pending | `artifacts/localization/native-acceptance/` | TBD | Pending | Pending | No |
| NA-001 | en-US | ko-KR | Local-only / redacted | Pending | `artifacts/localization/native-acceptance/` | TBD | Pending | Pending | No |
| NA-002 | es-US | en-US | Local-only / redacted | Pending | `artifacts/localization/native-acceptance/` | Dan / Twofer admin | Pending | Pending | No |
| NA-002 | es-US | ko-KR | Local-only / redacted | Pending | `artifacts/localization/native-acceptance/` | TBD | Pending | Pending | No |
| NA-003 | ko-KR | en-US | Local-only / redacted | Pending | `artifacts/localization/native-acceptance/` | Dan / Twofer admin | Pending | Pending | No |
| NA-003 | ko-KR | es-US | Local-only / redacted | Pending | `artifacts/localization/native-acceptance/` | TBD | Pending | Pending | No |

## Completion Criteria

This packet is complete only when:

1. Every scenario from NA-001 through NA-023 has mapped evidence.
2. Every Spanish-required row has a named U.S. Spanish reviewer decision.
3. Every Korean-required row has a named Korean reviewer decision.
4. Korean counter and spacing decisions are recorded by the Korean reviewer.
5. Real-device screenshot and typography QA are recorded for representative Spanish and Korean cases.
6. Required changes, if any, are fixed and re-reviewed.
7. `docs/localization/native-review-log.md`, `lib/localization-rollout-gate.ts`, `lib/offer-locale-templates.ts`, and `lib/korean-counter-registry.ts` are updated together when sign-off becomes real.
8. `LOCALIZATION_BROAD_PRODUCTION_ROLLOUT=true npm run gate:localization-rollout` passes only after the true evidence has been recorded.
