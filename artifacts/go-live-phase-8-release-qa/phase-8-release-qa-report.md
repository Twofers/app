# Phase 8 Release QA Report

Date: 2026-06-18
Branch: `codex/go-live-phase-1-foundation`
Scope: local release-candidate QA packet only. Release builds, store submissions, version/signing changes, Supabase migrations, and final human approval remain gated.

## Phase Completion Report

### Implemented
- [x] Approved QA process task: developer-shell, Android-home, reloading, developer-settings, unmatched-route, and debug captures are separated from product design review evidence.
- [x] Release copy hardening: visible launch copy was tightened for banned terms found during the Phase 8 audit.
- [x] Local evidence packet: this report records the ID ledger, copy-audit result, screenshot classification, and release gates that still require approved production/device QA.

### Not Completed Locally
- [ ] Production Android release build and clean install. Hard gate: release build approval required before running.
- [ ] iOS production build and clean install. This Windows machine cannot build/sign iOS locally; EAS/TestFlight approval and a real iPhone are required.
- [ ] Final light/dark screenshot set from actual product builds. Hard gate: release/device QA approval required.
- [ ] Human go-live approval. Owner review is required; this report does not claim production or store readiness.

## 112-ID Ledger

Source: `CHANGE_MANIFEST.md` from `C:\Users\unvme\Downloads\twofer-codex-go-live-plan.zip`. Count checked: 112 unique IDs across phases 1-8.

| Phase | Count | Local commit | IDs |
|---|---:|---|---|
| 1 | 10 | `fe0c741c` | `G-12`, `SET-01`, `SPLASH-01`, `ROUTE-01`, `ROUTE-02`, `ROUTE-03`, `SEC-01`, `WEB-01`, `WEB-02`, `WEB-03` |
| 2 | 14 | `fe46f0ac` | `G-01`, `G-02`, `G-03`, `G-04`, `G-05`, `G-06`, `G-07`, `G-08`, `G-09`, `G-10`, `G-11`, `G-13`, `G-14`, `G-15` |
| 3 | 23 | `d8cb10ba` | `AUTH-01`, `AUTH-02`, `AUTH-03`, `AUTH-04`, `AUTH-05`, `ONB-01`, `ONB-02`, `ONB-03`, `ONB-04`, `ONB-05`, `HOME-01`, `HOME-02`, `HOME-03`, `HOME-04`, `HOME-05`, `HOME-06`, `HOME-07`, `HOME-08`, `HOME-09`, `MAP-01`, `MAP-02`, `MAP-03`, `MAP-04` |
| 4 | 13 | `1b3421fe` | `DD-01`, `DD-02`, `DD-03`, `DD-04`, `DD-05`, `DD-06`, `DD-07`, `DD-08`, `DD-09`, `DD-10`, `WALLET-01`, `WALLET-02`, `WALLET-03` |
| 5 | 21 | `c122cb1d` | `CREATE-01`, `CREATE-02`, `CREATE-03`, `CREATE-04`, `CREATE-05`, `CREATE-06`, `CREATE-07`, `CREATE-08`, `QD-01`, `QD-02`, `QD-03`, `QD-04`, `QD-05`, `QD-06`, `QD-07`, `QD-08`, `REUSE-01`, `REUSE-02`, `REUSE-03`, `REUSE-04`, `REUSE-05` |
| 6 | 11 | `b759cf7a` | `PHOTO-01`, `PHOTO-02`, `PHOTO-03`, `PHOTO-04`, `PHOTO-05`, `PHOTO-06`, `MENU-01`, `MENU-02`, `MENU-03`, `MENU-04`, `MENU-05` |
| 7 | 19 | `0a4a9f6d` | `DASH-01`, `DASH-02`, `DASH-03`, `DASH-04`, `DASH-05`, `DASH-06`, `DASH-07`, `DASH-08`, `REDEEM-01`, `REDEEM-02`, `REDEEM-03`, `REDEEM-04`, `REDEEM-05`, `ACCOUNT-01`, `ACCOUNT-02`, `ACCOUNT-03`, `ACCOUNT-04`, `PROFILE-01`, `PROFILE-02` |
| 8 | 1 | this Phase 8 commit | `QA-01` |

## Screenshot Artifact Separation

Design-review candidates are actual Twofer product screens only. Use these buckets for the final screenshot set:

