# Twofer Release Risk Register

Date: 2026-07-01

| Risk | Likelihood | Impact | Current Mitigation | Owner | Timing |
|---|---:|---:|---|---|---|
| App Review sees mobile Stripe/pricing path | Low/Med | High | Mobile billing flags false; routes/deep links gated; copy guard added | Dan/Codex | Before build |
| Reviewer merchant account inactive | Med | High | Merchant access helper requires active entitlement | Dan | Before submission |
| Website legal/support copy needs final owner review | Low/Med | High | Live static pages deployed | Dan | Before submission |
| Business application form endpoint regression | Low | Med | Migration/function deployed and non-polluting hosted checks passed | Dan/Codex | Before public web launch |
| Android App Links fail on device | Low/Med | Med | assetlinks deployed with Play App Signing SHA-256 | Dan | Before Android public launch |
| Privacy labels mismatch exact build | Med | High | Draft updated for web-only billing posture | Dan | Before submission |
| Hosted Supabase reviewer paths unverified | Med | High | Business intake deployed; broader hosted app smoke still needed | Dan | Before submission |
| Account deletion fails on hosted backend | Low/Med | High | Existing app/function flow | Dan | Before submission |
| Empty Dallas market blocks review | Med | High | Review notes require seeded demo content | Dan | Before submission |
| Broad localization not fully reviewed | Med | Med | EN/ES/KO files updated; broad rollout still needs QA | Dan | Before submission |