- Product design review candidates: deal-detail images `5413` and `5414`; native product captures under `native/010`-`041` except `042`; native customer captures for onboarding, Home, Map, Wallet loaded, Settings loaded, profile setup, and onboarding revisit; branded web/auth/product fallback captures that are not framework debug pages.
- Engineering-failure evidence only: reloading states, Dev Client server picker, Android home screen, developer settings, diagnostics/debug route captures, unmatched-route/framework pages, stack traces, and captures whose primary visible content is tooling rather than Twofer UI.
- Specific engineering examples from the provided index: `mcp-initial/000`-`003`, `mcp-customer-extra/060`-`062`, `mcp-customer-extra/105`, `native/042_debug_diagnostics.png`, stale dev-shell business/detail captures, `native-customer/131`-`132`, `native-customer/141`-`142`, `web/05-tabs-home-tabs-index-e2e-1-mode-customer.png`, and `web/30-stack-debug-diagnostics-e2e-1-mode-customer.png`.

Outcome: developer/tooling captures stay useful for routing and failure analysis, but they must not be attached as visual-design approval evidence.

## Local Copy Audit

Production-visible copy was searched for banned launch terms across `app`, `components`, and `lib`.

Local fixes made during this phase:
- Removed remaining visible `2-for-1`, `two-for-one`, `AI ads`, `fine print`, `Demo offer`, `Not eligible yet`, `high-value`, and owner-metric `engagement` wording from English production copy.
- Removed the surfaced Spanish/Korean visible equivalents from locale files and create-AI override files.
- Changed legacy demo-tagged visible text to a generic unavailable-offer state without deleting internal guards.
- Removed banned fallback copy candidates from `buildOfferCopyCandidates` and `buildHeadlineCandidates`.

Remaining grep hits are internal/test-only by review: legacy-title parsers, validation guards, reason codes, test fixtures, route/helper names, comments, and i18n key names whose rendered values are now launch-safe.

## Release Gate Status

| Gate | Status | Evidence / blocker |
|---|---|---|
| 112-ID completeness | Local pass | Ledger above accounts for 112 unique approved IDs. |
| Copy audit | Local pass, rendered QA pending | Source/locales cleaned; rendered release screenshots still required. |
| QA artifact separation | Local pass | Screenshot classification above. |
| P0 routing/reliability | Local pass, production/device pending | `npx tsc --noEmit`, full tests, lint, and web/iOS bundle probes passed; production build/manual deep-link matrix still required. |
| Light-mode visual QA | Blocked | Requires actual product screenshot pass from an approved production/release build. |
| Dark-mode visual QA | Blocked | Requires actual product screenshot pass from an approved production/release build. |
| Accessibility | Partial | Source-level labels were preserved/added in prior phases; screen-reader and increased-text device QA remains required. |
| Customer E2E | Partial | Automated/unit/bundle checks only; full production journey matrix remains required. |
| Owner E2E | Partial | Automated/unit/bundle checks only; full production journey matrix remains required. |
| Deep links | Partial | Local route tests/bundle checks only; cold/warm production-device matrix remains required. |
| Web posture | Local bundle pass, production/device pending | `npx expo export --platform web --output-dir .metro-health-check\go-live-phase-8-web --clear` passed with known country-flag-icons and Node `punycode` warnings. Production web/device screenshots remain required. |
| Security/privacy | Local source pass, release pass pending | No secrets printed; diagnostics exposure still must be verified in production build. |
| Production build | Blocked | Explicit approval required before release builds. |
| Final go-live approval | Blocked | Requires Dan/human approval after production/device QA. |

## Local Validation Results

- `node` JSON parse for `en.json`, `es.json`, `ko.json`, `es.createAi.overrides.json`, and `ko.createAi.overrides.json`: pass.
- `npx tsc --noEmit`: pass.
- Focused tests for offer copy, deal quality, display copy, share copy, business setup copy, and API messages: pass, 6 files / 64 tests.
- `npm test`: pass, 74 files / 455 tests. Expected Expo push failure-safety stderr appeared from mocked failure tests.
- `npm run lint`: pass.
- `git diff --check`: pass. Git printed Windows LF-to-CRLF warnings only.
- `npx expo export --platform web --output-dir .metro-health-check\go-live-phase-8-web --clear`: pass. Known warnings: `country-flag-icons` export fallback and Node `punycode` deprecation.
- `npx expo export --platform ios --output-dir .metro-health-check\go-live-phase-8-ios --clear`: pass. Known warning: `country-flag-icons` export fallback.

Production or release builds were not run.

## Required Next Owner-Gated Steps

1. Approve Android production/release build and clean-install QA.
2. Approve EAS iOS build/TestFlight device QA on a real iPhone.
3. Capture the final light/dark screenshot set from actual product screens only, with engineering/tooling captures stored separately.
4. Run the full Phase 8 functional, permission, interruption, accessibility, security, and performance matrix on release candidates.
5. Record human signoff or blocking findings before any store submission.
